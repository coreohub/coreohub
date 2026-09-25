import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveAsaasEnv,
  resolveWebhookEnvName,
  webhookMatchesEvent,
  SANDBOX_BASE_URL,
  type EnvReader,
} from '../supabase/functions/_shared/asaas-env';

const reader = (vars: Record<string, string>): EnvReader => ({ get: (n) => vars[n] });
const FULL = {
  ASAAS_API_KEY: 'prod-key',
  ASAAS_BASE_URL: 'https://www.asaas.com/api/v3/',
  ASAAS_SANDBOX_API_KEY: 'sand-key',
  ASAAS_WEBHOOK_TOKEN: 'prod-token',
  ASAAS_SANDBOX_WEBHOOK_TOKEN: 'sand-token',
};

describe('resolveAsaasEnv — matriz de flags', () => {
  it('padrão (sem flags) = produção, com a URL/chave de produção', () => {
    const e = resolveAsaasEnv({}, reader(FULL));
    expect(e).toEqual({ name: 'production', isSandbox: false, baseUrl: 'https://www.asaas.com/api/v3', apiKey: 'prod-key' });
  });

  it('produtor de teste SEM a flag do evento continua em produção', () => {
    expect(resolveAsaasEnv({ paymentSandbox: false, producerIsTestAccount: true }, reader(FULL)).name).toBe('production');
    expect(resolveAsaasEnv({ paymentSandbox: null, producerIsTestAccount: true }, reader(FULL)).name).toBe('production');
  });

  it('flag + conta de teste = sandbox, URL fixa no código', () => {
    const e = resolveAsaasEnv({ paymentSandbox: true, producerIsTestAccount: true }, reader(FULL));
    expect(e).toEqual({ name: 'sandbox', isSandbox: true, baseUrl: SANDBOX_BASE_URL, apiKey: 'sand-key' });
  });

  it('flag ligada em produtor REAL (ou desconhecido) recusa — nunca roteia ao sandbox', () => {
    expect(() => resolveAsaasEnv({ paymentSandbox: true, producerIsTestAccount: false }, reader(FULL))).toThrow(/não é conta de teste/);
    expect(() => resolveAsaasEnv({ paymentSandbox: true, producerIsTestAccount: null }, reader(FULL))).toThrow(/não é conta de teste/);
    expect(() => resolveAsaasEnv({ paymentSandbox: true }, reader(FULL))).toThrow(/não é conta de teste/);
  });
});

describe('resolveAsaasEnv — falha fechada', () => {
  it('produção sem ASAAS_BASE_URL recusa (não cai no sandbox)', () => {
    const { ASAAS_BASE_URL: _u, ...rest } = FULL;
    expect(() => resolveAsaasEnv({}, reader(rest))).toThrow(/ASAAS_BASE_URL ausente/);
  });
  it('produção sem ASAAS_API_KEY recusa', () => {
    const { ASAAS_API_KEY: _k, ...rest } = FULL;
    expect(() => resolveAsaasEnv({}, reader(rest))).toThrow(/ASAAS_API_KEY ausente/);
  });
  it('produção com URL de sandbox recusa', () => {
    expect(() => resolveAsaasEnv({}, reader({ ...FULL, ASAAS_BASE_URL: 'https://sandbox.asaas.com/api/v3' }))).toThrow(/aponta para sandbox/);
  });
  it('sandbox sem ASAAS_SANDBOX_API_KEY recusa (não cai na chave de produção)', () => {
    const { ASAAS_SANDBOX_API_KEY: _s, ...rest } = FULL;
    expect(() => resolveAsaasEnv({ paymentSandbox: true, producerIsTestAccount: true }, reader(rest))).toThrow(/ASAAS_SANDBOX_API_KEY ausente/);
  });
  it('chave vazia/espaços conta como ausente', () => {
    expect(() => resolveAsaasEnv({}, reader({ ...FULL, ASAAS_API_KEY: '   ' }))).toThrow(/ausente/);
  });
});

describe('webhook — ambiente pelo token', () => {
  it('reconhece cada token e rejeita o resto', () => {
    const r = reader(FULL);
    expect(resolveWebhookEnvName('prod-token', r)).toBe('production');
    expect(resolveWebhookEnvName('sand-token', r)).toBe('sandbox');
    expect(resolveWebhookEnvName('outro', r)).toBeNull();
    expect(resolveWebhookEnvName('', r)).toBeNull();
    expect(resolveWebhookEnvName(null, r)).toBeNull();
  });
  it('sem token de sandbox configurado, token vazio nunca vira sandbox', () => {
    const { ASAAS_SANDBOX_WEBHOOK_TOKEN: _t, ...rest } = FULL;
    expect(resolveWebhookEnvName('', reader(rest))).toBeNull();
  });
  it('pagamento sandbox só toca evento sandbox, e o inverso', () => {
    expect(webhookMatchesEvent('sandbox', true)).toBe(true);
    expect(webhookMatchesEvent('production', false)).toBe(true);
    expect(webhookMatchesEvent('production', null)).toBe(true);
    expect(webhookMatchesEvent('sandbox', false)).toBe(false);
    expect(webhookMatchesEvent('sandbox', null)).toBe(false);
    expect(webhookMatchesEvent('production', true)).toBe(false);
  });
});

// Catraca: nenhuma function NOVA pode ler as chaves Asaas direto — tem que usar o
// helper. A lista abaixo são as functions legadas ainda não migradas; ela só pode
// ENCOLHER (ao migrar uma function, remova-a daqui).
const LEGACY_DIRECT_READERS = new Set([
  'asaas-webhook', 'cancel-aggregate-payment', 'check-plan-fee-status', 'check-producer-kyc',
  'close-event-billing-settlement', 'create-aggregate-payment-asaas', 'create-payment-asaas',
  'create-setup-fee-payment', 'create-video-selection-payment', 'create-workshop-pass-registration',
  'create-workshop-registration', 'daily-release-funds', 'deduct-plan-fee-now', 'disable-asaas-notifications',
  'expire-pending-payments', 'get-producer-asaas-balance', 'manual-transfer-now', 'process-video-refund',
  'refund-asaas-payment', 'release-low-value-transfers', 'temp-test-installment-split',
  '_shared/asaas-payouts.ts',
]);

describe('catraca — leitura direta das chaves Asaas', () => {
  it('só as functions legadas conhecidas leem ASAAS_* direto', () => {
    const root = join(__dirname, '..', 'supabase', 'functions');
    const offenders: string[] = [];
    const scan = (rel: string, file: string) => {
      const src = readFileSync(file, 'utf-8');
      if (/Deno\.env\.get\(\s*['"]ASAAS_(API_KEY|BASE_URL|TRANSFER_API_KEY|WEBHOOK_TOKEN)['"]/.test(src)) {
        if (!LEGACY_DIRECT_READERS.has(rel)) offenders.push(rel);
      }
    };
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      if (name === '_shared') {
        for (const f of readdirSync(dir)) if (f.endsWith('.ts') && f !== 'asaas-env.ts') scan(`_shared/${f}`, join(dir, f));
        continue;
      }
      const idx = join(dir, 'index.ts');
      try { scan(name, idx); } catch { /* sem index.ts */ }
    }
    expect(offenders).toEqual([]);
  });
});
