import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg=window.DA_DRIVER_CONFIG||{};
const $=s=>document.querySelector(s);
const disabled=$('#disabledView'),app=$('#app'),loginPanel=$('#loginPanel'),routePanel=$('#routePanel'),stopsEl=$('#stops');
const state={sb:null,session:null,snapshot:null,queue:JSON.parse(localStorage.getItem('da_driver_queue_v1')||'[]'),gpsWatch:null,collectionStop:null};
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const saveQueue=()=>{localStorage.setItem('da_driver_queue_v1',JSON.stringify(state.queue));renderQueue()};
const renderQueue=()=>{$('#queueCount').textContent=`${state.queue.length} pendência${state.queue.length===1?'':'s'} offline`;$('#syncFooter').classList.toggle('hidden',!state.session)};
const status=(el,msg)=>{el.textContent=msg||''};
const edgeUrl=()=>`${cfg.supabaseUrl}/functions/v1/${cfg.edgeFunction}`;
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money=cents=>brl.format(Number(cents||0)/100);
const methodLabel=m=>({cash:'Dinheiro',pix:'Pix',card:'Cartão',payment_link:'Link de pagamento',prepaid_pix:'Pix antecipado',prepaid_link:'Link antecipado',other:'Outro'}[m]||'Não informado');
const reasonLabel=r=>({payment_expectation_missing:'Forma de recebimento não definida',prepayment_incomplete_at_route:'Pagamento antecipado ainda não confirmado',unresolved_payment_observation:'Existe pagamento aguardando conciliação',order_overpaid:'Valor recebido acima do pedido',expected_payment_method_missing:'Forma de pagamento ausente',payment_expectation_review_required:'Expectativa financeira em revisão'}[r]||String(r||'Revisão financeira necessária'));

async function edge(payload){
  const token=state.session?.access_token;if(!token)throw new Error('not_authenticated');
  const res=await fetch(edgeUrl(),{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,'apikey':cfg.supabasePublishableKey},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({ok:false,error:'invalid_response'}));
  if(!res.ok||data?.ok===false){const err=new Error(data?.error||`http_${res.status}`);err.data=data;throw err}
  return data;
}

async function dispatchOrQueue(payload){
  payload.client_event_id=payload.client_event_id||`driver:${uid()}`;
  if(!navigator.onLine){state.queue.push(payload);saveQueue();return {queued:true}}
  try{return await edge(payload)}catch(err){
    if(String(err?.message||'').includes('Failed to fetch')){state.queue.push(payload);saveQueue();return {queued:true}}
    throw err;
  }
}

async function syncQueue(){
  if(!navigator.onLine||!state.session||!state.queue.length)return;
  const pending=[...state.queue],kept=[];
  for(const item of pending){try{await edge(item)}catch(err){if(String(err?.message||'').includes('Failed to fetch'))kept.push(item);else console.warn('offline action rejected',item.action,err)}}
  state.queue=kept;saveQueue();await loadRoute();
}

function showNotice(msg,kind='info'){
  const el=$('#notice');el.textContent=msg||'';el.classList.toggle('hidden',!msg);el.classList.toggle('danger-text',kind==='danger');
}

function financialCard(stop){
  const f=stop.financial;if(!f?.ok)return '';
  if(f.decision==='covered')return `<div class="money-card covered"><div class="money-line"><div><strong>Pedido já pago</strong><small>Não cobrar novamente.</small></div><span class="money-value">${money(0)}</span></div><span class="money-badge">Já pago</span></div>`;
  if(f.decision==='collect'){
    const change=Number(f.change_required_cents||0);
    return `<div class="money-card collect"><div class="money-line"><div><strong>Cobrar na entrega</strong><small>${methodLabel(f.expected_method)}</small></div><span class="money-value">${money(f.remaining_due_cents)}</span></div>${change>0?`<small>Cliente informou ${money(f.tender_amount_cents)} · preparar troco de <b>${money(change)}</b></small>`:''}<span class="money-badge">Cobrar</span></div>`;
  }
  return `<div class="money-card review"><strong>Revisar antes de entregar</strong><small>${reasonLabel(f.reason)}</small><span class="money-badge">Revisão</span></div>`;
}

function renderCollectionSummary(snap){
  const el=$('#collectionSummary'),sum=snap.collection_summary;
  if(!sum?.enabled){el.classList.add('hidden');return}
  const parts=[`${sum.collect_order_count||0} pedido(s) a cobrar`,money(sum.collect_due_cents||0)];
  if(Number(sum.change_required_cents||0)>0)parts.push(`troco ${money(sum.change_required_cents)}`);
  if(Number(sum.review_order_count||0)>0)parts.push(`${sum.review_order_count} em revisão`);
  el.textContent=parts.join(' · ');el.classList.remove('hidden');
}

function renderRoute(){
  const snap=state.snapshot?.snapshot||state.snapshot;
  if(!snap?.ok){$('#routeCode').textContent='Sem rota';$('#routeSummary').textContent='Nenhuma rota publicada ou ativa para você.';stopsEl.innerHTML='<div class="card empty">Aguardando rota.</div>';$('#startRouteBtn').classList.add('hidden');$('#collectionSummary').classList.add('hidden');return}
  $('#driverName').textContent=snap.driver?.display_name||'Entregador';
  $('#routeCode').textContent=snap.route?.route_code||'Rota';
  const arr=Array.isArray(snap.stops)?snap.stops:[];
  const done=arr.filter(x=>['delivered','skipped','rescheduled'].includes(x.status)).length;
  $('#routeSummary').textContent=`${done}/${arr.length} paradas concluídas · ${snap.route?.status||''}`;
  renderCollectionSummary(snap);
  if(Number(snap.collection_summary?.review_order_count||0)>0)showNotice('Há pedido(s) com pendência financeira. Eles precisam de revisão antes da confirmação de entrega.','danger');else showNotice('');
  $('#startRouteBtn').classList.toggle('hidden',snap.route?.status!=='published');
  $('#startRouteBtn').onclick=async()=>{try{await dispatchOrQueue({action:'start_route',route_id:snap.route.id});await loadRoute();startGps()}catch(e){alert(`Não foi possível iniciar: ${e.message}`)}};
  stopsEl.innerHTML='';
  for(const stop of arr){
    const card=document.createElement('section');card.className=`card stop stop-${stop.status}`;
    const address=[stop.address?.street||stop.address?.logradouro,stop.address?.number||stop.address?.numero,stop.address?.neighborhood||stop.address?.bairro,stop.address?.city||stop.address?.cidade].filter(Boolean).join(', ')||'Endereço não informado';
    const legacyDue=stop.financial?.ok?Number(stop.financial.remaining_due_cents||0)/100:Number(stop.amount_due||0);
    card.innerHTML=`<div class="stop-top"><span class="seq">${stop.sequence_no}</span><div><strong>${address}</strong><small>${stop.reference||''}</small></div><span class="pill">${stop.status}</span></div><div class="stop-meta"><span>${stop.volumes||1} volume(s)</span><span>${stop.financial?.ok?'Saldo '+money(stop.financial.remaining_due_cents):'Receber R$ '+legacyDue.toFixed(2)}</span></div>${financialCard(stop)}<div class="actions"></div>`;
    const actions=card.querySelector('.actions');
    if(['planned','locked_next','active'].includes(stop.status))actions.append(button('Cheguei',()=>act('arrived',stop.id)));
    if(stop.status==='arrived'){
      const f=stop.financial;
      if(snap.financial_context?.enabled&&f?.ok){
        if(f.decision==='covered')actions.append(button('Entreguei',()=>deliverCovered(stop),true));
        else if(f.decision==='collect')actions.append(button('Receber e entregar',()=>openCollection(stop),true));
        else actions.append(button('Pendência financeira',()=>alert(reasonLabel(f.reason))));
      }else actions.append(button('Entreguei',()=>deliverCovered(stop),true));
      actions.append(button('Não consegui',()=>fail(stop.id)));
    }
    if(stop.latitude!=null&&stop.longitude!=null)actions.append(button('Abrir navegação',()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${stop.latitude},${stop.longitude}`)}`,'_blank')));
    stopsEl.append(card);
  }
}

const button=(label,fn,primary=false)=>{const b=document.createElement('button');b.textContent=label;if(primary)b.classList.add('primary');b.onclick=fn;return b};
async function act(action,stopId,extra={}){try{const result=await dispatchOrQueue({action,stop_id:stopId,...extra});if(result?.queued)showNotice('Ação salva offline. Ela será validada pelo servidor quando a conexão voltar.');else await loadRoute();return result}catch(e){const detail=e?.data?.financial?.reason?` · ${reasonLabel(e.data.financial.reason)}`:'';alert(`Ação não concluída: ${e.message}${detail}`);throw e}}
async function deliverCovered(stop){try{const result=await act('delivered',stop.id,{proof:{method:'driver_confirmation'}});if(result?.queued)showNotice('Entrega salva offline; nenhuma confirmação financeira foi antecipada.');else showNotice('Entrega registrada. O financeiro permanece separado da confirmação fiscal.')}catch{}}
async function fail(stopId){const incident=prompt('Motivo: customer_absent, address_issue, payment_issue, vehicle_issue, delay, damage, safety ou other','customer_absent')||'other';const notes=prompt('Observação curta (opcional)','')||'';try{await dispatchOrQueue({action:'failed',stop_id:stopId,incident_type:incident,notes});await loadRoute()}catch(e){alert(`Falha ao registrar ocorrência: ${e.message}`)}}

function parseMoneyInput(v){const normalized=String(v||'').trim().replace(',','.');const n=Number(normalized);return Number.isFinite(n)&&n>=0?Math.round(n*100):null}
function refreshChange(){
  const stop=state.collectionStop,f=stop?.financial,method=$('#collectionMethod').value,isCash=method==='cash';
  $('#cashTenderLabel').classList.toggle('hidden',!isCash);
  const due=Number(f?.remaining_due_cents||0),tender=isCash?parseMoneyInput($('#cashTender').value):due;
  if(isCash&&tender!=null)$('#changePreview').textContent=tender>=due?`Troco a devolver: ${money(tender-due)}`:`Valor entregue é menor que o saldo de ${money(due)}.`;
  else $('#changePreview').textContent='Pagamento eletrônico será registrado como observado e continuará aguardando conciliação.';
}
function openCollection(stop){
  state.collectionStop=stop;const f=stop.financial;
  $('#collectionOrderInfo').innerHTML=`<b>Saldo a receber: ${money(f.remaining_due_cents)}</b><br>${methodLabel(f.expected_method)} esperado${Number(f.change_required_cents||0)>0?` · troco previsto ${money(f.change_required_cents)}`:''}`;
  const expected=['cash','pix','card','payment_link','other'].includes(f.expected_method)?f.expected_method:'cash';
  $('#collectionMethod').value=expected;$('#collectionAmount').value=money(f.remaining_due_cents);
  $('#cashTender').value=expected==='cash'&&f.tender_amount_cents!=null?(Number(f.tender_amount_cents)/100).toFixed(2):'';
  status($('#collectionStatus'),'');refreshChange();$('#collectionSheet').classList.remove('hidden');
}
function closeCollection(){state.collectionStop=null;$('#collectionSheet').classList.add('hidden');status($('#collectionStatus'),'')}
async function confirmCollection(){
  const stop=state.collectionStop;if(!stop)return;
  const f=stop.financial,method=$('#collectionMethod').value,due=Number(f.remaining_due_cents||0);
  let tender=null;if(method==='cash'){tender=parseMoneyInput($('#cashTender').value);if(tender==null||tender<due){status($('#collectionStatus'),`Informe um valor entregue igual ou maior que ${money(due)}.`);return}}
  $('#confirmCollectionBtn').disabled=true;status($('#collectionStatus'),'Registrando…');
  try{
    const result=await act('delivered',stop.id,{proof:{method:'driver_confirmation'},collection:{payment_method:method,amount_cents:due,tender_amount_cents:tender}});
    closeCollection();
    if(result?.queued)showNotice('Recebimento e entrega salvos offline. O servidor ainda fará todas as validações antes de aceitar.');
    else if(result?.receipt?.recognition_status==='operational_confirmed')showNotice('Entrega e recebimento em dinheiro registrados. O fechamento da rota ainda fará a conciliação do caixa.');
    else showNotice('Entrega registrada. O pagamento eletrônico ficou aguardando conciliação; não foi confirmado no fiscal.');
  }catch(e){status($('#collectionStatus'),`Não foi possível concluir: ${e.message}`)}finally{$('#confirmCollectionBtn').disabled=false}
}

async function loadRoute(){if(!state.session)return;try{state.snapshot=await edge({action:'route'});renderRoute()}catch(e){if(e.message==='driver_runtime_disabled'){routePanel.classList.add('hidden');disabled.classList.remove('hidden')}else status($('#loginStatus'),`Erro: ${e.message}`)}}

function stopGps(){if(state.gpsWatch!=null){navigator.geolocation?.clearWatch(state.gpsWatch);state.gpsWatch=null}}
function startGps(){
  const snap=state.snapshot?.snapshot||state.snapshot;if(!cfg.enabled||!cfg.gpsEnabled||snap?.route?.status!=='active'||!navigator.geolocation)return;
  stopGps();let last=0;
  state.gpsWatch=navigator.geolocation.watchPosition(async pos=>{
    if(Date.now()-last<Number(cfg.gpsIntervalSeconds||30)*1000)return;last=Date.now();
    try{await dispatchOrQueue({action:'location',route_id:snap.route.id,latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy_m:pos.coords.accuracy,captured_at:new Date(pos.timestamp).toISOString()})}catch(e){console.warn('gps rejected',e.message)}
  },err=>console.warn('gps unavailable',err.message),{enableHighAccuracy:true,maximumAge:15000,timeout:15000});
}

async function login(){status($('#loginStatus'),'Entrando…');const {data,error}=await state.sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error){status($('#loginStatus'),error.message);return}state.session=data.session;loginPanel.classList.add('hidden');routePanel.classList.remove('hidden');await loadRoute();renderQueue();startGps()}

async function boot(){
  if(!cfg.enabled){disabled.classList.remove('hidden');app.classList.add('hidden');return}
  disabled.classList.add('hidden');app.classList.remove('hidden');state.sb=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
  const {data}=await state.sb.auth.getSession();state.session=data.session;if(state.session){loginPanel.classList.add('hidden');routePanel.classList.remove('hidden');await loadRoute();startGps()}
  $('#loginBtn').onclick=login;$('#syncBtn').onclick=syncQueue;$('#cancelCollectionBtn').onclick=closeCollection;$('#confirmCollectionBtn').onclick=confirmCollection;$('#collectionMethod').onchange=refreshChange;$('#cashTender').oninput=refreshChange;
  window.addEventListener('online',()=>{updateNetwork();syncQueue()});window.addEventListener('offline',updateNetwork);updateNetwork();renderQueue();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
function updateNetwork(){$('#networkState').textContent=navigator.onLine?'online':'offline';$('#networkState').classList.toggle('offline',!navigator.onLine)}
boot();
