begin;

-- Handler Data Exchange do Flow comercial único de cestas.
-- Somente sessão/estado de navegação são atualizados nesta fase; carrinho/pedido continuam sem escrita.
create or replace function public.handle_whatsapp_flow_commercial_exchange_v1(
  p_session_id uuid,p_conversation_id uuid,p_action text,p_screen text default null,p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $flow$
declare
  s public.experience_sessions%rowtype; v_current text; v_trigger text:=coalesce(p_data->>'trigger',''); v_context jsonb;
  v_snapshot jsonb; v_baskets jsonb; v_sections jsonb; v_terms jsonb; v_results jsonb; v_options jsonb;
  v_basket_id uuid; v_product_id uuid; v_section text; v_term text; v_query text; v_title text; v_product jsonb;
begin
  select * into s from public.experience_sessions where id=p_session_id for update;
  if not found or s.conversation_id is distinct from p_conversation_id then return jsonb_build_object('ok',false,'reason','flow_session_not_found'); end if;
  if s.expires_at<=now() or s.status not in ('offered','open') then return jsonb_build_object('ok',false,'reason','flow_session_inactive'); end if;
  v_current:=coalesce(s.flow_current_screen,''); v_context:=coalesce(s.context,'{}'::jsonb);

  if p_action='INIT' then
    v_snapshot:=public.get_whatsapp_flow_commercial_snapshot_v1(p_conversation_id);
    select coalesce(jsonb_agg(jsonb_build_object('id',e->>'id','title',(e->>'name')||' · R$ '||replace(e->>'price','.',','),'description','Toque para personalizar')),'[]'::jsonb)
      into v_baskets from jsonb_array_elements(coalesce(v_snapshot->'baskets','[]'::jsonb)) e;
    update public.experience_sessions set flow_current_screen='CESTAS',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','CESTAS','data',jsonb_build_object('intro','Escolha uma cesta básica para começar.','baskets',v_baskets)));
  end if;

  if p_action<>'data_exchange' then return jsonb_build_object('ok',false,'reason','flow_action_not_handled'); end if;
  if coalesce(p_screen,'')<>v_current then return jsonb_build_object('ok',false,'reason','flow_transition_invalid','expected_screen',v_current,'received_screen',p_screen); end if;

  if v_current='CESTAS' and v_trigger='basket_selected' then
    begin v_basket_id:=(p_data->>'basket_id')::uuid; exception when others then return jsonb_build_object('ok',false,'reason','invalid_basket_id'); end;
    if not exists(select 1 from public.get_whatsapp_simple_baskets_v1() b where b.id=v_basket_id) then return jsonb_build_object('ok',false,'reason','basket_not_sellable'); end if;
    v_snapshot:=public.build_basket_flow_context_v1(p_conversation_id,v_basket_id);
    update public.experience_sessions set context=v_context||jsonb_build_object('basket_id',v_basket_id),flow_current_screen='PERSONALIZAR',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','PERSONALIZAR','data',jsonb_build_object(
      'basket_name',coalesce(v_snapshot->'basket'->>'name','Cesta selecionada'),
      'basket_price','R$ '||replace(coalesce(v_snapshot->'basket'->>'commercial_price','0'),'.',','),
      'basket_note','Os componentes da cesta não exibem preço individual.',
      'selection_json',coalesce((v_snapshot->'items')::text,'[]'),
      'items_summary',coalesce((select string_agg((x->>'quantity')||'x '||(x->>'name'),E'\n') from jsonb_array_elements(coalesce(v_snapshot->'items','[]'::jsonb)) x),'Confira os itens da cesta.')
    ))));
  end if;

  if v_current='PERSONALIZAR' and v_trigger='basket_customize' then
    select coalesce(jsonb_agg(jsonb_build_object('id',section_key,'title',section_title) order by sort_order,section_title),'[]'::jsonb) into v_sections from public.get_whatsapp_flow_sections_v1();
    update public.experience_sessions set context=v_context||jsonb_build_object('basket_change_notes',left(coalesce(p_data->>'changes',''),1000)),flow_current_screen='SECOES',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','SECOES','data',jsonb_build_object('sections',v_sections,'cart_total','')));
  end if;

  if v_current='SECOES' and v_trigger='section_selected' then
    v_section:=lower(trim(coalesce(p_data->>'section_key','')));
    select coalesce(jsonb_agg(jsonb_build_object('id',term_key,'title',term_title) order by sort_order,term_title),'[]'::jsonb) into v_terms from public.get_whatsapp_flow_search_terms_v1(v_section);
    if jsonb_array_length(v_terms)=0 then return jsonb_build_object('ok',false,'reason','section_not_found'); end if;
    select min(section_title) into v_title from public.whatsapp_flow_search_terms where enabled and section_key=v_section;
    update public.experience_sessions set context=v_context||jsonb_build_object('flow_section_key',v_section),flow_current_screen='TERMOS',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','TERMOS','data',jsonb_build_object('section_title',v_title,'terms',v_terms)));
  end if;

  if v_current='TERMOS' and v_trigger='term_selected' then
    v_section:=coalesce(v_context->>'flow_section_key',''); v_term:=lower(trim(coalesce(p_data->>'term_key','')));
    select search_query,term_title into v_query,v_title from public.whatsapp_flow_search_terms where enabled and section_key=v_section and term_key=v_term;
    if v_query is null then return jsonb_build_object('ok',false,'reason','search_term_not_found'); end if;
    v_results:=public.get_whatsapp_flow_product_results_v1(v_query,12);
    select coalesce(jsonb_agg(jsonb_build_object('id',e->>'id','title',left(e->>'name',70)||' · R$ '||replace(e->>'price','.',','),'description',left(trim(concat_ws(' · ',nullif(e->>'brand',''),nullif(e->>'packaging',''))),90))),'[]'::jsonb)
      into v_options from jsonb_array_elements(coalesce(v_results->'products','[]'::jsonb)) e;
    update public.experience_sessions set context=v_context||jsonb_build_object('flow_query',v_query,'flow_query_title',v_title),flow_current_screen='PRODUTOS',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','PRODUTOS','data',jsonb_build_object('query_title',v_title,'result_note',jsonb_array_length(v_options)::text||' opções disponíveis','products',v_options)));
  end if;

  if v_current='PRODUTOS' and v_trigger='product_selected' then
    begin v_product_id:=(p_data->>'product_id')::uuid; exception when others then return jsonb_build_object('ok',false,'reason','invalid_product_id'); end;
    v_product:=public.get_whatsapp_sellable_product_v1(v_product_id); if v_product is null then return jsonb_build_object('ok',false,'reason','product_not_sellable'); end if;
    update public.experience_sessions set context=v_context||jsonb_build_object('flow_product_id',v_product_id),flow_current_screen='PRODUTO',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','PRODUTO','data',jsonb_build_object('product_name',v_product->>'name','product_price','R$ '||replace(v_product->>'price','.',','),'product_description',trim(concat_ws(' · ',nullif(v_product->>'brand',''),nullif(v_product->>'packaging',''),'Disponível para entrega')),'product_image_url',coalesce(v_product->>'image_url',''),'product_image_base64','','product_id',v_product_id::text,'quantities',jsonb_build_array(jsonb_build_object('id','1','title','1'),jsonb_build_object('id','2','title','2'),jsonb_build_object('id','3','title','3'),jsonb_build_object('id','4','title','4'),jsonb_build_object('id','5','title','5')))));
  end if;

  if v_current='PRODUTO' and v_trigger='add_product' then
    update public.experience_sessions set context=v_context||jsonb_build_object('flow_pending_product',jsonb_build_object('product_id',p_data->>'product_id','quantity',p_data->>'quantity')),flow_current_screen='UPSELL',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    select coalesce(jsonb_agg(jsonb_build_object('id',u.product_id,'title',left(u.name,70)||' · R$ '||replace(u.price::text,'.',','),'description',left(coalesce(u.reason,'Sugestão opcional'),90)) order by u.score desc),'[]'::jsonb)
      into v_options from public.get_cart_aware_recommendations(p_conversation_id,6,'upsell') u;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','UPSELL','data',jsonb_build_object('upsell_note','Sugestões opcionais. Você pode continuar sem adicionar nada.','products',v_options)));
  end if;

  if v_current='UPSELL' and v_trigger='upsell_continue' then
    update public.experience_sessions set context=v_context||jsonb_build_object('flow_pending_upsell_product_id',nullif(p_data->>'product_id','')),flow_current_screen='REVISAO',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','REVISAO','data',jsonb_build_object('summary','Itens selecionados aguardando aplicação segura no carrinho.','total','','pricing_note','A cesta possui preço comercial próprio; componentes não têm preço individual exibido.')));
  end if;

  if v_current='REVISAO' and v_trigger='review_confirm' then
    v_snapshot:=public.get_whatsapp_checkout_contact_v1(p_conversation_id);
    update public.experience_sessions set flow_current_screen='CLIENTE',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','CLIENTE','data',jsonb_build_object('customer_name',coalesce(v_snapshot->>'name',''),'address_summary',public.whatsapp_address_line_v1(v_snapshot->'address'),'customer_registered',coalesce((v_snapshot->>'base_complete')::boolean,false),'payment_options','[]'::jsonb)));
  end if;

  if v_current='CLIENTE' then
    update public.experience_sessions set flow_current_screen='FINALIZAR',flow_state_version=flow_state_version+1,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'response',jsonb_build_object('screen','FINALIZAR','data',jsonb_build_object('final_summary','Pedido preparado para homologação.','final_total','','location_note','Depois de confirmar, volte ao chat e envie sua localização pelo WhatsApp.','write_enabled',false)));
  end if;
  return jsonb_build_object('ok',false,'reason','flow_action_not_handled','expected_screen',v_current,'trigger',v_trigger);
end;
$flow$;

revoke all on function public.handle_whatsapp_flow_commercial_exchange_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.handle_whatsapp_flow_commercial_exchange_v1(uuid,uuid,text,text,jsonb) to service_role;

-- invariantes de segurança desta fase
update public.automation_config set experience_orchestrator_enabled=false,whatsapp_flow_data_exchange_enabled=false,whatsapp_flow_send_enabled=false,bling_order_sync_enabled=false,updated_at=now() where id=1;
commit;
