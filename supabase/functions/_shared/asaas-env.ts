// Escolha do ambiente Asaas (produção x sandbox) — ÚNICO ponto de decisão.
//
// Regras (Fase 2 do plano de teste de ingressos, 2026-09-24):
//   - Produção é o padrão. Sandbox só com DUAS condições juntas: o evento tem
//     payment_sandbox=true E o produtor dono é conta de teste (is_test_account).
//     Flag ligada num produtor real => ERRO (nunca roteia cliente real ao sandbox).
//   - Falha fechada: secret ausente => erro. Nunca cai em silêncio para outro
//     ambiente (as functions antigas tinham `?? 'https://sandbox.asaas.com/...'`,
//     que apontava para o sandbox se ASAAS_BASE_URL sumisse).
//   - Produção com URL contendo "sandbox" => erro (secret trocado por engano).
//   - O ambiente é sempre logado (logAsaasEnv) para auditoria.
//
// Módulo puro (sem Deno.*): recebe um leitor de env, para ser testado no Vitest.

export type AsaasEnvName = 'production' | 'sandbox'

export interface AsaasEnv {
  name: AsaasEnvName
  isSandbox: boolean
  baseUrl: string
  apiKey: string
}

export interface EnvReader {
  get(name: string): string | undefined
}

/** URL do sandbox: fixa no código de propósito (nunca vem de secret). */
export const SANDBOX_BASE_URL = 'https://api-sandbox.asaas.com/v3'

export interface AsaasEnvInput {
  /** events.payment_sandbox */
  paymentSandbox?: boolean | null
  /** profiles.is_test_account do produtor dono do evento */
  producerIsTestAccount?: boolean | null
}

const need = (reader: EnvReader, name: string): string => {
  const v = (reader.get(name) ?? '').trim()
  if (!v) throw new Error(`[asaas-env] secret ${name} ausente — recusando (falha fechada)`)
  return v
}

export function resolveAsaasEnv(input: AsaasEnvInput, reader: EnvReader): AsaasEnv {
  if (input.paymentSandbox === true) {
    if (input.producerIsTestAccount !== true) {
      throw new Error('[asaas-env] evento em modo sandbox, mas o produtor não é conta de teste — recusando')
    }
    return {
      name: 'sandbox',
      isSandbox: true,
      baseUrl: SANDBOX_BASE_URL,
      apiKey: need(reader, 'ASAAS_SANDBOX_API_KEY'),
    }
  }

  const baseUrl = need(reader, 'ASAAS_BASE_URL').replace(/\/+$/, '')
  if (/sandbox/i.test(baseUrl)) {
    throw new Error('[asaas-env] ASAAS_BASE_URL de produção aponta para sandbox — recusando')
  }
  return {
    name: 'production',
    isSandbox: false,
    baseUrl,
    apiKey: need(reader, 'ASAAS_API_KEY'),
  }
}

/**
 * Webhook: descobre o ambiente pelo token recebido. null = token não reconhecido
 * (a function deve responder 401). Compara em tempo constante.
 */
export function resolveWebhookEnvName(token: string | null | undefined, reader: EnvReader): AsaasEnvName | null {
  const t = (token ?? '').trim()
  if (!t) return null
  const prod = (reader.get('ASAAS_WEBHOOK_TOKEN') ?? '').trim()
  const sand = (reader.get('ASAAS_SANDBOX_WEBHOOK_TOKEN') ?? '').trim()
  if (prod && safeEqual(t, prod)) return 'production'
  if (sand && safeEqual(t, sand)) return 'sandbox'
  return null
}

/**
 * Pagamento sandbox só pode tocar evento sandbox, e o inverso.
 * Retorna true se o ambiente do webhook bate com o evento.
 */
export function webhookMatchesEvent(envName: AsaasEnvName, eventPaymentSandbox: boolean | null | undefined): boolean {
  return (envName === 'sandbox') === (eventPaymentSandbox === true)
}

export function logAsaasEnv(fn: string, env: AsaasEnv, eventId?: string | null): void {
  console.log(`[asaas-env] fn=${fn} env=${env.name} event=${eventId ?? '-'}`)
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
