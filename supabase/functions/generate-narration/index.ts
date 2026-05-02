/**
 * Edge Function: generate-narration
 *
 * IA de Narração — gera audio TTS via Gemini 2.5 Flash Audio e faz upload no
 * Supabase Storage. Retorna URL pública do audio + duration estimada.
 *
 * Migrou de ElevenLabs pra Gemini 2.5 (2026-05-04):
 * - Free tier generoso (1M tokens/dia AI Studio)
 * - PT-BR nativo, multi-speaker, 24 línguas
 * - Custo pago: $0.30/1M chars (vs $50-330 ElevenLabs)
 * - Reutiliza GEMINI_API_KEY ja configurado pro parser de regulamento
 *
 * Voices disponiveis (Gemini prebuilt):
 *   - Charon — masculina grave, locutor (DEFAULT — apresentador de palco)
 *   - Kore — feminina firme
 *   - Puck — masculina jovem energetica
 *   - Fenrir — masculina excitada
 *   - Leda — feminina calma
 *   - Aoede — feminina musical
 *
 * Narração tem 2 tipos (kind):
 *   - 'entrada' (default): longa (10-25s), ficha tecnica completa
 *   - 'saida'           : curta (3-8s), agradecimento/transicao
 *
 * Actions (POST JSON):
 *   { action: "generate", event_id, registration_id, text, voice_id?, kind? }
 *   { action: "generate-batch", event_id, items, voice_id? }
 *     items: [{ registration_id, text, kind? }]
 *   { action: "delete", event_id, registration_id, kind? }
 *     kind omitido = remove ambas (entrada + saida)
 *
 * Response do Gemini eh PCM raw (audio/L16;rate=24000;codec=pcm).
 * Convertido pra WAV manualmente (header RIFF de 44 bytes + dados PCM).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'
const TTS_MODEL = 'gemini-2.5-flash-preview-tts'
const DEFAULT_VOICE = 'Charon' // locutor masculino, ideal pra apresentacao de palco
const SAMPLE_RATE = 24000
const BITS_PER_SAMPLE = 16
const CHANNELS = 1

// ─── PCM raw → WAV (browser-friendly) ────────────────────────────────────
const pcmToWav = (pcmData: Uint8Array): Uint8Array => {
  const dataLength = pcmData.length
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8, true)
  view.setUint16(32, CHANNELS * BITS_PER_SAMPLE / 8, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLength, true)

  const out = new Uint8Array(buffer)
  out.set(pcmData, 44)
  return out
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')   return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')!
  const geminiKey   = Deno.env.get('GEMINI_API_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500)
  if (!geminiKey) return json({ error: 'gemini_not_configured', message: 'GEMINI_API_KEY nao definida nos secrets do Supabase' }, 500)

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  const supa = createClient(supabaseUrl, serviceKey)
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const { action, event_id } = body ?? {}
  if (!action) return json({ error: 'missing_fields' }, 400)

  // Preview: gera audio descartavel (sem persistir, sem event_id).
  // Usado no AccountSettings pra produtor testar template+voz+pronuncia
  // antes de gerar narracoes do festival inteiro.
  if (action === 'preview') {
    const { text, voice_id, kind } = body
    if (!text || !text.trim()) return json({ error: 'empty_text' }, 400)
    const k: 'entrada' | 'saida' = kind === 'saida' ? 'saida' : 'entrada'
    const voice = voice_id || DEFAULT_VOICE
    try {
      const ttsRes = await fetch(`${GEMINI_API}/${TTS_MODEL}:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text.trim() }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      })
      if (!ttsRes.ok) {
        const errText = await ttsRes.text().catch(() => '')
        return json({ ok: false, error: `gemini_${ttsRes.status}: ${errText.slice(0, 300)}` }, 500)
      }
      const result = await ttsRes.json()
      const base64Audio = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
      if (!base64Audio) return json({ ok: false, error: 'no_audio_in_response' }, 500)

      const pcmBytes = base64ToBytes(base64Audio)
      const wavBytes = pcmToWav(pcmBytes)
      const durationSeconds = pcmBytes.length / (SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8))
      // Re-encode WAV em base64 inline pra resposta JSON
      let bin = ''
      for (let i = 0; i < wavBytes.length; i++) bin += String.fromCharCode(wavBytes[i])
      const wavBase64 = btoa(bin)
      return json({ ok: true, audio_base64: wavBase64, duration_seconds: durationSeconds, kind: k })
    } catch (e: any) {
      return json({ ok: false, error: e?.message ?? 'unknown' }, 500)
    }
  }

  if (!event_id) return json({ error: 'missing_fields' }, 400)

  const { data: ev } = await supa
    .from('events')
    .select('id, created_by')
    .eq('id', event_id)
    .maybeSingle()

  if (!ev || ev.created_by !== user.id) {
    return json({ error: 'event_not_found_or_not_yours' }, 403)
  }

  const generateOne = async (
    registration_id: string,
    text: string,
    voice_id?: string,
    kind: 'entrada' | 'saida' = 'entrada',
  ): Promise<{
    ok: boolean;
    audio_url?: string;
    duration_seconds?: number;
    kind?: 'entrada' | 'saida';
    error?: string;
  }> => {
    if (!text || text.trim().length === 0) return { ok: false, error: 'empty_text' }
    if (kind !== 'entrada' && kind !== 'saida') return { ok: false, error: 'invalid_kind' }

    const voice = voice_id || DEFAULT_VOICE

    try {
      const ttsRes = await fetch(`${GEMINI_API}/${TTS_MODEL}:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text.trim() }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice },
              },
            },
          },
        }),
      })

      if (!ttsRes.ok) {
        const errText = await ttsRes.text().catch(() => '')
        return { ok: false, error: `gemini_${ttsRes.status}: ${errText.slice(0, 300)}` }
      }

      const result = await ttsRes.json()
      const part = result?.candidates?.[0]?.content?.parts?.[0]
      const base64Audio = part?.inlineData?.data
      if (!base64Audio) {
        return { ok: false, error: 'no_audio_in_response' }
      }

      const pcmBytes = base64ToBytes(base64Audio)
      const wavBytes = pcmToWav(pcmBytes)
      // Duracao do audio = bytes / (sampleRate * channels * bytesPerSample)
      const durationSeconds = pcmBytes.length / (SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8))

      const fileName = `${event_id}/${registration_id}_${kind}_${Date.now()}.wav`
      const { error: upErr } = await supa.storage
        .from('narrations')
        .upload(fileName, wavBytes, { contentType: 'audio/wav', upsert: true })

      if (upErr) return { ok: false, error: `storage: ${upErr.message}` }

      const { data: pub } = supa.storage.from('narrations').getPublicUrl(fileName)
      const audio_url = pub.publicUrl

      await supa
        .from('narration_audios')
        .delete()
        .eq('event_id', event_id)
        .eq('registration_id', registration_id)
        .eq('kind', kind)

      const { error: insErr } = await supa.from('narration_audios').insert([{
        event_id,
        registration_id,
        kind,
        audio_url,
        voice_id: voice,
        text_used: text.trim(),
        duration_seconds: durationSeconds,
        created_by: user.id,
      }])

      if (insErr) return { ok: false, error: `db: ${insErr.message}` }

      return { ok: true, audio_url, duration_seconds: durationSeconds, kind }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'unknown' }
    }
  }

  if (action === 'generate') {
    const { registration_id, text, voice_id, kind } = body
    if (!registration_id || !text) return json({ error: 'missing_fields' }, 400)
    const result = await generateOne(registration_id, text, voice_id, kind ?? 'entrada')
    return json(result, result.ok ? 200 : 500)
  }

  if (action === 'generate-batch') {
    const { items, voice_id } = body
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: 'no_items' }, 400)
    }

    // Pool de 3 simultaneos pra respeitar rate limit do Gemini Free
    // (60 req/min — com 3 paralelos cabe folgado)
    const POOL_SIZE = 3
    const results: any[] = []
    for (let i = 0; i < items.length; i += POOL_SIZE) {
      const batch = items.slice(i, i + POOL_SIZE)
      const batchResults = await Promise.all(
        batch.map((item: any) =>
          generateOne(item.registration_id, item.text, voice_id, item.kind ?? 'entrada')
            .then(r => ({ registration_id: item.registration_id, ...r }))
        )
      )
      results.push(...batchResults)
    }

    const okCount   = results.filter(r => r.ok).length
    const failCount = results.length - okCount

    return json({ ok: true, total: results.length, success: okCount, failed: failCount, results })
  }

  if (action === 'delete') {
    const { registration_id, kind } = body
    if (!registration_id) return json({ error: 'missing_fields' }, 400)

    let q = supa
      .from('narration_audios')
      .select('audio_url, kind')
      .eq('event_id', event_id)
      .eq('registration_id', registration_id)
    if (kind) q = q.eq('kind', kind)

    const { data: rows } = await q

    for (const row of rows ?? []) {
      if (row?.audio_url) {
        const match = row.audio_url.match(/\/narrations\/(.+)$/)
        if (match) await supa.storage.from('narrations').remove([match[1]])
      }
    }

    let del = supa
      .from('narration_audios')
      .delete()
      .eq('event_id', event_id)
      .eq('registration_id', registration_id)
    if (kind) del = del.eq('kind', kind)
    await del

    return json({ ok: true })
  }

  return json({ error: 'unknown_action' }, 400)
})
