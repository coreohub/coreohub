// Decide se uma inscrição é COMPROVADAMENTE gratuita (pra aprovação automática no servidor).
// Conservador de propósito: qualquer dúvida => false, e a inscrição segue o fluxo normal de
// pagamento (create-payment-asaas já aprova sozinha quando o valor final é 0). Espelha a
// derivação de preço de create-payment-asaas (mod_fee > formatos_precos > formacoes_config >
// lotes > faixas progressivas) sem reimplementar cupom/comissão.

// deno-lint-ignore no-explicit-any
export function isProvablyFree(reg: any, event: any, config: any): boolean {
  if (event?.event_type === 'government') return true
  if (Number(reg?.mod_fee ?? 0) > 0) return false

  // deno-lint-ignore no-explicit-any
  const formatos: any[] = config?.formatos_precos ?? []
  // deno-lint-ignore no-explicit-any
  const formacoes: any[] = event?.formacoes_config ?? []
  const nome: string = reg?.formato_participacao ?? reg?.tipo_apresentacao ?? ''
  const formatoConfig = nome ? formatos.find((f) => f.nome?.toLowerCase() === nome.toLowerCase()) : undefined
  const formatoEvento = nome ? formacoes.find((m) => m.name?.toLowerCase() === nome.toLowerCase()) : undefined
  const primeira = formacoes.find((m) => m.is_active !== false)
  const escolhida = formatoEvento ?? primeira
  if (!escolhida) return false // sem formação resolvida: nunca presumir gratuito

  const preco = Number(
    formatoConfig?.preco ?? formatoEvento?.fee ?? formatoEvento?.base_fee ?? primeira?.fee ?? primeira?.base_fee ?? 0,
  )
  if (preco > 0) return false

  // deno-lint-ignore no-explicit-any
  const lotes: any[] = Array.isArray(escolhida.lotes) ? escolhida.lotes : []
  if (lotes.some((l) => Number(l?.preco ?? 0) > 0)) return false

  if (escolhida.pricing_type === 'PROGRESSIVE_PER_DANCER') {
    // deno-lint-ignore no-explicit-any
    const tiers: any[] = Array.isArray(escolhida.progressive_tiers) ? escolhida.progressive_tiers : []
    if (tiers.some((t) => Number(t?.valor ?? 0) > 0)) return false
  }
  return true
}
