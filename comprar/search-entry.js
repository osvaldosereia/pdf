(()=>{
  'use strict';
  const params=new URLSearchParams(location.search);
  const query=(params.get('q')||'').trim().slice(0,120);
  if(!query)return;

  let attempts=0;
  const openSearch=()=>{
    const status=document.getElementById('roomStatus');
    const input=document.getElementById('searchInput');
    const button=document.getElementById('searchButton');
    const online=/online/i.test(status?.textContent||'');
    if(online&&input&&button){
      input.value=query;
      button.click();
      return;
    }
    if(++attempts<80)setTimeout(openSearch,125);
  };
  setTimeout(openSearch,125);
})();
