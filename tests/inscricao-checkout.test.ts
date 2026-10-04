import { describe, it, expect } from 'vitest';
import {
  computeInscricaoCheckout,
  inscricaoLineApplies,
  normalizeInscricaoMode,
  type InscricaoItemIn,
} from '../supabase/functions/_shared/inscricao-checkout';
import { PROCESSING_FEE_CONFIG, asaasCost } from '../supabase/functions/_shared/processing-fee';

const PARCELADO = { ...PROCESSING_FEE_CONFIG, maxInstallments: 12 };

// Inscrição repassar 10% sobre face (face 100 -> cobra 110, produtor 100, comissão 10).
const repassar = (face: number, pct = 10): InscricaoItemIn => {
  const commission = Math.round(face * pct) / 100;
  return { baseFee: face, charged: Math.round((face + commission) * 100) / 100, producer: face, commission };
};
// Inscrição absorver 10% (cobra face 100, produtor 90, comissão 10).
const absorver = (face: number, pct = 10): InscricaoItemIn => {
  const commission = Math.round(face * pct) / 100;
  return { baseFee: face, charged: face, producer: Math.round((face - commission) * 100) / 100, commission };
};

const inp = (items: InscricaoItemIn[], over: Record<string, unknown> = {}) => ({
  items,
  billingPlan: 'essencial',
  mode: 'pix_fechado_cartao_taxa',
  processingFeeEnabled: true,
  feeMode: 'repassar',
  method: 'pix' as const,
  installments: 1,
  uf: 'SP',
  ...over,
});

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

describe('inscricaoLineApplies / mode', () => {
  it('só Essencial e Escala com a chave ligada', () => {
    expect(inscricaoLineApplies('essencial', true)).toBe(true);
    expect(inscricaoLineApplies('escala', true)).toBe(true);
    expect(inscricaoLineApplies('comeco', true)).toBe(false);
    expect(inscricaoLineApplies('espetaculo', true)).toBe(false);
    expect(inscricaoLineApplies('essencial', false)).toBe(false);
    expect(inscricaoLineApplies(null, true)).toBe(false);
  });
  it('modo inválido cai no padrão', () => {
    expect(normalizeInscricaoMode('xyz')).toBe('pix_fechado_cartao_taxa');
    expect(normalizeInscricaoMode(null)).toBe('pix_fechado_cartao_taxa');
    expect(normalizeInscricaoMode('taxa_todas')).toBe('taxa_todas');
  });
});

describe('plano Começo e chave desligada: nada muda', () => {
  it('Começo: sem linha, sem exigir forma de pagamento, totais intactos', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)], { billingPlan: 'comeco', method: null }));
    expect(r.requiresMethod).toBe(false);
    expect(r.rule).toBe('none');
    expect(r.chargedTotal).toBe(110);
    expect(r.producerTotal).toBe(100);
    expect(r.commissionTotal).toBe(10);
  });
  it('chave desligada em plano elegível: idêntico', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)], { processingFeeEnabled: false, method: null }));
    expect(r.requiresMethod).toBe(false);
    expect(r.chargedTotal).toBe(110);
    expect(r.processingFee).toBe(0);
  });
  it('plano elegível com a chave ligada exige a forma', () => {
    expect(() => computeInscricaoCheckout(inp([repassar(100)], { method: null }))).toThrow('Escolha a forma de pagamento');
  });
});

describe('pix_fechado_cartao_taxa (padrão)', () => {
  it('Pix: sem linha, o inscrito paga o preço fechado', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)]));
    expect(r.requiresMethod).toBe(true);
    expect(r.rule).toBe('none');
    expect(r.processingFee).toBe(0);
    expect(r.chargedTotal).toBe(110);
  });
  it('cartão: linha paga pelo inscrito (4% de 110 = 4,40), produtor e comissão intactos', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)], { method: 'card' }));
    expect(r.rule).toBe('buyer');
    expect(r.processingFee).toBe(4.4);
    expect(r.chargedTotal).toBe(114.4);
    expect(r.producerTotal).toBe(100);
    expect(r.commissionTotal).toBe(10);
  });
  it('cartão: invariante total = produtor + comissão + linha, soma por inscrição exata', () => {
    const items = [repassar(100.01), repassar(33.33), repassar(66.66)];
    const r = computeInscricaoCheckout(inp(items, { method: 'card' }));
    expect(r.producerTotal + r.commissionTotal + r.processingFee).toBeCloseTo(r.chargedTotal, 2);
    expect(Math.round(sum(r.items.map((i) => i.processing_fee_amount)) * 100)).toBe(Math.round(r.processingFee * 100));
    expect(r.items[0].processing_fee_amount).toBeGreaterThan(r.items[1].processing_fee_amount);
  });
  it('cartão em inscrição de R$ 50 (absorver): o piso de custo vence os 4% e a CoreoHub não paga o cartão', () => {
    const r = computeInscricaoCheckout(inp([absorver(50)], { method: 'card', feeMode: 'absorver' }));
    expect(r.chargedBeforeFee).toBe(50);
    // total - custo Asaas >= base: a CoreoHub não paga o processamento do cartão
    expect(r.chargedTotal - asaasCost(r.chargedTotal, 'card')).toBeGreaterThanOrEqual(50 - 0.005);
  });
});

describe('taxa_todas', () => {
  it('Pix também paga a linha (4% de 110 = 4,40)', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)], { mode: 'taxa_todas' }));
    expect(r.rule).toBe('buyer');
    expect(r.processingFee).toBe(4.4);
    expect(r.chargedTotal).toBe(114.4);
  });
  it('Pix tem o teto de R$ 15 (inscrição de R$ 1.000)', () => {
    const r = computeInscricaoCheckout(inp([repassar(1000)], { mode: 'taxa_todas' }));
    expect(r.processingFee).toBe(15);
    expect(r.capApplied).toBe('pix_cap');
  });
  it('inscrição NÃO tem o teto de 7% de plateia', () => {
    const r = computeInscricaoCheckout(inp([absorver(5)], { mode: 'taxa_todas', method: 'card', feeMode: 'absorver' }));
    expect(r.capApplied).toBeNull();
    expect(r.processingFee).toBeGreaterThan(0.35);
  });
});

describe('fechado_total', () => {
  it('Pix: sem linha, a CoreoHub absorve; preço fechado', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)], { mode: 'fechado_total' }));
    expect(r.rule).toBe('none');
    expect(r.chargedTotal).toBe(110);
    expect(r.producerTotal).toBe(100);
  });
  it('cartão: o inscrito paga o mesmo; o produtor paga o custo real (sem margem) e a CoreoHub o recebe como comissão', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)], { mode: 'fechado_total', method: 'card' }));
    const cost = asaasCost(110, 'card'); // 110 x 2,99% + 0,49 = 3,78
    expect(r.rule).toBe('producer_cost');
    expect(r.chargedTotal).toBe(110);
    expect(r.processingFee).toBe(0);
    expect(r.producerPaidFee).toBe(cost);
    expect(r.producerTotal).toBe(Math.round((100 - cost) * 100) / 100);
    expect(r.commissionTotal).toBe(Math.round((10 + cost) * 100) / 100);
    expect(r.producerTotal + r.commissionTotal).toBeCloseTo(r.chargedTotal, 2);
    expect(r.items.every((i) => i.processing_fee_amount === 0)).toBe(true);
  });
  it('cartão: custo é menor que a fórmula com margem (4%)', () => {
    const a = computeInscricaoCheckout(inp([repassar(100)], { mode: 'fechado_total', method: 'card' }));
    const b = computeInscricaoCheckout(inp([repassar(100)], { mode: 'taxa_todas', method: 'card' }));
    expect(a.producerPaidFee).toBeLessThan(b.processingFee);
  });
  it('várias inscrições: soma dos itens bate com os totais e nenhum líquido fica negativo', () => {
    const r = computeInscricaoCheckout(inp([repassar(30), repassar(2), repassar(68)], { mode: 'fechado_total', method: 'card' }));
    expect(sum(r.items.map((i) => i.producer))).toBeCloseTo(r.producerTotal, 2);
    expect(sum(r.items.map((i) => i.commission))).toBeCloseTo(r.commissionTotal, 2);
    expect(r.items.every((i) => i.producer >= 0)).toBe(true);
  });
});

describe('UF (só linha paga pelo inscrito)', () => {
  it('AC/RR: sem linha', () => {
    for (const uf of ['AC', 'RR']) {
      const r = computeInscricaoCheckout(inp([repassar(100)], { method: 'card', uf }));
      expect(r.processingFee).toBe(0);
      expect(r.chargedTotal).toBe(110);
    }
  });
  it('RJ: comissão repassada de 10% já consome o teto de 10%', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)], { method: 'card', uf: 'RJ' }));
    expect(r.processingFee).toBe(0);
    expect(r.ufCapped).toBe(true);
  });
  it('ES: só avisa', () => {
    const r = computeInscricaoCheckout(inp([repassar(100)], { method: 'card', uf: 'ES' }));
    expect(r.warnings.length).toBe(1);
    expect(r.processingFee).toBe(4.4);
  });
});

describe('parcelado segue fixado em 1x', () => {
  it('cartão 3x é recusado pela config padrão; com config explícita usa a faixa 2-6x', () => {
    expect(() => computeInscricaoCheckout(inp([repassar(100)], { method: 'card', installments: 3 }))).toThrow();
    const r = computeInscricaoCheckout(inp([repassar(100)], { method: 'card', installments: 3, config: PARCELADO }));
    expect(r.processingFee).toBe(5.5); // 5% de 110
  });
});

describe('base zero', () => {
  it('inscrição gratuita: linha 0 e sem erro', () => {
    const r = computeInscricaoCheckout(inp([{ baseFee: 0, charged: 0, producer: 0, commission: 0 }], { method: 'card' }));
    expect(r.processingFee).toBe(0);
    expect(r.chargedTotal).toBe(0);
  });
});

describe('produto seletiva (taxa A do vídeo)', () => {
  it('mesmas regras da inscrição e sem o teto de 7% (taxa de R$ 5, absorver, cartão)', () => {
    const a = computeInscricaoCheckout(inp([absorver(5)], { method: 'card', feeMode: 'absorver', product: 'seletiva' }));
    const b = computeInscricaoCheckout(inp([absorver(5)], { method: 'card', feeMode: 'absorver' }));
    expect(a.capApplied).toBeNull();
    expect(a.processingFee).toBe(b.processingFee);
  });
  it('fechado_total no cartão: custo do produtor entra na comissão, linha do inscrito 0', () => {
    const r = computeInscricaoCheckout(inp([repassar(40)], { mode: 'fechado_total', method: 'card', product: 'seletiva' }));
    expect(r.rule).toBe('producer_cost');
    expect(r.processingFee).toBe(0);
    expect(r.producerPaidFee).toBeGreaterThan(0);
    expect(r.producerTotal + r.commissionTotal).toBeCloseTo(r.chargedTotal, 2);
  });
});
