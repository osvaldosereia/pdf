(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const nativeFetch=window.fetch.bind(window);
  const SETTINGS_KEY='da_cadastro_ia_v6_settings';
  let lastPatchedKey='';
  const text=v=>String(v??'').trim();
  const digits=v=>String(v??'').replace(/\D/g,'');
  const maybeNumber=v=>{const raw=text(v).replace(',','.');if(!raw)return null;const n=Number(raw);return Number.isFinite(n)&&n>=0?n:null};
  const requiredStock=v=>{const n=maybeNumber(v);return n===null?0:Math.max(0,Math.floor(n))};
  const money=v=>{const n=maybeNumber(v);return n===null?'':String(n.toFixed(2))};

  function settings(){try{return JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}catch{return {}}}
  function firebaseBase(){return text(settings().firebaseUrl||'https://cedar-chemist-310801-default-rtdb.firebaseio.com').replace(/\/+$/,'')}
  function productsNode(){return text(settings().productsNode||'produtos').replace(/^\/+|\/+$/g,'')||'produtos'}
  function authSuffix(first='&'){const a=text(settings().auth);return a?`${first}auth=${encodeURIComponent(a)}`:''}

  function injectStyle(){
    if($('productEditControlsStyle'))return;
    const s=document.createElement('style');s.id='productEditControlsStyle';s.textContent=`
      .edit-extra-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .active-control{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:49px;padding:8px 11px;border:1px solid #d8d0c5;border-radius:12px;background:#fff}
      .active-control span{font-size:12px;font-weight:800}.active-control button{border:0;border-radius:999px;padding:8px 12px;font-weight:900;background:#f3ecec;color:#8c3030}.active-control button.on{background:#e6f4e9;color:#176d3a}.active-control button.locked{opacity:.6}
      @media(max-width:620px){.edit-extra-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }
  function makeActiveControl(id,label,checked=false){
    const wrap=document.createElement('div');wrap.className='active-control';
    wrap.innerHTML=`<span>${label}</span><input id="${id}" type="checkbox" ${checked?'checked':''} hidden><button type="button" data-for="${id}">${checked?'ATIVO':'INATIVO'}</button>`;
    const input=wrap.querySelector('input'),button=wrap.querySelector('button');
    button.addEventListener('click',()=>{if(button.classList.contains('locked'))return;input.checked=!input.checked;renderActive(input,button)});
    renderActive(input,button);return wrap;
  }
  function renderActive(input,button){button.textContent=input.checked?'ATIVO':'INATIVO';button.classList.toggle('on',input.checked)}
  function lockIfZero(stockInput,activeInput){
    if(!stockInput||!activeInput)return;
    const button=document.querySelector(`[data-for="${activeInput.id}"]`);if(!button)return;
    const zero=requiredStock(stockInput.value)<=0;
    if(zero){activeInput.checked=false;button.classList.add('locked')}else button.classList.remove('locked');
    renderActive(activeInput,button);
  }

  function injectExisting(){
    const host=document.querySelector('.existing-stock-actions');if(!host||$('existingPriceInput'))return;
    const grid=document.createElement('div');grid.className='edit-extra-grid';
    grid.innerHTML=`
      <div class="field"><label for="existingCostInput">Preço de custo</label><input class="input" id="existingCostInput" type="number" min="0" step="0.01"></div>
      <div class="field"><label for="existingPriceInput">Preço de venda</label><input class="input" id="existingPriceInput" type="number" min="0" step="0.01"></div>
      <div class="field"><label for="existingGondolaInput">Gôndola</label><input class="input" id="existingGondolaInput"></div>
      <div class="field"><label for="existingShelfInput">Prateleira</label><input class="input" id="existingShelfInput"></div>`;
    const firstButton=$('updateStockButton');host.insertBefore(grid,firstButton);
    host.insertBefore(makeActiveControl('existingActiveInput','Produto'),firstButton);
    firstButton.textContent='Salvar alterações';
    $('existingStockInput')?.addEventListener('input',()=>lockIfZero($('existingStockInput'),$('existingActiveInput')));
  }
  function injectNew(){
    const grid=document.querySelector('#newProductPanel .form-grid');if(!grid||$('salePriceInput'))return;
    const cost=$('costInput')?.closest('.field');
    if(cost){const sale=document.createElement('div');sale.className='field';sale.innerHTML='<label for="salePriceInput">Preço de venda · opcional</label><input class="input" id="salePriceInput" type="number" min="0" step="0.01" placeholder="Opcional">';cost.insertAdjacentElement('afterend',sale)}
    const active=document.createElement('div');active.className='field span';active.appendChild(makeActiveControl('newActiveInput','Cadastrar produto como ativo',false));grid.appendChild(active);
    $('stockInput')?.addEventListener('input',()=>lockIfZero($('stockInput'),$('newActiveInput')));
    lockIfZero($('stockInput'),$('newActiveInput'));
  }

  async function findExisting(ean){
    const code=digits(ean);if(!code)return null;
    const base=`${firebaseBase()}/${productsNode()}.json?`;
    const candidates=[code];const numeric=Number(code);if(Number.isSafeInteger(numeric))candidates.push(numeric);
    for(const field of ['gtin','ean','codigo']){
      for(const candidate of candidates){
        const q=`orderBy=${encodeURIComponent(JSON.stringify(field))}&equalTo=${encodeURIComponent(JSON.stringify(candidate))}${authSuffix('&')}`;
        try{const r=await nativeFetch(base+q,{cache:'no-store'});if(!r.ok)continue;const data=await r.json();const entry=data&&Object.entries(data)[0];if(entry)return{key:entry[0],product:entry[1]}}catch{}
      }
    }
    return null;
  }
  function activeOf(p){const raw=text(p?.situacao??p?.status).toUpperCase();if(p?.ativo===false||p?.is_active===false||p?.visivel===false)return false;return !['I','INATIVO','INACTIVE','0','FALSE'].includes(raw)}
  async function populateExisting(){
    const panel=$('existingProductPanel');if(!panel||panel.hidden)return;
    const found=await findExisting($('eanInput')?.value);if(!found)return;
    const p=found.product||{};
    $('existingCostInput').value=money(p.preco_custo??p.custo??p.cost);
    $('existingPriceInput').value=money(p.preco??p.price);
    $('existingGondolaInput').value=text(p.gondola??p['gôndola']);
    $('existingShelfInput').value=text(p.prateleira??p.shelf);
    $('existingActiveInput').checked=activeOf(p);
    lockIfZero($('existingStockInput'),$('existingActiveInput'));
  }

  function existingPatch(){
    const stock=requiredStock($('existingStockInput')?.value),active=stock>0&&$('existingActiveInput')?.checked===true;
    const patch={estoque:stock,gondola:text($('existingGondolaInput')?.value),prateleira:text($('existingShelfInput')?.value),ativo:active,situacao:active?'A':'I'};
    const cost=maybeNumber($('existingCostInput')?.value),price=maybeNumber($('existingPriceInput')?.value);
    if(cost!==null)patch.preco_custo=cost;if(price!==null)patch.preco=price;
    return patch;
  }
  function newOverrides(){
    const stock=requiredStock($('stockInput')?.value),active=stock>0&&$('newActiveInput')?.checked===true;
    const patch={estoque:stock,gondola:text($('gondolaInput')?.value),prateleira:text($('shelfInput')?.value),ativo:active,situacao:active?'A':'I'};
    const cost=maybeNumber($('costInput')?.value),price=maybeNumber($('salePriceInput')?.value);
    if(cost!==null)patch.preco_custo=cost;if(price!==null)patch.preco=price;
    return patch;
  }

  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input?.url||'');let next=init;
    try{
      if(typeof init?.body==='string'&&init?.method==='PATCH'&&url.includes(`/${productsNode()}/`)&&url.includes('.json')){
        const body=JSON.parse(init.body);next={...init,body:JSON.stringify({...body,...existingPatch()})};
      }
      if(typeof init?.body==='string'&&url.includes('hook.eu1.make.com')){
        const outer=JSON.parse(init.body);if(typeof outer?.payload==='string'){
          const payload=JSON.parse(outer.payload),o=newOverrides();
          payload.contexto={...(payload.contexto||{}),estoque:o.estoque,gondola:o.gondola,prateleira:o.prateleira,ativo:o.ativo};
          if(o.preco_custo!==undefined)payload.contexto.preco_custo=o.preco_custo;
          if(o.preco!==undefined)payload.contexto.preco_venda=o.preco;
          payload.regras={...(payload.regras||{}),situacao_inicial:o.ativo?'A':'I'};
          outer.payload=JSON.stringify(payload);next={...init,body:JSON.stringify(outer)};
        }
      }
    }catch{}
    return nativeFetch(input,next);
  };

  async function patchCreated(){
    const panel=$('resultPanel');if(!panel?.classList.contains('show'))return;
    const raw=text($('resultKey')?.textContent);const key=raw.replace(/^Firebase:\s*/i,'');if(!key||key===lastPatchedKey)return;lastPatchedKey=key;
    const patch=newOverrides();
    try{
      const url=`${firebaseBase()}/${productsNode()}/${encodeURIComponent(key)}.json${authSuffix('?')}`;
      await nativeFetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...patch,updated_at:new Date().toISOString(),last_update:Date.now()})});
      const msg=$('message');if(msg){msg.textContent=patch.ativo?'Produto cadastrado e salvo como ativo.':'Produto cadastrado e salvo como inativo.';msg.className='message show ok'}
      const subtitle=document.querySelector('#resultPanel .panel-head p');if(subtitle)subtitle.textContent=patch.ativo?'Produto ativo.':'Produto inativo.';
    }catch{}
  }
  function clearInjected(){
    ['existingCostInput','existingPriceInput','existingGondolaInput','existingShelfInput','salePriceInput'].forEach(id=>{if($(id))$(id).value=''});
    if($('newActiveInput')){$('newActiveInput').checked=false;lockIfZero($('stockInput'),$('newActiveInput'))}
    lastPatchedKey='';
  }
  function observe(){
    const existing=$('existingProductPanel');if(existing)new MutationObserver(()=>{if(!existing.hidden)setTimeout(populateExisting,80)}).observe(existing,{attributes:true,attributeFilter:['hidden']});
    const result=$('resultPanel');if(result)new MutationObserver(()=>setTimeout(patchCreated,120)).observe(result,{attributes:true,attributeFilter:['class']});
    $('resetButton')?.addEventListener('click',()=>setTimeout(clearInjected,0));$('againButton')?.addEventListener('click',()=>setTimeout(clearInjected,0));
  }
  function init(){injectStyle();injectExisting();injectNew();observe();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
