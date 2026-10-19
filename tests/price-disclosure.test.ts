import { describe, it, expect } from 'vitest';
import { computePriceDisclosure } from '../utils/priceDisclosure';

const base = {
  commissionPercent: 5,
  feeMode: 'repassar',
  processingFeeEnabled: true,
  payer: 'comprador',
  uf: 'SP',
  sandbox: false,
};

describe('computePriceDisclosure (preço total desde o primeiro contato)', () => {
  it('passe de R$ 697 com taxa ligada: serviço, Pix com teto e cartão (produção = 1x)', () => {
    const d = computePriceDisclosure({ ...base, product: 'passe', preco: 697 })!;
    expect(d.serviceFee).toBe(34.85);
    expect(d.hasPaymentFee).toBe(true);
    expect(d.pixTotal).toBe(746.85); // 731,85 + teto de R$ 15 no Pix
    expect(d.cardTotal).toBe(761.12); // 731,85 + 4%
    expect(d.installments).toBeNull(); // produção segue em 1x
  });

  it('em evento sandbox mostra o maior parcelamento que o servidor aceita', () => {
    const d = computePriceDisclosure({ ...base, product: 'passe', preco: 697, sandbox: true })!;
    expect(d.installments?.n).toBe(3);
    expect(d.installments!.perInstallment * 3).toBeGreaterThanOrEqual(d.installments!.total - 0.02);
    expect(d.installments!.total).toBeGreaterThan(d.cardTotal);
  });

  it('pedido abaixo do mínimo de parcelamento não oferece parcelas', () => {
    const d = computePriceDisclosure({ ...base, product: 'workshop', preco: 60, sandbox: true })!;
    expect(d.installments).toBeNull();
  });

  it('produtor assume a taxa de pagamento: só a taxa de serviço, sem aviso de pagamento', () => {
    const d = computePriceDisclosure({ ...base, product: 'workshop', preco: 100, payer: 'produtor' })!;
    expect(d.hasPaymentFee).toBe(false);
    expect(d.serviceFee).toBe(5);
    expect(d.pixTotal).toBe(105);
  });

  it('sem taxa nenhuma para o comprador (absorver + chave desligada): nada a mostrar', () => {
    expect(computePriceDisclosure({ ...base, product: 'workshop', preco: 100, feeMode: 'absorver', processingFeeEnabled: false })).toBeNull();
  });

  it('chave desligada com comissão repassada: só a taxa de serviço', () => {
    const d = computePriceDisclosure({ ...base, product: 'passe', preco: 697, processingFeeEnabled: false })!;
    expect(d.hasPaymentFee).toBe(false);
    expect(d.serviceFee).toBe(34.85);
    expect(d.pixTotal).toBe(731.85);
  });

  it('plateia usa a mesma conta do checkout (teto de 7% da plateia)', () => {
    const d = computePriceDisclosure({ ...base, product: 'plateia', preco: 20, commissionPercent: 10 })!;
    expect(d.serviceFee).toBe(2);
    expect(d.hasPaymentFee).toBe(true);
    expect(d.pixTotal).toBeGreaterThan(22);
    expect(d.pixTotal).toBeLessThanOrEqual(22 + 22 * 0.07 + 0.01);
  });

  it('preço zero não mostra taxa', () => {
    expect(computePriceDisclosure({ ...base, product: 'workshop', preco: 0 })).toBeNull();
  });

  it('UF que proíbe taxa online (AC) não mostra taxa de pagamento', () => {
    const d = computePriceDisclosure({ ...base, product: 'workshop', preco: 100, uf: 'AC' });
    expect(d === null || d.hasPaymentFee === false).toBe(true);
  });
});
