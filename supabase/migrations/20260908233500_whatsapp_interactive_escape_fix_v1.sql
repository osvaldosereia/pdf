do $fix$
declare
  v_def text;
  v_bad text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ingest_whatsapp_message'
  limit 1;

  select m[1] into v_bad
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  cross join lateral regexp_matches(p.prosrc,'([^\n]*v_interactive_id like[^\n]*escape[^\n]*)','g') m
  where n.nspname='public' and p.proname='ingest_whatsapp_message'
  limit 1;

  if v_def is null then raise exception 'ingest_whatsapp_message_not_found'; end if;
  if v_bad is null then raise exception 'interactive_escape_line_not_found'; end if;

  v_def:=replace(v_def,v_bad,'     and left(v_interactive_id,3)=''da_'' then');
  execute v_def;
end
$fix$;
