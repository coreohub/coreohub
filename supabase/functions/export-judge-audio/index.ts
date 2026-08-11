import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import JSZip from 'https://esm.sh/jszip@3.10.1'
import { buildCorsHeaders } from '../_shared/cors.ts'

/**
 * export-judge-audio — exporta em lote todo o áudio de avaliação dos
 * jurados de um evento num .zip único, renomeado no padrão
 * "NNN - Coreografia - Estúdio - Jurado.ext" (NNN = ordem de apresentação
 * publicada, zero-pad). Versão em lote do "Ouvir áudio do jurado" que já
 * existe individualmente em ResultsPanel.tsx (Apuração).
 *
 * Áudio só sobrevive 90 dias após o evento (cleanup_old_audio_feedbacks
 * zera evaluations.audio_url depois disso) — evaluations sem audio_url
 * simplesmente não aparecem na query, sem checagem extra de data aqui.
 *
 * Entradas sem ordem_apresentacao_publicado ou nome_coreografia não têm
 * como ser nomeadas de forma identificável e ficam de fora do zip.
 *
 * Nunca confia em RLS pra ownership — decide tudo aqui com client de
 * service role (mesmo padrão de delete-event/manage-team-member).
 */

const sanitizeForFilename = (value: string): string =>
  value
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'sem-nome'

const extractExt = (url: string): string => {
  const clean = url.split('?')[0] ?? url
  const last = clean.split('.').pop() ?? 'webm'
  return /^[a-zA-Z0-9]{2,5}$/.test(last) ? last : 'webm'
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { event_id } = await req.json()
    if (!event_id) throw new Error('event_id é obrigatório')

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)

    const { data: event, error: evErr } = await admin
      .from('events')
      .select('id, name, created_by')
      .eq('id', event_id)
      .maybeSingle()
    if (evErr) throw evErr
    if (!event) {
      return new Response(JSON.stringify({ error: 'Evento não encontrado.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (event.created_by !== user.id) {
      return new Response(JSON.stringify({ error: 'Você não é o dono deste evento.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: evals, error: evalsErr } = await admin
      .from('evaluations')
      .select('id, audio_url, judge_id, registration_id')
      .eq('event_id', event_id)
      .not('audio_url', 'is', null)
    if (evalsErr) throw evalsErr

    if (!evals || evals.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum áudio disponível para exportação (retenção de 90 dias, ou nenhuma avaliação com áudio ainda).' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const regIds = Array.from(new Set(evals.map(e => e.registration_id).filter(Boolean)))
    const judgeIds = Array.from(new Set(evals.map(e => e.judge_id).filter(Boolean)))

    const [{ data: regs, error: regsErr }, { data: judgesData, error: judgesErr }] = await Promise.all([
      regIds.length > 0
        ? admin.from('registrations').select('id, nome_coreografia, estudio, ordem_apresentacao_publicado, ordem_apresentacao').in('id', regIds)
        : Promise.resolve({ data: [], error: null }),
      judgeIds.length > 0
        ? admin.from('judges').select('id, name').in('id', judgeIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (regsErr) throw regsErr
    if (judgesErr) throw judgesErr

    const regsById = new Map((regs ?? []).map(r => [r.id, r]))
    const judgesById = new Map((judgesData ?? []).map(j => [j.id, j]))

    // Monta a lista de nomeáveis primeiro (síncrono, sem I/O) — só depois
    // baixa os arquivos, em lotes paralelos. Evento grande (3 jurados × 100
    // apresentações = até 300 áudios) baixado 1-a-1 em série arrisca estourar
    // o timeout da edge function; lotes de 8 em paralelo cobrem isso sem
    // sobrecarregar o Storage.
    const toDownload: { filename: string; url: string }[] = []
    const usedNames = new Set<string>()
    for (const ev of evals) {
      const reg = regsById.get(ev.registration_id)
      // ordem_apresentacao_publicado só existe depois que o produtor clica
      // "Publicar pros Inscritos" no Cronograma — isso é sobre visibilidade
      // PÚBLICA da ordem, uma decisão independente de exportar áudio pra uso
      // interno (produtor/coordenador do júri revisando avaliação antes
      // mesmo de publicar nada). Cai pro rascunho (ordem_apresentacao) nesse
      // caso — evento real com áudio de teste/avaliação já feita mas
      // cronograma ainda não publicado não pode ficar sem exportação.
      const ordemNum = reg?.ordem_apresentacao_publicado ?? reg?.ordem_apresentacao
      if (!reg || ordemNum == null || !reg.nome_coreografia) continue
      if (!ev.audio_url) continue

      const judgeName = judgesById.get(ev.judge_id)?.name || 'Jurado'
      const ordem = String(ordemNum).padStart(3, '0')
      const ext = extractExt(ev.audio_url)
      let filename = `${ordem} - ${sanitizeForFilename(reg.nome_coreografia)} - ${sanitizeForFilename(reg.estudio || 'Sem Estudio')} - ${sanitizeForFilename(judgeName)}.${ext}`

      if (usedNames.has(filename)) {
        filename = `${ordem} - ${sanitizeForFilename(reg.nome_coreografia)} - ${sanitizeForFilename(reg.estudio || 'Sem Estudio')} - ${sanitizeForFilename(judgeName)} (${ev.id.slice(0, 6)}).${ext}`
      }
      usedNames.add(filename)
      toDownload.push({ filename, url: ev.audio_url })
    }

    const zip = new JSZip()
    let included = 0
    const CONCURRENCY = 8
    for (let i = 0; i < toDownload.length; i += CONCURRENCY) {
      const batch = toDownload.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(async item => {
        try {
          const res = await fetch(item.url)
          if (!res.ok) {
            console.error(`[export-judge-audio] falhou baixar ${item.url}: ${res.status}`)
            return null
          }
          return { filename: item.filename, buf: await res.arrayBuffer() }
        } catch (fetchErr) {
          console.error(`[export-judge-audio] erro de rede em ${item.url}:`, fetchErr)
          return null
        }
      }))
      for (const r of results) {
        if (!r) continue
        zip.file(r.filename, r.buf)
        included++
      }
    }

    if (included === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum áudio pôde ser incluído (dados de coreografia/ordem ausentes, ou falha ao baixar os arquivos).' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })

    const eventSlug = sanitizeForFilename(event.name || 'evento').replace(/\s+/g, '-')
    const zipFilename = `audios-juri-${eventSlug}.zip`

    return new Response(zipBytes, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        // Sem isso, o header vai na resposta mas o browser não deixa o JS
        // do frontend (origem diferente: app.coreohub.com → *.supabase.co)
        // lê-lo via res.headers.get() — Content-Disposition não está na
        // CORS-safelist default. O download sempre cairia no filename
        // genérico do fallback do frontend.
        'Access-Control-Expose-Headers': 'Content-Disposition',
      },
    })
  } catch (error: any) {
    console.error('[export-judge-audio] erro:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
