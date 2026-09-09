import { APP_CONFIG } from '../shared/config.js';
import { buildIntegrationRegistry, safeGetProbe, summarizeIntegrationResults } from './integration-audit.js';
import { homologationFirebaseSnapshot } from '../services/firebase-homologation-order-adapter.js';
import { makeHomologationSnapshot } from '../services/make-homologation-order-adapter.js';

const content = document.getElementById('admin-content');
const status = document.getElementById('admin-status');
const title = document.getElementById('module-title');
const subtitle = document.getElementById('module-subtitle');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
const metric = (value, label) => `<article class="metric"><strong>${value}</strong><span>${label}</span></article>`;
const state = { registry:buildIntegrationRegistry(), results:new Map(), running:false };

function label(value) {
  return ({ healthy:'Saudável', warning:'Atenção', 'not-configured':'Não configurado', 'not-tested':'Não testado' })[value] || value;
}

function render() {
  title.textContent = 'Integrações';
  subtitle.textContent = 'Diagnóstico seguro de leitura, sem credenciais expostas e sem requisições de escrita.';
  const audit = summarizeIntegrationResults(state.registry, state.results);
  const firebaseHomologation = homologationFirebaseSnapshot();
  const makeHomologation = makeHomologationSnapshot();
  const blingConfig = APP_CONFIG.integrations.bling;
  const isolationClass = firebaseHomologation.isolated ? 'success' : 'error';
  const isolationText = firebaseHomologation.isolated ? 'Destino isolado validado' : 'Configuração insegura';
  const makeReady = makeHomologation.endpointConfigured && makeHomologation.endpointValid;
  const makeStatusText = makeReady ? 'Contrato configurado' : makeHomologation.endpointConfigured ? 'Webhook inválido' : 'Aguardando webhook';
  const makeNoticeClass = makeHomologation.endpointConfigured && !makeHomologation.endpointValid ? 'error' : makeReady ? 'success' : '';
  const makeNotice = makeReady
    ? 'O endpoint pertence a um host permitido do Make. A URL completa não é exibida e a chamada continua bloqueada pela política de escrita.'
    : makeHomologation.endpointConfigured
      ? makeHomologation.errors.join(' ')
      : 'Nenhum webhook foi configurado. O adaptador está pronto, mas não realizará chamadas até receber um endpoint válido e a liberação explícita da escrita.';

  const integrationRows = audit.rows.map(row => `<article class="integration-card"><div class="integration-card-head"><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.kind)} · ${escapeHtml(row.endpoint)}</small></div><span class="integration-status ${row.status}">${escapeHtml(label(row.status))}</span></div><div class="integration-facts"><span>${row.checks.length} verificação(ões) permitida(s)</span><span>${row.passed} sucesso(s)</span><span>${row.failed} falha(s)</span><span>Escrita bloqueada</span></div>${row.reason ? `<p>${escapeHtml(row.reason)}</p>` : ''}${row.checks.length ? `<details><summary>Verificações disponíveis</summary><div class="integration-checks">${row.checks.map(check => { const result = state.results.get(`${row.id}:${check.label}`); return `<div><span><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.safeMethod)} · ${escapeHtml(check.target)}</small></span><b class="${result?.ok ? 'ok' : result ? 'error' : 'pending'}">${result ? result.ok ? `OK · ${result.latencyMs} ms` : escapeHtml(result.error) : 'Não executada'}</b></div>`; }).join('')}</div></details>` : ''}</article>`).join('');

  content.innerHTML = `
    <section class="module-hero">
      <span class="eyebrow">DIAGNÓSTICO SEGURO · SOMENTE LEITURA</span>
      <h2>Firebase, GitHub, Make, Bling e IA</h2>
      <p>Somente fontes públicas ou leituras GET são verificadas. Webhooks, tokens e operações de escrita permanecem bloqueados.</p>
    </section>
    <section class="metrics">${metric(audit.total,'INTEGRAÇÕES')}${metric(audit.healthy,'SAUDÁVEIS')}${metric(audit.warnings,'COM ALERTAS')}${metric(audit.notConfigured,'NÃO CONFIGURADAS')}</section>
    <section class="panel">
      <div class="panel-head"><div><span class="eyebrow">PEDIDOS V2</span><h3>Destino Firebase de homologação</h3></div><span class="score ${firebaseHomologation.isolated ? 'ok' : 'warn'}">${escapeHtml(isolationText)}</span></div>
      <div class="integration-facts"><span>Nó de homologação: <strong>${escapeHtml(firebaseHomologation.node)}</strong></span><span>Nó de produção bloqueado: <strong>${escapeHtml(firebaseHomologation.productionNode)}</strong></span><span>Escrita: <strong>${firebaseHomologation.writeEnabled ? 'habilitada' : 'desabilitada'}</strong></span><span>Ambiente: <strong>${escapeHtml(firebaseHomologation.environment.name)}</strong></span></div>
      <div class="notice ${isolationClass}">${firebaseHomologation.isolated ? 'O checkout e o despachante não montam destino em /pedidos. Qualquer caminho fora de homologacao_v2/ é rejeitado pelo adaptador.' : escapeHtml(firebaseHomologation.errors.join(' '))}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><span class="eyebrow">PEDIDOS V2</span><h3>Contrato do Make em homologação</h3></div><span class="score ${makeReady ? 'ok' : 'warn'}">${escapeHtml(makeStatusText)}</span></div>
      <div class="integration-facts"><span>Webhook configurado: <strong>${makeHomologation.endpointConfigured ? 'sim' : 'não'}</strong></span><span>Host validado: <strong>${escapeHtml(makeHomologation.endpointHost || '—')}</strong></span><span>Contrato: <strong>v${makeHomologation.contractVersion}</strong></span><span>Confirmação do Bling: <strong>${makeHomologation.requireBlingConfirmation ? 'obrigatória' : 'opcional'}</strong></span><span>Tentativas máximas: <strong>${makeHomologation.maximumAttempts}</strong></span><span>Timeout: <strong>${makeHomologation.timeoutMs} ms</strong></span><span>Envio: <strong>${makeHomologation.enabled ? 'habilitado' : 'desabilitado'}</strong></span></div>
      <div class="notice ${makeNoticeClass}">${escapeHtml(makeNotice)}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><span class="eyebrow">ERP PROTEGIDO</span><h3>Bling acessado somente pelo Make</h3></div><span class="score ok">Sem token no navegador</span></div>
      <div class="integration-facts"><span>Modo: <strong>${escapeHtml(blingConfig.mode)}</strong></span><span>Acesso direto no navegador: <strong>${blingConfig.directBrowserAccessAllowed ? 'permitido' : 'bloqueado'}</strong></span><span>Limite por segundo considerado: <strong>${blingConfig.maximumRequestsPerSecond}</strong></span><span>Limite diário considerado: <strong>${blingConfig.maximumRequestsPerDay}</strong></span><span>Duplicidade: <strong>exige referência da venda</strong></span><span>OAuth: <strong>mantido fora do front-end</strong></span></div>
      <div class="notice success">O V2 não chama a API do Bling diretamente. O Make deve localizar ou criar o contato, criar ou confirmar a venda e devolver ID, número, situação e possíveis limites de requisição.</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Estado das integrações</h3><button class="integration-probe-button" type="button" data-run-integration-probes ${state.running ? 'disabled' : ''}>${state.running ? 'Verificando…' : 'Executar leituras seguras'}</button></div>
      <div class="integration-list">${integrationRows}</div>
      <div class="notice">Make, Bling e OpenAI não são testados diretamente pelo navegador. Na etapa operacional, esses testes deverão passar por um serviço intermediário seguro, sem expor webhooks ou tokens.</div>
    </section>`;
}

async function runProbes() {
  if (state.running) return;
  state.running = true;
  render();
  for (const integration of state.registry) {
    for (const check of integration.checks) {
      state.results.set(`${integration.id}:${check.label}`, await safeGetProbe(check.target));
      render();
    }
  }
  state.running = false;
  const audit = summarizeIntegrationResults(state.registry, state.results);
  status.textContent = `Integrações: ${audit.healthy} saudáveis, ${audit.warnings} com alerta`;
  status.dataset.type = audit.warnings ? 'error' : 'success';
  render();
}

document.addEventListener('click', event => {
  const moduleButton = event.target.closest('[data-module="integrations"]');
  if (moduleButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelectorAll('[data-module]').forEach(button => button.classList.toggle('active', button.dataset.module === 'integrations'));
    render();
    return;
  }
  if (event.target.closest('[data-run-integration-probes]')) runProbes();
}, true);