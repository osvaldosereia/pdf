(function(){
  'use strict';
  try {
    const adminKey='da_admin_v3_auth';
    const countKey='da_count_v2_auth';
    const adminRaw=localStorage.getItem(adminKey);
    const countRaw=localStorage.getItem(countKey);
    if(!countRaw && adminRaw){
      const a=JSON.parse(adminRaw);
      if(a && a.access_token && a.refresh_token) localStorage.setItem(countKey,adminRaw);
    }
    if(!adminRaw && countRaw){
      const a=JSON.parse(countRaw);
      if(a && a.access_token && a.refresh_token) localStorage.setItem(adminKey,countRaw);
    }
  } catch {}
})();
