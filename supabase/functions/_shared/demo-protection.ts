// Proteção de eventos demo com movimento financeiro REAL.
//
// Incidente 2026-09-24: um evento de teste marcado is_demo=true recebeu uma
// compra real (Pix na Asaas) e foi apagado pelo cron cleanup-expired-demo-events
// (24h), levando junto ticket, payment e comissão por cascata. O seed do demo
// só cria dado fictício SEM identificador Asaas (payment_id/asaas_payment_id
// nulos) — então qualquer identificador Asaas preenchido é dinheiro real.
//
// Retorna os ids (entre os informados) que NÃO podem ser apagados.
// deno-lint-ignore no-explicit-any
export async function findProtectedDemoEventIds(supa: any, eventIds: string[]): Promise<string[]> {
  if (eventIds.length === 0) return []
  const protectedIds = new Set<string>()
  const checks: Array<PromiseLike<{ data: Array<{ event_id: string }> | null; error: { message: string } | null }>> = [
    supa.from('audience_tickets').select('event_id').in('event_id', eventIds).not('payment_id', 'is', null),
    supa.from('registrations').select('event_id').in('event_id', eventIds).not('payment_id', 'is', null),
    supa.from('registrations').select('event_id').in('event_id', eventIds).not('payment_group_id', 'is', null),
    supa.from('platform_commissions').select('event_id').in('event_id', eventIds).not('asaas_payment_id', 'is', null),
    supa.from('payments').select('event_id').in('event_id', eventIds).not('asaas_payment_id', 'is', null),
  ]
  const results = await Promise.all(checks)
  for (const r of results) {
    // Falha de leitura = na dúvida, protege tudo (nunca apagar por causa de erro).
    if (r.error) return [...eventIds]
    for (const row of r.data ?? []) protectedIds.add(row.event_id)
  }
  return [...protectedIds]
}
