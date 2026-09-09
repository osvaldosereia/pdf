(() => {
  'use strict';
  const BUILD = '20260904-li-personalizador-embed-v3-chat';
  if (window.__CF_LI_PERSONALIZER_EMBED__ === BUILD) return;
  window.__CF_LI_PERSONALIZER_EMBED__ = BUILD;

  function safeStoreUrl(value) {
    try {
      const url = new URL(String(value || ''), 'https://canecafacil.com.br/');
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      return host === 'canecafacil.com.br' ? url.href : 'https://canecafacil.com.br/';
    } catch { return 'https://canecafacil.com.br/'; }
  }
  function close() {
    document.querySelector('#cfLiPersonalizerOverlay')?.remove();
    document.documentElement.style.overflow = '';
  }
  function open(url) {
    close();
    const overlay = document.createElement('div');
    overlay.id = 'cfLiPersonalizerOverlay';
    overlay.innerHTML = `<div class="cf-li-modal"><button class="cf-li-close" type="button" aria-label="Fechar">×</button><iframe src="${String(url).replace(/"/g, '&quot;')}" title="Personalizar caneca" allow="clipboard-write; microphone"></iframe></div>`;
    const style = document.createElement('style');
    style.textContent = '#cfLiPersonalizerOverlay{position:fixed;inset:0;z-index:2147483000;background:rgba(10,12,13,.72);display:grid;place-items:center;padding:18px}.cf-li-modal{position:relative;width:min(1040px,100%);height:min(92vh,900px);background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 22px 70px rgba(0,0,0,.35)}.cf-li-modal iframe{width:100%;height:100%;border:0}.cf-li-close{position:absolute;right:10px;top:10px;z-index:2;width:38px;height:38px;border:0;border-radius:50%;background:#111;color:#fff;font-size:24px;line-height:1;cursor:pointer}@media(max-width:640px){#cfLiPersonalizerOverlay{padding:0}.cf-li-modal{width:100%;height:100vh;border-radius:0}.cf-li-close{top:8px;right:8px}}';
    overlay.appendChild(style);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    overlay.querySelector('.cf-li-close')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a.cf-personalize-link');
    if (!link) return;
    event.preventDefault();
    open(link.href);
  });
  window.addEventListener('message', event => {
    if (event?.data?.type === 'canecafacil:close-personalizer') return close();
    if (event?.data?.type === 'canecafacil:return-to-store') {
      const url = safeStoreUrl(event.data.url);
      close();
      location.href = url;
    }
  });
  console.info(`CanecaFácil · personalizador Loja Integrada ${BUILD}`);
})();