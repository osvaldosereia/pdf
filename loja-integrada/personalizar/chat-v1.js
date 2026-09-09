/* CANECAFÁCIL · CHAT DE PERSONALIZAÇÃO v1
 * Camada conversacional progressiva sobre o personalizador v15.
 * Mantém o contrato atual de campos e a geração existente; muda a UX de formulário
 * para perguntas curtas, uma por vez. Áudio usa ditado do navegador quando disponível.
 */
(function(){
  'use strict';
  if (window.CF_CHAT_V1) return;
  window.CF_CHAT_V1 = 1;

  const BUILD = '20260904-chat-v1';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const text = v => String(v ?? '').trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  const card = $('#chatCard');
  const messages = $('#chatMessages');
  const composer = $('#chatComposer');
  const input = $('#chatInput');
  const send = $('#chatSend');
  const mic = $('#chatMic');
  const photo = $('#chatPhoto');
  const skip = $('#chatSkip');
  const quick = $('#chatQuick');
  const status = $('#chatStatus');
  const form = $('#personalizerForm');
  const generate = $('#generateButton');
  const emailInput = $('#customerEmail');
  if (!card || !messages || !composer || !input || !send || !form) return;

  let steps = [];
  let index = 0;
  let current = null;
  let started = false;
  let waiting = false;
  let recognition = null;
  const skipped = new WeakSet();
  const draftKey = () => `cf_chat_v1:${new URLSearchParams(location.search).get('model') || 'model'}`;

  function saveDraft(){
    try {
      const data = { email:text(emailInput?.value), fields:{} };
      $$('[data-field-id]', form).forEach(el => {
        if (el.dataset.kind === 'image') return;
        data.fields[text(el.dataset.fieldId)] = text(el.value);
      });
      sessionStorage.setItem(draftKey(), JSON.stringify(data));
    } catch {}
  }

  function restoreDraft(){
    try {
      const data = JSON.parse(sessionStorage.getItem(draftKey()) || 'null');
      if (!data) return;
      if (emailInput && data.email) emailInput.value = data.email;
      $$('[data-field-id]', form).forEach(el => {
        const id = text(el.dataset.fieldId);
        if (el.dataset.kind !== 'image' && data.fields?.[id]) el.value = data.fields[id];
      });
    } catch {}
  }

  function scrollBottom(){
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }

  function bubble(role, html, extra=''){
    const row = document.createElement('div');
    row.className = `chat-row chat-${role} ${extra}`.trim();
    row.innerHTML = `<div class="chat-bubble">${html}</div>`;
    messages.appendChild(row);
    scrollBottom();
    return row;
  }

  async function assistant(message, {typing=true, extra=''}={}){
    if (typing) {
      const t = bubble('assistant', '<span class="chat-typing"><i></i><i></i><i></i></span>', 'is-typing');
      await delay(260);
      t.remove();
    }
    return bubble('assistant', esc(message), extra);
  }

  function user(message){ bubble('user', esc(message)); }

  function setStatus(message=''){
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }

  function fieldId(el){ return text(el?.dataset?.fieldId); }
  function isExactField(id){ return /(nome|name|frase|texto|mensagem|message|apelido)/i.test(id); }
  function isImage(el){ return el?.dataset?.kind === 'image' || el?.type === 'file'; }
  function isOptional(el){ return !el?.required; }

  function labelFor(el){
    const label = el?.closest('label');
    if (!label) return fieldId(el) || 'Informação';
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input,textarea,select,small').forEach(n => n.remove());
    return text(clone.textContent).replace(/\s*\*\s*$/, '');
  }

  function helpFor(el){ return text(el?.closest('label')?.querySelector('small')?.textContent); }

  function promptFor(step){
    if (step.kind === 'email') return 'Antes de criar a arte, qual e-mail você quer usar para salvar esta criação e receber o aviso se ela demorar?';
    const id = fieldId(step.el).toLowerCase();
    const label = labelFor(step.el);
    const help = helpFor(step.el);
    if (isImage(step.el)) {
      if (/foto/i.test(id)) return step.el.required
        ? 'Agora envie a foto que deve servir de referência para a personalização.'
        : 'Se quiser que alguém apareça ou sirva de referência, pode enviar uma foto agora. Se não quiser, é só pular.';
      return step.el.required ? `Envie ${label.toLowerCase()}.` : `Se quiser, envie ${label.toLowerCase()}. Você também pode pular.`;
    }
    if (/nome|name|apelido/i.test(id)) return 'Qual nome deve aparecer na caneca?';
    if (/frase|texto|mensagem|message/i.test(id)) return 'Qual frase ou mensagem você quer que apareça? Pode escrever exatamente como deve ficar.';
    if (/telefone|whatsapp/i.test(id)) return 'Qual telefone ou WhatsApp devemos usar?';
    if (/site|instagram|rede/i.test(id)) return `Qual ${label.toLowerCase()} você quer colocar?`;
    if (step.el.tagName === 'SELECT') return help || `Escolha uma opção para ${label.toLowerCase()}.`;
    return help || `Me conta: ${label.toLowerCase()}.`;
  }

  function buildSteps(){
    const fields = $$('[data-field-id]', form).filter(el => !el.disabled);
    return fields.map(el => ({kind:'field', el})).concat(emailInput ? [{kind:'email', el:emailInput}] : []);
  }

  function hasValue(step){
    if (!step) return true;
    if (step.kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(step.el.value));
    if (skipped.has(step.el)) return true;
    if (isImage(step.el)) return Boolean(step.el.files?.length);
    return Boolean(text(step.el.value));
  }

  function firstUnanswered(){
    const pos = steps.findIndex(step => !hasValue(step));
    return pos >= 0 ? pos : steps.length;
  }

  function updateComposer(step){
    current = step;
    quick.innerHTML = '';
    photo.hidden = true;
    skip.hidden = true;
    input.hidden = false;
    send.hidden = false;
    mic.hidden = !recognition;
    input.value = '';
    input.rows = 1;
    input.placeholder = 'Digite sua resposta…';

    if (!step) return;
    if (step.kind === 'field' && isOptional(step.el)) skip.hidden = false;
    if (step.kind === 'field' && isImage(step.el)) {
      input.hidden = true;
      send.hidden = true;
      mic.hidden = true;
      photo.hidden = false;
      photo.textContent = /foto/i.test(fieldId(step.el)) ? '📷 Enviar foto' : '📎 Enviar imagem';
    }
    if (step.kind === 'field' && step.el.tagName === 'SELECT') {
      input.hidden = true;
      send.hidden = true;
      mic.hidden = true;
      const options = [...step.el.options].filter(o => text(o.value));
      options.forEach(opt => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-chip';
        b.textContent = text(opt.textContent);
        b.addEventListener('click', () => answerText(text(opt.value), text(opt.textContent)));
        quick.appendChild(b);
      });
    }
    setStatus(recognition && !input.hidden ? 'Você pode digitar ou tocar no microfone.' : '');
  }

  async function ask(step){
    composer.hidden = false;
    updateComposer(step);
    await assistant(promptFor(step));
  }

  function nextIndex(from){
    for (let i=from; i<steps.length; i++) if (!hasValue(steps[i])) return i;
    return steps.length;
  }

  async function advance(){
    saveDraft();
    index = nextIndex(index + 1);
    if (index >= steps.length) return review();
    await ask(steps[index]);
  }

  async function confirmExact(step, value){
    waiting = true;
    await assistant(`Só para confirmar: devo escrever exatamente “${value}”?`);
    quick.innerHTML = '';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'chat-chip chat-chip-primary'; yes.textContent = 'Sim, está certo';
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'chat-chip'; no.textContent = 'Quero corrigir';
    quick.append(yes, no);
    input.hidden = true; send.hidden = true; mic.hidden = true; photo.hidden = true; skip.hidden = true;
    yes.addEventListener('click', async () => { user('Sim, está certo'); waiting = false; await advance(); });
    no.addEventListener('click', async () => {
      user('Quero corrigir'); waiting = false; quick.innerHTML=''; updateComposer(step); await assistant('Sem problema. Me diga de novo exatamente como deve ficar.'); input.focus();
    });
  }

  async function answerText(value, displayValue=value){
    if (!current || waiting) return;
    value = text(value);
    if (!value) return;
    if (current.kind === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setStatus('Digite um e-mail válido, por exemplo nome@email.com.');
        input.focus();
        return;
      }
      current.el.value = value.toLowerCase();
      user(value.toLowerCase());
      setStatus('');
      return advance();
    }
    skipped.delete?.(current.el);
    current.el.value = value;
    current.el.dispatchEvent(new Event('input', {bubbles:true}));
    current.el.dispatchEvent(new Event('change', {bubbles:true}));
    user(displayValue);
    input.value = '';
    setStatus('');
    if (isExactField(fieldId(current.el))) return confirmExact(current, value);
    return advance();
  }

  async function skipCurrent(){
    if (!current || current.kind !== 'field' || current.el.required) return;
    user('Pular');
    skipped.add(current.el);
    if (!isImage(current.el)) current.el.value = '';
    await advance();
  }

  function summaryRows(){
    const rows = [];
    steps.forEach(step => {
      if (step.kind === 'email') {
        if (text(step.el.value)) rows.push(['E-mail', text(step.el.value)]);
        return;
      }
      const label = labelFor(step.el);
      if (isImage(step.el)) {
        if (step.el.files?.length) rows.push([label, step.el.files[0].name || 'Imagem enviada']);
      } else if (text(step.el.value)) rows.push([label, text(step.el.value)]);
    });
    return rows;
  }

  async function review(){
    current = null;
    updateComposer(null);
    composer.hidden = true;
    messages.querySelector('.chat-review-intro')?.remove();
    messages.querySelector('.chat-review-row')?.remove();
    await assistant('Pronto. Já tenho o necessário para criar sua versão. Confira rapidinho:', {extra:'chat-review-intro'});
    const rows = summaryRows();
    const row = bubble('assistant', `<div class="chat-summary">${rows.map(([k,v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div><div class="chat-review-actions"><button type="button" class="chat-generate">✨ Criar minha arte</button><button type="button" class="chat-edit">Corrigir uma resposta</button></div>`, 'chat-review-row');
    row.querySelector('.chat-generate')?.addEventListener('click', () => {
      saveDraft();
      card.hidden = true;
      form.requestSubmit ? form.requestSubmit() : generate?.click();
    });
    row.querySelector('.chat-edit')?.addEventListener('click', async () => {
      const answered = steps.map((s,i) => ({s,i})).filter(x => x.s.kind === 'email' ? text(x.s.el.value) : (isImage(x.s.el) ? x.s.el.files?.length : text(x.s.el.value)));
      quick.innerHTML = '';
      composer.hidden = false;
      input.hidden = true; send.hidden = true; mic.hidden = true; photo.hidden = true; skip.hidden = true;
      await assistant('Qual informação você quer corrigir?');
      answered.forEach(({s,i}) => {
        const b = document.createElement('button');
        b.type='button'; b.className='chat-chip'; b.textContent = s.kind === 'email' ? 'E-mail' : labelFor(s.el);
        b.addEventListener('click', async () => {
          index = i; current = s; quick.innerHTML=''; composer.hidden=false; updateComposer(s); await assistant(promptFor(s)); if (!input.hidden) input.focus();
        });
        quick.appendChild(b);
      });
    });
  }

  function bindImageInputs(){
    $$('[data-field-id]', form).filter(isImage).forEach(el => {
      if (el.dataset.cfChatBound) return;
      el.dataset.cfChatBound = '1';
      el.addEventListener('change', async () => {
        if (current?.el !== el || !el.files?.length) return;
        skipped.delete?.(el);
        const file = el.files[0];
        user(`📷 ${file.name || 'Foto enviada'}`);
        await advance();
      });
    });
    photo.addEventListener('click', () => {
      if (current?.kind === 'field' && isImage(current.el)) current.el.click();
    });
  }

  function initRecognition(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    try {
      const r = new SR();
      r.lang = 'pt-BR';
      r.interimResults = false;
      r.continuous = false;
      r.maxAlternatives = 1;
      r.onstart = () => { mic.classList.add('is-listening'); setStatus('Ouvindo… fale normalmente.'); };
      r.onend = () => { mic.classList.remove('is-listening'); if (!text(input.value)) setStatus('Você pode digitar ou tocar no microfone.'); };
      r.onerror = () => { mic.classList.remove('is-listening'); setStatus('Não consegui ouvir. Você pode tentar novamente ou digitar.'); };
      r.onresult = e => {
        const transcript = text(e.results?.[0]?.[0]?.transcript);
        if (transcript) { input.value = transcript; input.focus(); setStatus('Confira a transcrição e envie.'); }
      };
      return r;
    } catch { return null; }
  }

  async function start(){
    if (started) return;
    const fields = $$('[data-field-id]', form);
    if (!fields.length) return;
    started = true;
    document.documentElement.dataset.cfChat = BUILD;
    document.body.classList.add('cf-chat-mode');
    restoreDraft();
    steps = buildSteps();
    bindImageInputs();
    recognition = initRecognition();
    card.hidden = false;
    composer.hidden = false;
    const productName = text($('#productBox .product-copy h2')?.textContent) || 'essa caneca';
    await assistant(`Vamos personalizar ${productName}. Vou perguntar só o necessário e você pode responder do seu jeito.`, {typing:false});
    await assistant('Se preferir, responda por voz no microfone. Para nomes e frases eu sempre confirmo antes de gerar.');
    index = firstUnanswered();
    if (index >= steps.length) return review();
    await ask(steps[index]);
  }

  send.addEventListener('click', () => answerText(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); answerText(input.value); }
  });
  skip.addEventListener('click', skipCurrent);
  mic.addEventListener('click', () => {
    if (!recognition || input.hidden) return;
    try { recognition.start(); } catch {}
  });

  form.addEventListener('submit', () => { card.hidden = true; });
  $('#tryAgain')?.addEventListener('click', () => { card.hidden = false; composer.hidden = true; });
  $('#editCreation')?.addEventListener('click', async () => { card.hidden = false; await review(); });

  const observer = new MutationObserver(() => {
    if (!form.hidden && $$('[data-field-id]', form).length) start();
  });
  observer.observe(form, {subtree:true, childList:true, attributes:true, attributeFilter:['hidden']});
  if (!form.hidden && $$('[data-field-id]', form).length) start();
})();