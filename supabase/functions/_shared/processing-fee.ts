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
//   - p%: Pix 4, cartão 4 (à vista e parcelado: a taxa de pagamento é a mesma; o parcelado soma à parte a
//     "taxa de parcelamento", ver abaixo) (PROCESSING_FEE_CONFIG.percent).
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
// Parcelado (decisão 2026-10-16, docs/plano-tabela-parcelado.md): a linha total do cartão parcelado é
// a taxa de pagamento (a mesma do 1x, com os mesmos tetos) MAIS a "taxa de parcelamento", que fica FORA
// dos tetos e repassa só o custo incremental da Asaas (MDR maior + antecipação pedida pela conta
// principal), sem margem: a CoreoHub fica exatamente como no 1x. Com P = base + taxa de pagamento,
// m1 = P x (1 - mdr1x) - 0,49 - base (margem do 1x) e a = taxa a.m. x prazo médio / 30:
//   V = (base + m1) / (1 - a);  T = (V + 0,49) / (1 - mdr_n);  taxa de parcelamento = T - P (centavo pra cima).
//
// Tudo configurável em PROCESSING_FEE_CONFIG (único lugar com números).

export type PaymentMethod = 'pix' | 'card';
export type ProcessingProduct = 'plateia' | 'workshop' | 'passe' | 'inscricao' | 'seletiva';

export interface ProcessingFeeConfig {
  /** Percentual da taxa de pagamento sobre a base (cartão: igual à vista e parcelado). */
  percent: { pix: number; card: number };
  /** Teto em reais, só no Pix. */
  pixCapReais: number;
  /** Teto percentual sobre a base, só nos produtos em plateiaCapProducts. */
  plateiaCapPercent: number;
  plateiaCapProducts: ProcessingProduct[];
  /** Limite de parcelas imposto no nosso checkout (a Asaas oferece até 21). */
  maxInstallments: number;
  /** Taxa de parcelamento: custo da antecipação pela conta principal e regras de elegibilidade. */
  installment: {
    /** Taxa de antecipação da conta principal, % ao mês (automática 1,6; manual 1,7). */
    anticipationPercentPerMonth: number;
    /** Dias entre parcelas (a Asaas credita a cada ~32; 33 deixa 1 dia de folga). */
    daysPerInstallment: number;
    /** Pedido mínimo (preço + comissão repassada) para oferecer parcelas. */
    minOrder: number;
    /** Valor mínimo de cada parcela (total / parcelas). */
    minInstallmentValue: number;
  };
  /** Custo real da Asaas (painel da master, 2026-10-02). */
  asaas: {
    pixCost: number;
    cardPercent: { card1x: number; card2to6: number; card7to12: number };
    /** R$ 0,49 é por COBRANÇA, não por parcela (Simulador Asaas, 5ª rodada). */
    cardFixedPerCharge: number;
  };
}

export const PROCESSING_FEE_CONFIG: ProcessingFeeConfig = {
  percent: { pix: 4, card: 4 },
  pixCapReais: 15,
  plateiaCapPercent: 7,
  plateiaCapProducts: ['plateia'],
  // Parcelado FIXADO em 1x por decisão do produtor (2026-10-04): a Asaas cria 1 cobrança por parcela e
  // repassa ao produtor de 32 em 32 dias; o webhook, o estorno (/installments/{id}/refund) e a
  // expiração ainda não tratam parcelamento. Para reabrir (alvo: 3), subir este valor SÓ depois de
  // implementar esses 3 pontos e de testar no sandbox. A taxa de parcelamento já está calculada abaixo.
  maxInstallments: 1,
  installment: {
    anticipationPercentPerMonth: 1.6,
    daysPerInstallment: 33,
    minOrder: 100,
    minInstallmentValue: 30,
  },
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
  /** Linha total cobrada do comprador: taxa de pagamento + taxa de parcelamento. */
  fee: number;
  /** Só a taxa de pagamento (com tetos). É a parte que o produtor pode assumir. */
  paymentFee: number;
  /** Só a taxa de parcelamento (0 no Pix e à vista). Sempre do comprador. */
  installmentFee: number;
  /** Custo estimado da antecipação (conta principal) embutido no total; 0 à vista. */
  anticipationCost: number;
  /** base + fee. */
  total: number;
  /** Percentual p% da taxa de pagamento aplicado antes de piso/tetos. */
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
  if (n > config.maxInstallments) {
    throw new Error(config.maxInstallments <= 1
      ? 'Parcelamento no cartão indisponível no momento: pague à vista no cartão ou no Pix'
      : `Máximo de ${config.maxInstallments} parcelas`);
  }
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

/** Fração do valor (após o MDR) paga à antecipação: taxa a.m. x prazo médio das N parcelas / 30. */
export function anticipationFactor(
  installments: number,
  config: ProcessingFeeConfig = PROCESSING_FEE_CONFIG,
): number {
  if (installments <= 1) return 0;
  const days = config.installment.daysPerInstallment * ((installments + 1) / 2);
  return (config.installment.anticipationPercentPerMonth / 100) * (days / 30);
}

/** Maior número de parcelas permitido para este pedido (pedido mínimo e parcela mínima). 1 = só à vista. */
export function maxInstallmentsForOrder(
  orderTotal: number,
  config: ProcessingFeeConfig = PROCESSING_FEE_CONFIG,
): number {
  if (!(orderTotal >= config.installment.minOrder)) return 1;
  const byValue = Math.floor(orderTotal / config.installment.minInstallmentValue);
  return Math.max(1, Math.min(config.maxInstallments, byValue));
}

/**
 * Taxa de parcelamento (cartão, N >= 2): custo incremental da Asaas, sem margem, deixando a CoreoHub
 * exatamente como no 1x. `paymentFee` é a taxa de pagamento já calculada (com tetos) para o mesmo pedido.
 */
export function installmentFeeFor(
  base: number,
  paymentFee: number,
  installments: number,
  config: ProcessingFeeConfig = PROCESSING_FEE_CONFIG,
): { installmentFee: number; anticipationCost: number } {
  if (installments <= 1 || !(base > 0)) return { installmentFee: 0, anticipationCost: 0 };
  const fixed = config.asaas.cardFixedPerCharge;
  const paid1x = round2(base + paymentFee);
  const m1 = paid1x * (1 - config.asaas.cardPercent.card1x / 100) - fixed - base;
  const a = anticipationFactor(installments, config);
  const afterMdr = (base + m1) / (1 - a);
  const total = (afterMdr + fixed) / (1 - config.asaas.cardPercent[cardBand(installments)] / 100);
  const installmentFee = Math.max(0, ceil2(total - paid1x));
  const anticipationCost = round2(((paid1x + installmentFee) * (1 - config.asaas.cardPercent[cardBand(installments)] / 100) - fixed) * a);
  return { installmentFee, anticipationCost };
}

export function computeProcessingFee(input: ProcessingFeeInput): ProcessingFeeResult {
  const config = input.config ?? PROCESSING_FEE_CONFIG;
  const installments = normalizeInstallments(input.method, input.installments, config);
  const base = round2(input.base);

  if (!(base > 0)) {
    return {
      fee: 0, paymentFee: 0, installmentFee: 0, anticipationCost: 0,
      total: Math.max(base, 0), percentApplied: 0, costFloor: 0, asaasCost: 0, capApplied: null,
    };
  }

  if (installments > 1 && installments > maxInstallmentsForOrder(base, config)) {
    throw new Error('Parcelamento indisponível para este valor: pague à vista no cartão ou no Pix');
  }

  // Taxa de pagamento: igual à vista e parcelado (a faixa de parcelas só muda o custo, não o percentual).
  const percentApplied = input.method === 'pix' ? config.percent.pix : config.percent.card;
  const pctFee = round2(base * (percentApplied / 100));
  const costFloor = input.method === 'card' ? cardCostFloor(base, 1, config) : 0;

  let paymentFee = Math.max(pctFee, costFloor);
  let capApplied: FeeCapApplied = null;

  if (input.method === 'pix' && paymentFee > config.pixCapReais) {
    paymentFee = config.pixCapReais;
    capApplied = 'pix_cap';
  }
  if (config.plateiaCapProducts.includes(input.product)) {
    const cap = floor2(base * (config.plateiaCapPercent / 100));
    if (paymentFee > cap) {
      paymentFee = cap;
      capApplied = 'plateia_cap';
    }
  }
  paymentFee = round2(paymentFee);

  // Taxa de parcelamento: fora dos tetos (decisão 2026-10-16); só cartão com 2+ parcelas.
  const inst = input.method === 'card'
    ? installmentFeeFor(base, paymentFee, installments, config)
    : { installmentFee: 0, anticipationCost: 0 };

  const fee = round2(paymentFee + inst.installmentFee);
  const total = round2(base + fee);
  return {
    fee,
    paymentFee,
    installmentFee: inst.installmentFee,
    anticipationCost: inst.anticipationCost,
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

/** Soma segura da linha gravada nas linhas de uma cobrança (NULL conta como 0). */
export function sumProcessingFee(rows: Array<{ processing_fee_amount?: number | string | null }>): number {
  return round2(rows.reduce((s, r) => s + Number(r.processing_fee_amount ?? 0), 0));
}

/**
 * Líquido do produtor de uma cobrança que inclui a linha: o produtor NUNCA recebe a linha.
 * gross = o que o comprador pagou (payment.value) = líquido + comissão + linha.
 */
export function producerNetExcludingFee(gross: number, commission: number, processingFee: number): number {
  return round2(gross - commission - processingFee);
}

/** Parcelas confirmadas pela Asaas (payment.installmentCount); null se ausente/inválido. */
export function installmentsFromPayment(payment: { installmentCount?: unknown } | null | undefined): number | null {
  const n = Number(payment?.installmentCount);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}
