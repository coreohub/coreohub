// Carrega o ambiente Asaas (produção x sandbox) para uma function, a partir do
// evento ou do produtor. Regras e motivos: ver _shared/asaas-env.ts.
//
// Produção continua sendo o caminho padrão e NÃO faz nenhuma consulta extra:
// o perfil só é lido quando o evento está em modo sandbox (payment_sandbox=true).
import { resolveAsaasEnv, logAsaasEnv, type AsaasEnv } from './asaas-env.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

/** Ambiente para operações ligadas a um evento (cobrança, estorno, cancelamento). */
export async function loadAsaasEnvForEvent(
  supabase: Supa,
  event: { id?: string | null; created_by?: string | null; payment_sandbox?: boolean | null },
  fn: string,
): Promise<AsaasEnv> {
  let producerIsTestAccount: boolean | null = null
  if (event.payment_sandbox === true && event.created_by) {
    const { data } = await supabase.from('profiles').select('is_test_account').eq('id', event.created_by).maybeSingle()
    producerIsTestAccount = data?.is_test_account ?? null
  }
  const env = resolveAsaasEnv({ paymentSandbox: event.payment_sandbox ?? false, producerIsTestAccount }, Deno.env)
  logAsaasEnv(fn, env, event.id ?? null)
  return env
}

/**
 * Ambiente para operações do produtor sem evento (subconta, saldo).
 * Conta de teste (profiles.is_test_account) => sandbox; qualquer outra => produção.
 */
export async function loadAsaasEnvForProducer(supabase: Supa, producerId: string, fn: string): Promise<AsaasEnv> {
  const { data } = await supabase.from('profiles').select('is_test_account').eq('id', producerId).maybeSingle()
  const isTest = data?.is_test_account === true
  const env = resolveAsaasEnv({ paymentSandbox: isTest, producerIsTestAccount: isTest }, Deno.env)
  logAsaasEnv(fn, env, null)
  return env
}
