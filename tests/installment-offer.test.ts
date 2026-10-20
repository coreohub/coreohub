import { describe, it, expect } from 'vitest';
import { installmentConfigFor, installmentDisclosure, MAX_INSTALLMENTS_CAP } from '../supabase/functions/_shared/installment-offer';
import { PROCESSING_FEE_CONFIG } from '../supabase/functions/_shared/processing-fee';

describe('installmentConfigFor', () => {
  it('produção segue em 1x; sandbox oferece até 3x', () => {
    expect(installmentConfigFor(false).maxInstallments).toBe(1);
    expect(installmentConfigFor(true).maxInstallments).toBe(3);
  });

  it('flag por evento (events.max_installments) liga o parcelado em produção', () => {
    expect(installmentConfigFor(false, 1).maxInstallments).toBe(1);
    expect(installmentConfigFor(false, 3).maxInstallments).toBe(3);
    expect(installmentConfigFor(false, 6).maxInstallments).toBe(6);
  });

  it('teto de 6 vale sempre, mesmo com valor maior no banco', () => {
    expect(installmentConfigFor(false, 12).maxInstallments).toBe(MAX_INSTALLMENTS_CAP);
    expect(installmentConfigFor(true, 21).maxInstallments).toBe(MAX_INSTALLMENTS_CAP);
  });

  it('valor ausente, zero, negativo ou inválido cai em 1x (falha fechada)', () => {
    for (const bad of [undefined, null, 0, -2, NaN, 'x' as unknown as number]) {
      expect(installmentConfigFor(false, bad).maxInstallments).toBe(1);
    }
  });

  it('sandbox oferece no mínimo 3x, e respeita a flag quando maior', () => {
    expect(installmentConfigFor(true, 1).maxInstallments).toBe(3);
    expect(installmentConfigFor(true, 5).maxInstallments).toBe(5);
  });

  it('não altera a config de produção compartilhada', () => {
    installmentConfigFor(false, 6);
    expect(PROCESSING_FEE_CONFIG.maxInstallments).toBe(1);
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
