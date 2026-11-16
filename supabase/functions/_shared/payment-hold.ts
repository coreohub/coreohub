// Pagamento retido em análise (auditoria 2026-11-15, pré-requisito do Passo 7).
//
// Quando PAYMENT_CHECK_MODE=enforce segura um pagamento divergente, a marca do "em análise" é a
// própria linha de payment_expectations: anomaly = 'enforce:<motivos>'. Sem coluna nem status novo
// (nada muda em registrations/payments). O admin libera gravando anomaly = 'resolved:<motivo>'
// (docs/procedimento-pagamento-retido.md); o gate do webhook então deixa o pagamento passar.
//
// Quem NUNCA pode expirar, lembrar nem cancelar uma cobrança retida: expire-pending-payments e
// send-payment-reminders (a Asaas já recebeu e repartiu o dinheiro).

export const HOLD_PREFIX = 'enforce:'
export const RESOLVED_PREFIX = 'resolved:'

export const isHoldAnomaly = (a: unknown): boolean => String(a ?? '').startsWith(HOLD_PREFIX)
export const isResolvedAnomaly = (a: unknown): boolean => String(a ?? '').startsWith(RESOLVED_PREFIX)

// deno-lint-ignore no-explicit-any
type Sb = any

/**
 * Entre os asaas_payment_id dados, quais estão retidos. `error` preenchido = não deu para saber:
 * o chamador deve NÃO expirar/lembrar nada neste ciclo (falhar para o lado seguro).
 */
export async function loadHeldPaymentIds(supabase: Sb, asaasPaymentIds: Array<string | null | undefined>): Promise<{ held: Set<string>; error: string | null }> {
  const held = new Set<string>()
  const ids = Array.from(new Set(asaasPaymentIds.filter((x): x is string => !!x)))
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase
        .from('payment_expectations')
        .select('asaas_payment_id, anomaly')
        .in('asaas_payment_id', ids.slice(i, i + 100))
        .like('anomaly', `${HOLD_PREFIX}%`)
      if (error) return { held, error: error.message ?? String(error.code ?? 'erro') }
      for (const r of (data ?? [])) held.add(String(r.asaas_payment_id))
    }
    return { held, error: null }
  } catch (e) {
    return { held, error: (e as Error)?.message ?? 'exception' }
  }
}
