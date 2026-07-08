// Customer Asaas encontrado por CPF (fluxo "search-then-create" em toda edge
// function de pagamento) pode ter sido criado antes do fix de 2026-05-18 (ou
// fora do fluxo do app) — sem essa checagem ele gera Taxa de Mensageria
// (SMS/email, R$0,99/transação) pra sempre, mesmo com customers novos já
// nascendo com notificationDisabled:true. Best-effort: nunca bloqueia o
// pagamento se a chamada falhar.
export async function ensureNotificationDisabled(
  asaasBaseUrl: string,
  asaasHeaders: Record<string, string>,
  customer: { id?: string; notificationDisabled?: boolean } | undefined,
): Promise<void> {
  if (!customer?.id || customer.notificationDisabled === true) return
  try {
    await fetch(`${asaasBaseUrl}/customers/${customer.id}`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({ notificationDisabled: true }),
    })
  } catch (e) {
    console.warn(`[asaas-customer] falha ao desligar notificação customer=${customer.id}:`, (e as Error).message)
  }
}
