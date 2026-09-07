(function(){
  'use strict';
  const stock=document.getElementById('stockInput');
  const note=document.getElementById('saveStatus');
  if(!stock||!note)return;
  const update=()=>{
    const raw=String(stock.value??'').trim();
    if(raw==='')return;
    const n=Number(raw.replace(',','.'));
    if(Number.isFinite(n)&&n===0){
      note.textContent='Estoque 0: o produto será salvo inativo e fora do WhatsApp.';
      note.className='note warning';
    }else if(Number.isFinite(n)&&n>0&&note.textContent.includes('Estoque 0:')){
      note.textContent='Confirme quantidade e validade.';
      note.className='note';
    }
  };
  stock.addEventListener('input',update);
  stock.addEventListener('change',update);
})();
