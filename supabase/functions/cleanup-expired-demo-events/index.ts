/**
 * Cleanup de eventos demo expirados (>24h desde a criação).
 *
 * Todo evento demo (seed-demo-event) nasce com is_public=true de propósito
 * — o produtor precisa ver a própria vitrine funcionando. Mas isso significa
 * que ele também aparece em /festivais (listagem pública) até alguém deletar
 * manualmente. Se o produtor esquecer, o demo fica poluindo a vitrine pra
 * sempre e ele continua "logado" nele em qualquer tela sem seletor explícito
 * (mesma classe do bug de sombreamento por is_demo já documentado).
 *
 * Prática de mercado (Vercel preview deploys, sandboxes de onboarding):
 * ambiente demo/efêmero expira sozinho por idade fixa, sem depender do
 * usuário lembrar de limpar. 24h é o suficiente pro produtor testar e
 * mostrar pra alguém — depois disso vira lixo acumulado.
 *
 * Reusa a MESMA sequência de limpeza de seed-demo-event (action=delete):
 * tabelas sem CASCADE em events (platform_commissions, audience_tickets,
 * elenco via bailarinos_detalhes, certificates_issued, coupons, workshops
 * standalone) + jurados/staff sentinela do demo. Nunca toca created_by de
 * evento REAL — só produtores com is_demo=true expirado entram no escopo.
 *
 * Agendamento recomendado: pg_cron diário às 03:00 BRT (06:00 UTC).
 *   SELECT cron.schedule('cleanup-expired-demo-events-daily', '0 6 * * *',
 *     $$ SELECT net.http_post(
 *       url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/cleanup-expired-demo-events',
 *       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
 *     ); $$);
 *
 * OU executar manualmente via cURL pra testar:
 *   curl -X POST https://...supabase.co/functions/v1/cleanup-expired-demo-events \
 *     -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_AGE_HOURS = 24

Deno.serve(async (req) => {
  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

    // Gate: decodifica o JWT e checa o claim "role" — NÃO comparar string
    // com a env var (anti-padrão documentado, lição feedback_jwt_role_check).
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    let jwtRole = ''
    try {
      const payloadB64 = token.split('.')[1] ?? ''
      if (payloadB64) {
        const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
        const payload = JSON.parse(atob(padded))
        jwtRole = String(payload?.role ?? '')
      }
    } catch { /* JWT malformado — cai no 401 abaixo */ }
    if (jwtRole !== 'service_role') {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 })
    }

    const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey)

    const cutoffIso = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString()

    const { data: expired, error: expiredErr } = await supa
      .from('events')
      .select('id, created_by, name, created_at')
      .eq('is_demo', true)
      .lt('created_at', cutoffIso)
    if (expiredErr) throw new Error('Erro ao listar demos expirados: ' + expiredErr.message)

    if (!expired || expired.length === 0) {
      return new Response(JSON.stringify({ success: true, expired: 0, deleted_events: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const ids = expired.map((e) => e.id)
    const creatorIds = Array.from(new Set(expired.map((e) => e.created_by).filter(Boolean)))

    // ── mesma sequência de cleanupBeforeEventDelete (seed-demo-event) ──
    await supa.from('platform_commissions').delete().in('event_id', ids)
    await supa.from('audience_tickets').delete().in('event_id', ids)

    try {
      const { data: demoRegs } = await supa
        .from('registrations')
        .select('bailarinos_detalhes')
        .in('event_id', ids)
      const elencoIdsToDelete = new Set<string>()
      for (const reg of demoRegs ?? []) {
        const arr = Array.isArray(reg.bailarinos_detalhes) ? reg.bailarinos_detalhes : []
        for (const b of arr) {
          if (b && typeof b.id === 'string') elencoIdsToDelete.add(b.id)
        }
      }
      if (elencoIdsToDelete.size > 0) {
        await supa.from('elenco').delete().in('id', Array.from(elencoIdsToDelete))
      }
    } catch (e) {
      console.warn('[cleanup-expired-demo-events] Falha ao deletar elenco demo:', e)
    }

    await supa.from('certificates_issued').delete().in('event_id', ids)
    await supa.from('coupons').delete().in('event_id', ids)
    // workshops vinculados (event_id IN ids) caem via CASCADE no delete de events.
    // Só workshops standalone (event_id null) dos criadores precisam de limpeza manual.
    // Jurados fictícios do demo — por VÍNCULO REAL com o evento (event_judges),
    // nunca por PIN. PIN é um código de 4 dígitos escolhido livremente, sem
    // garantia de unicidade — comparar por PIN já vazou (e quase apagou) um
    // jurado REAL cujo PIN coincidia com o sentinela (2026-08-18, mesma classe
    // de bug corrigida em JudgesManagement.tsx e seed-demo-event). Esse cron
    // roda sozinho todo dia sem revisão humana — usar identidade de verdade
    // aqui é ainda mais crítico que nos outros 2 pontos. Consulta ANTES do
    // DELETE de events (linha abaixo), que arrastaria event_judges via CASCADE.
    const { data: linkedJudges } = await supa
      .from('event_judges')
      .select('judge_id')
      .in('event_id', ids)
    const judgeIdsToDelete = Array.from(new Set((linkedJudges ?? []).map((r: { judge_id: string }) => r.judge_id)))
    if (judgeIdsToDelete.length > 0) {
      await supa.from('judges').delete().in('id', judgeIdsToDelete)
    }

    if (creatorIds.length > 0) {
      await supa.from('workshops').delete().in('created_by', creatorIds).is('event_id', null)

      for (const userId of creatorIds) {
        const userIdShort = String(userId).slice(0, 8)
        const { data: staffProfiles } = await supa
          .from('profiles')
          .select('id')
          .like('email', `%-${userIdShort}@coreohub-demo.local`)
        for (const p of (staffProfiles ?? []) as Array<{ id: string }>) {
          try {
            await supa.auth.admin.deleteUser(p.id)
          } catch (e) {
            console.warn(`[cleanup-expired-demo-events] Falha ao deletar staff demo ${p.id}:`, e)
          }
        }
      }
    }

    const { error: delErr } = await supa.from('events').delete().in('id', ids)
    if (delErr) throw new Error('Erro ao deletar eventos demo: ' + delErr.message)

    console.log(`[cleanup-expired-demo-events] expired=${expired.length} events=${JSON.stringify(ids)}`)

    return new Response(
      JSON.stringify({ success: true, expired: expired.length, deleted_events: expired.map((e) => ({ id: e.id, name: e.name, created_at: e.created_at })) }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[cleanup-expired-demo-events] erro:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
