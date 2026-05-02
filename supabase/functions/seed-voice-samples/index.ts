/**
 * Edge Function: seed-voice-samples
 *
 * One-shot pra gerar 6 WAVs de sample (1 por voz Gemini prebuilt) em
 * Storage `narrations/_samples/{voice}.wav`, pra produtor pre-ouvir
 * cada voz na tela AccountSettings antes de escolher a "voz oficial"
 * do festival.
 *
 * Texto fixo do sample (escolhido pra ser representativo do uso real):
 *   "Com a coreografia 'Reflexos da Alma', recebam no palco: Studio Movimento."
 *
 * Reutiliza a logica de pcmToWav da generate-narration.
 *
 * Como rodar: chamada autenticada por super admin, 1x. Idempotente
 * (upsert no Storage). Custo: ~6 calls Gemini (free tier cobre).
 *
 * POST sem body. Retorna mapa { voice: public_url }.
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

const VOICES = ['Charon', 'Puck', 'Fenrir', 'Kore', 'Leda', 'Aoede']
const SAMPLE_TEXT =
  "Com a coreografia 'Reflexos da Alma', recebam no palco: Studio Movimento."
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'
const TTS_MODEL = 'gemini-2.5-flash-preview-tts'
const SAMPLE_RATE = 24000
const BITS_PER_SAMPLE = 16
const CHANNELS = 1

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
  view.setUint16(20, 1, true)
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8, true)
  view.setUint16(32, (CHANNELS * BITS_PER_SAMPLE) / 8, true)
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
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')!
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500)
  if (!geminiKey) return json({ error: 'gemini_not_configured' }, 500)

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  const userClient = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const supa = createClient(supabaseUrl, serviceKey)

  const generated: Record<string, string> = {}
  const failed: Record<string, string> = {}

  for (const voice of VOICES) {
    try {
      const ttsRes = await fetch(
        `${GEMINI_API}/${TTS_MODEL}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: SAMPLE_TEXT }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              },
            },
          }),
        },
      )

      if (!ttsRes.ok) {
        const errText = await ttsRes.text().catch(() => '')
        failed[voice] = `gemini_${ttsRes.status}: ${errText.slice(0, 200)}`
        continue
      }

      const result = await ttsRes.json()
      const base64Audio = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
      if (!base64Audio) {
        failed[voice] = 'no_audio_in_response'
        continue
      }

      const pcm = base64ToBytes(base64Audio)
      const wav = pcmToWav(pcm)

      const fileName = `_samples/${voice.toLowerCase()}.wav`
      const { error: upErr } = await supa.storage
        .from('narrations')
        .upload(fileName, wav, { contentType: 'audio/wav', upsert: true })

      if (upErr) {
        failed[voice] = `storage: ${upErr.message}`
        continue
      }

      const { data: pub } = supa.storage.from('narrations').getPublicUrl(fileName)
      generated[voice] = pub.publicUrl
    } catch (e: any) {
      failed[voice] = e?.message ?? 'unknown'
    }
  }

  return json({
    ok: Object.keys(failed).length === 0,
    sample_text: SAMPLE_TEXT,
    generated,
    failed,
  })
})
