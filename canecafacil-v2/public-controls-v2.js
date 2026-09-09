const viewer = document.querySelector('#viewer');

function scenes() {
  return [...document.querySelectorAll('#viewer .scene')];
}

function activeIndex() {
  const list = scenes();
  if (!list.length) return -1;
  const viewportMiddle = viewer.getBoundingClientRect().top + viewer.clientHeight / 2;
  let best = 0;
  let bestDistance = Infinity;
  list.forEach((scene, index) => {
    const rect = scene.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    const distance = Math.abs(middle - viewportMiddle);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function go(delta) {
  const list = scenes();
  if (!list.length) return;
  const current = activeIndex();
  const next = Math.max(0, Math.min(list.length - 1, current + delta));
  list[next]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function installControls() {
  if (document.querySelector('.cf-desktop-pager')) return;
  const pager = document.createElement('div');
  pager.className = 'cf-desktop-pager';
  pager.setAttribute('aria-label', 'Navegar entre canecas');
  pager.innerHTML = `
    <button type="button" class="cf-page-arrow cf-page-prev" aria-label="Caneca anterior">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>
    </button>
    <button type="button" class="cf-page-arrow cf-page-next" aria-label="Próxima caneca">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
    </button>`;
  document.body.appendChild(pager);
  pager.querySelector('.cf-page-prev')?.addEventListener('click', () => go(-1));
  pager.querySelector('.cf-page-next')?.addEventListener('click', () => go(1));
}

function syncUrl() {
  const list = scenes();
  const index = activeIndex();
  const scene = list[index];
  if (!scene) return;
  const slug = scene.id.replace(/^produto-/, '');
  if (!slug) return;
  const url = new URL(location.href);
  if (url.searchParams.get('produto') === slug) return;
  url.searchParams.set('produto', slug);
  history.replaceState({}, '', url);
}

let syncTimer = 0;
viewer?.addEventListener('scroll', () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncUrl, 120);
}, { passive: true });

window.addEventListener('keydown', event => {
  if (document.querySelector('.overlay:not([hidden])')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') go(-1);
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') go(1);
});

const observer = new MutationObserver(() => installControls());
if (viewer) observer.observe(viewer, { childList: true });
installControls();
