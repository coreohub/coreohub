import { describe, it, expect } from 'vitest';
import { computeWorkshopCheckout } from '../supabase/functions/_shared/workshop-checkout';
import { PROCESSING_FEE_CONFIG } from '../supabase/functions/_shared/processing-fee';

const PARCELADO = { ...PROCESSING_FEE_CONFIG, maxInstallments: 12 };

const base = (itemShares: number[], over: Record<string, unknown> = {}) => ({
  product: 'workshop' as const,
  itemShares,
  commissionPercent: 10,
  feeMode: 'repassar',
  processingFeeEnabled: true,
  payer: 'comprador',
  method: 'pix' as const,
  installments: 1,
  uf: 'SP',
  ...over,
});

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

describe('computeWorkshopCheckout — chave desligada ou sem evento = comportamento de sempre', () => {
  it('repassar: comissão sobre o preço, cobra preço + comissão, sem linha, mesmo sem método', () => {
    const r = computeWorkshopCheckout(base([200], { processingFeeEnabled: false, method: null }));
    expect(r.chargedTotal).toBe(220);
    expect(r.producerTotal).toBe(200);
    expect(r.commissionTotal).toBe(20);
    expect(r.processingFee).toBe(0);
    expect(r.items[0].processing_fee_amount).toBe(0);
  });

  it('absorver: cobra o preço, produtor recebe preço - comissão', () => {
    const r = computeWorkshopCheckout(base([200], { processingFeeEnabled: false, feeMode: 'absorver', method: null }));
    expect(r.chargedTotal).toBe(200);
    expect(r.producerTotal).toBe(180);
    expect(r.commissionTotal).toBe(20);
  });

  it('avulso (sem event_id): o chamador passa processingFeeEnabled=false e nada muda, nem em UF proibida', () => {
    const r = computeWorkshopCheckout(base([200], { processingFeeEnabled: false, uf: 'AC', method: null }));
    expect(r.forcedAbsorb).toBe(false);
    expect(r.feeMode).toBe('repassar');
    expect(r.chargedTotal).toBe(220);
  });

  it('chave ligada exige a forma de pagamento', () => {
    expect(() => computeWorkshopCheckout(base([200], { method: null }))).toThrow('Escolha a forma de pagamento');
  });
});

describe('computeWorkshopCheckout — comprador paga a linha', () => {
  it('Pix R$ 200 repassar: base 220, linha 8,80, total 228,80; produtor e comissão intactos', () => {
    const r = computeWorkshopCheckout(base([200]));
    expect(r.chargedBeforeFee).toBe(220);
    expect(r.processingFee).toBe(8.8);
    expect(r.chargedTotal).toBe(228.8);
    expect(r.producerTotal).toBe(200);
    expect(r.commissionTotal).toBe(20);
    expect(r.items[0].processing_fee_amount).toBe(8.8);
  });

  it('Pix passe de R$ 697 (base 766,70): 4% = 30,67 cai no teto de R$ 15', () => {
    const r = computeWorkshopCheckout(base([697], { product: 'passe' }));
    expect(r.processingFee).toBe(15);
    expect(r.capApplied).toBe('pix_cap');
    expect(r.chargedTotal).toBe(781.7);
  });

  it('sem o teto de 7%: workshop barato mantém o piso de custo no cartão', () => {
    // R$ 5 em absorver: base 5, piso de custo do cartão 0,66; plateia seria cortada em 7% = 0,35
    const r = computeWorkshopCheckout(base([5], { feeMode: 'absorver', method: 'card' }));
    expect(r.processingFee).toBeGreaterThan(0.35);
    expect(r.capApplied).toBeNull();
  });

  it('invariante: total = produtor + comissão + linha (cartão, workshop e passe)', () => {
    for (const shares of [[200], [100.01, 33.33, 66.66]]) {
      const r = computeWorkshopCheckout(base(shares, { method: 'card', product: shares.length > 1 ? 'passe' : 'workshop' }));
      expect(r.processingFee).toBeGreaterThan(0);
      expect(r.producerTotal + r.commissionTotal + r.processingFee).toBeCloseTo(r.chargedTotal, 2);
    }
  });

  it('passe com 3 workshops: linha rateada pro rata em centavos, soma exata', () => {
    const r = computeWorkshopCheckout(base([100.01, 33.33, 66.66], { product: 'passe' }));
    const parts = r.items.map((i) => i.processing_fee_amount);
    expect(parts.every((p) => p > 0)).toBe(true);
    expect(sum(parts)).toBeCloseTo(r.processingFee, 2);
    expect(Math.round(sum(parts) * 100)).toBe(Math.round(r.processingFee * 100));
    // o mais caro paga mais
    expect(parts[0]).toBeGreaterThan(parts[1]);
  });

  it('gross por workshop (comissão + líquido + linha) soma o total cobrado, passe de 3 itens em absorver', () => {
    const r = computeWorkshopCheckout(base([100, 100, 100], { product: 'passe', feeMode: 'absorver' }));
    const gross = r.items.map((i) => i.commission_amount + i.producer_amount + i.processing_fee_amount);
    expect(sum(gross)).toBeCloseTo(r.chargedTotal, 2);
  });

  it('cartão parcelado segue recusado pela config padrão (1x)', () => {
    expect(() => computeWorkshopCheckout(base([200], { method: 'card', installments: 2 }))).toThrow();
    const r = computeWorkshopCheckout(base([200], { method: 'card', installments: 3, config: PARCELADO }));
    expect(r.processingFee).toBeGreaterThan(0);
  });
});

describe('computeWorkshopCheckout — produtor absorve', () => {
  it('comprador paga o mesmo que sem linha; linha vira comissão; processing_fee_amount = 0', () => {
    const r = computeWorkshopCheckout(base([200], { payer: 'produtor' }));
    expect(r.chargedTotal).toBe(220);
    expect(r.processingFee).toBe(0);
    expect(r.producerPaidFee).toBe(8.8);
    expect(r.producerTotal).toBe(191.2);
    expect(r.commissionTotal).toBe(28.8);
    expect(r.items[0].processing_fee_amount).toBe(0);
    expect(r.producerTotal + r.commissionTotal).toBeCloseTo(r.chargedTotal, 2);
  });

  it('passe: soma dos itens bate com os totais e nenhum líquido fica negativo', () => {
    const r = computeWorkshopCheckout(base([30, 5, 65], { payer: 'produtor', product: 'passe', method: 'card' }));
    expect(sum(r.items.map((i) => i.producer_amount))).toBeCloseTo(r.producerTotal, 2);
    expect(sum(r.items.map((i) => i.commission_amount))).toBeCloseTo(r.commissionTotal, 2);
    expect(r.items.every((i) => i.producer_amount >= 0)).toBe(true);
    expect(r.producerTotal + r.commissionTotal).toBeCloseTo(r.chargedTotal, 2);
  });
});

describe('computeWorkshopCheckout — regras de UF', () => {
  it('AC e RR: força absorver e linha 0, total = preço', () => {
    for (const uf of ['AC', 'RR']) {
      const r = computeWorkshopCheckout(base([200], { uf }));
      expect(r.forcedAbsorb).toBe(true);
      expect(r.feeMode).toBe('absorver');
      expect(r.processingFee).toBe(0);
      expect(r.chargedTotal).toBe(200);
      expect(r.producerTotal).toBe(180);
    }
  });

  it('RJ: comissão repassada + linha limitadas a 10% do valor de face (comissão de 10% já consome tudo)', () => {
    const r = computeWorkshopCheckout(base([200], { uf: 'RJ' }));
    expect(r.processingFee).toBe(0);
    expect(r.ufCapped).toBe(true);
    expect(r.chargedTotal).toBe(220);
  });

  it('RJ com comissão 5%: sobra 5% de face pra linha', () => {
    const r = computeWorkshopCheckout(base([200], { uf: 'RJ', commissionPercent: 5 }));
    expect(r.processingFee).toBe(8.4); // 4% de 210 = 8,40 cabe nos 10 restantes
    expect(r.ufCapped).toBe(false);
  });

  it('ES: só aviso', () => {
    const r = computeWorkshopCheckout(base([200], { uf: 'ES' }));
    expect(r.warnings.length).toBe(1);
    expect(r.processingFee).toBe(8.8);
  });
});

describe('computeWorkshopCheckout — chave desligada é idêntica à fórmula antiga das edge functions', () => {
  const r2 = (n: number) => parseFloat(n.toFixed(2));
  it('workshop: 2000 combinações de preço, comissão e modo', () => {
    for (let i = 1; i <= 2000; i++) {
      const preco = r2(((i * 7919) % 150000) / 100 + 0.01);
      const pct = [0, 2.5, 5, 7.9, 10, 12.5][i % 6];
      const feeMode = i % 2 ? 'repassar' : 'absorver';
      const commission = r2(preco * (pct / 100));
      const charged = feeMode === 'repassar' ? r2(preco + commission) : r2(preco);
      const producer = feeMode === 'repassar' ? r2(preco) : r2(preco - commission);
      const r = computeWorkshopCheckout(base([preco], { processingFeeEnabled: false, method: null, commissionPercent: pct, feeMode }));
      expect([r.chargedTotal, r.producerTotal, r.commissionTotal]).toEqual([charged, producer, commission]);
      expect(r.items[0].commission_amount).toBe(commission);
      expect(r.items[0].producer_amount).toBe(producer);
    }
  });

  it('passe: totais sobre a soma e itens por item, como antes', () => {
    for (let i = 1; i <= 500; i++) {
      const shares = [r2((i * 37) % 900 / 3 + 1), r2((i * 53) % 700 / 7 + 1), r2((i * 11) % 500 / 9 + 1)];
      const total = r2(shares.reduce((s, v) => s + v, 0));
      const pct = [5, 7.9, 10][i % 3];
      const feeMode = i % 2 ? 'repassar' : 'absorver';
      const commissionTotal = r2(total * (pct / 100));
      const r = computeWorkshopCheckout(base(shares, { product: 'passe', processingFeeEnabled: false, method: null, commissionPercent: pct, feeMode }));
      expect(r.commissionTotal).toBe(commissionTotal);
      expect(r.chargedTotal).toBe(feeMode === 'repassar' ? r2(total + commissionTotal) : total);
      expect(r.producerTotal).toBe(feeMode === 'repassar' ? total : r2(total - commissionTotal));
      shares.forEach((sh, k) => {
        const c = r2(sh * (pct / 100));
        expect(r.items[k].commission_amount).toBe(c);
        expect(r.items[k].producer_amount).toBe(feeMode === 'repassar' ? sh : r2(sh - c));
      });
    }
  });
});
