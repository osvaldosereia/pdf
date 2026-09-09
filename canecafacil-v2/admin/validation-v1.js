const form = document.getElementById('productForm');
const toast = document.getElementById('toast');

function notify(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = '#8d1515';
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}
function value(name) { return String(form?.elements?.[name]?.value || '').trim(); }
function validHttpUrl(raw) {
  if (!raw) return false;
  try { const url = new URL(raw); return /^https?:$/.test(url.protocol); } catch { return false; }
}

// Captura antes do listener principal do formulário para impedir publicação incompleta.
document.addEventListener('submit', event => {
  if (event.target !== form) return;
  const active = Boolean(form.elements.ativo?.checked);
  const personalizable = Boolean(form.elements.personalizavel?.checked);
  const mockup = value('mockup_png');
  const art = value('arte_horizontal');
  const modelKey = value('personalizador_modelo_key');

  if (active && (!validHttpUrl(mockup) || !validHttpUrl(art))) {
    event.preventDefault();
    event.stopImmediatePropagation();
    notify('Para ativar: informe mockup PNG e arte horizontal válidos.');
    return;
  }
  if (personalizable && !modelKey) {
    event.preventDefault();
    event.stopImmediatePropagation();
    notify('Caneca personalizável precisa da chave do modelo.');
  }
}, true);
