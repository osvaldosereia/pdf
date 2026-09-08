import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const sql=readFileSync('supabase/security/whatsapp_trigger_rpc_hardening_v1.sql','utf8');
const names=['ai_job_dispatch_trigger_v2','ai_job_human_fallback_trigger_v1','guard_whatsapp_ai_outbound_rate_v1','message_human_intent_trigger_v1'];
const one=async(q)=>{const r=await db.query(q);return r.rows?.[0]||null};
try{
  if(/create\s+(or\s+replace\s+)?function|drop\s+trigger|alter\s+table|\b(update|insert|delete)\b/i.test(sql.replace(/^\s*--.*$/gm,'')))throw new Error('hardening_must_change_privileges_only');
  for(const name of names){
    if(!new RegExp(`revoke all on function public\\.${name}\\(\\) from public, anon, authenticated`,'i').test(sql))throw new Error(`missing_revoke:${name}`);
    if(!new RegExp(`grant execute on function public\\.${name}\\(\\) to service_role`,'i').test(sql))throw new Error(`missing_service_role_grant:${name}`);
  }

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.trigger_fixture(id integer primary key);
    create table public.trigger_audit(fn text not null,id integer not null);
    grant usage on schema public to anon,authenticated,service_role;
    grant insert on public.trigger_fixture to anon,authenticated,service_role;
  `);
  for(const name of names){
    await db.exec(`
      create function public.${name}() returns trigger language plpgsql security definer set search_path='' as $$
      begin insert into public.trigger_audit(fn,id) values('${name}',new.id); return new; end $$;
      create trigger trg_${name} after insert on public.trigger_fixture for each row execute function public.${name}();
    `);
  }

  await db.exec(sql);
  for(const name of names){
    const p=await one(`select
      has_function_privilege('anon','public.${name}()','EXECUTE') anon,
      has_function_privilege('authenticated','public.${name}()','EXECUTE') authenticated,
      has_function_privilege('service_role','public.${name}()','EXECUTE') service`);
    if(p.anon!==false||p.authenticated!==false||p.service!==true)throw new Error(`privilege_contract_failed:${name}:${JSON.stringify(p)}`);
  }

  await db.exec(`set role anon; insert into public.trigger_fixture(id) values(1); reset role;`);
  const audit=await db.query(`select fn,id from public.trigger_audit where id=1 order by fn`);
  if(audit.rows.length!==4)throw new Error(`trigger_execution_broken_after_revoke:${audit.rows.length}`);
  for(const name of names)if(!audit.rows.some(r=>r.fn===name))throw new Error(`trigger_did_not_fire:${name}`);

  console.log('PASS: anon/authenticated lose direct EXECUTE, service_role keeps it, and all four SECURITY DEFINER trigger functions still fire after privilege revocation.');
}finally{await db.close()}
