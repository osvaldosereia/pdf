import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg=window.DA_DRIVER_CONFIG||{};
const $=s=>document.querySelector(s);
const disabled=$('#disabledView'),app=$('#app'),loginPanel=$('#loginPanel'),routePanel=$('#routePanel'),stopsEl=$('#stops');
const state={sb:null,session:null,snapshot:null,queue:JSON.parse(localStorage.getItem('da_driver_queue_v1')||'[]'),gpsWatch:null};
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const saveQueue=()=>{localStorage.setItem('da_driver_queue_v1',JSON.stringify(state.queue));renderQueue()};
const renderQueue=()=>{$('#queueCount').textContent=`${state.queue.length} pendência${state.queue.length===1?'':'s'} offline`;$('#syncFooter').classList.toggle('hidden',!state.session)};
const status=(el,msg)=>{el.textContent=msg||''};
const edgeUrl=()=>`${cfg.supabaseUrl}/functions/v1/${cfg.edgeFunction}`;

async function edge(payload){
  const token=state.session?.access_token;if(!token)throw new Error('not_authenticated');
  const res=await fetch(edgeUrl(),{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,'apikey':cfg.supabasePublishableKey},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({ok:false,error:'invalid_response'}));
  if(!res.ok||data?.ok===false)throw new Error(data?.error||`http_${res.status}`);
  return data;
}

async function dispatchOrQueue(payload){
  payload.client_event_id=payload.client_event_id||`driver:${uid()}`;
  if(!navigator.onLine){state.queue.push(payload);saveQueue();return {queued:true};}
  try{return await edge(payload)}catch(err){
    if(String(err?.message||'').includes('Failed to fetch')){state.queue.push(payload);saveQueue();return {queued:true};}
    throw err;
  }
}

async function syncQueue(){
  if(!navigator.onLine||!state.session||!state.queue.length)return;
  const pending=[...state.queue],kept=[];
  for(const item of pending){try{await edge(item)}catch(err){if(String(err?.message||'').includes('Failed to fetch'))kept.push(item);else console.warn('offline action rejected',item.action,err)}}
  state.queue=kept;saveQueue();await loadRoute();
}

function renderRoute(){
  const snap=state.snapshot?.snapshot||state.snapshot;
  if(!snap?.ok){$('#routeCode').textContent='Sem rota';$('#routeSummary').textContent='Nenhuma rota publicada ou ativa para você.';stopsEl.innerHTML='<div class="card empty">Aguardando rota.</div>';$('#startRouteBtn').classList.add('hidden');return;}
  $('#driverName').textContent=snap.driver?.display_name||'Entregador';
  $('#routeCode').textContent=snap.route?.route_code||'Rota';
  const arr=Array.isArray(snap.stops)?snap.stops:[];
  const done=arr.filter(x=>['delivered','skipped','rescheduled'].includes(x.status)).length;
  $('#routeSummary').textContent=`${done}/${arr.length} paradas concluídas · ${snap.route?.status||''}`;
  $('#startRouteBtn').classList.toggle('hidden',snap.route?.status!=='published');
  $('#startRouteBtn').onclick=async()=>{try{await dispatchOrQueue({action:'start_route',route_id:snap.route.id});await loadRoute();startGps()}catch(e){alert(`Não foi possível iniciar: ${e.message}`)}};
  stopsEl.innerHTML='';
  for(const stop of arr){
    const card=document.createElement('section');card.className=`card stop stop-${stop.status}`;
    const address=[stop.address?.street||stop.address?.logradouro,stop.address?.number||stop.address?.numero,stop.address?.neighborhood||stop.address?.bairro,stop.address?.city||stop.address?.cidade].filter(Boolean).join(', ')||'Endereço não informado';
    card.innerHTML=`<div class="stop-top"><span class="seq">${stop.sequence_no}</span><div><strong>${address}</strong><small>${stop.reference||''}</small></div><span class="pill">${stop.status}</span></div><div class="stop-meta"><span>${stop.volumes||1} volume(s)</span><span>Receber R$ ${Number(stop.amount_due||0).toFixed(2)}</span></div><div class="actions"></div>`;
    const actions=card.querySelector('.actions');
    if(['planned','locked_next','active'].includes(stop.status))actions.append(button('Cheguei',()=>act('arrived',stop.id)));
    if(stop.status==='arrived'){actions.append(button('Entreguei',()=>act('delivered',stop.id),true));actions.append(button('Não consegui',()=>fail(stop.id)))}
    if(stop.latitude!=null&&stop.longitude!=null)actions.append(button('Abrir navegação',()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${stop.latitude},${stop.longitude}`)}`,'_blank')));
    stopsEl.append(card);
  }
}

const button=(label,fn,primary=false)=>{const b=document.createElement('button');b.textContent=label;if(primary)b.classList.add('primary');b.onclick=fn;return b};
async function act(action,stopId){try{await dispatchOrQueue({action,stop_id:stopId,proof:action==='delivered'?{method:'driver_confirmation'}:undefined});await loadRoute()}catch(e){alert(`Ação não concluída: ${e.message}`)}}
async function fail(stopId){const incident=prompt('Motivo: customer_absent, address_issue, payment_issue, vehicle_issue, delay, damage, safety ou other','customer_absent')||'other';const notes=prompt('Observação curta (opcional)','')||'';try{await dispatchOrQueue({action:'failed',stop_id:stopId,incident_type:incident,notes});await loadRoute()}catch(e){alert(`Falha ao registrar ocorrência: ${e.message}`)}}

async function loadRoute(){if(!state.session)return;try{state.snapshot=await edge({action:'route'});renderRoute()}catch(e){if(e.message==='driver_runtime_disabled'){routePanel.classList.add('hidden');disabled.classList.remove('hidden')}else status($('#loginStatus'),`Erro: ${e.message}`)}}

function stopGps(){if(state.gpsWatch!=null){navigator.geolocation?.clearWatch(state.gpsWatch);state.gpsWatch=null}}
function startGps(){
  const snap=state.snapshot?.snapshot||state.snapshot;if(!cfg.enabled||snap?.route?.status!=='active'||!navigator.geolocation)return;
  stopGps();let last=0;
  state.gpsWatch=navigator.geolocation.watchPosition(async pos=>{
    if(Date.now()-last<Number(cfg.gpsIntervalSeconds||30)*1000)return;last=Date.now();
    try{await dispatchOrQueue({action:'location',route_id:snap.route.id,latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy_m:pos.coords.accuracy,captured_at:new Date(pos.timestamp).toISOString()})}catch(e){console.warn('gps rejected',e.message)}
  },err=>console.warn('gps unavailable',err.message),{enableHighAccuracy:true,maximumAge:15000,timeout:15000});
}

async function login(){status($('#loginStatus'),'Entrando…');const {data,error}=await state.sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error){status($('#loginStatus'),error.message);return}state.session=data.session;loginPanel.classList.add('hidden');routePanel.classList.remove('hidden');await loadRoute();renderQueue();startGps()}

async function boot(){
  if(!cfg.enabled){disabled.classList.remove('hidden');app.classList.add('hidden');return;}
  disabled.classList.add('hidden');app.classList.remove('hidden');state.sb=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
  const {data}=await state.sb.auth.getSession();state.session=data.session;if(state.session){loginPanel.classList.add('hidden');routePanel.classList.remove('hidden');await loadRoute();startGps()}
  $('#loginBtn').onclick=login;$('#syncBtn').onclick=syncQueue;window.addEventListener('online',()=>{updateNetwork();syncQueue()});window.addEventListener('offline',updateNetwork);updateNetwork();renderQueue();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
function updateNetwork(){$('#networkState').textContent=navigator.onLine?'online':'offline';$('#networkState').classList.toggle('offline',!navigator.onLine)}
boot();
