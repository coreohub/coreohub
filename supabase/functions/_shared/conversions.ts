/**
 * Conversions API server-side — Meta + GA4 Measurement Protocol.
 *
 * Compensa a perda de ~30% client-side por iOS ITP, adblockers e privacy
 * mode. Disparado pelo webhook Asaas quando pagamento vira APROVADO, com
 * deduplicação via event_id único (mesmo registration_id que o client-side
 * usa em transaction_id — Meta dedupa por event_id no servidor).
 *
 * Por destino:
 * - Master CoreoHub: usa secrets globais (META_CAPI_ACCESS_TOKEN +
 *   GA4_API_SECRET) configurados no Supabase, pixel/measurement IDs
 *   hardcoded em CoreoHub.
 * - Produtor: usa tokens em event_marketing_secrets (table com RLS)
 *   + IDs em events.producer_ga4_id/producer_meta_pixel_id.
 *
 * Cada destino é independente — se um falha, os outros seguem. Erros
 * são logados mas não viram exception (CAPI é best-effort, perda de
 * tracking nunca pode quebrar o webhook de pagamento).
 */

const META_GRAPH_API_VERSION = 'v18.0'
const GA4_MP_ENDPOINT        = 'https://www.google-analytics.com/mp/collect'

/** Hash SHA-256 hex lowercase — formato exigido por Meta CAPI pra PII. */
async function sha256Hex(input: string): Promise<string> {
  const data   = new TextEncoder().encode(input.trim().toLowerCase())
  const buffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Remove formatação do CPF/telefone antes de hashear. */
function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

export interface CapiPurchaseInput {
  /** ID único da transação. Usado como event_id pra dedup com client-side. */
  transactionId: string
  /** Slug do festival (ou UUID se slug vazio). */
  eventSlug: string
  /** Nome do festival. */
  eventName: string
  /** Valor pago em BRL. */
  value: number
  /** Email do inscrito (hash SHA-256 antes de enviar). */
  email?: string | null
  /** CPF do inscrito (só dígitos, hash SHA-256 antes de enviar). */
  cpf?: string | null
  /** IP do cliente quando disponível (passa direto, sem hash). */
  clientIp?: string | null
  /** User agent do navegador do cliente. */
  clientUserAgent?: string | null
  /** Cookie _fbp do navegador (se foi capturado client-side antes). */
  fbp?: string | null
  /** Cookie _fbc do navegador. */
  fbc?: string | null
}

export interface MetaCapiTarget {
  pixelId:     string
  accessToken: string
}

export interface Ga4MpTarget {
  measurementId: string
  apiSecret:     string
  /** Client ID — gerado pelo gtag client-side; sem isso o Real-time
   *  do GA4 não atribui sessão. Quando não temos, usa o transactionId. */
  clientId?:     string
}

/**
 * Dispara `Purchase` no Meta CAPI pra UM destino.
 * Retorna `{ok, error, httpStatus}` — nunca lança. `httpStatus` permite
 * o webhook diferenciar 401/403 (token inválido) de 5xx (rede/Meta down)
 * pra marcar o status correto em event_marketing_secrets.
 */
export async function metaCapiPurchase(
  target: MetaCapiTarget,
  input:  CapiPurchaseInput,
): Promise<{ ok: boolean; error?: string; httpStatus?: number }> {
  try {
    const userData: Record<string, unknown> = {}
    if (input.email)           userData.em = [await sha256Hex(input.email)]
    if (input.cpf)             userData.external_id = [await sha256Hex(digitsOnly(input.cpf))]
    if (input.clientIp)        userData.client_ip_address = input.clientIp
    if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent
    if (input.fbp)             userData.fbp = input.fbp
    if (input.fbc)             userData.fbc = input.fbc

    const body = {
      data: [{
        event_name:        'Purchase',
        event_time:        Math.floor(Date.now() / 1000),
        event_id:          input.transactionId,
        action_source:     'website',
        event_source_url:  `https://app.coreohub.com/pagamento-sucesso?registration_id=${input.transactionId}`,
        user_data:         userData,
        custom_data: {
          currency:      'BRL',
          value:         Number(input.value.toFixed(2)),
          content_ids:   [input.eventSlug],
          content_name:  input.eventName,
          content_type:  'product',
        },
      }],
    }

    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${target.pixelId}/events?access_token=${encodeURIComponent(target.accessToken)}`
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      return { ok: false, httpStatus: resp.status, error: `Meta CAPI ${resp.status}: ${txt.slice(0, 200)}` }
    }
    return { ok: true, httpStatus: resp.status }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Dispara `purchase` no GA4 via Measurement Protocol pra UM destino.
 * Retorna `{ok, error, httpStatus}` — nunca lança.
 *
 * MP não retorna 200 OK quando há erro de payload (sempre 204 em prod).
 * Pra debug, usar https://www.google-analytics.com/debug/mp/collect com
 * o mesmo body — endpoint debug retorna validationMessages.
 */
export async function ga4MpPurchase(
  target: Ga4MpTarget,
  input:  CapiPurchaseInput,
): Promise<{ ok: boolean; error?: string; httpStatus?: number }> {
  try {
    const body = {
      client_id: target.clientId ?? input.transactionId,
      events: [{
        name: 'purchase',
        params: {
          transaction_id: input.transactionId,
          currency:       'BRL',
          value:          Number(input.value.toFixed(2)),
          items: [{
            item_id:   input.eventSlug,
            item_name: input.eventName,
            quantity:  1,
            price:     Number(input.value.toFixed(2)),
          }],
        },
      }],
    }

    const url  = `${GA4_MP_ENDPOINT}?measurement_id=${encodeURIComponent(target.measurementId)}&api_secret=${encodeURIComponent(target.apiSecret)}`
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })

    // GA4 MP retorna 204 No Content em sucesso; 200+ = aceito.
    if (!resp.ok && resp.status !== 204) {
      const txt = await resp.text().catch(() => '')
      return { ok: false, httpStatus: resp.status, error: `GA4 MP ${resp.status}: ${txt.slice(0, 200)}` }
    }
    return { ok: true, httpStatus: resp.status }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export interface DispatchResult {
  label:      string
  kind:       'meta' | 'ga4'
  targetId:   string
  ok:         boolean
  httpStatus?: number
  error?:     string
  /** True quando httpStatus é 401/403 (token inválido) — webhook usa pra atualizar status. */
  invalidAuth: boolean
}

/**
 * Dispara CAPI pra MÚLTIPLOS destinos em paralelo (master + produtor).
 * Retorna resultado por destino pra caller decidir o que fazer (atualizar
 * status no DB, notificar admin, etc). Loga internamente também — não lança.
 */
export async function dispatchPurchaseConversions(opts: {
  input:       CapiPurchaseInput
  metaTargets: MetaCapiTarget[]
  ga4Targets:  Ga4MpTarget[]
}): Promise<DispatchResult[]> {
  const jobs: Array<Promise<DispatchResult>> = []

  for (const t of opts.metaTargets) {
    jobs.push(metaCapiPurchase(t, opts.input).then(r => ({
      kind:        'meta' as const,
      label:       `meta:${t.pixelId}`,
      targetId:    t.pixelId,
      ok:          r.ok,
      httpStatus:  r.httpStatus,
      error:       r.error,
      invalidAuth: r.httpStatus === 401 || r.httpStatus === 403,
    })))
  }
  for (const t of opts.ga4Targets) {
    jobs.push(ga4MpPurchase(t, opts.input).then(r => ({
      kind:        'ga4' as const,
      label:       `ga4:${t.measurementId}`,
      targetId:    t.measurementId,
      ok:          r.ok,
      httpStatus:  r.httpStatus,
      error:       r.error,
      // GA4 MP retorna 401 quando api_secret é inválido. 400 também sinaliza payload ruim,
      // mas aqui tratamos como erro genérico (não invalida o secret).
      invalidAuth: r.httpStatus === 401 || r.httpStatus === 403,
    })))
  }

  const results = await Promise.all(jobs)
  for (const r of results) {
    if (r.ok) console.log(`[capi] ${r.label}: ok`)
    else      console.error(`[capi] ${r.label}: ${r.error}`)
  }
  return results
}
