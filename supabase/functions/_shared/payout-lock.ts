// Trava de repasse por produtor (tabela payout_locks + RPCs acquire/release).
//
// O cron diário e o botão "Transferir agora" (ou um clique duplo) podiam sacar
// as mesmas linhas duas vezes. Quem vai sacar pega a trava antes de ler as
// linhas e solta no fim; a trava tem prazo, então uma função que morreu no
// meio não prende o produtor pra sempre.

/** Duração da trava. Maior que o tempo máximo de uma execução da função. */
export const PAYOUT_LOCK_SECONDS = 300

export type PayoutLock =
  | { status: 'ok'; token: string }
  | { status: 'busy' }                       // outra execução está sacando
  | { status: 'error'; error: string }       // RPC falhou (migration ausente, rede): NÃO sacar

/** Tenta pegar a trava. `supabase` = client service role. Distingue "ocupada"
 *  de "falhou", pra uma falha de infraestrutura não parecer repasse em andamento. */
export async function acquirePayoutLock(
  supabase: any,
  producerId: string,
  seconds: number = PAYOUT_LOCK_SECONDS,
): Promise<PayoutLock> {
  const { data, error } = await supabase.rpc('acquire_payout_lock', {
    p_producer_id: producerId,
    p_seconds:     seconds,
  })
  if (error) {
    console.error('[payout-lock] falha ao pegar trava:', error.message)
    return { status: 'error', error: error.message }
  }
  return typeof data === 'string' && data.length > 0 ? { status: 'ok', token: data } : { status: 'busy' }
}

/** Solta a trava só se o token ainda for o dono (se expirou e outro pegou, não
 *  mexe). Best-effort: o prazo cobre uma falha aqui. */
export async function releasePayoutLock(
  supabase: any,
  producerId: string,
  token: string,
): Promise<void> {
  const { error } = await supabase.rpc('release_payout_lock', {
    p_producer_id: producerId,
    p_token:       token,
  })
  if (error) console.error('[payout-lock] falha ao soltar trava:', error.message)
}
