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
    registerReturn(intent);
    if(button){
      button.disabled=true;
      button.textContent="Abrindo WhatsApp…";
    }
    location.href=`https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
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
