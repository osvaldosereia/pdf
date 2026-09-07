(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const C=window.DA_COUNT_CONFIG||{};
  const nativeFetch=window.fetch.bind(window);
  let stream=null,detector=null,scanTimer=null,paused=false,lastCode='',lastAt=0;
  let padTarget=null,replaceOnFirst=true,keyMode='num',catalog=null,lastSource=null;

  const txt=v=>String(v??'').replace(/\s+/g,' ').trim();
  const dig=v=>String(v??'').replace(/\D/g,'');
  const norm=v=>txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null};
  const money=v=>{const n=num(v);return n===null?'':n.toFixed(2).replace('.',',')};
  const productName=p=>txt(p?.nome||p?.name||p?.titulo||p?.codigo)||'Produto';
  const productCode=p=>txt(p?.gtin||p?.ean||p?.codigo||p?.sku);

  /* Salva preço/custo editados no mesmo payload que já grava a contagem. */
  window.fetch=async function(input,init){
    let url=typeof input==='string'?input:(input?.url||'');
    let nextInit=init;
    try{
      if(url.includes('/functions/v1/')&&typeof init?.body==='string'){
        const body=JSON.parse(init.body);
        if(body?.action==='save'&&body?.product){
          const sale=num($('priceInput')?.value);
          const cost=num($('costInput')?.value);
          if(sale!==null&&sale>=0)body.product.preco=sale;
          if(cost!==null&&cost>=0)body.product.preco_custo=cost;
          nextInit={...init,body:JSON.stringify(body)};
        }
      }
    }catch{}
    const response=await nativeFetch(input,nextInit);
    try{
      if(/\/produtos\/[^/?]+\.json(?:\?|$)/.test(url)){
        response.clone().json().then(data=>{if(data&&typeof data==='object'&&(data.nome||data.gtin||data.codigo)){lastSource=data}}).catch(()=>{});
      }
    }catch{}
    return response;
  };

  function inject(){
    if(!$('countBackButton')){
      const a=document.createElement('a');a.id='countBackButton';a.href='../admin/';a.textContent='←';a.title='Voltar ao Admin';document.querySelector('.status-row')?.appendChild(a);
    }
    const scanner=document.querySelector('.scanner-card');
    if(scanner&&!$('kioskCamera')){
      const box=document.createElement('div');box.id='kioskCamera';
      box.innerHTML='<video id="kioskVideo" playsinline muted autoplay></video><div id="kioskGuide"></div><div id="kioskCameraStatus">Iniciando câmera…</div>';
      scanner.appendChild(box);
      const search=document.createElement('div');search.id='quickSearchBar';
      search.innerHTML='<input id="quickSearchInput" type="text" inputmode="none" readonly autocomplete="off" placeholder="Buscar por EAN ou nome"><button id="quickSearchButton" type="button">Buscar</button>';
      scanner.appendChild(search);
      const sug=document.createElement('div');sug.id='searchSuggestions';scanner.appendChild(sug);
    }
    const app=$('app');
    if(app&&!$('kioskPad')){
      const pad=document.createElement('section');pad.id='kioskPad';
      const letters=['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];
      pad.innerHTML=`<div id="kioskPadHead"><div class="kiosk-target"><span>Editando</span><strong id="kioskPadLabel">Busca EAN/nome</strong></div><div class="keyboard-modes"><button id="modeNum" class="active" type="button">123</button><button id="modeText" type="button">ABC</button></div></div>
      <div id="keypadNumeric" class="keypad-numeric">${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" data-k="${n}">${n}</button>`).join('')}<button type="button" data-k="," class="decimal-key">,</button><button type="button" data-k="0">0</button><button type="button" data-k="back">⌫</button></div>
      <div id="keypadText" class="keypad-text hidden">${letters.map((row,i)=>`<div class="keyrow r${i+1}">${[...row].map(ch=>`<button type="button" data-k="${ch}">${ch}</button>`).join('')}${i===2?'<button type="button" data-k="space" class="space">ESPAÇO</button><button type="button" data-k="back" class="wide">⌫</button>':''}</div>`).join('')}</div>
      <div class="keypad-action"><button id="clearKey" class="secondary-key" type="button">Limpar</button><button id="kioskPadOk" class="ok-key" type="button">OK</button></div>`;
      app.appendChild(pad);
    }
  }

  function preventNativeKeyboard(){
    ['eanInput','stockInput','validityInput','costInput','priceInput','gondolaInput','shelfInput','quickSearchInput'].forEach(id=>{
      const el=$(id);if(!el)return;
      el.setAttribute('readonly','readonly');el.setAttribute('inputmode','none');el.setAttribute('autocomplete','off');
      el.addEventListener('pointerdown',e=>{e.preventDefault();setTarget(id,true)});
      el.addEventListener('focus',()=>{try{el.blur()}catch{}});
    });
  }

  function labelOf(id){return({quickSearchInput:'Busca EAN/nome',eanInput:'EAN',stockInput:'Quantidade em estoque',validityInput:'Validade',costInput:'Preço de custo',priceInput:'Preço de venda',gondolaInput:'Gôndola',shelfInput:'Prateleira'})[id]||'Campo'}
  function setMode(mode){
    keyMode=mode==='text'?'text':'num';
    $('keypadNumeric')?.classList.toggle('hidden',keyMode!=='num');
    $('keypadText')?.classList.toggle('hidden',keyMode!=='text');
    $('modeNum')?.classList.toggle('active',keyMode==='num');$('modeText')?.classList.toggle('active',keyMode==='text');
  }
  function autoModeFor(id){if(['gondolaInput','shelfInput'].includes(id))return 'text';return 'num'}
  function setTarget(id,replace=false){
    document.querySelectorAll('.active-field').forEach(el=>el.classList.remove('active-field'));
    padTarget=$(id);if(!padTarget)return;
    replaceOnFirst=replace;padTarget.classList.add('active-field');
    if($('kioskPadLabel'))$('kioskPadLabel').textContent=labelOf(id);
    if(id!=='quickSearchInput')setMode(autoModeFor(id));
  }
  function formatValidity(raw){const r=String(raw).replace(/\D/g,'').slice(0,8);return [r.slice(0,2),r.slice(2,4),r.slice(4,8)].filter(Boolean).join('/')}
  function pressKey(key){
    if(!padTarget)setTarget('quickSearchInput',false);
    if(!padTarget)return;
    let value=padTarget.value||'';
    if(key==='clear'){value='';replaceOnFirst=false}
    else if(key==='back'){value=value.slice(0,-1);replaceOnFirst=false}
    else{
      if(replaceOnFirst){value='';replaceOnFirst=false}
      const add=key==='space'?' ':String(key);
      value+=add;
    }
    const id=padTarget.id;
    if(id==='validityInput')value=formatValidity(value);
    else if(id==='stockInput')value=value.replace(/\D/g,'').slice(0,7);
    else if(id==='costInput'||id==='priceInput'){
      value=value.replace(/[^0-9,.]/g,'').replace('.',',');
      const parts=value.split(',');value=parts[0].slice(0,7)+(parts.length>1?','+parts.slice(1).join('').slice(0,2):'');
    }else if(id==='eanInput')value=value.replace(/\D/g,'').slice(0,18);
    else if(id==='gondolaInput'||id==='shelfInput')value=value.toUpperCase().replace(/[^A-Z0-9 -]/g,'').slice(0,12);
    else if(id==='quickSearchInput')value=value.slice(0,60);
    padTarget.value=value;padTarget.dispatchEvent(new Event('input',{bubbles:true}));
  }

  async function loadCatalog(){
    if(catalog)return catalog;
    const url=`${C.fallbackCatalogUrl}${String(C.fallbackCatalogUrl||'').includes('?')?'&':'?'}v=${Date.now()}`;
    const r=await nativeFetch(url,{cache:'no-store'});if(!r.ok)throw new Error('Catálogo indisponível');catalog=await r.json();return catalog||{};
  }
  function matchesCode(p,key,q){const d=dig(q);return [key,p?.firebaseKey,p?.id,p?.gtin,p?.ean,p?.codigo,p?.sku].some(v=>dig(v)===d||txt(v).toLowerCase()===txt(q).toLowerCase())}
  async function productFromCode(q){const all=await loadCatalog();for(const [key,p] of Object.entries(all)){if(p&&typeof p==='object'&&matchesCode(p,key,q))return{key,p}}return null}
  async function rememberCode(q){try{const found=await productFromCode(q);if(found)lastSource=found.p}catch{}}
  function routeCode(code){
    const v=txt(code);if(!v)return;
    $('searchSuggestions').innerHTML='';$('quickSearchInput').value=v;$('eanInput').value=v;paused=true;rememberCode(v).finally(()=>$('searchButton')?.click());
  }
  async function quickSearch(){
    const q=txt($('quickSearchInput')?.value);if(!q)return;
    if(/^\d{5,}$/.test(q))return routeCode(q);
    const host=$('searchSuggestions');host.innerHTML='<div class="search-suggestion-empty">Buscando…</div>';
    try{
      const all=await loadCatalog();const nq=norm(q);const found=[];
      for(const [key,p] of Object.entries(all)){
        if(!p||typeof p!=='object')continue;const name=productName(p);const hay=norm([name,p?.marca,p?.categoria,p?.codigo,p?.sku].filter(Boolean).join(' '));
        if(hay.includes(nq))found.push({key,p,name,code:productCode(p)||key});if(found.length>=8)break;
      }
      if(!found.length){host.innerHTML='<div class="search-suggestion-empty">Nenhum produto encontrado.</div>';return}
      if(found.length===1){lastSource=found[0].p;return routeCode(found[0].code)}
      host.innerHTML=found.map((r,i)=>`<button class="search-suggestion" type="button" data-result="${i}"><strong>${r.name.replace(/[<>]/g,'')}</strong><small>${txt(r.code).replace(/[<>]/g,'')}</small></button>`).join('');
      host.querySelectorAll('[data-result]').forEach(btn=>btn.addEventListener('click',()=>{const r=found[Number(btn.dataset.result)];lastSource=r.p;routeCode(r.code)}));
    }catch{host.innerHTML='<div class="search-suggestion-empty">Falha ao consultar catálogo.</div>'}
  }

  async function populatePrices(){
    let src=lastSource;
    try{if(!src){const found=await productFromCode($('eanInput')?.value);src=found?.p||null}}catch{}
    if(!src)return;
    $('costInput').value=money(src?.preco_custo??src?.custo??src?.cost);
    $('priceInput').value=money(src?.preco??src?.price);
  }

  async function startCamera(){
    if(stream)return;
    const video=$('kioskVideo'),status=$('kioskCameraStatus');if(!video)return;
    if(!navigator.mediaDevices?.getUserMedia){status.textContent='Câmera indisponível';return}
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=stream;await video.play().catch(()=>{});
      if('BarcodeDetector' in window){const supported=await BarcodeDetector.getSupportedFormats().catch(()=>[]);const formats=['ean_13','ean_8','upc_a','upc_e','code_128'].filter(x=>!supported.length||supported.includes(x));detector=new BarcodeDetector(formats.length?{formats}:undefined);status.textContent='Câmera ligada · aponte o EAN';scanLoop()}else status.textContent='Câmera ligada · use a busca abaixo';
    }catch{status.textContent='Não foi possível abrir a câmera'}
  }
  function stopOwnCamera(){clearTimeout(scanTimer);scanTimer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;detector=null;const v=$('kioskVideo');if(v)v.srcObject=null}
  function canScan(){return !paused&&$('productCard')?.classList.contains('hidden')&&$('notFoundCard')?.classList.contains('hidden')}
  function scanLoop(){
    clearTimeout(scanTimer);if(!stream||!detector)return;
    scanTimer=setTimeout(async()=>{try{if(canScan()){const codes=await detector.detect($('kioskVideo'));const raw=txt(codes?.[0]?.rawValue);if(raw){const now=Date.now();if(raw!==lastCode||now-lastAt>1800){lastCode=raw;lastAt=now;paused=true;if(navigator.vibrate)navigator.vibrate(45);$('kioskCameraStatus').textContent=`Lido ${raw}`;routeCode(raw)}}}}catch{}scanLoop()},250);
  }

  function watchApp(){const app=$('app');if(!app)return;const activate=()=>{if(!app.classList.contains('hidden')){startCamera();preventNativeKeyboard();setTarget('quickSearchInput',false)}};new MutationObserver(activate).observe(app,{attributes:true,attributeFilter:['class']});activate()}
  function watchProduct(){
    const p=$('productCard');if(p)new MutationObserver(async()=>{const visible=!p.classList.contains('hidden');if(visible){paused=true;document.body.dataset.productState='found';$('notFoundCard')?.classList.add('hidden');await populatePrices();setTimeout(()=>setTarget('stockInput',true),35)}else if($('notFoundCard')?.classList.contains('hidden')){paused=false;document.body.dataset.productState='waiting';lastSource=null;$('quickSearchInput').value='';$('costInput').value='';$('priceInput').value='';setTarget('quickSearchInput',false);if($('kioskCameraStatus'))$('kioskCameraStatus').textContent='Câmera ligada · aponte o EAN'}}).observe(p,{attributes:true,attributeFilter:['class']});
    const nf=$('notFoundCard');if(nf)new MutationObserver(()=>{const visible=!nf.classList.contains('hidden');if(visible){paused=true;document.body.dataset.productState='notfound';$('productCard')?.classList.add('hidden');setTarget('quickSearchInput',true)}else if($('productCard')?.classList.contains('hidden')){document.body.dataset.productState='waiting';paused=false}}).observe(nf,{attributes:true,attributeFilter:['class']});
    const legacy=$('cameraPanel');if(legacy)new MutationObserver(()=>{if(!legacy.classList.contains('hidden'))setTimeout(()=>$('closeCameraButton')?.click(),20)}).observe(legacy,{attributes:true,attributeFilter:['class']});
  }

  function confirmTarget(){if(padTarget?.id==='quickSearchInput')quickSearch();else if(padTarget?.id==='stockInput')setTarget('validityInput',false)}
  function bind(){
    $('quickSearchButton')?.addEventListener('click',quickSearch);$('modeNum')?.addEventListener('click',()=>setMode('num'));$('modeText')?.addEventListener('click',()=>setMode('text'));
    $('kioskPad')?.addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(b)pressKey(b.dataset.k)});$('clearKey')?.addEventListener('click',()=>pressKey('clear'));$('kioskPadOk')?.addEventListener('click',confirmTarget);
    $('skipButton')?.addEventListener('click',()=>{paused=false});$('retryButton')?.addEventListener('click',()=>{paused=false;$('quickSearchInput').value='';setTarget('quickSearchInput',true)});$('saveButton')?.addEventListener('click',()=>{paused=true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopOwnCamera();else if(!$('app')?.classList.contains('hidden'))startCamera()});window.addEventListener('pagehide',stopOwnCamera);
  }

  function init(){inject();preventNativeKeyboard();bind();watchApp();watchProduct();document.body.dataset.productState='waiting';setMode('num');setTarget('quickSearchInput',false)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
