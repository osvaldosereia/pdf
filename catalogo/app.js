(()=>{
  'use strict';
  const C=window.DA_CATALOGO_CONFIG||{};
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const token=(params.get('c')||params.get('t')||params.get('token')||'').trim();
  const initialQuery=(params.get('q')||'').trim();
  let state={session:null,items:[],cart:null,whatsappUrl:'',filter:initialQuery};
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const text=v=>String(v??'').replace(/\s+/g,' ').trim();
  const toast=msg=>{const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)};
  async function api(action,payload={}){
    const r=await fetch(C.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token,...payload}),cache:'no-store'});
    const data=await r.json().catch(()=>({ok:false,error:'invalid_response'}));
    if(!r.ok||!data.ok)throw new Error(data.detail||data.error||'Falha no catálogo');
    return data;
  }
  function filtered(){
    const q=text(state.filter).toLowerCase();if(!q)return state.items;
    return state.items.filter(x=>{const p=x.product||{};return [p.name,p.brand,p.category,p.packaging].some(v=>text(v).toLowerCase().includes(q))});
  }
  function totals(){
    let count=0,total=0;
    state.items.forEach(x=>{const q=Number(x.quantity||0),price=Number(x.product?.price||0);count+=q;total+=q*price});
    $('selectedCount').textContent=`${count} ${count===1?'item':'itens'}`;
    $('countBadge').textContent=`${count} ${count===1?'item':'itens'}`;
    $('selectedTotal').textContent=state.cart?.total!=null?money(state.cart.total):money(total);
    $('stickyBar').classList.remove('hidden');
  }
  function render(){
    const host=$('productGrid');host.innerHTML='';
    const list=filtered();
    if(!list.length){$('stateBox').textContent=state.items.length?'Nenhum produto encontrado nesta busca.':'Nenhum produto disponível nesta vitrine.';$('stateBox').classList.remove('hidden');host.classList.add('hidden');totals();return}
    $('stateBox').classList.add('hidden');host.classList.remove('hidden');
    for(const item of list){
      const p=item.product||{},frag=$('productTemplate').content.cloneNode(true),card=frag.querySelector('.product');
      card.dataset.id=item.product_id;
      const img=frag.querySelector('.product-image');img.src=p.image_url||'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#eef1ee"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#778078" font-family="Arial" font-size="20">sem foto</text></svg>');img.alt=text(p.name)||'Produto';
      frag.querySelector('.product-name').textContent=text(p.name)||'Produto';
      frag.querySelector('.product-meta').textContent=[text(p.brand),text(p.packaging),text(p.category)].filter(Boolean).join(' · ');
      frag.querySelector('.product-price').textContent=money(p.price);
      frag.querySelector('.product-reason').textContent=text(item.reason)||'';
      frag.querySelector('.qty').textContent=String(Number(item.quantity||0));
      frag.querySelector('.minus').addEventListener('click',()=>change(item,-1,card));
      frag.querySelector('.plus').addEventListener('click',()=>change(item,1,card));
      host.appendChild(frag);
    }
    totals();
  }
  async function change(item,delta,card){
    const current=Number(item.quantity||0),next=Math.max(0,Math.min(999,current+delta));if(next===current)return;
    card.classList.add('busy');
    try{
      const data=await api('set_quantity',{product_id:item.product_id,quantity:next});item.quantity=next;if(data.cart)state.cart=data.cart;render();
    }catch(e){toast(e.message||'Não foi possível alterar');card.classList.remove('busy')}
  }
  async function open(){
    if(!/^[a-f0-9]{64}$/i.test(token)){ $('stateBox').textContent='Este link de vitrine é inválido ou incompleto.';return }
    try{
      const data=await api('open');state.session=data.session;state.items=data.items||[];state.cart=data.cart||null;state.whatsappUrl=data.whatsapp_url||'';
      $('catalogTitle').textContent=initialQuery?`Resultados para ${initialQuery}`:(data.session?.title||'Vitrine Dona Antônia');
      $('searchInput').value=initialQuery;
      const expires=data.session?.expires_at?new Date(data.session.expires_at):null;
      $('catalogSubtitle').textContent=expires?`Escolha os produtos e ajuste as quantidades. Link disponível até ${expires.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}.`:'Escolha os produtos e ajuste as quantidades.';
      render();
    }catch(e){$('stateBox').textContent=e.message==='catalog_unavailable'?'Esta vitrine expirou ou não está mais disponível.':'Não foi possível abrir esta vitrine.'}
  }
  $('searchInput').addEventListener('input',e=>{state.filter=e.target.value;render()});
  $('whatsappButton').addEventListener('click',async()=>{
    try{const data=await api('return_whatsapp');location.href=data.whatsapp_url||state.whatsappUrl||'https://wa.me/556584491018'}catch{location.href=state.whatsappUrl||'https://wa.me/556584491018'}
  });
  open();
})();
