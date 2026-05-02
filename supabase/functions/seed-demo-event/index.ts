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
      is_public: false,
      created_by: user.id,
      scoring_system: 'BASE_10', // coluna real eh scoring_system [text], nao score_scale
      slug: `demo-${user.id.slice(0, 8)}`,
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

    const formatos = FORMACOES.map(f => ({
      name: f,
      pricingType: f === 'Solo' ? 'FIXED' : 'PER_MEMBER',
      minMembers: formacaoSize(f) === 1 ? 1 : (f === 'Duo' ? 2 : f === 'Trio' ? 3 : 5),
      lotes: [{ data_virada: null, preco: f === 'Solo' ? 80 : f === 'Duo' ? 60 : 50 }],
    }))

    await supa.from('configuracoes').insert([{
      id: eventId,
      event_id: eventId,
      escala_notas: 'BASE_10',
      premios_especiais: PREMIOS_ESPECIAIS,
      estilos,
      categorias,
      formatos,
      texto_ia: 'Com a coreografia [COREOGRAFIA], recebam no palco: [ESTUDIO]',
      pin_inactivity_minutes: 5,
      // Prazo de inscricao mora em configuracoes (NAO em events.registration_deadline)
      prazo_inscricao: regDeadline.toISOString().split('T')[0],
      data_evento: startDate.toISOString().split('T')[0],
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

      registrationsToInsert.push({
        event_id: eventId,
        nome_coreografia: coreo.nome,
        estilo_danca: coreo.estilo,
        categoria,
        formato_participacao: formato,
        tipo_apresentacao: 'Competitiva',
        estudio: estudio.nome,
        bailarinos_detalhes,
        // num_participantes NAO existe na tabela — removido
        status,
        status_pagamento,
        valor_pago,
        ordem_apresentacao: i + 1,
      })
    }

    const { data: insertedRegs, error: regErr } = await supa
      .from('registrations')
      .insert(registrationsToInsert)
      .select('id, nome_coreografia, status, tipo_apresentacao')
    if (regErr) {
      // Rollback: deleta evento (CASCADE limpa o resto)
      await supa.from('events').delete().eq('id', eventId)
      return json({ error: 'db_error', detail: `registrations: ${regErr.message}` }, 500)
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
    await supa.from('registrations').insert(seletivaToInsert)

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
    aprovadasComp.forEach((reg: any, idx: number) => {
      const tier = tiers[idx] ?? tiers[tiers.length - 1]
      judgeIds.forEach(jid => {
        const scores: Record<string, number> = {}
        let sum = 0
        criteriosNomes.forEach(name => {
          const [lo, hi] = tier.range
          const score = +(lo + Math.random() * (hi - lo)).toFixed(1)
          scores[name] = score
          sum += score
        })
        const avg = +(sum / criteriosNomes.length).toFixed(2)
        evalsToInsert.push({
          event_id: eventId,
          registration_id: reg.id,
          judge_id: jid,
          scores,
          criteria_weights: criteriosWeights,
          final_weighted_average: avg,
          submitted_at: submittedAt,
        })
      })
    })
    if (evalsToInsert.length > 0) {
      await supa.from('evaluations').insert(evalsToInsert)
    }

    return json({
      ok: true,
      event_id: eventId,
      stats: {
        coreografias: totalRegs,
        seletiva_pendentes: seletivaToInsert.length,
        evaluations: evalsToInsert.length,
        jurados: JURADOS.length,
        prêmios: PREMIOS_ESPECIAIS.length,
        estilos: estilos.length,
      },
    })
  }

  return json({ error: 'unknown_action' }, 400)
})
