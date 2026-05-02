// One-shot: gera os 6 WAVs de sample de voz e sobe em narrations/_samples/.
// Roda: node scripts/seed-voice-samples.mjs
// Requer: GEMINI_API_KEY no env, e SERVICE_ROLE_KEY como argumento (ou env).
//
// Uso:
//   GEMINI_API_KEY=... SERVICE_ROLE_KEY=... node scripts/seed-voice-samples.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const GEMINI_API_KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || process.argv[2];

if (!SUPABASE_URL || !GEMINI_API_KEY || !SERVICE_ROLE_KEY) {
  console.error('Faltando variaveis: VITE_SUPABASE_URL, GEMINI_API_KEY, SERVICE_ROLE_KEY');
  process.exit(1);
}

const VOICES = ['Charon', 'Puck', 'Fenrir', 'Kore', 'Leda', 'Aoede'];
const SAMPLE_TEXT =
  "Com a coreografia 'Reflexos da Alma', recebam no palco: Studio Movimento.";
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

const pcmToWav = (pcm) => {
  const dataLength = pcm.length;
  const buf = Buffer.alloc(44 + dataLength);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE((SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8, 28);
  buf.writeUInt16LE((CHANNELS * BITS_PER_SAMPLE) / 8, 32);
  buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLength, 40);
  pcm.copy(buf, 44);
  return buf;
};

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const generated = {};
const failed = {};

for (const voice of VOICES) {
  process.stdout.write(`Gerando ${voice}... `);
  try {
    const ttsRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: SAMPLE_TEXT }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      failed[voice] = `gemini_${ttsRes.status}`;
      console.log('FAIL', failed[voice]);
      continue;
    }

    const result = await ttsRes.json();
    const base64 = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64) {
      failed[voice] = 'no_audio';
      console.log('FAIL no_audio');
      continue;
    }

    const pcm = Buffer.from(base64, 'base64');
    const wav = pcmToWav(pcm);
    const fileName = `_samples/${voice.toLowerCase()}.wav`;

    const { error } = await supa.storage
      .from('narrations')
      .upload(fileName, wav, { contentType: 'audio/wav', upsert: true });

    if (error) {
      failed[voice] = `storage: ${error.message}`;
      console.log('FAIL', failed[voice]);
      continue;
    }

    const { data: pub } = supa.storage.from('narrations').getPublicUrl(fileName);
    generated[voice] = pub.publicUrl;
    console.log('OK', `${(wav.length / 1024).toFixed(1)} KB`);
  } catch (e) {
    failed[voice] = e?.message ?? 'unknown';
    console.log('FAIL', failed[voice]);
  }
}

console.log('\n=== Gerados ===');
console.log(generated);
if (Object.keys(failed).length) {
  console.log('\n=== Falhados ===');
  console.log(failed);
  process.exit(1);
}
