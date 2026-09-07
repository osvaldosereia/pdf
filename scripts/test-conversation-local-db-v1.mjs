import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
try {
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await db.exec(readFileSync('scripts/fixtures/conversation-schema-v1.sql','utf8'));
 for(const table of ['automation_config','ai_jobs','messages','conversations','room_media','catalog_sessions','customers','sales_offer_events','carts','products'])await db.exec(`alter table public.${table} add primary key(id);`);
 await db.exec('alter table public.ai_jobs add unique(message_id,job_type);insert into public.automation_config(id) values(1);grant all on all tables in schema public to service_role;');
 // Only the web-session fixture helper is substituted; production queue/completion/consent/pricing functions are executed verbatim.
 await db.exec(`create function public.room_start_web_session() returns jsonb language plpgsql as $$
 declare cid uuid; token text;
 begin insert into public.conversations(whatsapp_account_id) values(gen_random_uuid()) returning id into cid;
 insert into public.catalog_sessions(conversation_id) values(cid) returning public_token into token;
 return jsonb_build_object('token',token);end $$;`);
 const sales=readFileSync('supabase/migrations/20260907162325_cart_aware_sales_recommendation_engine.sql','utf8');
 await db.exec(sales.slice(sales.indexOf('create or replace function public.record_sales_offer_event'),sales.indexOf('create or replace function public.get_cart_aware_recommendations')));
 await db.exec(readFileSync('supabase/migrations/20260907163802_conversation_worker_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260907164342_customer_birthday_preferences_v1.sql','utf8'));
 await db.exec(readFileSync('scripts/test-conversation-db-v1.sql','utf8'));
 // Birthday validation, leap-day, idempotent consent, no false opt-in.
 await db.exec(`do $$ declare room jsonb; customer uuid; begin
 room:=public.room_start_web_session();insert into public.customers(name) values('Fixture') returning id into customer;
 update public.catalog_sessions set customer_id=customer where public_token=room->>'token';
 perform public.room_save_customer_preferences(room->>'token',29,2,null);
 if (select marketing_opt_in from public.customers where id=customer) then raise exception 'implicit_opt_in';end if;
 begin perform public.room_save_customer_preferences(room->>'token',31,2,null);raise exception 'invalid_birthday_accepted';
 exception when others then if sqlerrm<>'Aniversário inválido.' then raise;end if;end;
 perform public.room_save_customer_preferences(room->>'token',null,null,true);
 perform public.room_save_customer_preferences(room->>'token',null,null,true);
 if (select count(*) from public.customer_consent_events where customer_id=customer)<>1 then raise exception 'consent_not_idempotent';end if;
 perform public.room_save_customer_preferences(room->>'token',null,null,false);
 if (select marketing_opt_in from public.customers where id=customer) then raise exception 'opt_out_failed';end if;
 end $$;`);
 console.log('PASS: isolated PostgreSQL migrations, release gate, claim/dedupe/lease, decline, expiry boundaries, birthday and consent.');
} finally {await db.close();}
