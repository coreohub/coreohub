import { describe, it, expect } from 'vitest';
import {
  computeProcessingFee,
  cardCostFloor,
  asaasCost,
  allocateProportional,
  normalizeInstallments,
  PROCESSING_FEE_CONFIG,
} from '../supabase/functions/_shared/processing-fee';
import { applyUfRules, getUfRule, normalizeUf } from '../supabase/functions/_shared/uf-rules';

// Linha "Taxa de pagamento": dinheiro de gente real. Fórmula:
// min( max( p% x base , piso_custo_cartao ) , teto_pix_R$15 , teto_plateia_7% ).

describe('computeProcessingFee — Pix', () => {
  it('Pix 4% sobre a base (plateia R$ 55: preço 50 + comissão 10% repassada)', () => {
    const r = computeProcessingFee({ base: 55, method: 'pix', product: 'plateia' });
    expect(r.fee).toBe(2.2);
    expect(r.total).toBe(57.2);
    expect(r.capApplied).toBeNull();
    expect(r.costFloor).toBe(0); // sem piso de custo no Pix
    expect(r.asaasCost).toBe(1.99);
  });

  it('Pix sem piso: ingresso barato paga só 4% (abaixo do custo de R$ 1,99)', () => {
    const r = computeProcessingFee({ base: 11, method: 'pix', product: 'workshop' });
    expect(r.fee).toBe(0.44);
  });

  it('teto de R$ 15 no Pix (passe R$ 731,85: 4% = 29,27)', () => {
    const r = computeProcessingFee({ base: 731.85, method: 'pix', product: 'passe' });
    expect(r.fee).toBe(15);
    expect(r.capApplied).toBe('pix_cap');
  });

  it('Pix não aceita parcelas', () => {
    expect(() => computeProcessingFee({ base: 50, method: 'pix', installments: 2, product: 'plateia' })).toThrow();
  });
});

describe('computeProcessingFee — cartão', () => {
  it('faixas de percentual: 1x 4, 2-6x 5, 7-12x 6 (acima do piso de custo)', () => {
    const p = (n: number) => computeProcessingFee({ base: 1000, method: 'card', installments: n, product: 'passe' });
    expect(p(1).percentApplied).toBe(4);
    expect(p(1).fee).toBe(40);
    expect(p(2).percentApplied).toBe(5);
    expect(p(6).fee).toBe(50);
    expect(p(7).percentApplied).toBe(6);
    expect(p(12).fee).toBe(60);
  });

  it('cartão não tem o teto de R$ 15 (passe R$ 1.597 à vista: 4% = 63,88)', () => {
    const r = computeProcessingFee({ base: 1597, method: 'card', installments: 1, product: 'passe' });
    expect(r.fee).toBe(63.88);
    expect(r.capApplied).toBeNull();
  });

  it('piso de custo (gross-up) vence o percentual em ticket baixo fora de plateia', () => {
    // base 10: 4% = 0,40; custo gross-up 1x = ceil((10,49/0,9701) - 10) = 0,82
    const r = computeProcessingFee({ base: 10, method: 'card', installments: 1, product: 'workshop' });
    expect(r.costFloor).toBe(0.82);
    expect(r.fee).toBe(0.82);
  });

  it('invariante: em produto sem teto, total - custo Asaas >= base (CoreoHub não paga o cartão)', () => {
    for (const base of [5, 10, 20, 49.9, 100, 250, 731.85, 1597]) {
      for (const n of [1, 2, 3, 6, 7, 10, 12]) {
        const r = computeProcessingFee({ base, method: 'card', installments: n, product: 'workshop' });
        const net = r.total - asaasCost(r.total, 'card', n);
        // tolerância de 1 centavo do arredondamento do custo
        expect(net).toBeGreaterThanOrEqual(base - 0.011);
      }
    }
  });

  it('máximo de 12 parcelas imposto', () => {
    expect(() => computeProcessingFee({ base: 100, method: 'card', installments: 13, product: 'plateia' })).toThrow();
    expect(() => normalizeInstallments('card', 0)).toThrow();
    expect(() => normalizeInstallments('card', 1.5)).toThrow();
  });

  it('R$ 0,49 é por cobrança, não por parcela (custo igual em 2x e 6x, só muda a taxa %)', () => {
    expect(asaasCost(300, 'card', 3)).toBe(10.96); // 300 x 3,49% + 0,49 (Simulador Asaas: recebe 289,05)
    expect(asaasCost(300, 'card', 3)).toBe(asaasCost(300, 'card', 6));
  });
});

describe('computeProcessingFee — teto de 7% só em plateia', () => {
  it('plateia: teto 7% vence o piso de custo em ingresso muito barato (CoreoHub absorve o excesso)', () => {
    const r = computeProcessingFee({ base: 10, method: 'card', installments: 1, product: 'plateia' });
    expect(r.costFloor).toBe(0.82);
    expect(r.fee).toBe(0.7);
    expect(r.capApplied).toBe('plateia_cap');
  });

  it('plateia 12x: percentual 6% cabe no teto de 7%', () => {
    const r = computeProcessingFee({ base: 100, method: 'card', installments: 12, product: 'plateia' });
    expect(r.fee).toBe(6);
    expect(r.capApplied).toBeNull();
  });

  it('workshop/passe/seletiva/inscrição não têm o teto de 7%', () => {
    for (const product of ['workshop', 'passe', 'seletiva', 'inscricao'] as const) {
      const r = computeProcessingFee({ base: 10, method: 'card', installments: 1, product });
      expect(r.fee).toBe(0.82);
    }
  });
});

describe('meia: percentual é proporcional por construção', () => {
  it('Pix: taxa da meia = metade da taxa da inteira (abaixo do teto)', () => {
    const inteira = computeProcessingFee({ base: 55, method: 'pix', product: 'plateia' });
    const meia = computeProcessingFee({ base: 27.5, method: 'pix', product: 'plateia' });
    expect(meia.fee).toBe(1.1);
    expect(meia.fee * 2).toBeCloseTo(inteira.fee, 2);
  });
});

describe('base zero e config injetável', () => {
  it('base 0 => linha 0 (cortesia/grátis nunca cobra)', () => {
    expect(computeProcessingFee({ base: 0, method: 'pix', product: 'plateia' }).fee).toBe(0);
  });

  it('config alternativa muda o resultado sem tocar no código', () => {
    const cfg = { ...PROCESSING_FEE_CONFIG, percent: { ...PROCESSING_FEE_CONFIG.percent, pix: 2 } };
    expect(computeProcessingFee({ base: 100, method: 'pix', product: 'workshop', config: cfg }).fee).toBe(2);
  });

  it('cardCostFloor(0) = 0', () => {
    expect(cardCostFloor(0)).toBe(0);
  });
});

describe('allocateProportional', () => {
  it('soma das partes é exatamente o total', () => {
    const parts = allocateProportional(2.2, [50, 25, 25]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(2.2, 2);
    expect(parts).toEqual([1.1, 0.55, 0.55]);
  });

  it('resto de centavo vai pra maior fração, sem perder nem criar centavo', () => {
    const parts = allocateProportional(0.1, [1, 1, 1]);
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100)).toBe(10);
  });

  it('pesos zerados dividem igual', () => {
    expect(allocateProportional(0.03, [0, 0])).toEqual([0.02, 0.01]);
  });
});

describe('uf-rules', () => {
  it('normaliza UF', () => {
    expect(normalizeUf(' sp ')).toBe('SP');
    expect(normalizeUf(null)).toBeNull();
    expect(normalizeUf('São Paulo')).toBeNull();
  });

  it('UF sem regra não altera nada', () => {
    const r = applyUfRules({ uf: 'SP', face: 100, commissionRepassed: 10, fee: 4 });
    expect(r).toMatchObject({ fee: 4, commissionRepassed: 10, forcedAbsorb: false, capped: false, warnings: [] });
  });

  it('AC e RR: força absorção (zera linha e comissão repassada)', () => {
    for (const uf of ['AC', 'RR']) {
      const r = applyUfRules({ uf, face: 100, commissionRepassed: 10, fee: 4 });
      expect(r.forcedAbsorb).toBe(true);
      expect(r.fee).toBe(0);
      expect(r.commissionRepassed).toBe(0);
    }
  });

  it('ES: só avisa, não altera valores', () => {
    const r = applyUfRules({ uf: 'ES', face: 100, commissionRepassed: 10, fee: 4 });
    expect(r.fee).toBe(4);
    expect(r.warnings).toHaveLength(1);
  });

  it('AL/RJ: comissão + linha limitadas a 10% do valor de face', () => {
    // face 100, comissão repassada 10 já consome o teto => linha 0
    expect(applyUfRules({ uf: 'RJ', face: 100, commissionRepassed: 10, fee: 4 }).fee).toBe(0);
    // comissão embutida absorvida (0): linha pode ir até 10
    const r = applyUfRules({ uf: 'AL', face: 100, commissionRepassed: 0, fee: 12 });
    expect(r.fee).toBe(10);
    expect(r.capped).toBe(true);
    // abaixo do teto não mexe
    expect(applyUfRules({ uf: 'AL', face: 100, commissionRepassed: 5, fee: 4 }).fee).toBe(4);
  });

  it('PR: teto de 20% (ingresso de R$ 15 com comissão 10% + linha de R$ 1,99 fixo estourava)', () => {
    const r = applyUfRules({ uf: 'PR', face: 15, commissionRepassed: 1.5, fee: 3 });
    expect(r.fee).toBe(1.5); // 20% de 15 = 3,00; menos 1,50 de comissão
    expect(r.capped).toBe(true);
  });

  it('getUfRule null para UF inválida', () => {
    expect(getUfRule('XX')).toBeNull();
  });
});

import {
  sumProcessingFee,
  producerNetExcludingFee,
  installmentsFromPayment,
} from '../supabase/functions/_shared/processing-fee';
import { computeAudienceCart } from '../supabase/functions/_shared/audience-pricing';

describe('webhook: a linha nunca entra no líquido do produtor', () => {
  it('sumProcessingFee trata NULL/undefined como 0', () => {
    expect(sumProcessingFee([{ processing_fee_amount: 2.2 }, { processing_fee_amount: null }, {}])).toBe(2.2);
    expect(sumProcessingFee([])).toBe(0);
  });

  it('sem linha (evento antigo): líquido = bruto - comissão, igual ao de sempre', () => {
    expect(producerNetExcludingFee(110, 10, 0)).toBe(100);
  });

  it('plateia repassar: 2 Inteira R$ 50, comissão 10%, Pix 4%: gross = produtor + comissão + linha', () => {
    const cart = computeAudienceCart({
      resolved: [{ idx: 0, nome: 'Inteira', kind: 'inteira', quantity: 2, precoUnit: 50, quantidadeTotal: null }],
      totalBase: 100, discountTotal: 0, commissionPercent: 10, feeMode: 'repassar',
    });
    const fee = computeProcessingFee({ base: cart.chargedTotal, method: 'pix', product: 'plateia' }).fee; // 4% de 110
    expect(fee).toBe(4.4);
    const gross = cart.chargedTotal + fee; // o que a Asaas cobra do comprador
    const net = producerNetExcludingFee(gross, cart.commissionTotal, fee);
    expect(gross).toBe(114.4);
    expect(net).toBe(cart.producerTotal); // produtor segue com 100, a linha não o toca
    expect(net + cart.commissionTotal + fee).toBeCloseTo(gross, 2);
  });

  it('absorver: base = preço; produtor continua com preço - comissão', () => {
    const cart = computeAudienceCart({
      resolved: [{ idx: 0, nome: 'Inteira', kind: 'inteira', quantity: 1, precoUnit: 100, quantidadeTotal: null }],
      totalBase: 100, discountTotal: 0, commissionPercent: 10, feeMode: 'absorver',
    });
    const fee = computeProcessingFee({ base: cart.chargedTotal, method: 'pix', product: 'plateia' }).fee; // 4,00
    const gross = cart.chargedTotal + fee;
    expect(producerNetExcludingFee(gross, cart.commissionTotal, fee)).toBe(90);
  });

  it('cartão 10x workshop: master recebe comissão + linha e paga o custo da Asaas; produtor intocado', () => {
    const base = 731.85; // 697 + 5% de comissão repassada
    const r = computeProcessingFee({ base, method: 'card', installments: 10, product: 'workshop' });
    expect(r.fee).toBe(43.91); // 6% de 731,85
    const commission = 34.85;
    const net = producerNetExcludingFee(r.total, commission, r.fee);
    expect(net).toBe(697);
    // sobra da CoreoHub depois do custo Asaas: comissão + linha - custo > 0
    expect(commission + r.fee - r.asaasCost).toBeGreaterThan(0);
  });

  it('installmentsFromPayment só aceita inteiro de 1 a 12', () => {
    expect(installmentsFromPayment({ installmentCount: 3 })).toBe(3);
    expect(installmentsFromPayment({ installmentCount: '6' })).toBe(6);
    expect(installmentsFromPayment({ installmentCount: 13 })).toBeNull();
    expect(installmentsFromPayment({ installmentCount: null })).toBeNull();
    expect(installmentsFromPayment({})).toBeNull();
    expect(installmentsFromPayment(undefined)).toBeNull();
  });
});
