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

// Produção fixa o parcelado em 1x (PROCESSING_FEE_CONFIG.maxInstallments = 1). Estes testes exercitam as
// tabelas de 2 a 12x (prontas pra quando o parcelado voltar) com uma config explícita.
const PARCELADO = { ...PROCESSING_FEE_CONFIG, maxInstallments: 12, installment: { ...PROCESSING_FEE_CONFIG.installment, minOrder: 0, minInstallmentValue: 1 } };

describe('parcelado fixado em 1x em produção', () => {
  it('config padrão: máximo de 1 parcela', () => {
    expect(PROCESSING_FEE_CONFIG.maxInstallments).toBe(1);
  });

  it('cartão 2x com a config padrão é recusado com mensagem clara', () => {
    expect(() => computeProcessingFee({ base: 100, method: 'card', installments: 2, product: 'plateia' }))
      .toThrow(/pague à vista/i);
  });

  it('cartão à vista e Pix seguem funcionando', () => {
    expect(computeProcessingFee({ base: 100, method: 'card', installments: 1, product: 'passe' }).fee).toBe(4);
    expect(computeProcessingFee({ base: 100, method: 'pix', product: 'passe' }).fee).toBe(4);
  });
});

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
  it('taxa de pagamento é 4% à vista e parcelado; a taxa de parcelamento é só do 2x em diante e cresce com N', () => {
    const p = (n: number) => computeProcessingFee({ base: 1000, method: 'card', installments: n, product: 'passe', config: PARCELADO });
    expect(p(1).paymentFee).toBe(40);
    expect(p(1).installmentFee).toBe(0);
    expect(p(1).fee).toBe(40);
    for (const n of [2, 3, 6, 12]) {
      expect(p(n).paymentFee).toBe(40);
      expect(p(n).percentApplied).toBe(4);
      expect(p(n).fee).toBeCloseTo(p(n).paymentFee + p(n).installmentFee, 2);
      expect(p(n).installmentFee).toBeGreaterThan(0);
    }
    expect(p(3).installmentFee).toBeGreaterThan(p(2).installmentFee);
    expect(p(6).installmentFee).toBeGreaterThan(p(3).installmentFee);
    expect(p(12).installmentFee).toBeGreaterThan(p(6).installmentFee);
  });

  it('taxa de parcelamento do passe de R$ 697 (base): 3x fica perto de R$ 30 e custa ~4% do pedido', () => {
    const r = computeProcessingFee({ base: 697, method: 'card', installments: 3, product: 'passe', config: PARCELADO });
    expect(r.paymentFee).toBe(27.88);
    expect(r.installmentFee).toBeGreaterThan(29);
    expect(r.installmentFee).toBeLessThan(31);
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

  it('invariante: sem tetos, total - custo Asaas - antecipação >= base (CoreoHub não paga o cartão nem a antecipação)', () => {
    for (const base of [5, 10, 20, 49.9, 100, 250, 731.85, 1597]) {
      for (const n of [1, 2, 3, 6, 7, 10, 12]) {
        if (n > Math.floor(base)) continue; // parcela mínima de R$ 1 nesta config de teste
        const r = computeProcessingFee({ base, method: 'card', installments: n, product: 'workshop', config: PARCELADO });
        const net = r.total - asaasCost(r.total, 'card', n) - r.anticipationCost;
        // tolerância de 3 centavos: arredondamentos do custo, do centavo pra cima e da antecipação
        expect(net).toBeGreaterThanOrEqual(base - 0.03);
      }
    }
  });

  it('parcelado: pedido abaixo do mínimo ou parcela abaixo do mínimo é recusado na config de produção', () => {
    const prod = { ...PROCESSING_FEE_CONFIG, maxInstallments: 3 };
    expect(() => computeProcessingFee({ base: 99, method: 'card', installments: 2, product: 'workshop', config: prod })).toThrow(/indisponível/i);
    expect(() => computeProcessingFee({ base: 100, method: 'card', installments: 4, product: 'workshop', config: { ...prod, maxInstallments: 12 } })).toThrow(/indisponível/i);
    expect(computeProcessingFee({ base: 100, method: 'card', installments: 3, product: 'workshop', config: prod }).installmentFee).toBeGreaterThan(0);
  });

  it('máximo de 12 parcelas imposto', () => {
    expect(() => computeProcessingFee({ base: 100, method: 'card', installments: 13, product: 'plateia', config: PARCELADO })).toThrow();
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

  it('plateia 3x: a taxa de pagamento (4%) fica no teto de 7%, a taxa de parcelamento fica FORA do teto', () => {
    const r = computeProcessingFee({ base: 100, method: 'card', installments: 3, product: 'plateia', config: PARCELADO });
    expect(r.paymentFee).toBe(4);
    expect(r.capApplied).toBeNull();
    expect(r.installmentFee).toBeGreaterThan(3);
    expect(r.fee).toBeGreaterThan(7); // total acima de 7% do pedido, de propósito
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
  installmentShare,
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

  it('cartão 3x workshop: produtor intocado e a CoreoHub fica como no 1x (taxa de parcelamento só cobre custo)', () => {
    const base = 731.85; // 697 + 5% de comissão repassada
    const r = computeProcessingFee({ base, method: 'card', installments: 3, product: 'workshop', config: PARCELADO });
    const one = computeProcessingFee({ base, method: 'card', installments: 1, product: 'workshop' });
    const commission = 34.85;
    const net = producerNetExcludingFee(r.total, commission, r.fee);
    expect(net).toBe(697);
    const keep = (x: typeof r) => commission + x.fee - x.asaasCost - x.anticipationCost;
    expect(keep(r)).toBeGreaterThan(0);
    expect(Math.abs(keep(r) - keep(one))).toBeLessThan(0.05); // margem igual ao 1x
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

describe('installmentShare: fração do pedido que cada parcela representa', () => {
  it('à vista ou sem contagem: 1', () => {
    expect(installmentShare(100, 100, 1)).toBe(1);
    expect(installmentShare(100, 100, null)).toBe(1);
    expect(installmentShare(100, 0, 3)).toBe(1);
  });
  it('3x de R$ 20 num pedido de R$ 60: 1/3 cada, soma 1 (com R$ 100 em 3x: 33,33 + 33,33 + 33,34)', () => {
    expect(installmentShare(20, 60, 3)).toBeCloseTo(1 / 3, 5);
    const parts = [33.33, 33.33, 33.34].map((v) => installmentShare(v, 100, 3));
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
  });
  it('nunca passa de 1', () => {
    expect(installmentShare(120, 100, 3)).toBe(1);
  });
});
