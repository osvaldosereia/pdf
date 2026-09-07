(function(){
  'use strict';

  const CONFIG = window.DA_COUNT_CONFIG || {};
  const AUTH_KEY = 'da_count_v2_auth';
  const SESSION_KEY = 'da_count_v2_inventory_session';
  const RECENT_KEY = 'da_count_v2_recent';
  const QUEUE_KEY = 'da_count_v2_queue';
  const DEVICE_KEY = 'da_count_v2_device';
  const CATALOG_TTL = 5 * 60 * 1000;
  const PLACEHOLDER = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="100%" height="100%" fill="#f2f2ee"/><text x="50%" y="52%" text-anchor="middle" fill="#8a8f88" font-family="Arial" font-size="16">sem foto</text></svg>');

  let auth = loadJson(AUTH_KEY, null);
  let currentProduct = null;
  let currentFirebaseKey = '';
  let stream = null;
  let detector = null;
  let scanTimer = null;
  let catalogCache = null;
  let catalogAt = 0;
  let saving = false;
  let lastScanned = '';
  let lastScannedAt = 0;

  const $ = id => document.getElementById(id);
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const digits = value => String(value ?? '').replace(/\D/g, '');
  const number = value => {
    const parsed = Number(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  };

  function loadJson(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; }
    catch { return fallback; }
  }
  function saveJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

  function toast(message, type = '') {
    const node = document.createElement('div');
    node.className = `toast ${type}`.trim();
    node.textContent = message;
    $('toastRegion').appendChild(node);
    setTimeout(() => node.remove(), type === 'error' ? 6500 : 3500);
  }

  function setLookupStatus(message, kind = '') {
    $('lookupStatus').textContent = message;
    $('lookupStatus').className = `note ${kind}`.trim();
  }
  function setSaveStatus(message, kind = '') {
    $('saveStatus').textContent = message;
    $('saveStatus').className = `note ${kind}`.trim();
  }

  function setConnection(online, label) {
    $('connectionDot').className = `dot ${online ? 'online' : 'offline'}`;
    $('connectionLabel').textContent = label || (online ? 'Online' : 'Offline');
  }

  function deviceLabel() {
    let value = localStorage.getItem(DEVICE_KEY);
    if (!value) {
      const ua = navigator.userAgent || 'celular';
      const family = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : 'Navegador';
      value = `${family}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      localStorage.setItem(DEVICE_KEY, value);
    }
    return value;
  }

  async function signIn(email, password) {
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CONFIG.supabasePublishableKey },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.error_description || data.msg || 'Não foi possível entrar.');
    auth = data;
    saveJson(AUTH_KEY, auth);
    return auth;
  }

  async function refreshAuth() {
    if (!auth?.refresh_token) throw new Error('Sessão expirada. Entre novamente.');
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CONFIG.supabasePublishableKey },
      body: JSON.stringify({ refresh_token: auth.refresh_token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error('Sessão expirada. Entre novamente.');
    auth = data;
    saveJson(AUTH_KEY, auth);
    return auth;
  }

  async function callApi(action, payload = {}, retry = true) {
    if (!auth?.access_token) throw new Error('Faça login primeiro.');
    const response = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${CONFIG.edgeFunction}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.access_token}`,
        'apikey': CONFIG.supabasePublishableKey
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && retry) {
      await refreshAuth();
      return callApi(action, payload, false);
    }
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.detail || data?.error || `Erro ${response.status}`);
      error.status = response.status;
      error.code = data?.error || '';
      throw error;
    }
    return data;
  }

  function logout() {
    auth = null;
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(SESSION_KEY);
    stopCamera();
    $('app').classList.add('hidden');
    $('logoutButton').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
    $('passwordInput').value = '';
    $('loginStatus').textContent = 'Sessão encerrada.';
  }

  async function bootstrapAuthenticated() {
    const health = await callApi('health');
    $('loginCard').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('logoutButton').classList.remove('hidden');
    $('userLabel').textContent = `${health.user?.display_name || 'Usuário'} · ${health.user?.role || 'operador'}`;
    setConnection(navigator.onLine, navigator.onLine ? 'Supabase conectado' : 'Sem internet');
    await ensureInventorySession();
    await renderRecent();
    updateQueueBadge();
    processQueue().catch(() => {});
  }

  async function ensureInventorySession() {
    let id = localStorage.getItem(SESSION_KEY);
    if (id) return id;
    const data = await callApi('start', { device_label: deviceLabel() });
    id = data.inventory_count_id;
    localStorage.setItem(SESSION_KEY, id);
    saveJson(RECENT_KEY, []);
    $('sessionCount').textContent = '0';
    return id;
  }

  function formatDate(value) {
    const raw = text(value);
    if (!raw) return '';
    let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    m = raw.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : raw;
  }

  function toIsoDate(value) {
    const raw = text(value);
    if (!raw) return null;
    let m = raw.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/);
    if (m) {
      const iso = `${m[3]}-${m[2]}-${m[1]}`;
      const date = new Date(`${iso}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
    }
    m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const date = new Date(`${raw}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
  }

  function normalizeImage(value) {
    const raw = text(value);
    if (!raw) return PLACEHOLDER;
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
    return `../${raw.replace(/^\/+/, '')}`;
  }

  function productCode(product) { return text(product?.gtin || product?.ean || product?.codigo || product?.sku); }
  function productName(product) { return text(product?.nome || product?.name || product?.titulo || product?.codigo) || 'Produto sem nome'; }

  function codeVariants(value) {
    const raw = digits(value) || text(value).toUpperCase();
    if (!raw) return [];
    const list = [raw];
    if (/^\d+$/.test(raw)) {
      if (raw.length === 12) list.push(`0${raw}`);
      if (raw.length === 13 && raw.startsWith('0')) list.push(raw.slice(1));
      const noZero = raw.replace(/^0+(?=\d)/, '');
      if (noZero) list.push(noZero);
    }
    return [...new Set(list)];
  }

  function firebaseUrl(path, query = null) {
    const base = String(CONFIG.firebaseUrl || '').replace(/\/+$/, '');
    const node = String(CONFIG.firebaseProductsNode || 'produtos').replace(/^\/+|\/+$/g, '');
    let url = `${base}/${node}/${path ? `${String(path).replace(/^\/+/, '')}.json` : '.json'}`;
    if (query) {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => params.set(key, String(value)));
      url += `?${params.toString()}`;
    }
    return url;
  }

  async function firebaseGet(url) {
    const response = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Firebase ${response.status}`);
    return response.json();
  }

  async function queryFirebaseField(field, value) {
    const data = await firebaseGet(firebaseUrl('', {
      orderBy: JSON.stringify(field),
      equalTo: JSON.stringify(value),
      limitToFirst: 2
    }));
    if (!data || typeof data !== 'object') return null;
    const key = Object.keys(data)[0];
    return key ? { key, product: data[key] } : null;
  }

  async function loadFallbackCatalog() {
    if (catalogCache && Date.now() - catalogAt < CATALOG_TTL) return catalogCache;
    const response = await fetch(`${CONFIG.fallbackCatalogUrl}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Catálogo administrativo indisponível.');
    const data = await response.json();
    catalogCache = data && typeof data === 'object' ? data : {};
    catalogAt = Date.now();
    return catalogCache;
  }

  function matchesCode(product, key, variants) {
    const values = [key, product?.firebaseKey, product?.id, product?.gtin, product?.ean, product?.codigo, product?.sku]
      .map(v => text(v).toUpperCase())
      .filter(Boolean);
    return values.some(v => variants.includes(v) || variants.includes(digits(v)));
  }

  async function findProduct(rawCode) {
    const variants = codeVariants(rawCode);
    if (!variants.length) return null;

    for (const variant of variants) {
      try {
        const direct = await firebaseGet(firebaseUrl(encodeURIComponent(variant)));
        if (direct && typeof direct === 'object') return { key: variant, product: direct, source: 'firebase-key' };
      } catch {}
    }

    for (const field of ['gtin', 'ean', 'codigo', 'sku']) {
      for (const variant of variants) {
        try {
          const found = await queryFirebaseField(field, variant);
          if (found) return { ...found, source: `firebase-${field}` };
        } catch {}
      }
    }

    try {
      const catalog = await loadFallbackCatalog();
      for (const [key, product] of Object.entries(catalog)) {
        if (product && typeof product === 'object' && matchesCode(product, key, variants)) {
          try {
            const fresh = await firebaseGet(firebaseUrl(encodeURIComponent(key)));
            if (fresh && typeof fresh === 'object') return { key, product: fresh, source: 'firebase-fresh' };
          } catch {}
          return { key, product, source: 'catalog-fallback' };
        }
      }
    } catch {}

    return null;
  }

  async function searchCode(raw) {
    const code = text(raw || $('eanInput').value);
    if (!code) { setLookupStatus('Digite ou leia um EAN.', 'error'); return; }
    stopCamera();
    setLookupStatus(`Procurando ${code}…`, 'busy');
    $('productCard').classList.add('hidden');
    $('notFoundCard').classList.add('hidden');
    try {
      const found = await findProduct(code);
      if (!found) {
        $('notFoundCode').textContent = code;
        $('notFoundCard').classList.remove('hidden');
        setLookupStatus('Produto não encontrado.', 'error');
        return;
      }
      currentFirebaseKey = found.key;
      currentProduct = found.product;
      showProduct(found.product, found.key);
      setLookupStatus('Produto encontrado. Faça a contagem física.', 'success');
    } catch (error) {
      console.error(error);
      setLookupStatus(error?.message || 'Falha ao consultar produto.', 'error');
    }
  }

  function showProduct(product, key) {
    $('productCard').classList.remove('hidden');
    $('notFoundCard').classList.add('hidden');
    $('productImage').src = normalizeImage(product?.url_imagem || product?.imagem_url || product?.imagem);
    $('productImage').onerror = function(){ this.src = PLACEHOLDER; };
    $('productName').textContent = productName(product);
    $('productMeta').textContent = [productCode(product), product?.marca, product?.embalagem, product?.categoria].map(text).filter(Boolean).join(' · ');
    $('oldStock').textContent = number(product?.estoque) ?? '—';
    $('oldValidity').textContent = formatDate(product?.validade || product?.data_validade) || '—';
    $('oldLocation').textContent = [product?.gondola || product?.['gôndola'], product?.prateleira].map(text).filter(Boolean).join(' / ') || '—';
    $('stockInput').value = number(product?.estoque) ?? '';
    $('validityInput').value = formatDate(product?.validade || product?.data_validade);
    $('gondolaInput').value = text(product?.gondola || product?.['gôndola']);
    $('shelfInput').value = text(product?.prateleira);
    $('eanInput').value = productCode(product) || key;
    setSaveStatus('Confira o estoque e a validade antes de salvar.');
    setTimeout(() => { $('stockInput').focus(); $('stockInput').select(); }, 80);
  }

  function payloadProduct(product) {
    return {
      firebaseKey: currentFirebaseKey,
      id: text(product?.id || currentFirebaseKey),
      codigo: text(product?.codigo || product?.sku),
      sku: text(product?.sku || product?.codigo),
      nome: productName(product),
      gtin: digits(product?.gtin || product?.ean || $('eanInput').value),
      ean: digits(product?.ean || product?.gtin || $('eanInput').value),
      ncm: digits(product?.ncm),
      marca: text(product?.marca),
      fornecedor: text(product?.fornecedor),
      embalagem: text(product?.embalagem),
      unidade: text(product?.unidade),
      categoria: text(product?.categoria),
      subcategoria: text(product?.subcategoria),
      subsubcategoria: text(product?.subsubcategoria),
      gondola: text($('gondolaInput').value || product?.gondola || product?.['gôndola']),
      prateleira: text($('shelfInput').value || product?.prateleira),
      validade: text(product?.validade || product?.data_validade),
      url_imagem: text(product?.url_imagem || product?.imagem_url || product?.imagem),
      estoque: number(product?.estoque),
      preco: number(product?.preco),
      preco_custo: number(product?.preco_custo),
      tags: Array.isArray(product?.tags) ? product.tags.slice(0, 30) : []
    };
  }

  function buildSavePayload() {
    if (!currentProduct) throw new Error('Nenhum produto carregado.');
    const stock = number($('stockInput').value);
    if (stock === null || stock < 0 || !Number.isInteger(stock)) throw new Error('Informe um estoque inteiro igual ou maior que zero.');
    const validityRaw = text($('validityInput').value);
    const validity = validityRaw ? toIsoDate(validityRaw) : null;
    if (validityRaw && !validity) throw new Error('Validade inválida. Use dd/mm/aaaa.');
    return {
      local_id: uuid(),
      inventory_count_id: localStorage.getItem(SESSION_KEY) || null,
      firebase_key: currentFirebaseKey,
      product: payloadProduct(currentProduct),
      counted_stock: stock,
      validity_date: validity,
      gondola: text($('gondolaInput').value),
      shelf: text($('shelfInput').value),
      queued_at: new Date().toISOString()
    };
  }

  function queue() { return loadJson(QUEUE_KEY, []); }
  function saveQueue(items) { saveJson(QUEUE_KEY, items); updateQueueBadge(); }
  function updateQueueBadge() { $('pendingBadge').textContent = String(queue().length); }

  function addRecent(entry) {
    const recent = loadJson(RECENT_KEY, []);
    recent.unshift(entry);
    saveJson(RECENT_KEY, recent.slice(0, 30));
    renderRecentLocal();
  }

  function renderRecentLocal() {
    const recent = loadJson(RECENT_KEY, []);
    $('sessionCount').textContent = String(recent.length);
    $('recentList').innerHTML = recent.length ? recent.map(item => `
      <article class="recent-item">
        <img src="${escapeHtml(normalizeImage(item.image))}" alt="" onerror="this.src='${PLACEHOLDER}'">
        <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.gtin || '')}</small></div>
        <div class="recent-values"><b>${escapeHtml(String(item.stock))}</b><small>${escapeHtml(formatDate(item.validity) || 'sem validade')}</small></div>
        <span class="sync-dot ${item.queued ? 'waiting' : 'done'}" title="${item.queued ? 'Pendente' : 'Salvo'}"></span>
      </article>`).join('') : '<div class="empty">Nenhum produto contado nesta sessão.</div>';
  }

  async function renderRecent() {
    renderRecentLocal();
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) return;
    try {
      const data = await callApi('recent', { inventory_count_id: sessionId, limit: 30 });
      if (!Array.isArray(data.items) || !data.items.length) return;
      const serverRecent = data.items.map(row => ({
        id: row.id,
        name: row.product?.name || 'Produto',
        gtin: row.ean || '',
        stock: row.counted_stock,
        validity: row.validity_date,
        image: row.product?.image_url || '',
        queued: false
      }));
      saveJson(RECENT_KEY, serverRecent);
      renderRecentLocal();
    } catch {}
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  async function saveCurrent() {
    if (saving) return;
    let payload;
    try { payload = buildSavePayload(); }
    catch (error) { setSaveStatus(error.message, 'error'); return; }

    saving = true;
    $('saveButton').disabled = true;
    $('saveButton').textContent = 'Salvando…';
    setSaveStatus('Salvando no Supabase…', 'busy');
    try {
      payload.inventory_count_id = await ensureInventorySession();
      const result = await callApi('save', payload);
      addRecent({
        id: result.count_item_id,
        name: productName(currentProduct),
        gtin: digits(currentProduct?.gtin || currentProduct?.ean || $('eanInput').value),
        stock: payload.counted_stock,
        validity: payload.validity_date,
        image: text(currentProduct?.url_imagem || currentProduct?.imagem_url || currentProduct?.imagem),
        queued: false
      });
      setSaveStatus('Salvo no Supabase. Próximo produto.', 'success');
      if (navigator.vibrate) navigator.vibrate(80);
      toast('Produto conferido e salvo.', 'success');
      resetForNext(true);
    } catch (error) {
      const networkLike = !navigator.onLine || !error.status || error.status >= 500;
      if (networkLike) {
        const items = queue();
        items.push(payload);
        saveQueue(items);
        addRecent({ name: productName(currentProduct), gtin: payload.product.gtin, stock: payload.counted_stock, validity: payload.validity_date, image: payload.product.url_imagem, queued: true });
        setSaveStatus('Sem conexão. Guardado no celular e será enviado depois.', 'warning');
        toast('Contagem guardada no celular.', 'warning');
        resetForNext(false);
      } else {
        console.error(error);
        setSaveStatus(error.message || 'Não foi possível salvar.', 'error');
      }
    } finally {
      saving = false;
      $('saveButton').disabled = false;
      $('saveButton').textContent = 'Salvar e próximo';
    }
  }

  async function processQueue() {
    if (!navigator.onLine || !auth?.access_token) return;
    const items = queue();
    if (!items.length) return;
    $('syncQueueButton').disabled = true;
    let sent = 0;
    const remaining = [];
    for (const item of items) {
      try {
        if (!item.inventory_count_id) item.inventory_count_id = await ensureInventorySession();
        await callApi('save', item);
        sent++;
      } catch (error) {
        remaining.push(item);
        if (error.status && error.status < 500) break;
      }
    }
    saveQueue(remaining);
    $('syncQueueButton').disabled = false;
    if (sent) {
      toast(`${sent} pendência(s) enviada(s).`, 'success');
      await renderRecent();
    }
  }

  function resetForNext(openScanner) {
    currentProduct = null;
    currentFirebaseKey = '';
    $('productCard').classList.add('hidden');
    $('notFoundCard').classList.add('hidden');
    $('eanInput').value = '';
    $('stockInput').value = '';
    $('validityInput').value = '';
    setLookupStatus('Pronto para o próximo produto.');
    setTimeout(() => openScanner ? startCamera() : $('eanInput').focus(), 180);
  }

  async function finishSession() {
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) return;
    if (queue().length) {
      await processQueue();
      if (queue().length) { toast('Ainda há pendências offline. Finalize quando forem enviadas.', 'warning'); return; }
    }
    $('finishSessionButton').disabled = true;
    try {
      const data = await callApi('close', { inventory_count_id: sessionId });
      toast(`Contagem finalizada: ${data.item_count || 0} produto(s).`, 'success');
      localStorage.removeItem(SESSION_KEY);
      saveJson(RECENT_KEY, []);
      renderRecentLocal();
      await ensureInventorySession();
    } catch (error) {
      toast(error.message || 'Não foi possível finalizar.', 'error');
    } finally {
      $('finishSessionButton').disabled = false;
    }
  }

  async function startCamera() {
    if (stream) { stopCamera(); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setLookupStatus('Este navegador não permite câmera. Digite o EAN.', 'warning');
      $('eanInput').focus();
      return;
    }
    if (!('BarcodeDetector' in window)) {
      setLookupStatus('Leitura automática não disponível neste navegador. Digite o EAN.', 'warning');
      $('eanInput').focus();
      return;
    }
    try {
      const formats = await BarcodeDetector.getSupportedFormats().catch(() => []);
      const preferred = ['ean_13','ean_8','upc_a','upc_e','code_128'].filter(format => !formats.length || formats.includes(format));
      detector = new BarcodeDetector(preferred.length ? { formats: preferred } : undefined);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      $('video').srcObject = stream;
      $('cameraPanel').classList.remove('hidden');
      $('cameraButton').textContent = 'Fechar câmera';
      setLookupStatus('Aponte para o código de barras.', 'busy');
      scanLoop();
    } catch (error) {
      console.error(error);
      stopCamera();
      setLookupStatus('Não consegui abrir a câmera. Digite o EAN.', 'error');
    }
  }

  function scanLoop() {
    clearTimeout(scanTimer);
    if (!stream || !detector) return;
    scanTimer = setTimeout(async () => {
      try {
        const codes = await detector.detect($('video'));
        const raw = text(codes?.[0]?.rawValue);
        if (raw) {
          const now = Date.now();
          if (raw !== lastScanned || now - lastScannedAt > 2500) {
            lastScanned = raw;
            lastScannedAt = now;
            if (navigator.vibrate) navigator.vibrate(60);
            $('eanInput').value = raw;
            stopCamera();
            await searchCode(raw);
            return;
          }
        }
      } catch {}
      scanLoop();
    }, 320);
  }

  function stopCamera() {
    clearTimeout(scanTimer);
    scanTimer = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    detector = null;
    if ($('video')) $('video').srcObject = null;
    $('cameraPanel').classList.add('hidden');
    $('cameraButton').textContent = '📷 Câmera';
  }

  function maskValidity(event) {
    const raw = String(event.target.value || '').replace(/\D/g, '').slice(0, 8);
    const parts = [raw.slice(0,2), raw.slice(2,4), raw.slice(4,8)].filter(Boolean);
    event.target.value = parts.join('/');
  }

  function bind() {
    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      $('loginButton').disabled = true;
      $('loginStatus').textContent = 'Entrando…';
      try {
        await signIn($('emailInput').value.trim(), $('passwordInput').value);
        await bootstrapAuthenticated();
        $('loginStatus').textContent = '';
      } catch (error) {
        $('loginStatus').textContent = error.code === 'admin_not_authorized'
          ? 'Usuário válido, mas ainda não autorizado no Admin Dona Antônia.'
          : (error.message || 'Falha ao entrar.');
      } finally { $('loginButton').disabled = false; }
    });
    $('logoutButton').addEventListener('click', logout);
    $('cameraButton').addEventListener('click', startCamera);
    $('closeCameraButton').addEventListener('click', stopCamera);
    $('searchButton').addEventListener('click', () => searchCode());
    $('eanInput').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchCode(); } });
    $('validityInput').addEventListener('input', maskValidity);
    $('saveButton').addEventListener('click', saveCurrent);
    $('skipButton').addEventListener('click', () => resetForNext(false));
    $('retryButton').addEventListener('click', () => { $('notFoundCard').classList.add('hidden'); $('eanInput').focus(); });
    $('finishSessionButton').addEventListener('click', finishSession);
    $('syncQueueButton').addEventListener('click', () => processQueue().catch(error => toast(error.message, 'error')));
    window.addEventListener('online', () => { setConnection(true, 'Internet voltou'); processQueue().catch(() => {}); });
    window.addEventListener('offline', () => setConnection(false, 'Sem internet · modo fila'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  }

  async function init() {
    bind();
    updateQueueBadge();
    renderRecentLocal();
    if (auth?.access_token) {
      try { await bootstrapAuthenticated(); }
      catch (error) {
        if (error.code === 'admin_not_authorized') {
          $('loginStatus').textContent = 'Sua conta ainda não está autorizada no Admin.';
        } else {
          auth = null;
          localStorage.removeItem(AUTH_KEY);
          $('loginStatus').textContent = 'Entre novamente para continuar.';
        }
      }
    }
  }

  init();
})();
