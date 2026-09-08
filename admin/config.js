window.DA_ADMIN_V3_CONFIG = Object.freeze({
  supabaseUrl: 'https://ssbesxgaijknwsjbsbcz.supabase.co',
  supabasePublishableKey: 'sb_publishable_tFXHtH0HCXZepVtwgKElIg_DxS76Gu8',
  edgeFunction: 'admin-ops-v1',
  whatsappOpsEdgeFunction: 'admin-whatsapp-ops-v1',
  humanServiceCenterUiEnabled: false,
  humanCopilotEnabled: false,
  experienceOrchestratorEdgeFunction: 'admin-experience-orchestrator-v1',
  experienceOrchestratorUiEnabled: false,
  automationBuilderEdgeFunction: 'admin-automation-builder-v1',
  automationBuilderUiEnabled: false,
  logisticsEdgeFunction: 'admin-logistics-v1',
  logisticsUiEnabled: false,
  commercialTruthEdgeFunction: 'admin-commercial-truth-v1',
  commercialTruthUiEnabled: false,
  driverAppUrl: '../driver-app/',
  countAppUrl: '../contagem/',
  build: '20260908-human-service-center-foundation-01'
});

(function loadHumanServiceCenter(cfg){
  if(!cfg?.humanServiceCenterUiEnabled)return;
  const view=document.querySelector('.view[data-view="whatsapp"]');
  if(!view)return;
  const legacy=view.querySelector('.grid-two');
  if(legacy&&!legacy.id)legacy.id='waLegacyOpsGrid';
  let mount=document.getElementById('humanServiceCenterMount');
  if(!mount){
    mount=document.createElement('section');
    mount.id='humanServiceCenterMount';
    mount.className='panel hidden';
    const metrics=document.getElementById('waOpsMetrics');
    (metrics||view.firstElementChild)?.insertAdjacentElement('afterend',mount);
  }
  if(!document.querySelector('link[data-human-service-center]')){
    const link=document.createElement('link');
    link.rel='stylesheet';link.href='../admin-v3/human-service-center.css?v=20260908-01';link.dataset.humanServiceCenter='1';
    document.head.appendChild(link);
  }
  if(!document.querySelector('script[data-human-service-center]')){
    const script=document.createElement('script');
    script.src='../admin-v3/human-service-center.js?v=20260908-01';script.dataset.humanServiceCenter='1';
    script.onload=()=>window.DAHumanServiceCenter?.mount(mount);
    document.body.appendChild(script);
  }
})(window.DA_ADMIN_V3_CONFIG);
