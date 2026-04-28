import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const schema = {
  responseMimeType: 'application/json',
  responseSchema: {
    type: 'object',
    properties: {
      summary:                    { type: 'string' },
      event_name:                 { type: 'string' },
      address:                    { type: 'string' },
      start_date:                 { type: 'string' },
      registration_deadline:      { type: 'string' },
      track_submission_deadline:  { type: 'string' },
      video_submission_deadline:  { type: 'string' },
      event_format:               { type: 'string', enum: ['RANKING', 'PEDAGOGICAL', 'GRADUATED'] },
      score_scale:                { type: 'number' },
      inactivity_block_enabled:   { type: 'boolean' },
      age_reference:              { type: 'string', enum: ['EVENT_DAY', 'YEAR_END', 'FIXED_DATE'] },
      age_tolerance_mode:         { type: 'string', enum: ['PERCENT', 'FIXED_COUNT'] },
      age_tolerance_value:        { type: 'number' },
      stage_entry_time_seconds:   { type: 'number' },
      stage_marking_time_seconds: { type: 'number' },
      tiebreaker_rules:           { type: 'string' },
      registration_lots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label:    { type: 'string' },
            deadline: { type: 'string' },
            price:    { type: 'number' },
          },
          required: ['label', 'deadline', 'price'],
        },
      },
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:    { type: 'string' },
            min_age: { type: 'number' },
            max_age: { type: 'number' },
          },
          required: ['name', 'min_age', 'max_age'],
        },
      },
      formacoes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:     { type: 'string' },
            max_time: { type: 'string' },
            fee:      { type: 'number' },
            format:   { type: 'string', enum: ['RANKING', 'PEDAGOGICAL', 'GRADUATED'] },
          },
          required: ['name', 'max_time', 'fee', 'format'],
        },
      },
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:        { type: 'string' },
            weight:      { type: 'number' },
            description: { type: 'string' },
          },
          required: ['name', 'weight', 'description'],
        },
      },
      prizes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:        { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name', 'description'],
        },
      },
    },
    required: ['summary', 'formacoes', 'categories', 'criteria'],
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Require authenticated user
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { text, pdf_base64 } = await req.json()
    if (!text && !pdf_base64) throw new Error('text ou pdf_base64 é obrigatório')

    const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
    if (!apiKey) throw new Error('GEMINI_API_KEY não configurado no servidor')

    const { GoogleGenAI } = await import('npm:@google/genai')
    const ai = new GoogleGenAI({ apiKey })

    let response: any

    if (pdf_base64) {
      response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: {
          parts: [
            {
              text: `Você é um especialista em regulamentos de festivais de dança brasileiros.
Analise este regulamento em PDF e extraia TODOS os dados estruturados.
Para campos não encontrados, retorne null (nunca invente valores).
Datas em formato ISO 8601 (YYYY-MM-DD). Tempos no formato MM:SS.`,
            },
            { inlineData: { mimeType: 'application/pdf', data: pdf_base64 } },
          ],
        } as any,
        config: schema,
      })
    } else {
      response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: `Você é um especialista em regulamentos de festivais de dança brasileiros.
Analise o regulamento abaixo e extraia TODOS os dados estruturados.
Para campos não encontrados no regulamento, retorne null (nunca invente valores).
Datas devem estar no formato ISO 8601 (YYYY-MM-DD) quando possível.
Tempos de apresentação no formato MM:SS.

REGULAMENTO:
${text}`,
        config: schema,
      })
    }

    const result = JSON.parse(response.text ?? '{}')
    console.log(`[gemini-analysis] ok user=${user.id} formacoes=${result.formacoes?.length ?? 0}`)

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('[gemini-analysis] erro:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
