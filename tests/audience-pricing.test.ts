import { describe, it, expect } from 'vitest';
import { computeAudienceCart, type PricingInput } from '../supabase/functions/_shared/audience-pricing';

// O cálculo que decide quanto o comprador paga e quanto vai pro produtor.
// Bug aqui = cobra valor errado de gente real. Testa o cenário do carrinho
// multi-tipo (2 Inteira + 1 Meia), os 2 fee_modes e a distribuição de cupom.

const inteira = (qty: number, preco = 50): PricingInput =>
  ({ idx: 0, nome: 'Inteira', kind: 'inteira', quantity: qty, precoUnit: preco, quantidadeTotal: null });
const meia = (qty: number, preco = 25): PricingInput =>
  ({ idx: 1, nome: 'Meia', kind: 'meia', quantity: qty, precoUnit: preco, quantidadeTotal: null });

describe('computeAudienceCart — fee_mode repassar (taxa embutida)', () => {
  it('cart misto 2 Inteira (R$50) + 1 Meia (R$25), comissão 10%, sem cupom', () => {
    const resolved = [inteira(2), meia(1)];
    const totalBase = 50 * 2 + 25 * 1; // 125
    const r = computeAudienceCart({ resolved, totalBase, discountTotal: 0, commissionPercent: 10, feeMode: 'repassar' });

    // Inteira: base 50, comissão 5, charged 55. ×2 = 110 charged, 100 produtor, 10 comissão
    // Meia: base 25, comissão 2.5, charged 27.5. ×1 = 27.5 charged, 25 produtor, 2.5 comissão
    expect(r.chargedTotal).toBe(137.5);
    expect(r.producerTotal).toBe(125);
    expect(r.commissionTotal).toBe(12.5);
    expect(r.discountApplied).toBe(0);
  });

  it('invariante: charged = producer + comissão (repassar)', () => {
    const resolved = [inteira(3), meia(1)];
    const totalBase = 50 * 3 + 25;
    const r = computeAudienceCart({ resolved, totalBase, discountTotal: 0, commissionPercent: 10, feeMode: 'repassar' });
    expect(r.producerTotal + r.commissionTotal).toBeCloseTo(r.chargedTotal, 2);
  });

  it('item individual carrega preço base com desconto já aplicado', () => {
    const resolved = [inteira(2)];
    const r = computeAudienceCart({ resolved, totalBase: 100, discountTotal: 0, commissionPercent: 10, feeMode: 'repassar' });
    expect(r.items[0].preco).toBe(50);
    expect(r.items[0].commission_amount).toBe(5);
    expect(r.items[0].producer_amount).toBe(50);
  });
});

describe('computeAudienceCart — fee_mode absorver (produtor absorve)', () => {
  it('comprador paga só a base; produtor recebe base - comissão', () => {
    const resolved = [inteira(2)];
    const r = computeAudienceCart({ resolved, totalBase: 100, discountTotal: 0, commissionPercent: 10, feeMode: 'absorver' });
    // charged = 50×2 = 100 (sem taxa embutida); produtor = 45×2 = 90; comissão = 5×2 = 10
    expect(r.chargedTotal).toBe(100);
    expect(r.producerTotal).toBe(90);
    expect(r.commissionTotal).toBe(10);
  });

  it('invariante: charged = producer + comissão (absorver)', () => {
    const resolved = [inteira(2), meia(1)];
    const totalBase = 125;
    const r = computeAudienceCart({ resolved, totalBase, discountTotal: 0, commissionPercent: 10, feeMode: 'absorver' });
    expect(r.producerTotal + r.commissionTotal).toBeCloseTo(r.chargedTotal, 2);
  });
});

describe('computeAudienceCart — cupom distribuído proporcional', () => {
  it('desconto cart-level reparte por peso do tipo no total', () => {
    const resolved = [inteira(2), meia(1)]; // base 100 + 25 = 125
    const totalBase = 125;
    // R$ 25 de desconto no carrinho → proporcional: Inteira pega 100/125, Meia 25/125
    const r = computeAudienceCart({ resolved, totalBase, discountTotal: 25, commissionPercent: 10, feeMode: 'repassar' });

    // Inteira: typeBase 100 → typeDiscount 20 → perTicket 10 → base 40
    // Meia: typeBase 25 → typeDiscount 5 → perTicket 5 → base 20
    expect(r.items[0].preco).toBe(40);   // inteira com desconto
    expect(r.items[1].preco).toBe(20);   // meia com desconto
    expect(r.discountApplied).toBe(25);  // desconto total aplicado bate
  });

  it('desconto reduz a comissão (comissão é sobre a base já descontada)', () => {
    const resolved = [inteira(1, 100)];
    const r = computeAudienceCart({ resolved, totalBase: 100, discountTotal: 50, commissionPercent: 10, feeMode: 'repassar' });
    // base 100 - 50 = 50 → comissão 10% de 50 = 5 (não 10)
    expect(r.items[0].preco).toBe(50);
    expect(r.items[0].commission_amount).toBe(5);
  });

  it('lança erro se desconto exceder o preço base do tipo', () => {
    const resolved = [inteira(1, 30)];
    expect(() =>
      computeAudienceCart({ resolved, totalBase: 30, discountTotal: 40, commissionPercent: 10, feeMode: 'repassar' }),
    ).toThrow();
  });
});

describe('computeAudienceCart — edge cases', () => {
  it('totalBase 0 não divide por zero', () => {
    const resolved = [{ idx: 0, nome: 'Cortesia', kind: 'cortesia', quantity: 1, precoUnit: 0, quantidadeTotal: null }];
    const r = computeAudienceCart({ resolved, totalBase: 0, discountTotal: 0, commissionPercent: 10, feeMode: 'repassar' });
    expect(r.chargedTotal).toBe(0);
    expect(r.discountApplied).toBe(0);
  });

  it('preserva metadados do tipo (id, nome, kind, estoque)', () => {
    const resolved: PricingInput[] = [{ idx: 3, nome: 'VIP', kind: 'inteira', quantity: 1, precoUnit: 80, quantidadeTotal: 50 }];
    const r = computeAudienceCart({ resolved, totalBase: 80, discountTotal: 0, commissionPercent: 10, feeMode: 'repassar' });
    expect(r.items[0].ticket_type_id).toBe('3');
    expect(r.items[0].ticket_type_nome).toBe('VIP');
    expect(r.items[0].quantidade_total).toBe(50);
  });
});
