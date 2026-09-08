import {CAPABILITY_REGISTRY} from './channel-runtime-v1.mjs';

const CHANNELS=['whatsapp','web','instagram','messenger'];
const EXPERIENCE_TO_CAPABILITY={
  conversation:'text',deterministic:'text',carousel:'carousel',whatsapp_flow:'flow',shopping_room:'shopping_room',human:'human'
};

export const DEFAULT_SESSION_BUDGET=Object.freeze({max_experiences:6,max_flow_exchanges:40,max_carousels:4,max_room_handoffs:2});

export function channelCapabilities(channel){
  const c=CHANNELS.includes(channel)?channel:'web';
  return {...CAPABILITY_REGISTRY[c],shopping_room:true,human:true};
}

export function capabilityAllows(channel,experience){
  const cap=channelCapabilities(channel);
  const key=EXPERIENCE_TO_CAPABILITY[experience];
  return Boolean(key&&cap[key]);
}

export function chooseChannelAwareExperience({channel='web',preferred='conversation',fallbacks=['conversation','human'],humanRequired=false,budget={},usage={}}={}){
  if(humanRequired) return {action:'human',reason:'human_required',side_effects:false};
  const limits={...DEFAULT_SESSION_BUDGET,...budget};
  const used={experiences:0,flow_exchanges:0,carousels:0,room_handoffs:0,...usage};
  if(used.experiences>=limits.max_experiences) return {action:'human',reason:'experience_budget_exhausted',side_effects:false};
  const candidates=[preferred,...fallbacks.filter(x=>x!==preferred)];
  for(const action of candidates){
    if(!capabilityAllows(channel,action)) continue;
    if(action==='whatsapp_flow'&&used.flow_exchanges>=limits.max_flow_exchanges) continue;
    if(action==='carousel'&&used.carousels>=limits.max_carousels) continue;
    if(action==='shopping_room'&&used.room_handoffs>=limits.max_room_handoffs) continue;
    return {action,reason:action===preferred?'preferred_capability_available':'capability_fallback',side_effects:false};
  }
  return {action:'human',reason:'no_safe_capability',side_effects:false};
}
