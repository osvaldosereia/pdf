(()=>{
  const API="https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/basket-shop-v1";
  const token=new URLSearchParams(location.search).get("t")||"";
  const $=id=>document.getElementById(id);
  const state={flow:null,data:null,items:[],filtered:[],modal:null,busy:new Set()};
  const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const toast=msg=>{const el=$("toast");el.textContent=msg;el.classList.remove("hidden");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add("hidden"),1800)};

  async function api(action,extra={}){
    const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,token,...extra}),cache:"no-store"});
    const data=await r.json().catch(()=>({ok:false,error:"invalid_response"}));
    if(!r.ok||!data.ok)throw new Error(data.detail||data.error||"Falha ao carregar");
    return data;
  }

  function stepper(item,compact=false){
    const min=Number(item.min_quantity??0),max=Math.max(min,Number(item.max_quantity??item.stock??99));
    const editable=item.quantity_editable!==false;
    const disabled=editable?"":"disabled";
    return `<div class="stepper" data-id="${esc(item.product_id)}"><button type="button" data-step="-1" ${disabled} aria-label="Diminuir">−</button><input type="number" inputmode="numeric" min="${min}" max="${max}" value="${Number(item.quantity||0)}" ${disabled} aria-label="Quantidade"><button type="button" data-step="1" ${disabled} aria-label="Aumentar">+</button></div>`;
  }

  function bindSteppers(root,items){
    root.querySelectorAll(".stepper").forEach(el=>{
      const id=el.dataset.id,input=el.querySelector("input");
      const item=items.find(x=>x.product_id===id);if(!item)return;
      const min=Number(item.min_quantity??0),max=Math.max(min,Number(item.max_quantity??item.stock??99));
      const commit=async next=>{
        next=Math.max(min,Math.min(max,Math.round(Number(next)||0)));
        if(next===Number(item.quantity||0)){input.value=String(next);return}
        if(state.busy.has(id))return;
        state.busy.add(id);el.querySelectorAll("button,input").forEach(x=>x.disabled=true);
        try{
          const res=await api("set_quantity",{product_id:id,quantity:next});
          item.quantity=next;input.value=String(next);
          if(state.flow==="basket_extras_v1"&&res.result?.cart?.total!=null)$("cartTotal").textContent=money(res.result.cart.total);
          toast(next===0?"Produto retirado":"Quantidade atualizada");
        }catch(e){input.value=String(item.quantity||0);toast(e.message||"Não consegui atualizar");}
        finally{state.busy.delete(id);el.querySelectorAll("button,input").forEach(x=>x.disabled=item.quantity_editable===false)}
      };
      el.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>commit(Number(input.value||0)+Number(btn.dataset.step||0))));
      input.addEventListener("change",()=>commit(input.value));
    });
  }

  function renderBasket(data){
    state.items=data.items||[];
    $("pageSubtitle").textContent="Composição da cesta";
    $("basketView").classList.remove("hidden");$("basketActions").classList.remove("hidden");
    $("basketName").textContent=data.basket?.name||"Cesta básica";
    $("basketPrice").textContent=money(data.basket?.base_price);
    $("basketImage").src=data.basket?.image_url||"";
    const root=$("basketItems");
    root.innerHTML=state.items.map(item=>`<article class="basket-row"><div><div class="basket-row-name">${esc(item.name)}</div><div class="basket-row-sub">Quantidade na cesta${Number(item.quantity)!==Number(item.base_quantity)?" · alterado":""}</div></div>${stepper(item)}</article>`).join("");
    bindSteppers(root,state.items);
  }

  function renderProductCards(items){
    const root=$("productGrid");
    root.innerHTML=items.map(item=>`<article class="product-card" data-product="${esc(item.product_id)}"><button class="product-open" type="button" data-open="${esc(item.product_id)}"><div class="product-image-wrap"><img class="product-image" loading="lazy" src="${esc(item.image_url||"")}" alt="${esc(item.name)}"></div><div class="product-copy"><div class="product-name">${esc(item.name)}</div><div class="product-price">${money(item.price)}</div></div></button>${stepper({...item,min_quantity:0,max_quantity:item.stock,quantity_editable:true},true)}</article>`).join("");
    $("emptyProducts").classList.toggle("hidden",items.length>0);
    bindSteppers(root,state.items);
    root.querySelectorAll("[data-open]").forEach(btn=>btn.addEventListener("click",()=>openProduct(btn.dataset.open)));
  }

  function applyFilter(){
    const q=($("searchInput").value||"").trim().toLocaleLowerCase("pt-BR");
    state.filtered=state.items.filter(x=>!q||String(x.name||"").toLocaleLowerCase("pt-BR").includes(q));
    renderProductCards(state.filtered);
  }

  function renderExtras(data){
    state.items=(data.items||[]).map(x=>({...x,min_quantity:0,max_quantity:Number(x.stock||99),quantity_editable:true}));
    $("pageSubtitle").textContent="Adicionar produtos";
    $("extrasView").classList.remove("hidden");$("extrasActions").classList.remove("hidden");
    const cats=data.session?.categories||[];
    $("sectionChips").innerHTML=cats.map(c=>`<span class="chip">${esc(c)}</span>`).join("");
    $("extrasTitle").textContent=data.basket?.name?`Complete a ${data.basket.name}`:"Complete sua cesta";
    $("cartTotal").textContent=money(data.cart?.total??data.basket?.base_price??0);
    $("searchInput").addEventListener("input",applyFilter);
    applyFilter();
  }

  function openProduct(id){
    const item=state.items.find(x=>x.product_id===id);if(!item)return;
    state.modal=item;
    $("modalImage").src=item.image_url||"";$("modalImage").alt=item.name||"Produto";
    $("modalName").textContent=item.name;$("modalPrice").textContent=money(item.price);
    $("modalStepper").innerHTML=stepper({...item,min_quantity:0,max_quantity:item.stock,quantity_editable:true});
    bindSteppers($("modalStepper"),state.items);
    $("productModal").showModal();
  }

  async function returnWhatsapp(intent){
    const btn=intent==="order"?$("orderBtn"):intent==="extras"?$("extrasBtn"):$("sendBtn");
    const old=btn.textContent;btn.disabled=true;btn.textContent="Abrindo WhatsApp…";
    try{const res=await api("return",{intent});location.href=res.whatsapp_url}
    catch(e){toast(e.message||"Não consegui voltar ao WhatsApp");btn.disabled=false;btn.textContent=old}
  }

  async function boot(){
    if(!/^[a-f0-9]{64}$/i.test(token)){showError("Este link não é válido.");return}
    try{
      const data=await api("open");state.data=data;state.flow=data.flow;
      $("loading").classList.add("hidden");
      if(data.flow==="basket_basic_v1")renderBasket(data);else if(data.flow==="basket_extras_v1")renderExtras(data);else showError("Este catálogo não está disponível.");
    }catch(e){showError(e.message||"O link pode ter expirado.")}
  }
  function showError(msg){$("loading").classList.add("hidden");$("errorText").textContent=msg;$("error").classList.remove("hidden")}

  $("orderBtn").addEventListener("click",()=>returnWhatsapp("order"));
  $("extrasBtn").addEventListener("click",()=>returnWhatsapp("extras"));
  $("sendBtn").addEventListener("click",()=>returnWhatsapp("extras_done"));
  $("closeModal").addEventListener("click",()=>$("productModal").close());
  $("productModal").addEventListener("click",e=>{if(e.target===$("productModal"))$("productModal").close()});
  boot();
})();