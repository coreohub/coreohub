// Taxa de abertura da subconta Asaas (R$ 12,90, única por produtor).
//
// A Asaas debita essa taxa da conta principal (CoreoHub) no momento em que a
// subconta é criada. O Termo do Produtor (cláusula 11.2) diz que ela é do
// produtor e "descontada do primeiro recebimento aprovado". Este módulo decide,
// de forma pura (sem I/O), se um pagamento deve carregar a taxa: quando carrega,
// a parte do produtor no split cai R$ 12,90 e a CoreoHub fica com esse valor.
//
// Regras (decididas com o produtor em 2026-11-14):
//  - cobra uma vez só por produtor (marcador profiles.subconta_fee_charged_at);
//  - só cobra se comissão + taxa >= R$ 20,00; senão fica pra próxima venda;
//  - estorno NÃO reabre o marcador (a abertura já foi paga à Asaas);
//  - a parte do produtor nunca fica negativa.

export const SUBCONTA_FEE = 12.9
export const SUBCONTA_FEE_MIN_TOTAL = 20

const round2 = (n: number): number => parseFloat(n.toFixed(2))

export interface SubcontaFeeInput {
  /** profiles.subconta_fee_charged_at já preenchido? */
  alreadyCharged: boolean
  /** Comissão da CoreoHub nesta cobrança (R$). */
  commission: number
  /** Parte do produtor no split antes da taxa (R$). */
  producerAmount: number
}

export interface SubcontaFeeResult {
  /** Valor a descontar do produtor (0 quando não cobra). */
  fee: number
  /** Parte do produtor depois do desconto. */
  producerAmount: number
}

export function computeSubcontaFee(input: SubcontaFeeInput): SubcontaFeeResult {
  const producerAmount = round2(Number(input.producerAmount))
  const commission = round2(Number(input.commission))
  const none: SubcontaFeeResult = { fee: 0, producerAmount }
  if (input.alreadyCharged) return none
  if (!(producerAmount > 0) || !(commission >= 0)) return none
  if (round2(commission + SUBCONTA_FEE) < SUBCONTA_FEE_MIN_TOTAL) return none
  if (round2(producerAmount - SUBCONTA_FEE) <= 0) return none
  return { fee: SUBCONTA_FEE, producerAmount: round2(producerAmount - SUBCONTA_FEE) }
}

// Reserva a taxa de forma atômica: só UM pagamento consegue marcar o perfil.
// Chamar ANTES de criar a cobrança; se a criação falhar, chamar
// releaseSubcontaFee pra devolver o marcador (a taxa não foi cobrada de fato).
// `supabase` é o client com service role (tipado solto de propósito: este
// arquivo é compartilhado e testado sem o SDK).
export async function claimSubcontaFee(
  supabase: any,
  producerId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ subconta_fee_charged_at: new Date().toISOString() })
    .eq('id', producerId)
    .is('subconta_fee_charged_at', null)
    .select('id')
  if (error) {
    console.error('[subconta-fee] falha ao reservar taxa:', error.message)
    return false
  }
  return Array.isArray(data) && data.length === 1
}

export async function releaseSubcontaFee(
  supabase: any,
  producerId: string,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ subconta_fee_charged_at: null })
    .eq('id', producerId)
  if (error) console.error('[subconta-fee] falha ao devolver marcador:', error.message)
}
