import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Incidente 2026-09-24: uma regra de `headers` foi inserida por engano DENTRO do
// array `headers` de outra regra ("headers[2].headers[0] should NOT have additional
// property `source`") e a Vercel recusou o deploy de produção. O JSON era válido, só
// o schema da Vercel pegava. Estes testes garantem a estrutura básica.
const cfg = JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf-8'));

describe('vercel.json — estrutura de headers', () => {
  it('toda regra tem source e uma lista de headers', () => {
    for (const rule of cfg.headers ?? []) {
      expect(typeof rule.source).toBe('string');
      expect(Array.isArray(rule.headers)).toBe(true);
    }
  });

  it('cada item de headers[].headers tem SOMENTE key e value', () => {
    for (const rule of cfg.headers ?? []) {
      for (const h of rule.headers) {
        expect(Object.keys(h).sort()).toEqual(['key', 'value']);
      }
    }
  });

  it('toda rewrite tem source e destination', () => {
    for (const r of cfg.rewrites ?? []) {
      expect(typeof r.source).toBe('string');
      expect(typeof r.destination).toBe('string');
    }
  });
});
