(function () {
  'use strict';

  const C = window.DA_COUNT_CONFIG || {};
  const K = {
    auth: 'da_count_v2_auth',
    session: 'da_count_v2_session',
    queue: 'da_count_v2_queue',
    recent: 'da_count_v2_recent',
    device: 'da_count_v2_device'
  };
  const PLACEHOLDER = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="100%" height="100%" fill="#f2f2ee"/><text x="50%" y="52%" text-anchor="middle" fill="#8a8f88" font-family="Arial" font-size="16">sem foto</text></svg>');
  const $ = id => document.getElementById(id);
  const txt = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const dig = v => String(v ?? '').replace(/\D/g, '');
  const num = v => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : null; };

  let auth = read(K.auth, null);
  let product = null;
  let firebaseKey = '';
  let catalog = null;
  let stream = null;
  let detector = null;
  let timer = null;
  let busy = false;

  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  function toast(message, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`.trim();
    el.textContent = message;
    $('toastRegion').appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3200);
  }
  function lookupStatus(message, kind = '') { $('lookupStatus').textContent = message; $('lookupStatus').className = `note ${kind}`.trim(); }
  function saveStatus(message, kind = '') { $('saveStatus').textContent = message; $('saveStatus').className = `note ${kind}`.trim(); }
  function connection() {
    const online = navigator.onLine;
    $('connectionDot').className = `dot ${online ? 'online' : 'offline'}`;
    $('connectionLabel').textContent = online ? 'Supabase conectado' : 'Sem internet · fila local';
  }

  function device() {
    let value = localStorage.getItem(K.device);
    if (!value) {
      const family = /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : 'Browser';
      value = `${family}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      localStorage.setItem(K.device, value);
    }
    return value;
  }

  async function signIn(email, password) {
    const r = await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: C.supabasePublishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) throw new Error(data.error_description || data.msg || 'Login inválido.');
    auth = data; write(K.auth, data);
  }
  async function refresh() {
    if (!auth?.refresh_token) throw new Error('Sessão expirada.');
    const r = await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: C.supabasePublishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: auth.refresh_token })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) throw new Error('Sessão expirada.');
    auth = data; write(K.auth, data);
  }
  async function api(action, payload = {}, retry = true) {
    if (!auth?.access_token) throw new Error('Faça login.');
    const r = await fetch(`${C.supabaseUrl}/functions/v1/${C.edgeFunction}`, {
      method: 'POST',
      headers: { apikey: C.supabasePublishableKey, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && retry) { await refresh(); return api(action, payload, false); }
    if (!r.ok || data.ok === false) { const e = new Error(data.detail || data.error || `Erro ${r.status}`); e.status = r.status; e.code = data.error; throw e; }
    return data;
  }

  async function sessionId() {
    let id = localStorage.getItem(K.session);
    if (id) return id;
    const data = await api('start', { device_label: device() });
    id = data.inventory_count_id;
    localStorage.setItem(K.session, id);
    write(K.recent, []);
    renderRecent();
    return id;
  }

  function codeVariants(value) {
    const raw = dig(value) || txt(value).toUpperCase();
    if (!raw) return [];
    const out = [raw];
    if (/^\d+$/.test(raw)) {
      if (raw.length === 12) out.push(`0${raw}`);
      if (raw.length === 13 && raw[0] === '0') out.push(raw.slice(1));
      const noZero = raw.replace(/^0+(?=\d)/, ''); if (noZero) out.push(noZero);
    }
    return [...new Set(out)];
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
  async function loadCatalog() {
    if (catalog) return catalog;
    const r = await fetch(`${C.fallbackCatalogUrl}?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Catálogo de apoio indisponível.');
    catalog = await r.json();
    return catalog || {};
  }
  function match(p, key, variants) {
    return [key, p?.firebaseKey, p?.id, p?.gtin, p?.ean, p?.codigo, p?.sku]
      .map(v => txt(v).toUpperCase()).filter(Boolean)
      .some(v => variants.includes(v) || variants.includes(dig(v)));
  }
  async function findProduct(code) {
    const variants = codeVariants(code);
    for (const v of variants) {
      try {
        const p = await getJson(firebaseProductUrl(v));
        if (p && typeof p === 'object') return { key: v, product: p };
      } catch {}
    }
    const all = await loadCatalog();
    for (const [key, p] of Object.entries(all)) {
      if (!p || typeof p !== 'object' || !match(p, key, variants)) continue;
      try {
        const fresh = await getJson(firebaseProductUrl(key));
        if (fresh && typeof fresh === 'object') return { key, product: fresh };
      } catch {}
      return { key, product: p };
    }
    return null;
  }

  function nameOf(p) { return txt(p?.nome || p?.name || p?.titulo || p?.codigo) || 'Produto sem nome'; }
  function codeOf(p) { return txt(p?.gtin || p?.ean || p?.codigo || p?.sku); }
  function imgOf(p) {
    const raw = txt(p?.url_imagem || p?.imagem_url || p?.imagem);
    if (!raw) return PLACEHOLDER;
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
    return `../${raw.replace(/^\/+/, '')}`;
  }
  function brDate(v) {
    const raw = txt(v); if (!raw) return '';
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
  }
  function isoDate(v) {
    const raw = txt(v); if (!raw) return null;
    const m = raw.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/); if (!m) return null;
    const iso = `${m[3]}-${m[2]}-${m[1]}`; const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
  }

  async function search(code = $('eanInput').value) {
    code = txt(code); if (!code) return lookupStatus('Digite ou leia o EAN.', 'error');
    stopCamera(); lookupStatus(`Procurando ${code}…`, 'busy');
    $('productCard').classList.add('hidden'); $('notFoundCard').classList.add('hidden');
    try {
      const found = await findProduct(code);
      if (!found) {
        $('notFoundCode').textContent = code; $('notFoundCard').classList.remove('hidden'); lookupStatus('Produto não encontrado.', 'error'); return;
      }
      firebaseKey = found.key; product = found.product; showProduct(); lookupStatus('Encontrado no Firebase. Conte fisicamente.', 'success');
    } catch (e) { lookupStatus(e.message || 'Falha na consulta.', 'error'); }
  }
  function showProduct() {
    $('productCard').classList.remove('hidden');
    $('productImage').src = imgOf(product); $('productImage').onerror = function () { this.src = PLACEHOLDER; };
    $('productName').textContent = nameOf(product);
    $('productMeta').textContent = [codeOf(product), product?.marca, product?.embalagem, product?.categoria].map(txt).filter(Boolean).join(' · ');
    $('oldStock').textContent = num(product?.estoque) ?? '—';
    $('oldValidity').textContent = brDate(product?.validade || product?.data_validade) || '—';
    $('oldLocation').textContent = [product?.gondola || product?.['gôndola'], product?.prateleira].map(txt).filter(Boolean).join(' / ') || '—';
    $('stockInput').value = num(product?.estoque) ?? '';
    $('validityInput').value = brDate(product?.validade || product?.data_validade);
    $('gondolaInput').value = txt(product?.gondola || product?.['gôndola']); $('shelfInput').value = txt(product?.prateleira);
    $('eanInput').value = codeOf(product) || firebaseKey;
    saveStatus('Confirme quantidade e validade.');
    setTimeout(() => { $('stockInput').focus(); $('stockInput').select(); }, 60);
  }

  function sourcePayload() {
    return {
      firebaseKey, codigo: txt(product?.codigo || product?.sku), sku: txt(product?.sku || product?.codigo), nome: nameOf(product),
      gtin: dig(product?.gtin || product?.ean || $('eanInput').value), ean: dig(product?.ean || product?.gtin || $('eanInput').value),
      ncm: dig(product?.ncm), marca: txt(product?.marca), fornecedor: txt(product?.fornecedor), embalagem: txt(product?.embalagem), unidade: txt(product?.unidade),
      categoria: txt(product?.categoria), subcategoria: txt(product?.subcategoria), subsubcategoria: txt(product?.subsubcategoria),
      gondola: txt($('gondolaInput').value || product?.gondola || product?.['gôndola']), prateleira: txt($('shelfInput').value || product?.prateleira),
      validade: txt(product?.validade || product?.data_validade), url_imagem: txt(product?.url_imagem || product?.imagem_url || product?.imagem),
      estoque: num(product?.estoque), preco: num(product?.preco), preco_custo: num(product?.preco_custo), tags: Array.isArray(product?.tags) ? product.tags.slice(0, 30) : []
    };
  }
  function savePayload() {
    if (!product) throw new Error('Nenhum produto carregado.');
    const stock = num($('stockInput').value); if (stock === null || stock < 0 || !Number.isInteger(stock)) throw new Error('Estoque precisa ser um número inteiro igual ou maior que zero.');
    const rawDate = txt($('validityInput').value); const validity = rawDate ? isoDate(rawDate) : null; if (rawDate && !validity) throw new Error('Validade inválida. Use dd/mm/aaaa.');
    return { local_id: uid(), inventory_count_id: localStorage.getItem(K.session), firebase_key: firebaseKey, product: sourcePayload(), counted_stock: stock, validity_date: validity, gondola: txt($('gondolaInput').value), shelf: txt($('shelfInput').value), queued_at: new Date().toISOString() };
  }

  function queue() { return read(K.queue, []); }
  function setQueue(q) { write(K.queue, q); $('pendingBadge').textContent = String(q.length); }
  function addRecent(item) { const r = read(K.recent, []); r.unshift(item); write(K.recent, r.slice(0, 30)); renderRecent(); }
  function renderRecent() {
    const rows = read(K.recent, []); $('sessionCount').textContent = String(rows.length);
    $('recentList').innerHTML = rows.length ? rows.map(r => `<article class="recent-item"><img src="${esc(r.image || PLACEHOLDER)}" alt=""><div><strong>${esc(r.name)}</strong><small>${esc(r.gtin)}</small></div><div class="recent-values"><b>${esc(r.stock)}</b><small>${esc(brDate(r.validity) || 'sem validade')}</small></div><span class="sync-dot ${r.queued ? 'waiting' : 'done'}"></span></article>`).join('') : '<div class="empty">Nenhum produto contado nesta sessão.</div>';
  }

  async function saveCurrent() {
    if (busy) return;
    let payload; try { payload = savePayload(); } catch (e) { return saveStatus(e.message, 'error'); }
    busy = true; $('saveButton').disabled = true; $('saveButton').textContent = 'Salvando…';
    try {
      payload.inventory_count_id = await sessionId();
      const result = await api('save', payload);
      addRecent({ id: result.count_item_id, name: nameOf(product), gtin: payload.product.gtin, stock: payload.counted_stock, validity: payload.validity_date, image: imgOf(product), queued: false });
      toast('Produto salvo no Supabase.', 'success'); reset(true);
    } catch (e) {
      if (!navigator.onLine || !e.status || e.status >= 500) {
        const q = queue(); q.push(payload); setQueue(q);
        addRecent({ name: nameOf(product), gtin: payload.product.gtin, stock: payload.counted_stock, validity: payload.validity_date, image: imgOf(product), queued: true });
        toast('Sem conexão: contagem guardada no celular.', 'warning'); reset(false);
      } else saveStatus(e.message || 'Falha ao salvar.', 'error');
    } finally { busy = false; $('saveButton').disabled = false; $('saveButton').textContent = 'Salvar e próximo'; }
  }

  async function flushQueue() {
    if (!navigator.onLine || !auth?.access_token) return;
    const q = queue(); if (!q.length) return;
    const remaining = []; let sent = 0;
    for (const item of q) {
      try { item.inventory_count_id ||= await sessionId(); await api('save', item); sent++; }
      catch (e) { remaining.push(item); if (e.status && e.status < 500) break; }
    }
    setQueue(remaining); if (sent) { toast(`${sent} pendência(s) enviada(s).`, 'success'); await loadRecentServer(); }
  }
  async function loadRecentServer() {
    const id = localStorage.getItem(K.session); if (!id) return renderRecent();
    try {
      const data = await api('recent', { inventory_count_id: id, limit: 30 });
      const rows = (data.items || []).map(r => ({ id: r.id, name: r.product?.name || 'Produto', gtin: r.ean || '', stock: r.counted_stock, validity: r.validity_date, image: r.product?.image_url || PLACEHOLDER, queued: false }));
      write(K.recent, rows); renderRecent();
    } catch { renderRecent(); }
  }

  function reset(camera = false) {
    product = null; firebaseKey = ''; $('productCard').classList.add('hidden'); $('notFoundCard').classList.add('hidden'); $('eanInput').value = ''; lookupStatus('Pronto para o próximo produto.');
    setTimeout(() => camera ? startCamera() : $('eanInput').focus(), 150);
  }

  async function finishSession() {
    await flushQueue(); if (queue().length) return toast('Ainda existem pendências offline.', 'warning');
    const id = localStorage.getItem(K.session); if (!id) return;
    try {
      const data = await api('close', { inventory_count_id: id });
      toast(`Sessão finalizada com ${data.item_count || 0} produto(s).`, 'success');
      localStorage.removeItem(K.session); write(K.recent, []); renderRecent(); await sessionId();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function startCamera() {
    if (stream) return stopCamera();
    if (!navigator.mediaDevices?.getUserMedia || !('BarcodeDetector' in window)) return lookupStatus('Este navegador não tem leitura ao vivo. Digite o EAN.', 'warning');
    try {
      const supported = await BarcodeDetector.getSupportedFormats().catch(() => []);
      const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'].filter(x => !supported.length || supported.includes(x));
      detector = new BarcodeDetector(formats.length ? { formats } : undefined);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      $('video').srcObject = stream; $('cameraPanel').classList.remove('hidden'); $('cameraButton').textContent = 'Fechar câmera'; lookupStatus('Aponte para o código de barras.', 'busy'); scan();
    } catch { stopCamera(); lookupStatus('Não foi possível abrir a câmera. Digite o EAN.', 'error'); }
  }
  function scan() {
    clearTimeout(timer); if (!stream || !detector) return;
    timer = setTimeout(async () => {
      try { const codes = await detector.detect($('video')); const raw = txt(codes?.[0]?.rawValue); if (raw) { if (navigator.vibrate) navigator.vibrate(50); $('eanInput').value = raw; stopCamera(); return search(raw); } } catch {}
      scan();
    }, 320);
  }
  function stopCamera() {
    clearTimeout(timer); timer = null; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; detector = null;
    if ($('video')) $('video').srcObject = null; $('cameraPanel').classList.add('hidden'); $('cameraButton').textContent = '📷 Câmera';
  }

  async function authenticated() {
    const health = await api('health');
    $('loginCard').classList.add('hidden'); $('app').classList.remove('hidden'); $('logoutButton').classList.remove('hidden');
    $('userLabel').textContent = `${health.user?.display_name || 'Usuário'} · ${health.user?.role || 'operador'}`;
    connection(); await sessionId(); await loadRecentServer(); setQueue(queue()); flushQueue().catch(() => {});
  }
  function logout() { auth = null; localStorage.removeItem(K.auth); localStorage.removeItem(K.session); stopCamera(); $('app').classList.add('hidden'); $('logoutButton').classList.add('hidden'); $('loginCard').classList.remove('hidden'); }

  function bind() {
    $('loginForm').addEventListener('submit', async e => {
      e.preventDefault(); $('loginButton').disabled = true; $('loginStatus').textContent = 'Entrando…';
      try { await signIn($('emailInput').value.trim(), $('passwordInput').value); await authenticated(); $('loginStatus').textContent = ''; }
      catch (err) { $('loginStatus').textContent = err.code === 'admin_not_authorized' ? 'Conta válida, mas ainda não autorizada no Admin.' : err.message; }
      finally { $('loginButton').disabled = false; }
    });
    $('logoutButton').onclick = logout; $('cameraButton').onclick = startCamera; $('closeCameraButton').onclick = stopCamera; $('searchButton').onclick = () => search();
    $('eanInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    $('validityInput').addEventListener('input', e => { const r = e.target.value.replace(/\D/g, '').slice(0, 8); e.target.value = [r.slice(0, 2), r.slice(2, 4), r.slice(4, 8)].filter(Boolean).join('/'); });
    $('saveButton').onclick = saveCurrent; $('skipButton').onclick = () => reset(false); $('retryButton').onclick = () => { $('notFoundCard').classList.add('hidden'); $('eanInput').focus(); };
    $('syncQueueButton').onclick = () => flushQueue().catch(e => toast(e.message, 'error')); $('finishSessionButton').onclick = finishSession;
    window.addEventListener('online', () => { connection(); flushQueue().catch(() => {}); }); window.addEventListener('offline', connection);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  }

  async function init() {
    bind(); setQueue(queue()); renderRecent(); connection();
    if (auth?.access_token) {
      try { await authenticated(); }
      catch { auth = null; localStorage.removeItem(K.auth); $('loginStatus').textContent = 'Entre para iniciar a contagem.'; }
    }
  }
  init();
})();
