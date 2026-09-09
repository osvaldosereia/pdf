(()=>{
  const API="https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/basket-shop-v1";
  const WHATSAPP_PHONE="556584491018";
  const token=new URLSearchParams(location.search).get("t")||"";

  const messageFor=intent=>intent==="order"
    ?"Quero encomendar a cesta que escolhi."
    :"Terminei de escolher os produtos adicionais da minha cesta. Pode finalizar meu pedido.";

  function registerReturn(intent){
    if(!/^[a-f0-9]{64}$/i.test(token))return;
    try{
      fetch(API,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"return",token,intent}),
        cache:"no-store",
        keepalive:true
      }).catch(()=>{});
    }catch{}
  }

  function openWhatsapp(intent,button){
    const message=messageFor(intent);
    const encoded=encodeURIComponent(message);
    const deep=`whatsapp://send?phone=${WHATSAPP_PHONE}&text=${encoded}`;
    const fallback=`https://api.whatsapp.com/send?phone=${WHATSAPP_PHONE}&text=${encoded}`;
    let appOpened=false;

    registerReturn(intent);

    if(button){
      button.disabled=true;
      button.textContent="Abrindo WhatsApp…";
    }

    const markOpened=()=>{appOpened=true};
    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="hidden")markOpened();
    },{once:true});
    window.addEventListener("pagehide",markOpened,{once:true});

    // Precisa ocorrer diretamente dentro do clique do usuário. Em navegadores
    // internos do WhatsApp, aguardar um fetch antes do deep link pode fazer o
    // navegador bloquear a abertura do próprio app.
    location.href=deep;

    // Se o esquema nativo não for atendido pelo aparelho, usa a URL web oficial.
    setTimeout(()=>{
      if(!appOpened&&document.visibilityState==="visible")location.href=fallback;
    },1200);

    setTimeout(()=>{
      if(!appOpened&&document.visibilityState==="visible"&&button){
        button.disabled=false;
        button.textContent="Abrir WhatsApp";
      }
    },2600);
  }

  document.addEventListener("click",event=>{
    const button=event.target.closest?.("#orderBtn,#sendBtn");
    if(!button)return;

    if(button.id==="sendBtn"&&/voltar\s+para\s+cesta/i.test(button.textContent||""))return;

    const intent=button.id==="orderBtn"?"order":"extras_done";
    event.preventDefault();
    event.stopImmediatePropagation();
    openWhatsapp(intent,button);
  },true);
})();
