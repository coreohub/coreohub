/**
 * Edge Function: emit-certificates-batch
 *
 * Etapa 2 — Certificados (modelo lazy-cache).
 *
 * Producer chama → varre inscrições elegíveis e cria 1 row em certificates_issued
 * por inscrito (com pdf_url=NULL). NÃO gera os PDFs aqui — geração acontece
 * sob demanda quando inscrito clica "Baixar" em get-certificate-pdf.
 *
 * verify_jwt=true: producer autenticado. Cross-checka template e ownership.
 *
 * Body POST JSON:
 * {
 *   event_id:       UUID,                  // evento alvo (mostra) OU evento dono dos workshops
 *   template_type:  'mostra' | 'workshop',
 *   workshop_id?:   UUID                    // se template_type='workshop' e quer só 1 workshop
 *                                           // (omitido = todos os workshops do evento)
 * }
 *
 * Resposta 200:
 * {
 *   total:    número de inscrições elegíveis
 *   created:  novos certificates_issued criados
 *   skipped:  já existiam (idempotente)
 * }
 *
 * Critérios de elegibilidade:
 *   • mostra:    registrations.status = 'APROVADA' E status_pagamento IN ('APROVADO','CONFIRMADO')
 *   • workshop:  workshop_registrations.attended = TRUE
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

type TemplateType = 'mostra' | 'workshop'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Não autenticado')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Resolve user pelo JWT
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) throw new Error('Sessão inválida')

    const body = await req.json().catch(() => ({}))
    const { event_id, template_type, workshop_id } = body as {
      event_id?: string; template_type?: TemplateType; workshop_id?: string
    }

    if (template_type !== 'mostra' && template_type !== 'workshop') {
      throw new Error('template_type deve ser "mostra" ou "workshop"')
    }
    // Audit T1.4: workshop standalone (event_id=null) emite por workshop_id sozinho.
    // Mostra exige event_id sempre. Workshop pode ser event_id OU workshop_id (ou ambos).
    if (template_type === 'mostra' && !event_id) {
      throw new Error('event_id obrigatório pra emitir certificados de mostra')
    }
    if (template_type === 'workshop' && !event_id && !workshop_id) {
      throw new Error('event_id ou workshop_id obrigatório pra emitir certificados de workshop')
    }

    // Resolve evento (pode ser null se workshop standalone)
    let ev: { id: string | null; name: string | null; event_date: string | null; location: string | null; created_by: string } | null = null

    if (event_id) {
      const { data, error: evErr } = await supabase
        .from('events')
        .select('id, name, event_date, location, created_by')
        .eq('id', event_id)
        .single()
      if (!data || evErr) throw new Error('Evento não encontrado')
      ev = data
    }

    // Resolve owner: se workshop standalone, owner é workshops.created_by
    let ownerId: string | null = ev?.created_by ?? null
    if (!ownerId && workshop_id) {
      const { data: ws } = await supabase
        .from('workshops')
        .select('created_by')
        .eq('id', workshop_id)
        .single()
      ownerId = ws?.created_by ?? null
    }
    if (!ownerId) throw new Error('Não foi possível resolver dono do evento/workshop')

    // Verifica permissão (dono OU COREOHUB_ADMIN)
    if (ownerId !== user.id) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role !== 'COREOHUB_ADMIN') {
        throw new Error('Sem permissão pra emitir certificados deste evento/workshop')
      }
    }

    // Carrega template (verifica que existe pra esse type)
    const { data: tpl } = await supabase
      .from('certificate_templates')
      .select('id')
      .eq('producer_id', ownerId)
      .eq('template_type', template_type)
      .maybeSingle()
    if (!tpl) {
      throw new Error(`Você ainda não criou o template de ${template_type}. Configure em Certificados antes de emitir.`)
    }

    let total = 0
    let created = 0
    let skipped = 0
    // Audit T3: cap de inserts por chamada pra evitar timeout do Edge Runtime
    // (150s default) em eventos gigantes (Joinville: 1500+ inscrições). Idempotência
    // já existe — produtor chama de novo até skipped == eligíveis pra completar.
    const BATCH_CAP = 1000

    // ── Branch: MOSTRA ──────────────────────────────────────────────────────
    if (template_type === 'mostra') {
      // Validação anterior já garante que ev != null pra mostra
      const eventName = ev!.name
      const eventDate = ev!.event_date ? String(ev!.event_date) : null
      const eventLocation = ev!.location
      const eventIdSafe = ev!.id

      const { data: regs, error: regsErr } = await supabase
        .from('registrations')
        .select(`
          id, nome_coreografia, formato_participacao, categoria, estilo_danca,
          tipo_apresentacao, estudio, classificacao_final, valor_pago, bailarinos_detalhes
        `)
        .eq('event_id', eventIdSafe)
        .eq('status', 'APROVADA')
        .in('status_pagamento', ['APROVADO', 'CONFIRMADO'])

      if (regsErr) throw new Error(`Erro carregando inscrições: ${regsErr.message}`)
      total = (regs ?? []).length

      // Idempotência: busca certificates_issued já existentes
      const existingIds = new Set<string>()
      if (total > 0) {
        const { data: existing } = await supabase
          .from('certificates_issued')
          .select('registration_id')
          .eq('template_type', 'mostra')
          .in('registration_id', (regs ?? []).map(r => r.id))
        for (const e of existing ?? []) {
          if (e.registration_id) existingIds.add(e.registration_id)
        }
      }

      const rows = (regs ?? [])
        .filter(r => !existingIds.has(r.id))
        .slice(0, BATCH_CAP)  // Audit T3: cap por chamada (idempotência permite repetir)
        .map(r => {
          // recipient_name: usa nome dos bailarinos (Solo/Duo) ou nome_coreografia (Grupo)
          const formato = String(r.formato_participacao ?? '').toLowerCase()
          const isGrupo = formato.includes('grupo') || formato.includes('conjunto')
          const bailarinos = Array.isArray(r.bailarinos_detalhes) ? r.bailarinos_detalhes : []
          const nomes = bailarinos.map((b: any) => b?.full_name).filter(Boolean)
          const recipient = isGrupo
            ? r.nome_coreografia
            : nomes.length > 0 ? nomes.join(' & ') : r.nome_coreografia

          return {
            template_id: tpl.id,
            template_type: 'mostra' as const,
            registration_id: r.id,
            workshop_registration_id: null,
            event_id: eventIdSafe,
            producer_id: ownerId,
            recipient_name: recipient,
            certificate_data: {
              evento_nome: eventName,
              evento_data: eventDate,
              evento_local: eventLocation,
              coreografia: r.nome_coreografia,
              formato: r.formato_participacao,
              categoria: r.categoria,
              modalidade: r.estilo_danca,
              estudio: r.estudio,
              classificacao: r.classificacao_final,
              tipo_apresentacao: r.tipo_apresentacao, // Avaliada usa corpo de texto diferente
            },
          }
        })

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('certificates_issued').insert(rows)
        if (insErr) throw new Error(`Erro inserindo certificados: ${insErr.message}`)
        created = rows.length
      }
      skipped = total - created
    }

    // ── Branch: WORKSHOP ────────────────────────────────────────────────────
    if (template_type === 'workshop') {
      // Resolve workshops: por workshop_id (single) OU por event_id (all)
      let wsQ = supabase.from('workshops').select('id, name, event_id, professor_name, modalidade, data_inicio, duracao_minutos, created_by')
      if (workshop_id) wsQ = wsQ.eq('id', workshop_id)
      else if (event_id) wsQ = wsQ.eq('event_id', event_id)
      const { data: workshops, error: wsErr } = await wsQ
      if (wsErr) throw new Error(`Erro carregando workshops: ${wsErr.message}`)
      if (!workshops || workshops.length === 0) {
        return json({ total: 0, created: 0, skipped: 0, info: 'Nenhum workshop encontrado' })
      }

      // Defesa em profundidade: cada workshop tem que pertencer ao ownerId
      const alienWs = workshops.find(w => w.created_by !== ownerId)
      if (alienWs) throw new Error('Workshop não pertence ao usuário autenticado')

      const wsIds = workshops.map(w => w.id)
      const { data: regs, error: regsErr } = await supabase
        .from('workshop_registrations')
        .select('id, workshop_id, buyer_name, preco_pago')
        .in('workshop_id', wsIds)
        .eq('attended', true)
      if (regsErr) throw new Error(`Erro carregando inscrições workshop: ${regsErr.message}`)
      total = (regs ?? []).length

      // Idempotência
      const existingIds = new Set<string>()
      if (total > 0) {
        const { data: existing } = await supabase
          .from('certificates_issued')
          .select('workshop_registration_id')
          .eq('template_type', 'workshop')
          .in('workshop_registration_id', (regs ?? []).map(r => r.id))
        for (const e of existing ?? []) {
          if (e.workshop_registration_id) existingIds.add(e.workshop_registration_id)
        }
      }

      const wsMap = new Map(workshops.map(w => [w.id, w]))
      // Workshop standalone: ev é null. Usa metadata do próprio workshop.
      const eventDate = ev?.event_date ? String(ev.event_date) : null
      const eventName = ev?.name ?? null  // null pra standalone — UI deve mostrar workshop_nome
      const eventLocation = ev?.location ?? null

      const rows = (regs ?? [])
        .filter(r => !existingIds.has(r.id))
        .slice(0, BATCH_CAP)  // Audit T3: cap por chamada (idempotência permite repetir)
        .map(r => {
          const w = wsMap.get(r.workshop_id)!
          return {
            template_id: tpl.id,
            template_type: 'workshop' as const,
            registration_id: null,
            workshop_registration_id: r.id,
            // Workshop standalone fica com event_id NULL no certificate.
            event_id: w.event_id ?? null,
            producer_id: ownerId,
            recipient_name: r.buyer_name,
            certificate_data: {
              evento_nome: eventName,
              evento_data: eventDate,
              evento_local: eventLocation,
              workshop_nome: w.name,
              professor_nome: w.professor_name,
              modalidade: w.modalidade,
              duracao_minutos: w.duracao_minutos,
              workshop_data: w.data_inicio,
            },
          }
        })

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('certificates_issued').insert(rows)
        if (insErr) throw new Error(`Erro inserindo certificados: ${insErr.message}`)
        created = rows.length
      }
      skipped = total - created
    }

    console.log(`[emit-certificates-batch] event=${event_id} type=${template_type} total=${total} created=${created} skipped=${skipped}`)
    return json({ total, created, skipped })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[emit-certificates-batch] erro:', message)
    return json({ error: message }, 400)
  }
})
