(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let stream=null,detector=null,scanTimer=null,paused=false,lastCode='',lastAt=0,padTarget=null,replaceOnFirst=true,manualEntry=false;

  function inject(){
    if(!$('countBackButton')){
      const a=document.createElement('a');a.id='countBackButton';a.href='../admin-v3/';a.textContent='←';a.title='Voltar ao Admin';document.body.appendChild(a);
    }
    const scanner=document.querySelector('.scanner-card');
    if(scanner&&!$('kioskCamera')){
      const box=document.createElement('div');box.id='kioskCamera';
      box.innerHTML='<video id="kioskVideo" playsinline muted autoplay></video><div id="kioskGuide"></div><div id="kioskCameraStatus">Iniciando câmera…</div><button id="manualEanButton" type="button">Digitar EAN</button>';
      scanner.appendChild(box);
    }
    const app=$('app');
    if(app&&!$('kioskPad')){
      const pad=document.createElement('section');pad.id='kioskPad';
      pad.innerHTML=`<div id="kioskPadHead"><div class="kiosk-target"><span>Digitando</span><strong id="kioskPadLabel">EAN manual</strong></div></div><div class="kiosk-pad-grid">${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" data-k="${n}">${n}</button>`).join('')}<button type="button" data-k="clear" class="danger-key">C</button><button type="button" data-k="0">0</button><button type="button" data-k="back">⌫</button></div><button id="kioskPadOk" class="kiosk-pad-ok" type="button">Buscar EAN</button>`;
      app.appendChild(pad);
    }
  }

  function preventNativeKeyboard(){
    ['eanInput','stockInput','validityInput','gondolaInput','shelfInput'].forEach(id=>{
      const el=$(id);if(!el)return;
      el.setAttribute('readonly','readonly');el.setAttribute('inputmode','none');el.setAttribute('autocomplete','off');
      el.addEventListener('pointerdown',e=>{e.preventDefault();setTarget(id,true);});
      el.addEventListener('focus',()=>{try{el.blur()}catch{}});
    });
  }

  function labelOf(id){return({eanInput:'EAN manual',stockInput:'Estoque',validityInput:'Validade',gondolaInput:'Gôndola',shelfInput:'Prateleira'})[id]||'Número'}
  function setTarget(id,replace=true){
    document.querySelectorAll('.kiosk-selected').forEach(el=>el.classList.remove('kiosk-selected'));
    padTarget=$(id);if(!padTarget)return;
    replaceOnFirst=replace;padTarget.classList.add('kiosk-selected');
    if($('kioskPadLabel'))$('kioskPadLabel').textContent=labelOf(id);
    if($('kioskPadOk'))$('kioskPadOk').textContent=id==='eanInput'?'Buscar EAN':id==='stockInput'?'OK → validade':'OK';
    manualEntry=id==='eanInput' && !$('productCard')?.classList.contains('hidden');
  }

  function formatValidity(raw){const r=String(raw).replace(/\D/g,'').slice(0,8);return [r.slice(0,2),r.slice(2,4),r.slice(4,8)].filter(Boolean).join('/')}
  function pressKey(key){
    if(!padTarget)setTarget('eanInput',true);
    if(!padTarget)return;
    let value=padTarget.value||'';
    if(key==='clear'){value='';replaceOnFirst=false}
    else if(key==='back'){value=value.slice(0,-1);replaceOnFirst=false}
    else{if(replaceOnFirst){value='';replaceOnFirst=false}value+=String(key)}
    if(padTarget.id==='validityInput')value=formatValidity(value);
    if(padTarget.id==='stockInput')value=value.replace(/\D/g,'').slice(0,6);
    if(padTarget.id==='eanInput')value=value.replace(/\D/g,'').slice(0,18);
    if(padTarget.id==='gondolaInput'||padTarget.id==='shelfInput')value=value.replace(/\D/g,'').slice(0,5);
    padTarget.value=value;padTarget.dispatchEvent(new Event('input',{bubbles:true}));
  }

  function confirmPad(){
    if(!padTarget){setTarget('eanInput',true);return}
    const id=padTarget.id;
    if(id==='eanInput'){
      const v=padTarget.value.trim();if(!v)return;
      paused=true;manualEntry=false;$('searchButton')?.click();
    }else if(id==='stockInput') setTarget('validityInput',true);
    else if(id==='validityInput') setTarget('stockInput',false);
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
    }catch{status.textContent='Não foi possível abrir a câmera'}
  }
  function stopOwnCamera(){clearTimeout(scanTimer);scanTimer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;detector=null;const v=$('kioskVideo');if(v)v.srcObject=null}
  function canScan(){
    if(paused||manualEntry)return false;
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
    },250);
  }

  function enterManualEan(){
    paused=true;manualEntry=true;setTarget('eanInput',true);
    $('eanInput').value='';
    if($('kioskCameraStatus'))$('kioskCameraStatus').textContent='Digite o EAN no teclado abaixo';
  }
  function returnToScan(){
    manualEntry=false;paused=false;setTarget('eanInput',true);
    if($('eanInput'))$('eanInput').value='';
    if($('kioskCameraStatus'))$('kioskCameraStatus').textContent='Câmera ligada · aponte o EAN';
  }

  function watchApp(){
    const app=$('app');if(!app)return;
    const activate=()=>{if(!app.classList.contains('hidden')){startCamera();preventNativeKeyboard();setTarget('eanInput',true)}};
    new MutationObserver(activate).observe(app,{attributes:true,attributeFilter:['class']});activate();
  }
  function watchProduct(){
    const p=$('productCard');
    if(p)new MutationObserver(()=>{
      const visible=!p.classList.contains('hidden');
      if(visible){
        paused=true;manualEntry=false;
        $('notFoundCard')?.classList.add('hidden');
        setTimeout(()=>setTarget('stockInput',true),40);
      }else if($('notFoundCard')?.classList.contains('hidden')) returnToScan();
    }).observe(p,{attributes:true,attributeFilter:['class']});

    const nf=$('notFoundCard');
    if(nf)new MutationObserver(()=>{
      const visible=!nf.classList.contains('hidden');
      if(visible){
        paused=true;manualEntry=true;$('productCard')?.classList.add('hidden');setTarget('eanInput',true);
        if($('kioskCameraStatus'))$('kioskCameraStatus').textContent='EAN não encontrado · digite outro ou tente de novo';
      }else if($('productCard')?.classList.contains('hidden')) returnToScan();
    }).observe(nf,{attributes:true,attributeFilter:['class']});

    const legacyCam=$('cameraPanel');if(legacyCam)new MutationObserver(()=>{if(!legacyCam.classList.contains('hidden'))setTimeout(()=>$('closeCameraButton')?.click(),20)}).observe(legacyCam,{attributes:true,attributeFilter:['class']});
  }

  function bind(){
    $('manualEanButton')?.addEventListener('click',enterManualEan);
    $('kioskPad')?.addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(b)pressKey(b.dataset.k)});
    $('kioskPadOk')?.addEventListener('click',confirmPad);
    $('skipButton')?.addEventListener('click',()=>setTimeout(returnToScan,30));
    $('retryButton')?.addEventListener('click',()=>setTimeout(returnToScan,30));
    $('saveButton')?.addEventListener('click',()=>{paused=true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopOwnCamera();else if(!$('app')?.classList.contains('hidden'))startCamera()});
    window.addEventListener('pagehide',stopOwnCamera);
  }

  function init(){inject();preventNativeKeyboard();bind();watchApp();watchProduct();setTarget('eanInput',true);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
