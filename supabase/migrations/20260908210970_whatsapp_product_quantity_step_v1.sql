begin;

-- MVP WhatsApp: selecionar um produto nunca mais adiciona 1 unidade implicitamente.
-- A seleção abre uma etapa determinística de quantidade. O produto só entra no
-- carrinho depois que a quantidade é escolhida/informada.

create or replace function public.prepare_whatsapp_sales_product_quantity_v1(
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_product_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  p jsonb;
  st jsonb;
begin
  p:=public.get_whatsapp_sellable_product_v1(p_product_id);
  if p is null then raise exception 'sellable_product_not_found'; end if;

  st:=public.update_whatsapp_sales_state_v1(
    p_conversation_id,
    null,
    jsonb_build_array(p),
    'product_selected_waiting_quantity',
    p_product_id,
    'product_quantity'
  );

  insert into public.whatsapp_sales_action_events(
    conversation_id,message_id,action_type,action_payload,result,
    reversible,required_confirmation,confidence
  ) values(
    p_conversation_id,p_source_message_id,'select_product_for_quantity',
    jsonb_build_object('product_id',p_product_id),
    jsonb_build_object('product',p,'awaiting','product_quantity'),
    true,false,1
  );

  return jsonb_build_object('product',p,'state',st,'awaiting','product_quantity');
end $$;

create or replace function public.apply_whatsapp_sales_product_quantity_v1(
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_product_id uuid,
  p_quantity integer
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  s public.whatsapp_sales_state%rowtype;
  p jsonb;
  added jsonb;
  cart jsonb;
begin
  if p_quantity is null or p_quantity<1 or p_quantity>999 then raise exception 'invalid_quantity'; end if;
  select * into s from public.whatsapp_sales_state where conversation_id=p_conversation_id for update;
  if not found or s.awaiting is distinct from 'product_quantity' then raise exception 'quantity_not_expected'; end if;
  if s.last_product_id is distinct from p_product_id then raise exception 'stale_product_quantity_selection'; end if;

  p:=public.get_whatsapp_sellable_product_v1(p_product_id);
  if p is null then raise exception 'sellable_product_not_found'; end if;
  if p_quantity>coalesce((p->>'stock')::numeric,0) then raise exception 'quantity_exceeds_stock'; end if;

  added:=public.add_whatsapp_sales_product_v1(p_conversation_id,p_product_id,p_quantity);
  cart:=public.get_whatsapp_sales_cart_v1(p_conversation_id);
  perform public.update_whatsapp_sales_state_v1(
    p_conversation_id,null,null,'product_quantity_added',p_product_id,''
  );

  insert into public.whatsapp_sales_action_events(
    conversation_id,message_id,action_type,action_payload,result,
    reversible,required_confirmation,confidence
  ) values(
    p_conversation_id,p_source_message_id,'add_product_quantity',
    jsonb_build_object('product_id',p_product_id,'quantity',p_quantity),
    jsonb_build_object('product',p,'added',added,'cart',cart),
    true,false,1
  );

  return jsonb_build_object('product',p,'quantity',p_quantity,'added',added,'cart',cart);
end $$;

create or replace function public.whatsapp_quantity_prompt_v1(p_product jsonb)
returns jsonb
language plpgsql immutable set search_path=''
as $$
declare
  pid text:=coalesce(p_product->>'id','');
  pname text:=left(coalesce(p_product->>'name','Produto'),180);
  price_txt text:=replace(to_char(coalesce(nullif(p_product->>'price','')::numeric,0),'FM999999990.00'),'.',',');
  rows jsonb:='[]'::jsonb;
  q integer;
begin
  if pid='' then raise exception 'product_id_required'; end if;
  foreach q in array array[1,2,3,4,5,6,10] loop
    rows:=rows||jsonb_build_array(jsonb_build_object(
      'id','da_qty:'||pid||':'||q::text,
      'title',q::text||case when q=1 then ' unidade' else ' unidades' end,
      'description','Adicionar '||q::text||case when q=1 then ' unidade' else ' unidades' end
    ));
  end loop;
  rows:=rows||jsonb_build_array(jsonb_build_object(
    'id','da_qty_other:'||pid,
    'title','Outra quantidade',
    'description','Digitar outra quantidade'
  ));

  return jsonb_build_object(
    'type','list',
    'body',jsonb_build_object(
      'text','Você escolheu: '||pname||E'\nPreço: R$ '||price_txt||E'\n\nQual quantidade você quer?'
    ),
    'action',jsonb_build_object(
      'button','Escolher quantidade',
      'sections',jsonb_build_array(jsonb_build_object('title','Quantidade','rows',rows))
    )
  );
end $$;

-- Enriquecimento do seletor: o título da Meta é curto por limite da própria lista,
-- então o nome completo também vai no campo de descrição. Na tela seguinte o nome
-- completo volta a ser mostrado no corpo da pergunta de quantidade.
create or replace function public.enrich_whatsapp_product_selection_list_v1(p_interactive jsonb)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  outj jsonb:=coalesce(p_interactive,'{}'::jsonb);
  sections jsonb:='[]'::jsonb;
  sec jsonb;
  rows jsonb;
  new_rows jsonb;
  r jsonb;
  rid text;
  pid uuid;
  p jsonb;
  price_txt text;
  desc_txt text;
begin
  if coalesce(outj->>'type','')<>'list' then return outj; end if;
  for sec in select value from jsonb_array_elements(coalesce(outj->'action'->'sections','[]'::jsonb)) loop
    rows:=coalesce(sec->'rows','[]'::jsonb);
    new_rows:='[]'::jsonb;
    for r in select value from jsonb_array_elements(rows) loop
      rid:=coalesce(r->>'id','');
      if rid like 'da_add_product:%' then
        begin
          pid:=substring(rid from length('da_add_product:')+1)::uuid;
          p:=public.get_whatsapp_sellable_product_v1(pid);
        exception when others then
          p:=null;
        end;
        if p is not null then
          price_txt:=replace(to_char(coalesce((p->>'price')::numeric,0),'FM999999990.00'),'.',',');
          desc_txt:=left(coalesce(p->>'name','')||' · R$ '||price_txt,72);
          r:=jsonb_set(r,'{title}',to_jsonb(left(coalesce(p->>'name','Produto'),24)),true);
          r:=jsonb_set(r,'{description}',to_jsonb(desc_txt),true);
        end if;
      end if;
      new_rows:=new_rows||jsonb_build_array(r);
    end loop;
    sec:=jsonb_set(sec,'{rows}',new_rows,true);
    sections:=sections||jsonb_build_array(sec);
  end loop;
  return jsonb_set(outj,'{action,sections}',sections,true);
end $$;

create or replace function public.enrich_whatsapp_product_selection_outbound_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_interactive jsonb;
begin
  if new.job_type='seller_message'
     and coalesce(new.payload->>'delivery_mode','')='interactive'
     and coalesce(new.payload->'interactive'->>'type','')='list' then
    v_interactive:=public.enrich_whatsapp_product_selection_list_v1(new.payload->'interactive');
    new.payload:=jsonb_set(new.payload,'{interactive}',v_interactive,true);
  end if;
  return new;
end $$;

drop trigger if exists trg_enrich_whatsapp_product_selection_outbound_v1 on public.outbound_jobs;
create trigger trg_enrich_whatsapp_product_selection_outbound_v1
before insert on public.outbound_jobs
for each row execute function public.enrich_whatsapp_product_selection_outbound_v1();

-- O wrapper atual recebe a resposta da Meta. Interações de produto/quantidade são
-- resolvidas de forma determinística antes do worker, reduzindo custo e evitando
-- que a escolha do produto já implique quantidade=1.
create or replace function public.ingest_whatsapp_message(
  p_phone_number_id text,
  p_waba_id text,
  p_from text,
  p_profile_name text,
  p_message_id text,
  p_message_timestamp timestamptz,
  p_message_type text,
  p_body_text text default null,
  p_media_id text default null,
  p_interactive_payload jsonb default '{}'::jsonb,
  p_referral jsonb default '{}'::jsonb,
  p_raw_event jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_release jsonb; v_result jsonb; v_cfg public.automation_config%rowtype;
  v_body text; v_welcome jsonb; v_conversation uuid; v_message uuid;
  v_ai_job uuid; v_ai_job_json jsonb; v_cohort text; v_bucket smallint;
  v_interactive_id text; v_pid uuid; v_qty integer; v_prepared jsonb;
  v_applied jsonb; v_product jsonb; v_prompt jsonb; v_state public.whatsapp_sales_state%rowtype;
  v_match text[]; v_total text; v_reply text;
begin
  v_release:=public.whatsapp_release_decision(p_from,p_message_timestamp);
  if coalesce((v_release->>'allow_ingest')::boolean,false) is not true then
    return jsonb_build_object('ok',true,'ignored',true,'reason',coalesce(v_release->>'reason','release_blocked'),'release_mode',v_release->>'mode','should_reply',false);
  end if;

  v_result:=public.ingest_whatsapp_message_core_v1(
    p_phone_number_id,p_waba_id,p_from,p_profile_name,p_message_id,p_message_timestamp,
    p_message_type,p_body_text,p_media_id,p_interactive_payload,p_referral,p_raw_event
  );

  if coalesce((v_result->>'ok')::boolean,false)=true and coalesce((v_result->>'duplicate')::boolean,false)=false then
    v_conversation:=nullif(v_result->>'conversation_id','')::uuid;
    v_message:=nullif(v_result->>'message_row_id','')::uuid;
    v_ai_job:=nullif(coalesce(v_result->'ai_job'->>'id',v_result->'reply'->'ai_job'->>'id'),'')::uuid;
    v_cohort:=nullif(v_release->>'cohort','');
    v_bucket:=nullif(v_release->>'bucket','')::smallint;
    if v_conversation is not null then
      update public.conversations set automation_cohort=v_cohort,automation_bucket=v_bucket,updated_at=now() where id=v_conversation;
    end if;
    if coalesce((v_release->>'auto_reply_allowed')::boolean,false) is not true then
      if v_ai_job is not null then update public.ai_jobs set status='held',error_message='release_human_control',updated_at=now() where id=v_ai_job and status in ('pending','held'); end if;
      if v_conversation is not null then perform public.queue_human_handoff_v1(v_conversation,coalesce(v_release->>'reason','release_human_control'),v_message,2::smallint,'Atendimento retido pela liberação gradual.',jsonb_build_object('release_mode',v_release->>'mode','cohort',v_cohort,'bucket',v_bucket)); end if;
      v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
      v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','none'),true);
      return v_result||jsonb_build_object('ai_job',null,'mode','human','release',v_release);
    end if;
  end if;

  select * into v_cfg from public.automation_config where id=1;
  v_interactive_id:=coalesce(p_interactive_payload->>'id','');

  -- 1) Produto escolhido na lista: NÃO adiciona. Pergunta quantidade.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='interactive'
     and v_interactive_id like 'da_add_product:%' then
    begin v_pid:=substring(v_interactive_id from length('da_add_product:')+1)::uuid; exception when others then raise exception 'invalid_product_selection'; end;
    if v_ai_job is not null then
      update public.ai_jobs set status='done',result=jsonb_build_object('deterministic',true,'action','product_selected_waiting_quantity'),error_message=null,updated_at=now()
       where id=v_ai_job and status in ('pending','held') and attempts=0;
    end if;
    v_prepared:=public.prepare_whatsapp_sales_product_quantity_v1(v_conversation,v_message,v_pid);
    v_product:=v_prepared->'product';
    if coalesce(v_cfg.whatsapp_sales_interactive_enabled,false) then
      v_prompt:=public.whatsapp_quantity_prompt_v1(v_product);
      perform public.queue_whatsapp_sales_reply_v1(v_conversation,v_message,coalesce(v_prompt->'body'->>'text','Qual quantidade?'),'interactive',null,v_prompt,'ask_product_quantity',v_prepared,1);
    else
      perform public.queue_whatsapp_sales_reply_v1(v_conversation,v_message,'Você escolheu: '||coalesce(v_product->>'name','produto')||E'\n\nQual quantidade você quer? Responda somente com o número.','text',null,null,'ask_product_quantity',v_prepared,1);
    end if;
    v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','none'),true);
    return v_result||jsonb_build_object('ai_job',null,'sales_interactive',true,'deterministic_action','ask_product_quantity','release',v_release);
  end if;

  -- 2) Quantidade escolhida na lista.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='interactive'
     and v_interactive_id like 'da_qty:%' then
    v_match:=regexp_match(v_interactive_id,'^da_qty:([0-9a-fA-F-]{36}):([0-9]{1,3})$');
    if v_match is null then raise exception 'invalid_quantity_selection'; end if;
    v_pid:=v_match[1]::uuid; v_qty:=v_match[2]::integer;
    if v_ai_job is not null then
      update public.ai_jobs set status='done',result=jsonb_build_object('deterministic',true,'action','product_quantity_selected'),error_message=null,updated_at=now()
       where id=v_ai_job and status in ('pending','held') and attempts=0;
    end if;
    v_applied:=public.apply_whatsapp_sales_product_quantity_v1(v_conversation,v_message,v_pid,v_qty);
    v_total:=replace(to_char(coalesce((v_applied->'cart'->>'total')::numeric,0),'FM999999990.00'),'.',',');
    v_reply:='Adicionei '||v_qty||' × '||coalesce(v_applied->'product'->>'name','produto')||'. Seu pedido está em R$ '||v_total||'. Pode mandar o próximo item ou dizer “finalizar”.';
    perform public.queue_whatsapp_sales_reply_v1(v_conversation,v_message,v_reply,'text',null,null,'add_product_quantity',v_applied,1);
    v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','none'),true);
    return v_result||jsonb_build_object('ai_job',null,'sales_interactive',true,'deterministic_action','add_product_quantity','release',v_release);
  end if;

  -- 3) Outra quantidade: mantém a espera e solicita o número digitado.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='interactive'
     and v_interactive_id like 'da_qty_other:%' then
    begin v_pid:=substring(v_interactive_id from length('da_qty_other:')+1)::uuid; exception when others then raise exception 'invalid_product_selection'; end;
    select * into v_state from public.whatsapp_sales_state where conversation_id=v_conversation;
    if not found or v_state.awaiting is distinct from 'product_quantity' or v_state.last_product_id is distinct from v_pid then raise exception 'stale_product_quantity_selection'; end if;
    v_product:=public.get_whatsapp_sellable_product_v1(v_pid);
    if v_ai_job is not null then
      update public.ai_jobs set status='done',result=jsonb_build_object('deterministic',true,'action','await_typed_quantity'),error_message=null,updated_at=now()
       where id=v_ai_job and status in ('pending','held') and attempts=0;
    end if;
    perform public.queue_whatsapp_sales_reply_v1(v_conversation,v_message,'Digite a quantidade desejada de '||coalesce(v_product->>'name','produto')||' (ex.: 2).','text',null,null,'await_typed_quantity',jsonb_build_object('product',v_product),1);
    v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','none'),true);
    return v_result||jsonb_build_object('ai_job',null,'deterministic_action','await_typed_quantity','release',v_release);
  end if;

  -- 4) Usuário digitou a quantidade enquanto a conversa espera por ela.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='text'
     and v_conversation is not null then
    select * into v_state from public.whatsapp_sales_state where conversation_id=v_conversation;
    if found and v_state.awaiting='product_quantity' and v_state.last_product_id is not null then
      v_body:=lower(trim(coalesce(p_body_text,'')));
      if length(v_body)<=30 then
        v_match:=regexp_match(v_body,'([0-9]{1,3})');
      else
        v_match:=null;
      end if;
      if v_ai_job is not null then
        update public.ai_jobs set status='done',result=jsonb_build_object('deterministic',true,'action','typed_product_quantity'),error_message=null,updated_at=now()
         where id=v_ai_job and status in ('pending','held') and attempts=0;
      end if;
      if v_match is null then
        v_product:=public.get_whatsapp_sellable_product_v1(v_state.last_product_id);
        perform public.queue_whatsapp_sales_reply_v1(v_conversation,v_message,'Me diga só a quantidade de '||coalesce(v_product->>'name','produto')||' (ex.: 2).','text',null,null,'quantity_clarification',jsonb_build_object('product_id',v_state.last_product_id),1);
      else
        v_qty:=v_match[1]::integer;
        v_applied:=public.apply_whatsapp_sales_product_quantity_v1(v_conversation,v_message,v_state.last_product_id,v_qty);
        v_total:=replace(to_char(coalesce((v_applied->'cart'->>'total')::numeric,0),'FM999999990.00'),'.',',');
        v_reply:='Adicionei '||v_qty||' × '||coalesce(v_applied->'product'->>'name','produto')||'. Seu pedido está em R$ '||v_total||'. Pode mandar o próximo item ou dizer “finalizar”.';
        perform public.queue_whatsapp_sales_reply_v1(v_conversation,v_message,v_reply,'text',null,null,'add_product_quantity',v_applied,1);
      end if;
      v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
      v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','none'),true);
      return v_result||jsonb_build_object('ai_job',null,'deterministic_action','typed_product_quantity','release',v_release);
    end if;
  end if;

  -- Demais interações comerciais continuam no worker v3.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='interactive'
     and v_interactive_id like 'da\\_%' escape '\\' then
    if coalesce(v_cfg.automation_enabled and v_cfg.ai_enabled and v_cfg.conversation_worker_enabled and v_cfg.whatsapp_sales_mvp_enabled,false) then
      v_ai_job_json:=public.queue_ai_job_for_message(v_message,'conversation',jsonb_build_object('source','whatsapp','interactive_id',v_interactive_id,'sales_mvp',true));
      v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
      v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','needs_ai','ai_job',v_ai_job_json),true);
      return v_result||jsonb_build_object('ai_job',v_ai_job_json,'sales_interactive',true,'release',v_release);
    end if;
  end if;

  -- Saudação/menu determinístico continua preservado.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce((v_result->>'should_reply')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='text' then
    v_body:=translate(lower(trim(regexp_replace(coalesce(p_body_text,''),'\\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
    v_body:=regexp_replace(v_body,'[.!?,;:]+$','','g');
    if v_body in ('oi','oii','oiii','ola','olaa','olaaa','bom dia','boa tarde','boa noite','menu','inicio','iniciar','comecar') then
      if coalesce(v_cfg.whatsapp_auto_reply_enabled,false) and coalesce(v_cfg.automation_enabled,false) and coalesce(v_cfg.outbound_enabled,false) and v_cfg.whatsapp_release_mode in ('homologation','live') then
        select jsonb_build_object('kind','interactive_buttons','body_text',qr.body_text,'buttons',qr.metadata->'buttons') into v_welcome
          from public.quick_replies qr where qr.key='welcome_menu' and qr.is_active=true limit 1;
        if v_welcome is not null then
          v_result:=jsonb_set(v_result,'{should_reply}','true'::jsonb,true);
          v_result:=jsonb_set(v_result,'{reply}',v_welcome,true);
          v_result:=v_result||jsonb_build_object('menu_reason','greeting_or_menu_command');
        end if;
      end if;
    end if;
  end if;
  return v_result||jsonb_build_object('release',v_release);
end $$;

revoke all on function public.prepare_whatsapp_sales_product_quantity_v1(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.apply_whatsapp_sales_product_quantity_v1(uuid,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.whatsapp_quantity_prompt_v1(jsonb) from public,anon,authenticated;
revoke all on function public.enrich_whatsapp_product_selection_list_v1(jsonb) from public,anon,authenticated;
revoke all on function public.enrich_whatsapp_product_selection_outbound_v1() from public,anon,authenticated;
revoke all on function public.ingest_whatsapp_message(text,text,text,text,text,timestamptz,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;

grant execute on function public.prepare_whatsapp_sales_product_quantity_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.apply_whatsapp_sales_product_quantity_v1(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.whatsapp_quantity_prompt_v1(jsonb) to service_role;
grant execute on function public.enrich_whatsapp_product_selection_list_v1(jsonb) to service_role;
grant execute on function public.ingest_whatsapp_message(text,text,text,text,text,timestamptz,text,text,text,jsonb,jsonb,jsonb) to service_role;

commit;
