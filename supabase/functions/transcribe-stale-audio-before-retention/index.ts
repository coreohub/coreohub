import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * transcribe-stale-audio-before-retention — rede de segurança da retenção
 * de 90 dias (ver 20260810_audio_retention_90_dias.sql, que zera
 * evaluations.audio_url 90 dias após o evento). Sem isso, qualquer
 * comentário em áudio de jurado que o produtor nunca pediu pra transcrever
 * manualmente se perderia pra sempre — inclusive o texto, não só o áudio.
 *
 * Roda diário via cron (service_role only), varre avaliações PUBLICADAS
 * com áudio ainda sem transcrição cujo evento está entre 80 e 90 dias de
 * `start_date` — janela de 10 dias antes da anonimização, processando até
 * MAX_PER_RUN por execução (cron diário cobre a janela inteira mesmo em
 * evento com muitas avaliações). Fora dessa janela não faz nada — não é
 * pra substituir a transcrição sob demanda (produtor/inscrito), só evitar
 * perda permanente de quem nunca pediu.
 *
 * Custo é atribuído ao produtor dono do evento em ai_usage_log (mesmo
 * contador usado pela transcrição sob demanda) — mantém 1 fonte de
 * verdade de custo por produtor, mesmo quando disparado pelo cron.
 */

const MAX_PER_RUN = 25

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
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

Deno.serve(async (req) => {
  // Gate: mesmo padrão de daily-release-funds — decode do JWT (robusto a
  // rotação da service_role key), nunca comparação de string crua.
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let jwtRole = ''
  try {
    const [, payloadB64] = token.split('.')
    if (payloadB64) {
      const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
      jwtRole = String(JSON.parse(atob(padded))?.role ?? '')
    }
  } catch { /* JWT malformado — cai no 401 abaixo */ }
  if (jwtRole !== 'service_role') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  if (!apiKey) {
    console.error('[transcribe-stale-audio-before-retention] GEMINI_API_KEY não configurado')
    return new Response(JSON.stringify({ ok: false, reason: 'misconfigured' }), { status: 500 })
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey)

  try {
    const now = new Date()
    const windowStart = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString()
    const windowEnd = new Date(now.getTime() - 80 * 24 * 3600 * 1000).toISOString()

    const { data: candidateRegs, error: regsErr } = await admin
      .from('registrations')
      .select('id, event_id, events!inner(id, start_date, created_by)')
      .eq('resultado_publicado', true)
      .gte('events.start_date', windowStart)
      .lt('events.start_date', windowEnd)
    if (regsErr) throw regsErr
    if (!candidateRegs || candidateRegs.length === 0) {
      return new Response(JSON.stringify({ transcribed: 0, total_candidates: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    const regIds = candidateRegs.map((r: any) => r.id)
    const ownerByRegId = new Map(candidateRegs.map((r: any) => [r.id, r.events?.created_by]))

    const { data: pending, error: pendingErr } = await admin
      .from('evaluations')
      .select('id, audio_url, registration_id')
      .in('registration_id', regIds)
      .not('audio_url', 'is', null)
      .is('audio_transcript', null)
      .limit(MAX_PER_RUN)
    if (pendingErr) throw pendingErr

    const totalCandidates = pending?.length ?? 0
    if (totalCandidates === 0) {
      return new Response(JSON.stringify({ transcribed: 0, total_candidates: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    const { GoogleGenAI } = await import('npm:@google/genai')
    const ai = new GoogleGenAI({ apiKey })

    let transcribed = 0
    let failed = 0
    for (const evalRow of pending!) {
      try {
        const audioRes = await fetch(evalRow.audio_url as string)
        if (!audioRes.ok) throw new Error(`download falhou (${audioRes.status})`)
        const bytes = new Uint8Array(await audioRes.arrayBuffer())
        const base64 = bytesToBase64(bytes)
        const mimeType = mimeForExt(extractExt(evalRow.audio_url as string))

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

        const ownerId = ownerByRegId.get(evalRow.registration_id)
        if (ownerId) {
          await admin.from('ai_usage_log').insert({ user_id: ownerId, feature: 'transcribe-judge-audio' })
            .then(({ error }) => { if (error) console.warn('[transcribe-stale-audio-before-retention] falha ao logar uso:', error.message) })
        }
        transcribed++
      } catch (itemErr) {
        failed++
        console.error(`[transcribe-stale-audio-before-retention] falhou evaluation ${evalRow.id}:`, (itemErr as Error)?.message ?? itemErr)
      }
    }

    console.log(`[transcribe-stale-audio-before-retention] ${transcribed}/${totalCandidates} transcritas (${failed} falharam)`)
    return new Response(JSON.stringify({ transcribed, failed, total_candidates: totalCandidates }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('[transcribe-stale-audio-before-retention] erro:', e.message)
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
})
