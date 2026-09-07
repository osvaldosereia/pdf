(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const C=window.DA_COUNT_CONFIG||{};
  const nativeFetch=window.fetch.bind(window);
  let catalog=null;

  const text=v=>String(v??'').trim();
  const digits=v=>String(v??'').replace(/\D/g,'');
  const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null};
  const activeOf=p=>{
    const raw=text(p?.situacao??p?.status).toUpperCase();
    if(p?.ativo===false||p?.is_active===false||p?.visivel===false)return false;
    return !['I','INATIVO','INACTIVE','0','FALSE','E','EXCLUIDO','EXCLUÍDO'].includes(raw);
  };

  function inject(){
    const grid=document.querySelector('#productCard .count-fields');
    if(!grid||$('activeInput'))return;
    const wrap=document.createElement('label');
    wrap.className='count-active-row';
    wrap.innerHTML='<span>Status</span><button id="activeToggle" type="button" class="active-toggle"><span id="activeToggleDot"></span><strong id="activeToggleLabel">Ativo</strong></button><input id="activeInput" type="checkbox" checked hidden>';
    grid.insertAdjacentElement('afterend',wrap);
    $('activeToggle').addEventListener('click',()=>{
      const stock=num($('stockInput')?.value);
      if(stock!==null&&stock<=0){setActive(false,true);return;}
      setActive(!$('activeInput').checked,false);
    });
    $('stockInput')?.addEventListener('input',()=>{
      const stock=num($('stockInput').value);
      if(stock!==null&&stock<=0)setActive(false,true);
      else updateStatusText(false);
    });
  }

  function setActive(value,locked=false){
    const input=$('activeInput');if(!input)return;
    input.checked=!!value;
    input.dataset.locked=locked?'1':'0';
    updateStatusText(locked);
  }
  function updateStatusText(forceLocked=false){
    const input=$('activeInput'),button=$('activeToggle'),label=$('activeToggleLabel');if(!input||!button||!label)return;
    const locked=forceLocked||input.dataset.locked==='1';
    button.classList.toggle('is-active',input.checked&&!locked);
    button.classList.toggle('is-inactive',!input.checked||locked);
    label.textContent=locked?'Inativo · estoque 0':input.checked?'Ativo':'Inativo';
  }

  async function loadCatalog(){
    if(catalog)return catalog;
    const base=text(C.fallbackCatalogUrl);if(!base)return {};
    const r=await nativeFetch(`${base}${base.includes('?')?'&':'?'}v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)return {};
    catalog=await r.json().catch(()=>({}));return catalog||{};
  }
  async function sourceForCurrent(){
    const code=digits($('eanInput')?.value);if(!code)return null;
    const all=await loadCatalog();
    for(const [key,p] of Object.entries(all)){
      if(!p||typeof p!=='object')continue;
      const values=[key,p.firebaseKey,p.id,p.gtin,p.ean,p.codigo,p.sku].map(digits).filter(Boolean);
      if(values.includes(code))return p;
    }
    return null;
  }

  async function syncFromProduct(){
    const card=$('productCard');if(!card||card.classList.contains('hidden'))return;
    const stock=num($('stockInput')?.value);
    if(stock!==null&&stock<=0){setActive(false,true);return;}
    try{
      const src=await sourceForCurrent();
      setActive(src?activeOf(src):true,false);
    }catch{setActive(true,false);}
  }

  window.fetch=async function(input,init){
    let next=init;
    try{
      const url=typeof input==='string'?input:(input?.url||'');
      if(url.includes('/functions/v1/')&&typeof init?.body==='string'){
        const body=JSON.parse(init.body);
        if(body?.action==='save'&&body?.product){
          const active=$('activeInput')?.checked===true;
          const stock=num($('stockInput')?.value);
          body.is_active=stock!==null&&stock<=0?false:active;
          body.product.is_active=body.is_active;
          body.product.ativo=body.is_active;
          body.product.situacao=body.is_active?'A':'I';
          body.product.gondola=text($('gondolaInput')?.value);
          body.product.prateleira=text($('shelfInput')?.value);
          const sale=num($('priceInput')?.value),cost=num($('costInput')?.value);
          if(sale!==null&&sale>=0)body.product.preco=sale;
          if(cost!==null&&cost>=0)body.product.preco_custo=cost;
          next={...init,body:JSON.stringify(body)};
        }
      }
    }catch{}
    return nativeFetch(input,next);
  };

  function observe(){
    const card=$('productCard');
    if(card)new MutationObserver(()=>{if(!card.classList.contains('hidden'))setTimeout(syncFromProduct,80)}).observe(card,{attributes:true,attributeFilter:['class']});
  }
  function init(){inject();observe();setTimeout(syncFromProduct,100);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
