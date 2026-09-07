begin;

alter table public.room_media
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.room_media.metadata is
  'Metadados server-only de proveniencia/processamento da midia. Nunca expor tokens ou credenciais.';

commit;
