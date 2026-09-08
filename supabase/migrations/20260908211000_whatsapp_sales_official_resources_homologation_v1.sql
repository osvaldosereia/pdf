begin;

do $$
declare cfg public.automation_config%rowtype;
begin
  select * into cfg from public.automation_config where id=1 for update;
  if not found then raise exception 'automation_config_missing'; end if;
  if cfg.whatsapp_release_mode<>'live' then raise exception 'live_mode_required'; end if;
  if cfg.whatsapp_live_canary_percent>1 then raise exception 'canary_above_authorized_limit'; end if;
  if coalesce(cfg.bling_order_sync_enabled,false) or coalesce(cfg.whatsapp_sales_bling_submit_enabled,false) then
    raise exception 'bling_must_remain_off_during_whatsapp_homologation';
  end if;
  if not coalesce(cfg.whatsapp_sales_mvp_enabled,false) then raise exception 'whatsapp_sales_mvp_required'; end if;

  update public.automation_config
     set whatsapp_sales_images_enabled=true,
         whatsapp_sales_interactive_enabled=true
   where id=1;
end $$;

insert into public.service_guidance_rules(
  rule_key,title,instruction,intent_scope,stage_scope,channel_scope,behavior_tags,status,priority,version_no
)
values
(
  'use_media_only_when_helpful',
  'Mídia somente quando ajuda',
  'Use foto do produto somente quando ela realmente ajuda a identificar, comparar ou confirmar uma escolha. Não envie foto de todos os produtos por padrão. Use somente URL de mídia cadastrada e confiável; nunca invente imagem.',
  '{}','{}',array['whatsapp'],array['media','ux','cost'],'published',100,1
),
(
  'interactive_when_reduces_steps',
  'Lista e botões para reduzir passos',
  'Use lista oficial quando houver múltiplas opções relevantes e botões de resposta quando houver uma escolha curta e clara, especialmente confirmação/revisão. Não use interativo se uma resposta simples resolve mais rápido. Nunca use carrossel neste MVP.',
  '{}','{}',array['whatsapp'],array['interactive','ux','cost'],'published',100,1
)
on conflict(rule_key,version_no) do update
  set instruction=excluded.instruction,status='published',priority=100,updated_at=now();

commit;