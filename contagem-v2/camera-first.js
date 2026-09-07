(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const RECENT_KEY='da_count_v2_recent';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let autoStarted=false;

  function recentRows(){try{return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]')||[]}catch{return []}}
  function brDate(v){if(!v)return 'sem validade';const raw=String(v);const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:raw}
  function renderLast(){
    const host=$('lastReadCard'); if(!host)return;
    const r=recentRows()[0];
    if(!r){host.innerHTML='<div class="empty">Nenhum produto contado ainda.</div>';return;}
    host.innerHTML=`<article class="last-read-horizontal">
      <img src="${esc(r.image||'')}" alt="" onerror="this.style.visibility='hidden'">
      <div class="last-read-copy"><strong>${esc(r.name||'Produto')}</strong><small>${esc(r.gtin||'')}</small></div>
      <div class="last-read-values"><span>Estoque<b>${esc(r.stock??0)}</b></span><span>Validade<b>${esc(brDate(r.validity))}</b></span></div>
    </article>`;
  }

  function setMode(mode){
    document.body.dataset.readMode=mode;
    const manual=$('manualModeButton');
    if(manual)manual.textContent=mode==='manual'?'📷 Usar câmera':'⌨ Digitar EAN';
    if(mode==='manual'){
      if(!$('cameraPanel')?.classList.contains('hidden')) $('closeCameraButton')?.click();
      setTimeout(()=>$('eanInput')?.focus(),50);
    } else {
      if(!$('productCard')?.classList.contains('hidden')) return;
      if(!$('notFoundCard')?.classList.contains('hidden')) return;
      if($('cameraPanel')?.classList.contains('hidden')) $('cameraButton')?.click();
    }
  }

  function maybeAutoStart(){
    const app=$('app');
    if(autoStarted||!app||app.classList.contains('hidden'))return;
    autoStarted=true;
    document.body.dataset.readMode='camera';
    setTimeout(()=>setMode('camera'),180);
  }

  function init(){
    document.body.dataset.readMode='camera';
    const manual=$('manualModeButton');
    if(manual)manual.addEventListener('click',()=>setMode(document.body.dataset.readMode==='manual'?'camera':'manual'));
    $('cameraButton')?.addEventListener('click',()=>{document.body.dataset.readMode='camera';if(manual)manual.textContent='⌨ Digitar EAN';});
    $('retryButton')?.addEventListener('click',()=>setMode('camera'));

    const app=$('app');
    if(app){new MutationObserver(maybeAutoStart).observe(app,{attributes:true,attributeFilter:['class']});}
    const recent=$('recentList');
    if(recent){new MutationObserver(renderLast).observe(recent,{childList:true,subtree:true});}
    window.addEventListener('storage',e=>{if(e.key===RECENT_KEY)renderLast()});
    renderLast(); maybeAutoStart();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
