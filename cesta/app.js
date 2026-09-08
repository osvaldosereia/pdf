(()=>{
  const API="https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/basket-shop-v1";
  const params=new URLSearchParams(location.search);
  const token=params.get("t")||"";
  const $=id=>document.getElementById(id);
  const state={flow:null,data:null,items:[],filtered:[],modal:null,busy:new Set(),categoryDialog:null};
  const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const toast=msg=>{const el=$("toast");el.textContent=msg;el.classList.remove("hidden");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add("hidden"),2200)};

  async function api(action,extra={}){
    const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,token,...extra}),cache:"no-store"});
    const data=await r.json().catch(()=>({ok:false,error:"invalid_response"}));
    if(!r.ok||!data.ok)throw new Error(data.detail||data.error||"Falha ao carregar");
    return data;
  }

  function stepper(item){
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
          toast(state.flow==="basket_basic_v1"?"Alteração registrada para conferência":next===0?"Produto retirado":"Quantidade atualizada");
        }catch(e){input.value=String(item.quantity||0);toast(e.message||"Não consegui atualizar");}
        finally{state.busy.delete(id);el.querySelectorAll("button,input").forEach(x=>x.disabled=item.quantity_editable===false)}
      };
      el.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>commit(Number(input.value||0)+Number(btn.dataset.step||0))));
      input.addEventListener("change",()=>commit(input.value));
    });
  }

  async function startReplacement(productId){
    if(state.busy.has(`swap:${productId}`))return;
    state.busy.add(`swap:${productId}`);
    const btn=document.querySelector(`[data-swap="${CSS.escape(productId)}"]`);const old=btn?.textContent||"Trocar";
    if(btn){btn.disabled=true;btn.textContent="Abrindo…"}
    try{
      const res=await api("create_replacement",{product_id:productId});
      location.href=res.result.url;
    }catch(e){toast(e.message||"Não consegui abrir a troca");if(btn){btn.disabled=false;btn.textContent=old}}
    finally{state.busy.delete(`swap:${productId}`)}
  }

  function renderBasket(data){
    state.items=data.items||[];
    $("pageSubtitle").textContent="Composição da cesta";
    $("basketView").classList.remove("hidden");$("basketActions").classList.remove("hidden");
    $("basketName").textContent=data.basket?.name||"Cesta básica";
    $("basketPrice").textContent=money(data.basket?.base_price);
    $("basketImage").src=data.basket?.image_url||"";
    const root=$("basketItems");
    root.innerHTML=state.items.map(item=>{
      const sub=item.substitution;
      const status=sub?`<div class="swap-status">Troca: <strong>${esc(sub.replacement_name||"produto selecionado")}</strong></div>`:"";
      return `<article class="basket-row"><div class="basket-row-copy"><div class="basket-row-name">${esc(item.name)}</div><div class="basket-row-sub">Quantidade na cesta${Number(item.quantity)!==Number(item.base_quantity)?" · alterado":""}</div>${status}</div><div class="basket-row-actions">${stepper(item)}<button class="swap-button" type="button" data-swap="${esc(item.product_id)}">${sub?"Trocar novamente":"Trocar"}</button></div></article>`;
    }).join("");
    bindSteppers(root,state.items);
    root.querySelectorAll("[data-swap]").forEach(btn=>btn.addEventListener("click",()=>startReplacement(btn.dataset.swap)));
    if(params.get("swap")==="ok")toast("Troca registrada para conferência");
  }

  function renderExtraCards(items){
    const root=$("productGrid");
    root.innerHTML=items.map(item=>`<article class="product-card" data-product="${esc(item.product_id)}"><button class="product-open" type="button" data-open="${esc(item.product_id)}"><div class="product-image-wrap"><img class="product-image" loading="lazy" src="${esc(item.image_url||"")}" alt="${esc(item.name)}"></div><div class="product-copy"><div class="product-name">${esc(item.name)}</div><div class="product-price">${money(item.price)}</div></div></button>${stepper({...item,min_quantity:0,max_quantity:item.stock,quantity_editable:true})}</article>`).join("");
    $("emptyProducts").classList.toggle("hidden",items.length>0);
    bindSteppers(root,state.items);
    root.querySelectorAll("[data-open]").forEach(btn=>btn.addEventListener("click",()=>openProduct(btn.dataset.open)));
  }

  function renderReplacementCards(items){
    const root=$("productGrid");
    root.innerHTML=items.map(item=>`<article class="product-card replacement-card" data-product="${esc(item.product_id)}"><button class="product-open" type="button" data-open="${esc(item.product_id)}"><div class="product-image-wrap"><img class="product-image" loading="lazy" src="${esc(item.image_url||"")}" alt="${esc(item.name)}"></div><div class="product-copy"><div class="product-name">${esc(item.name)}</div><div class="replacement-category">${esc(item.category||"")}</div></div></button><button class="choose-replacement" type="button" data-choose="${esc(item.product_id)}">Escolher</button></article>`).join("");
    $("emptyProducts").classList.toggle("hidden",items.length>0);
    root.querySelectorAll("[data-open]").forEach(btn=>btn.addEventListener("click",()=>openProduct(btn.dataset.open)));
    root.querySelectorAll("[data-choose]").forEach(btn=>btn.addEventListener("click",()=>chooseReplacement(btn.dataset.choose,btn)));
  }

  function applyFilter(){
    const q=($("searchInput").value||"").trim().toLocaleLowerCase("pt-BR");
    state.filtered=state.items.filter(x=>!q||String(x.name||"").toLocaleLowerCase("pt-BR").includes(q)||String(x.category||"").toLocaleLowerCase("pt-BR").includes(q));
    if(state.flow==="basket_replace_v1")renderReplacementCards(state.filtered);else renderExtraCards(state.filtered);
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

  function renderReplacement(data){
    state.items=data.items||[];
    $("pageSubtitle").textContent="Trocar produto";
    $("extrasView").classList.remove("hidden");$("extrasActions").classList.remove("hidden");
    $("extrasView").classList.add("replacement-view");
    const source=data.session?.source_product_name||"produto";
    $("extrasTitle").textContent=`Trocar ${source}`;
    const cats=data.session?.categories||[];
    $("sectionChips").innerHTML=cats.map(c=>`<span class="chip">${esc(c)}</span>`).join("");
    $("cartTotal").parentElement.classList.add("hidden");
    $("sendBtn").textContent="Voltar para cesta";
    $("sendBtn").dataset.mode="back";
    $("searchInput").placeholder="Buscar nas opções";
    $("searchInput").addEventListener("input",applyFilter);
    applyFilter();
    if(!state.items.length)setTimeout(()=>chooseCategories("replacement",true),50);
  }

  function openProduct(id){
    const item=state.items.find(x=>x.product_id===id);if(!item)return;
    state.modal=item;
    $("modalImage").src=item.image_url||"";$("modalImage").alt=item.name||"Produto";
    $("modalName").textContent=item.name;
    if(state.flow==="basket_replace_v1"){
      $("modalPrice").classList.add("hidden");
      $("modalStepper").innerHTML=`<p class="replacement-note">A troca faz parte da composição da cesta. Não exibimos valor individual deste item.</p><button type="button" class="btn btn-primary modal-choose" data-choose="${esc(item.product_id)}">Usar este produto</button>`;
      $("modalStepper").querySelector("[data-choose]").addEventListener("click",e=>chooseReplacement(item.product_id,e.currentTarget));
    }else{
      $("modalPrice").classList.remove("hidden");$("modalPrice").textContent=money(item.price);
      $("modalStepper").innerHTML=stepper({...item,min_quantity:0,max_quantity:item.stock,quantity_editable:true});
      bindSteppers($("modalStepper"),state.items);
    }
    $("productModal").showModal();
  }

  async function chooseReplacement(productId,btn){
    if(state.busy.has(`choose:${productId}`))return;
    state.busy.add(`choose:${productId}`);const old=btn?.textContent||"Escolher";
    if(btn){btn.disabled=true;btn.textContent="Registrando…"}
    try{
      const res=await api("choose_replacement",{product_id:productId});
      location.href=res.result.parent_url||state.data?.session?.parent_url||"/cesta/";
    }catch(e){toast(e.message||"Não consegui registrar a troca");if(btn){btn.disabled=false;btn.textContent=old}}
    finally{state.busy.delete(`choose:${productId}`)}
  }

  async function chooseCategories(mode="extras",force=false){
    if(state.categoryDialog)return;
    let response;
    try{response=await api("categories")}catch(e){toast("Não consegui carregar as categorias");return}
    const dialog=document.createElement("dialog");dialog.className="category-modal";state.categoryDialog=dialog;
    const title=mode==="replacement"?"Escolha onde procurar":"Escolha as categorias";
    const copy=mode==="replacement"?"Marque uma ou várias categorias para encontrar o produto que vai entrar no lugar.":"Marque uma ou várias categorias para montar sua vitrine.";
    dialog.innerHTML=`<div class="category-head"><div><span class="eyebrow">${mode==="replacement"?"Trocar produto":"Personalizar cesta"}</span><h2>${title}</h2><p>${copy}</p></div><button type="button" class="modal-close category-close" aria-label="Fechar">×</button></div><div class="category-list">${(response.categories||[]).map(c=>`<label class="category-option"><input type="checkbox" value="${esc(c.category)}"><span><strong>${esc(c.display_name||c.category)}</strong><small>${Number(c.product_count||0)} produtos</small></span></label>`).join("")}</div><div class="category-actions"><button type="button" class="btn btn-primary category-go">Montar vitrine</button></div>`;
    document.body.appendChild(dialog);dialog.showModal();
    const close=()=>{dialog.close();dialog.remove();state.categoryDialog=null};
    dialog.querySelector(".category-close").addEventListener("click",()=>{if(force&&mode==="replacement"&&state.data?.session?.parent_url){location.href=state.data.session.parent_url}else close()});
    dialog.addEventListener("click",e=>{if(e.target===dialog&&!force)close()});
    dialog.querySelector(".category-go").addEventListener("click",async()=>{
      const selected=[...dialog.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
      if(!selected.length){toast("Marque pelo menos uma categoria");return}
      const btn=dialog.querySelector(".category-go"),old=btn.textContent;btn.disabled=true;btn.textContent="Montando vitrine…";
      try{
        if(mode==="replacement"){
          await api("set_replacement_categories",{categories:selected});close();
          const data=await api("open");state.data=data;state.items=data.items||[];
          $("sectionChips").innerHTML=(data.session?.categories||[]).map(c=>`<span class="chip">${esc(c)}</span>`).join("");
          applyFilter();
        }else{
          const res=await api("create_extras",{categories:selected});location.href=res.result.url;
        }
      }catch(e){toast(e.message||"Não consegui montar a vitrine");btn.disabled=false;btn.textContent=old}
    });
  }

  async function returnWhatsapp(intent){
    const btn=intent==="order"?$("orderBtn"):$("sendBtn");
    const old=btn.textContent;btn.disabled=true;btn.textContent="Abrindo WhatsApp…";
    try{const res=await api("return",{intent});location.href=res.whatsapp_url}
    catch(e){toast(e.message||"Não consegui voltar ao WhatsApp");btn.disabled=false;btn.textContent=old}
  }

  async function boot(){
    if(!/^[a-f0-9]{64}$/i.test(token)){showError("Este link não é válido.");return}
    try{
      const data=await api("open");state.data=data;state.flow=data.flow;
      $("loading").classList.add("hidden");
      if(data.flow==="basket_basic_v1")renderBasket(data);
      else if(data.flow==="basket_extras_v1")renderExtras(data);
      else if(data.flow==="basket_replace_v1")renderReplacement(data);
      else showError("Este catálogo não está disponível.");
    }catch(e){showError(e.message||"O link pode ter expirado.")}
  }
  function showError(msg){$("loading").classList.add("hidden");$("errorText").textContent=msg;$("error").classList.remove("hidden")}

  $("orderBtn").addEventListener("click",()=>returnWhatsapp("order"));
  $("extrasBtn").addEventListener("click",()=>chooseCategories("extras"));
  $("sendBtn").addEventListener("click",()=>{
    if(state.flow==="basket_replace_v1")location.href=state.data?.session?.parent_url||"/cesta/";
    else returnWhatsapp("extras_done");
  });
  $("closeModal").addEventListener("click",()=>$("productModal").close());
  $("productModal").addEventListener("click",e=>{if(e.target===$("productModal"))$("productModal").close()});
  boot();
})();
