begin;

-- MVP WhatsApp: evita confirmação duplicada.
-- Se o cliente pedir para finalizar e ainda não houver endereço completo,
-- o outbound de checkout vira um pedido de endereço. O resumo + botão de
-- confirmação só é mostrado depois que o endereço já estiver disponível.

create or replace function public.whatsapp_checkout_address_first_outbound_v1()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_reply_id uuid;
  v_action text;
  c public.conversations%rowtype;
  s public.whatsapp_sales_state%rowtype;
  v_has_address boolean:=false;
  v_prompt text:='Para fechar seu pedido, me passe o endereço de entrega com rua, número e cidade.';
begin
  if new.job_type<>'seller_message'
     or coalesce(new.payload->>'message_kind','')<>'conversation_reply' then
    return new;
  end if;

  begin
    v_reply_id:=nullif(new.payload->>'reply_message_id','')::uuid;
  exception when others then
    return new;
  end;
  if v_reply_id is null then return new; end if;

  select m.ai_interpretation->>'action_type'
    into v_action
    from public.messages m
   where m.id=v_reply_id;
  if coalesce(v_action,'')<>'checkout_preview' then return new; end if;

  select * into c from public.conversations where id=new.conversation_id for update;
  if not found then return new; end if;

  select * into s from public.whatsapp_sales_state where conversation_id=c.id;
  if found then
    v_has_address:=coalesce(s.pending_delivery_address->>'street','')<>''
      and coalesce(s.pending_delivery_address->>'number','')<>''
      and coalesce(s.pending_delivery_address->>'city','')<>'';
  end if;

  if not v_has_address and c.customer_id is not null then
    select exists(
      select 1 from public.customer_addresses a
       where a.customer_id=c.customer_id
         and a.is_active=true
         and coalesce(a.street,'')<>''
         and coalesce(a.number,'')<>''
         and coalesce(a.city,'')<>''
    ) into v_has_address;
  end if;

  if v_has_address then return new; end if;

  insert into public.whatsapp_sales_state(conversation_id,awaiting,last_action)
  values(c.id,'delivery_address','request_address')
  on conflict(conversation_id) do update
    set awaiting='delivery_address',last_action='request_address',updated_at=now();

  update public.messages
     set body_text=v_prompt,
         message_type='text',
         ai_interpretation=coalesce(ai_interpretation,'{}'::jsonb)
           || jsonb_build_object(
                'action_type','request_address',
                'delivery_mode','text',
                'checkout_address_first',true
              )
   where id=v_reply_id;

  new.payload:=jsonb_set(new.payload,'{message_type}',to_jsonb('text'::text),true);
  new.payload:=jsonb_set(new.payload,'{delivery_mode}',to_jsonb('text'::text),true);
  new.payload:=jsonb_set(new.payload,'{body_text}',to_jsonb(v_prompt),true);
  new.payload:=jsonb_set(new.payload,'{interactive}','null'::jsonb,true);
  new.payload:=jsonb_set(new.payload,'{image_url}','null'::jsonb,true);

  insert into public.whatsapp_ops_events(event_type,severity,conversation_id,details)
  values('checkout_address_requested_before_confirmation','info',c.id,
    jsonb_build_object('reply_message_id',v_reply_id,'flow','address_before_single_confirmation'));

  return new;
end $$;

drop trigger if exists trg_checkout_address_first_outbound_v1 on public.outbound_jobs;
create trigger trg_checkout_address_first_outbound_v1
before insert on public.outbound_jobs
for each row execute function public.whatsapp_checkout_address_first_outbound_v1();

insert into public.service_guidance_rules(
  rule_key,title,instruction,intent_scope,stage_scope,behavior_tags,status,priority,version_no
) values(
  'checkout_address_before_confirmation',
  'Endereço antes da confirmação final',
  'Ao finalizar: se ainda faltar endereço, peça somente o endereço. Depois de obter rua, número e cidade, mostre o resumo final e peça uma única confirmação explícita. Não faça o cliente confirmar duas vezes.',
  array['checkout','confirm_order'],
  '{}',
  array['sales','ux','minimal_interactions'],
  'published',
  110,
  1
)
on conflict(rule_key,version_no) do nothing;

revoke all on function public.whatsapp_checkout_address_first_outbound_v1() from public,anon,authenticated;

commit;
