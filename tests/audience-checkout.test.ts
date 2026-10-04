import { describe, it, expect } from 'vitest';
import { computeAudienceCheckout } from '../supabase/functions/_shared/audience-checkout';
import { computeAudienceCart, type PricingInput } from '../supabase/functions/_shared/audience-pricing';

const inteira = (qty: number, preco = 50): PricingInput =>
  ({ idx: 0, nome: 'Inteira', kind: 'inteira', quantity: qty, precoUnit: preco, quantidadeTotal: null });
const meia = (qty: number, preco = 25): PricingInput =>
  ({ idx: 1, nome: 'Meia', kind: 'meia', quantity: qty, precoUnit: preco, quantidadeTotal: null });

const base = (resolved: PricingInput[], over: Record<string, unknown> = {}) => ({
  resolved,
  totalBase: resolved.reduce((s, r) => s + r.precoUnit * r.quantity, 0),
  discountTotal: 0,
  commissionPercent: 10,
  feeMode: 'repassar',
  processingFeeEnabled: true,
  payer: 'comprador',
  method: 'pix' as const,
  installments: 1,
  uf: 'SP',
  ...over,
});

describe('computeAudienceCheckout — chave desligada = comportamento de sempre', () => {
  it('idêntico a computeAudienceCart, sem linha', () => {
    const resolved = [inteira(2), meia(1)];
    const r = computeAudienceCheckout(base(resolved, { processingFeeEnabled: false, method: null }));
    const old = computeAudienceCart({ resolved, totalBase: 125, discountTotal: 0, commissionPercent: 10, feeMode: 'repassar' });
    expect(r.chargedTotal).toBe(old.chargedTotal);
    expect(r.producerTotal).toBe(old.producerTotal);
    expect(r.commissionTotal).toBe(old.commissionTotal);
    expect(r.processingFee).toBe(0);
  });
});

describe('computeAudienceCheckout — comprador paga a linha', () => {
  it('Pix 2 Inteira (R$ 50) comissão 10% repassada: base 110, linha 4,40, total 114,40; produtor e comissão intactos', () => {
    const r = computeAudienceCheckout(base([inteira(2)]));
    expect(r.chargedBeforeFee).toBe(110);
    expect(r.processingFee).toBe(4.4);
    expect(r.chargedTotal).toBe(114.4);
    expect(r.producerTotal).toBe(100);
    expect(r.commissionTotal).toBe(10);
  });

  it('invariante: total = produtor + comissão + linha (carrinho misto Inteira + Meia)', () => {
    const r = computeAudienceCheckout(base([inteira(2), meia(1)], { method: 'card', installments: 3 }));
    expect(r.processingFee).toBeGreaterThan(0);
    expect(r.producerTotal + r.commissionTotal + r.processingFee).toBeCloseTo(r.chargedTotal, 2);
    expect(r.producerTotal).toBe(125); // intocado pela linha
  });

  it('cartão 10x usa o percentual de 7-12x (6%)', () => {
    const r = computeAudienceCheckout(base([inteira(1, 100)], { method: 'card', installments: 10 }));
    expect(r.chargedBeforeFee).toBe(110);
    expect(r.processingFee).toBe(6.6);
  });

  it('chave ligada sem forma de pagamento: erro (servidor nunca adivinha)', () => {
    expect(() => computeAudienceCheckout(base([inteira(1)], { method: null }))).toThrow(/forma de pagamento/i);
  });

  it('teto de 7% da plateia vence o piso de custo em ingresso barato no cartão', () => {
    const r = computeAudienceCheckout(base([inteira(1, 10)], { feeMode: 'absorver', method: 'card', installments: 1, commissionPercent: 0 }));
    expect(r.processingFee).toBe(0.7); // 7% de 10; custo real seria 0,82
    expect(r.capApplied).toBe('plateia_cap');
  });
});

describe('computeAudienceCheckout — fee_mode absorver (base = preço)', () => {
  it('Pix R$ 100, comissão 10% absorvida: base 100, linha 4, produtor segue com 90', () => {
    const r = computeAudienceCheckout(base([inteira(1, 100)], { feeMode: 'absorver' }));
    expect(r.chargedBeforeFee).toBe(100);
    expect(r.processingFee).toBe(4);
    expect(r.chargedTotal).toBe(104);
    expect(r.producerTotal).toBe(90);
  });
});

describe('computeAudienceCheckout — produtor absorve a linha', () => {
  it('comprador paga o mesmo; a linha sai do líquido do produtor e vira comissão (webhook segue fechando)', () => {
    const r = computeAudienceCheckout(base([inteira(2)], { payer: 'produtor' }));
    expect(r.processingFee).toBe(0);
    expect(r.chargedTotal).toBe(110); // comprador não paga a linha
    expect(r.producerPaidFee).toBe(4.4);
    expect(r.producerTotal).toBe(95.6);
    expect(r.commissionTotal).toBe(14.4);
    // webhook: líquido = gross - comissão (processing_fee_amount = 0)
    expect(r.chargedTotal - r.commissionTotal).toBeCloseTo(r.producerTotal, 2);
  });

  it('carrinho misto: soma exata e nenhum item com líquido negativo', () => {
    const r = computeAudienceCheckout(base([inteira(3, 40), meia(2, 20)], { payer: 'produtor', method: 'card', installments: 6 }));
    expect(r.producerTotal + r.commissionTotal).toBeCloseTo(r.chargedTotal, 2);
    r.items.forEach((it) => expect(it.producer_amount).toBeGreaterThanOrEqual(0));
  });
});

describe('computeAudienceCheckout — leis estaduais', () => {
  it('AC e RR: força absorção, sem linha, sem comissão repassada', () => {
    for (const uf of ['AC', 'RR']) {
      const r = computeAudienceCheckout(base([inteira(1, 100)], { uf }));
      expect(r.forcedAbsorb).toBe(true);
      expect(r.feeMode).toBe('absorver');
      expect(r.processingFee).toBe(0);
      expect(r.chargedTotal).toBe(100); // comprador paga só o preço de face
    }
  });

  it('RJ: comissão repassada de 10% já consome o teto de 10%, linha zera', () => {
    const r = computeAudienceCheckout(base([inteira(1, 100)], { uf: 'RJ' }));
    expect(r.processingFee).toBe(0);
    expect(r.ufCapped).toBe(true);
    expect(r.chargedTotal).toBe(110);
  });

  it('RJ com comissão absorvida: linha limitada a 10% do valor de face', () => {
    const r = computeAudienceCheckout(base([inteira(1, 100)], { uf: 'RJ', feeMode: 'absorver', method: 'card', installments: 12 }));
    expect(r.processingFee).toBe(6); // 6% < teto de 10 (comissão absorvida não entra na soma): não limita
    expect(r.ufCapped).toBe(false);
  });

  it('PR: teto de 20% cabe com comissão 10% + linha de 4%', () => {
    const r = computeAudienceCheckout(base([inteira(1, 100)], { uf: 'PR' }));
    expect(r.ufCapped).toBe(false);
    expect(r.processingFee).toBe(4.4);
  });

  it('ES: só aviso, valores iguais a SP', () => {
    const es = computeAudienceCheckout(base([inteira(1, 100)], { uf: 'ES' }));
    const sp = computeAudienceCheckout(base([inteira(1, 100)], { uf: 'SP' }));
    expect(es.chargedTotal).toBe(sp.chargedTotal);
    expect(es.warnings.length).toBe(1);
  });

  it('UF nula (evento sem estado) não aplica regra', () => {
    const r = computeAudienceCheckout(base([inteira(1, 100)], { uf: null }));
    expect(r.processingFee).toBe(4.4);
  });
});
