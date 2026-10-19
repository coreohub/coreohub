// Preço total e taxas na vitrine (Decreto 13.108/2026, art. 4º VI e 7º: preço total e taxas discriminadas
// desde o primeiro contato). Usa a MESMA fonte do checkout (computeWorkshopCheckout), então o que a
// vitrine mostra nunca diverge do que o comprador paga. Só para 1 unidade do produto, sem cupom.
import { computeWorkshopCheckout } from '../supabase/functions/_shared/workshop-checkout';
import { computeAudienceCheckout } from '../supabase/functions/_shared/audience-checkout';
import { installmentConfigFor } from '../supabase/functions/_shared/installment-offer';
import type { ProcessingProduct } from '../supabase/functions/_shared/processing-fee';

export interface PriceDisclosureInput {
  product: Extract<ProcessingProduct, 'plateia' | 'workshop' | 'passe'>;
  /** Preço de tabela do produto (o que o produtor recebe). */
  preco: number;
  commissionPercent: number;
  feeMode: string | null | undefined;
  /** events.processing_fee_enabled */
  processingFeeEnabled: boolean;
  /** 'produtor' = o produtor assume a Taxa de pagamento (some para o comprador). */
  payer: string | null | undefined;
  /** events.state (UF) */
  uf: string | null | undefined;
  /** events.payment_sandbox (3x só abre em sandbox até a flag por evento). */
  sandbox: boolean;
}

export interface PriceDisclosure {
  /** Taxa de serviço (comissão repassada) em R$, 0 se não repassada. */
  serviceFee: number;
  /** Há Taxa de pagamento para o comprador. */
  hasPaymentFee: boolean;
  /** Total no Pix (preço + taxa de serviço + taxa de pagamento). */
  pixTotal: number;
  /** Total no cartão à vista. */
  cardTotal: number;
  /** Maior parcelamento aceito pelo servidor para este valor, ou null. */
  installments: { n: number; perInstallment: number; total: number } | null;
}

/** null = produto sem taxa nenhuma para o comprador (preço de tabela é o total): nada a mostrar. */
export function computePriceDisclosure(input: PriceDisclosureInput): PriceDisclosure | null {
  if (!(input.preco > 0)) return null;
  const config = installmentConfigFor(input.sandbox);
  const run = (method: 'pix' | 'card', installments: number) => {
    const commissionPercent = Number(input.commissionPercent ?? 10);
    const feeMode = input.feeMode ?? 'repassar';
    const payer = input.payer ?? 'comprador';
    if (input.product === 'plateia') {
      // Mesma conta do CheckoutIngresso: 1 ingresso, sem cupom.
      return computeAudienceCheckout({
        resolved: [{ idx: 0, nome: 'ingresso', kind: 'inteira', quantity: 1, precoUnit: input.preco, quantidadeTotal: null }],
        totalBase: input.preco,
        discountTotal: 0,
        commissionPercent,
        feeMode,
        processingFeeEnabled: input.processingFeeEnabled,
        payer,
        method,
        installments,
        uf: input.uf ?? null,
        config,
      });
    }
    return computeWorkshopCheckout({
      product: input.product,
      itemShares: [input.preco],
      commissionPercent,
      feeMode,
      processingFeeEnabled: input.processingFeeEnabled,
      payer,
      method,
      installments,
      uf: input.uf ?? null,
      config,
    });
  };

  let pix;
  let card;
  try {
    pix = run('pix', 1);
    card = run('card', 1);
  } catch {
    return null;
  }
  // O que o comprador paga acima do preço, antes da Taxa de pagamento (commissionTotal inclui a taxa que o
  // produtor assume, então não serve aqui).
  const serviceFee = pix.feeMode === 'repassar'
    ? Math.max(0, Math.round((pix.chargedBeforeFee - input.preco) * 100) / 100)
    : 0;
  const hasPaymentFee = pix.processingFee > 0 || card.processingFee > 0;
  if (serviceFee <= 0 && !hasPaymentFee) return null;

  let installments: PriceDisclosure['installments'] = null;
  for (let n = config.maxInstallments; n >= 2; n--) {
    try {
      const r = run('card', n);
      installments = { n, perInstallment: Math.round((r.chargedTotal / n) * 100) / 100, total: r.chargedTotal };
      break;
    } catch {
      // o servidor recusaria (pedido mínimo, parcela mínima ou UF): tenta com menos parcelas
    }
  }

  return { serviceFee, hasPaymentFee, pixTotal: pix.chargedTotal, cardTotal: card.chargedTotal, installments };
}
