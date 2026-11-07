// Preço por zona do mapa de assentos (Etapa 1). Módulo puro (sem Deno.*),
// testado no Vitest. Importado pelas edge functions e pelo front.
//
// Onde fica cada coisa:
//   events.seat_zones                       [{key, nome, cor}]  (até 8)
//   event_seats.zone_key                    zona do assento (NULL = "geral")
//   ingressos_config[i].precos_por_zona     {zona: preco}       (tipo sem lotes)
//   ingressos_config[i].lotes[j].precos_por_zona                (tipo com lotes)
// Zona sem preço informado cai no preço-base do lote/tipo: evento sem zonas
// se comporta exatamente como antes.

import { alignSeatsToItems, type TicketSeatKind } from './seat-rules.ts'

export const MAX_SEAT_ZONES = 8
export const DEFAULT_ZONE_KEY = 'geral'
const ZONE_KEY_RE = /^[a-z0-9_-]{1,24}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/

export type SeatZone = { key: string; nome: string; cor: string }
export type ZonePrices = Record<string, number>
export type ZoneLote = { data_virada: string | null; preco: number; precos_por_zona?: ZonePrices | null }
export type ZonePricedType = {
  nome?: string
  kind?: string
  preco?: number | null
  lotes?: ZoneLote[] | null
  precos_por_zona?: ZonePrices | null
}

/** Normaliza a chave vinda do banco/cliente: vazia → zona "geral". */
export function normalizeZoneKey(key: unknown): string {
  const k = String(key ?? '').trim().toLowerCase()
  return k === '' ? DEFAULT_ZONE_KEY : k
}

/** Gera a chave de uma zona a partir do nome ("Frente Premium" → "frente-premium"). */
export function zoneKeyFromName(nome: string): string {
  return String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Índice do lote vigente (mesma regra de utils/lotes.ts); -1 se não há lotes. */
export function vigenteLoteIndex(lotes: ZoneLote[] | null | undefined, today: string): number {
  if (!Array.isArray(lotes) || lotes.length === 0) return -1
  const idx = lotes.findIndex(l => !l.data_virada || l.data_virada >= today)
  return idx >= 0 ? idx : lotes.length - 1
}

function cell(map: ZonePrices | null | undefined, zoneKey: string): number | null {
  if (!map || typeof map !== 'object') return null
  const v = map[zoneKey]
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null
}

/** Preço de um lote (ou do tipo sem lotes) numa zona; sem célula, cai no preço-base. */
function priceOf(src: { preco?: number | null; precos_por_zona?: ZonePrices | null }, zoneKey: string): number {
  return cell(src.precos_por_zona, zoneKey) ?? Number(src.preco ?? 0)
}

/** Preço vigente do tipo numa zona (lote vigente em `today`, AAAA-MM-DD). */
export function priceForZone(type: ZonePricedType, zoneKey: unknown, today: string): number {
  const zk = normalizeZoneKey(zoneKey)
  const i = vigenteLoteIndex(type.lotes, today)
  if (i >= 0) return priceOf((type.lotes as ZoneLote[])[i], zk)
  return priceOf(type, zk)
}

/** O tipo tem algum preço por zona configurado (em qualquer lote)? */
export function hasZonePricing(type: ZonePricedType): boolean {
  const filled = (m: ZonePrices | null | undefined) => !!m && Object.keys(m).length > 0
  if (filled(type.precos_por_zona)) return true
  return Array.isArray(type.lotes) && type.lotes.some(l => filled(l.precos_por_zona))
}

export type ZoneGroup = { idx: number; zoneKey: string; quantity: number; precoUnit: number }

/**
 * Agrupa os ingressos por (tipo, zona) já com o preço da zona. `items` está na
 * mesma ordem de `alignedSeatIds` (saída de alignSeatsToItems: assento i vale
 * pro ingresso i, tipo por tipo). Preço NUNCA vem do cliente: só do assento.
 */
export function groupTicketsByZone(
  items: Array<{ idx: number; quantity: number; type: ZonePricedType }>,
  alignedSeatIds: string[],
  zoneBySeat: Map<string, string | null | undefined>,
  today: string,
): ZoneGroup[] {
  const out: ZoneGroup[] = []
  let cursor = 0
  for (const it of items) {
    const byZone = new Map<string, number>()
    for (let n = 0; n < it.quantity; n++) {
      const seatId = alignedSeatIds[cursor++]
      const zk = normalizeZoneKey(seatId != null ? zoneBySeat.get(seatId) : null)
      byZone.set(zk, (byZone.get(zk) ?? 0) + 1)
    }
    for (const [zk, quantity] of byZone) {
      out.push({ idx: it.idx, zoneKey: zk, quantity, precoUnit: priceForZone(it.type, zk, today) })
    }
  }
  return out
}

export function isMeia(t: ZonePricedType): boolean {
  return String(t.kind ?? '').toLowerCase() === 'meia' || (!t.kind && /meia/i.test(String(t.nome ?? '')))
}
export function isInteira(t: ZonePricedType): boolean {
  const k = String(t.kind ?? '').toLowerCase()
  return k === 'inteira' || (!k && !/meia|solid|cortes|pcd|acompanh|obes/i.test(String(t.nome ?? '')))
}

/** Teto legal da meia: 50% do valor cobrado do público geral (arredonda pra cima o centavo). */
export function meiaCeiling(inteira: number): number {
  return Math.ceil(Math.round(inteira * 100) / 2) / 100
}

/** Preço (inteira) do mesmo lote e zona que uma meia; sem lote equivalente usa o último. */
function inteiraPriceAt(inteira: ZonePricedType, loteIdx: number, zoneKey: string): number {
  const lotes = Array.isArray(inteira.lotes) ? inteira.lotes : []
  if (lotes.length === 0) return priceOf(inteira, zoneKey)
  return priceOf(lotes[Math.min(loteIdx, lotes.length - 1)], zoneKey)
}

/** Zonas × lotes sem preço informado (o servidor usa o preço-base; o painel avisa). */
export function missingZonePrices(type: ZonePricedType, zones: SeatZone[]): Array<{ lote: number | null; zoneKey: string }> {
  const out: Array<{ lote: number | null; zoneKey: string }> = []
  const lotes = Array.isArray(type.lotes) ? type.lotes : []
  if (lotes.length > 0) {
    lotes.forEach((l, j) => zones.forEach(z => { if (cell(l.precos_por_zona, z.key) == null) out.push({ lote: j, zoneKey: z.key }) }))
  } else {
    zones.forEach(z => { if (cell(type.precos_por_zona, z.key) == null) out.push({ lote: null, zoneKey: z.key }) })
  }
  return out
}

/**
 * Valida zonas + preços por zona antes de salvar. Devolve a lista de erros
 * (vazia = ok). Regras: até 8 zonas, chave/nome/cor válidos e únicos, preço por
 * zona só em zona existente, preço finito e > 0 (cortesia pode ser 0), e a Meia
 * nunca acima de 50% da Inteira do mesmo lote e zona (Lei 12.933/2013).
 */
export function validateZonePricing(zones: SeatZone[], types: ZonePricedType[]): string[] {
  const errors: string[] = []
  if (!Array.isArray(zones)) return ['Zonas inválidas.']
  if (zones.length > MAX_SEAT_ZONES) errors.push(`No máximo ${MAX_SEAT_ZONES} zonas.`)
  const keys = new Set<string>()
  for (const z of zones) {
    if (!z || !ZONE_KEY_RE.test(String(z.key ?? ''))) { errors.push(`Zona com chave inválida: "${z?.key ?? ''}".`); continue }
    if (keys.has(z.key)) errors.push(`Zona repetida: "${z.key}".`)
    keys.add(z.key)
    const nome = String(z.nome ?? '').trim()
    if (!nome || nome.length > 40) errors.push(`A zona "${z.key}" precisa de um nome de até 40 caracteres.`)
    if (!HEX_RE.test(String(z.cor ?? ''))) errors.push(`A zona "${z.nome ?? z.key}" precisa de uma cor no formato #RRGGBB.`)
  }

  const checkMap = (map: ZonePrices | null | undefined, label: string, allowZero: boolean) => {
    if (!map) return
    for (const [zk, raw] of Object.entries(map)) {
      if (zk !== DEFAULT_ZONE_KEY && !keys.has(zk)) { errors.push(`${label}: zona inexistente "${zk}".`); continue }
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 0 || (v === 0 && !allowZero)) errors.push(`${label}: preço inválido na zona "${zk}".`)
    }
  }
  for (const t of types) {
    const free = String(t.kind ?? '').toLowerCase() === 'cortesia'
    const nome = t.nome ?? 'ingresso'
    checkMap(t.precos_por_zona, nome, free)
    ;(Array.isArray(t.lotes) ? t.lotes : []).forEach((l, j) => checkMap(l.precos_por_zona, `${nome} (lote ${j + 1})`, free))
  }

  const inteira = types.find(isInteira)
  if (inteira) {
    for (const meia of types.filter(isMeia)) {
      const zoneKeys = [DEFAULT_ZONE_KEY, ...zones.map(z => z.key)]
      const lotes = Array.isArray(meia.lotes) ? meia.lotes : []
      const slots = lotes.length > 0 ? lotes.map((l, j) => ({ j, src: l as { preco?: number | null; precos_por_zona?: ZonePrices | null } })) : [{ j: 0, src: meia }]
      for (const { j, src } of slots) {
        for (const zk of zoneKeys) {
          const m = priceOf(src, zk)
          const i = inteiraPriceAt(inteira, j, zk)
          if (m > 0 && i > 0 && round2(m) > meiaCeiling(i)) {
            const nomeZona = zk === DEFAULT_ZONE_KEY ? 'zona geral' : `zona "${zones.find(z => z.key === zk)?.nome ?? zk}"`
            errors.push(`${meia.nome ?? 'Meia'}${lotes.length > 0 ? ` (lote ${j + 1})` : ''}: preço acima de 50% da inteira na ${nomeZona}.`)
          }
        }
      }
    }
  }
  return errors
}

// ── Aplicação no servidor (create-audience-ticket / create-pdv-ticket) ───────

/** O evento cobra por zona? Só com mapa ligado, zonas definidas e algum preço por zona. */
export function zonePricingActive(seatMapEnabled: boolean, zones: unknown, types: ZonePricedType[]): boolean {
  return seatMapEnabled && Array.isArray(zones) && zones.length > 0 && types.some(hasZonePricing)
}

/** Cotação travada por tipo × zona: chave "idx:zona" (a chave "idx" sozinha segue sendo o preço-base). */
export function quoteZonePrices(
  types: Array<ZonePricedType & { nome?: string }>,
  zones: SeatZone[],
  today: string,
): Record<string, { preco: number; lote: string | null }> {
  const out: Record<string, { preco: number; lote: string | null }> = {}
  types.forEach((t, idx) => {
    if (!t?.nome || !hasZonePricing(t)) return
    const i = vigenteLoteIndex(t.lotes, today)
    const lote = i >= 0 ? ((t.lotes as Array<ZoneLote & { nome?: string }>)[i].nome ?? null) : null
    for (const z of zones) {
      const preco = priceForZone(t, z.key, today)
      if (preco > 0) out[`${idx}:${z.key}`] = { preco, lote }
    }
  })
  return out
}

export type SeatInfo = { zone_key?: string | null; seat_tipo?: string | null }

/**
 * Divide cada item do carrinho por zona e dá a cada ingresso o preço da zona do
 * seu assento. Devolve os itens (um por tipo × zona, `quantity` já recontada) e os
 * seatIds NA ORDEM em que a RPC cria os tickets, pro vínculo assento↔ingresso bater.
 *
 * Quem decide qual assento é de qual tipo (Meia ou Inteira muda o preço):
 *   1. `assignments` ([{seat_id, ticket_type_idx}]) quando o cliente manda — conferido
 *      contra as quantidades; qualquer divergência é erro;
 *   2. senão, alinhamento por tipo de assento (PCD → assento especial etc.), igual ao de hoje.
 * O preço NUNCA vem do cliente: só de assento → zona → tipo.
 */
export function applyZonePricing<T extends { idx: number; quantity: number; seatKind: TicketSeatKind; precoUnit: number }>(opts: {
  resolved: T[]
  ingressos: ZonePricedType[]
  seatIds: string[]
  seatInfo: Map<string, SeatInfo>
  assignments?: Array<{ seat_id: string; ticket_type_idx: number }> | null
  today: string
  quotePrices?: Record<string, { preco: number }> | null
}): { resolved: Array<T & { zoneKey: string }>; seatIds: string[] } {
  const { resolved, ingressos, seatIds, seatInfo, assignments, today, quotePrices } = opts
  const total = resolved.reduce((s, r) => s + r.quantity, 0)
  if (seatIds.length !== total) throw new Error(`Selecione exatamente ${total} assento(s)`)

  const seatsByIdx = new Map<number, string[]>()
  if (assignments && assignments.length > 0) {
    if (assignments.length !== seatIds.length) throw new Error('Atribuição de assentos inválida')
    const wanted = new Set(seatIds)
    const seen = new Set<string>()
    for (const a of assignments) {
      if (!a || !wanted.has(a.seat_id) || seen.has(a.seat_id)) throw new Error('Atribuição de assentos inválida')
      seen.add(a.seat_id)
      const list = seatsByIdx.get(a.ticket_type_idx) ?? []
      list.push(a.seat_id)
      seatsByIdx.set(a.ticket_type_idx, list)
    }
    for (const r of resolved) {
      if ((seatsByIdx.get(r.idx)?.length ?? 0) !== r.quantity) throw new Error('Atribuição de assentos inválida')
    }
  } else {
    const tipoById = new Map<string, string>()
    seatIds.forEach(id => tipoById.set(id, String(seatInfo.get(id)?.seat_tipo ?? 'comum')))
    const aligned = alignSeatsToItems(resolved, seatIds, tipoById)
    let cursor = 0
    for (const r of resolved) {
      seatsByIdx.set(r.idx, aligned.slice(cursor, cursor + r.quantity))
      cursor += r.quantity
    }
  }

  const outItems: Array<T & { zoneKey: string }> = []
  const outSeats: string[] = []
  for (const r of resolved) {
    const byZone = new Map<string, string[]>()
    for (const id of seatsByIdx.get(r.idx) ?? []) {
      const zk = normalizeZoneKey(seatInfo.get(id)?.zone_key)
      byZone.set(zk, [...(byZone.get(zk) ?? []), id])
    }
    for (const [zk, ids] of byZone) {
      const quoted = quotePrices?.[`${r.idx}:${zk}`]?.preco
      const preco = quoted != null && quoted > 0 ? quoted : priceForZone(ingressos[r.idx] ?? {}, zk, today)
      if (!(preco > 0)) throw new Error('Preço inválido para a zona escolhida')
      outItems.push({ ...r, quantity: ids.length, precoUnit: preco, zoneKey: zk })
      outSeats.push(...ids)
    }
  }
  return { resolved: outItems, seatIds: outSeats }
}

// ── Checkout: qual ingresso vai em qual assento ──────────────────────────────

/**
 * Atribuição assento → tipo de ingresso usada pelo checkout (e mandada ao servidor
 * como `seat_assignments`). Padrão = alinhamento por tipo de assento, igual ao de
 * sempre (PCD → assento PCD etc.). `prefs` ({seat_id: tipo escolhido}) deixa o
 * comprador trocar entre tipos COMUNS (ex.: qual assento é a Meia), sempre por troca
 * com outro assento, pra a quantidade de cada tipo nunca mudar.
 */
export function resolveSeatAssignments(opts: {
  lines: Array<{ idx: number; qty: number; seatKind: TicketSeatKind }>
  seatIds: string[]
  tipoById: Map<string, string>
  prefs?: Record<string, number>
}): Array<{ seat_id: string; ticket_type_idx: number }> {
  const { lines, seatIds, tipoById, prefs } = opts
  const aligned = alignSeatsToItems(
    lines.map(l => ({ seatKind: l.seatKind, quantity: l.qty })),
    seatIds,
    tipoById,
  )
  const typeOf = new Map<string, number>()
  let cursor = 0
  for (const l of lines) {
    for (let n = 0; n < l.qty && cursor < aligned.length; n++) typeOf.set(aligned[cursor++], l.idx)
  }
  const comum = new Set(lines.filter(l => l.seatKind === 'comum').map(l => l.idx))
  for (const [seat, want] of Object.entries(prefs ?? {})) {
    const cur = typeOf.get(seat)
    if (cur == null || cur === want || !comum.has(cur) || !comum.has(want)) continue
    const other = [...typeOf].find(([id, t]) => id !== seat && t === want && prefs?.[id] !== want)
      ?? [...typeOf].find(([id, t]) => id !== seat && t === want)
    if (!other) continue
    typeOf.set(other[0], cur)
    typeOf.set(seat, want)
  }
  return seatIds.filter(id => typeOf.has(id)).map(id => ({ seat_id: id, ticket_type_idx: typeOf.get(id) as number }))
}

/** Menor e maior preço do tipo entre as zonas (e o preço-base, se há assento sem zona). */
export function priceRangeForType(
  type: ZonePricedType,
  idx: number,
  zones: SeatZone[],
  today: string,
  opts?: { includeBase?: boolean; quotePrices?: Record<string, { preco: number }> | null },
): { min: number; max: number } {
  const prices: number[] = zones.map(z => {
    const q = opts?.quotePrices?.[`${idx}:${z.key}`]?.preco
    return q != null && q > 0 ? q : priceForZone(type, z.key, today)
  })
  if (opts?.includeBase) prices.push(priceForZone(type, DEFAULT_ZONE_KEY, today))
  const valid = prices.filter(p => p > 0)
  return valid.length > 0 ? { min: Math.min(...valid), max: Math.max(...valid) } : { min: 0, max: 0 }
}
