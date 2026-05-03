/**
 * Edge Function: seed-demo-event
 *
 * Popula evento ficticio completo pra produtor testar features sem cadastrar
 * 50 coreografias manualmente. Padrao mercado (Trello/Notion/Stripe):
 *   - 1 evento demo ativo por produtor (regerar = delete + create)
 *   - Coexiste com eventos reais
 *   - Tag macro: [DEMO] no nome + is_demo=true no banco
 *
 * Actions:
 *   { action: "create" } — deleta demo anterior se houver, cria novo completo
 *   { action: "delete" } — remove demo do produtor (sem recriar)
 *   { action: "status" } — retorna se produtor ja tem demo + event_id
 *
 * O que cria:
 *   - 1 events (is_demo=true, nome "[DEMO] CoreoHub Festival — Demonstração")
 *   - 1 configuracoes com critérios, prêmios, formações, categorias, estilos
 *   - 50 registrations APROVADAS distribuidas em 5 estilos × 4 categorias × 4 formacoes
 *   - 20 registrations PENDENTES com vídeo submitted (pra produtor testar Seletiva)
 *   - 30 evaluations fictícias (10 coreografias × 3 jurados) pra testar Resultados
 *   - 90% pagamento CONFIRMADO, 10% PENDENTE
 *   - ~150 bailarinos com nomes BR realistas no elenco
 *   - 3 jurados (PINs 1111, 2222, 3333) com judges_pin
 *
 * Auth: produtor logado via JWT (Authorization Bearer)
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

// ─── Dados realistas brasileiros ─────────────────────────────────────────

const NOMES_FEMININOS = [
  'Sofia', 'Maria', 'Helena', 'Alice', 'Julia', 'Laura', 'Manuela', 'Beatriz',
  'Mariana', 'Clara', 'Lara', 'Lívia', 'Isabella', 'Rafaela', 'Heloísa',
  'Yasmin', 'Gabriela', 'Larissa', 'Camila', 'Bianca', 'Letícia', 'Amanda',
  'Bruna', 'Carolina', 'Daniela', 'Fernanda', 'Giovanna', 'Isadora', 'Joana',
  'Luana', 'Marina', 'Natália', 'Patrícia', 'Renata', 'Vitória', 'Akemi',
  'Emília', 'Helena', 'Olívia', 'Antonella', 'Cecília', 'Alícia', 'Pietra',
]

const NOMES_MASCULINOS = [
  'Miguel', 'Arthur', 'Davi', 'Gabriel', 'Pedro', 'Lucas', 'Matheus', 'Rafael',
  'Heitor', 'Enzo', 'Lorenzo', 'Felipe', 'Gustavo', 'Henrique', 'Murilo',
  'Théo', 'Bernardo', 'Vinicius', 'Bruno', 'Eduardo', 'Caio', 'Diego',
  'Fernando', 'Hugo', 'Leonardo', 'Marcelo', 'Otávio', 'Ricardo', 'Thiago',
  'Yuri', 'André', 'Daniel', 'Erick', 'Igor', 'João', 'Mateus',
]

const SOBRENOMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Almeida',
  'Ferreira', 'Rodrigues', 'Alves', 'Gomes', 'Martins', 'Araújo', 'Ribeiro',
  'Carvalho', 'Andrade', 'Cardoso', 'Barbosa', 'Rocha', 'Dias', 'Nunes',
  'Mendes', 'Cruz', 'Castro', 'Cavalcanti', 'Fonseca', 'Moreira', 'Tanaka',
  'Sato', 'Yamamoto',
]

const ESTUDIOS = [
  { nome: 'Estúdio Movimento', cidade: 'São Paulo', uf: 'SP' },
  { nome: 'Cia Étoile', cidade: 'Rio de Janeiro', uf: 'RJ' },
  { nome: 'Move Dance', cidade: 'Belo Horizonte', uf: 'MG' },
  { nome: 'Studio Pulse', cidade: 'Curitiba', uf: 'PR' },
  { nome: 'Espaço Brincante', cidade: 'Porto Alegre', uf: 'RS' },
  { nome: 'Academia Diamante', cidade: 'Salvador', uf: 'BA' },
  { nome: 'Coletivo Urbano', cidade: 'Recife', uf: 'PE' },
  { nome: 'Cia Nuvem', cidade: 'Florianópolis', uf: 'SC' },
  { nome: 'Studio Akemi', cidade: 'Brasília', uf: 'DF' },
  { nome: 'Black Box Dança', cidade: 'Fortaleza', uf: 'CE' },
]

interface CoreoSpec {
  nome: string
  estilo: string
}

const COREOGRAFIAS: CoreoSpec[] = [
  // Ballet (12)
  { nome: 'Lago dos Cisnes Moderno', estilo: 'Ballet Clássico' },
  { nome: 'Giselle Reimaginado', estilo: 'Ballet Clássico' },
  { nome: 'Quebra-Nozes Suite', estilo: 'Ballet Clássico' },
  { nome: 'Romeu e Julieta', estilo: 'Ballet Clássico' },
  { nome: 'O Pássaro de Fogo', estilo: 'Ballet Clássico' },
  { nome: 'Coppélia', estilo: 'Ballet Clássico' },
  { nome: 'Carmen Variations', estilo: 'Ballet Clássico' },
  { nome: 'Don Quixote Pas', estilo: 'Ballet Clássico' },
  { nome: 'Bayadère Solo', estilo: 'Ballet Clássico' },
  { nome: 'A Sagração da Primavera', estilo: 'Ballet Clássico' },
  { nome: 'Apollo', estilo: 'Ballet Clássico' },
  { nome: 'Variações Burlescas', estilo: 'Ballet Clássico' },
  // Jazz (10)
  { nome: 'All That Jazz', estilo: 'Jazz' },
  { nome: 'Chicago Vibe', estilo: 'Jazz' },
  { nome: 'Broadway Lights', estilo: 'Jazz' },
  { nome: 'Manhattan Soul', estilo: 'Jazz' },
  { nome: 'Singin\' in the Rain', estilo: 'Jazz' },
  { nome: 'Cabaret', estilo: 'Jazz' },
  { nome: 'Fosse Eyes', estilo: 'Jazz' },
  { nome: 'Putting on the Ritz', estilo: 'Jazz' },
  { nome: 'New York Soul', estilo: 'Jazz' },
  { nome: 'Jazzmen Tribute', estilo: 'Jazz' },
  // Hip Hop (10)
  { nome: 'Cypher Brasil', estilo: 'Hip Hop' },
  { nome: 'Pulse', estilo: 'Hip Hop' },
  { nome: 'Underground', estilo: 'Hip Hop' },
  { nome: '808 Beat', estilo: 'Hip Hop' },
  { nome: 'Old School Tribute', estilo: 'Hip Hop' },
  { nome: 'Boombap', estilo: 'Hip Hop' },
  { nome: 'Street Wave', estilo: 'Hip Hop' },
  { nome: 'Beat Box', estilo: 'Hip Hop' },
  { nome: 'Black Power', estilo: 'Hip Hop' },
  { nome: 'Hip Hop Roots', estilo: 'Hip Hop' },
  // Contemporâneo (8)
  { nome: 'Origem', estilo: 'Contemporâneo' },
  { nome: 'Manhã na Cidade', estilo: 'Contemporâneo' },
  { nome: 'Borboleta', estilo: 'Contemporâneo' },
  { nome: 'Limiar', estilo: 'Contemporâneo' },
  { nome: 'Memórias', estilo: 'Contemporâneo' },
  { nome: 'Vento Norte', estilo: 'Contemporâneo' },
  { nome: 'Crisálida', estilo: 'Contemporâneo' },
  { nome: 'Travessia', estilo: 'Contemporâneo' },
  // Dança Urbana (10)
  { nome: 'Ritmo da Rua', estilo: 'Dança Urbana' },
  { nome: 'Funk Soul', estilo: 'Dança Urbana' },
  { nome: 'Periferia', estilo: 'Dança Urbana' },
  { nome: 'Quebrada Soundtrack', estilo: 'Dança Urbana' },
  { nome: 'Black Show', estilo: 'Dança Urbana' },
  { nome: 'Capital Hits', estilo: 'Dança Urbana' },
  { nome: 'Trap Vida', estilo: 'Dança Urbana' },
  { nome: 'Quebrada Style', estilo: 'Dança Urbana' },
  { nome: 'Funk Rio', estilo: 'Dança Urbana' },
  { nome: 'Voltage', estilo: 'Dança Urbana' },
]

// Coreografias adicionais pra Seletiva de Vídeo (pendentes de aprovacao do produtor)
const COREOGRAFIAS_SELETIVA: CoreoSpec[] = [
  { nome: 'Caminhos do Sol',  estilo: 'Contemporâneo' },
  { nome: 'Pulsar Cósmico',   estilo: 'Hip Hop' },
  { nome: 'Aurora Boreal',    estilo: 'Ballet Clássico' },
  { nome: 'Voos Distantes',   estilo: 'Contemporâneo' },
  { nome: 'Reflexos da Alma', estilo: 'Jazz' },
  { nome: 'Trilhas Urbanas',  estilo: 'Dança Urbana' },
  { nome: 'Asas de Liberdade',estilo: 'Ballet Clássico' },
  { nome: 'Sussurros',        estilo: 'Contemporâneo' },
  { nome: 'Fragmentos',       estilo: 'Jazz' },
  { nome: 'Eclipse Total',    estilo: 'Hip Hop' },
  { nome: 'Constelação',      estilo: 'Ballet Clássico' },
  { nome: 'Pétalas ao Vento', estilo: 'Contemporâneo' },
  { nome: 'Marés Profundas',  estilo: 'Jazz' },
  { nome: 'Horizonte Aberto', estilo: 'Dança Urbana' },
  { nome: 'Lume',             estilo: 'Contemporâneo' },
  { nome: 'Eco do Tempo',     estilo: 'Ballet Clássico' },
  { nome: 'Travessia da Luz', estilo: 'Jazz' },
  { nome: 'Guardiões',        estilo: 'Hip Hop' },
  { nome: 'Beat Nação',       estilo: 'Dança Urbana' },
  { nome: 'Lua Nova',         estilo: 'Contemporâneo' },
]

// URL placeholder pro video da Seletiva (Big Buck Bunny, vídeo de teste open-source)
const DEMO_VIDEO_URL = 'https://www.youtube.com/watch?v=YE7VzlLtp-4'

// Cover do evento — Unsplash CC0 dance-related (1600x900, otimizada)
const DEMO_COVER_URL = 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=1600&q=80'

// PDF placeholder pro regulamento (small public PDF de teste)
const DEMO_REGULATION_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'

// Trilhas sonoras CC0 do Pixabay (placeholder pra testar modo SISTEMA de auto-play)
const DEMO_TRILHAS = [
  'https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3',
  'https://cdn.pixabay.com/audio/2024/02/27/audio_b647d31df3.mp3',
  'https://cdn.pixabay.com/audio/2022/03/15/audio_1718e36bf8.mp3',
  'https://cdn.pixabay.com/audio/2023/06/29/audio_af72d307ee.mp3',
  'https://cdn.pixabay.com/audio/2022/10/16/audio_3b5f4e2fff.mp3',
]

// Patrocinadores placeholder (placehold.co — mais confiavel que via.placeholder
// que tem problema de DNS/CDN intermitente)
const DEMO_PATROCINADORES = [
  { nome: 'Prefeitura Municipal',          logo_url: 'https://placehold.co/240x120/0ea5e9/ffffff/png?text=PREFEITURA',     link: 'https://exemplo.gov.br' },
  { nome: 'Secretaria de Cultura',         logo_url: 'https://placehold.co/240x120/8b5cf6/ffffff/png?text=CULTURA',        link: 'https://cultura.exemplo.gov.br' },
  { nome: 'Studio Capital — Patrocínio',   logo_url: 'https://placehold.co/240x120/ec4899/ffffff/png?text=STUDIO+CAPITAL', link: '' },
  { nome: 'CoreoHub',                      logo_url: 'https://placehold.co/240x120/ff0068/ffffff/png?text=CoreoHub',       link: 'https://coreohub.com' },
]

// Tipos de ingresso pra audiencia (politica INTERNO)
const DEMO_INGRESSOS = [
  { nome: 'Inteira',         preco: 30, obs: 'Acesso aos 2 dias de festival',           link: '' },
  { nome: 'Meia-entrada',    preco: 15, obs: 'Estudante, idoso, doador de sangue',      link: '' },
  { nome: 'Solidária',       preco: 20, obs: 'Inteira + 1kg de alimento não-perecível', link: '' },
]

// Programacao do dia (campo canonico do AccountSettings: 'atividade', nao 'titulo')
const DEMO_PROGRAMACAO = [
  { hora: '08:00', atividade: 'Abertura do credenciamento' },
  { hora: '09:00', atividade: 'Aula gratuita aberta — Workshop de Contemporâneo' },
  { hora: '12:00', atividade: 'Pausa pra almoço' },
  { hora: '14:00', atividade: 'Bloco 1 — Manhã (Solos & Duos)' },
  { hora: '17:00', atividade: 'Intervalo' },
  { hora: '17:30', atividade: 'Bloco 2 — Tarde (Trios & Grupos)' },
  { hora: '20:00', atividade: 'Premiação — medalhas + prêmios especiais' },
]

const CATEGORIAS = ['Infantil', 'Juvenil', 'Adulto', 'Profissional']
const FORMACOES = ['Solo', 'Duo', 'Trio', 'Grupo']

const JURADOS = [
  { name: 'Carlos Mendes', pin: '1111', generos: ['Jazz', 'Ballet Clássico'] },
  { name: 'Juliana Silveira', pin: '2222', generos: ['Contemporâneo', 'Ballet Clássico'] },
  { name: 'Rodrigo Souza', pin: '3333', generos: ['Hip Hop', 'Dança Urbana'] },
]

const PREMIOS_ESPECIAIS = [
  { id: 'tpl_bailarino', name: 'Melhor Bailarino(a)', enabled: true, isTemplate: true, formation: 'Solo', description: 'Para o destaque solo da noite' },
  { id: 'tpl_revelacao', name: 'Prêmio Revelação', enabled: true, isTemplate: true, formation: 'TODOS', description: 'Para a nova promessa do palco' },
  { id: 'tpl_coreografo', name: 'Melhor Coreografia', enabled: true, isTemplate: true, formation: 'TODOS', description: 'Para a obra coreográfica mais marcante' },
  { id: 'tpl_grupo', name: 'Melhor Grupo da Noite', enabled: true, isTemplate: true, formation: 'Grupo', description: 'Para o grupo de maior impacto' },
  { id: 'tpl_figurino', name: 'Melhor Figurino', enabled: true, isTemplate: false, formation: 'TODOS', description: 'Para a melhor produção visual' },
]

const CRITERIOS_PADRAO = [
  { name: 'Técnica',      peso: 5, descricao: 'Domínio técnico, postura, equilíbrio, alinhamento' },
  { name: 'Performance',  peso: 5, descricao: 'Energia, expressão e presença de palco' },
  { name: 'Musicalidade', peso: 5, descricao: 'Marcação, timing e fluidez com a trilha' },
  { name: 'Figurino',     peso: 5, descricao: 'Adequação visual ao tema e estilo' },
  { name: 'Composição',   peso: 5, descricao: 'Criatividade, originalidade e narrativa' },
]

// Helpers
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const pickN = <T,>(arr: T[], n: number): T[] => {
  const copy = [...arr]
  const out: T[] = []
  for (let i = 0; i < n && copy.length > 0; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0])
  }
  return out
}
const randomNomeCompleto = (genFem = Math.random() < 0.6): string => {
  const first = genFem ? pick(NOMES_FEMININOS) : pick(NOMES_MASCULINOS)
  const last1 = pick(SOBRENOMES)
  const last2 = Math.random() < 0.4 ? ' ' + pick(SOBRENOMES) : ''
  return `${first} ${last1}${last2}`
}
const formacaoSize = (formacao: string): number => {
  switch (formacao) {
    case 'Solo': return 1
    case 'Duo':  return 2
    case 'Trio': return 3
    case 'Grupo': return 5 + Math.floor(Math.random() * 6) // 5-10
    default: return 1
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')   return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')!
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500)

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

  const { action } = body ?? {}

  // ─── action: status ────────────────────────────────────────────────────
  if (action === 'status') {
    const { data: existing } = await supa
      .from('events')
      .select('id, name, created_at')
      .eq('created_by', user.id)
      .eq('is_demo', true)
      .maybeSingle()
    return json({ ok: true, has_demo: !!existing, demo: existing ?? null })
  }

  // PINs sentinela: judges nao tem coluna is_demo, entao identifica pelo PIN
  const DEMO_JUDGE_PINS = ['1111', '2222', '3333']

  // ─── action: delete ────────────────────────────────────────────────────
  if (action === 'delete') {
    // CASCADE em events vai pegar registrations, configuracoes, etc
    // Mas judges nao tem event_id, entao deleta pelos PINs sentinela
    await supa.from('judges')
      .delete()
      .eq('created_by', user.id)
      .in('pin', DEMO_JUDGE_PINS)
    const { error } = await supa
      .from('events')
      .delete()
      .eq('created_by', user.id)
      .eq('is_demo', true)
    if (error) return json({ error: 'db_error', detail: error.message }, 500)
    return json({ ok: true })
  }

  // ─── action: create ────────────────────────────────────────────────────
  if (action === 'create') {
    // 1) Deleta demo anterior se houver (regerar) — judges + event
    await supa.from('judges')
      .delete()
      .eq('created_by', user.id)
      .in('pin', DEMO_JUDGE_PINS)
    await supa.from('events').delete().eq('created_by', user.id).eq('is_demo', true)

    // 2) INSERT em events
    const eventName = '[DEMO] CoreoHub Festival — Demonstração'
    const today = new Date()
    const startDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) // +30 dias
    const endDate   = new Date(today.getTime() + 32 * 24 * 60 * 60 * 1000) // +32 dias
    const regDeadline = new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000) // +20 dias

    const { data: ev, error: evErr } = await supa.from('events').insert([{
      name: eventName,
      description: 'Evento de demonstração do CoreoHub. Os dados aqui são fictícios e servem apenas para você explorar todas as features sem afetar dados reais.',
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      city: 'São Paulo',
      state: 'SP',
      is_demo: true,
      is_public: true, // demo precisa ser publico pra produtor testar a vitrine
      created_by: user.id,
      scoring_system: 'BASE_10',
      slug: `demo-${user.id.slice(0, 8)}`,
      // Identidade visual e contato (Leva 1)
      cover_url: DEMO_COVER_URL,
      location: 'Teatro Municipal de Demonstração — Av. Paulista, 1000',
      event_time: '09:00',
      edition_year: startDate.getFullYear(),
      regulation_pdf_url: DEMO_REGULATION_PDF,
      email_event: 'contato@demo-festival.com',
      whatsapp_event: '5511987654321',
      instagram_event: 'demofestival',
      tiktok_event: 'demofestival',
      youtube_event: 'https://youtube.com/@demofestival',
      website_event: 'https://demo-festival.com',
      // Politica de ingressos + lista
      politica_ingressos: 'INTERNO',
      ingressos_config: DEMO_INGRESSOS,
      patrocinadores_config: DEMO_PATROCINADORES,
      programacao_config: DEMO_PROGRAMACAO,
    }]).select('id').single()

    if (evErr || !ev) return json({ error: 'db_error', detail: evErr?.message ?? 'event' }, 500)
    const eventId = ev.id as string

    // 3) configuracoes — critérios, prêmios, etc
    // Schema real: usa nomes 'estilos', 'formatos', 'categorias' (sem _config).
    // configuracoes.id eh TEXT (nao UUID), entao convertemos.
    const estilos = [...new Set(COREOGRAFIAS.map(c => c.estilo))].map(estilo => ({
      name: estilo,
      criterios: CRITERIOS_PADRAO,
    }))

    const categorias = CATEGORIAS.map((nome, i) => ({
      name: nome,
      min: i === 0 ? 5 : i === 1 ? 12 : i === 2 ? 18 : 30,
      max: i === 0 ? 11 : i === 1 ? 17 : i === 2 ? 29 : null,
    }))

    // 3 lotes com virada de data pra demonstrar pricing em ondas:
    //   1º lote (já encerrado, preço promocional)  — data_virada -10 dias atras
    //   2º lote (vigente)                           — data_virada +10 dias
    //   3º lote (último, preço cheio)               — data_virada +20 dias
    const lote1Virada = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const lote2Virada = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const lote3Virada = new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const precoBase = (f: string) => f === 'Solo' ? 80 : f === 'Duo' ? 60 : 50
    const formatos = FORMACOES.map(f => ({
      name: f,
      pricingType: f === 'Solo' ? 'FIXED' : 'PER_MEMBER',
      minMembers: formacaoSize(f) === 1 ? 1 : (f === 'Duo' ? 2 : f === 'Trio' ? 3 : 5),
      lotes: [
        { nome: '1º Lote (Promocional)', data_virada: lote1Virada, preco: Math.round(precoBase(f) * 0.7) },
        { nome: '2º Lote',               data_virada: lote2Virada, preco: Math.round(precoBase(f) * 0.85) },
        { nome: '3º Lote (Último)',      data_virada: lote3Virada, preco: precoBase(f) },
      ],
    }))

    // Pronuncia personalizada — exemplo demonstrando o feature
    const pronunciaPersonalizada = [
      { termo: 'CoreoHub',  pronuncia: 'Côreo Rrabe' },
      { termo: 'Pas',       pronuncia: 'Pá' },
    ]

    await supa.from('configuracoes').insert([{
      id: eventId,
      event_id: eventId,
      escala_notas: 'BASE_10',
      premios_especiais: PREMIOS_ESPECIAIS,
      estilos,
      categorias,
      formatos,
      texto_ia: 'Com a coreografia [COREOGRAFIA], recebam no palco: [ESTUDIO]',
      texto_ia_saida: 'Uma salva de palmas para [ESTUDIO]!',
      narracao_saida_ativa: true,
      voice_id: 'Kore', // voz feminina firme, boa pra apresentacao
      pronuncia_personalizada: pronunciaPersonalizada,
      pin_inactivity_minutes: 5,
      prazo_inscricao: regDeadline.toISOString().split('T')[0],
      data_evento: startDate.toISOString().split('T')[0],
      // Premiação
      medal_thresholds: { gold: 9.0, silver: 8.0, bronze: 7.0 },
      premiation_system: 'THRESHOLD',
      // Sonoplastia & Cronograma
      tempo_entrada: 15,
      intervalo_seguranca: 3,
      tempo_marcacao_palco: 45,
      gatilho_marcacao: 'MANUAL_MARCADOR',
      marcar_palco_ativo: true,
      modo_sonoplastia: 'MANUAL', // default; produtor troca pra SISTEMA se quiser auto-play
      // Politica de ingressos + lista (espelha events)
      politica_ingressos: 'INTERNO',
      ingressos_audiencia: DEMO_INGRESSOS,
      patrocinadores: DEMO_PATROCINADORES,
      programacao: DEMO_PROGRAMACAO,
    }])

    // Espelha formacoes_config em events (algumas telas leem dali)
    await supa.from('events').update({ formacoes_config: formatos }).eq('id', eventId)

    // 4) Inserir 3 jurados (com PINs e is_active)
    // judges schema real (10 colunas): id, name, specialty [text], avatar_url,
    // created_at, language, assigned_categories [jsonb], is_active, pin, created_by.
    // NAO tem competencias_generos/competencias_formatos (eram chute).
    const judgesToInsert = JURADOS.map(j => ({
      name: j.name,
      pin: j.pin,
      is_active: true,
      specialty: j.generos.join(', '), // ex: "Jazz, Ballet Clássico"
      language: 'pt-BR',
      created_by: user.id,
    }))
    const { data: insertedJudges } = await supa
      .from('judges')
      .insert(judgesToInsert)
      .select('id, pin')
    const judgeIdByPin: Record<string, string> = {}
    ;(insertedJudges ?? []).forEach((j: any) => { judgeIdByPin[j.pin] = j.id })

    // 5) Distribuir 50 coreografias (status + pagamento aleatórios conforme spec)
    // Schema real corrigido:
    //   - formato_participacao (nao formacao)
    //   - bailarinos_detalhes (nao elenco)
    //   - valor_pago (nao preco)
    //   - status: PENDENTE | APROVADA | DESCLASSIFICADA (nao CANCELADA)
    //   - cidade/uf NAO existem em registrations (so em events)
    const totalRegs = 50
    const registrationsToInsert: any[] = []
    for (let i = 0; i < totalRegs; i++) {
      const coreo = COREOGRAFIAS[i % COREOGRAFIAS.length]
      const formato = pick(FORMACOES)
      const estudio  = pick(ESTUDIOS)
      const categoria = pick(CATEGORIAS)
      const numBailarinos = formacaoSize(formato)
      const bailarinos_detalhes = Array.from({ length: numBailarinos }, () => ({
        full_name: randomNomeCompleto(),
        cpf: `${Math.floor(Math.random() * 1e11)}`.padStart(11, '0'),
      }))

      // 90% APROVADA, 5% PENDENTE, 5% DESCLASSIFICADA
      const r = Math.random()
      const status = r < 0.9 ? 'APROVADA' : r < 0.95 ? 'PENDENTE' : 'DESCLASSIFICADA'

      // 90% CONFIRMADO, 10% PENDENTE
      const status_pagamento = Math.random() < 0.9 ? 'CONFIRMADO' : 'PENDENTE'

      const valor_pago = formato === 'Solo' ? 80 : formato === 'Duo' ? 120 : formato === 'Trio' ? 150 : 200

      // Trilha sonora: 70% das APROVADAS tem trilha; resto fica pendente
      // (pra produtor testar tela de trilhas + filtro "Sem Trilha" no Schedule).
      const hasTrilha = status === 'APROVADA' && Math.random() < 0.7
      const trilha_url = hasTrilha ? DEMO_TRILHAS[i % DEMO_TRILHAS.length] : null
      const status_trilha = hasTrilha ? 'OK' : 'PENDENTE'

      registrationsToInsert.push({
        event_id: eventId,
        nome_coreografia: coreo.nome,
        estilo_danca: coreo.estilo,
        categoria,
        formato_participacao: formato,
        tipo_apresentacao: 'Competitiva',
        estudio: estudio.nome,
        bailarinos_detalhes,
        status,
        status_pagamento,
        valor_pago,
        ordem_apresentacao: i + 1,
        trilha_url,
        status_trilha,
      })
    }

    const { data: insertedRegs, error: regErr } = await supa
      .from('registrations')
      .insert(registrationsToInsert)
      .select('id, nome_coreografia, status, tipo_apresentacao, formato_participacao')
    if (regErr) {
      // Rollback: deleta evento (CASCADE limpa o resto)
      await supa.from('events').delete().eq('id', eventId)
      return json({ error: 'db_error', detail: `registrations: ${regErr.message}` }, 500)
    }

    // 5b) Cronograma_blocos: 3 blocos (Manha / Tarde / Final).
    //     Distribui as APROVADAS por formato: Solo+Duo no Manha, Trio+Grupo na Tarde.
    //     Os "Final" recebe os 3 melhores de cada formato (escolha aleatoria pro demo).
    let blocosCriadosOk = 0
    try {
      const { data: blocosInseridos } = await supa.from('cronograma_blocos').insert([
        { event_id: eventId, name: 'Bloco 1 — Manhã (Solos & Duos)', ordem: 0, cor: '#0ea5e9' },
        { event_id: eventId, name: 'Bloco 2 — Tarde (Trios & Grupos)', ordem: 1, cor: '#8b5cf6' },
        { event_id: eventId, name: 'Bloco 3 — Final (Highlights)',     ordem: 2, cor: '#ec4899' },
      ]).select('id, ordem')

      if (blocosInseridos && blocosInseridos.length === 3) {
        const blocoManha = blocosInseridos.find((b: any) => b.ordem === 0)?.id
        const blocoTarde = blocosInseridos.find((b: any) => b.ordem === 1)?.id
        const blocoFinal = blocosInseridos.find((b: any) => b.ordem === 2)?.id
        const aprovadas = (insertedRegs ?? []).filter((r: any) => r.status === 'APROVADA')
        // Pega 3 random pro Final
        const finalPicks = pickN(aprovadas, 3).map((r: any) => r.id)
        for (const reg of aprovadas) {
          let blocoId = null
          if (finalPicks.includes(reg.id)) blocoId = blocoFinal
          else if (reg.formato_participacao === 'Solo' || reg.formato_participacao === 'Duo') blocoId = blocoManha
          else blocoId = blocoTarde
          await supa.from('registrations').update({ bloco_id: blocoId }).eq('id', reg.id)
        }
        blocosCriadosOk = blocosInseridos.length
      }
    } catch (e: any) {
      console.warn('Falha ao criar/distribuir blocos:', e?.message ?? e)
    }

    // 5c) Check-in: 30% das aprovadas ja credenciadas (status OK + timestamp).
    //     Permite testar tela de Credenciamento com barra de progresso visual.
    try {
      const aprovadas = (insertedRegs ?? []).filter((r: any) => r.status === 'APROVADA')
      const credenciadas = pickN(aprovadas, Math.floor(aprovadas.length * 0.3))
      const checkInTime = new Date(Date.now() - Math.random() * 2 * 60 * 60 * 1000).toISOString()
      for (const reg of credenciadas) {
        await supa
          .from('registrations')
          .update({ check_in_status: 'OK', check_in_at: checkInTime })
          .eq('id', reg.id)
      }
    } catch (e: any) {
      console.warn('Falha ao popular check-ins:', e?.message ?? e)
    }

    // 5d) Live registration: marca 1 coreografia aprovada como AO VIVO.
    //     Permite testar JudgeTerminal/Mesa/StageMarker com algo no palco
    //     desde o primeiro acesso. Random pick pra variedade entre demos.
    try {
      const aprovadas = (insertedRegs ?? []).filter((r: any) => r.status === 'APROVADA')
      if (aprovadas.length > 0) {
        const liveReg = pick(aprovadas) as any
        await supa
          .from('events')
          .update({
            live_registration_id: liveReg.id,
            live_started_at: new Date().toISOString(),
          })
          .eq('id', eventId)
      }
    } catch (e: any) {
      console.warn('Falha ao definir live_registration:', e?.message ?? e)
    }

    // 6) Seletiva de Vídeo: 20 inscrições PENDENTES com vídeo submitted
    //    pra produtor testar fluxo de aprovar/reprovar em /seletiva-video.
    //    video_url = placeholder publico (Big Buck Bunny). O importante eh
    //    o produtor testar os botoes de aprovar/reprovar — nao o player.
    const submittedAt = new Date().toISOString()
    const seletivaToInsert = COREOGRAFIAS_SELETIVA.map((coreo, i) => {
      const formato = pick(FORMACOES)
      const estudio = pick(ESTUDIOS)
      const categoria = pick(CATEGORIAS)
      const numBailarinos = formacaoSize(formato)
      const bailarinos_detalhes = Array.from({ length: numBailarinos }, () => ({
        full_name: randomNomeCompleto(),
        cpf: `${Math.floor(Math.random() * 1e11)}`.padStart(11, '0'),
      }))
      return {
        event_id: eventId,
        nome_coreografia: coreo.nome,
        estilo_danca: coreo.estilo,
        categoria,
        formato_participacao: formato,
        tipo_apresentacao: 'Competitiva',
        estudio: estudio.nome,
        bailarinos_detalhes,
        status: 'PENDENTE',
        status_pagamento: 'CONFIRMADO',
        valor_pago: formato === 'Solo' ? 80 : formato === 'Duo' ? 120 : formato === 'Trio' ? 150 : 200,
        ordem_apresentacao: 100 + i, // separa do bloco principal
        video_url: DEMO_VIDEO_URL,
        video_status: 'submitted',
        video_submitted_at: submittedAt,
      }
    })
    const { error: seletivaErr } = await supa.from('registrations').insert(seletivaToInsert)
    if (seletivaErr) {
      console.warn('Falha ao inserir seletiva:', seletivaErr.message)
    }

    // 7) Evaluations fictícias: 10 coreografias APROVADAS competitivas × 3 jurados.
    //    Variação realista: 3 top (notas 9.0-9.8), 4 médias (7.5-8.7), 3 baixas (6.5-7.5).
    //    Pra produtor testar tela de Resultados sem precisar simular votação manual.
    const aprovadasComp = (insertedRegs ?? [])
      .filter((r: any) => r.status === 'APROVADA' && r.tipo_apresentacao === 'Competitiva')
      .slice(0, 10)

    const tiers = [
      { range: [9.0, 9.8] }, { range: [9.0, 9.8] }, { range: [9.0, 9.8] },
      { range: [7.5, 8.7] }, { range: [7.5, 8.7] }, { range: [7.5, 8.7] }, { range: [7.5, 8.7] },
      { range: [6.5, 7.5] }, { range: [6.5, 7.5] }, { range: [6.5, 7.5] },
    ]
    const judgeIds = JURADOS.map(j => judgeIdByPin[j.pin]).filter(Boolean)
    const criteriosNomes = CRITERIOS_PADRAO.map(c => c.name)
    const criteriosWeights = CRITERIOS_PADRAO.map(c => ({ name: c.name, peso: c.peso }))
    const evalsToInsert: any[] = []
    // Indicacao a premios especiais: distribuir nos top 3 das evaluations.
    // Cada uma das top 3 recebe 1-2 nominations de premios diferentes,
    // de jurados diferentes. Permite testar Coordenador do Juri / Deliberacao.
    // Estrutura de nominations[]: [{ award_id, award_name }] (formato
    // consagrado nas Phase 3 Edge Functions).
    const premiosParaNomear = [
      { id: 'tpl_bailarino', name: 'Melhor Bailarino(a)' },
      { id: 'tpl_revelacao', name: 'Prêmio Revelação' },
      { id: 'tpl_coreografo', name: 'Melhor Coreografia' },
      { id: 'tpl_grupo', name: 'Melhor Grupo da Noite' },
      { id: 'tpl_figurino', name: 'Melhor Figurino' },
    ]
    aprovadasComp.forEach((reg: any, idx: number) => {
      const tier = tiers[idx] ?? tiers[tiers.length - 1]
      judgeIds.forEach((jid, judgeIdx) => {
        const scores: Record<string, number> = {}
        let sum = 0
        criteriosNomes.forEach(name => {
          const [lo, hi] = tier.range
          const score = +(lo + Math.random() * (hi - lo)).toFixed(1)
          scores[name] = score
          sum += score
        })
        const avg = +(sum / criteriosNomes.length).toFixed(2)
        // Phase 3 — highlights nas top 3 (1 jurado marca cada)
        const highlights = (idx < 3 && judgeIdx === idx % 3) ? ['DESTAQUE'] : []
        // Phase 3 — nominations: top 3 recebem indicacoes em premios diferentes,
        // de jurados rotativos. Espalha pra cobrir todos os 5 premios.
        const nominations: { award_id: string; award_name: string }[] = []
        if (idx < 3) {
          // Top 3: cada uma recebe 1 nomination do (idx+judgeIdx) % 5 premio
          const premioIdx = (idx * 3 + judgeIdx) % premiosParaNomear.length
          nominations.push(premiosParaNomear[premioIdx])
          // Top 1 ganha nomination extra pra Melhor Coreografia (idx=2)
          if (idx === 0 && judgeIdx === 0) {
            nominations.push(premiosParaNomear[2])
          }
        }
        evalsToInsert.push({
          event_id: eventId,
          registration_id: reg.id,
          judge_id: jid,
          scores,
          criteria_weights: criteriosWeights,
          final_weighted_average: avg,
          submitted_at: submittedAt,
          highlights,
          nominations,
        })
      })
    })
    let evalsInserted = 0
    let evalsError: string | null = null
    if (evalsToInsert.length > 0) {
      const { error: evalErr } = await supa.from('evaluations').insert(evalsToInsert)
      if (evalErr) {
        evalsError = evalErr.message
        console.warn('Falha ao inserir evaluations:', evalErr.message)
      } else {
        evalsInserted = evalsToInsert.length
      }
    }

    return json({
      ok: true,
      event_id: eventId,
      stats: {
        coreografias: totalRegs,
        seletiva_pendentes: seletivaErr ? 0 : seletivaToInsert.length,
        seletiva_error: seletivaErr?.message ?? null,
        evaluations: evalsInserted,
        evaluations_error: evalsError,
        jurados: JURADOS.length,
        prêmios: PREMIOS_ESPECIAIS.length,
        estilos: estilos.length,
        blocos: blocosCriadosOk,
        trilhas_setadas: registrationsToInsert.filter(r => r.trilha_url).length,
        ingressos: DEMO_INGRESSOS.length,
        patrocinadores: DEMO_PATROCINADORES.length,
        programacao_itens: DEMO_PROGRAMACAO.length,
      },
    })
  }

  return json({ error: 'unknown_action' }, 400)
})
