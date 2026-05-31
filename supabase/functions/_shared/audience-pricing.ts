// Distribuição de comissão/desconto do carrinho multi-tipo de ingressos.
//
// Fonte canônica da matemática que decide quanto o comprador paga, quanto a
// CoreoHub fica de comissão e quanto vai pro split do produtor. Extraído de
// create-audience-ticket (2026-05-30, A19) pra ser testável e pra o checkout
// (CheckoutIngresso.tsx breakdown) não divergir da edge — um bug de cálculo
// aqui cobra valor errado do comprador real.
//
// Regras:
//   - Desconto do cupom é cart-level: distribuído proporcional ao peso de cada
//     tipo no total (typeBase / totalBase).
//   - fee_mode 'repassar' = taxa embutida no preço do comprador (charged =
//     base + comissão; produtor recebe base).
//   - fee_mode 'absorver' = produtor absorve (charged = base; produtor recebe
//     base - comissão).

export const round2 = (n: number) => parseFloat(n.toFixed(2));

export interface PricingInput {
  idx: number;
  nome: string;
  kind: string;
  quantity: number;
  precoUnit: number;          // preço de face vigente (sem desconto)
  quantidadeTotal: number | null;
}

export interface PricingItem {
  ticket_type_id: string;
  ticket_type_nome: string;
  kind: string;
  quantity: number;
  preco: number;              // base unitário JÁ com desconto aplicado
  commission_amount: number;  // comissão unitária
  producer_amount: number;    // líquido produtor unitário
  discount_per_ticket: number;
  quantidade_total: number | null;
}

export interface PricingResult {
  items: PricingItem[];
  chargedTotal: number;
  producerTotal: number;
  commissionTotal: number;
  discountApplied: number;
}

/**
 * Calcula os valores por tipo do carrinho.
 * @throws se desconto de um tipo exceder o preço base.
 */
export function computeAudienceCart(opts: {
  resolved: PricingInput[];
  totalBase: number;          // Σ precoUnit*quantity (face, sem desconto)
  discountTotal: number;      // desconto absoluto do cupom (sobre o total)
  commissionPercent: number;
  feeMode: 'repassar' | 'absorver' | string;
}): PricingResult {
  const { resolved, totalBase, discountTotal, commissionPercent, feeMode } = opts;

  let chargedTotal = 0;
  let producerTotal = 0;
  let commissionTotal = 0;
  let discountApplied = 0;

  const items = resolved.map((r) => {
    const typeBase = r.precoUnit * r.quantity;
    const typeDiscount = totalBase > 0 ? round2(discountTotal * (typeBase / totalBase)) : 0;
    const discountPerTicket = round2(typeDiscount / r.quantity);
    const baseFeeUnit = round2(r.precoUnit - discountPerTicket);
    if (baseFeeUnit < 0) throw new Error('Desconto maior que o preço base');
    const commissionUnit = round2(baseFeeUnit * (commissionPercent / 100));
    let chargedUnit: number;
    let producerUnit: number;
    if (feeMode === 'repassar') {
      chargedUnit = round2(baseFeeUnit + commissionUnit);
      producerUnit = baseFeeUnit;
    } else {
      chargedUnit = baseFeeUnit;
      producerUnit = round2(baseFeeUnit - commissionUnit);
    }
    chargedTotal += round2(chargedUnit * r.quantity);
    producerTotal += round2(producerUnit * r.quantity);
    commissionTotal += round2(commissionUnit * r.quantity);
    discountApplied += round2(discountPerTicket * r.quantity);
    return {
      ticket_type_id: String(r.idx),
      ticket_type_nome: r.nome,
      kind: r.kind,
      quantity: r.quantity,
      preco: baseFeeUnit,
      commission_amount: commissionUnit,
      producer_amount: producerUnit,
      discount_per_ticket: discountPerTicket,
      quantidade_total: r.quantidadeTotal,
    };
  });

  return {
    items,
    chargedTotal: round2(chargedTotal),
    producerTotal: round2(producerTotal),
    commissionTotal: round2(commissionTotal),
    discountApplied: round2(discountApplied),
  };
}
