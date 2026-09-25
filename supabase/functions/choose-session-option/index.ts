/**
 * Edge Function: choose-session-option
 *
 * O COMPRADOR escolhe o que fazer com o ingresso de uma sessão adiada/cancelada
 * (Decreto 13.108/2026, arts. 20-22). Autenticação = access_token do ingresso
 * (o mesmo do link do e-mail), então verify_jwt = false.
 *
 * Body: { access_token: UUID, option: 'manter' | 'credito' | 'restituicao' }
 *
 *   manter      — só sessão adiada; o ingresso vale pra nova data.
 *   credito     — o pedido inteiro vira status 'CREDITO' (nada reativa: o
 *                 webhook tardio só religa CANCELADO/VENCIDO) + cupom COM SALDO
 *                 no valor pago (validade 12 meses; o que não for usado continua
 *                 disponível), válido nas sessões do mesmo espetáculo (ou no
 *                 próprio evento, se adiado). Assentos liberados.
 *   restituicao — estorno integral (com taxas) pelo Asaas, na hora. Se o Asaas
 *                 falhar, a escolha fica registrada com o erro e o produtor
 *                 reprocessa pelo painel (refund-session-orders): o comprador
 *                 nunca perde o pedido.
 *
 * Vale pro PEDIDO inteiro (group_id): 1 pagamento = 1 estorno.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { refundAudienceOrder, dispararEmail } from '../_shared/audience-refund.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function extractClientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Código legível sem caracteres ambíguos (0/O, 1/I). */
function generateCreditCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return 'CRED-' + Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { access_token, option } = await req.json().catch(() => ({})) as { access_token?: string; option?: string }
    if (!access_token || !UUID_RE.test(access_token)) throw new Error('Link do ingresso inválido')
    if (!['manter', 'credito', 'restituicao'].includes(String(option))) throw new Error('Opção inválida')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rl } = await supabase.rpc('rate_limit_check', {
        p_scope: 'choose-session-option', p_identifier: clientIp, p_window_seconds: 300, p_max_attempts: 20,
      })
      const row = Array.isArray(rl) ? rl[0] : rl
      if (row && row.allowed === false) return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
    }

    const { data: ticket } = await supabase
      .from('audience_tickets')
      .select('id, event_id, group_id, status_pagamento, check_in_status, refunded_at, sessao_escolha, buyer_email, buyer_name')
      .eq('access_token', access_token)
      .maybeSingle()
    if (!ticket) throw new Error('Ingresso não encontrado')

    const { data: event } = await supabase
      .from('events')
      .select('id, name, slug, created_by, sessao_status, session_group_id, start_date, end_date')
      .eq('id', ticket.event_id)
      .single()
    if (!event || !['adiada', 'cancelada'].includes(String(event.sessao_status))) {
      throw new Error('Esta sessão não foi adiada nem cancelada')
    }

    if (ticket.status_pagamento !== 'APROVADO') throw new Error('Este ingresso não está ativo')
    if (ticket.sessao_escolha === 'credito' || ticket.sessao_escolha === 'restituicao') {
      throw new Error('Você já fez a sua escolha para este ingresso')
    }

    // Pedido inteiro (mesmo group_id) — 1 pagamento = 1 estorno/crédito.
    const q = supabase.from('audience_tickets')
      .select('id, seat_id, ticket_type_nome, preco, commission_amount, fee_mode, check_in_status, status_pagamento, payment_id')
    const { data: orderRows } = await (ticket.group_id ? q.eq('group_id', ticket.group_id) : q.eq('id', ticket.id))
    const order = ((orderRows ?? []) as any[]).filter(t => t.status_pagamento === 'APROVADO')
    if (order.length === 0) throw new Error('Este pedido não tem ingressos ativos')
    if (order.some(t => t.check_in_status === 'OK')) throw new Error('Este pedido já teve ingresso utilizado na entrada')
    const orderIds = order.map(t => t.id)
    const nowIso = new Date().toISOString()

    const markChoice = (escolha: string, extra: Record<string, unknown> = {}) =>
      supabase.from('audience_tickets')
        .update({ sessao_escolha: escolha, sessao_escolha_em: nowIso, sessao_escolha_erro: null, ...extra })
        .in('id', orderIds)

    const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'

    // ── MANTER ──────────────────────────────────────────────────────────────
    if (option === 'manter') {
      if (event.sessao_status !== 'adiada') throw new Error('Só é possível manter o ingresso quando a sessão foi adiada')
      const { error } = await markChoice('manter')
      if (error) throw new Error('Não foi possível registrar a escolha')
      return json({ ok: true, option: 'manter' })
    }

    // ── RESTITUIÇÃO ─────────────────────────────────────────────────────────
    if (option === 'restituicao') {
      if (!order[0].payment_id) {
        throw new Error('Este ingresso não foi pago pela plataforma (cortesia ou venda no balcão). Fale com o organizador para a restituição.')
      }
      const { error } = await markChoice('restituicao')
      if (error) throw new Error('Não foi possível registrar a escolha')
      try {
        const r = await refundAudienceOrder(supabase, {
          ticketId: orderIds[0],
          reason: `Restituição integral escolhida pelo comprador (sessão ${event.sessao_status})`,
          callerLabel: 'choose-session-option',
        })
        return json({ ok: true, option: 'restituicao', refunded: true, refund_amount: r.refund_amount })
      } catch (e: any) {
        // Não desfaz a escolha: o produtor reprocessa. O comprador vê "em processamento".
        console.error('[choose-session-option] estorno falhou:', e.message)
        await supabase.from('audience_tickets').update({ sessao_escolha_erro: String(e.message).slice(0, 300) }).in('id', orderIds)
        return json({ ok: true, option: 'restituicao', refunded: false, pending: true })
      }
    }

    // ── CRÉDITO ─────────────────────────────────────────────────────────────
    // Crédito só faz sentido se há onde usar: o próprio evento adiado ou sessões irmãs ativas.
    let temOndeUsar = event.sessao_status === 'adiada'
    if (!temOndeUsar && event.session_group_id) {
      const { data: irmas } = await supabase.from('events')
        .select('id, start_date, end_date, sessao_status')
        .eq('session_group_id', event.session_group_id)
        .neq('id', event.id)
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      temOndeUsar = (irmas ?? []).some((s: any) => s.sessao_status !== 'cancelada' && String(s.end_date ?? s.start_date ?? '9999') >= hoje)
    }
    if (!temOndeUsar) throw new Error('Não há outra sessão disponível para usar o crédito. Escolha a restituição.')

    // Valor = o que foi PAGO (com a taxa de serviço quando repassada).
    const total = round2(order.reduce((s, t) => s + Number(t.preco ?? 0) + (t.fee_mode === 'repassar' ? Number(t.commission_amount ?? 0) : 0), 0))
    if (!(total > 0)) throw new Error('Este pedido não tem valor pago para converter em crédito')

    const validoAte = new Date()
    validoAte.setFullYear(validoAte.getFullYear() + 1)
    const validoAteIso = validoAte.toISOString().slice(0, 10)

    let coupon: { id: string; code: string } | null = null
    for (let attempt = 0; attempt < 5 && !coupon; attempt++) {
      const code = generateCreditCode()
      const { data, error } = await supabase.from('coupons').insert({
        event_id: event.id, code, discount_type: 'fixed', discount_value: total,
        max_uses: null, expires_at: validoAteIso, is_active: true,
        scopes: ['audience'], scope: 'audience',
        is_credit: true, credit_session_group_id: event.session_group_id ?? null,
      }).select('id, code').single()
      if (!error && data) coupon = data as any
      else if (error && !/duplicate|unique/i.test(error.message)) throw new Error('Não foi possível gerar o crédito agora')
    }
    if (!coupon) throw new Error('Não foi possível gerar o crédito agora')

    // 1º invalida o ingresso; só depois solta o assento (event_seats guarda o ticket por
    // audience_ticket_id, e release_event_seats o acha por ele: roda ANTES de mudar o vínculo,
    // que aqui não muda). Se a conversão falhar, nada mudou e o cupom é desfeito.
    const { error: upErr } = await markChoice('credito', { status_pagamento: 'CREDITO', sessao_credito_cupom_id: coupon.id })
    if (upErr) {
      console.error('[choose-session-option] conversão em crédito falhou:', upErr.message)
      await supabase.from('coupons').delete().eq('id', coupon.id)
      throw new Error('Não foi possível converter o ingresso em crédito')
    }
    const { error: relErr } = await supabase.rpc('release_event_seats', { p_ticket_ids: orderIds })
    if (relErr) console.error('[choose-session-option] release_event_seats:', relErr.message)

    const { data: prod } = await supabase.from('profiles').select('email').eq('id', event.created_by).maybeSingle()
    const emailOk = ticket.buyer_email ? await dispararEmail('audience_session_credit', {
      buyerName: ticket.buyer_name, buyerEmail: ticket.buyer_email, produtorEmail: prod?.email,
      eventoNome: event.name, codigo: coupon.code, valor: total,
      validoAte: validoAte.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      ingressos: order.map(t => ({ nome: t.ticket_type_nome ?? 'Ingresso', assento: t.seat_id })),
      eventoUrl: event.slug ? `${appUrl}/evento/${event.slug}` : undefined,
    }) : false

    console.log(`[choose-session-option] credito ok event=${event.id} pedido=${orderIds.length} valor=${total} cupom=${coupon.code} email=${emailOk}`)
    return json({ ok: true, option: 'credito', coupon_code: coupon.code, credit_value: total, valid_until: validoAteIso, email_sent: emailOk })
  } catch (err: any) {
    console.error('[choose-session-option] erro:', err.message)
    return json({ error: err.message ?? String(err) }, 400)
  }
})
