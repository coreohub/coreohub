import { describe, it, expect } from 'vitest';
import { termsVersionAtLeast } from '../supabase/functions/_shared/terms-version';

describe('termsVersionAtLeast', () => {
  it('compara numericamente, não como texto', () => {
    expect(termsVersionAtLeast('1.6', '1.6')).toBe(true);
    expect(termsVersionAtLeast('1.10', '1.6')).toBe(true);
    expect(termsVersionAtLeast('2.0', '1.6')).toBe(true);
    expect(termsVersionAtLeast('1.5', '1.6')).toBe(false);
    expect(termsVersionAtLeast('1.3', '1.6')).toBe(false);
  });
  it('versão ausente ou ilegível nunca conta como aceite', () => {
    expect(termsVersionAtLeast(null, '1.6')).toBe(false);
    expect(termsVersionAtLeast(undefined, '1.6')).toBe(false);
    expect(termsVersionAtLeast('', '1.6')).toBe(false);
    expect(termsVersionAtLeast('abc', '1.6')).toBe(false);
  });
});
