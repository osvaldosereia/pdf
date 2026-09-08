const clean=v=>String(v??'').trim();
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const coord=(lat,lng)=>{const a=finite(lat),b=finite(lng);if(a===null||b===null||a< -90||a>90||b< -180||b>180)throw new Error('invalid_coordinates');return {latitude:a,longitude:b};};

export const ROUTING_OPERATIONS=Object.freeze(['optimize_routes','compute_eta','geocode']);

export function buildRoutingRequest(operation,input={}){
  if(!ROUTING_OPERATIONS.includes(operation))throw new Error('unsupported_routing_operation');
  if(operation==='compute_eta'){
    return Object.freeze({operation,origin:coord(input.origin?.latitude,input.origin?.longitude),destination:coord(input.destination?.latitude,input.destination?.longitude),departure_time:clean(input.departure_time)||null});
  }
  if(operation==='geocode'){
    const address=clean(input.address);if(address.length<6)throw new Error('invalid_address');
    return Object.freeze({operation,address});
  }
  const stops=Array.isArray(input.stops)?input.stops:[];
  if(!stops.length)throw new Error('routing_stops_required');
  return Object.freeze({operation,route_id:clean(input.route_id)||null,stops:stops.map((s,index)=>Object.freeze({id:clean(s.id)||String(index+1),...coord(s.latitude,s.longitude),priority:Math.max(0,Math.min(5,Number(s.priority)||0)),window_start:clean(s.window_start)||null,window_end:clean(s.window_end)||null,locked:Boolean(s.locked)})),vehicle:input.vehicle??null,driver:input.driver??null});
}

export function estimateRoutingCost(operation,policy={}){
  const key=operation==='optimize_routes'?'optimization_cost_brl':operation==='compute_eta'?'eta_cost_brl':'geocode_cost_brl';
  const value=Math.max(0,Number(policy?.[key])||0);
  return Number(value.toFixed(6));
}

export class NullRoutingProvider{
  constructor(){this.name='none';}
  async optimizeRoutes(input){return this.#held('optimize_routes',input);}
  async computeEta(input){return this.#held('compute_eta',input);}
  async geocode(input){return this.#held('geocode',input);}
  #held(operation,input){return Object.freeze({ok:false,status:'held',provider:this.name,operation,reason:'external_provider_not_released',external_call_performed:false,input:buildRoutingRequest(operation,input)});}
}

export class GoogleRoutingProviderDormant{
  constructor(){this.name='google_maps';}
  async optimizeRoutes(){throw new Error('google_maps_provider_not_released');}
  async computeEta(){throw new Error('google_maps_provider_not_released');}
  async geocode(){throw new Error('google_maps_provider_not_released');}
}

export function chooseRoutingProvider(config={}){
  const enabled=Boolean(config.enabled)&&Boolean(config.external_provider_enabled)&&['homologation','canary','live'].includes(clean(config.execution_mode));
  if(!enabled)return new NullRoutingProvider();
  // O adapter Google real só poderá substituir esta classe após autorização externa,
  // budget configurado, secrets e homologação. Nesta etapa não há fetch/API call.
  if(clean(config.provider_name)==='google_maps')return new GoogleRoutingProviderDormant();
  return new NullRoutingProvider();
}

export function canComputeApproachingEta({routeStatus,gpsCapturedAt,now=new Date(),minimumGpsFreshnessSeconds=120}={}){
  if(routeStatus!=='active'||!gpsCapturedAt)return {ok:false,reason:'route_or_gps_unavailable'};
  const age=(new Date(now).getTime()-new Date(gpsCapturedAt).getTime())/1000;
  if(!Number.isFinite(age)||age<0||age>Number(minimumGpsFreshnessSeconds))return {ok:false,reason:'gps_stale'};
  return {ok:true,gps_age_seconds:Math.floor(age)};
}

export function shouldNotifyApproaching({etaSeconds,etaConfidence,alreadySent=false,thresholdSeconds=180,minimumConfidence=.8}={}){
  if(alreadySent)return {ok:false,reason:'already_sent'};
  const eta=finite(etaSeconds),confidence=finite(etaConfidence);
  if(eta===null||confidence===null)return {ok:false,reason:'eta_unavailable'};
  if(confidence<Number(minimumConfidence))return {ok:false,reason:'eta_low_confidence'};
  if(eta<0||eta>Number(thresholdSeconds))return {ok:false,reason:'outside_threshold'};
  return {ok:true};
}
