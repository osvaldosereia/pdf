import { APP_CONFIG } from './config.js';

export const ENVIRONMENTS = Object.freeze({
  DEVELOPMENT: 'development',
  HOMOLOGATION: 'homologation',
  PRODUCTION: 'production'
});

const WRITE_POLICIES = Object.freeze({
  [ENVIRONMENTS.DEVELOPMENT]: false,
  [ENVIRONMENTS.HOMOLOGATION]: false,
  [ENVIRONMENTS.PRODUCTION]: false
});

export function getEnvironment() {
  const value = String(APP_CONFIG.environment || '').trim().toLowerCase();
  return Object.values(ENVIRONMENTS).includes(value)
    ? value
    : ENVIRONMENTS.HOMOLOGATION;
}

export function isProduction() {
  return getEnvironment() === ENVIRONMENTS.PRODUCTION;
}

export function canWriteExternally() {
  return WRITE_POLICIES[getEnvironment()] === true;
}

export function assertExternalWriteAllowed(operation = 'external-write') {
  if (!canWriteExternally()) {
    throw new Error(`Operação bloqueada no ambiente ${getEnvironment()}: ${operation}`);
  }
}

export function environmentSnapshot() {
  return Object.freeze({
    name: getEnvironment(),
    version: APP_CONFIG.version,
    externalWriteEnabled: canWriteExternally(),
    generatedAt: new Date().toISOString()
  });
}
