begin;

-- Dona Antônia / WhatsApp Cost-First Router v1
-- Objetivo: resolver o que for previsível com programação, preservar IA para
-- interpretação/ambiguidade e manter o rollout fail-closed até ativação explícita.

alter table public.automation_config
  add column if not exists whatsapp_cost_first_router_enabled boolean not null default false,
  add column if not exists whatsapp_cost_first_shadow_mode boolean not null default true;

alter table public.service_intelligence_runtime_config
  add column if not exists trigger_engine_enabled boolean not null default false,
  add column if not exists dynamic_selection_enabled boolean not null default false,
  add column if not exists max_core_guidance_items smallint not null default 10,
  add column if not exists max_dynamic_guidance_items smallint not null default 8,
  add column if not exists max_dynamic_knowledge_items smallint not null default 8,
  add column if not exists max_dynamic_procedure_items smallint not null default 4;

alter table public.service_procedures
  add column if not exists intent_scope text[] not null default '{}',
  add column if not exists stage_scope text[] not null default '{}';

create table if not exists public.service_message_blocks (
  id uuid primary key default gen_random_uuid(),
  block_key text not null unique,
  title text not null,
  body_template text not null,
  delivery_mode text not null default 'text' check (delivery_mode in ('text','image','interactive')),
  image_url_template text,
  interactive_template jsonb,
  variables text[] not null default '{}',
  channel_scope text[] not null default array['whatsapp']::text[],
  status text not null default 'draft' check (status in ('draft','published','archived')),
  priority smallint not null default 50 check (priority between 0 and 100),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_message_blocks_pub_idx
  on public.service_message_blocks(priority desc,updated_at desc)
  where status='published';

create table if not exists public.service_trigger_rules (
  id uuid primary key default gen_random_uuid(),
  trigger_key text not null unique,
  title text not null,
  event_type text not null default 'inbound_message',
  match_mode text not null default 'contains' check (match_mode in ('exact','contains','regex','stage','always')),
  patterns text[] not null default '{}',
  intent_scope text[] not null default '{}',
  stage_scope text[] not null default '{}',
  channel_scope text[] not null default array['whatsapp']::text[],
  action_type text not null default 'send_block',
  message_block_key text references public.service_message_blocks(block_key) on update cascade on delete set null,
  action_payload jsonb not null default '{}'::jsonb,
  priority smallint not null default 50 check (priority between 0 and 100),
  stop_on_match boolean not null default true,
  once_per_conversation boolean not null default false,
  cooldown_seconds integer not null default 0 check (cooldown_seconds between 0 and 2592000),
  requires_ai_mode boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_trigger_rules_pub_idx
  on public.service_trigger_rules(priority desc,updated_at desc)
  where status='published';

create table if not exists public.service_trigger_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  trigger_id uuid references public.service_trigger_rules(id) on delete set null,
  trigger_key text,
  action_type text not null,
  execution_mode text not null default 'deterministic' check (execution_mode in ('deterministic','shadow','fallback_ai')),
  result jsonb not null default '{}'::jsonb,
  estimated_ai_calls_saved numeric not null default 0,
  estimated_input_tokens_avoided integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists service_trigger_events_conv_idx
  on public.service_trigger_events(conversation_id,created_at desc);
create index if not exists service_trigger_events_trigger_idx
  on public.service_trigger_events(trigger_key,created_at desc);

create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  normalized_alias text not null unique,
  canonical_query text,
  product_id uuid references public.products(id) on delete cascade,
  priority smallint not null default 50 check (priority between 0 and 100),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  source_note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (product_id is not null or nullif(trim(coalesce(canonical_query,'')),'') is not null)
);
create index if not exists product_aliases_pub_idx
  on public.product_aliases(priority desc,updated_at desc)
  where status='published';

-- Server-only: Admin usa Edge Function autenticada; workers usam service_role.
do $$ declare t text; begin
  foreach t in array array['service_message_blocks','service_trigger_rules','service_trigger_events','product_aliases'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on table public.%I to service_role',t);
  end loop;
end $$;

commit;
