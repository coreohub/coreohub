// Registro do que cada cobrança ESPERA receber (tabela payment_expectations).
// Auditoria 2026-11-15, Lote 1 (L1-b). Gravado pelas edges de cobrança logo depois de a Asaas
// devolver o id; lido pelo asaas-webhook (Passos 6/7, PAYMENT_CHECK_MODE) para conferir o
// pagamento recebido. NUNCA trava a venda: se a gravação falhar, só loga [ALERT].

export interface PaymentExpectationRow {
  asaas_payment_id: string
  registration_id: string | null
  kind: 'REG' | 'VS' | 'AGG' | 'AT' | 'WS' | 'WSP'
  event_id: string | null
  producer_wallet_id: string | null
  expected_value: number
  installments?: number
  formato?: string | null
  bailarinos_count?: number | null
}

export const roundMoney = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function countBailarinos(detalhes: unknown): number {
  return Array.isArray(detalhes) ? detalhes.length : 0
}

// deno-lint-ignore no-explicit-any
export async function recordPaymentExpectations(supabase: any, rows: PaymentExpectationRow[], tag: string): Promise<void> {
  if (!rows.length) return
  try {
    const { error } = await supabase.from('payment_expectations').insert(rows)
    if (error) {
      console.error(`[ALERT][${tag}] payment_expectations não gravada (${error.code ?? 'sem código'}): ${error.message}`)
    }
  } catch (e) {
    console.error(`[ALERT][${tag}] payment_expectations exceção: ${(e as Error)?.message ?? e}`)
  }
}

// Reparte o valor total da fatura entre as inscrições: cada uma fica com a sua parte
// (cobrado + linha de taxa), e a ÚLTIMA absorve a diferença de arredondamento, para a soma
// bater exatamente com o valor enviado à Asaas.
export function expectedPerItem(charged: number[], fees: number[], total: number): number[] {
  const parts = charged.map((c, i) => roundMoney(Number(c) + Number(fees[i] ?? 0)))
  if (!parts.length) return parts
  const sumOthers = parts.slice(0, -1).reduce((a, b) => a + b, 0)
  parts[parts.length - 1] = roundMoney(total - sumOthers)
  return parts
}
