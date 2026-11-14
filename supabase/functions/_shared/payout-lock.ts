// Trava de repasse por produtor (tabela payout_locks + RPCs acquire/release).
//
// O cron diário e o botão "Transferir agora" (ou um clique duplo) podiam sacar
// as mesmas linhas duas vezes. Quem vai sacar pega a trava antes de ler as
// linhas e solta no fim; a trava tem prazo, então uma função que morreu no
// meio não prende o produtor pra sempre.

/** Duração da trava. Maior que o tempo máximo de uma execução da função. */
export const PAYOUT_LOCK_SECONDS = 180

/** Tenta pegar a trava. Devolve o token (uuid) ou null se já está em uso
 *  (ou se a RPC falhou: na dúvida, NÃO saca). `supabase` = client service role. */
export async function acquirePayoutLock(
  supabase: any,
  producerId: string,
  seconds: number = PAYOUT_LOCK_SECONDS,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('acquire_payout_lock', {
    p_producer_id: producerId,
    p_seconds:     seconds,
  })
  if (error) {
    console.error('[payout-lock] falha ao pegar trava:', error.message)
    return null
  }
  return typeof data === 'string' && data.length > 0 ? data : null
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
