/**
 * Edge Function: reconcile-payout-attempt  (Lote 2 da auditoria, B-N1/B-N2)
 *
 * Decisão do admin sobre um repasse PIX "incerto" (timeout/5xx no saque, ou sem desfecho em 24 h).
 * Desenho: docs/auditoria/DESENHO-repasse.md. Sempre conferir o extrato da subconta no painel da
 * Asaas ANTES de decidir.
 *
 * Auth: JWT do usuário com profiles.is_super_admin (verify_jwt = true).
 * Ações:
 *   list                                  tentativas abertas (iniciada/enviada/incerta)
 *   mark_paid   { attempt_id, transfer_id }  "A Asaas pagou": vira 'enviada'; o próximo repasse só remarca as linhas
 *   mark_unpaid { attempt_id, note }         "A Asaas NÃO pagou": vira 'recusada'; as linhas voltam a ser pagáveis
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
    )
    const { data: { user } } = await supabase.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''))
    if (!user) return json({ error: 'Não autorizado.' }, 401)
    const { data: me } = await supabase.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle()
    if (me?.is_super_admin !== true) return json({ error: 'Só super admin.' }, 403)

    const action = String(body.action ?? '')

    if (action === 'list') {
      const { data, error } = await supabase
        .from('payout_attempts')
        .select('id, producer_id, kind, amount, item_ids, status, transfer_id, last_error, created_at, updated_at')
        .in('status', ['iniciada', 'enviada', 'incerta'])
        .order('created_at', { ascending: true })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, attempts: data ?? [] })
    }

    const id = String(body.attempt_id ?? '')
    if (!id) return json({ error: 'attempt_id obrigatório.' }, 400)
    const { data: att, error: getErr } = await supabase
      .from('payout_attempts').select('id, status').eq('id', id).maybeSingle()
    if (getErr) return json({ error: getErr.message }, 500)
    if (!att) return json({ error: 'Tentativa não encontrada.' }, 404)
    if (!['iniciada', 'incerta'].includes(att.status)) {
      return json({ error: `Só tentativas iniciada/incerta podem ser decididas (atual: ${att.status}).` }, 409)
    }

    if (action === 'mark_paid') {
      const transferId = String(body.transfer_id ?? '').trim()
      if (!transferId) return json({ error: 'transfer_id (da Asaas) obrigatório.' }, 400)
      const { error } = await supabase.from('payout_attempts').update({
        status: 'enviada', transfer_id: transferId, last_error: `admin ${user.id}: confirmou que a Asaas pagou`,
        updated_at: new Date().toISOString(),
      }).eq('id', id).in('status', ['iniciada', 'incerta'])
      if (error) return json({ error: error.message }, 500)
      console.warn(`[reconcile-payout-attempt] admin=${user.id} attempt=${id} => enviada transfer=${transferId}`)
      return json({ ok: true, status: 'enviada', note: 'O próximo repasse do produtor só marca as linhas como pagas (não saca de novo).' })
    }

    if (action === 'mark_unpaid') {
      const note = String(body.note ?? '').trim().slice(0, 300)
      const { error } = await supabase.from('payout_attempts').update({
        status: 'recusada', last_error: `admin ${user.id}: Asaas NÃO pagou. ${note}`.trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', id).in('status', ['iniciada', 'incerta'])
      if (error) return json({ error: error.message }, 500)
      console.warn(`[reconcile-payout-attempt] admin=${user.id} attempt=${id} => recusada (nao pago)`)
      return json({ ok: true, status: 'recusada', note: 'As linhas voltam a ser pagáveis no próximo repasse.' })
    }

    return json({ error: 'ação desconhecida' }, 400)
  } catch (e) {
    console.error('[reconcile-payout-attempt] erro:', (e as Error).message)
    return json({ error: 'Erro interno.' }, 500)
  }
})
