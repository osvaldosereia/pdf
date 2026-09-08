import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const text=(v:unknown,m=120)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,m);
const key=(v:unknown)=>text(v,120).toLocaleLowerCase("pt-BR");
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
 const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!serviceKey)return json({ok:false,error:"server_config"},500);
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return json({ok:false,error:"unauthorized"},401);
 const sb=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});const {data:ud}=await sb.auth.getUser(token);if(!ud?.user?.id)return json({ok:false,error:"unauthorized"},401);const user=ud.user;
 const {data:admin}=await sb.from("admin_users").select("role,is_active").eq("user_id",user.id).maybeSingle();if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);const canWrite=admin.role==="owner"||admin.role==="operator";
 let body:any;try{body=await req.json()}catch{body={}}const action=text(body?.action||"list",40).toLowerCase();
 if(action==="list"){
   const [{data:existing,error:existingError},{data:productRows,error:productError}]=await Promise.all([
     sb.from("product_categories").select("id,name"),
     sb.from("products").select("category").not("category","is",null)
   ]);
   if(existingError||productError)return json({ok:false,error:"categories_failed",detail:(existingError||productError)?.message||"Falha ao carregar categorias."},400);
   const known=new Set((existing||[]).map((row:any)=>key(row.name)).filter(Boolean));
   const incoming=[...new Set((productRows||[]).map((row:any)=>text(row.category)).filter(Boolean))].filter(name=>!known.has(key(name)));
   if(incoming.length){
     for(const name of incoming){const {error}=await sb.from("product_categories").insert({name,created_by:user.id,updated_by:user.id});if(error&&error.code!=="23505")return json({ok:false,error:"category_sync_failed",detail:error.message},400)}
   }
   const {data,error}=await sb.from("admin_product_categories").select("id,name,product_count,created_at,updated_at").order("name");if(error)return json({ok:false,error:"categories_failed",detail:error.message},400);return json({ok:true,categories:data||[]});
 }
 if(!canWrite)return json({ok:false,error:"read_only"},403);
 if(action==="create"){const name=text(body?.name);if(!name)return json({ok:false,error:"category_name_required"},400);const {data,error}=await sb.from("product_categories").insert({name,created_by:user.id,updated_by:user.id}).select("id,name,created_at,updated_at").single();if(error)return json({ok:false,error:error.code==="23505"?"category_exists":"category_create_failed",detail:error.code==="23505"?"Essa categoria já existe.":error.message},error.code==="23505"?409:400);return json({ok:true,category:data});}
 if(action==="rename"){const id=text(body?.id,80),name=text(body?.name);if(!id||!name)return json({ok:false,error:"category_data_required"},400);const {data,error}=await sb.rpc("rename_product_category",{p_category_id:id,p_new_name:name,p_user_id:user.id});if(error)return json({ok:false,error:error.message.includes("category_exists")?"category_exists":error.message.includes("category_not_found")?"category_not_found":"category_rename_failed",detail:error.message},error.message.includes("category_exists")?409:error.message.includes("category_not_found")?404:400);return json({ok:true,result:data});}
 if(action==="delete"){const id=text(body?.id,80);if(!id)return json({ok:false,error:"category_id_required"},400);const {data,error}=await sb.rpc("delete_product_category",{p_category_id:id});if(error){const used=error.message.includes("category_in_use");return json({ok:false,error:used?"category_in_use":error.message.includes("category_not_found")?"category_not_found":"category_delete_failed",detail:used?`Essa categoria ainda está em ${Number.parseInt(error.details||"0",10)||0} produto(s). Reclassifique-os antes de excluir.`:error.message},used?409:error.message.includes("category_not_found")?404:400)}return json({ok:true,result:data});}
 return json({ok:false,error:"unknown_action"},400);
});
