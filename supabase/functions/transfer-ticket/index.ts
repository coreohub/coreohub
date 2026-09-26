/**
 * Edge Function: transfer-ticket
 *
 * Transferência GRATUITA de titularidade de UM ingresso de plateia (Decreto 13.108/2026,
 * arts. 17-19). Autenticação = access_token do ingresso (o mesmo do link do e-mail),
 * então verify_jwt = false. Escreve com service_role: buyer_*, access_token e qr_code
 * são protegidos por trigger contra o cliente.
 *
 * Body: { access_token: UUID, new_holder: { name, cpf, email, phone } }
 *
 * O que acontece:
 *   - grava linha de auditoria em audience_ticket_transfers (retenção ≥ 2 anos);
 *   - troca buyer_name/email/cpf/phone do ingresso;
 *   - gera NOVO access_token (link novo) e NOVO qr_code (QR novo): o link e o QR do
 *     titular anterior deixam de funcionar (o check-in recusa o id antigo);
 *   - avisa o titular anterior (QR antigo invalidado) e o novo (link do ingresso).
 * Nenhuma cobrança, de nenhum tipo. Sem limite de transferências por ingresso, só um
 * limite diário por IP (antiabuso, art. 19). O novo link NUNCA volta na resposta: só
 * vai por e-mail ao novo titular, para o titular anterior não ficar com o acesso.
 *
 * Bloqueios: ingresso que não está ativo (APROVADO/CORTESIA), check-in já feito,
 * sessão cancelada, novo titular igual ao atual (mesmo CPF).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'
import { dispararEmail } from '../_shared/audience-refund.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function extractClientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
}

function validCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, '')
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const calc = (slice: string, weights: number[]) => {
    const mod = weights.reduce((acc, w, i) => acc + Number(slice[i]) * w, 0) % 11
    return mod < 2 ? 0 : 11 - mod
  }
  if (calc(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) !== Number(cpf[9])) return false
  return calc(cpf.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(cpf[10])
}

/** ***.456.789-** — o suficiente para reconhecer, sem guardar o CPF inteiro na trilha. */
function maskCpf(cpfDigits: string | null | undefined): string {
  const d = String(cpfDigits ?? '').replace(/\D/g, '')
  if (d.length !== 11) return '—'
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
}

function fmtSessao(date: string | null, time: string | null): string | undefined {
  if (!date) return undefined
  const d = new Date(`${date}T12:00:00`)
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(d).replace('.', '')
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1)
  const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
  return `${cap}, ${day}${time ? ` · ${time.slice(0, 5)}` : ''}`
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({})) as {
      access_token?: string
      new_holder?: { name?: string; cpf?: string; email?: string; phone?: string }
    }
    const { access_token } = body
    if (!access_token || !UUID_RE.test(access_token)) throw new Error('Link do ingresso inválido')

    const h = body.new_holder ?? {}
    const name = String(h.name ?? '').trim().replace(/\s+/g, ' ')
    const cpf = String(h.cpf ?? '').replace(/\D/g, '')
    const email = String(h.email ?? '').trim().toLowerCase()
    const phone = String(h.phone ?? '').replace(/\D/g, '')
    if (name.length < 3 || name.length > 120) throw new Error('Informe o nome completo do novo titular')
    if (!validCpf(cpf)) throw new Error('CPF do novo titular inválido')
    if (!EMAIL_RE.test(email) || email.length > 160) throw new Error('E-mail do novo titular inválido')
    if (phone.length < 10 || phone.length > 13) throw new Error('Telefone do novo titular inválido (com DDD)')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Antiabuso (art. 19): 10 transferências por dia por IP.
    const clientIp = extractClientIp(req)
    if (clientIp !== 'unknown') {
      const { data: rl } = await supabase.rpc('rate_limit_check', {
        p_scope: 'transfer-ticket', p_identifier: clientIp, p_window_seconds: 86400, p_max_attempts: 10,
      })
      const row = Array.isArray(rl) ? rl[0] : rl
      if (row && row.allowed === false) return json({ error: 'Limite diário de transferências atingido. Tente novamente amanhã ou fale com o organizador.' }, 429)
    }

    const { data: ticket } = await supabase
      .from('audience_tickets')
      .select('id, event_id, status_pagamento, check_in_status, ticket_type_nome, ticket_type_kind, seat_id, buyer_name, buyer_email, buyer_cpf, buyer_phone, transfer_count')
      .eq('access_token', access_token)
      .maybeSingle()
    if (!ticket) throw new Error('Ingresso não encontrado')
    if (!['APROVADO', 'CORTESIA'].includes(String(ticket.status_pagamento))) throw new Error('Este ingresso não está ativo e não pode ser transferido')
    if (ticket.check_in_status === 'OK') throw new Error('Este ingresso já foi utilizado na entrada e não pode mais ser transferido')

    const { data: event } = await supabase
      .from('events')
      .select('id, name, slug, created_by, sessao_status, start_date, event_time')
      .eq('id', ticket.event_id)
      .single()
    if (!event) throw new Error('Evento não encontrado')
    if (event.sessao_status === 'cancelada') throw new Error('Esta sessão foi cancelada: o ingresso não vale para entrada e não pode ser transferido')

    const currentCpf = String(ticket.buyer_cpf ?? '').replace(/\D/g, '')
    if (currentCpf && currentCpf === cpf) throw new Error('O novo titular é a mesma pessoa que já é titular deste ingresso')

    const newToken = crypto.randomUUID()
    const newQr = crypto.randomUUID()
    const nowIso = new Date().toISOString()

    // 1º a trilha de auditoria; se a troca falhar, ela é desfeita (nunca fica transferência sem registro).
    const { data: audit, error: auditErr } = await supabase.from('audience_ticket_transfers').insert({
      ticket_id: ticket.id, event_id: ticket.event_id,
      from_name: ticket.buyer_name, from_email: ticket.buyer_email, from_cpf_masked: maskCpf(ticket.buyer_cpf),
      to_name: name, to_email: email, to_cpf_masked: maskCpf(cpf),
      ip: clientIp === 'unknown' ? null : clientIp,
    }).select('id').single()
    if (auditErr || !audit) {
      console.error('[transfer-ticket] auditoria falhou:', auditErr?.message)
      throw new Error('Não foi possível registrar a transferência agora. Tente novamente.')
    }

    // Compare-and-swap: só troca se o ingresso continua com o mesmo link, ativo e sem check-in.
    const { data: updated, error: upErr } = await supabase
      .from('audience_tickets')
      .update({
        buyer_name: name, buyer_email: email, buyer_cpf: cpf, buyer_phone: phone,
        access_token: newToken, qr_code: newQr,
        transfer_count: Number(ticket.transfer_count ?? 0) + 1, transferred_at: nowIso,
      })
      .eq('id', ticket.id)
      .eq('access_token', access_token)
      .eq('check_in_status', 'PENDENTE')
      .in('status_pagamento', ['APROVADO', 'CORTESIA'])
      .select('id')
    if (upErr || !updated || updated.length === 0) {
      await supabase.from('audience_ticket_transfers').delete().eq('id', audit.id)
      if (upErr) console.error('[transfer-ticket] update falhou:', upErr.message)
      throw new Error('O ingresso mudou enquanto você transferia (uso na entrada ou outra transferência). Abra o link novamente.')
    }

    // ── E-mails (best-effort: a transferência já vale mesmo se um e-mail falhar) ──
    const { data: prod } = await supabase.from('profiles').select('email').eq('id', event.created_by).maybeSingle()
    let assentoEspecial = false
    if (ticket.seat_id) {
      const { data: seat } = await supabase.from('event_seats').select('seat_tipo').eq('audience_ticket_id', ticket.id).maybeSingle()
      assentoEspecial = !!seat?.seat_tipo && seat.seat_tipo !== 'comum'
    }
    const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
    const common = {
      fromName: ticket.buyer_name ?? undefined, toName: name,
      eventoNome: event.name, ingressoNome: ticket.ticket_type_nome ?? 'Ingresso', assento: ticket.seat_id,
      sessao: fmtSessao(event.start_date, event.event_time), produtorEmail: prod?.email,
    }
    const [fromOk, toOk] = await Promise.all([
      ticket.buyer_email
        ? dispararEmail('audience_ticket_transferred_from', { ...common, toEmail: ticket.buyer_email, recipientName: ticket.buyer_name })
        : Promise.resolve(false),
      dispararEmail('audience_ticket_transferred_to', {
        ...common, toEmail: email, recipientName: name,
        ingressoUrl: `${appUrl}/meu-ingresso/${newToken}`,
        meia: ticket.ticket_type_kind === 'meia', assentoEspecial,
      }),
    ])

    console.log(`[transfer-ticket] ok ticket=${ticket.id} n=${Number(ticket.transfer_count ?? 0) + 1} email_anterior=${fromOk} email_novo=${toOk}`)
    return json({ ok: true, emailed_new_holder: toOk })
  } catch (err: any) {
    console.error('[transfer-ticket] erro:', err.message)
    return json({ error: err.message ?? String(err) }, 400)
  }
})
