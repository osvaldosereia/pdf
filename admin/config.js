window.DA_ADMIN_V3_CONFIG = Object.freeze({
  supabaseUrl: 'https://ssbesxgaijknwsjbsbcz.supabase.co',
  supabasePublishableKey: 'sb_publishable_tFXHtH0HCXZepVtwgKElIg_DxS76Gu8',
  edgeFunction: 'admin-ops-v1',
  categoryEdgeFunction: 'admin-product-categories-v1',
  whatsappOpsEdgeFunction: 'admin-whatsapp-ops-v1',
  humanServiceCenterUiEnabled: false,
  humanCopilotEnabled: false,
  humanCopilotEdgeFunction: 'admin-human-copilot-v1',
  financialAdminUiEnabled: false,
  financialEdgeFunction: 'admin-financial-v1',
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
  build: '20260908-basket-showcase-admin-02'
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
    link.rel='stylesheet';link.href='../admin-v3/human-service-center.css?v=20260908-02';link.dataset.humanServiceCenter='1';
    document.head.appendChild(link);
  }
  const loadCopilotPanel=()=>{
    if(!cfg.humanCopilotEnabled||document.querySelector('script[data-human-copilot-panel]'))return;
    const panel=document.createElement('script');
    panel.src='../admin-v3/human-copilot-panel.js?v=20260908-01';panel.dataset.humanCopilotPanel='1';document.body.appendChild(panel);
  };
  if(!document.querySelector('script[data-human-service-center]')){
    const script=document.createElement('script');
    script.src='../admin-v3/human-service-center.js?v=20260908-02';script.dataset.humanServiceCenter='1';
    script.onload=()=>{window.DAHumanServiceCenter?.mount(mount);loadCopilotPanel()};
    document.body.appendChild(script);
  }else{
    window.DAHumanServiceCenter?.mount(mount);loadCopilotPanel();
  }
})(window.DA_ADMIN_V3_CONFIG);

(function loadFinancialAdmin(cfg){
  if(!cfg?.financialAdminUiEnabled)return;
  const nav=document.getElementById('nav');
  const main=document.querySelector('.workspace main');
  if(!nav||!main)return;
  if(!document.querySelector('[data-route="financial"]')){
    const button=document.createElement('button');
    button.className='nav';button.type='button';button.dataset.route='financial';button.innerHTML='<span>FI</span>Financeiro';
    const queue=document.querySelector('.nav[data-route="queue"]');
    nav.insertBefore(button,queue||nav.lastElementChild);
  }
  let mount=document.getElementById('financialAdminMount');
  if(!mount){mount=document.createElement('section');mount.id='financialAdminMount';mount.className='view';mount.dataset.view='financial';main.appendChild(mount)}
  if(!document.querySelector('link[data-financial-admin]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='../admin-v3/financial-admin.css?v=20260908-01';link.dataset.financialAdmin='1';document.head.appendChild(link);
  }
  if(!document.querySelector('script[data-financial-admin]')){
    const script=document.createElement('script');script.src='../admin-v3/financial-admin.js?v=20260908-01';script.dataset.financialAdmin='1';script.onload=()=>window.DAFinancialAdmin?.mount(mount);document.body.appendChild(script);
  }
})(window.DA_ADMIN_V3_CONFIG);

(function loadProductCategoriesInline(cfg){
  if(!cfg?.categoryEdgeFunction)return;
  if(!document.querySelector('link[data-product-categories-inline]')){
    const link=document.createElement('link');
    link.rel='stylesheet';link.href='../admin-v3/product-categories-inline.css?v=20260908-02';link.dataset.productCategoriesInline='1';document.head.appendChild(link);
  }
  if(!document.querySelector('script[data-product-categories-inline]')){
    const script=document.createElement('script');
    script.src='../admin-v3/product-categories-inline.js?v=20260908-02';script.dataset.productCategoriesInline='1';document.body.appendChild(script);
  }
})(window.DA_ADMIN_V3_CONFIG);
