begin;

-- The preview function qualifies the table side as r.benefit_year and uses the
-- PL/pgSQL variable on the right side. Explicit conflict mode makes that intent
-- deterministic and avoids a column/variable ambiguity at first execution.
alter function public.preview_customer_benefit_v1(uuid,uuid,date,date,bigint,bigint)
  set plpgsql.variable_conflict = 'use_variable';

commit;
