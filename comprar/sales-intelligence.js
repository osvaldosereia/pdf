(()=>{
  'use strict';
  const C=window.DA_SHOPPING_ROOM_CONFIG||{},params=new URLSearchParams(location.search),token=(params.get('s')||params.get('c')||params.get('token')||'').trim();
  if(!C.salesApi||!/^[a-f0-9]{64}$/i.test(token))return;
  let current=null,locked=false,attempted=false,rejected=false,lastCartCount=-1,timer=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  async function api(action,payload={}){const r=await fetch(C.salesApi,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token,...payload}),cache:'no-store'});const d=await r.json().catch(()=>({ok:false,error:'invalid_response'}));if(!r.ok||!d.ok)throw new Error(d.error||'sales_failed');return d}
  function ensureHost(){let host=document.getElementById('smartSalesOffer');if(host)return host;host=document.createElement('aside');host.id='smartSalesOffer';host.className='smart-sales hidden';host.setAttribute('aria-live','polite');const bar=document.getElementById('cartBar');bar?.before(host);return host}
  function hide(){ensureHost().classList.add('hidden');current=null}
  function cartCount(){return Number(document.getElementById('cartCount')?.textContent||0)}
  function shouldOffer(){const bar=document.getElementById('cartBar'),content=document.getElementById('content');return !rejected&&bar&&!bar.classList.contains('hidden')&&cartCount()>0&&!content?.querySelector('.checkout,.success')}
  function render(offer){current=offer;const host=ensureHost();host.innerHTML=`<div class="smart-sales-copy"><span class="smart-sales-kicker">Talvez combine com seu pedido</span><strong>${esc(offer.name)}</strong><small>${esc(offer.reason||'Sugestão baseada no seu pedido')}</small></div><div class="smart-sales-product">${offer.image_url?`<img src="${esc(offer.image_url)}" alt="">`:''}<strong>${money(offer.price)}</strong></div><div class="smart-sales-actions"><button type="button" data-sales-view>Ver produto</button><button type="button" class="secondary" data-sales-reject>Agora não</button></div>`;host.classList.remove('hidden');host.querySelector('[data-sales-view]').onclick=()=>viewOffer();host.querySelector('[data-sales-reject]').onclick=()=>rejectOffer();}
  async function refresh(force=false){if(locked||rejected||!shouldOffer())return;if(attempted&&!force)return;locked=true;attempted=true;try{const d=await api('next_offer');if(d.offer&&d.action==='offer_suggestions')render(d.offer);else hide()}catch{}finally{locked=false}}
  async function viewOffer(){if(!current)return;const offer=current;try{await api('event',{event_type:'viewed',product_id:offer.product_id})}catch{}const input=document.getElementById('searchInput'),button=document.getElementById('searchButton');if(input&&button){input.value=offer.name;input.dispatchEvent(new Event('input',{bubbles:true}));button.click()}hide()}
  async function rejectOffer(){if(!current)return;const offer=current;rejected=true;hide();try{await api('event',{event_type:'rejected',product_id:offer.product_id})}catch{}}
  function schedule(force=false){clearTimeout(timer);timer=setTimeout(()=>refresh(force),1200)}
  document.addEventListener('click',e=>{const plus=e.target.closest?.('.product-card .plus');if(plus){const card=plus.closest('.product-card'),id=card?.dataset?.id;if(current&&id===current.product_id){setTimeout(async()=>{try{await api('event',{event_type:'added',product_id:id});hide()}catch{}},1000)}schedule(true)}else if(e.target.closest?.('.basket-select,.basket-item .plus,.basket-item .minus,.product-card .minus'))schedule(true)},true);
  const observer=new MutationObserver(()=>{const count=cartCount();if(count!==lastCartCount){lastCartCount=count;attempted=false;schedule()}if(!shouldOffer()&&current)hide()});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class'],characterData:true});
  window.addEventListener('beforeunload',()=>{if(current&&!rejected)navigator.sendBeacon?.(C.salesApi,new Blob([JSON.stringify({action:'event',token,event_type:'ignored',product_id:current.product_id})],{type:'application/json'}))});
  schedule();
})();
