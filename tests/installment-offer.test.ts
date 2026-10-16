import { describe, it, expect } from 'vitest';
import { installmentConfigFor, installmentDisclosure } from '../supabase/functions/_shared/installment-offer';

describe('installmentConfigFor', () => {
  it('produção segue em 1x; sandbox oferece até 3x', () => {
    expect(installmentConfigFor(false).maxInstallments).toBe(1);
    expect(installmentConfigFor(true).maxInstallments).toBe(3);
  });
});

describe('installmentDisclosure (CDC art. 52)', () => {
  it('passe de R$ 697 em 3x: ~2,0% a.m. e ~27% a.a. (docs/plano-tabela-parcelado.md)', () => {
    const d = installmentDisclosure(724.88, 754.37, 3)!;
    expect(d.fee).toBe(29.49);
    expect(d.monthlyRate * 100).toBeGreaterThan(1.95);
    expect(d.monthlyRate * 100).toBeLessThan(2.1);
    expect(d.annualRate * 100).toBeGreaterThan(26);
    expect(d.annualRate * 100).toBeLessThan(28.5);
  });
  it('sem parcelas ou sem acréscimo: null', () => {
    expect(installmentDisclosure(100, 100, 1)).toBeNull();
    expect(installmentDisclosure(100, 100, 3)).toBeNull();
    expect(installmentDisclosure(0, 10, 3)).toBeNull();
  });
});
