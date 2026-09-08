(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let wasFast=false;

  function routeLegacyScanToFast(event){
    const app=$('app');
    if(!app?.classList.contains('fast-mode-on'))return;
    const code=String($('eanInput')?.value||'').trim();
    if(!code)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const input=$('fastScanInput');
    if(!input)return;
    input.value=code;
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    if($('eanInput'))$('eanInput').value='';
  }

  function syncMode(){
    const app=$('app');
    if(!app)return;
    const fast=app.classList.contains('fast-mode-on');
    if(wasFast&&!fast){
      setTimeout(()=>{
        try{$('retryButton')?.click()}catch{}
      },30);
    }
    wasFast=fast;
  }

  function bind(){
    $('searchButton')?.addEventListener('click',routeLegacyScanToFast,true);
    const app=$('app');
    if(app)new MutationObserver(syncMode).observe(app,{attributes:true,attributeFilter:['class']});
    syncMode();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
