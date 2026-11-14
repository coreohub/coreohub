// Plano de repasse (Fase 1 do plano-taxa-subconta-repasse).
//
// Problema que isto resolve: antes, o repasse pedia o saque do TOTAL devido e
// só depois marcava como "liberadas" as linhas inteiras que o valor sacado
// cobria. Quando o saque saía limitado pelo saldo, sobrava valor pago sem
// linha marcada, e a linha era paga de novo no ciclo seguinte (tirando do
// dinheiro retido para estornos).
//
// Agora a escolha das linhas vem ANTES do saque: escolhe-se o que cabe no saldo
// e saca-se exatamente a soma das linhas escolhidas. Função pura, sem I/O.
// Trabalha em centavos inteiros pra não depender de ponto flutuante.

export interface PayoutItem {
  id:  string
  /** Líquido da linha em reais (já descontado refund parcial). */
  net: number
}

export interface PayoutPlan {
  /** Ids das linhas cobertas, na ordem recebida (as mais antigas primeiro). */
  coveredIds: string[]
  /** Soma exata das linhas cobertas, em reais: é o que deve ser sacado. */
  base: number
  /** Total devido de todas as linhas recebidas, em reais. */
  due: number
  /** min(devido, saldo), em reais: o teto que coube no saldo. */
  available: number
  /** Linhas que ficaram de fora (não couberam inteiras no saldo). */
  leftoverIds: string[]
}

export const toCents = (reais: number): number => Math.round(Number(reais) * 100)
export const fromCents = (cents: number): number => cents / 100

/**
 * Escolhe as linhas que o saldo comporta, em ordem, sem fracionar nenhuma:
 * para na primeira que não cabe (mantém a ordem de antiguidade, não pula pra
 * uma linha menor mais nova).
 *
 * Exemplo: A=60 e B=40, saldo 150 -> cobre A e B, base 100 (saca 100, não 150).
 *          A=60 e B=40, saldo 70  -> cobre só A, base 60 (B fica pro próximo).
 */
export function planPayout(input: { items: PayoutItem[]; balance: number }): PayoutPlan {
  const balanceCents = Math.max(0, toCents(input.balance))
  const items = input.items
    .map((it) => ({ id: it.id, cents: toCents(it.net) }))
    .filter((it) => it.cents > 0)

  const dueCents = items.reduce((s, it) => s + it.cents, 0)
  const availableCents = Math.min(dueCents, balanceCents)

  const coveredIds: string[] = []
  const leftoverIds: string[] = []
  let left = availableCents
  let baseCents = 0
  let stopped = false
  for (const it of items) {
    if (!stopped && it.cents <= left) {
      coveredIds.push(it.id)
      left -= it.cents
      baseCents += it.cents
    } else {
      stopped = true
      leftoverIds.push(it.id)
    }
  }

  return {
    coveredIds,
    base:        fromCents(baseCents),
    due:         fromCents(dueCents),
    available:   fromCents(availableCents),
    leftoverIds,
  }
}
