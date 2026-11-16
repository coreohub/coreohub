import { describe, it, expect } from 'vitest'
import { parseSwapBody, sanitizeSwapReason, seatLabel, mapSwapError, SWAP_REASON_MAX } from '../supabase/functions/_shared/seat-swap'

const EV = '41d933c9-76e2-41fe-93bd-cebbee3fa25d'
const TK = '4f2a0a4a-939e-4ca5-a600-bd39f6645565'

describe('parseSwapBody', () => {
  it('aceita corpo valido e assume padroes (liberar antigo e avisar)', () => {
    const r = parseSwapBody({ event_id: EV, ticket_id: TK, new_seat_id: 'I-12' })
    expect(r).toEqual({
      ok: true,
      value: { eventId: EV, ticketId: TK, newSeatId: 'I-12', releaseOld: true, notifyBuyer: true, reason: null },
    })
  })

  it('respeita as opcoes desligadas explicitamente', () => {
    const r = parseSwapBody({ event_id: EV, ticket_id: TK, new_seat_id: 'A-1', release_old: false, notify_buyer: false, reason: ' cliente pediu ' })
    expect(r.ok && r.value.releaseOld).toBe(false)
    expect(r.ok && r.value.notifyBuyer).toBe(false)
    expect(r.ok && r.value.reason).toBe('cliente pediu')
  })

  it('opcao com tipo errado nao liga por acidente (string "false" vira false)', () => {
    const r = parseSwapBody({ event_id: EV, ticket_id: TK, new_seat_id: 'A-1', release_old: 'false' })
    expect(r.ok && r.value.releaseOld).toBe(false)
  })

  it('recusa ids invalidos', () => {
    expect(parseSwapBody({ event_id: 'x', ticket_id: TK, new_seat_id: 'A-1' }).ok).toBe(false)
    expect(parseSwapBody({ event_id: EV, ticket_id: 'x', new_seat_id: 'A-1' }).ok).toBe(false)
    expect(parseSwapBody({ event_id: EV, ticket_id: TK, new_seat_id: 'A1' }).ok).toBe(false)
    expect(parseSwapBody({ event_id: EV, ticket_id: TK, new_seat_id: "A-1'; drop" }).ok).toBe(false)
    expect(parseSwapBody(null).ok).toBe(false)
  })
})

describe('sanitizeSwapReason', () => {
  it('apara, normaliza espacos e limita o tamanho', () => {
    expect(sanitizeSwapReason('  a   b \n c ')).toBe('a b c')
    expect(sanitizeSwapReason('x'.repeat(500))?.length).toBe(SWAP_REASON_MAX)
    expect(sanitizeSwapReason('   ')).toBeNull()
    expect(sanitizeSwapReason(42)).toBeNull()
  })
})

describe('seatLabel', () => {
  it('formata fileira e numero', () => {
    expect(seatLabel('I-11')).toBe('Fileira I · Nº 11')
    expect(seatLabel('AA-3')).toBe('Fileira AA · Nº 3')
    expect(seatLabel(null)).toBe('')
  })
})

describe('mapSwapError', () => {
  it('permissao negada vira 403', () => {
    expect(mapSwapError({ code: '42501', message: 'Sem permissão' }).status).toBe(403)
  })
  it('regra de negocio da RPC vira 409 com a mensagem original', () => {
    const r = mapSwapError({ code: 'P0001', message: 'O lugar H-1 acabou de ser vendido. Escolha outro lugar.' })
    expect(r).toEqual({ status: 409, message: 'O lugar H-1 acabou de ser vendido. Escolha outro lugar.' })
  })
  it('erro de infraestrutura vira 500 sem vazar detalhe', () => {
    const r = mapSwapError({ code: '57014', message: 'canceling statement due to statement timeout' })
    expect(r.status).toBe(500)
    expect(r.message).not.toMatch(/timeout/i)
  })
})

import { groupSplitWarning, swapLockedSeats, swapBlockedReason } from '../utils/seatSwap'

describe('groupSplitWarning', () => {
  it('sem outros ingressos no pedido nao avisa', () => {
    expect(groupSplitWarning([], 'H-5')).toBeNull()
  })
  it('lugar ao lado de outro do pedido nao avisa', () => {
    expect(groupSplitWarning(['I-10'], 'I-11')).toBeNull()
    expect(groupSplitWarning(['I-10'], 'I-9')).toBeNull()
  })
  it('mesma fileira mas longe avisa', () => {
    expect(groupSplitWarning(['I-10'], 'I-14')).toMatch(/não ao lado/)
  })
  it('outra fileira avisa', () => {
    expect(groupSplitWarning(['I-10'], 'H-10')).toMatch(/outra fileira/)
  })
})

describe('swapLockedSeats', () => {
  const st = (status: string) => ({ seat_id: 'x', status, is_pcd: false }) as any
  it('trava livres de outra zona e deixa livres da mesma zona', () => {
    const locked = swapLockedSeats({ 'A-1': st('livre'), 'A-2': st('livre'), 'A-3': st('vendido') }, { 'A-1': 'plat', 'A-2': 'vip' }, 'plat')
    expect(Object.keys(locked)).toEqual(['A-2'])
  })
  it('evento sem zonas: nada e travado', () => {
    expect(swapLockedSeats({ 'A-1': st('livre') }, {}, null)).toEqual({})
  })
  it('sem zona (null) nao mistura com lugar que tem zona', () => {
    expect(Object.keys(swapLockedSeats({ 'A-1': st('livre') }, { 'A-1': 'vip' }, null))).toEqual(['A-1'])
  })
})

describe('swapBlockedReason', () => {
  const ok = { status_pagamento: 'APROVADO', refunded_at: null, check_in_status: 'PENDENTE', seat_id: 'I-11', seatTipo: 'comum' }
  it('ingresso valido pode trocar', () => { expect(swapBlockedReason(ok)).toBeNull() })
  it('explica cada bloqueio', () => {
    expect(swapBlockedReason({ ...ok, status_pagamento: 'PENDENTE' })).toMatch(/aprovado/)
    expect(swapBlockedReason({ ...ok, refunded_at: '2026-01-01' })).toMatch(/estornado/)
    expect(swapBlockedReason({ ...ok, check_in_status: 'OK' })).toMatch(/check-in/)
    expect(swapBlockedReason({ ...ok, seatTipo: 'cadeirante' })).toMatch(/especial/)
    expect(swapBlockedReason({ ...ok, seat_id: null })).toMatch(/lugar marcado/)
  })
})
