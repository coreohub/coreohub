// Customer Asaas encontrado por CPF (fluxo "search-then-create" em toda edge
// function de pagamento) pode ter sido criado antes do fix de 2026-05-18 (ou
// fora do fluxo do app) — sem essa checagem ele gera Taxa de Mensageria
// (SMS/email, R$0,99/transação) pra sempre, mesmo com customers novos já
// nascendo com notificationDisabled:true. Best-effort: nunca bloqueia o
// pagamento se a chamada falhar.
//
// `currentBuyer` (opcional): mesmo CPF pode ter sido usado antes por outra
// pessoa (familiar, CPF de teste que ficou na base) — sem isso a fatura Asaas
// mostra pra sempre o nome/e-mail de quem comprou a PRIMEIRA vez com aquele
// CPF, confundindo o comprador atual. Sincroniza só os campos que vieram e
// que mudaram, no mesmo POST (Asaas não tem PATCH parcial de verdade).
export async function ensureNotificationDisabled(
  asaasBaseUrl: string,
  asaasHeaders: Record<string, string>,
  customer: { id?: string; notificationDisabled?: boolean; name?: string; email?: string; mobilePhone?: string } | undefined,
  currentBuyer?: { name?: string; email?: string; phone?: string },
): Promise<void> {
  if (!customer?.id) return

  const body: Record<string, unknown> = {}
  if (customer.notificationDisabled !== true) body.notificationDisabled = true
  if (currentBuyer?.name && currentBuyer.name !== customer.name) body.name = currentBuyer.name
  if (currentBuyer?.email && currentBuyer.email !== customer.email) body.email = currentBuyer.email
  const phoneDigits = currentBuyer?.phone?.replace(/\D/g, '')
  if (phoneDigits && phoneDigits !== customer.mobilePhone) body.mobilePhone = phoneDigits

  if (Object.keys(body).length === 0) return
  try {
    await fetch(`${asaasBaseUrl}/customers/${customer.id}`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.warn(`[asaas-customer] falha ao sincronizar customer=${customer.id}:`, (e as Error).message)
  }
}
