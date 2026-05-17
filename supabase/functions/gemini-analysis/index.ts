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
            // Subcategorias por faixa etária (ex: "Infantil 5-7, Infantil 8-10")
            // — extraídas quando o regulamento divide uma categoria mestre
            // em sub-faixas. Cada item entra na tabela `subcategories`
            // ligada à categoria pai via FK.
            sub_categories: {
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
      // Gêneros estruturados (modalidade->gênero). Quando o regulamento
      // diz "Jazz: Solo, Duo, Trio, Grupo; Ballet: Solo, Duo", cada item
      // aqui captura o gênero + as modalidades específicas que ele aceita.
      // Vai popular a tabela event_styles com sub_types JSONB. `genres`
      // legacy fica como fallback pra retrocompatibilidade.
      event_styles_structured: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            sub_types: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
                required: ['name'],
              },
            },
          },
          required: ['name'],
        },
      },
      // Política de reembolso/cancelamento textual. Regulamento sempre
      // menciona algo como "cancelamentos até X dias antes têm direito a
      // Y%, após isso não há reembolso". Salva em events.video_fee_refund_policy.
      refund_policy: { type: 'string' },
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
═══ GLOSSÁRIO E DESAMBIGUAÇÃO (CRÍTICO) ═══════════════════════════════════
O mercado BR de festivais de dança NÃO tem consenso de nomenclatura. Cada regulamento usa termos diferentes pros mesmos conceitos. Use o conteúdo (não o nome) pra mapear corretamente:

→ GÊNERO (= "Estilo", "Modalidade de Dança", "Tipo de Dança", "Linguagem" [editais públicos], "Vertente", "Eixo Estético", "Ritmo"):
   tipos de dança. Ex: Ballet Clássico, Jazz, Hip Hop, Contemporâneo, Sapateado, Danças Urbanas, Dança Popular Brasileira, K-Pop.
   → preencha em 'genres' (array de strings) E em 'event_styles_structured' (com sub_types).

→ MODALIDADE (= "Formação", "Composição", "Categoria de Composição", "Tipo de Coreografia", "Formato Coreográfico", "Tipo de Apresentação"; em JOINVILLE é chamada de "SUBGÊNERO"!):
   formato por número de bailarinos. Ex: Solo, Duo, Trio, Quarteto, Quinteto, Sexteto, Conjunto/Grupo. Específicos de ballet: Variação, Pas de Deux, Grand Pas de Deux.
   → preencha em 'formacoes' (com name, max_time, fee, format).
   → REGRA DE DESAMBIGUAÇÃO: se um item tem nº de pessoas implícito (1 pessoa, 2 pessoas, 4+) e/ou tempo máximo de palco e/ou taxa de inscrição → é MODALIDADE (formacoes), mesmo se o regulamento chamar de "Subgênero".

→ SUBMODALIDADE / SUB-FORMAÇÃO (também SEM consenso de nomenclatura — alguns regulamentos chamam de "Variação", "Sub-composição", "Tipo de Solo", "Especialidade"):
   subdivisão dentro de uma modalidade. Ex dentro de Solo: "Solo Variação Clássica", "Solo Variação Livre", "Solo Repertório", "Solo Improvisação". Dentro de Duo: "Pas de Deux Clássico", "Duo Livre".
   → DESDOBRE em formacoes INDIVIDUAIS (cada submodalidade vira um item em 'formacoes'). Nosso schema é flat — não há campo "sub_modalities".
   → Ex: regulamento diz "Solo: Variação Clássica (R$80, 3min) ou Livre (R$60, 2min)" → gera 2 formacoes: { name: "Solo Variação Clássica", fee: 80, max_time: "03:00" } + { name: "Solo Livre", fee: 60, max_time: "02:00" }.
   → Se o regulamento usa o mesmo preço/tempo pra todas as submodalidades, ainda assim crie 1 formacao por submodalidade (preserva a distinção pro inscrito escolher na hora da inscrição).

→ CATEGORIA (= "Faixa Etária", "Divisão Etária", "Classe Etária", "Categoria Etária", "Grupo Etário", "Naipe" [raro], "Faixa-alvo"):
   subdivisão por idade. Ex: Dança Kids, Baby, Pré-Mirim, Mirim, Infantil, Infanto-Juvenil, Juvenil, Pré-Júnior, Júnior, Adulto, Sênior, Avançado, Master, 40+, Veterano.
   → preencha em 'categories[]' com name + min_age + max_age.
   → ATENÇÃO: Barueri usa "Avançado" como categoria etária (15+ anos), mas outros festivais usam "Avançado" como NÍVEL TÉCNICO (não como idade). Olhe se vem com faixa etária definida — se sim, é categoria; se vem listado junto com Iniciante/Intermediário, é nível técnico.

→ SUBGÊNERO / SUB-ESTILO (= "Sub-vertente", "Especialidade", "Linha"):
   especializações dentro do mesmo gênero. Ex: dentro de Ballet → "Clássico de Repertório", "Neoclássico"; dentro de Hip Hop → "Locking", "Popping", "Breaking", "Voguing", "House"; dentro de Jazz → "Jazz Lírico", "Jazz Comercial", "Musical Theater"; dentro de Contemporâneo → "Release", "Dança Teatro".
   → preencha em 'event_styles_structured[].sub_types'.

→ SUBCATEGORIA (= "Sub-faixa", "Sub-classe", "Subdivisão Etária", "Estrato", "Infantil A/B/C"):
   subdivisão de uma categoria etária. Ex: dentro de Infantil → "Infantil 5-7", "Infantil 8-10", "Infantil 11-13"; dentro de Juvenil → "Juvenil A (14-15)", "Juvenil B (16-17)".
   → preencha em 'categories[].sub_categories' com name + min_age + max_age.

→ NÍVEL TÉCNICO (NÃO é categoria! = "Classe Técnica", "Faixa Técnica", "Divisão Técnica", "Categoria de Nível", "Nível de Domínio", "Habilidade Técnica", "Classe A/B/C"):
   gradação por experiência/habilidade. Ex: Iniciante, Intermediário, Avançado, Profissional, Master. NÃO é faixa etária.
   → NÃO use 'categories[]' pra isso. Em vez disso, defina 'nivel_tecnico_enabled: true'. Hoje o CoreoHub não persiste os níveis como entidades separadas — só sinaliza que o festival tem essa dimensão extra.

ATENÇÃO ANTI-CONFUSÃO (palavras enganosas):
- Se o regulamento usa a palavra "Modalidade" pra listar "Ballet, Jazz, Hip Hop" — NÃO é modalidade no nosso schema. Isso é GÊNERO. Vai pra 'genres' + 'event_styles_structured'.
- Se usa "Subgênero" pra listar "Solo, Duo, Trio" — NÃO é subgênero. Isso é MODALIDADE. Vai pra 'formacoes'.
- Se usa "Categoria" pra listar "Iniciante, Intermediário, Avançado" — é nível técnico. Defina 'nivel_tecnico_enabled: true' em vez de criar 'categories[]'.
- Se usa "Variação" e o contexto é Ballet com Solo (ex: "Variação Feminina Clássica"), trata como SUBMODALIDADE — vira uma formacao própria (Solo Variação Feminina Clássica).
- Se usa "Estilo" e lista nomes de danças (Hip Hop, Jazz) — é GÊNERO. Se lista variações dentro de uma dança (Locking, Popping dentro de Hip Hop) — é SUBGÊNERO (vai em event_styles_structured[].sub_types).
- Quando estiver em dúvida, OLHE OS METADADOS: itens com preço/tempo de palco/nº de bailarinos = formacao; itens só com nome de dança = gênero; itens só com faixa etária = categoria.
═══════════════════════════════════════════════════════════════════════════

• genres: array de gêneros/estilos aceitos (apenas nomes). Ex ["Jazz", "Ballet Clássico", "Hip Hop", "Contemporâneo"]. Use nomes canônicos do mercado BR de dança.
• event_styles_structured: MESMO conteúdo de genres, mas estruturado com sub_types (subgêneros aceitos por gênero). Quando o regulamento explicita "Ballet: Clássico de Repertório, Neoclássico" ou "Hip Hop: Locking, Popping, Breaking", capture aqui. Ex [{ name: "Ballet", sub_types: [{name: "Clássico de Repertório"}, {name: "Neoclássico"}] }, { name: "Hip Hop", sub_types: [{name: "Locking"}, {name: "Popping"}] }]. Se o regulamento lista gêneros sem detalhar subgêneros, deixe sub_types como array vazio em cada item.
• categories[].sub_categories: subdivisões etárias dentro de uma categoria. Festivais comuns dividem "Infantil" em "Infantil 5-7", "Infantil 8-10", "Infantil 11-13". Quando o regulamento detalha essas subdivisões, capture em sub_categories. Se a categoria é uma faixa única (ex: "Adulto 18+"), deixe sub_categories vazio ou ausente.
• refund_policy: texto da política de cancelamento e reembolso quando o regulamento menciona. Ex "Cancelamentos até 15 dias antes do evento: reembolso de 80%. Após esse prazo: sem reembolso. Em caso de cancelamento do evento por força maior, reembolso integral em até 30 dias."
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
═══ GLOSSÁRIO E DESAMBIGUAÇÃO (CRÍTICO) ═══════════════════════════════════
O mercado BR de festivais de dança NÃO tem consenso de nomenclatura. Cada regulamento usa termos diferentes pros mesmos conceitos. Use o conteúdo (não o nome) pra mapear corretamente:

→ GÊNERO (= "Estilo", "Modalidade de Dança", "Tipo de Dança", "Linguagem" [editais públicos], "Vertente", "Eixo Estético", "Ritmo"):
   tipos de dança. Ex: Ballet Clássico, Jazz, Hip Hop, Contemporâneo, Sapateado, Danças Urbanas, Dança Popular Brasileira, K-Pop.
   → preencha em 'genres' (array de strings) E em 'event_styles_structured' (com sub_types).

→ MODALIDADE (= "Formação", "Composição", "Categoria de Composição", "Tipo de Coreografia", "Formato Coreográfico", "Tipo de Apresentação"; em JOINVILLE é chamada de "SUBGÊNERO"!):
   formato por número de bailarinos. Ex: Solo, Duo, Trio, Quarteto, Quinteto, Sexteto, Conjunto/Grupo. Específicos de ballet: Variação, Pas de Deux, Grand Pas de Deux.
   → preencha em 'formacoes' (com name, max_time, fee, format).
   → REGRA DE DESAMBIGUAÇÃO: se um item tem nº de pessoas implícito (1 pessoa, 2 pessoas, 4+) e/ou tempo máximo de palco e/ou taxa de inscrição → é MODALIDADE (formacoes), mesmo se o regulamento chamar de "Subgênero".

→ SUBMODALIDADE / SUB-FORMAÇÃO (também SEM consenso de nomenclatura — alguns regulamentos chamam de "Variação", "Sub-composição", "Tipo de Solo", "Especialidade"):
   subdivisão dentro de uma modalidade. Ex dentro de Solo: "Solo Variação Clássica", "Solo Variação Livre", "Solo Repertório", "Solo Improvisação". Dentro de Duo: "Pas de Deux Clássico", "Duo Livre".
   → DESDOBRE em formacoes INDIVIDUAIS (cada submodalidade vira um item em 'formacoes'). Nosso schema é flat — não há campo "sub_modalities".
   → Ex: regulamento diz "Solo: Variação Clássica (R$80, 3min) ou Livre (R$60, 2min)" → gera 2 formacoes: { name: "Solo Variação Clássica", fee: 80, max_time: "03:00" } + { name: "Solo Livre", fee: 60, max_time: "02:00" }.
   → Se o regulamento usa o mesmo preço/tempo pra todas as submodalidades, ainda assim crie 1 formacao por submodalidade (preserva a distinção pro inscrito escolher na hora da inscrição).

→ CATEGORIA (= "Faixa Etária", "Divisão Etária", "Classe Etária", "Categoria Etária", "Grupo Etário", "Naipe" [raro], "Faixa-alvo"):
   subdivisão por idade. Ex: Dança Kids, Baby, Pré-Mirim, Mirim, Infantil, Infanto-Juvenil, Juvenil, Pré-Júnior, Júnior, Adulto, Sênior, Avançado, Master, 40+, Veterano.
   → preencha em 'categories[]' com name + min_age + max_age.
   → ATENÇÃO: Barueri usa "Avançado" como categoria etária (15+ anos), mas outros festivais usam "Avançado" como NÍVEL TÉCNICO (não como idade). Olhe se vem com faixa etária definida — se sim, é categoria; se vem listado junto com Iniciante/Intermediário, é nível técnico.

→ SUBGÊNERO / SUB-ESTILO (= "Sub-vertente", "Especialidade", "Linha"):
   especializações dentro do mesmo gênero. Ex: dentro de Ballet → "Clássico de Repertório", "Neoclássico"; dentro de Hip Hop → "Locking", "Popping", "Breaking", "Voguing", "House"; dentro de Jazz → "Jazz Lírico", "Jazz Comercial", "Musical Theater"; dentro de Contemporâneo → "Release", "Dança Teatro".
   → preencha em 'event_styles_structured[].sub_types'.

→ SUBCATEGORIA (= "Sub-faixa", "Sub-classe", "Subdivisão Etária", "Estrato", "Infantil A/B/C"):
   subdivisão de uma categoria etária. Ex: dentro de Infantil → "Infantil 5-7", "Infantil 8-10", "Infantil 11-13"; dentro de Juvenil → "Juvenil A (14-15)", "Juvenil B (16-17)".
   → preencha em 'categories[].sub_categories' com name + min_age + max_age.

→ NÍVEL TÉCNICO (NÃO é categoria! = "Classe Técnica", "Faixa Técnica", "Divisão Técnica", "Categoria de Nível", "Nível de Domínio", "Habilidade Técnica", "Classe A/B/C"):
   gradação por experiência/habilidade. Ex: Iniciante, Intermediário, Avançado, Profissional, Master. NÃO é faixa etária.
   → NÃO use 'categories[]' pra isso. Em vez disso, defina 'nivel_tecnico_enabled: true'. Hoje o CoreoHub não persiste os níveis como entidades separadas — só sinaliza que o festival tem essa dimensão extra.

ATENÇÃO ANTI-CONFUSÃO (palavras enganosas):
- Se o regulamento usa a palavra "Modalidade" pra listar "Ballet, Jazz, Hip Hop" — NÃO é modalidade no nosso schema. Isso é GÊNERO. Vai pra 'genres' + 'event_styles_structured'.
- Se usa "Subgênero" pra listar "Solo, Duo, Trio" — NÃO é subgênero. Isso é MODALIDADE. Vai pra 'formacoes'.
- Se usa "Categoria" pra listar "Iniciante, Intermediário, Avançado" — é nível técnico. Defina 'nivel_tecnico_enabled: true' em vez de criar 'categories[]'.
- Se usa "Variação" e o contexto é Ballet com Solo (ex: "Variação Feminina Clássica"), trata como SUBMODALIDADE — vira uma formacao própria (Solo Variação Feminina Clássica).
- Se usa "Estilo" e lista nomes de danças (Hip Hop, Jazz) — é GÊNERO. Se lista variações dentro de uma dança (Locking, Popping dentro de Hip Hop) — é SUBGÊNERO (vai em event_styles_structured[].sub_types).
- Quando estiver em dúvida, OLHE OS METADADOS: itens com preço/tempo de palco/nº de bailarinos = formacao; itens só com nome de dança = gênero; itens só com faixa etária = categoria.
═══════════════════════════════════════════════════════════════════════════

• genres: array de gêneros/estilos aceitos (apenas nomes). Ex ["Jazz", "Ballet Clássico", "Hip Hop", "Contemporâneo"]. Use nomes canônicos do mercado BR de dança.
• event_styles_structured: MESMO conteúdo de genres, mas estruturado com sub_types (subgêneros aceitos por gênero). Quando o regulamento explicita "Ballet: Clássico de Repertório, Neoclássico" ou "Hip Hop: Locking, Popping, Breaking", capture aqui. Ex [{ name: "Ballet", sub_types: [{name: "Clássico de Repertório"}, {name: "Neoclássico"}] }, { name: "Hip Hop", sub_types: [{name: "Locking"}, {name: "Popping"}] }]. Se o regulamento lista gêneros sem detalhar subgêneros, deixe sub_types como array vazio em cada item.
• categories[].sub_categories: subdivisões etárias dentro de uma categoria. Festivais comuns dividem "Infantil" em "Infantil 5-7", "Infantil 8-10", "Infantil 11-13". Quando o regulamento detalha essas subdivisões, capture em sub_categories. Se a categoria é uma faixa única (ex: "Adulto 18+"), deixe sub_categories vazio ou ausente.
• refund_policy: texto da política de cancelamento e reembolso quando o regulamento menciona. Ex "Cancelamentos até 15 dias antes do evento: reembolso de 80%. Após esse prazo: sem reembolso. Em caso de cancelamento do evento por força maior, reembolso integral em até 30 dias."
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
