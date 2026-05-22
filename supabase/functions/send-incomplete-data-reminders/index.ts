// Cron worker: dispara notif in-app pro INSCRITO quando suas inscrições
// pagas (APROVADO/CONFIRMADO) têm bailarinos com dados pendentes (CPF, nome
// ou data de nascimento vazios). Sem esses dados, certificado não emite e
// triagem etária não roda.
//
// Cadência: 1 notif por inscrição por dia até resolver. Idempotência via
//   notifications.metadata->>'reminder_type' = 'dados_pendentes_YYYY-MM-DD'
// Decisão 2A locked em 2026-05-22 (memory/plano_sessao_a_grazieli.md).
//
// Sem email — só in-app. O canal WhatsApp manual (botão no modal do produtor)
// continua sendo o pressionador principal. Email automatizado fica pra fase 2.
//
// Disparo: cron diário 09:30 BRT (12:30 UTC) — 30min após send-trilha-reminders
// pra não competir. Mesmo padrão de auth (Bearer service_role do pg_cron OR
// x-cron-token dedicado).
//
//   SELECT cron.schedule(
//     'send-incomplete-data-reminders',
//     '30 12 * * *',
//     $$
//     SELECT net.http_post(
//       url     := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/send-incomplete-data-reminders',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
//       ),
//       body := '{}'::jsonb
//     ) AS request_id;
//     $$
//   );

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  // Gate: aceita qualquer JWT com role=service_role no payload. A Supabase
  // platform já valida assinatura/expiração antes da function rodar
  // (verify_jwt=true default), então só checamos o claim "role" pra garantir
  // que não é JWT de inscrito autenticado disparando o cron.
  // Robusto a rotação da service_role_key — NÃO compara string com env
  // (lição [[feedback-jwt-role-check]]: pg_cron usa JWT que pode ser de outra
  // geração de service_role válida mas com string diferente do env).
  const auth  = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
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
    return respond(401, { error: 'Unauthorized' })
  }

  // Reabilitado 2026-06-01 (refator). Agora faz JOIN entre
  // bailarinos_detalhes[].id e a tabela `elenco` (fonte de verdade dos dados
  // pessoais). Helper inline espelha utils/bailarinos.ts pra evitar
  // cross-environment import (Deno vs Vite).
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey
  )

  // Hoje em America/Sao_Paulo (string YYYY-MM-DD). Deno roda UTC — naive
  // Date.now() pode estar 1 dia adiantado vs intent do produtor.
  const todayBR = (() => {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const parts = fmt.formatToParts(new Date())
    const y = parts.find(p => p.type === 'year')?.value
    const m = parts.find(p => p.type === 'month')?.value
    const d = parts.find(p => p.type === 'day')?.value
    return `${y}-${m}-${d}`
  })()

  // Idempotency marker do dia. notif desse reg com esse marker = pulamos.
  const reminderType = `dados_pendentes_${todayBR}`

  // Helper inline (sem cross-environment import) — espelha utils/bailarinos.ts.
  // Triplice via JOIN com elenco: CPF/nome/data_nascimento. Qualquer 1 vazio =
  // incompleto. Row em elenco ausente (id no JSONB sem match) = incompleto também.
  type ElencoRow = { id: string; nome?: string | null; cpf?: string | null; data_nascimento?: string | null }
  type ElencoById = Record<string, ElencoRow>

  const isElencoIncompleto = (e?: ElencoRow | null): boolean => {
    if (!e) return true
    return (
      !String(e.cpf ?? '').trim() ||
      !String(e.data_nascimento ?? '').trim() ||
      !String(e.nome ?? '').trim()
    )
  }

  const hasIncompleteBailarinos = (reg: any, elencoById: ElencoById): boolean => {
    const bailarinos = reg.bailarinos_detalhes
    if (!Array.isArray(bailarinos) || bailarinos.length === 0) {
      // Sem array mas com modalidade declarada — registro zumbi (caso Grazieli
      // "Entre cordas e sonhos"). Conta como incompleto.
      return Boolean(reg.formato_participacao)
    }
    const ids = bailarinos.map((b: any) => b?.id).filter(Boolean)
    if (ids.length === 0) return Boolean(reg.formato_participacao)
    return ids.some((id: string) => isElencoIncompleto(elencoById[id]))
  }

  type Registration = {
    id: string
    user_id: string | null
    event_id: string
    nome_coreografia: string | null
    formato_participacao: string | null
    status_pagamento: string
    bailarinos_detalhes: any[] | null
  }

  // Pega TODAS as registrations APROVADAS/CONFIRMADAS com user_id (não-anon).
  // Sem filter JSONB no banco — o helper faz match em JS (mais legível e flexível).
  // Pra 10k+ inscrições pagas no banco vira lento, mas pra escala atual OK.
  const { data: regs, error: regErr } = await supabase
    .from('registrations')
    .select('id, user_id, event_id, nome_coreografia, formato_participacao, status_pagamento, bailarinos_detalhes')
    .in('status_pagamento', ['APROVADO', 'CONFIRMADO'])
    .not('user_id', 'is', null)
    .limit(2000)

  if (regErr) return respond(500, { error: regErr.message })

  // Hidrata elenco em batch. Service role bypassa RLS — pega todos os ids
  // referenciados em bailarinos_detalhes de TODAS as registrations.
  const allBailarinosIds = [...new Set(
    (regs ?? []).flatMap((r: any) =>
      Array.isArray(r.bailarinos_detalhes)
        ? r.bailarinos_detalhes.map((b: any) => b?.id).filter(Boolean)
        : []
    )
  )] as string[]

  let elencoById: ElencoById = {}
  if (allBailarinosIds.length > 0) {
    const { data: elenco, error: elencoErr } = await supabase
      .from('elenco')
      .select('id, nome, cpf, data_nascimento')
      .in('id', allBailarinosIds)
    if (elencoErr) return respond(500, { error: elencoErr.message })
    elencoById = Object.fromEntries((elenco ?? []).map((e: any) => [e.id, e as ElencoRow]))
  }

  // Agrupa por user_id pra contar quantas inscrições do mesmo user estão
  // pendentes — UI pode mostrar "Você tem 3 coreografias com dados pendentes".
  // Mas a notif é por REGISTRATION (não por user agregado) pra navegar direto
  // pra inscrição específica via cta_url.
  const pendentes = (regs ?? [] as Registration[]).filter((r: any) => hasIncompleteBailarinos(r, elencoById))

  if (pendentes.length === 0) {
    return respond(200, { status: 'ok', message: 'Nenhuma inscrição pendente hoje', today: todayBR, total_scanned: regs?.length ?? 0 })
  }

  // Hidrata events.name pra texto da notif ("no Usualdance 2026")
  const eventIds = [...new Set(pendentes.map(r => r.event_id))]
  const { data: events } = await supabase
    .from('events')
    .select('id, name')
    .in('id', eventIds)
  const eventNameById = Object.fromEntries(((events ?? []) as { id: string; name: string }[]).map(e => [e.id, e.name]))

  let sent = 0
  let skipped = 0
  const errors: any[] = []

  for (const reg of pendentes as Registration[]) {
    if (!reg.user_id) { skipped++; continue }

    // Idempotência: já mandou hoje pra esta registration?
    const { count: alreadySent } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', reg.user_id)
      .eq('type', 'dados_pendentes')
      .filter('metadata->>registration_id', 'eq', reg.id)
      .filter('metadata->>reminder_type', 'eq', reminderType)

    if ((alreadySent ?? 0) > 0) { skipped++; continue }

    // Conta bailarinos pendentes pra texto mais informativo.
    const totalBailarinos = Array.isArray(reg.bailarinos_detalhes) ? reg.bailarinos_detalhes.length : 0
    const incompletos = Array.isArray(reg.bailarinos_detalhes)
      ? reg.bailarinos_detalhes.filter(isBailarinoIncompleto).length
      : 0

    const eventName = eventNameById[reg.event_id] ?? null
    const coreografia = reg.nome_coreografia ?? null

    // Sem bailarinos_detalhes (zumbi PWA cache) tem texto diferente.
    const title = totalBailarinos === 0
      ? 'Inscrição com dados incompletos'
      : `${incompletos} de ${totalBailarinos} bailarinos com dados pendentes`

    const body = totalBailarinos === 0
      ? `A inscrição ${coreografia ? `"${coreografia}"` : ''}${eventName ? ` no ${eventName}` : ''} está sem dados dos bailarinos. Sem CPF e data de nascimento, certificado não emite. Toque pra completar.`
      : `${coreografia ? `Na coreografia "${coreografia}"` : 'Em uma das suas coreografias'}${eventName ? ` (${eventName})` : ''}, ${incompletos === 1 ? '1 bailarino está' : `${incompletos} bailarinos estão`} sem CPF, nome ou data de nascimento. Sem esses dados, certificado não emite. Toque pra completar.`

    const { error: notifErr } = await supabase.from('notifications').insert({
      user_id:    reg.user_id,
      event_id:   reg.event_id,
      type:       'dados_pendentes',
      severity:   'warning',
      title,
      body,
      cta_url:    '/minhas-coreografias',
      cta_label:  'Completar dados',
      metadata: {
        registration_id:  reg.id,
        reminder_type:    reminderType,
        incompletos,
        total_bailarinos: totalBailarinos,
      },
    })

    if (notifErr) { errors.push({ reg: reg.id, error: notifErr.message }); continue }
    sent++
  }

  console.log(`[send-incomplete-data-reminders] today=${todayBR} scanned=${regs?.length ?? 0} pending=${pendentes.length} sent=${sent} skipped=${skipped} errors=${errors.length}`)

  return respond(200, {
    status: 'ok',
    today: todayBR,
    total_scanned: regs?.length ?? 0,
    total_pending: pendentes.length,
    sent,
    skipped,
    errors,
  })
})
