// Falha de processamento do webhook da Asaas (auditoria rodada 2, itens 8: B#4 e B#5).
//
// Antes: erro ao gravar a comissão (ou erro inesperado) só era logado e a resposta era 200, então a
// Asaas nunca reenviava e a comissão se perdia sem alerta.
//
// Agora: o webhook conta as falhas do MESMO evento (record_webhook_failure, atômico).
//   tentativas 1..MAX_WEBHOOK_RETRIES  -> responde 500 e a Asaas reenvia
//   tentativa MAX+1 em diante          -> responde 200 (segue o fluxo antigo) e o admin é avisado
//
// Por que o teto: a Asaas PAUSA a fila de webhook depois de 15 falhas consecutivas e só a resposta 200
// conta como sucesso (docs.asaas.com/docs/fila-pausada). Como cada evento esgota em 3 falhas e responde
// 200 na seguinte, a sequência de falhas consecutivas nunca passa de MAX. Se nem a contagem puder ser
// gravada (banco fora do ar), NÃO se pede reenvio: falha para o lado seguro (200 + alerta no log).

export const MAX_WEBHOOK_RETRIES = 3

// deno-lint-ignore no-explicit-any
type Sb = any

export interface WebhookRetryDecision {
  attempts: number | null
  /** true = responder 500 para a Asaas reenviar. */
  retry: boolean
  /** true = passou do limite (ou não deu para contar): responder 200 e alertar o admin. */
  exhausted: boolean
}

/** Pura: decide a resposta a partir do total de tentativas. attempts nulo = contagem indisponível. */
export function decideWebhookRetry(attempts: number | null, max: number = MAX_WEBHOOK_RETRIES): WebhookRetryDecision {
  if (attempts == null || !Number.isFinite(attempts)) return { attempts: null, retry: false, exhausted: true }
  return { attempts, retry: attempts <= max, exhausted: attempts > max }
}

/** Erro de chave duplicada (23505): a linha já existe, logo NÃO é falha, é reentrega já processada. */
export function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null | undefined
  if (!e) return false
  return e.code === '23505' || /duplicate key/i.test(String(e.message ?? ''))
}

/** Conta a falha e devolve a decisão. Nunca lança. */
export async function recordWebhookFailure(
  supabase: Sb,
  opts: { key: string; kind: string; paymentId: string | null; error: string },
): Promise<WebhookRetryDecision> {
  try {
    const { data, error } = await supabase.rpc('record_webhook_failure', {
      p_key: opts.key,
      p_kind: opts.kind,
      p_payment: opts.paymentId,
      p_error: opts.error,
      p_max: MAX_WEBHOOK_RETRIES,
    })
    if (error) {
      console.error('[webhook-failure] não consegui contar a falha:', error.message)
      return decideWebhookRetry(null)
    }
    return decideWebhookRetry(typeof data === 'number' ? data : Number(data))
  } catch (e) {
    console.error('[webhook-failure] exceção ao contar a falha:', (e as Error)?.message)
    return decideWebhookRetry(null)
  }
}

/** Marca a falha como resolvida quando um reenvio finalmente grava a comissão. Best-effort, nunca lança. */
export async function resolveWebhookFailure(supabase: Sb, key: string): Promise<void> {
  try {
    await supabase
      .from('webhook_failures')
      .update({ resolved_at: new Date().toISOString() })
      .eq('failure_key', key)
      .is('resolved_at', null)
  } catch (e) {
    console.warn('[webhook-failure] não consegui marcar como resolvida:', (e as Error)?.message)
  }
}

export const commissionFailureKey = (asaasPaymentId: string | number) => `commission:${asaasPaymentId}`
export const unexpectedFailureKey = (asaasPaymentId: string | number, event: string) => `unexpected:${asaasPaymentId}:${event}`
