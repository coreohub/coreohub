// Bloqueio de venda enquanto a taxa fixa do plano (Essencial/Escala) está
// pendente. A regra mora no banco (RPC plan_fee_sales_blocked, migration
// 20260925b) — aqui só a chamada, igual em todas as functions de cobrança.
//
// Falha ABERTA de propósito: se a consulta der erro, a venda segue. Um problema
// nosso nunca pode barrar um pagamento de inscrito/comprador; o bloqueio é uma
// proteção comercial, não de segurança.

// deno-lint-ignore no-explicit-any
type Supa = any

/** Mensagem pro COMPRADOR — não menciona taxa nem plano (é assunto do produtor). */
export const SALES_NOT_OPEN_MESSAGE =
  'As vendas deste evento ainda não foram abertas pelo organizador. Tente novamente em breve.'

export async function planFeeSalesBlocked(supabase: Supa, eventId: string | null | undefined): Promise<boolean> {
  if (!eventId) return false
  try {
    const { data, error } = await supabase.rpc('plan_fee_sales_blocked', { p_event_id: eventId })
    if (error) {
      console.error('[plan-fee-gate] falha ao consultar bloqueio (liberando a venda):', error.message)
      return false
    }
    if (data === true) console.warn(`[plan-fee-gate] venda bloqueada — taxa do plano pendente (event=${eventId})`)
    return data === true
  } catch (e) {
    console.error('[plan-fee-gate] exceção ao consultar bloqueio (liberando a venda):', (e as Error).message)
    return false
  }
}
