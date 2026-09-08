import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('ops/dona-antonia/make-scenarios-v1.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

if (data?.policy?.batch_preferred !== 'github_actions') fail('batch_preferred deve ser github_actions');
if (data?.policy?.make_role !== 'thin_realtime_bridge_only') fail('Make deve permanecer ponte fina de realtime');

const seen = new Set();
for (const scenario of data.scenarios ?? []) {
  if (!Number.isInteger(scenario.id) || scenario.id <= 0) fail(`scenario id inválido: ${scenario.id}`);
  if (seen.has(scenario.id)) fail(`scenario duplicado: ${scenario.id}`);
  seen.add(scenario.id);

  const risky = /(^|_)(temporary|test|legacy|temporary_bling|test_on_demand)($|_)/.test(String(scenario.classification));
  if (risky && scenario.expected_active !== false) {
    fail(`scenario temporário/teste/legado não pode esperar estado ativo: ${scenario.id} ${scenario.name}`);
  }
  if (scenario.expected_active === true && scenario.keep_in_make !== true) {
    fail(`scenario ativo precisa justificar permanência no Make: ${scenario.id}`);
  }
  if (scenario.keep_in_make === true && !String(scenario.reason ?? '').trim()) {
    fail(`scenario mantido no Make sem justificativa: ${scenario.id}`);
  }
}

const requiredProduction = [6779824, 7290488];
for (const id of requiredProduction) {
  const scenario = (data.scenarios ?? []).find((item) => item.id === id);
  if (!scenario || scenario.expected_active !== true || scenario.keep_in_make !== true) {
    fail(`ponte realtime obrigatória ausente/inconsistente: ${id}`);
  }
}

if (!process.exitCode) {
  console.log(`OK: ${seen.size} cenários inventariados; temporários/testes/legados esperados inativos; batch prefere GitHub Actions.`);
}
