/**
 * Edge Function: generate-narration
 *
 * IA de Narração — gera audio TTS via ElevenLabs e faz upload no Supabase
 * Storage. Retorna URL pública do audio + duration estimada.
 *
 * Actions (POST JSON):
 *   { action: "generate", event_id, registration_id, text, voice_id? }
 *     -> Gera 1 audio, upload, insert/update em narration_audios
 *
 *   { action: "generate-batch", event_id, items: [{ registration_id, text }], voice_id? }
 *     -> Gera N audios em paralelo (max 5 simultaneos pra nao estourar rate limit)
 *
 *   { action: "delete", event_id, registration_id }
 *     -> Remove audio do Storage + row da tabela
 *
 * Auth:
 *   - Caller eh produtor logado (Authorization: Bearer <jwt>)
 *   - Verifica que event_id pertence ao caller (eh o created_by)
 *
 * Custos (ElevenLabs Multilingual v2):
 *   - Free tier: 10k chars/mes
 *   - Creator $22/mes: 100k chars/mes
 *   - Pro $99/mes: 500k chars/mes
 *
 * Voz default: Otto de La Luna (21m00Tcm4TlvDq8ikWAM) — locutor PT-BR épico.
 * Producer pode trocar via configuracoes.voice_id.
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

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1'
// Default voice: Otto de La Luna (épico PT-BR). Producer pode override em configuracoes.voice_id
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'
const MODEL_ID = 'eleven_multilingual_v2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')   return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')!
  const elevenKey   = Deno.env.get('ELEVENLABS_API_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500)
  if (!elevenKey) return json({ error: 'elevenlabs_not_configured', message: 'ELEVENLABS_API_KEY nao definida nos secrets do Supabase' }, 500)

  // Resolve user logado via JWT
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
  if (!action || !event_id) return json({ error: 'missing_fields' }, 400)

  // Verifica ownership do evento
  const { data: ev } = await supa
    .from('events')
    .select('id, created_by')
    .eq('id', event_id)
    .maybeSingle()

  if (!ev || ev.created_by !== user.id) {
    return json({ error: 'event_not_found_or_not_yours' }, 403)
  }

  // ─── Helper: gera audio pra 1 (registration_id, text) ────────────────────
  const generateOne = async (registration_id: string, text: string, voice_id?: string): Promise<{
    ok: boolean;
    audio_url?: string;
    duration_seconds?: number;
    error?: string;
  }> => {
    if (!text || text.trim().length === 0) return { ok: false, error: 'empty_text' }

    const voice = voice_id || DEFAULT_VOICE_ID

    try {
      // 1) Chama ElevenLabs TTS
      const ttsRes = await fetch(`${ELEVENLABS_API}/text-to-speech/${voice}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.75,
            style: 0.4,        // Estilo "épico" sutil
            use_speaker_boost: true,
          },
        }),
      })

      if (!ttsRes.ok) {
        const errText = await ttsRes.text().catch(() => '')
        return { ok: false, error: `elevenlabs_${ttsRes.status}: ${errText.slice(0, 200)}` }
      }

      const audioBuffer = new Uint8Array(await ttsRes.arrayBuffer())
      // Estimativa de duração: ElevenLabs gera ~150 chars/15s aprox
      const durationSeconds = Math.max(2, (text.length / 150) * 15)

      // 2) Upload no Storage
      const fileName = `${event_id}/${registration_id}_${Date.now()}.mp3`
      const { error: upErr } = await supa.storage
        .from('narrations')
        .upload(fileName, audioBuffer, { contentType: 'audio/mpeg', upsert: true })

      if (upErr) return { ok: false, error: `storage: ${upErr.message}` }

      const { data: pub } = supa.storage.from('narrations').getPublicUrl(fileName)
      const audio_url = pub.publicUrl

      // 3) Upsert em narration_audios (deleta antigo se existir)
      await supa
        .from('narration_audios')
        .delete()
        .eq('event_id', event_id)
        .eq('registration_id', registration_id)

      const { error: insErr } = await supa.from('narration_audios').insert([{
        event_id,
        registration_id,
        audio_url,
        voice_id: voice,
        text_used: text.trim(),
        duration_seconds: durationSeconds,
        created_by: user.id,
      }])

      if (insErr) return { ok: false, error: `db: ${insErr.message}` }

      return { ok: true, audio_url, duration_seconds: durationSeconds }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'unknown' }
    }
  }

  // ─── action: generate (1 audio) ───────────────────────────────────────
  if (action === 'generate') {
    const { registration_id, text, voice_id } = body
    if (!registration_id || !text) return json({ error: 'missing_fields' }, 400)
    const result = await generateOne(registration_id, text, voice_id)
    return json(result, result.ok ? 200 : 500)
  }

  // ─── action: generate-batch (N audios em paralelo) ────────────────────
  if (action === 'generate-batch') {
    const { items, voice_id } = body
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: 'no_items' }, 400)
    }

    // Pool de 5 simultaneos pra nao estourar rate limit ElevenLabs
    const POOL_SIZE = 5
    const results: any[] = []
    for (let i = 0; i < items.length; i += POOL_SIZE) {
      const batch = items.slice(i, i + POOL_SIZE)
      const batchResults = await Promise.all(
        batch.map((item: any) =>
          generateOne(item.registration_id, item.text, voice_id)
            .then(r => ({ registration_id: item.registration_id, ...r }))
        )
      )
      results.push(...batchResults)
    }

    const okCount   = results.filter(r => r.ok).length
    const failCount = results.length - okCount

    return json({ ok: true, total: results.length, success: okCount, failed: failCount, results })
  }

  // ─── action: delete ────────────────────────────────────────────────────
  if (action === 'delete') {
    const { registration_id } = body
    if (!registration_id) return json({ error: 'missing_fields' }, 400)

    // Busca audio_url pra deletar do Storage
    const { data: row } = await supa
      .from('narration_audios')
      .select('audio_url')
      .eq('event_id', event_id)
      .eq('registration_id', registration_id)
      .maybeSingle()

    if (row?.audio_url) {
      // Extrai path do publicUrl pra dar delete no Storage
      const match = row.audio_url.match(/\/narrations\/(.+)$/)
      if (match) {
        await supa.storage.from('narrations').remove([match[1]])
      }
    }

    await supa
      .from('narration_audios')
      .delete()
      .eq('event_id', event_id)
      .eq('registration_id', registration_id)

    return json({ ok: true })
  }

  return json({ error: 'unknown_action' }, 400)
})
