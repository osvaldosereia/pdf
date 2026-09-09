begin;

-- Blocos padrão: linguagem cordial e consistente, sem custo de IA.
insert into public.service_message_blocks(block_key,title,body_template,variables,status,priority)
values
('welcome_cordial_v1','Boas-vindas cordial','Oi{{name_suffix}}! 😊 Seja bem-vindo à Dona Antônia. Pode me dizer o que você precisa? Eu consigo procurar produtos, montar e ajustar seu pedido por aqui.',array['name_suffix'],'published',100),
('payment_methods_v1','Formas de pagamento','Claro{{name_suffix}} 😊 Você pode pagar na entrega com cartão de crédito em até 3x sem juros, cartão de débito, Pix, dinheiro ou cartão alimentação Alelo, Sodexo, Puxee, Cajur, Flash e iFood. Por enquanto não vendemos para 30 dias nem no boleto.',array['name_suffix'],'published',100),
('delivery_free_v1','Entrega grátis e mínimo','Claro{{name_suffix}} 😊 A entrega é grátis em Cuiabá e Várzea Grande. O pedido mínimo para entrega é de R$ 75,00.',array['name_suffix'],'published',100),
('human_handoff_v1','Transferência humana','Claro{{name_suffix}}. Vou encaminhar seu atendimento para a equipe e eles continuam daqui, sem você precisar repetir tudo.',array['name_suffix'],'published',100),
('product_added_v1','Produto adicionado','Prontinho{{name_suffix}} 😊 Coloquei {{quantity}}× {{product_name}} no seu pedido. O total agora ficou em {{cart_total}}.',array['name_suffix','quantity','product_name','cart_total'],'published',100),
('product_removed_v1','Produto retirado','Prontinho{{name_suffix}} 😊 Retirei {{product_name}} do seu pedido. O total agora ficou em {{cart_total}}.',array['name_suffix','product_name','cart_total'],'published',100),
('product_not_found_v1','Produto não encontrado','Poxa{{name_suffix}}, não encontrei {{query}} entre os produtos disponíveis agora. Se quiser, eu posso te mostrar opções parecidas.',array['name_suffix','query'],'published',95),
('address_required_v1','Solicitar endereço','Perfeito{{name_suffix}} 😊 Para eu continuar, me envie o endereço de entrega com rua, número e cidade.',array['name_suffix'],'published',100)
on conflict (block_key) do nothing;

insert into public.service_trigger_rules(
  trigger_key,title,match_mode,patterns,action_type,message_block_key,priority,stop_on_match,once_per_conversation,cooldown_seconds,status
) values
('greeting_simple_v1','Saudação simples','exact',array['oi','oii','oiii','olá','ola','bom dia','boa tarde','boa noite'],'send_block','welcome_cordial_v1',100,true,false,0,'published'),
('payment_question_v1','Pergunta sobre pagamento','contains',array['forma de pagamento','formas de pagamento','pagamento','aceita pix','aceita cartão','aceita cartao','boleto','30 dias'],'send_block','payment_methods_v1',98,true,false,0,'published'),
('delivery_fee_question_v1','Pergunta sobre frete e pedido mínimo','contains',array['frete','taxa de entrega','entrega grátis','entrega gratis','pedido mínimo','pedido minimo'],'send_block','delivery_free_v1',98,true,false,0,'published'),
('human_request_v1','Pedido explícito de atendente','contains',array['quero falar com atendente','falar com atendente','quero falar com uma pessoa','falar com uma pessoa da equipe'],'human','human_handoff_v1',100,true,false,0,'published')
on conflict (trigger_key) do nothing;

-- Aliases iniciais conservadores. O Admin poderá ampliar a partir de conversas reais.
insert into public.product_aliases(alias,normalized_alias,canonical_query,priority,status,source_note)
values
('água sanitária','agua sanitaria','agua sanitaria',90,'published','Alias genérico inicial'),
('oleo','oleo','oleo',90,'published','Alias genérico inicial')
on conflict (normalized_alias) do nothing;

revoke all on function public.resolve_whatsapp_product_candidates_v2(text,integer) from public,anon,authenticated;
revoke all on function public.get_service_intelligence_bundle_v2(text,text,text,text) from public,anon,authenticated;
revoke all on function public.get_service_trigger_match_v1(text,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.record_service_trigger_event_v1(uuid,uuid,uuid,text,text,text,jsonb,numeric,integer) from public,anon,authenticated;
revoke all on function public.get_whatsapp_cost_first_preflight_v1(uuid) from public,anon,authenticated;
grant execute on function public.resolve_whatsapp_product_candidates_v2(text,integer) to service_role;
grant execute on function public.get_service_intelligence_bundle_v2(text,text,text,text) to service_role;
grant execute on function public.get_service_trigger_match_v1(text,text,text,text,uuid,text) to service_role;
grant execute on function public.record_service_trigger_event_v1(uuid,uuid,uuid,text,text,text,jsonb,numeric,integer) to service_role;
grant execute on function public.get_whatsapp_cost_first_preflight_v1(uuid) to service_role;

-- Dispatcher compatível: continua em v3 por padrão. Só muda para v4 quando o
-- proprietário habilitar explicitamente whatsapp_cost_first_router_enabled.
create or replace function public.dispatch_conversation_worker_job_v2(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  j public.ai_jobs%rowtype;
  v_secret text;
  v_request bigint;
  v_worker_version integer:=3;
  v_worker_url text:='https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/conversation-worker-v3';
begin
  select * into cfg from public.automation_config where id=1;
  select * into j from public.ai_jobs where id=p_job_id for update;
  if not found then return jsonb_build_object('dispatched',false,'reason','job_not_found'); end if;
  if j.status<>'pending' then return jsonb_build_object('dispatched',false,'reason','job_not_pending','status',j.status); end if;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and cfg.conversation_worker_dispatch_enabled,false) then
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_disabled');
  end if;
  if j.worker_dispatch_attempts>=cfg.conversation_worker_dispatch_max_attempts then
    update public.ai_jobs set status='held',error_message='worker_dispatch_exhausted_human_required',updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','dispatch_attempts_exhausted');
  end if;

  if coalesce(cfg.whatsapp_cost_first_router_enabled,false) then
    v_worker_version:=4;
    v_worker_url:='https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/conversation-worker-v4';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='conversation_worker_webhook_key_v2'
  order by created_at desc limit 1;
  if v_secret is null then
    update public.ai_jobs set worker_dispatch_last_error='worker_vault_secret_missing',updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','worker_secret_missing');
  end if;

  begin
    v_request:=net.http_post(
      url:=v_worker_url,
      headers:=jsonb_build_object('Content-Type','application/json','x-da-worker-key',v_secret),
      body:=jsonb_build_object('job_id',j.id),
      timeout_milliseconds:=120000
    );
    update public.ai_jobs
      set worker_dispatch_request_id=v_request,worker_dispatched_at=now(),
          worker_dispatch_attempts=worker_dispatch_attempts+1,worker_dispatch_last_error=null,updated_at=now()
      where id=j.id;
    return jsonb_build_object('dispatched',true,'request_id',v_request,'job_id',j.id,'worker_version',v_worker_version);
  exception when others then
    update public.ai_jobs
      set worker_dispatch_attempts=worker_dispatch_attempts+1,worker_dispatch_last_error='worker_dispatch_failed',worker_dispatched_at=now(),updated_at=now()
      where id=j.id;
    insert into public.whatsapp_ops_events(event_type,severity,ai_job_id,details)
      values('worker_dispatch_failed','warning',j.id,jsonb_build_object('job_type',j.job_type,'worker_version',v_worker_version));
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_failed');
  end;
end $$;

revoke all on function public.dispatch_conversation_worker_job_v2(uuid) from public,anon,authenticated;
grant execute on function public.dispatch_conversation_worker_job_v2(uuid) to service_role;

commit;
