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
      // ── Item #34 do backlog (extensão pós-Workshops/Tier 2): ───────────
      audience_tickets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nome:  { type: 'string' },
            preco: { type: 'number' },
            kind:  { type: 'string', enum: ['inteira', 'meia', 'solidaria', 'cortesia', 'outro'] },
            obs:   { type: 'string' },
          },
          required: ['nome', 'preco', 'kind'],
        },
      },
      workshops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nome:             { type: 'string' },
            professor_nome:   { type: 'string' },
            modalidade:       { type: 'string' },
            nivel:            { type: 'string', enum: ['iniciante', 'intermediario', 'avancado', 'todos'] },
            duracao_minutos:  { type: 'number' },
            preco_padrao:     { type: 'number' },
            capacidade_max:   { type: 'number' },
            data_inicio:      { type: 'string' },
            local:            { type: 'string' },
          },
          required: ['nome'],
        },
      },
      programacao: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hora:      { type: 'string' },
            atividade: { type: 'string' },
            data:      { type: 'string' },
          },
          required: ['hora', 'atividade'],
        },
      },
      sponsors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nome: { type: 'string' },
            tipo: { type: 'string', enum: ['PATROCINADOR', 'APOIO', 'REALIZACAO', 'PRODUCAO'] },
          },
          required: ['nome'],
        },
      },
      meia_entrada_policy: { type: 'string' },
      // ── Auditoria 2026-05-12: campos faltantes apontados pelo produtor ──
      city: { type: 'string' },
      state: { type: 'string' },
      event_time: { type: 'string' },
      tipos_apresentacao: {
        type: 'array',
        items: { type: 'string', enum: ['MOSTRA_AVALIADA', 'COMPETITIVA', 'NAO_COMPETITIVA', 'PARTICIPATIVA'] },
      },
      premiation_system: { type: 'string', enum: ['THRESHOLD', 'RANKING'] },
      medal_thresholds: {
        type: 'object',
        properties: {
          gold:   { type: 'number' },
          silver: { type: 'number' },
          bronze: { type: 'number' },
        },
      },
      politica_ingressos: { type: 'string', enum: ['NAO_DEFINIDO', 'GRATUITO', 'INTERNO', 'EXTERNO'] },
      url_ingressos: { type: 'string' },
      genres: {
        type: 'array',
        items: { type: 'string' },
      },
      aceita_danca_inclusiva: { type: 'boolean' },
      nivel_tecnico_enabled: { type: 'boolean' },
      stage_safety_interval_seconds: { type: 'number' },
      social_links: {
        type: 'object',
        properties: {
          instagram: { type: 'string' },
          tiktok:    { type: 'string' },
          youtube:   { type: 'string' },
          whatsapp:  { type: 'string' },
          website:   { type: 'string' },
          email:     { type: 'string' },
        },
      },
      cover_url_hint: { type: 'string' },
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
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              text: `Você é um especialista em regulamentos de festivais de dança brasileiros.
O documento pode ser um REGULAMENTO PRIVADO (festival particular) ou um EDITAL público de chamamento (prefeitura, governo, fundação cultural — ex: JOMI, Bolsa Cultura, Mostras Municipais).
Em ambos os casos, extraia os dados operacionais do festival.

EXTRAIA TAMBÉM (campos novos):
• audience_tickets: tipos de ingresso pra plateia. Ex "Inteira R$30", "Meia R$15 (estudante, idoso)", "Solidária R$20 + 1kg alimento". kind = inteira | meia | solidaria | cortesia | outro.
• workshops: aulas/oficinas com professor convidado. Capture nome do workshop, professor, modalidade (Jazz/Hip Hop/etc), nível, duração em MINUTOS, preço, capacidade, data e local.
• programacao: cronograma do dia (horários e atividades). Ex { hora: "08:00", atividade: "Credenciamento" }.
• sponsors: patrocinadores e apoiadores. tipo = PATROCINADOR | APOIO | REALIZACAO | PRODUCAO.
• meia_entrada_policy: descrição textual da política de meia-entrada se específica do festival (criança até X, prof. de dança grátis, etc — diferente de "Lei 12.933 padrão").
• city + state: separe a cidade e a UF (2 letras maiúsculas) do address quando possível. Ex address="Votuporanga, SP" → city="Votuporanga", state="SP".
• event_time: horário de início do evento no formato "HH:MM". Ex "Abertura às 8h" → "08:00".
• tipos_apresentacao: array dos formatos de mostra oferecidos. MOSTRA_AVALIADA (recebe nota/feedback), COMPETITIVA (com ranking + premiação), NAO_COMPETITIVA (só exibição), PARTICIPATIVA (workshops/coletivos). Pode ter mais de um.
• premiation_system: como define vencedores. THRESHOLD = vários ganhadores por faixa de nota (Ouro≥X, Prata≥Y, Bronze≥Z, abaixo=Participação). RANKING = só 1º/2º/3º lugar pela maior nota.
• medal_thresholds: { gold, silver, bronze } com nota mínima de cada medalha (escala 0-10 OU 0-100, mesma do score_scale). Só preencha se premiation_system="THRESHOLD".
• politica_ingressos: se festival cobra ingresso pra plateia? GRATUITO (entrada franca), INTERNO (CoreoHub vende), EXTERNO (link Sympla/Eventbrite externo), NAO_DEFINIDO.
• url_ingressos: link da venda externa de ingressos se politica_ingressos="EXTERNO".
• genres: array de gêneros/estilos aceitos. Ex ["Jazz", "Ballet Clássico", "Hip Hop", "Contemporâneo"]. Use nomes canônicos do mercado BR de dança.
• aceita_danca_inclusiva: festival aceita dança inclusiva / coreografias com bailarinos PCD? boolean.
• nivel_tecnico_enabled: festival tem eixo técnico (Iniciante/Intermediário/Avançado) além de categoria por idade? boolean.
• stage_safety_interval_seconds: intervalo de segurança entre apresentações em SEGUNDOS. Ex "intervalo de 30s entre coreografias" → 30.
• social_links: { instagram, tiktok, youtube, whatsapp, website, email } do festival/produtora se mencionados. Instagram/TikTok sem o "@". WhatsApp como número com DDI ("+5517..."). Email completo.
• cover_url_hint: URL de imagem de divulgação/banner/logo do festival SE ENCONTRADO no documento.

IGNORE: preâmbulo legal, justificativa, base legal (lei nº, decreto), declarações exigidas, anexos administrativos, formulários em branco, contrato modelo, cronograma de execução fiscal.
Para campos não encontrados, retorne null (nunca invente valores). Arrays vazios são preferíveis a inventar items.
Datas em formato ISO 8601 (YYYY-MM-DD ou YYYY-MM-DDTHH:MM). Tempos de apresentação no formato MM:SS.`,
            },
            { inlineData: { mimeType: 'application/pdf', data: pdf_base64 } },
          ],
        } as any,
        config: schema,
      })
    } else {
      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Você é um especialista em regulamentos de festivais de dança brasileiros.
O texto abaixo pode ser um REGULAMENTO PRIVADO (festival particular) ou um EDITAL público de chamamento (prefeitura, governo, fundação cultural — ex: JOMI, Bolsa Cultura, Mostras Municipais).
Em ambos os casos, extraia os dados operacionais do festival.

EXTRAIA TAMBÉM (campos novos):
• audience_tickets: tipos de ingresso pra plateia. Ex "Inteira R$30", "Meia R$15 (estudante, idoso)", "Solidária R$20 + 1kg alimento". kind = inteira | meia | solidaria | cortesia | outro.
• workshops: aulas/oficinas com professor convidado. Capture nome do workshop, professor, modalidade (Jazz/Hip Hop/etc), nível, duração em MINUTOS, preço, capacidade, data e local.
• programacao: cronograma do dia (horários e atividades). Ex { hora: "08:00", atividade: "Credenciamento" }.
• sponsors: patrocinadores e apoiadores. tipo = PATROCINADOR | APOIO | REALIZACAO | PRODUCAO.
• meia_entrada_policy: descrição textual da política de meia-entrada se específica do festival (criança até X, prof. de dança grátis, etc — diferente de "Lei 12.933 padrão").
• city + state: separe a cidade e a UF (2 letras maiúsculas) do address quando possível. Ex address="Votuporanga, SP" → city="Votuporanga", state="SP".
• event_time: horário de início do evento no formato "HH:MM". Ex "Abertura às 8h" → "08:00".
• tipos_apresentacao: array dos formatos de mostra oferecidos. MOSTRA_AVALIADA (recebe nota/feedback), COMPETITIVA (com ranking + premiação), NAO_COMPETITIVA (só exibição), PARTICIPATIVA (workshops/coletivos). Pode ter mais de um.
• premiation_system: como define vencedores. THRESHOLD = vários ganhadores por faixa de nota (Ouro≥X, Prata≥Y, Bronze≥Z, abaixo=Participação). RANKING = só 1º/2º/3º lugar pela maior nota.
• medal_thresholds: { gold, silver, bronze } com nota mínima de cada medalha (escala 0-10 OU 0-100, mesma do score_scale). Só preencha se premiation_system="THRESHOLD".
• politica_ingressos: se festival cobra ingresso pra plateia? GRATUITO (entrada franca), INTERNO (CoreoHub vende), EXTERNO (link Sympla/Eventbrite externo), NAO_DEFINIDO.
• url_ingressos: link da venda externa de ingressos se politica_ingressos="EXTERNO".
• genres: array de gêneros/estilos aceitos. Ex ["Jazz", "Ballet Clássico", "Hip Hop", "Contemporâneo"]. Use nomes canônicos do mercado BR de dança.
• aceita_danca_inclusiva: festival aceita dança inclusiva / coreografias com bailarinos PCD? boolean.
• nivel_tecnico_enabled: festival tem eixo técnico (Iniciante/Intermediário/Avançado) além de categoria por idade? boolean.
• stage_safety_interval_seconds: intervalo de segurança entre apresentações em SEGUNDOS. Ex "intervalo de 30s entre coreografias" → 30.
• social_links: { instagram, tiktok, youtube, whatsapp, website, email } do festival/produtora se mencionados. Instagram/TikTok sem o "@". WhatsApp como número com DDI ("+5517..."). Email completo.
• cover_url_hint: URL de imagem de divulgação/banner/logo do festival SE ENCONTRADO no documento.

IGNORE: preâmbulo legal, justificativa, base legal (lei nº, decreto), declarações exigidas, anexos administrativos, formulários em branco, contrato modelo, cronograma de execução fiscal.
Para campos não encontrados, retorne null (nunca invente valores). Arrays vazios são preferíveis a inventar items.
Datas em formato ISO 8601 (YYYY-MM-DD ou YYYY-MM-DDTHH:MM). Tempos de apresentação no formato MM:SS.

DOCUMENTO:
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
