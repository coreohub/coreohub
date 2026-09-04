import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

/**
 * transcribe-judge-audio — transcreve em texto (PT-BR) o áudio de feedback
 * do jurado via Gemini 2.5 Flash (mesmo modelo/padrão de `gemini-analysis`,
 * que hoje só processa PDF — Gemini 2.5 Flash também aceita áudio nativo
 * via `inlineData`). Plano completo: memory/backlog_transcricao_pdf_audios_jurados.md.
 *
 * Cache: nunca retranscreve uma evaluation que já tem `audio_transcript`
 * (evita custo duplicado e serve instantâneo em chamadas repetidas).
 *
 * Gate de sigilo: só transcreve avaliação cuja registration já tem
 * `resultado_publicado = true` — mesmo princípio já usado pro nome do
 * jurado (migration 20260712_inscrito_reads_judge_name_published.sql).
 * Vale tanto pro produtor gerando o PDF em lote quanto pro inscrito pedindo
 * a transcrição da própria avaliação.
 *
 * 2 modos de chamada:
 *  - `{ evaluation_id }` — single, usado pelo inscrito em /meus-resultados
 *    (botão "Transcrever" ao lado do player de áudio) e también internamente
 *    pelo modo batch.
 *  - `{ event_id, registration_ids? }` — batch, usado pelo produtor no
 *    botão "Transcrição dos Jurados (PDF)" em JudgesManagement.tsx.
 *    `registration_ids` omitido = evento inteiro; `[id]` = 1 coreografia;
 *    `[id1, id2, ...]` = seleção múltipla. Processa até MAX_PER_CALL
 *    avaliações pendentes por chamada (evita timeout da edge function em
 *    evento grande) — o frontend chama de novo em loop até `remaining === 0`
 *    ou o limite diário ser atingido.
 *
 * Limite de custo: 30 transcrições/dia por produtor via `ai_usage_log`
 * (mesma tabela/mesmo padrão do parser de regulamento, que usa 15/dia).
 */

const DAILY_LIMIT = 30
const MAX_PER_CALL = 8

const extractExt = (url: string): string => {
  const clean = url.split('?')[0] ?? url
  const last = clean.split('.').pop() ?? 'webm'
  return /^[a-zA-Z0-9]{2,5}$/.test(last) ? last : 'webm'
}

const mimeForExt = (ext: string): string => {
  const map: Record<string, string> = {
    webm: 'audio/webm', mp3: 'audio/mp3', wav: 'audio/wav',
    ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', oga: 'audio/ogg',
  }
  return map[ext.toLowerCase()] ?? 'audio/webm'
}

// Chunk pra evitar estourar o limite de argumentos do String.fromCharCode em
// áudio grande (mesmo cuidado que export-judge-audio tem com memória, aqui
// em escala bem menor — áudio de feedback individual, não o lote inteiro).
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY não configurado no servidor' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { evaluation_id, event_id, registration_ids } = body

    if (!evaluation_id && !event_id) {
      return new Response(JSON.stringify({ error: 'evaluation_id ou event_id é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Rate limit — checado 1x por chamada (não por transcrição individual
    // dentro do batch), consumido de verdade por transcrição concluída lá
    // embaixo em transcribeOne().
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count: usedToday, error: usageErr } = await admin
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('feature', 'transcribe-judge-audio')
      .gte('created_at', since)
    if (usageErr) console.error('[transcribe-judge-audio] falha ao checar rate-limit — seguindo fail-open:', usageErr.message)
    let remainingQuota = usageErr ? DAILY_LIMIT : Math.max(0, DAILY_LIMIT - (usedToday ?? 0))

    const { GoogleGenAI } = await import('npm:@google/genai')
    const ai = new GoogleGenAI({ apiKey })

    const transcribeOne = async (evalRow: { id: string; audio_url: string }): Promise<string> => {
      const audioRes = await fetch(evalRow.audio_url)
      if (!audioRes.ok) throw new Error(`download do áudio falhou (${audioRes.status})`)
      const bytes = new Uint8Array(await audioRes.arrayBuffer())
      const base64 = bytesToBase64(bytes)
      const mimeType = mimeForExt(extractExt(evalRow.audio_url))

      const response: any = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              text: 'Transcreva literalmente, em português do Brasil, o comentário em áudio de um jurado de festival de dança avaliando uma coreografia. '
                + 'É um comentário falado, informal, curto. Não resuma, não corrija gramática, não adicione comentário seu — só a transcrição do que foi dito. '
                + 'Se o áudio estiver vazio, mudo ou incompreensível, responda exatamente: "[áudio sem fala identificável]".',
            },
            { inlineData: { mimeType, data: base64 } },
          ],
        } as any,
      })

      const transcript = (response.text ?? '').trim()
      if (!transcript) throw new Error('Gemini não retornou transcrição')

      const { error: updErr } = await admin
        .from('evaluations')
        .update({ audio_transcript: transcript, audio_transcript_generated_at: new Date().toISOString() })
        .eq('id', evalRow.id)
      if (updErr) throw updErr

      await admin.from('ai_usage_log').insert({ user_id: user.id, feature: 'transcribe-judge-audio' })
        .then(({ error }) => { if (error) console.warn('[transcribe-judge-audio] falha ao logar uso:', error.message) })

      return transcript
    }

    /* ── Modo single (evaluation_id) ── */
    if (evaluation_id) {
      const { data: evalRow, error: evalErr } = await admin
        .from('evaluations')
        .select('id, event_id, registration_id, audio_url, audio_transcript')
        .eq('id', evaluation_id)
        .maybeSingle()
      if (evalErr) throw evalErr
      if (!evalRow) {
        return new Response(JSON.stringify({ error: 'Avaliação não encontrada.' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (evalRow.audio_transcript) {
        return new Response(JSON.stringify({ transcript: evalRow.audio_transcript, cached: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!evalRow.audio_url) {
        return new Response(JSON.stringify({ error: 'Esta avaliação não tem áudio.' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const [{ data: reg }, { data: event }] = await Promise.all([
        admin.from('registrations').select('id, user_id, resultado_publicado').eq('id', evalRow.registration_id).maybeSingle(),
        admin.from('events').select('id, created_by').eq('id', evalRow.event_id).maybeSingle(),
      ])
      const isProducer = !!event && event.created_by === user.id
      const isOwnerInscrito = !!reg && reg.user_id === user.id
      if (!isProducer && !isOwnerInscrito) {
        return new Response(JSON.stringify({ error: 'Sem permissão pra transcrever esta avaliação.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!reg?.resultado_publicado) {
        return new Response(JSON.stringify({ error: 'Resultado ainda não publicado — transcrição libera só após a publicação, pra preservar o sigilo do júri.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (remainingQuota <= 0) {
        return new Response(JSON.stringify({ error: `Limite de ${DAILY_LIMIT} transcrições por dia atingido. Tente novamente amanhã.` }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const transcript = await transcribeOne({ id: evalRow.id, audio_url: evalRow.audio_url })
      return new Response(JSON.stringify({ transcript, cached: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    /* ── Modo batch (event_id [+ registration_id]) — só produtor dono ── */
    const { data: event, error: evErr } = await admin
      .from('events').select('id, name, created_by').eq('id', event_id).maybeSingle()
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

    // registration_ids (array) cobre tanto "uma coreografia" ([id]) quanto
    // "várias coreografias" ([id1, id2, ...]) — o painel de seleção múltipla
    // em JudgesManagement.tsx sempre manda array; sem o campo, processa o
    // evento inteiro (modo "todas").
    let regQuery = admin.from('registrations').select('id').eq('event_id', event_id).eq('resultado_publicado', true)
    if (Array.isArray(registration_ids) && registration_ids.length > 0) regQuery = regQuery.in('id', registration_ids)
    const { data: regs, error: regsErr } = await regQuery
    if (regsErr) throw regsErr
    const regIds = (regs ?? []).map(r => r.id)

    if (regIds.length === 0) {
      return new Response(JSON.stringify({ transcribed: 0, skipped_limit: 0, remaining: 0, total_candidates: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: pending, error: pendingErr } = await admin
      .from('evaluations')
      .select('id, audio_url')
      .eq('event_id', event_id)
      .in('registration_id', regIds)
      .not('audio_url', 'is', null)
      .is('audio_transcript', null)
    if (pendingErr) throw pendingErr

    const totalCandidates = pending?.length ?? 0
    const toProcess = (pending ?? []).slice(0, Math.min(MAX_PER_CALL, remainingQuota))

    let transcribed = 0
    let failed = 0
    for (const evalRow of toProcess) {
      try {
        await transcribeOne({ id: evalRow.id, audio_url: evalRow.audio_url as string })
        transcribed++
        remainingQuota--
      } catch (itemErr) {
        failed++
        console.error(`[transcribe-judge-audio] falhou evaluation ${evalRow.id}:`, (itemErr as Error)?.message ?? itemErr)
      }
    }

    const limitReached = remainingQuota <= 0 && totalCandidates > transcribed + failed

    // Rede de segurança de custo (decisão do produtor, ver
    // memory/backlog_transcricao_pdf_audios_jurados.md): quando o limite
    // diário é batido de verdade, avisa o(s) super admin(s) via inbox
    // in-app já existente (mesmo sino que todo mundo usa) — sem UI nova,
    // sem e-mail. Best-effort: falha aqui nunca derruba a resposta pro
    // produtor, que já tem o retorno de limit_reached pra mostrar o aviso
    // dele na hora (com contato de suporte).
    if (limitReached) {
      try {
        const { data: admins } = await admin.from('profiles').select('id').eq('is_super_admin', true)
        if (admins && admins.length > 0) {
          const rows = admins.map((a: any) => ({
            user_id: a.id,
            event_id,
            type: 'ai_usage_limit_reached',
            severity: 'warning',
            title: 'Limite diário de transcrição atingido',
            body: `Um produtor bateu o limite de ${DAILY_LIMIT} transcrições de áudio/dia no evento "${event.name ?? event_id}".`,
            metadata: { producer_id: user.id, event_id, feature: 'transcribe-judge-audio' },
          }))
          const { error: notifErr } = await admin.from('notifications').insert(rows)
          if (notifErr) console.warn('[transcribe-judge-audio] falha ao notificar admin:', notifErr.message)
        }
      } catch (notifEx) {
        console.warn('[transcribe-judge-audio] falha ao notificar admin:', (notifEx as Error)?.message ?? notifEx)
      }
    }

    return new Response(JSON.stringify({
      transcribed,
      failed,
      remaining: Math.max(0, totalCandidates - transcribed - failed),
      total_candidates: totalCandidates,
      limit_reached: limitReached,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('[transcribe-judge-audio] erro:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
