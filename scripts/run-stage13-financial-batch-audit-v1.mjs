const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const limit=Math.max(1,Math.min(500,Number(process.env.FINANCIAL_AUDIT_LIMIT||100)||100));

if(!url||!key){
  console.log(JSON.stringify({ok:true,skipped:true,reason:'supabase_audit_credentials_missing',external_side_effect:false},null,2));
  process.exit(0);
}

async function rpc(name,args={}){
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{
    method:'POST',
    headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','Cache-Control':'no-store'},
    body:JSON.stringify(args),
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`${name}:${r.status}:${data?.message||data?.error||'request_failed'}`);
  return data;
}

const readiness=await rpc('financial_stage13_readiness_v1');
const reconciliation=await rpc('preview_financial_reconciliation_batch_v1',{p_limit:limit});
const projection=await rpc('preview_financial_projection_batch_v1',{p_limit:limit});

const result={
  ok:true,
  generated_at:new Date().toISOString(),
  readiness,
  reconciliation,
  projection,
  external_side_effect:false,
};

const serialized=JSON.stringify(result);
if(/"external_side_effect"\s*:\s*true/i.test(serialized))throw new Error('unexpected_external_side_effect');
console.log(JSON.stringify(result,null,2));
