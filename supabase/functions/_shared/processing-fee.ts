// Linha "Taxa de pagamento" paga pelo comprador (decisão 2026-10-02/04).
//
// Fonte única da matemática da linha de processamento. Módulo puro (sem Deno.*,
// sem rede): edge functions e checkout do frontend importam daqui, pra o valor
// mostrado nunca divergir do valor cobrado. Calculado SEMPRE no servidor; o
// cliente só exibe.
//
// Fórmula (por pedido, base = o que o comprador pagaria sem a linha, ou seja,
// preço + comissão repassada; em 'absorver' a base é o preço):
//
//   linha = min( max( p% x base , piso_custo ) , tetos )
//
//   - p%: Pix 4, cartão à vista 4, 2-6x 5, 7-12x 6 (PROCESSING_FEE_CONFIG.percent).
//   - piso_custo: Pix = 0 (sem piso). Cartão = gross-up exato do custo da Asaas
//     (taxa% x total + R$ 0,49 por cobrança), pra a CoreoHub nunca pagar o
//     processamento do cartão do próprio bolso.
//   - tetos: Pix limitado a R$ 15 (custo real R$ 1,99; ticket alto não paga
//     centenas de reais de "processamento"); plateia limitada a 7% da base
//     (Decreto 13.108, art. 9, taxa acessória proporcional; tem meia). Workshop,
//     passe, seletiva e inscrição não têm o teto de 7%.
//   - O teto de plateia vence o piso de custo: em ingresso muito barato a
//     CoreoHub absorve o excesso (decisão 12 da memória).
//
// Tudo configurável em PROCESSING_FEE_CONFIG (único lugar com números).

export type PaymentMethod = 'pix' | 'card';
export type ProcessingProduct = 'plateia' | 'workshop' | 'passe' | 'inscricao' | 'seletiva';

export interface ProcessingFeeConfig {
  /** Percentual da linha sobre a base. */
  percent: { pix: number; card1x: number; card2to6: number; card7to12: number };
  /** Teto em reais, só no Pix. */
  pixCapReais: number;
  /** Teto percentual sobre a base, só nos produtos em plateiaCapProducts. */
  plateiaCapPercent: number;
  plateiaCapProducts: ProcessingProduct[];
  /** Limite de parcelas imposto no nosso checkout (a Asaas oferece até 21). */
  maxInstallments: number;
  /** Custo real da Asaas (painel da master, 2026-10-02). */
  asaas: {
    pixCost: number;
    cardPercent: { card1x: number; card2to6: number; card7to12: number };
    /** R$ 0,49 é por COBRANÇA, não por parcela (Simulador Asaas, 5ª rodada). */
    cardFixedPerCharge: number;
  };
}

export const PROCESSING_FEE_CONFIG: ProcessingFeeConfig = {
  percent: { pix: 4, card1x: 4, card2to6: 5, card7to12: 6 },
  pixCapReais: 15,
  plateiaCapPercent: 7,
  plateiaCapProducts: ['plateia'],
  maxInstallments: 12,
  asaas: {
    pixCost: 1.99,
    cardPercent: { card1x: 2.99, card2to6: 3.49, card7to12: 3.99 },
    cardFixedPerCharge: 0.49,
  },
};

export type FeeCapApplied = 'pix_cap' | 'plateia_cap' | null;

export interface ProcessingFeeInput {
  /** Valor do pedido antes da linha (preço + comissão repassada). */
  base: number;
  method: PaymentMethod;
  /** 1 no Pix; 1 a maxInstallments no cartão. */
  installments?: number;
  product: ProcessingProduct;
  config?: ProcessingFeeConfig;
}

export interface ProcessingFeeResult {
  /** Linha cobrada do comprador. */
  fee: number;
  /** base + fee. */
  total: number;
  /** Percentual p% aplicado antes de piso/tetos. */
  percentApplied: number;
  /** Piso de custo (cartão); 0 no Pix. */
  costFloor: number;
  /** Custo real da Asaas sobre o total cobrado (Pix 1,99; cartão % + 0,49). */
  asaasCost: number;
  capApplied: FeeCapApplied;
}

export const round2 = (n: number) => parseFloat(n.toFixed(2));
/** Arredonda pra cima ao centavo, tolerando ruído de ponto flutuante. */
export const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-7) / 100;
/** Arredonda pra baixo ao centavo, tolerando ruído de ponto flutuante. */
export const floor2 = (n: number) => Math.floor(n * 100 + 1e-7) / 100;

type CardBand = 'card1x' | 'card2to6' | 'card7to12';

function cardBand(installments: number): CardBand {
  if (installments <= 1) return 'card1x';
  if (installments <= 6) return 'card2to6';
  return 'card7to12';
}

export function normalizeInstallments(
  method: PaymentMethod,
  installments: number | undefined,
  config: ProcessingFeeConfig = PROCESSING_FEE_CONFIG,
): number {
  const n = installments ?? 1;
  if (!Number.isInteger(n) || n < 1) throw new Error('Número de parcelas inválido');
  if (method === 'pix') {
    if (n !== 1) throw new Error('Pix não tem parcelas');
    return 1;
  }
  if (n > config.maxInstallments) throw new Error(`Máximo de ${config.maxInstallments} parcelas`);
  return n;
}

/** Custo real que a Asaas cobra da master sobre um total cobrado. */
export function asaasCost(
  total: number,
  method: PaymentMethod,
  installments = 1,
  config: ProcessingFeeConfig = PROCESSING_FEE_CONFIG,
): number {
  if (method === 'pix') return config.asaas.pixCost;
  const rate = config.asaas.cardPercent[cardBand(installments)] / 100;
  return round2(total * rate + config.asaas.cardFixedPerCharge);
}

/**
 * Menor linha que cobre o custo do cartão: total T = base + L com
 * T x (1 - taxa) - 0,49 >= base  =>  L >= (base + 0,49) / (1 - taxa) - base.
 */
export function cardCostFloor(
  base: number,
  installments = 1,
  config: ProcessingFeeConfig = PROCESSING_FEE_CONFIG,
): number {
  if (base <= 0) return 0;
  const rate = config.asaas.cardPercent[cardBand(installments)] / 100;
  return ceil2((base + config.asaas.cardFixedPerCharge) / (1 - rate) - base);
}

export function computeProcessingFee(input: ProcessingFeeInput): ProcessingFeeResult {
  const config = input.config ?? PROCESSING_FEE_CONFIG;
  const installments = normalizeInstallments(input.method, input.installments, config);
  const base = round2(input.base);

  if (!(base > 0)) {
    return { fee: 0, total: Math.max(base, 0), percentApplied: 0, costFloor: 0, asaasCost: 0, capApplied: null };
  }

  const percentApplied =
    input.method === 'pix' ? config.percent.pix : config.percent[cardBand(installments)];
  const pctFee = round2(base * (percentApplied / 100));
  const costFloor = input.method === 'card' ? cardCostFloor(base, installments, config) : 0;

  let fee = Math.max(pctFee, costFloor);
  let capApplied: FeeCapApplied = null;

  if (input.method === 'pix' && fee > config.pixCapReais) {
    fee = config.pixCapReais;
    capApplied = 'pix_cap';
  }
  if (config.plateiaCapProducts.includes(input.product)) {
    const cap = floor2(base * (config.plateiaCapPercent / 100));
    if (fee > cap) {
      fee = cap;
      capApplied = 'plateia_cap';
    }
  }

  fee = round2(fee);
  const total = round2(base + fee);
  return {
    fee,
    total,
    percentApplied,
    costFloor,
    asaasCost: asaasCost(total, input.method, installments, config),
    capApplied,
  };
}

/**
 * Reparte um valor em centavos proporcional aos pesos (maior resto), de modo que
 * a soma das partes seja exatamente `total`. Usado pra gravar a linha por
 * ingresso/inscrição a partir da linha do pedido (rateio pro rata do preço).
 */
export function allocateProportional(total: number, weights: number[]): number[] {
  const cents = Math.round(total * 100);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (!(sum > 0)) {
    const even = Math.floor(cents / weights.length);
    const out = weights.map(() => even);
    for (let i = 0; i < cents - even * weights.length; i++) out[i] += 1;
    return out.map((c) => c / 100);
  }
  const raw = weights.map((w) => (cents * w) / sum);
  const base = raw.map(Math.floor);
  let rest = cents - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    base[i] += 1;
    rest -= 1;
  }
  return base.map((c) => c / 100);
}
