(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let wasFast=false;
  let focusTimer=null;

  function isFast(){
    return Boolean($('app')?.classList.contains('fast-mode-on'));
  }

  function scanner(){
    return $('fastScanInput');
  }

  function keepScannerReady(delay=0){
    clearTimeout(focusTimer);
    focusTimer=setTimeout(()=>{
      if(!isFast())return;
      const input=scanner();
      if(!input)return;
      // No modo rápido, nenhum erro/consulta pode bloquear novas leituras.
      input.disabled=false;
      input.readOnly=false;
      input.removeAttribute('disabled');
      input.removeAttribute('readonly');
      try{input.focus({preventScroll:true})}catch{try{input.focus()}catch{}}
    },delay);
  }

  function routeLegacyScanToFast(event){
    if(!isFast())return;
    const code=String($('eanInput')?.value||'').trim();
    if(!code)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const input=scanner();
    if(!input)return;
    input.disabled=false;
    input.readOnly=false;
    input.value=code;
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    if($('eanInput'))$('eanInput').value='';
    keepScannerReady(0);
  }

  function syncMode(){
    const app=$('app');
    if(!app)return;
    const fast=app.classList.contains('fast-mode-on');
    if(fast)keepScannerReady(0);
    if(wasFast&&!fast){
      setTimeout(()=>{
        try{$('retryButton')?.click()}catch{}
      },30);
    }
    wasFast=fast;
  }

  function bindContinuousScanner(){
    const input=scanner();
    if(!input)return;

    // Se qualquer script tentar bloquear o campo, desfaz imediatamente.
    new MutationObserver(()=>{
      if(!isFast())return;
      if(input.disabled||input.readOnly||input.hasAttribute('disabled')||input.hasAttribute('readonly')){
        input.disabled=false;
        input.readOnly=false;
        input.removeAttribute('disabled');
        input.removeAttribute('readonly');
      }
    }).observe(input,{attributes:true,attributeFilter:['disabled','readonly']});

    // Cada leitura devolve o foco antes que a consulta em segundo plano termine.
    input.addEventListener('keydown',e=>{
      if(!isFast())return;
      if(e.key==='Enter'||e.key==='Tab')keepScannerReady(0);
    },true);
    input.addEventListener('input',()=>{if(isFast())keepScannerReady(0)},true);
    input.addEventListener('blur',()=>{if(isFast())keepScannerReady(20)},true);

    // Erros de rede/lookup não podem deixar o leitor sem foco.
    window.addEventListener('unhandledrejection',()=>{if(isFast())keepScannerReady(0)});
    window.addEventListener('error',()=>{if(isFast())keepScannerReady(0)});
    window.addEventListener('online',()=>{if(isFast())keepScannerReady(0)});
    window.addEventListener('offline',()=>{if(isFast())keepScannerReady(0)});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isFast())keepScannerReady(0)});

    // Watchdog leve: garante operação contínua com leitores USB/Bluetooth tipo teclado.
    setInterval(()=>{
      if(!isFast())return;
      const active=document.activeElement;
      const interactive=active instanceof HTMLButtonElement||active instanceof HTMLAnchorElement;
      if(!interactive&&active!==input)keepScannerReady(0);
      if(input.disabled||input.readOnly){input.disabled=false;input.readOnly=false;}
    },350);
  }

  function loadStockOperation(){
    if(document.querySelector('script[data-fast-stock-operation]'))return;
    const script=document.createElement('script');
    script.src='./fast-stock-operation.js?v=20260908-01';
    script.async=false;
    script.dataset.fastStockOperation='1';
    document.head.appendChild(script);
  }

  function bind(){
    $('searchButton')?.addEventListener('click',routeLegacyScanToFast,true);
    const app=$('app');
    if(app)new MutationObserver(syncMode).observe(app,{attributes:true,attributeFilter:['class']});
    bindContinuousScanner();
    loadStockOperation();
    syncMode();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();