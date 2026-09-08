(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  function modeIsFast() {
    return $('app')?.classList.contains('fast-mode-on') || localStorage.getItem('da_count_fast_mode') === 'fast';
  }

  function render() {
    const app = $('app');
    const tabs = $('countModeTabs');
    const detail = $('detailModeTab');
    const fast = $('fastModeTab');
    if (!app || !tabs || !detail || !fast) return;

    tabs.classList.toggle('hidden', app.classList.contains('hidden'));
    const isFast = modeIsFast();
    detail.classList.toggle('active', !isFast);
    fast.classList.toggle('active', isFast);
    detail.setAttribute('aria-selected', String(!isFast));
    fast.setAttribute('aria-selected', String(isFast));
  }

  function select(wantFast) {
    const toggle = $('modeToggleButton');
    if (!toggle) return;
    const current = modeIsFast();
    if (current !== wantFast) toggle.click();
    setTimeout(render, 0);
  }

  function bind() {
    $('detailModeTab')?.addEventListener('click', () => select(false));
    $('fastModeTab')?.addEventListener('click', () => select(true));

    const app = $('app');
    if (app) new MutationObserver(render).observe(app, { attributes: true, attributeFilter: ['class'] });

    const toggle = $('modeToggleButton');
    if (toggle) new MutationObserver(render).observe(toggle, { attributes: true, attributeFilter: ['class'] });

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
