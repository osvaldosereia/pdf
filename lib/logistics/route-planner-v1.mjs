const time=v=>{const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0};
const priority=v=>Math.max(0,Math.min(5,Number(v)||0));

export function buildDraftRoutePlan(jobs,{vehicle=null,driver=null,maxStops=null}={}){
  const rows=(Array.isArray(jobs)?jobs:[]).map(j=>({...j,priority:priority(j.priority)}));
  if(!rows.length)return {ok:false,status:'empty',reason:'no_jobs',side_effect_performed:false};
  const invalid=rows.filter(j=>!['waiting_route','planned'].includes(j.status));
  if(invalid.length)return {ok:false,status:'review_required',reason:'job_status_not_routable',job_ids:invalid.map(x=>x.id),side_effect_performed:false};
  const missingCoordinates=rows.filter(j=>!Number.isFinite(Number(j.latitude))||!Number.isFinite(Number(j.longitude))||j.geocode_status==='required');
  if(missingCoordinates.length)return {ok:false,status:'review_required',reason:'coordinates_required',job_ids:missingCoordinates.map(x=>x.id),side_effect_performed:false};
  const capacity=Math.max(1,Number(maxStops||vehicle?.max_stops||rows.length));
  if(rows.length>capacity)return {ok:false,status:'review_required',reason:'vehicle_capacity_exceeded',capacity,requested:rows.length,side_effect_performed:false};
  // Sem provider externo, a ordem preliminar usa apenas fatos determinísticos de negócio.
  // Ela NÃO afirma ser uma rota geograficamente otimizada.
  const ordered=[...rows].sort((a,b)=>priority(b.priority)-priority(a.priority)||time(a.delivery_window_start)-time(b.delivery_window_start)||time(a.ready_at)-time(b.ready_at)||String(a.id).localeCompare(String(b.id)));
  return {ok:true,status:'draft',geographically_optimized:false,requires_provider_optimization:true,driver:driver?{id:driver.id}:null,vehicle:vehicle?{id:vehicle.id}:null,stops:ordered.map((j,index)=>({sequence_no:index+1,delivery_job_id:j.id,latitude:Number(j.latitude),longitude:Number(j.longitude),priority:j.priority,window_start:j.delivery_window_start||null,window_end:j.delivery_window_end||null,locked:false})),side_effect_performed:false};
}

export async function optimizeDraftRoute(provider,draft){
  if(!draft?.ok)return draft;
  const response=await provider.optimizeRoutes({route_id:draft.route_id||null,stops:draft.stops,vehicle:draft.vehicle,driver:draft.driver});
  if(!response?.ok)return {...draft,status:'held',provider_result:response,geographically_optimized:false,side_effect_performed:false};
  return {...draft,status:'optimized',provider_result:response,geographically_optimized:true,side_effect_performed:false};
}

export function applyLockedNextInvariant(currentStops,proposedStops){
  const current=Array.isArray(currentStops)?currentStops:[],proposed=Array.isArray(proposedStops)?proposedStops:[];
  const locked=new Map(current.filter(s=>s.locked||s.status==='locked_next'||s.status==='active').map(s=>[s.id,s.sequence_no]));
  for(const s of proposed){if(locked.has(s.id)&&Number(s.sequence_no)!==Number(locked.get(s.id)))return {ok:false,reason:'locked_stop_moved',stop_id:s.id,side_effect_performed:false};}
  return {ok:true,side_effect_performed:false};
}
