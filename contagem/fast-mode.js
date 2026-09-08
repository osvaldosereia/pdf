(function () {
  'use strict';

  const C = window.DA_COUNT_CONFIG || {};
  const FAST_EDGE = 'inventory-fast-v1';
  const K = {
    auth: 'da_count_v2_auth',
    session: 'da_count_v2_session',
    recent: 'da_count_v2_recent',
    mode: 'da_count_fast_mode',
    known: 'da_count_fast_known_v1',
    unknown: 'da_count_fast_unknown_v1',
    catalog: 'da_count_fast_catalog_v1'
  };
  const PLACEHOLDER = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#f2f2ee"/><text x="50%" y="52%" text-anchor="middle" fill="#8a8f88" font-family="Arial" font-size="14">sem foto</text></svg>');
  const $ = id => document.getElementById(id);
  const txt = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const dig = v => String(v ?? '').replace(/\D/g, '');
  const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  let auth = read(K.auth, null);
  let catalog = [];
  let catalogIndex = new Map();
  let catalogLoading = false;
  let catalogReady = false;
  let autoTimer = null;
  let finishing = false;
  let mode = localStorage.getItem(K.mode) === 'fast' ? 'fast' : 'detail';
  const resolvingUnknown = new Map();
  const earlyScans = [];

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function toast(message, kind = '') {
    const region = $('toastRegion');
    if (!region) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`.trim();
    el.textContent = message;
    region.appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 5200 : 2600);
  }
  function fastStatus(message, kind = '') {
    const el = $('fastStatus');
    if (!el) return;
    el.textContent = message;
    el.className = `note ${kind}`.trim();
  }
  function feedback(kind) {
    const card = $('fastLastRead');
    if (card) {
      card.classList.remove('ok', 'warn', 'error', 'pulse');
      card.classList.add(kind === 'known' ? 'ok' : kind === 'unknown' ? 'warn' : 'error', 'pulse');
      setTimeout(() => card.classList.remove('pulse'), 180);
    }
    if (navigator.vibrate) navigator.vibrate(kind === 'known' ? 18 : [45, 35, 45]);
  }
  function codeVariants(value) {
    const raw = txt(value).toUpperCase();
    const numeric = dig(raw);
    const base = numeric || raw;
    if (!base) return [];
    const out = [base];
    if (/^\d+$/.test(base)) {
      if (base.length === 12) out.push(`0${base}`);
      if (base.length === 13 && base[0] === '0') out.push(base.slice(1));
      const noZero = base.replace(/^0+(?=\d)/, '');
      if (noZero) out.push(noZero);
    }
    return [...new Set(out)];
  }
  function imageOf(p) {
    const raw = txt(p?.image_url || p?.url_imagem || p?.imagem_url || p?.imagem);
    if (!raw) return PLACEHOLDER;
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
    return `../${raw.replace(/^\/+/, '')}`;
  }
  function nameOf(p, fallback = 'Produto sem nome') {
    return txt(p?.name || p?.nome || p?.titulo || p?.sku || p?.codigo) || fallback;
  }

  async function refreshAuth() {
    auth = read(K.auth, null);
    if (!auth?.refresh_token) throw new Error('Sessão expirada. Entre novamente.');
    const r = await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: C.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.refresh_token })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) throw new Error('Sessão expirada. Entre novamente.');
    auth = data;
    write(K.auth, data);
  }

  async function callFunction(slug, action, payload = {}, retry = true) {
    auth = read(K.auth, auth);
    if (!auth?.access_token) throw new Error('Faça login.');
    const r = await fetch(`${C.supabaseUrl}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        apikey: C.supabasePublishableKey,
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && retry) {
      await refreshAuth();
      return callFunction(slug, action, payload, false);
    }
    if (!r.ok || data.ok === false) {
      const e = new Error(data.detail || data.error || `Erro ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return data;
  }

  async function countApi(action, payload = {}) {
    return callFunction(C.edgeFunction || 'inventory-count-v2', action, payload);
  }
  async function fastApi(action, payload = {}) {
    return callFunction(FAST_EDGE, action, payload);
  }

  function indexCatalog(rows) {
    catalog = Array.isArray(rows) ? rows : [];
    catalogIndex = new Map();
    for (const p of catalog) {
      const values = [p?.gtin, p?.firebase_key, p?.sku];
      for (const value of values) {
        for (const variant of codeVariants(value)) {
          if (variant && !catalogIndex.has(variant)) catalogIndex.set(variant, p);
        }
      }
    }
    catalogReady = true;
    updateCatalogBadge();
  }

  async function loadFastCatalog(force = false) {
    if (catalogLoading) return;
    catalogLoading = true;
    const cached = read(K.catalog, null);
    if (!force && cached?.products?.length) indexCatalog(cached.products);
    fastStatus(catalogReady ? 'Atualizando catálogo em segundo plano…' : 'Carregando produtos para leitura instantânea…', 'busy');
    try {
      const data = await fastApi('catalog');
      indexCatalog(data.products || []);
      write(K.catalog, { generated_at: data.generated_at, products: data.products || [] });
      fastStatus(`${data.total || 0} produtos prontos para leitura rápida.`, 'success');
      drainEarlyScans();
    } catch (e) {
      if (catalogReady) {
        fastStatus('Usando catálogo salvo no aparelho. Sincronize quando houver internet.', 'warning');
        drainEarlyScans();
      } else {
        fastStatus(e.message || 'Não foi possível carregar o catálogo.', 'error');
      }
    } finally {
      catalogLoading = false;
      focusScanner();
    }
  }

  function updateCatalogBadge() {
    const el = $('fastCatalogBadge');
    if (el) el.textContent = String(catalog.length);
  }

  function knownRows() { return read(K.known, []); }
  function unknownRows() { return read(K.unknown, []); }
  function setKnown(rows) { write(K.known, rows); renderFast(); }
  function setUnknown(rows) { write(K.unknown, rows); renderFast(); }

  function incrementKnown(product, code) {
    const rows = knownRows();
    const key = product.id || dig(product.gtin) || txt(product.sku);
    let row = rows.find(r => r.key === key);
    if (!row) {
      row = {
        key,
        product_id: product.id,
        code: dig(product.gtin) || txt(code),
        name: nameOf(product),
        quantity: 0,
        product
      };
      rows.unshift(row);
    }
    row.quantity += 1;
    row.last_scanned_at = new Date().toISOString();
    write(K.known, rows);
    showLast(row.name, row.quantity, 'known');
    renderFast();
  }

  function ensureUnknown(code) {
    const rows = unknownRows();
    const normalized = dig(code) || txt(code).toUpperCase();
    let row = rows.find(r => r.code === normalized);
    if (!row) {
      row = {
        code: normalized,
        name: 'Verificando cadastro…',
        image: PLACEHOLDER,
        quantity: 0,
        status: 'checking',
        first_scanned_at: new Date().toISOString()
      };
      rows.unshift(row);
    }
    row.quantity += 1;
    row.last_scanned_at = new Date().toISOString();
    write(K.unknown, rows);
    renderFast();
    return row;
  }

  function patchUnknown(code, patch) {
    const normalized = dig(code) || txt(code).toUpperCase();
    const rows = unknownRows();
    const row = rows.find(r => r.code === normalized);
    if (!row) return;
    Object.assign(row, patch);
    write(K.unknown, rows);
    renderFast();
  }

  function showLast(name, quantity, kind) {
    const n = $('fastLastName');
    const q = $('fastLastQty');
    const s = $('fastLastState');
    if (n) n.textContent = name;
    if (q) q.textContent = quantity ? `× ${quantity}` : '';
    if (s) s.textContent = kind === 'known' ? 'CADASTRADO · +1' : kind === 'unknown' ? 'PENDÊNCIA' : 'ERRO';
    feedback(kind);
  }

  function findCatalogProduct(code) {
    for (const v of codeVariants(code)) {
      const p = catalogIndex.get(v);
      if (p) return p;
    }
    return null;
  }

  function firebaseProductUrl(key) {
    const base = String(C.firebaseUrl || '').replace(/\/+$/, '');
    const node = String(C.firebaseProductsNode || 'produtos').replace(/^\/+|\/+$/g, '');
    return `${base}/${node}/${encodeURIComponent(key)}.json`;
  }
  async function getJson(url) {
    const r = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Consulta ${r.status}`);
    return r.json();
  }
  async function findLegacyProduct(code) {
    const variants = codeVariants(code);
    for (const v of variants) {
      try {
        const p = await getJson(firebaseProductUrl(v));
        if (p && typeof p === 'object') return { key: v, product: p };
      } catch {}
    }
    return null;
  }

  async function resolveUnknown(code) {
    const normalized = dig(code) || txt(code).toUpperCase();
    if (resolvingUnknown.has(normalized)) return resolvingUnknown.get(normalized);
    const task = (async () => {
      try {
        const direct = await fastApi('lookup', { code: normalized });
        if (direct?.product) {
          promoteUnknownToKnown(normalized, direct.product);
          return;
        }
      } catch {}

      try {
        const found = await findLegacyProduct(normalized);
        if (found?.product) {
          try {
            const exact = await fastApi('lookup', { code: normalized, firebase_key: found.key });
            if (exact?.product) {
              promoteUnknownToKnown(normalized, exact.product);
              return;
            }
          } catch {}
          const p = found.product;
          patchUnknown(normalized, {
            name: nameOf(p, `EAN ${normalized}`),
            image: imageOf(p),
            firebase_key: found.key,
            status: 'not_registered'
          });
          showLast(nameOf(p, `EAN ${normalized}`), unknownQty(normalized), 'unknown');
          fastStatus('Produto identificado no cadastro antigo, mas ainda não está no banco novo.', 'warning');
          return;
        }
      } catch {}

      patchUnknown(normalized, {
        name: `EAN ${normalized}`,
        image: PLACEHOLDER,
        status: 'not_found'
      });
      showLast(`EAN ${normalized}`, unknownQty(normalized), 'unknown');
      fastStatus('EAN não localizado. Foi guardado na lista de pendências.', 'warning');
    })().finally(() => resolvingUnknown.delete(normalized));
    resolvingUnknown.set(normalized, task);
    return task;
  }

  function unknownQty(code) {
    const normalized = dig(code) || txt(code).toUpperCase();
    return unknownRows().find(r => r.code === normalized)?.quantity || 0;
  }

  function promoteUnknownToKnown(code, product) {
    const normalized = dig(code) || txt(code).toUpperCase();
    const rows = unknownRows();
    const idx = rows.findIndex(r => r.code === normalized);
    const qty = idx >= 0 ? rows[idx].quantity : 1;
    if (idx >= 0) rows.splice(idx, 1);
    write(K.unknown, rows);

    const known = knownRows();
    const key = product.id || dig(product.gtin) || txt(product.sku);
    let row = known.find(r => r.key === key);
    if (!row) {
      row = { key, product_id: product.id, code: dig(product.gtin) || normalized, name: nameOf(product), quantity: 0, product };
      known.unshift(row);
    }
    row.quantity += qty;
    row.last_scanned_at = new Date().toISOString();
    write(K.known, known);
    indexProduct(product);
    showLast(row.name, row.quantity, 'known');
    fastStatus('Produto encontrado no banco novo. Quantidade somada.', 'success');
    renderFast();
  }

  function indexProduct(product) {
    if (!product) return;
    if (!catalog.some(p => p.id === product.id)) catalog.push(product);
    for (const value of [product.gtin, product.firebase_key, product.sku]) {
      for (const variant of codeVariants(value)) if (variant) catalogIndex.set(variant, product);
    }
    updateCatalogBadge();
  }

  function submitCode(raw) {
    const code = dig(raw) || txt(raw).toUpperCase();
    if (!code) return;
    clearTimeout(autoTimer);
    const input = $('fastScanInput');
    if (input) input.value = '';

    if (!catalogReady) {
      earlyScans.push(code);
      fastStatus('Catálogo ainda está carregando; leitura guardada na fila.', 'busy');
      focusScanner();
      return;
    }

    const product = findCatalogProduct(code);
    if (product) {
      incrementKnown(product, code);
      fastStatus(`${nameOf(product)} · quantidade somada.`, 'success');
      focusScanner();
      return;
    }

    const row = ensureUnknown(code);
    showLast(row.name === 'Verificando cadastro…' ? `EAN ${code}` : row.name, row.quantity, 'unknown');
    fastStatus('Não está no catálogo carregado. Verificando cadastro…', 'busy');
    resolveUnknown(code);
    focusScanner();
  }

  function drainEarlyScans() {
    if (!catalogReady || !earlyScans.length) return;
    const pending = earlyScans.splice(0, earlyScans.length);
    pending.forEach(submitCode);
  }

  function focusScanner() {
    if (mode !== 'fast') return;
    const input = $('fastScanInput');
    if (!input) return;
    setTimeout(() => {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    }, 20);
  }

  function renderFast() {
    const known = knownRows();
    const unknown = unknownRows();
    const totalKnown = known.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const totalUnknown = unknown.reduce((sum, r) => sum + Number(r.quantity || 0), 0);

    if ($('fastTotalUnits')) $('fastTotalUnits').textContent = String(totalKnown);
    if ($('fastDistinctCount')) $('fastDistinctCount').textContent = String(known.length);
    if ($('fastUnknownCount')) $('fastUnknownCount').textContent = String(unknown.length);
    if ($('fastUnknownUnits')) $('fastUnknownUnits').textContent = String(totalUnknown);

    const knownList = $('fastCountedList');
    if (knownList) {
      knownList.innerHTML = known.length ? known.map(r => `
        <article class="fast-count-row" data-key="${esc(r.key)}">
          <div class="fast-count-name"><strong>${esc(r.name)}</strong><small>${esc(r.code || '')}</small></div>
          <div class="fast-qty-controls">
            <button type="button" data-fast-action="minus" data-key="${esc(r.key)}" aria-label="Diminuir">−</button>
            <b>${esc(r.quantity)}</b>
            <button type="button" data-fast-action="plus" data-key="${esc(r.key)}" aria-label="Aumentar">+</button>
          </div>
        </article>`).join('') : '<div class="fast-empty">Leia o primeiro produto. Cada nova leitura soma +1.</div>';
    }

    const unknownList = $('fastUnknownList');
    if (unknownList) {
      unknownList.innerHTML = unknown.length ? unknown.map(r => `
        <article class="fast-unknown-row">
          <img src="${esc(r.image || PLACEHOLDER)}" alt="" onerror="this.src='${esc(PLACEHOLDER)}'">
          <div><strong>${esc(r.name)}</strong><small>EAN ${esc(r.code)}</small><span>${r.status === 'checking' ? 'verificando…' : r.status === 'not_registered' ? 'não cadastrado no banco novo' : 'não localizado'}</span></div>
          <b>× ${esc(r.quantity)}</b>
          <button type="button" data-fast-action="remove-unknown" data-code="${esc(r.code)}" aria-label="Remover pendência">×</button>
        </article>`).join('') : '<div class="fast-empty">Nenhuma pendência.</div>';
    }

    const unknownSection = $('fastUnknownSection');
    if (unknownSection) unknownSection.classList.toggle('has-pending', unknown.length > 0);
  }

  function adjustKnown(key, delta) {
    const rows = knownRows();
    const row = rows.find(r => r.key === key);
    if (!row) return;
    row.quantity = Math.max(0, Number(row.quantity || 0) + delta);
    const next = rows.filter(r => r.quantity > 0);
    setKnown(next);
    focusScanner();
  }

  function removeUnknown(code) {
    setUnknown(unknownRows().filter(r => r.code !== code));
    focusScanner();
  }

  function sourceFromProduct(p) {
    return {
      firebaseKey: txt(p?.firebase_key),
      codigo: txt(p?.sku),
      sku: txt(p?.sku),
      nome: nameOf(p),
      gtin: dig(p?.gtin),
      ean: dig(p?.gtin),
      ncm: dig(p?.ncm),
      marca: txt(p?.brand),
      fornecedor: txt(p?.supplier),
      embalagem: txt(p?.packaging),
      unidade: txt(p?.unit),
      categoria: txt(p?.category),
      subcategoria: txt(p?.subcategory),
      subsubcategoria: txt(p?.subsubcategory),
      gondola: txt(p?.gondola),
      prateleira: txt(p?.shelf),
      validade: txt(p?.validity_date),
      url_imagem: txt(p?.image_url),
      estoque: num(p?.stock),
      preco: num(p?.price),
      preco_custo: num(p?.cost),
      ativo: p?.is_active !== false
    };
  }

  async function ensureSession() {
    let id = localStorage.getItem(K.session);
    if (id) return id;
    const data = await countApi('start', { device_label: 'Leitor-Rapido' });
    id = data.inventory_count_id;
    localStorage.setItem(K.session, id);
    return id;
  }

  function appendRecent(product, quantity, result) {
    const rows = read(K.recent, []);
    rows.unshift({
      id: result?.count_item_id || null,
      name: nameOf(product),
      gtin: dig(product?.gtin),
      stock: quantity,
      validity: product?.validity_date || null,
      image: imageOf(product),
      queued: false
    });
    write(K.recent, rows.slice(0, 30));
  }

  async function finishFastCount() {
    if (finishing) return;
    const rows = knownRows();
    if (!rows.length) {
      toast('Nenhum produto cadastrado foi lido.', 'warning');
      focusScanner();
      return;
    }
    if (!navigator.onLine) {
      fastStatus('Sem internet. A leitura está guardada no aparelho; salve quando a conexão voltar.', 'warning');
      toast('Contagem preservada no aparelho.', 'warning');
      return;
    }

    finishing = true;
    const button = $('fastFinishButton');
    if (button) { button.disabled = true; button.textContent = 'Salvando…'; }
    fastStatus(`Salvando ${rows.length} produtos consolidados…`, 'busy');

    let sessionId = null;
    let saved = 0;
    const failed = [];
    try {
      sessionId = await ensureSession();
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const p = row.product || {};
        const gtin = dig(p.gtin || row.code);
        if (!gtin) {
          failed.push({ row, error: 'EAN ausente no cadastro novo.' });
          continue;
        }
        try {
          const result = await countApi('save', {
            inventory_count_id: sessionId,
            firebase_key: txt(p.firebase_key),
            product: sourceFromProduct({ ...p, gtin }),
            counted_stock: Number(row.quantity),
            validity_date: p.validity_date || null,
            gondola: txt(p.gondola),
            shelf: txt(p.shelf)
          });
          appendRecent(p, row.quantity, result);
          saved += 1;
          fastStatus(`Salvando ${saved}/${rows.length} · ${nameOf(p)}…`, 'busy');
        } catch (e) {
          failed.push({ row, error: e.message || 'Falha ao salvar' });
        }
      }

      if (!failed.length && sessionId) {
        try { await countApi('close', { inventory_count_id: sessionId }); } catch {}
        localStorage.removeItem(K.session);
        write(K.known, []);
        renderFast();
        const pending = unknownRows().length;
        fastStatus(pending ? `Contagem salva. ${pending} pendência(s) continuam abaixo.` : 'Contagem rápida salva e finalizada.', pending ? 'warning' : 'success');
        toast(`${saved} produtos salvos.`, 'success');
      } else {
        write(K.known, failed.map(f => f.row));
        renderFast();
        fastStatus(`${saved} salvos; ${failed.length} ficaram para tentar novamente.`, 'warning');
        toast('Parte da contagem ficou pendente no aparelho.', 'warning');
      }
    } catch (e) {
      fastStatus(e.message || 'Falha ao salvar a contagem.', 'error');
      toast('A leitura continua guardada no aparelho.', 'error');
    } finally {
      finishing = false;
      if (button) { button.disabled = false; button.textContent = 'Salvar contagem'; }
      focusScanner();
    }
  }

  function clearFastSession() {
    write(K.known, []);
    renderFast();
    showLast('Pronto para ler', 0, 'known');
    fastStatus('Lista de produtos lidos limpa. Pendências não cadastradas foram preservadas.');
    focusScanner();
  }

  function setMode(next) {
    mode = next === 'fast' ? 'fast' : 'detail';
    localStorage.setItem(K.mode, mode);
    const app = $('app');
    const fast = $('fastMode');
    const button = $('modeToggleButton');
    if (!app || !fast || !button) return;

    app.classList.toggle('fast-mode-on', mode === 'fast');
    fast.classList.toggle('hidden', mode !== 'fast');
    button.classList.toggle('active', mode === 'fast');
    button.textContent = mode === 'fast' ? '☰ Contagem detalhada' : '⚡ Leitura rápida';

    if (mode === 'fast') {
      renderFast();
      loadFastCatalog();
      focusScanner();
    }
  }

  function syncAvailability() {
    const app = $('app');
    const button = $('modeToggleButton');
    if (!app || !button) return;
    const logged = !app.classList.contains('hidden');
    button.classList.toggle('hidden', !logged);
    if (logged) setMode(mode);
  }

  function bind() {
    const button = $('modeToggleButton');
    const input = $('fastScanInput');
    if (!button || !input) return;

    button.addEventListener('click', () => setMode(mode === 'fast' ? 'detail' : 'fast'));

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        submitCode(input.value);
      }
    });
    input.addEventListener('input', () => {
      clearTimeout(autoTimer);
      const value = dig(input.value);
      if (value.length >= 8) autoTimer = setTimeout(() => submitCode(input.value), 95);
    });
    input.addEventListener('blur', () => {
      if (mode === 'fast' && !finishing) setTimeout(focusScanner, 60);
    });

    document.addEventListener('keydown', e => {
      if (mode !== 'fast') return;
      const target = e.target;
      const interactive = target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
      if (interactive) return;
      if (document.activeElement !== input && (/^\d$/.test(e.key) || e.key === 'Enter')) {
        focusScanner();
        if (/^\d$/.test(e.key)) {
          e.preventDefault();
          input.value += e.key;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }, true);

    $('fastCountedList')?.addEventListener('click', e => {
      const el = e.target.closest('[data-fast-action]');
      if (!el) return;
      const action = el.dataset.fastAction;
      if (action === 'minus') adjustKnown(el.dataset.key, -1);
      if (action === 'plus') adjustKnown(el.dataset.key, 1);
    });
    $('fastUnknownList')?.addEventListener('click', e => {
      const el = e.target.closest('[data-fast-action="remove-unknown"]');
      if (el) removeUnknown(el.dataset.code);
    });
    $('fastFinishButton')?.addEventListener('click', finishFastCount);
    $('fastClearButton')?.addEventListener('click', clearFastSession);
    $('fastRefreshCatalogButton')?.addEventListener('click', () => loadFastCatalog(true));

    window.addEventListener('online', () => { if (mode === 'fast') loadFastCatalog(true); });
    window.addEventListener('pageshow', focusScanner);

    const app = $('app');
    if (app) new MutationObserver(syncAvailability).observe(app, { attributes: true, attributeFilter: ['class'] });
    syncAvailability();
    renderFast();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
