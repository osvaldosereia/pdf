(function(){
  'use strict';

  const C=window.DA_COUNT_CONFIG||{};
  const EDGE='inventory-fast-stock-v1';
  const K={
    auth:'da_count_v2_auth',
    known:'da_count_fast_known_v1',
    unknown:'da_count_fast_unknown_v1',
    operation:'da_fast_stock_operation_v1'
  };
  const $=id=>document.getElementById(id);
  const txt=v=>String(v??'').replace(/\s+/g,' ').trim();
  const dig=v=>String(v??'').replace(/\D/g,'');
  const number=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null;};
  let saving=false;

  function read(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
  function write(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function getMode(){const m=sessionStorage.getItem(K.operation);return m==='add'||m==='balance'?m:''}
  function setModeValue(mode){sessionStorage.setItem(K.operation,mode)}
  function knownRows(){return read(K.known,[])}
  function unknownRows(){return read(K.unknown,[])}
  function totalReads(){return [...knownRows(),...unknownRows()].reduce((s,r)=>s+Number(r?.quantity||0),0)}

  function toast(message,kind=''){
    const region=$('toastRegion');
    if(!region)return;
    const el=document.createElement('div');
    el.className=`toast ${kind}`.trim();
    el.textContent=message;
    region.appendChild(el);
    setTimeout(()=>el.remove(),3600);
  }

  function setFastStatus(message,kind=''){
    const el=$('fastStatus');
    if(!el)return;
    el.textContent=message;
    el.className=`note ${kind}`.trim();
  }

  function hint(message,kind=''){
    const el=$('fastStockOperationHint');
    if(!el)return;
    el.textContent=message;
    el.className=`fast-stock-operation-hint ${kind}`.trim();
  }

  function modeLabel(mode){return mode==='add'?'ADICIONAR':'BALANÇO'}

  function updateModeUI(){
    const mode=getMode();
    document.querySelectorAll('[data-fast-stock-mode]').forEach(btn=>{
      const active=btn.dataset.fastStockMode===mode;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-pressed',active?'true':'false');
    });
    const badge=$('fastStockModeBadge');
    if(badge){
      badge.textContent=mode?modeLabel(mode):'ESCOLHA UM MODO';
      badge.className=`fast-stock-mode-badge ${mode||'empty'}`;
    }
    if(!mode){
      hint(totalReads()? 'Há leituras guardadas. Escolha com cuidado o modo antes de salvar.' : 'Escolha ADICIONAR ou BALANÇO antes da primeira leitura.','warning');
    }else if(mode==='add'){
      hint('ADICIONAR soma o total lido ao estoque atual. Produto fora do banco novo fica em pendências.','success');
    }else{
      hint('BALANÇO substitui o estoque de cada EAN lido pelo total contado. Produtos não lidos não são zerados automaticamente.','success');
    }
  }

  function chooseMode(next){
    const current=getMode();
    if(current===next)return;
    if(current&&totalReads()>0){
      hint('Modo travado porque já existem leituras. Salve ou remova as leituras antes de trocar.','error');
      toast('Não alterei o modo para evitar mudar o significado da contagem.','warning');
      return;
    }
    setModeValue(next);
    updateModeUI();
    setFastStatus(next==='add'?'ADICIONAR ativo · cada leitura será somada ao estoque.':'BALANÇO ativo · o total lido será o novo estoque.','success');
    try{$('fastScanInput')?.focus({preventScroll:true})}catch{try{$('fastScanInput')?.focus()}catch{}}
  }

  function injectUI(){
    if($('fastStockOperation')||!$('fastMode'))return;
    const section=document.createElement('section');
    section.id='fastStockOperation';
    section.className='card fast-stock-operation';
    section.innerHTML=`
      <div class="fast-stock-operation-title">
        <div><div class="eyebrow">ANTES DE COMEÇAR</div><h2>O que o leitor fará com o estoque?</h2></div>
        <span id="fastStockModeBadge" class="fast-stock-mode-badge empty">ESCOLHA UM MODO</span>
      </div>
      <div class="fast-stock-operation-buttons">
        <button type="button" class="fast-stock-mode-button add" data-fast-stock-mode="add" aria-pressed="false">
          <strong>➕ ADICIONAR</strong><span>Entrada de mercadoria</span><small>Estoque atual + quantidade lida</small>
        </button>
        <button type="button" class="fast-stock-mode-button balance" data-fast-stock-mode="balance" aria-pressed="false">
          <strong>📦 BALANÇO</strong><span>Contagem física</span><small>Total lido = novo estoque</small>
        </button>
      </div>
      <div id="fastStockOperationHint" class="fast-stock-operation-hint warning"></div>`;
    $('fastMode').prepend(section);

    const style=document.createElement('style');
    style.textContent=`
      .fast-stock-operation{border:2px solid #173f2a;background:#fbfcf9;box-shadow:0 8px 24px rgba(23,63,42,.08)}
      .fast-stock-operation-title{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:9px}.fast-stock-operation-title h2{font-size:15px;line-height:1.1;margin:2px 0 0}
      .fast-stock-mode-badge{font-size:8px;font-weight:900;letter-spacing:.05em;border-radius:999px;padding:6px 8px;white-space:nowrap;background:#edf3ee;color:#173f2a}.fast-stock-mode-badge.empty{background:#fff0cf;color:#8a5a08}.fast-stock-mode-badge.add{background:#e4f5e9;color:#165b2d}.fast-stock-mode-badge.balance{background:#e8eef8;color:#244c86}
      .fast-stock-operation-buttons{display:grid;grid-template-columns:1fr 1fr;gap:7px}.fast-stock-mode-button{min-height:82px;padding:9px;border:2px solid #d9ded8;border-radius:13px;background:#fff;color:#1e2721;text-align:left;display:flex;flex-direction:column;justify-content:center;gap:2px}.fast-stock-mode-button strong{font-size:14px}.fast-stock-mode-button span{font-size:10px;font-weight:750}.fast-stock-mode-button small{font-size:8px;line-height:1.2;color:#667067}.fast-stock-mode-button.add.active{border-color:#2d8a4c;background:#eef9f1;box-shadow:0 0 0 3px rgba(45,138,76,.11)}.fast-stock-mode-button.balance.active{border-color:#3e6fae;background:#f0f5fb;box-shadow:0 0 0 3px rgba(62,111,174,.11)}
      .fast-stock-operation-hint{margin-top:7px;border-radius:9px;padding:7px 8px;font-size:9px;line-height:1.3}.fast-stock-operation-hint.warning{background:#fff6e6;color:#80550d}.fast-stock-operation-hint.success{background:#eef7f0;color:#275d37}.fast-stock-operation-hint.error{background:#faecec;color:#8d2f2f}
      @media(max-width:520px){.fast-stock-operation-title{display:block}.fast-stock-mode-badge{display:inline-block;margin-top:6px}.fast-stock-mode-button{min-height:74px;padding:7px}.fast-stock-mode-button strong{font-size:12px}.fast-stock-mode-button span{font-size:9px}.fast-stock-mode-button small{font-size:7px}}
    `;
    document.head.appendChild(style);
    section.addEventListener('click',e=>{
      const button=e.target.closest('[data-fast-stock-mode]');
      if(button)chooseMode(button.dataset.fastStockMode);
    });
    updateModeUI();
  }

  function blockScanWithoutMode(event){
    if(getMode())return;
    const input=$('fastScanInput');
    if(!input)return;
    if(event.type==='input'||event.key==='Enter'||event.key==='Tab'){
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      input.value='';
      hint('Escolha primeiro ADICIONAR ou BALANÇO. Depois o leitor fica contínuo.','error');
      setFastStatus('Leitura ignorada por segurança: selecione o modo de estoque.','warning');
      const box=$('fastStockOperation');
      box?.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
  }

  function codeVariants(value){
    const raw=txt(value).toUpperCase();
    const numeric=dig(raw);
    const base=numeric||raw;
    if(!base)return[];
    const out=[base];
    if(/^\d+$/.test(base)){
      if(base.length===12)out.push(`0${base}`);
      if(base.length===13&&base[0]==='0')out.push(base.slice(1));
      const noZero=base.replace(/^0+(?=\d)/,'');if(noZero)out.push(noZero);
    }
    return [...new Set(out)];
  }

  function firebaseUrl(key){
    const base=String(C.firebaseUrl||'').replace(/\/+$/,'');
    const node=String(C.firebaseProductsNode||'produtos').replace(/^\/+|\/+$/g,'');
    return `${base}/${node}/${encodeURIComponent(key)}.json`;
  }

  async function getLegacy(key){
    if(!key||!C.firebaseUrl)return null;
    try{
      const r=await fetch(firebaseUrl(key),{cache:'no-store',headers:{Accept:'application/json'}});
      if(!r.ok)return null;
      const p=await r.json();
      return p&&typeof p==='object'?p:null;
    }catch{return null}
  }

  async function resolveLegacy(row){
    const keys=[txt(row?.firebase_key),...codeVariants(row?.code)].filter(Boolean);
    for(const key of [...new Set(keys)]){
      const product=await getLegacy(key);
      if(product)return{key,product};
    }
    return null;
  }

  function sourceFromNew(p,row){
    const gtin=dig(p?.gtin||row?.code);
    return{
      firebaseKey:txt(p?.firebase_key),codigo:txt(p?.sku),sku:txt(p?.sku),nome:txt(p?.name)||`EAN ${gtin}`,
      gtin,ean:gtin,ncm:dig(p?.ncm),marca:txt(p?.brand),fornecedor:txt(p?.supplier),embalagem:txt(p?.packaging),unidade:txt(p?.unit),
      categoria:txt(p?.category),subcategoria:txt(p?.subcategory),subsubcategoria:txt(p?.subsubcategory),gondola:txt(p?.gondola),prateleira:txt(p?.shelf),
      validade:txt(p?.validity_date),url_imagem:txt(p?.image_url),estoque:number(p?.stock),preco:number(p?.price),preco_custo:number(p?.cost),ativo:p?.is_active!==false
    };
  }

  function pick(obj,names){for(const name of names){const v=obj?.[name];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}return''}

  function sourceFromLegacy(p,key,row){
    const gtin=dig(pick(p,['gtin','ean','codigo_barras','codigoBarras'])||row?.code);
    return{
      firebaseKey:key,
      codigo:txt(pick(p,['codigo','sku','id'])),sku:txt(pick(p,['sku','codigo','id'])),nome:txt(pick(p,['nome','name','titulo']))||`EAN ${gtin}`,
      gtin,ean:gtin,ncm:dig(pick(p,['ncm'])),marca:txt(pick(p,['marca','brand'])),fornecedor:txt(pick(p,['fornecedor','supplier'])),
      embalagem:txt(pick(p,['embalagem','packaging'])),unidade:txt(pick(p,['unidade','unit'])),categoria:txt(pick(p,['categoria','category'])),
      subcategoria:txt(pick(p,['subcategoria','subcategory'])),subsubcategoria:txt(pick(p,['subsubcategoria','subsubcategory'])),gondola:txt(pick(p,['gondola','gôndola'])),
      prateleira:txt(pick(p,['prateleira'])),validade:txt(pick(p,['validade','data_validade'])),url_imagem:txt(pick(p,['url_imagem','imagem_url','imagem'])),
      estoque:number(pick(p,['estoque','stock'])),preco:number(pick(p,['preco','price'])),preco_custo:number(pick(p,['preco_custo','custo','cost'])),
      ativo:pick(p,['ativo','is_active'])!==false
    };
  }

  async function refreshAuth(){
    let auth=read(K.auth,null);
    if(!auth?.refresh_token)throw new Error('Sessão expirada. Entre novamente.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:auth.refresh_token})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.access_token)throw new Error('Sessão expirada. Entre novamente.');
    write(K.auth,data);return data;
  }

  async function callSave(mode,items,retry=true){
    let auth=read(K.auth,null);
    if(!auth?.access_token)throw new Error('Faça login.');
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${EDGE}`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'save_batch',mode,items})});
    const data=await r.json().catch(()=>({}));
    if(r.status===401&&retry){await refreshAuth();return callSave(mode,items,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);
    return data;
  }

  async function mapLimit(rows,limit,worker){
    const result=new Array(rows.length);let next=0;
    async function run(){while(true){const i=next++;if(i>=rows.length)return;result[i]=await worker(rows[i],i)}}
    await Promise.all(Array.from({length:Math.min(limit,rows.length)},run));
    return result;
  }

  async function buildItems(mode){
    const known=knownRows();
    const unknown=unknownRows();
    const items=known.map(row=>({
      code:dig(row?.product?.gtin||row?.code),quantity:Number(row?.quantity||0),firebase_key:txt(row?.product?.firebase_key),source:sourceFromNew(row?.product||{},row)
    })).filter(x=>x.code&&x.quantity>0);

    if(mode==='balance'&&unknown.length){
      hint('Preparando produtos ainda não cadastrados para o BALANÇO…','warning');
      const resolved=await mapLimit(unknown,6,async row=>({row,found:await resolveLegacy(row)}));
      for(const entry of resolved){
        const {row,found}=entry;
        if(!found)continue;
        const source=sourceFromLegacy(found.product,found.key,row);
        const code=dig(source.gtin||row.code);
        const quantity=Number(row?.quantity||0);
        if(code&&quantity>0)items.push({code,quantity,firebase_key:found.key,source});
      }
    }
    return items;
  }

  function removeSuccesses(successes){
    const codes=new Set((successes||[]).map(s=>dig(s?.code)).filter(Boolean));
    if(!codes.size)return;
    write(K.known,knownRows().filter(r=>!codes.has(dig(r?.product?.gtin||r?.code))));
    write(K.unknown,unknownRows().filter(r=>!codes.has(dig(r?.code))));
  }

  async function saveOperation(event){
    event.preventDefault();
    event.stopImmediatePropagation();
    if(saving)return;
    const mode=getMode();
    if(!mode){
      hint('Escolha ADICIONAR ou BALANÇO antes de salvar.','error');
      toast('Selecione o modo de estoque.','warning');
      return;
    }

    saving=true;
    const button=$('fastFinishButton');
    const original=button?.textContent||'Salvar contagem';
    if(button){button.disabled=true;button.textContent='Salvando…'}
    try{
      const items=await buildItems(mode);
      if(!items.length){
        const pending=unknownRows().length;
        hint(mode==='add'&&pending?'Nenhum produto do banco novo para adicionar. Os não cadastrados ficaram em pendências.':'Nenhuma leitura válida para salvar.','warning');
        toast('Nada foi alterado no estoque.','warning');
        return;
      }
      setFastStatus(`${modeLabel(mode)} · salvando ${items.length} produto(s)…`,'busy');
      const data=await callSave(mode,items);
      const successes=Array.isArray(data.successes)?data.successes:[];
      const errors=Array.isArray(data.errors)?data.errors:[];
      removeSuccesses(successes);

      const pending=unknownRows().length;
      if(mode==='add'){
        hint(`${successes.length} produto(s) tiveram entrada somada ao estoque.${pending?` ${pending} pendência(s) permaneceram sem alterar estoque.`:''}`,errors.length?'warning':'success');
      }else{
        hint(`${successes.length} produto(s) receberam o novo saldo do BALANÇO.${pending?` ${pending} pendência(s) não puderam ser cadastradas.`:''}`,errors.length?'warning':'success');
      }
      setFastStatus(`${modeLabel(mode)} concluído · ${successes.length} salvo(s), ${errors.length+pending} pendência(s).`,errors.length||pending?'warning':'success');
      toast(`${successes.length} produto(s) atualizados no estoque.`,successes.length?'success':'warning');

      if(successes.length){setTimeout(()=>location.reload(),900)}
    }catch(e){
      hint(e.message||'Falha ao salvar. As leituras continuam guardadas no aparelho.','error');
      setFastStatus('Falha ao salvar; nenhuma leitura foi descartada.','error');
      toast('As leituras continuam guardadas.','error');
    }finally{
      saving=false;
      if(button){button.disabled=false;button.textContent=original}
      try{$('fastScanInput')?.focus({preventScroll:true})}catch{}
    }
  }

  function bind(){
    injectUI();
    const input=$('fastScanInput');
    if(input){
      input.addEventListener('input',blockScanWithoutMode,true);
      input.addEventListener('keydown',blockScanWithoutMode,true);
    }
    $('fastFinishButton')?.addEventListener('click',saveOperation,true);
    window.addEventListener('pageshow',updateModeUI);
    updateModeUI();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
