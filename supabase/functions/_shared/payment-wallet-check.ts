// Conferência da carteira do split (auditoria 2026-11-15, pré-requisito do Passo 7).
// Usada quando uma cobrança criada DEPOIS do corte chega ao webhook sem linha em payment_expectations:
// não dá para comparar valor, então confere se o repasse da cobrança vai para o produtor do evento.
//
// Regra conservadora (só reprova desvio claro): reprova se a cobrança tem split para uma carteira
// que NÃO é a do produtor do evento. Split vazio é aceito (cobrança de baixo valor sai sem split).
// Erro de rede/HTTP = inconclusivo (não segura o pagamento por falha de infraestrutura).

// deno-lint-ignore no-explicit-any
type Sb = any

export type WalletVerdict = { ok: boolean | null; reason: string }   // ok null = inconclusivo

/** Carteira esperada para o evento da cobrança. null = não há o que conferir (sandbox/sem evento). */
export async function expectedProducerWallet(supabase: Sb, opts: {
  kind: 'REG' | 'VS' | 'AGG'
  registrationId?: string | null
  paymentGroupId?: string | null
}): Promise<{ wallet: string | null; skip: boolean; reason: string }> {
  try {
    let eventId: string | null = null
    if (opts.kind === 'AGG' && opts.paymentGroupId) {
      const { data } = await supabase.from('payments').select('event_id').eq('id', opts.paymentGroupId).maybeSingle()
      eventId = data?.event_id ?? null
    } else if (opts.registrationId) {
      const { data } = await supabase.from('registrations').select('event_id').eq('id', opts.registrationId).maybeSingle()
      eventId = data?.event_id ?? null
    }
    if (!eventId) return { wallet: null, skip: true, reason: 'sem_evento' }
    const { data: ev } = await supabase.from('events').select('created_by, payment_sandbox').eq('id', eventId).maybeSingle()
    if (!ev) return { wallet: null, skip: true, reason: 'evento_nao_encontrado' }
    if (ev.payment_sandbox === true) return { wallet: null, skip: true, reason: 'sandbox' }
    const { data: prof } = await supabase.from('profiles').select('asaas_wallet_id').eq('id', ev.created_by).maybeSingle()
    return { wallet: prof?.asaas_wallet_id ?? null, skip: false, reason: 'ok' }
  } catch (e) {
    return { wallet: null, skip: true, reason: `erro:${(e as Error)?.message ?? 'exception'}` }
  }
}

export async function checkSplitWallet(opts: {
  baseUrl: string
  apiKey: string
  asaasPaymentId: string
  expectedWallet: string | null
  fetchFn?: typeof fetch
}): Promise<WalletVerdict> {
  const f = opts.fetchFn ?? fetch
  try {
    if (!opts.apiKey || !opts.baseUrl) return { ok: null, reason: 'sem_credencial' }
    const res = await f(`${opts.baseUrl}/payments/${opts.asaasPaymentId}`, {
      headers: { access_token: opts.apiKey, 'Content-Type': 'application/json' },
    })
    if (!res.ok) return { ok: null, reason: `http_${res.status}` }
    const body = await res.json().catch(() => null)
    const split: Array<{ walletId?: string }> = Array.isArray(body?.split) ? body.split : []
    const wallets = split.map(s => String(s?.walletId ?? '')).filter(Boolean)
    if (wallets.length === 0) return { ok: true, reason: 'sem_split' }
    if (!opts.expectedWallet) return { ok: null, reason: 'produtor_sem_carteira' }
    const foreign = wallets.filter(w => w !== opts.expectedWallet)
    return foreign.length > 0 ? { ok: false, reason: 'carteira_diferente_do_produtor' } : { ok: true, reason: 'carteira_ok' }
  } catch (e) {
    return { ok: null, reason: `erro:${(e as Error)?.message ?? 'exception'}` }
  }
}
