// Data prevista de crédito de cobrança no cartão quando o payload do Asaas não
// traz creditDate / estimatedCreditDate.
//
// Regra observada no painel do Asaas (2026-10-02): "Saque disponível em" =
// data de confirmação + 32 dias corridos, e se cair em fim de semana passa pro
// próximo dia útil (confirmada 15/09 -> 17/10 era sábado -> 19/10). Feriados
// não entram (o Asaas usa o calendário bancário); o campo creditDate /
// estimatedCreditDate do payload, quando existe, sempre vence este cálculo.

export const CARD_FALLBACK_CREDIT_DAYS = 32

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Retorna o instante (ISO, 12:00 de Brasília = 15:00Z) do crédito previsto. */
export function cardCreditFallback(paidAtMs: number): string {
  // trabalha com o calendário de Brasília: um pagamento às 22h BRT já é "dia seguinte" em UTC
  let brt = new Date(paidAtMs - BRT_OFFSET_MS + CARD_FALLBACK_CREDIT_DAYS * DAY_MS)
  while (brt.getUTCDay() === 0 || brt.getUTCDay() === 6) {
    brt = new Date(brt.getTime() + DAY_MS)
  }
  const y = brt.getUTCFullYear()
  const m = String(brt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(brt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}T15:00:00.000Z`
}
