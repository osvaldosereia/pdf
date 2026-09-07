(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const RECENT_KEY='da_count_v2_recent';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let stream=null,detector=null,scanTimer=null,paused=false,lastCode='',lastAt=0,padTarget=null,replaceOnFirst=true;

  function readRecent(){try{return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]')||[]}catch{return[]}}
  function brDate(v){if(!v)return '—';const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:String(v)}
  function renderLast(){
    const host=$('lastReadCard'); if(!host)return;
    const r=readRecent()[0];
    if(!r){host.innerHTML='<div class="empty">Nenhum produto contado ainda.</div>';return;}
    host.innerHTML=`<article class="last-read-horizontal"><img src="${esc(r.image||'')}" alt="" onerror="this.style.visibility='hidden'"><div class="last-read-copy"><strong>${esc(r.name||'Produto')}</strong><small>${esc(r.gtin||'')}</small></div><div class="last-read-values"><span>Estoque<b>${esc(r.stock??0)}</b></span><span>Validade<b>${esc(brDate(r.validity))}</b></span></div></article>`;
  }

  function inject(){
    if(!$('countBackButton')){
      const a=document.createElement('a');a.id='countBackButton';a.href='../admin-v3/';a.textContent='←';a.title='Voltar ao Admin';document.body.appendChild(a);
    }
    const scanner=document.querySelector('.scanner-card');
    if(scanner&&!$('kioskCamera')){
      const box=document.createElement('div');box.id='kioskCamera';box.innerHTML='<video id="kioskVideo" playsinline muted autoplay></video><div id="kioskGuide"></div><div id="kioskCameraStatus">Iniciando câmera…</div><button id="manualEanButton" type="button">Digitar EAN</button>';
      scanner.appendChild(box);
    }
    const app=$('app');
    if(app&&!$('kioskPad')){
      const pad=document.createElement('section');pad.id='kioskPad';pad.innerHTML=`<div id="kioskPadHead"><div class="kiosk-target"><span>Digitando</span><strong id="kioskPadLabel">Estoque</strong></div><button id="kioskPadClose" class="kiosk-pad-close" type="button">Fechar</button></div><div class="kiosk-pad-grid">${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" data-k="${n}">${n}</button>`).join('')}<button type="button" data-k="clear" class="danger-key">C</button><button type="button" data-k="0">0</button><button type="button" data-k="back">⌫</button></div><button id="kioskPadOk" class="kiosk-pad-ok" type="button">OK</button>`;
      app.appendChild(pad);
    }
  }

  function preventNativeKeyboard(){
    ['eanInput','stockInput','validityInput','gondolaInput','shelfInput'].forEach(id=>{
      const el=$(id); if(!el)return;
      el.setAttribute('readonly','readonly');el.setAttribute('inputmode','none');el.setAttribute('autocomplete','off');
      el.addEventListener('pointerdown',e=>{e.preventDefault();openPad(id,true)});
      el.addEventListener('focus',()=>{try{el.blur()}catch{}});
    });
  }

  function prettyLabel(id){return({eanInput:'EAN',stockInput:'Estoque',validityInput:'Validade',gondolaInput:'Gôndola',shelfInput:'Prateleira'})[id]||'Número'}
  function openPad(id,replace=true){
    padTarget=$(id);if(!padTarget)return;
    replaceOnFirst=replace;document.body.dataset.kioskPad='open';$('kioskPadLabel').textContent=prettyLabel(id);paused=true;
  }
  function closePad(){document.body.dataset.kioskPad='closed';padTarget=null;replaceOnFirst=true;paused=!!(!$('productCard')?.classList.contains('hidden')||!$('notFoundCard')?.classList.contains('hidden'))}
  function formatValidity(raw){const r=String(raw).replace(/\D/g,'').slice(0,8);return [r.slice(0,2),r.slice(2,4),r.slice(4,8)].filter(Boolean).join('/')}
  function pressKey(key){
    if(!padTarget)return;
    let value=padTarget.value||'';
    if(key==='clear'){value='';replaceOnFirst=false}
    else if(key==='back'){value=value.slice(0,-1);replaceOnFirst=false}
    else{
      if(replaceOnFirst){value='';replaceOnFirst=false}
      value+=String(key);
    }
    if(padTarget.id==='validityInput')value=formatValidity(value);
    if(padTarget.id==='stockInput')value=value.replace(/\D/g,'').slice(0,6);
    if(padTarget.id==='eanInput')value=value.replace(/\D/g,'').slice(0,18);
    if(padTarget.id==='gondolaInput'||padTarget.id==='shelfInput')value=value.replace(/\D/g,'').slice(0,5);
    padTarget.value=value;padTarget.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function confirmPad(){
    if(!padTarget)return closePad();
    const id=padTarget.id;
    if(id==='eanInput'){
      const v=padTarget.value.trim();if(!v)return;
      closePad();$('searchButton')?.click();
    }else closePad();
  }

  async function startCamera(){
    if(stream)return;
    const video=$('kioskVideo'),status=$('kioskCameraStatus');if(!video)return;
    if(!navigator.mediaDevices?.getUserMedia){status.textContent='Câmera indisponível';return}
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      video.srcObject=stream;await video.play().catch(()=>{});
      if('BarcodeDetector' in window){
        const supported=await BarcodeDetector.getSupportedFormats().catch(()=>[]);
        const formats=['ean_13','ean_8','upc_a','upc_e','code_128'].filter(x=>!supported.length||supported.includes(x));
        detector=new BarcodeDetector(formats.length?{formats}:undefined);status.textContent='Câmera ligada · aponte o EAN';scanLoop();
      }else status.textContent='Câmera ligada · use Digitar EAN';
    }catch(e){status.textContent='Não foi possível abrir a câmera';}
  }
  function stopOwnCamera(){clearTimeout(scanTimer);scanTimer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;detector=null;const v=$('kioskVideo');if(v)v.srcObject=null}
  function canScan(){
    if(paused||document.body.dataset.kioskPad==='open')return false;
    if(!$('productCard')?.classList.contains('hidden'))return false;
    if(!$('notFoundCard')?.classList.contains('hidden'))return false;
    return true;
  }
  function scanLoop(){
    clearTimeout(scanTimer);if(!stream||!detector)return;
    scanTimer=setTimeout(async()=>{
      try{
        if(canScan()){
          const codes=await detector.detect($('kioskVideo'));const raw=String(codes?.[0]?.rawValue||'').trim();
          if(raw){const now=Date.now();if(raw!==lastCode||now-lastAt>1800){lastCode=raw;lastAt=now;paused=true;if(navigator.vibrate)navigator.vibrate(45);$('eanInput').value=raw;$('kioskCameraStatus').textContent=`Lido ${raw}`;$('searchButton')?.click();}}
        }
      }catch{}
      scanLoop();
    },260);
  }

  function watchApp(){
    const app=$('app');if(!app)return;
    const activate=()=>{if(!app.classList.contains('hidden')){startCamera();renderLast();preventNativeKeyboard();}}
    new MutationObserver(activate).observe(app,{attributes:true,attributeFilter:['class']});activate();
  }
  function watchProduct(){
    const p=$('productCard');if(p)new MutationObserver(()=>{
      const visible=!p.classList.contains('hidden');
      if(visible){paused=true;setTimeout(()=>openPad('stockInput',true),80)}
      else{paused=false;closePad();$('kioskCameraStatus')&&($('kioskCameraStatus').textContent='Câmera ligada · aponte o EAN')}
    }).observe(p,{attributes:true,attributeFilter:['class']});
    const nf=$('notFoundCard');if(nf)new MutationObserver(()=>{paused=!nf.classList.contains('hidden')}).observe(nf,{attributes:true,attributeFilter:['class']});
    const hiddenRecent=$('recentList');if(hiddenRecent)new MutationObserver(renderLast).observe(hiddenRecent,{childList:true,subtree:true});
    const legacyCam=$('cameraPanel');if(legacyCam)new MutationObserver(()=>{if(!legacyCam.classList.contains('hidden'))setTimeout(()=>$('closeCameraButton')?.click(),20)}).observe(legacyCam,{attributes:true,attributeFilter:['class']});
  }

  function bind(){
    $('manualEanButton')?.addEventListener('click',()=>openPad('eanInput',true));
    $('kioskPad')?.addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(b)pressKey(b.dataset.k)});
    $('kioskPadClose')?.addEventListener('click',closePad);$('kioskPadOk')?.addEventListener('click',confirmPad);
    $('skipButton')?.addEventListener('click',()=>{paused=false;closePad()});
    $('retryButton')?.addEventListener('click',()=>{paused=false;closePad()});
    $('finishSessionButton')?.addEventListener('click',()=>{paused=true;closePad()});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopOwnCamera();else if(!$('app')?.classList.contains('hidden'))startCamera()});
    window.addEventListener('pagehide',stopOwnCamera);
  }

  function init(){inject();preventNativeKeyboard();bind();watchApp();watchProduct();renderLast();document.body.dataset.kioskPad='closed';}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
