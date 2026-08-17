import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { HttpReader, ZipWriter } from 'jsr:@zip-js/zip-js'
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
 *
 * STREAMING (2026-08-17): eventos com banca de 3+ jurados avaliando
 * ~100+ apresentações facilmente passam de 250-300MB de áudio bruto
 * (cada arquivo webm ~2MB). A versão anterior baixava tudo em paralelo
 * pra buffers em memória antes de gerar o zip com JSZip de uma vez —
 * estourava o limite de memória da edge function e o worker morria
 * antes do catch rodar, devolvendo resposta não-JSON (o frontend caía
 * no fallback genérico "Erro ao exportar áudios", escondendo a causa
 * real). Fix real: zip.js com HttpReader escreve cada entrada direto no
 * stream de saída, sem nunca reter o arquivo inteiro em memória — pico
 * de RAM fica limitado a poucos MB por vez, não à soma de tudo.
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

    // Monta a lista de nomeáveis (síncrono, sem I/O) — download real só
    // acontece depois, entrada por entrada, direto pro stream de saída.
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

    if (toDownload.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum áudio pôde ser incluído (dados de coreografia/ordem ausentes).' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Content-Disposition é header HTTP — precisa ser ASCII puro (RFC 7230),
    // diferente dos nomes DENTRO do zip (zip.js grava UTF-8 nativamente, "ç"/
    // "°" funcionam ali sem problema). "19° Festival Ecodança" com acento
    // cru no header fazia o Content-Disposition inteiro ser descartado sem
    // erro visível — filename sempre caía no fallback genérico do frontend.
    // Mesmo padrão de normalização já usado em exportJudgeSchedulePDF
    // (JudgesManagement.tsx) pro PDF do Cronograma de Jurados.
    const eventSlug = (event.name || 'evento')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
    const zipFilename = `audios-juri-${eventSlug || 'evento'}.zip`

    // Streaming real: cada entrada é baixada e escrita direto no stream de
    // saída via HttpReader, uma de cada vez — nunca mantém o arquivo
    // inteiro em memória. Roda em background (não awaited aqui) enquanto a
    // Response já começa a fluir pro cliente.
    // bufferedWrite fica no default (false) de propósito — só existe pra
    // suportar escrita PARALELA de várias entradas, e aqui elas são
    // adicionadas uma de cada vez (await sequencial), então o próprio
    // zip.js já não precisa reter cada arquivo inteiro em buffer.
    const { readable, writable } = new TransformStream<Uint8Array>()
    const zipWriter = new ZipWriter(writable)

    ;(async () => {
      let included = 0
      for (const item of toDownload) {
        try {
          // level: 0 = STORE (sem recompressão) — áudio webm/opus já vem
          // comprimido, então deflate só custaria CPU sem ganho real de
          // tamanho.
          await zipWriter.add(item.filename, new HttpReader(item.url), { level: 0 })
          included++
        } catch (fileErr) {
          console.error(`[export-judge-audio] falhou incluir ${item.filename}:`, (fileErr as Error)?.message ?? fileErr)
        }
      }
      console.log(`[export-judge-audio] zip finalizado: ${included}/${toDownload.length} áudios incluídos`)
      try {
        await zipWriter.close()
      } catch (closeErr) {
        console.error('[export-judge-audio] erro ao fechar zip:', (closeErr as Error)?.message ?? closeErr)
      }
    })()

    return new Response(readable, {
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
