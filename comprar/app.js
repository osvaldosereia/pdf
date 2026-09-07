(()=>{
  'use strict';
  const C=window.DA_SHOPPING_ROOM_CONFIG||{};
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const suppliedToken=(params.get('s')||params.get('c')||params.get('token')||'').trim();
  let token=suppliedToken;
  let createdFromSite=false;
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const text=v=>String(v??'').replace(/\s+/g,' ').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fallback='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#eef1ee"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#7b837b" font-family="Arial" font-size="18">Dona Antônia</text></svg>');
  const state={session:null,customer:null,groups:[],baskets:[],recommended:[],cart:null,messages:[],whatsapp:C.whatsappFallback||'',view:'home',basketItems:[],basketInfo:null,products:[],checkout:null,search:''};
  let recorder=null,recordStream=null,recordChunks=[],recordStarted=0,recordTimer=null,recordCancelled=false;

  const errorLabel=code=>({
    rate_limited:'Muitas tentativas seguidas. Aguarde um pouco e tente novamente.',room_expired:'Esta Sala de Compra expirou.',room_closed:'Este pedido já foi concluído.',customer_name_required:'Informe seu nome.',valid_whatsapp_required:'Informe um WhatsApp válido com DDD.',invalid_document:'CPF/CNPJ inválido.',customer_identity_conflict:'Os dados informados pertencem a cadastros diferentes. Continue pelo WhatsApp para conferirmos.',ambiguous_customer_phone:'Encontramos mais de um cadastro com esse telefone. Informe o CPF para identificar corretamente.',customer_document_required:'Informe o CPF para concluir o pedido.',customer_identification_required:'Informe seus dados para concluir o pedido.',delivery_address_required:'Informe rua, número e cidade.',empty_cart:'Seu pedido ainda está vazio.',unsupported_media_type:'Esse formato de arquivo não é suportado.',media_too_large:'O arquivo é grande demais. Envie uma foto ou áudio menor.'})[code]||code;
  const toast=msg=>{const el=$('toast');if(!el)return;el.textContent=errorLabel(msg);el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2500)};

  async function api(action,payload={}){
    const body={action,...(token?{token}:{}),...payload};
    const r=await fetch(C.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
    const data=await r.json().catch(()=>({ok:false,error:'invalid_response'}));
    if(!r.ok||!data.ok)throw new Error(errorLabel(data.detail||data.error||'Não foi possível continuar.'));
    return data;
  }
  async function apiForm(kind,file,durationMs=0){
    const form=new FormData();form.append('action','upload_media');form.append('token',token);form.append('kind',kind);if(durationMs)form.append('duration_ms',String(durationMs));form.append('file',file,file.name||`${kind}-${Date.now()}`);
    const r=await fetch(C.api,{method:'POST',body:form,cache:'no-store'});const data=await r.json().catch(()=>({ok:false,error:'invalid_response'}));if(!r.ok||!data.ok)throw new Error(errorLabel(data.detail||data.error||'Falha ao enviar arquivo.'));return data;
  }
  function showState(msg){$('contentState').textContent=msg;$('contentState').classList.remove('hidden');$('content').classList.add('hidden')}
  function showContent(){$('contentState').classList.add('hidden');$('content').classList.remove('hidden')}
  function setHead(eyebrow,title,search=false){$('viewEyebrow').textContent=eyebrow;$('viewTitle').textContent=title;$('searchBox').classList.toggle('hidden',!search);$('homeButton').classList.toggle('hidden',state.view==='home')}
  function cartCount(){return (state.cart?.items||[]).reduce((n,x)=>n+Number(x.quantity||0),0)}
  function updateCartBar(){const count=cartCount();$('cartCount').textContent=String(count);$('cartItems').textContent=`${count} ${count===1?'item':'itens'}`;$('cartTotal').textContent=money(state.cart?.total||0);$('cartBar').classList.toggle('hidden',!state.cart||count===0||state.view==='success')}

  function renderChat(){
    const host=$('chat');host.innerHTML='';
    if(!state.messages.length){const first=text(state.customer?.name).split(' ')[0]||'Olá';host.innerHTML=`<div class="welcome"><strong>${esc(first)}, sua compra pode ser feita do seu jeito.</strong><p>Escolha visualmente abaixo ou envie texto, áudio ou foto.</p></div>`;return}
    for(const m of state.messages.slice(-14)){
      const div=document.createElement('div');div.className=`message ${m.direction==='inbound'?'inbound':'outbound'}`;
      if(m.message_type==='image'&&m.media_url){div.classList.add('media');div.innerHTML=`<img src="${esc(m.media_url)}" alt="Foto enviada"><div class="media-caption">Foto enviada</div>`}
      else if(m.message_type==='audio'&&m.media_url){div.classList.add('media');div.innerHTML=`<audio controls preload="metadata" src="${esc(m.media_url)}"></audio><div class="media-caption">Áudio</div>`}
      else{const body=text(m.body_text||m.transcript);if(!body)continue;div.textContent=body}
      host.appendChild(div);
    }
    host.scrollTop=host.scrollHeight;
  }

  function productCard(item,reason=''){
    const p=item.product||item,frag=$('productTemplate').content.cloneNode(true),card=frag.querySelector('.product-card');card.dataset.id=p.id||item.product_id;
    const img=frag.querySelector('.product-image');img.src=p.image_url||fallback;img.alt=text(p.name)||'Produto';
    frag.querySelector('.product-name').textContent=text(p.name)||'Produto';frag.querySelector('.product-meta').textContent=[text(p.brand),text(p.packaging),text(p.category)].filter(Boolean).join(' · ');frag.querySelector('.product-price').textContent=money(p.price);frag.querySelector('.product-reason').textContent=text(reason||item.reason)||'';frag.querySelector('.qty').textContent=String(Number(item.quantity||0));frag.querySelector('.minus').onclick=()=>changeProduct(item,-1,card);frag.querySelector('.plus').onclick=()=>changeProduct(item,1,card);return frag;
  }
  async function changeProduct(item,delta,card){const current=Number(item.quantity||0),next=Math.max(0,current+delta);if(next===current)return;card.classList.add('busy');try{const data=await api('set_quantity',{product_id:item.product_id||item.id||item.product?.id,quantity:next});item.quantity=next;if(data.cart)state.cart={...(state.cart||{}),total:data.cart.commercial_total??data.cart.total??state.cart?.total};await syncRoom(false);if(state.view==='products')renderProducts(state.products);else if(state.view==='home')renderHome()}catch(e){toast(e.message)}finally{card.classList.remove('busy')}}

  function renderHome(){
    state.view='home';setHead('Sua compra','Escolha como prefere comprar',false);const host=$('content');host.innerHTML='';const grid=document.createElement('div');grid.className='home-grid';
    const list=state.groups.length?state.groups:[{id:'baskets',label:'Cestas Básicas',icon:'🧺'},{id:'mercearia',label:'Mercearia Completa',icon:'🛒'},{id:'limpeza_lavanderia',label:'Limpeza e Lavanderia',icon:'🧼'},{id:'higiene_beleza',label:'Higiene e Beleza',icon:'🧴'},{id:'casa_pet',label:'Casa e Pet',icon:'🏠'}];
    for(const g of list){const b=document.createElement('button');b.className='home-card';b.type='button';b.innerHTML=`<span>${esc(g.icon||'•')}</span><strong>${esc(g.label)}</strong><small>Toque para abrir</small>`;b.onclick=()=>g.id==='baskets'?loadBaskets():loadProducts({category:g.id});grid.appendChild(b)}host.appendChild(grid);
    if(state.recommended.length){const title=document.createElement('div');title.className='section-title';title.innerHTML='<strong>Sugestões para você</strong><button type="button">Ver ofertas</button>';title.querySelector('button').onclick=()=>loadProducts({offers:true});host.appendChild(title);const pg=document.createElement('div');pg.className='product-grid';state.recommended.slice(0,6).forEach(x=>pg.appendChild(productCard(x,x.reason)));host.appendChild(pg)}showContent();updateCartBar();
  }
  function renderProducts(list){const host=$('content');host.innerHTML='';if(!list.length){host.innerHTML='<div class="state">Nenhum produto disponível para este filtro.</div>';showContent();return}const grid=document.createElement('div');grid.className='product-grid';list.forEach(p=>grid.appendChild(productCard(p)));host.appendChild(grid);showContent();updateCartBar()}
  async function loadProducts(opts={}){state.view='products';setHead(opts.offers?'Ofertas':'Produtos',opts.offers?'Ofertas disponíveis':'Escolha seus produtos',true);showState('Carregando produtos...');try{const data=await api('products',{category:opts.category||'',offers:!!opts.offers,q:opts.q||'',limit:30});state.products=data.products||[];state.search=opts.q||'';$('searchInput').value=state.search;renderProducts(state.products)}catch(e){showState(e.message)}}
  async function loadBaskets(){state.view='baskets';setHead('Cestas Básicas','Escolha uma cesta',false);showState('Carregando cestas...');try{const data=await api('baskets');state.baskets=data.baskets||[];const host=$('content');host.innerHTML='';if(!state.baskets.length){host.innerHTML='<div class="state">As cestas ainda não foram publicadas nesta Sala.</div>';showContent();return}const grid=document.createElement('div');grid.className='basket-grid';for(const b of state.baskets){const frag=$('basketTemplate').content.cloneNode(true);frag.querySelector('.basket-image').src=b.image_url||fallback;frag.querySelector('.basket-image').alt=text(b.name);frag.querySelector('.basket-name').textContent=b.name;frag.querySelector('.basket-description').textContent=b.description||'Confira e personalize os itens da cesta.';frag.querySelector('.basket-price').textContent=money(b.base_price);frag.querySelector('.basket-select').onclick=()=>startBasket(b);grid.appendChild(frag)}host.appendChild(grid);showContent()}catch(e){showState(e.message)}}
  async function startBasket(basket){showState('Montando sua cesta...');try{const data=await api('start_basket',{basket_id:basket.id});state.basketItems=data.items||[];state.basketInfo={...basket,base_price:data.result?.commercial_total??basket.base_price};await syncRoom(false);renderBasket()}catch(e){showState(e.message)}}
  function renderBasket(){state.view='basket';setHead('Cesta selecionada','Personalize se quiser',false);const host=$('content');host.innerHTML='';const hero=document.createElement('div');hero.className='basket-hero';hero.innerHTML=`<img src="${esc(state.basketInfo?.image_url||fallback)}" alt=""><div><div class="eyebrow">Cesta Básica</div><h2>${esc(state.basketInfo?.name||'Sua cesta')}</h2><p>Os produtos da cesta não exibem valores individuais.</p><strong>${money(state.cart?.total||state.basketInfo?.base_price||0)}</strong></div>`;host.appendChild(hero);const wrap=document.createElement('div');wrap.className='basket-editor';for(const i of state.basketItems){const p=i.product||{},row=document.createElement('div');row.className='basket-item';row.innerHTML=`<img src="${esc(p.image_url||fallback)}" alt=""><div><h3>${esc(p.name||'Produto')}</h3><small>Item da cesta</small></div><div class="qty-control"><button class="minus" type="button">−</button><span>${Number(i.quantity||0)}</span><button class="plus" type="button">+</button></div>`;row.querySelector('.minus').onclick=()=>changeBasketItem(i,-1,row);row.querySelector('.plus').onclick=()=>changeBasketItem(i,1,row);wrap.appendChild(row)}host.appendChild(wrap);showContent();updateCartBar()}
  async function changeBasketItem(item,delta,row){const next=Math.max(0,Number(item.quantity||0)+delta);if(next===Number(item.quantity||0))return;row.classList.add('busy');try{const data=await api('set_basket_quantity',{product_id:item.product_id,quantity:next});item.quantity=next;if(data.cart)state.cart={...(state.cart||{}),total:data.cart.commercial_total??state.cart?.total};renderBasket()}catch(e){toast(e.message)}finally{row.classList.remove('busy')}}

  async function loadCheckout(){state.view='checkout';setHead('Conferência','Confira antes de confirmar',false);showState('Preparando seu pedido...');try{const data=await api('checkout_preview');state.checkout=data.checkout;renderCheckout()}catch(e){showState(e.message)}}
  function renderCheckout(){
    const c=state.checkout||{},host=$('content');host.innerHTML='';const wrap=document.createElement('div');wrap.className='checkout';
    const order=document.createElement('div');order.className='checkout-card';const lines=(c.items||[]).map(i=>`<div class="order-line"><span>${esc(i.quantity)}× ${esc(i.name)}</span><span>${i.source==='basket'?'incluído':money(i.line_total)}</span></div>`).join('');order.innerHTML=`<h2>Seu pedido</h2>${lines}<div class="total-line"><span>Total</span><strong>${money(c.cart?.total)}</strong></div>`;wrap.appendChild(order);

    const customer=document.createElement('div');customer.className='checkout-card checkout-customer';const known=c.customer||state.customer||{};customer.innerHTML=`<h2>Seus dados</h2><div class="checkout-customer-grid"><label class="wide">Nome<input id="checkoutName" autocomplete="name" value="${esc(known.name||'')}"></label><label class="wide">WhatsApp com DDD<input id="checkoutPhone" inputmode="tel" autocomplete="tel" value="${esc(known.phone||'')}"></label>${c.requires_document?'<label class="wide">CPF para localizar/cadastrar no Bling<input id="checkoutDocument" inputmode="numeric" autocomplete="off" placeholder="Somente números"></label>':''}</div><div class="checkout-note${c.requires_document?' warning':''}">${c.requires_document?'O CPF é solicitado somente no fechamento para localizar ou cadastrar corretamente o cliente no ERP.':'Seu cadastro já está identificado para este pedido.'}</div>`;wrap.appendChild(customer);

    const address=document.createElement('div');address.className='checkout-card';address.innerHTML='<h2>Endereço de entrega</h2><div id="addressChoices" class="address-list"></div><div id="newAddressForm" class="address-form"><input class="wide" id="street" placeholder="Rua"><input id="number" placeholder="Número"><input id="neighborhood" placeholder="Bairro"><input class="wide" id="complement" placeholder="Complemento"><input class="wide" id="reference" placeholder="Referência"><input id="city" placeholder="Cidade" value="Cuiabá"><input id="state" placeholder="UF" value="MT"><input class="wide" id="postal" placeholder="CEP"></div><label class="save-address-row"><input id="saveAddress" type="checkbox" checked> Salvar este endereço para a próxima compra</label>';wrap.appendChild(address);
    const choices=address.querySelector('#addressChoices');const addresses=c.addresses||[];addresses.forEach((a,idx)=>{const label=document.createElement('label');label.className='address-option';label.innerHTML=`<input type="radio" name="address" value="${idx}" ${idx===0?'checked':''}><span><strong>${esc(a.label||'Endereço')}</strong><br>${esc(a.street)}, ${esc(a.number)} · ${esc(a.neighborhood||'')} · ${esc(a.city||'')}</span>`;choices.appendChild(label)});if(addresses.length){const other=document.createElement('label');other.className='address-option';other.innerHTML='<input type="radio" name="address" value="new"><span><strong>Usar outro endereço</strong><br>Preencher abaixo</span>';choices.appendChild(other)}
    const form=address.querySelector('#newAddressForm');const save=address.querySelector('#saveAddress');const refreshAddressVisibility=()=>{const sel=document.querySelector('input[name="address"]:checked');const isNew=!sel||sel.value==='new';form.classList.toggle('hidden',!isNew);save.parentElement.classList.toggle('hidden',!isNew)};choices.addEventListener('change',refreshAddressVisibility);refreshAddressVisibility();

    const payment=document.createElement('div');payment.className='checkout-card payment-card';payment.innerHTML='<span>🚚</span><div><strong>Pagamento na entrega</strong><small>O pedido é apenas encomendado agora. O pagamento acontece presencialmente na entrega.</small></div>';wrap.appendChild(payment);
    const err=document.createElement('div');err.id='checkoutError';err.className='checkout-error hidden';wrap.appendChild(err);
    const confirm=document.createElement('button');confirm.id='confirmOrderButton';confirm.className='confirm-order';confirm.type='button';confirm.textContent='Confirmar pedido';confirm.onclick=confirmOrder;wrap.appendChild(confirm);
    const wa=document.createElement('button');wa.className='whatsapp-secondary';wa.type='button';wa.textContent='Continuar pelo WhatsApp';wa.onclick=returnWhatsapp;wrap.appendChild(wa);host.appendChild(wrap);showContent();updateCartBar();
  }
  function newAddress(){return {street:text($('street')?.value),number:text($('number')?.value),neighborhood:text($('neighborhood')?.value),complement:text($('complement')?.value),reference:text($('reference')?.value),city:text($('city')?.value),state:text($('state')?.value),postal_code:text($('postal')?.value)}}
  async function confirmOrder(){
    const btn=$('confirmOrderButton'),err=$('checkoutError');if(btn){btn.disabled=true;btn.textContent='Confirmando…'}if(err)err.classList.add('hidden');
    try{
      const name=text($('checkoutName')?.value),phone=text($('checkoutPhone')?.value),document=text($('checkoutDocument')?.value);const identified=await api('identify',{name,phone,document});state.customer={...(state.customer||{}),...(identified.customer||{})};if(identified.customer?.requires_document)throw new Error('Informe o CPF para concluir o pedido.');
      let address={};const selected=document.querySelector('input[name="address"]:checked');const addresses=state.checkout?.addresses||[];const usingSaved=selected&&selected.value!=='new'&&addresses[Number(selected.value)];if(usingSaved)address=addresses[Number(selected.value)];else{address=newAddress();if($('saveAddress')?.checked)await api('save_address',{delivery_address:address})}
      const data=await api('confirm_order',{delivery_address:address});state.whatsapp=data.whatsapp_url||state.whatsapp;state.view='success';setHead('Pedido recebido','Tudo certo',false);$('content').innerHTML=`<div class="success"><div class="check">✅</div><h2>Pedido recebido</h2><p>Total ${money(data.order?.total)}. Agora o sistema vai validar e registrar o pedido no Bling. A confirmação final também ficará vinculada ao seu WhatsApp.</p><button id="successWhatsapp" class="whatsapp-secondary" type="button">Abrir conversa no WhatsApp</button></div>`;showContent();$('cartBar').classList.add('hidden');$('composer').classList.add('hidden');$('successWhatsapp').onclick=()=>location.href=state.whatsapp;
    }catch(e){if(err){err.textContent=e.message;err.classList.remove('hidden')}else toast(e.message);if(btn){btn.disabled=false;btn.textContent='Confirmar pedido'}}
  }

  async function returnWhatsapp(){try{const data=await api('return_whatsapp');location.href=data.whatsapp_url||state.whatsapp||C.whatsappFallback}catch{location.href=state.whatsapp||C.whatsappFallback}}
  async function syncRoom(render=true){const data=await api('open');if(data.closed){state.session=data.session;state.whatsapp=data.whatsapp_url||state.whatsapp;state.view='success';setHead('Pedido','Pedido recebido',false);$('content').innerHTML=`<div class="success"><div class="check">✅</div><h2>Pedido recebido</h2><p>${data.order?`Total ${money(data.order.total)}.`:'Seu pedido foi registrado.'}</p><button id="closedWhatsapp" class="whatsapp-secondary" type="button">Falar no WhatsApp</button></div>`;showContent();$('cartBar').classList.add('hidden');$('composer').classList.add('hidden');setTimeout(()=>{$('closedWhatsapp').onclick=returnWhatsapp},0);return}state.session=data.session;state.customer=data.customer;state.groups=data.groups||[];state.baskets=data.baskets||[];state.recommended=data.recommended||[];state.cart=data.cart;state.messages=data.messages||[];state.whatsapp=data.whatsapp_url||state.whatsapp;$('roomStatus').textContent='Sala de Compra · online';renderChat();updateCartBar();if(render)renderHome()}
  async function sendMessage(message){const value=text(message);if(!value)return;state.messages.push({direction:'inbound',message_type:'text',body_text:value});renderChat();$('messageInput').value='';try{const data=await api('send_text',{message:value});state.messages.push({direction:'outbound',message_type:'text',body_text:data.reply});renderChat();const ui=data.ui||{};if(ui.type==='baskets')loadBaskets();else if(ui.type==='products')loadProducts({category:ui.category||'',offers:!!ui.offers,q:ui.q||''});else if(ui.type==='checkout'||ui.type==='checkout_hint')loadCheckout()}catch(e){toast(e.message)}}

  async function uploadMedia(kind,file,durationMs=0){
    const previewUrl=URL.createObjectURL(file);const temp={direction:'inbound',message_type:kind,media_url:previewUrl,temp:true};state.messages.push(temp);renderChat();
    try{const data=await apiForm(kind,file,durationMs);Object.assign(temp,data.message||{}, {temp:false});toast(kind==='audio'?'Áudio enviado.':'Foto enviada.');renderChat()}catch(e){state.messages=state.messages.filter(x=>x!==temp);renderChat();toast(e.message)}finally{setTimeout(()=>URL.revokeObjectURL(previewUrl),60000)}
  }
  function preferredAudioMime(){const list=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];return list.find(x=>window.MediaRecorder?.isTypeSupported?.(x))||''}
  async function startRecording(){
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Este navegador não permite gravar áudio aqui.');return}
    try{recordStream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=preferredAudioMime();recorder=new MediaRecorder(recordStream,mime?{mimeType:mime}:undefined);recordChunks=[];recordCancelled=false;recordStarted=Date.now();recorder.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data)};recorder.onstop=async()=>{clearInterval(recordTimer);$('recordingBar').classList.add('hidden');$('composer').classList.remove('recording');recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;if(recordCancelled||!recordChunks.length)return;const type=recorder.mimeType||recordChunks[0]?.type||'audio/webm';const blob=new Blob(recordChunks,{type});const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';const file=new File([blob],`audio-${Date.now()}.${ext}`,{type});await uploadMedia('audio',file,Date.now()-recordStarted)};recorder.start(250);$('recordingBar').classList.remove('hidden');$('composer').classList.add('recording');$('recordingTime').textContent='0:00';recordTimer=setInterval(()=>{const s=Math.floor((Date.now()-recordStarted)/1000);$('recordingTime').textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;if(s>=90)stopRecording()},500)}catch{toast('Não foi possível acessar o microfone.')}
  }
  function stopRecording(){if(recorder&&recorder.state!=='inactive')recorder.stop()}
  function cancelRecording(){recordCancelled=true;stopRecording()}

  async function init(){
    if(suppliedToken&&!/^[a-f0-9]{64}$/i.test(suppliedToken)){showState('Este link da Sala de Compra é inválido ou incompleto.');$('composer').classList.add('hidden');return}
    try{
      if(!token){showState('Preparando sua Sala de Compra...');const data=await api('create_web_room');token=data.token;createdFromSite=true;history.replaceState({},'',`${location.pathname}?s=${encodeURIComponent(token)}`)}
      await syncRoom(true);
    }catch(e){showState(e.message==='Esta Sala de Compra expirou.'?'Esta Sala de Compra expirou. Volte ao WhatsApp para abrir uma nova.':e.message||'Não foi possível abrir sua Sala de Compra.')}
  }

  document.querySelectorAll('[data-home]').forEach(b=>b.onclick=()=>{const id=b.dataset.home;if(id==='baskets')loadBaskets();else if(id==='offers')loadProducts({offers:true});else loadProducts({category:id})});
  $('homeButton').onclick=renderHome;$('cartButton').onclick=loadCheckout;$('reviewButton').onclick=loadCheckout;
  $('backButton').onclick=()=>{if(history.length>1)history.back();else if(state.whatsapp)returnWhatsapp();else location.href='/'};
  $('searchButton').onclick=()=>loadProducts({q:$('searchInput').value});$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadProducts({q:e.target.value})}});
  $('composer').addEventListener('submit',e=>{e.preventDefault();sendMessage($('messageInput').value)});
  $('attachButton').onclick=()=>$('photoInput').click();$('photoInput').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(file)await uploadMedia('image',file)});
  $('micButton').onclick=()=>recorder&&recorder.state==='recording'?stopRecording():startRecording();$('cancelRecording').onclick=cancelRecording;
  window.addEventListener('beforeunload',()=>recordStream?.getTracks().forEach(t=>t.stop()));
  init();
})();