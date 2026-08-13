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
 *   - Telão de Palco ativo (código gerado via regenerate_telao_code, modo ao_vivo)
 *   - 2 Avisos do produtor (event_announcements)
 *   - Prêmios especiais com os campos winner_* (registra-primeiro-revela-
 *     depois, 2026-07-11/12) — Voto Popular já revelado, deliberação ainda
 *     não registrada (produtor testa o fluxo em /deliberacoes)
 *   - 1 Workshop Pass cobrindo 2 dos 4 workshops demo
 *   - Documentos extras + link de destaque na vitrine
 *
 *   FORA do escopo, por decisão consciente (não seedado):
 *   - Certificados: certificate_templates é por PRODUTOR (não por evento,
 *     UNIQUE(producer_id, template_type)) — sobrescreveria/colidiria com o
 *     modelo real do produtor. Ver CLAUDE.md 2026-07-15.
 *   - Seletiva multi-jurado fica solo no demo de propósito.
 *   - Integração real com Voto Popular (infra isolada, outro projeto Supabase).
 *
 * Auth: produtor logado via JWT (Authorization Bearer)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

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
  // Dança do Ventre (2) — gênero real de mercado (visto em evento real,
  // Ballet Ana Rennó/Usualdance), ausente do demo até 2026-08-06.
  { nome: 'Sob o Véu', estilo: 'Dança do Ventre' },
  { nome: 'Oásis do Deserto', estilo: 'Dança do Ventre' },
  // Estilo Livre — subgênero "categoria livre" (pula Eixo Etário no
  // checkout), gênero mais usado em festivais BR reais mas nunca
  // representado no demo.
  { nome: 'Sem Fronteiras', estilo: 'Estilo Livre' },
  { nome: 'Fusão de Mundos', estilo: 'Estilo Livre' },
  // Dança Inclusiva (PCD) — vários festivais BR grandes (ex: FEDANVI São
  // Vicente) têm trilha própria de dança em cadeira de rodas.
  { nome: 'Movimento Livre', estilo: 'Dança Inclusiva (PCD)' },
  { nome: 'Roda da Vida', estilo: 'Dança Inclusiva (PCD)' },
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

// Trilhas sonoras de demonstração — SoundHelix tem URLs estáveis há 15+ anos,
// é o padrão em audio players HTML5 (referenciado pela MDN/W3C). CDNs Pixabay
// e Free Music Archive mudam URLs e quebram demos depois de meses.
const DEMO_TRILHAS = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
]

// Patrocinadores placeholder — variedade típica de festival real:
// poder público (prefeitura, secretaria), patrocinador privado (estúdio,
// loja), apoiador (lei de incentivo), mídia parceira, plataforma técnica.
// placehold.co é mais confiável que via.placeholder.
const DEMO_PATROCINADORES = [
  { nome: 'Prefeitura Municipal',          logo_url: 'https://placehold.co/240x120/0ea5e9/ffffff/png?text=PREFEITURA',          link: 'https://exemplo.gov.br' },
  { nome: 'Secretaria Municipal de Cultura', logo_url: 'https://placehold.co/240x120/8b5cf6/ffffff/png?text=CULTURA',          link: 'https://cultura.exemplo.gov.br' },
  { nome: 'Lei Rouanet',                   logo_url: 'https://placehold.co/240x120/047857/ffffff/png?text=LEI+ROUANET',         link: 'https://www.gov.br/cultura' },
  { nome: 'Studio Capital',                logo_url: 'https://placehold.co/240x120/ec4899/ffffff/png?text=STUDIO+CAPITAL',      link: '' },
  { nome: 'Capezio',                       logo_url: 'https://placehold.co/240x120/dc2626/ffffff/png?text=CAPEZIO',              link: 'https://capezio.com.br' },
  { nome: 'Ballet Magazine',               logo_url: 'https://placehold.co/240x120/0891b2/ffffff/png?text=BALLET+MAG',          link: '' },
  { nome: 'Rádio Cultura FM',              logo_url: 'https://placehold.co/240x120/ea580c/ffffff/png?text=RADIO+CULTURA',       link: '' },
  { nome: 'CoreoHub',                      logo_url: 'https://placehold.co/240x120/ff0068/ffffff/png?text=CoreoHub',             link: 'https://coreohub.com' },
]

// Tipos de ingresso pra audiencia (politica INTERNO)
// quantidade_total ilustra os 3 estados de estoque na vitrine do carrinho:
//   - Inteira: estoque alto (200) → vende normal, sem badge.
//   - Meia: estoque baixo (12) → badge "Últimos N" âmbar GARANTIDO. A Meia
//     recebe 8 tickets no seed (loop i%3); ativos (APROVADO + PENDENTE sem
//     reserved_until) variam 2-8, logo remaining cai em [4, 10] — sempre <= 10
//     (dispara o badge) e sempre > 0 (nunca esgota). Determinístico apesar do
//     status aleatório de cada ticket.
//   - Solidária: sem quantidade_total → ilimitada, sem badge.
// O seed insere ~8 tickets de cada tipo direto na tabela — não passa pela RPC
// de reserva, então estoque baixo não quebra o seed.
const DEMO_INGRESSOS = [
  { nome: 'Inteira',         preco: 30, obs: 'Acesso aos 2 dias de festival',           link: '', quantidade_total: 200 },
  { nome: 'Meia-entrada',    preco: 15, obs: 'Estudante, idoso, doador de sangue',      link: '', quantidade_total: 12  },
  { nome: 'Solidária',       preco: 20, obs: 'Inteira + 1kg de alimento não-perecível', link: '' },
]

// Programação do dia 1 (campo canônico do AccountSettings: 'atividade').
// Versão detalhada que serve de referência pro produtor — cobre toda a
// rotina típica de festival: credenciamento, aula aberta, blocos por
// formação, intervalo de almoço, premiação parcial e festa de encerramento.
const DEMO_PROGRAMACAO = [
  { hora: '08:00', atividade: 'Abertura do credenciamento — entrega de pulseiras' },
  { hora: '09:00', atividade: 'Aula gratuita aberta — Workshop de Contemporâneo com Juliana Silveira' },
  { hora: '10:30', atividade: 'Bloco 1 — Solos Infantil (Ballet, Jazz e Contemporâneo)' },
  { hora: '12:00', atividade: 'Pausa pra almoço — food trucks no pátio' },
  { hora: '14:00', atividade: 'Bloco 2 — Solos Juvenil + Adulto + Profissional' },
  { hora: '16:00', atividade: 'Bloco 3 — Duos & Trios (todas categorias)' },
  { hora: '18:00', atividade: 'Intervalo + masterclass de Hip Hop com Rodrigo Souza' },
  { hora: '19:30', atividade: 'Bloco 4 — Grupos (todas categorias)' },
  { hora: '22:00', atividade: 'Premiação parcial — medalhas do dia + revelação' },
  { hora: '23:00', atividade: 'Festa de encerramento do 1º dia — open bar até 1h' },
]

// Faixas etárias reais de festivais BR grandes (Joinville/São Vicente/Mery
// Rosa, pesquisa 2026-08-06) — Bheto real (Usualdance) usa Baby Class e
// Melhor Idade sem max (min:55, sem teto), Mista sem min/max nenhum (é
// exatamente como a config real dele guarda no banco). "Profissional" saiu
// (nunca usado nos festivais BR pesquisados como categoria etária — Amador/
// Profissional é nível técnico, não idade) e virou "Adulto" mais amplo.
const CATEGORIAS_DEF: { name: string; min?: number; max?: number }[] = [
  { name: 'Baby Class',   min: 3,  max: 6 },
  { name: 'Infantil',     min: 7,  max: 12 },
  { name: 'Juvenil',      min: 13, max: 16 },
  { name: 'Adulto',       min: 17, max: 39 },
  { name: 'Melhor Idade', min: 55 },
  { name: 'Mista' },
]
const CATEGORIAS = CATEGORIAS_DEF.map(c => c.name)
// PCD não entra aqui de propósito — não é faixa etária, é gênero (ver
// GENEROS_SUBGENEROS abaixo, "Dança Inclusiva (PCD)"), igual o mercado BR
// real trata (São Vicente/FEDANVI modela como gênero, não categoria).
const FORMACOES = ['Solo', 'Duo', 'Trio', 'Quarteto', 'Grupo', 'Conjunto']

// Gêneros + Subgêneros reais (Eixo Técnico) — pesquisa 2026-08-06 em
// regulamentos de Joinville/São Vicente/Mery Rosa. Até 2026-08-06 o demo
// nunca gravava a tabela `event_styles` de verdade (só uma lista solta de
// strings em `configuracoes.estilos`) — o produto tem a arquitetura de 3
// eixos pronta (genreService.ts) e o demo não mostrava ela funcionando.
// is_categoria_livre:true pula o Eixo Etário no checkout (Estilo Livre e
// Dança Inclusiva não têm faixa etária fixa no mercado real).
// allow_shorter_track:true ignora duração mínima de trilha (Balé de
// Repertório — mesmo padrão do evento real do Bheto, corrigido em 2026-07-17).
const GENEROS_SUBGENEROS: { name: string; subgeneros: { name: string; is_categoria_livre?: boolean; allow_shorter_track?: boolean }[] }[] = [
  {
    name: 'Ballet Clássico',
    subgeneros: [
      { name: 'Variação Feminina' },
      { name: 'Variação Masculina' },
      { name: 'Pas de Deux' },
      { name: 'Grand Pas de Deux' },
      { name: 'Balé de Repertório', allow_shorter_track: true },
    ],
  },
  { name: 'Jazz', subgeneros: [] },
  { name: 'Contemporâneo', subgeneros: [] },
  {
    name: 'Hip Hop',
    subgeneros: [
      { name: 'Old School' },
      { name: 'Breaking' },
      { name: 'Locking' },
      { name: 'Popping' },
    ],
  },
  {
    name: 'Dança Urbana',
    subgeneros: [
      { name: 'Funk' },
      { name: 'House Dance' },
      { name: 'Waacking' },
    ],
  },
  { name: 'Dança do Ventre', subgeneros: [] },
  {
    name: 'Estilo Livre',
    subgeneros: [{ name: 'Estilo Livre', is_categoria_livre: true }],
  },
  {
    name: 'Dança Inclusiva (PCD)',
    subgeneros: [{ name: 'Cadeira de Rodas', is_categoria_livre: true }],
  },
]

// ─── Workshops (Etapa 1) ──────────────────────────────────────────────────
// Mix de workshops pra cobrir os 3 modos de pricing + standalone:
//   1. Atrelado ao festival, pago com 2 lotes
//   2. Atrelado, pago com desconto pra inscritos da mostra (auto_detect_combo)
//   3. Atrelado, GRÁTIS pra inscritos (gratis_para_inscritos=true)
//   4. Standalone (event_id=null) — workshop avulso do produtor
const DEMO_WORKSHOPS = [
  {
    nome: 'Jazz Funk Intensivo',
    slug_base: 'jazz-funk-intensivo-demo',
    descricao: 'Workshop intensivo de Jazz Funk com base em coreografia comercial. Aquecimento, técnica e final com vídeo.',
    cover_url: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1200&h=675&fit=crop&q=80',
    professor_name: 'Juliana Silveira',  // mesmo nome de jurada → testa dedup PersonCard
    professor_bio: 'Bailarina principal do Theatro Municipal de SP. Mestra em Dança Contemporânea pela UFBA. 15 anos formando profissionais.',
    professor_bio_short: 'Bailarina principal do Theatro Municipal de SP, Mestra em Dança Contemporânea.',
    professor_photo_url: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=400&h=400&fit=crop&q=80',
    professor_instagram: 'juliana.dance',
    modalidade: 'Jazz Funk',
    nivel: 'intermediario' as const,
    duracao_minutos: 120,
    capacidade_max: 30,
    preco_padrao: 90,
    preco_inscritos_mostra: 60,    // desconto pra inscritos
    gratis_para_inscritos: false,
    auto_detect_combo: true,
    tem_lotes: true,
    standalone: false,
  },
  {
    nome: 'Hip Hop Foundations',
    slug_base: 'hip-hop-foundations-demo',
    descricao: 'Os fundamentos do Hip Hop pra quem quer começar do zero ou consolidar a base. Top rock, footwork e freestyle.',
    cover_url: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200&h=675&fit=crop&q=80',
    professor_name: 'Rodrigo Souza',     // jurado também — vai dedupar
    professor_bio: 'Pioneiro do Hip Hop em SP. 18 anos formando dançarinos urbanos. Battles Brasil/Itália.',
    professor_bio_short: 'Pioneiro do Hip Hop em SP, 18 anos formando dançarinos urbanos.',
    professor_photo_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&q=80',
    professor_instagram: 'rodrigorhip',
    modalidade: 'Hip Hop',
    nivel: 'iniciante' as const,
    duracao_minutos: 90,
    capacidade_max: 40,
    preco_padrao: 60,
    preco_inscritos_mostra: null,
    gratis_para_inscritos: true,            // grátis pra inscritos!
    auto_detect_combo: true,
    tem_lotes: false,
    standalone: false,
  },
  {
    nome: 'Contemporâneo: Improvisação',
    slug_base: 'contemporaneo-improvisacao-demo',
    descricao: 'Aula prática de improvisação contemporânea — Forsythe, Release Technique e estados expandidos do corpo.',
    cover_url: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=1200&h=675&fit=crop&q=80',
    professor_name: 'Ana Paula Mendes',   // só professora (não é jurada)
    professor_bio: 'Coreógrafa e dançarina contemporânea com passagem pela Cia Deborah Colker. Doutora em Artes Cênicas (USP).',
    professor_bio_short: 'Coreógrafa contemporânea, ex-Deborah Colker, doutora em Artes Cênicas pela USP.',
    professor_photo_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&q=80',
    professor_instagram: 'anapaula.contemporaneo',
    modalidade: 'Contemporâneo',
    nivel: 'avancado' as const,
    duracao_minutos: 150,
    capacidade_max: 25,
    preco_padrao: 120,
    preco_inscritos_mostra: 90,
    gratis_para_inscritos: false,
    auto_detect_combo: true,
    tem_lotes: false,
    standalone: false,
  },
  {
    nome: 'Ballet Repertório — La Bayadère',
    slug_base: 'ballet-bayadere-demo',
    descricao: 'Variação clássica do balé La Bayadère. Técnica, expressão e detalhes do repertório russo.',
    cover_url: 'https://images.unsplash.com/photo-1535525153412-5a092d46b4ff?w=1200&h=675&fit=crop&q=80',
    professor_name: 'Tatiana Volkova',
    professor_bio: 'Ex-solista do Bolshoi. Atua como pedagoga e coach internacional desde 2015.',
    professor_bio_short: 'Ex-solista do Bolshoi, pedagoga internacional.',
    professor_photo_url: 'https://images.unsplash.com/photo-1554151228-14d9def656e4?w=400&h=400&fit=crop&q=80',
    professor_instagram: 'tatiana.ballet',
    modalidade: 'Ballet Clássico',
    nivel: 'avancado' as const,
    duracao_minutos: 180,
    capacidade_max: 20,
    preco_padrao: 150,
    preco_inscritos_mostra: null,
    gratis_para_inscritos: false,
    auto_detect_combo: false,
    tem_lotes: false,
    standalone: true,                   // workshop AVULSO (sem event_id)
  },
]

// ─── Cupons demo ──────────────────────────────────────────────────────────
// Mix de scopes pra testar todos os fluxos. `scopes` (TEXT[]) é a coluna
// canônica desde a migration 20260615; `scope` legacy fica em sync pro fallback
// das edge functions em transição (espelha o dual-write da Coupons.tsx).
// INSCRICAO+PLATEIA exibe a combinação multi-scope (o valor da feature scopes[]).
const DEMO_COUPONS = [
  { code: 'FAMILIA10',  scopes: ['audience'],                 discount_type: 'percent', discount_value: 10, max_uses: 50, max_uses_per_user: 2,    descricao: '10% off pra famílias na plateia (até 2 por inscrito)' },
  { code: 'WORKSHOP20', scopes: ['workshop'],                 discount_type: 'percent', discount_value: 20, max_uses: 30, max_uses_per_user: null, descricao: '20% off em workshops (sem limite por inscrito)' },
  { code: 'CHEGAJUNTO', scopes: ['inscription', 'audience'],  discount_type: 'percent', discount_value: 15, max_uses: 40, max_uses_per_user: 1,    descricao: '15% off na inscrição + ingresso de plateia (multi-setor)' },
  { code: 'DEMO50',     scopes: ['inscription', 'audience', 'workshop', 'video_selection'], discount_type: 'percent', discount_value: 50, max_uses: 5, max_uses_per_user: 1, descricao: 'Cupom demo — 50% off em tudo (limitado, 1 por inscrito)' },
]

// Deriva o `scope` legacy (single) a partir do array `scopes`, espelhando a
// regra da Coupons.tsx: 1 setor → próprio nome; 4 setores → 'all';
// inscription+audience → 'both'; outras combinações → 'inscription' (fallback).
function deriveScopeLegacy(scopes: string[]): string {
  if (scopes.length === 1) return scopes[0]
  if (scopes.length === 4) return 'all'
  const s = new Set(scopes)
  if (scopes.length === 2 && s.has('inscription') && s.has('audience')) return 'both'
  return 'inscription'
}

const JURADOS = [
  {
    name: 'Carlos Mendes',
    pin: '1111',
    gender: 'M' as const,
    generos: ['Jazz', 'Ballet Clássico'],
    mini_bio: 'Coreógrafo premiado com 25 anos de carreira. Diretor da Cia Mendes desde 2010.',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&q=80',
    instagram: 'carlosmendes.coreografo',
  },
  {
    name: 'Juliana Silveira',
    pin: '2222',
    gender: 'F' as const,
    generos: ['Contemporâneo', 'Ballet Clássico'],
    mini_bio: 'Bailarina principal do Theatro Municipal de SP. Mestra em Dança Contemporânea pela UFBA.',
    avatar_url: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=400&h=400&fit=crop&q=80',
    instagram: 'juliana.dance',
  },
  {
    name: 'Rodrigo Souza',
    pin: '3333',
    gender: 'M' as const,
    generos: ['Hip Hop', 'Dança Urbana'],
    mini_bio: 'Pioneiro do Hip Hop em SP. 18 anos formando dançarinos urbanos. Battles Brasil/Itália.',
    avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&q=80',
    instagram: 'rodrigorhip',
  },
]

// Campos winner_* (registra-primeiro-revela-depois, 2026-07-11/12): Ouro/Prata/
// Bronze/Maior Nota são calculados na hora a partir das notas reais — não
// fixamos winner_items pra eles aqui. Só prêmios de deliberação (premio) e
// manuais (Voto Popular) guardam vencedor fixo. Deliberação nasce SEM
// vencedor registrado — o produtor testa o fluxo de registrar em
// /deliberacoes. Voto Popular nasce JÁ revelado (preenchido depois que as
// registrations existem, ver passo 5e) pra mostrar como fica pós-revelação.
const PREMIOS_ESPECIAIS = [
  { id: 'tpl_bailarino',        name: 'Melhor Bailarino(a)',   enabled: true, isTemplate: true,  formation: 'Solo',  genre: 'TODOS', description: '', valor: 500,
    winner_nome: null, winner_estudio: null, winner_items: null, winner_revealed: false },
  { id: 'tpl_revelacao',        name: 'Prêmio Revelação',      enabled: true, isTemplate: true,  formation: 'TODOS', genre: 'TODOS', description: '',
    winner_nome: null, winner_estudio: null, winner_items: null, winner_revealed: false },
  { id: 'tpl_coreografo',       name: 'Melhor Coreografia',    enabled: true, isTemplate: true,  formation: 'TODOS', genre: 'TODOS', description: '', valor: 1000,
    winner_nome: null, winner_estudio: null, winner_items: null, winner_revealed: false },
  { id: 'tpl_coreografo_pessoa',name: 'Melhor Coreógrafo(a)',  enabled: true, isTemplate: true,  formation: 'TODOS', genre: 'TODOS', description: '',
    winner_nome: null, winner_estudio: null, winner_items: null, winner_revealed: false },
  { id: 'tpl_grupo',            name: 'Melhor Grupo da Noite', enabled: true, isTemplate: true,  formation: 'Grupo', genre: 'TODOS', description: '', valor: 2000,
    winner_nome: null, winner_estudio: null, winner_items: null, winner_revealed: false },
  { id: 'tpl_figurino',         name: 'Melhor Figurino',       enabled: true, isTemplate: false, formation: 'TODOS', genre: 'TODOS', description: '',
    winner_nome: null, winner_estudio: null, winner_items: null, winner_revealed: false },
  // Voto Popular (tipo manual, classifyAward por regex "voto popular") —
  // winner_nome/winner_estudio ficam null aqui e são preenchidos no passo 5e,
  // depois que as registrations existem de verdade.
  { id: 'tpl_voto_popular',     name: 'Voto Popular',          enabled: true, isTemplate: true,  formation: 'TODOS', genre: 'TODOS',
    description: 'Escolhido pelo público durante a transmissão ao vivo.',
    winner_nome: null, winner_estudio: null, winner_items: null, winner_revealed: false },
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
const VALOR_POR_FORMATO: Record<string, number> = { Solo: 80, Duo: 120, Trio: 150, Quarteto: 180, Grupo: 200, Conjunto: 280 }
const formacaoSize = (formacao: string): number => {
  switch (formacao) {
    case 'Solo': return 1
    case 'Duo':  return 2
    case 'Trio': return 3
    case 'Quarteto': return 4
    case 'Grupo': return 5 + Math.floor(Math.random() * 4) // 5-8
    case 'Conjunto': return 9 + Math.floor(Math.random() * 6) // 9-14
    default: return 1
  }
}

// CPF fake válido (algoritmo módulo 11). Necessário pra elenco do demo —
// sem isso o helper hasIncompleteBailarinos marca bailarino como "dados
// pendentes" e Dashboard mostra banner falso (memória refactor-elenco-
// dados-pendentes-shipado, 2026-05-22).
const generateValidCpf = (): string => {
  const digits: number[] = []
  for (let i = 0; i < 9; i++) digits.push(Math.floor(Math.random() * 10))
  const calcDigit = (arr: number[]): number => {
    let sum = 0
    const base = arr.length + 1
    for (let i = 0; i < arr.length; i++) sum += arr[i] * (base - i)
    const mod = (sum * 10) % 11
    return mod === 10 ? 0 : mod
  }
  digits.push(calcDigit(digits))
  digits.push(calcDigit(digits))
  return digits.join('')
}

// Data de nascimento aleatória dentro da faixa etária da categoria.
// Usa today menos N anos pra cobrir min/max age. Retorna ISO YYYY-MM-DD.
const generateBirthDate = (categoria: string): string => {
  const ranges: Record<string, [number, number]> = {
    'Baby Class':   [3, 6],
    'Infantil':     [7, 12],
    'Juvenil':      [13, 16],
    'Adulto':       [17, 39],
    'Melhor Idade': [55, 80],
    'Mista':        [8, 60],
  }
  const [minAge, maxAge] = ranges[categoria] ?? [10, 30]
  const age = minAge + Math.floor(Math.random() * (maxAge - minAge + 1))
  const today = new Date()
  const birthYear = today.getFullYear() - age
  const birthMonth = Math.floor(Math.random() * 12)
  const birthDay = 1 + Math.floor(Math.random() * 27)
  return `${birthYear}-${String(birthMonth + 1).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

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

  // Helper: limpa tabelas que referenciam events via FK SEM ON DELETE CASCADE.
  // Tier 2 introduziu audience_tickets + platform_commissions com event_id FK.
  // platform_commissions.event_id NÃO é cascade, então o DELETE de events trava
  // se houver comissões registradas (caso comum: produtor confirmou pagamento
  // de teste no Asaas → webhook gerou comissão).
  const cleanupBeforeEventDelete = async (userId: string) => {
    const { data: demoEvents } = await supa
      .from('events')
      .select('id')
      .eq('created_by', userId)
      .eq('is_demo', true)
    const ids = (demoEvents ?? []).map((e: { id: string }) => e.id)
    if (ids.length === 0) {
      // Mesmo sem evento, pode haver workshop standalone do produtor.
      // Deleta órfãos pra regerar limpo.
      // certificate_templates NÃO é limpo aqui de propósito — é por
      // PRODUTOR (não por evento, sem coluna event_id), deletar por
      // producer_id apagaria o certificado REAL do produtor junto. Ver
      // nota grande na seção 11 mais abaixo (incidente real 2026-07-15).
      // BUG CRÍTICO 2026-06-17: faltava o filtro .is('event_id', null) — sem
      // ele, isso deletava TODOS os workshops do produtor, incluindo os de
      // eventos REAIS (não só os standalone órfãos do demo). Causou perda de
      // dados em prod (workshops do Usualdance Festival apagados).
      await supa.from('workshops').delete().eq('created_by', userId).is('event_id', null)
      return
    }
    // platform_commissions: deleta linhas que apontam pros eventos demo
    await supa.from('platform_commissions').delete().in('event_id', ids)
    // audience_tickets: CASCADE em events, mas explicitar acelera + libera FK
    await supa.from('audience_tickets').delete().in('event_id', ids)
    // elenco demo: bailarinos criados pelo seed não têm CASCADE (JSONB não é FK).
    // Estratégia: captura IDs referenciados em bailarinos_detalhes das
    // registrations dos eventos demo, depois deleta esses elenco rows.
    // Não pega elenco real do produtor (inscrições em outros eventos).
    try {
      const { data: demoRegs } = await supa
        .from('registrations')
        .select('bailarinos_detalhes')
        .in('event_id', ids)
      const elencoIdsToDelete = new Set<string>()
      for (const reg of (demoRegs ?? [])) {
        const arr = Array.isArray(reg.bailarinos_detalhes) ? reg.bailarinos_detalhes : []
        for (const b of arr) {
          if (b && typeof b.id === 'string') elencoIdsToDelete.add(b.id)
        }
      }
      if (elencoIdsToDelete.size > 0) {
        await supa.from('elenco').delete().in('id', Array.from(elencoIdsToDelete))
      }
    } catch (e) {
      console.warn('Falha ao deletar elenco demo:', e)
    }
    // ── Workshops Etapa 1: workshops vinculados ao evento demo (event_id IN ids)
    //    já são apagados via CASCADE quando o evento demo é deletado abaixo.
    //    Só precisamos limpar os standalone (event_id=null) do produtor aqui.
    //    BUG CRÍTICO 2026-06-17: faltava .is('event_id', null) — sem ele isso
    //    deletava TAMBÉM os workshops de eventos REAIS do mesmo produtor.
    //    workshop_lots e workshop_registrations têm CASCADE em workshops.id.
    await supa.from('workshops').delete().eq('created_by', userId).is('event_id', null)
    // ── Certificados: certificates_issued tem event_id — limpa só o que é
    //    do(s) evento(s) demo. NUNCA filtrar certificate_templates/
    //    certificates_issued por producer_id sozinho — apagaria os
    //    certificados REAIS do produtor (incidente real 2026-07-15, ver
    //    nota grande na seção 11 mais abaixo). certificate_templates não é
    //    tocado aqui — não é seedado por este arquivo.
    await supa.from('certificates_issued').delete().in('event_id', ids)
    // ── Cupons: têm event_id FK. Deletar pelos eventos demo.
    await supa.from('coupons').delete().in('event_id', ids)
    // ── Demo team: 3 staff fakes criados via auth.admin. Identificados por
    //    email pattern `*-${userIdShort}@coreohub-demo.local`. Deletar do
    //    auth.users CASCADE pra profiles (FK em auth.users.id).
    const userIdShort = userId.slice(0, 8)
    const { data: staffProfiles } = await supa
      .from('profiles')
      .select('id')
      .like('email', `%-${userIdShort}@coreohub-demo.local`)
    for (const p of (staffProfiles ?? []) as Array<{ id: string }>) {
      try {
        await supa.auth.admin.deleteUser(p.id)
      } catch (e) {
        console.warn(`Falha ao deletar staff demo ${p.id}:`, e)
      }
    }
  }

  // ─── action: delete ────────────────────────────────────────────────────
  if (action === 'delete') {
    // CASCADE em events vai pegar registrations, configuracoes, etc
    // Mas judges nao tem event_id, entao deleta pelos PINs sentinela
    await supa.from('judges')
      .delete()
      .eq('created_by', user.id)
      .in('pin', DEMO_JUDGE_PINS)
    await cleanupBeforeEventDelete(user.id)
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
    await cleanupBeforeEventDelete(user.id)
    await supa.from('events').delete().eq('created_by', user.id).eq('is_demo', true)

    // 2) INSERT em events
    // Nome do festival fictício — feito pra parecer real e servir de
    // referência pro produtor que abrir o demo. Tag [DEMO] preservada
    // pra distinção visual + filtro is_demo no banco.
    const eventName = '[DEMO] CoreoHub Open — Festival Nacional de Dança'

    // Descrição rica que serve de modelo pro produtor real ver "como ficar"
    // uma página de festival completa. Cobre: posicionamento, escopo,
    // estrutura competitiva, premiação, ingressos, infraestrutura.
    const eventDescription = `O CoreoHub Open é um festival nacional de dança que reúne bailarinos de todo o Brasil em mostra competitiva. Realizado anualmente em São Paulo, oferece um dos circuitos mais democráticos do país, com inscrições em 3 lotes de preço progressivo e categoria solidária para inclusão.

📍 Estrutura
• 5 estilos: Ballet Clássico, Jazz, Hip Hop, Contemporâneo e Dança Urbana
• 4 categorias etárias: Infantil (5-11), Juvenil (12-17), Adulto (18-29) e Profissional (30+)
• 4 formações: Solo, Duo, Trio e Grupo (até 50 integrantes)

🏆 Premiação
• Sistema de medalhas: Ouro (≥9.0), Prata (8.0-8.9) e Bronze (7.0-7.9)
• 5 prêmios especiais: Melhor Bailarino(a), Revelação, Coreografia, Grupo da Noite e Figurino
• Avaliação por banca técnica de 3 jurados de renome nacional

🎟️ Ingressos para o público
• Inteira: R$30 (acesso aos 2 dias)
• Meia: R$15 (estudante, idoso, doador de sangue)
• Solidária: R$20 + 1kg de alimento não-perecível

🎭 Mais que uma competição: aula aberta de Contemporâneo, workshops com os jurados, espaço backstage para troca entre estúdios e festa de encerramento. Tudo em 2 dias intensos no Teatro Municipal de Demonstração.

Inscrições por lotes com desconto progressivo. Garante seu lugar no 1º lote!`
    const today = new Date()
    const startDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) // +30 dias
    const endDate   = new Date(today.getTime() + 32 * 24 * 60 * 60 * 1000) // +32 dias
    const regDeadline = new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000) // +20 dias

    const { data: ev, error: evErr } = await supa.from('events').insert([{
      name: eventName,
      description: eventDescription,
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
      // Site oficial: aponta pra propria vitrine pública do CoreoHub.
      // Demonstra como produtor pode usar a página gerada como site oficial
      // (smart default — mesmo padrão do chip "Usar página da vitrine" em
      // AccountSettings).
      website_event: `${Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'}/evento/demo-${user.id.slice(0, 8)}`,
      // Tolerância de idade + tempos de palco vivem em configuracoes
      // (não em events). UI lê de lá. Removido daqui pra evitar erro
      // de coluna inexistente no schema cache do PostgREST.
      // Politica de ingressos + lista
      politica_ingressos: 'INTERNO',
      ingressos_config: DEMO_INGRESSOS,
      // Tier 1: ativa "Vender pelo CoreoHub" no demo pra produtor ver o
      // botão "Comprar" funcionando. Defaults sandbox-friendly.
      audience_sales_enabled: true,
      audience_commission_percent: 10,
      audience_fee_mode: 'repassar',
      audience_max_per_cpf: 6,
      audience_max_per_purchase: 6,
      patrocinadores_config: DEMO_PATROCINADORES,
      programacao_config: DEMO_PROGRAMACAO,
      // Seletiva por vídeo — Modelo 3 (taxa A + análise + libera taxa B).
      // Configurado pro produtor testar end-to-end no demo sem precisar
      // ligar manualmente em /seletiva-de-video → Configurações.
      // Prazo de envio = 7 dias antes do evento (suficiente pra demo).
      video_selection_enabled: true,
      video_selection_fee: 30, // taxa A
      video_selection_fee_required: true, // bloqueia inscrição até aprovar
      video_fee_refund_policy: 'partial_refund',
      video_fee_partial_refund_percent: 50,
      video_submission_deadline: new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      video_evaluators_count: 1, // produtor solo (multi-jurado v1.1)
      video_evaluation_rule: 'majority',
      // Documentos extras + link de destaque na vitrine (migration 20260709).
      // O link de destaque usa texto genérico de propósito — não finge uma
      // integração real com o Voto Popular (infra isolada em outro projeto
      // Supabase, o seed não tem como replicar dados de lá).
      documentos_extras: [
        { nome: 'Ficha Técnica de Palco', url: DEMO_REGULATION_PDF },
        { nome: 'Mapa de Acesso ao Teatro', url: DEMO_REGULATION_PDF },
      ],
      destaque_link_url: `${Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'}/evento/demo-${user.id.slice(0, 8)}`,
      destaque_link_label: 'Confira a programação completa',
    }]).select('id').single()

    if (evErr || !ev) return json({ error: 'db_error', detail: evErr?.message ?? 'event' }, 500)
    const eventId = ev.id as string

    // 2b) Telão de Palco — reusa a RPC já existente (regenerate_telao_code
    // gera código + já marca telao_ativo=true) via o client autenticado do
    // próprio produtor (a RPC exige auth.uid() = events.created_by). Como já
    // marcamos uma coreografia como "ao vivo" mais abaixo (passo 5d),
    // telao_modo fica no default 'ao_vivo' — o Telão nasce mostrando algo
    // real, não a tela "aguardando". Best-effort: falha aqui não derruba o
    // resto do seed.
    try {
      const { error: telaoErr } = await userClient.rpc('regenerate_telao_code', { p_event_id: eventId })
      if (telaoErr) console.warn('Falha ao gerar código do Telão:', telaoErr.message)
    } catch (e: any) {
      console.warn('Falha ao gerar código do Telão:', e?.message ?? e)
    }

    // 2c) Avisos do produtor (event_announcements) — 2 exemplos pra testar
    // o card "Início" do inscrito sem precisar cadastrar na mão.
    try {
      const { error: avisosErr } = await supa.from('event_announcements').insert([
        { event_id: eventId, title: 'Bem-vindos ao CoreoHub Open!', body: 'Confiram o cronograma antes de chegar — a ordem de apresentação pode mudar em tempo real no dia.', active: true },
        { event_id: eventId, title: 'Backstage', body: 'Espaço reservado pros estúdios entre o Bloco 1 e o Bloco 2 — aproveitem pra trocar figurino com calma.', active: true },
      ])
      if (avisosErr) console.warn('Falha ao inserir avisos:', avisosErr.message)
    } catch (e: any) {
      console.warn('Falha ao inserir avisos:', e?.message ?? e)
    }

    // 3) configuracoes — critérios, prêmios, etc
    // Schema real: usa nomes 'estilos', 'formatos', 'categorias' (sem _config).
    // configuracoes.id eh TEXT (nao UUID), entao convertemos.
    const estilos = [...new Set(COREOGRAFIAS.map(c => c.estilo))].map(estilo => ({
      name: estilo,
      criterios: CRITERIOS_PADRAO,
    }))

    // Mesmo shape das categorias reais do Bheto (Usualdance) — omite min/max
    // quando a categoria não tem faixa fixa (Mista) em vez de forçar null.
    const categorias = CATEGORIAS_DEF.map(c => ({
      name: c.name,
      ...(c.min !== undefined ? { min: c.min } : {}),
      ...(c.max !== undefined ? { max: c.max } : {}),
    }))

    // 3 lotes com virada de data pra demonstrar pricing em ondas:
    //   1º lote (já encerrado, preço promocional)  — data_virada -10 dias atras
    //   2º lote (vigente)                           — data_virada +10 dias
    //   3º lote (último, preço cheio)               — data_virada +20 dias
    const lote1Virada = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const lote2Virada = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const lote3Virada = new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const precoBase = (f: string) => f === 'Solo' ? 80 : f === 'Duo' ? 60 : 50
    const sizeFor = (f: string) => {
      const min = f === 'Solo' ? 1 : f === 'Duo' ? 2 : f === 'Trio' ? 3 : f === 'Quarteto' ? 4 : f === 'Grupo' ? 5 : 9
      const max = f === 'Solo' ? 1 : f === 'Duo' ? 2 : f === 'Trio' ? 3 : f === 'Quarteto' ? 4 : f === 'Grupo' ? 8 : 50
      return { min, max }
    }
    const formatos = FORMACOES.map(f => {
      const { min, max } = sizeFor(f)
      return {
        name: f,
        // Salva em snake_case (wizard lê assim) E camelCase (AccountSettings UI).
        // Bug 2026-05-19: wizard "Adicionar bailarino" aparecia em Solo porque
        // max_members estava ausente → fallback 50.
        pricingType: f === 'Solo' ? 'FIXED' : 'PER_MEMBER',
        pricing_type: f === 'Solo' ? 'FIXED' : 'PER_MEMBER',
        minMembers: min,
        min_members: min,
        maxMembers: max,
        max_members: max,
        lotes: [
          { nome: '1º Lote (Promocional)', data_virada: lote1Virada, preco: Math.round(precoBase(f) * 0.7) },
          { nome: '2º Lote',               data_virada: lote2Virada, preco: Math.round(precoBase(f) * 0.85) },
          { nome: '3º Lote (Último)',      data_virada: lote3Virada, preco: precoBase(f) },
        ],
      }
    })

    // Pronuncia personalizada — exemplo demonstrando o feature
    const pronunciaPersonalizada = [
      { termo: 'CoreoHub',  pronuncia: 'Côreo Rrabe' },
      { termo: 'Pas',       pronuncia: 'Pá' },
    ]

    // UPSERT em vez de INSERT: trigger AFTER INSERT em events cria row vazia em
    // configuracoes com id=event_id, e INSERT cego falhava silenciosamente em
    // PK conflict — perdia premios_especiais, ingressos, programacao etc, e
    // por isso /premiacao mostrava "PRÊMIOS 0".
    await supa.from('configuracoes').upsert([{
      id: eventId,
      event_id: eventId,
      // AccountSettings hidrata cover_url/descricao/nome_evento/local_evento
      // de configuracoes (não de events) — espelhamos aqui pra UI mostrar
      // banner + descrição corretamente quando produtor abrir Configurações.
      nome_evento: eventName,
      local_evento: 'Teatro Municipal de Demonstração — Av. Paulista, 1000',
      cidade_estado: 'São Paulo / SP',
      hora_evento: '09:00',
      cover_url: DEMO_COVER_URL,
      descricao: eventDescription,
      escala_notas: 'BASE_10',
      premios_especiais: PREMIOS_ESPECIAIS,
      estilos,
      categorias,
      formatos,
      // Demo habilita AMBOS tipos pra produtor testar fluxo completo.
      // ~30% das registrations APROVADAS abaixo viram Avaliada.
      tipos_apresentacao: ['Competitiva', 'Avaliada'],
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
      // Tolerância de idade — permite até 1 integrante 1 ano fora da faixa
      // (regra padrão usada por festivais BR como Joinville).
      // tolerancia é jsonb — guardamos a regra completa pra UI ler.
      tolerancia: { mode: 'FIXED_COUNT', value: 1 },
      age_reference: 'EVENT_DAY',
      // age_tolerance_mode e age_tolerance_value foram REMOVIDOS — só
      // existem em types.ts (RegulationExtract) mas NUNCA foram criados
      // no banco. Tentar inseri-los fazia configuracoes insert falhar
      // silenciosamente → premios/jurados/categorias todos sumiam.
      // Politica de ingressos + lista (espelha events)
      politica_ingressos: 'INTERNO',
      ingressos_audiencia: DEMO_INGRESSOS,
      patrocinadores: DEMO_PATROCINADORES,
      programacao: DEMO_PROGRAMACAO,
      // Critérios de avaliação padrão (mesma estrutura do AccountSettings).
      // Sem isso, dashboard mostra alerta amarelo "Configure os critérios"
      // e jurados não conseguem dar notas no terminal.
      regras_avaliacao: {
        globalRules: {
          criterios: CRITERIOS_PADRAO,
          desempate: ['maior_media', ...CRITERIOS_PADRAO.map(c => `criterio_${c.name}`)],
        },
        overrides: {},
      },
    }], { onConflict: 'id' })

    // Espelha formacoes_config em events (algumas telas leem dali)
    await supa.from('events').update({ formacoes_config: formatos }).eq('id', eventId)

    // Eixo Técnico de verdade — grava Gênero + Subgênero na tabela real
    // event_styles (genreService.ts), não só a lista solta em
    // configuracoes.estilos (usada só pra critérios de avaliação por nome).
    // Até 2026-08-06 o demo nunca populava isso — a UI de Gêneros/Subgêneros
    // (AccountSettings → Avaliação) sempre aparecia vazia no demo.
    const eventStylesToInsert = GENEROS_SUBGENEROS.map(g => ({
      event_id: eventId,
      name: g.name,
      sub_types: g.subgeneros,
      is_active: true,
      requires_subcategory: g.subgeneros.length > 0,
      created_by: user.id,
    }))
    const { error: stylesErr } = await supa.from('event_styles').insert(eventStylesToInsert)
    if (stylesErr) console.warn('Falha ao inserir event_styles demo:', stylesErr.message)

    // 4) Inserir 3 jurados (com PINs e is_active)
    // judges schema (atualizado em 20260514): tem mini_bio, avatar_url,
    // instagram, competencias_generos[], is_public — usados pra exibir
    // cards profissionais na vitrine pública (Etapa 1.5).
    const judgesToInsert = JURADOS.map(j => ({
      name: j.name,
      pin: j.pin,
      is_active: true,
      is_public: true, // vai mostrar na seção "Jurados" da vitrine pública
      gender: j.gender,
      specialty: j.generos.join(', '), // legacy — mantido por compat
      mini_bio: j.mini_bio,
      avatar_url: j.avatar_url,
      instagram: j.instagram,
      competencias_generos: j.generos, // pra chips no card
      language: 'pt-BR',
      created_by: user.id,
    }))
    const { data: insertedJudges } = await supa
      .from('judges')
      .insert(judgesToInsert)
      .select('id, pin')
    const judgeIdByPin: Record<string, string> = {}
    ;(insertedJudges ?? []).forEach((j: any) => { judgeIdByPin[j.pin] = j.id })

    // Vincula os 3 jurados demo ao evento demo via event_judges (migration
    // 20260715). O trigger auto_assign_judges_to_new_event PULA eventos
    // is_demo=true de propósito (senão jurados REAIS do produtor voltariam a
    // vazar pro evento demo) — então esse vínculo precisa ser feito na mão,
    // só com os 3 jurados que acabamos de criar.
    if (insertedJudges && insertedJudges.length > 0) {
      const { error: ejErr } = await supa.from('event_judges').insert(
        insertedJudges.map((j: any) => ({ event_id: eventId, judge_id: j.id }))
      )
      if (ejErr) console.warn('Falha ao vincular jurados demo ao evento:', ejErr.message)
    }

    // 5) Distribuir 50 coreografias (status + pagamento aleatórios conforme spec)
    // Schema real corrigido:
    //   - formato_participacao (nao formacao)
    //   - bailarinos_detalhes (nao elenco)
    //   - valor_pago (nao preco)
    //   - status: PENDENTE | APROVADA | DESCLASSIFICADA (nao CANCELADA)
    //   - cidade/uf NAO existem em registrations (so em events)
    const totalRegs = 50

    // ── PASSO 1: pré-computa metadados das registrations + bailarinos crus ──
    // (precisa rodar antes de inserir elenco pra poder gerar ID por bailarino)
    type RegMeta = {
      coreo: typeof COREOGRAFIAS[number]
      formato: string
      estudio: typeof ESTUDIOS[number]
      categoria: string
      numBailarinos: number
      bailarinosRaw: { nome: string; cpf: string; data_nascimento: string }[]
    }
    const regMetas: RegMeta[] = []
    for (let i = 0; i < totalRegs; i++) {
      const coreo = COREOGRAFIAS[i % COREOGRAFIAS.length]
      const formato = pick(FORMACOES)
      const estudio  = pick(ESTUDIOS)
      const categoria = pick(CATEGORIAS)
      const numBailarinos = formacaoSize(formato)
      const bailarinosRaw = Array.from({ length: numBailarinos }, () => ({
        nome:            randomNomeCompleto(),
        cpf:             generateValidCpf(),
        data_nascimento: generateBirthDate(categoria),
      }))
      regMetas.push({ coreo, formato, estudio, categoria, numBailarinos, bailarinosRaw })
    }

    // ── Conflitos deliberados de bailarino ──
    // Sem isso, o demo nunca tem conflito real pro produtor testar "Gerar
    // Ordem Inteligente" — nomes são 100% aleatórios e nunca colidem por
    // acaso em 50 registros. Índices fixos (não aleatórios) garantem que
    // toda recriação do demo (própria ou de produtor) sempre nasce com os
    // mesmos 7 conflitos, em coreografias consecutivas (intervalo 1) pra
    // disparar o alerta com qualquer minInterval configurado.
    const CONFLICT_AT_INDEX = [1, 3, 7, 9, 11, 13, 18]
    for (const idx of CONFLICT_AT_INDEX) {
      if (idx <= 0 || idx >= regMetas.length) continue
      const prev = regMetas[idx - 1]
      const cur = regMetas[idx]
      if (prev.bailarinosRaw.length === 0 || cur.bailarinosRaw.length === 0) continue
      // Bailarino da coreografia atual "é" o mesmo da anterior — mesmo
      // nome, CPF/nascimento próprios preservados (conflito detecta por nome).
      cur.bailarinosRaw[cur.bailarinosRaw.length - 1].nome = prev.bailarinosRaw[0].nome
    }

    // ── PASSO 2: insere TODOS os bailarinos em `elenco` num batch ──
    // user_id = produtor do demo (memória licao-rls-elenco — RLS permite
    // produtor ler elenco referenciado em bailarinos_detalhes do evento dele).
    const elencoBatch = regMetas.flatMap(m =>
      m.bailarinosRaw.map(b => ({
        user_id:         user.id,
        nome:            b.nome,
        cpf:             b.cpf,
        data_nascimento: b.data_nascimento,
      }))
    )
    const { data: elencoCreated, error: elencoErr } = await supa
      .from('elenco')
      .insert(elencoBatch)
      .select('id, nome, cpf, data_nascimento')
    if (elencoErr) {
      await supa.from('events').delete().eq('id', eventId)
      return json({ error: 'db_error', detail: `elenco: ${elencoErr.message}` }, 500)
    }

    // Reconstrói bailarinos_detalhes com IDs reais do elenco recém-criado.
    // Mantém ordem: elenco rows vêm na ordem do insert (cada flat slot
    // corresponde a 1 bailarino em sequência).
    let elencoCursor = 0
    const registrationsToInsert: any[] = []
    for (let i = 0; i < totalRegs; i++) {
      const m = regMetas[i]
      const { coreo, formato, estudio, categoria } = m
      const bailarinos_detalhes = m.bailarinosRaw.map(() => {
        const e = elencoCreated![elencoCursor++]
        return {
          id:               e.id,
          nome:             e.nome,
          instagram_handle: null,
        }
      })

      // 90% APROVADA, 5% PENDENTE, 5% DESCLASSIFICADA
      const r = Math.random()
      const status = r < 0.9 ? 'APROVADA' : r < 0.95 ? 'PENDENTE' : 'DESCLASSIFICADA'

      // 90% CONFIRMADO, 10% PENDENTE
      const status_pagamento = Math.random() < 0.9 ? 'CONFIRMADO' : 'PENDENTE'

      const valor_pago = VALOR_POR_FORMATO[formato] ?? 200

      // Trilha sonora: 70% das APROVADAS tem trilha; resto fica pendente
      // (pra produtor testar tela de trilhas + filtro "Sem Trilha" no Schedule).
      const hasTrilha = status === 'APROVADA' && Math.random() < 0.7
      const trilha_url = hasTrilha ? DEMO_TRILHAS[i % DEMO_TRILHAS.length] : null
      const status_trilha = hasTrilha ? 'OK' : 'PENDENTE'

      // Tipo de apresentação: ~30% das APROVADAS viram Avaliada pra produtor
      // testar fluxo completo (terminal jurado em modo feedback, ResultsPanel
      // com aba Avaliada, MyResults sem nota). PENDENTES/REJEITADAS ficam
      // todas Competitiva (padrão).
      const tipoApresentacao = status === 'APROVADA' && Math.random() < 0.3
        ? 'Avaliada'
        : 'Competitiva'

      registrationsToInsert.push({
        event_id: eventId,
        nome_coreografia: coreo.nome,
        estilo_danca: coreo.estilo,
        categoria,
        formato_participacao: formato,
        tipo_apresentacao: tipoApresentacao,
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

    // Garante que cada jurado demo tenha pelo menos 1 apresentação
    // Competitiva E 1 Avaliada dentro dos próprios gêneros (competencias_
    // generos) — sem isso, o random de 30% pode deixar um jurado (ex.
    // Rodrigo Souza, só Hip Hop + Dança Urbana, subset menor) sem nenhuma
    // Avaliada na fila dele por puro azar, e quem testar o terminal com
    // aquele PIN nunca vê o modo "Mostra Avaliada" funcionando. Só
    // reclassifica dentro de APROVADA (PENDENTE/DESCLASSIFICADA seguem
    // sempre Competitiva por padrão, como já era).
    for (const jurado of JURADOS) {
      const generosNorm = jurado.generos.map(g => g.toLowerCase().trim())
      const matching = registrationsToInsert.filter((r: any) =>
        r.status === 'APROVADA' && generosNorm.includes(String(r.estilo_danca).toLowerCase().trim())
      )
      if (matching.length === 0) continue
      const hasCompetitiva = matching.some((r: any) => r.tipo_apresentacao === 'Competitiva')
      const hasAvaliada    = matching.some((r: any) => r.tipo_apresentacao === 'Avaliada')
      if (!hasAvaliada) {
        matching[0].tipo_apresentacao = 'Avaliada'
      } else if (!hasCompetitiva) {
        matching[0].tipo_apresentacao = 'Competitiva'
      }
    }

    const { data: insertedRegs, error: regErr } = await supa
      .from('registrations')
      .insert(registrationsToInsert)
      .select('id, nome_coreografia, estudio, status, tipo_apresentacao, formato_participacao')
    if (regErr) {
      // Rollback: deleta evento (CASCADE limpa o resto)
      await supa.from('events').delete().eq('id', eventId)
      return json({ error: 'db_error', detail: `registrations: ${regErr.message}` }, 500)
    }

    // 5b) Cronograma_blocos: 3 blocos (Manha / Tarde / Final).
    //     Distribui as APROVADAS por formato: Solo+Duo no Manha, Trio+Grupo na Tarde.
    //     Os "Final" recebe os 3 melhores de cada formato (escolha aleatoria pro demo).
    //     Manha+Tarde no Dia 1 (start_date), Final no Dia 2 (end_date) — evento demo
    //     já nasce com 3 dias de span (start→end), mostra a feature de separar
    //     numeração por dia (2026-08-03) em estado "interessante" desde o primeiro
    //     acesso, não vazio (mesmo princípio já documentado do demo mode).
    const diaUmStr = startDate.toISOString().split('T')[0]
    const diaDoisStr = endDate.toISOString().split('T')[0]
    let blocosCriadosOk = 0
    try {
      const { data: blocosInseridos } = await supa.from('cronograma_blocos').insert([
        { event_id: eventId, name: 'Bloco 1 — Manhã (Solos & Duos)', ordem: 0, cor: '#0ea5e9', data: diaUmStr },
        { event_id: eventId, name: 'Bloco 2 — Tarde (Trios & Grupos)', ordem: 1, cor: '#8b5cf6', data: diaUmStr },
        { event_id: eventId, name: 'Bloco 3 — Final (Highlights)',     ordem: 2, cor: '#ec4899', data: diaDoisStr },
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

    // 5e) Sistema de Deliberacao (Backlog #27): popular marcacoes_juri +
    //     deliberations + status do evento. Permite testar /deliberacoes,
    //     /conferencia e o gate de liberacao com dados realistas.
    let marcacoesOk = 0
    let deliberacoesOk = 0
    try {
      const aprovadas = (insertedRegs ?? []).filter((r: any) => r.status === 'APROVADA')
      const top9 = pickN(aprovadas, Math.min(9, aprovadas.length))
      const judgeArr = Object.values(judgeIdByPin)

      // Cada jurado marca 3 coreografias diferentes (rotaciona entre top 9)
      const marcacoesToInsert: any[] = []
      judgeArr.forEach((jid, jIdx) => {
        for (let i = 0; i < 3; i++) {
          const reg = top9[(jIdx * 3 + i) % top9.length]
          if (!reg) continue
          marcacoesToInsert.push({
            judge_id: jid,
            registration_id: reg.id,
            event_id: eventId,
            created_by: user.id,
          })
        }
      })
      if (marcacoesToInsert.length > 0) {
        const { error: mErr } = await supa.from('marcacoes_juri').insert(marcacoesToInsert)
        if (!mErr) marcacoesOk = marcacoesToInsert.length
        else console.warn('Falha ao inserir marcacoes_juri:', mErr.message)
      }

      // Atribuicoes (deliberations) — ~7 distribuidas entre os 5 premios.
      // Cada jurado atribui 2-3 das suas marcacoes a premios diferentes.
      const premiosArr = [
        { id: 'tpl_bailarino', name: 'Melhor Bailarino(a)' },
        { id: 'tpl_revelacao', name: 'Prêmio Revelação' },
        { id: 'tpl_coreografo', name: 'Melhor Coreografia' },
        { id: 'tpl_grupo', name: 'Melhor Grupo da Noite' },
        { id: 'tpl_figurino', name: 'Melhor Figurino' },
      ]
      const delibToInsert: any[] = []
      judgeArr.forEach((jid, jIdx) => {
        for (let i = 0; i < 3; i++) {
          const reg = top9[(jIdx * 3 + i) % top9.length]
          if (!reg) continue
          // Pula 1 das 3 atribuicoes por jurado pra mostrar estado parcial
          if (jIdx === 1 && i === 2) continue
          const premio = premiosArr[(jIdx + i) % premiosArr.length]
          delibToInsert.push({
            judge_id: jid,
            registration_id: reg.id,
            event_id: eventId,
            award_id: premio.id,
            award_name: premio.name,
            created_by: user.id,
          })
        }
      })
      if (delibToInsert.length > 0) {
        const { error: dErr } = await supa.from('deliberations').insert(delibToInsert)
        if (!dErr) deliberacoesOk = delibToInsert.length
        else console.warn('Falha ao inserir deliberations:', dErr.message)
      }

      // Avanca o evento DIRETO pra LIBERADO pra que /premiacao e /apuracao
      // mostrem o ciclo completo (com premios atribuidos visiveis ao produtor).
      // User pode reverter manualmente pra COLETANDO/DELIBERACAO/CONFERENCIA
      // pra testar fases anteriores.
      await supa
        .from('events')
        .update({
          deliberation_status: 'LIBERADO',
          deliberation_released_at: new Date().toISOString(),
          deliberation_released_by: user.id,
        })
        .eq('id', eventId)
    } catch (e: any) {
      console.warn('Falha no seed de deliberation:', e?.message ?? e)
    }

    // 5f) Voto Popular — preenche o vencedor (fake, sem conexão real com o
    // produto isolado Voto Popular) só pra mostrar como fica um prêmio
    // manual JÁ revelado. Precisa de uma registration real pra referenciar
    // nome/estúdio, por isso só dá pra fazer aqui (depois de 5)).
    try {
      const aprovadas = (insertedRegs ?? []).filter((r: any) => r.status === 'APROVADA')
      if (aprovadas.length > 0) {
        const votoWinner = pick(aprovadas) as any
        const premiosComVoto = PREMIOS_ESPECIAIS.map(p =>
          p.id === 'tpl_voto_popular'
            ? { ...p, winner_nome: votoWinner.nome_coreografia, winner_estudio: votoWinner.estudio || null, winner_revealed: true }
            : p
        )
        const { error: votoErr } = await supa
          .from('configuracoes')
          .update({ premios_especiais: premiosComVoto })
          .eq('id', eventId)
        if (votoErr) console.warn('Falha ao definir vencedor do Voto Popular:', votoErr.message)
      }
    } catch (e: any) {
      console.warn('Falha ao definir vencedor do Voto Popular:', e?.message ?? e)
    }

    // 6) Seletiva de Vídeo: 20 inscrições PENDENTES com vídeo submitted
    //    pra produtor testar fluxo de aprovar/reprovar em /seletiva-video.
    //    video_url = placeholder publico (Big Buck Bunny). O importante eh
    //    o produtor testar os botoes de aprovar/reprovar — nao o player.
    //    Bailarinos vão pra `elenco` (CPF+data) — mesma lógica do bloco 5.
    const submittedAt = new Date().toISOString()
    const seletivaMetas = COREOGRAFIAS_SELETIVA.map(coreo => {
      const formato = pick(FORMACOES)
      const estudio = pick(ESTUDIOS)
      const categoria = pick(CATEGORIAS)
      const numBailarinos = formacaoSize(formato)
      const bailarinosRaw = Array.from({ length: numBailarinos }, () => ({
        nome:            randomNomeCompleto(),
        cpf:             generateValidCpf(),
        data_nascimento: generateBirthDate(categoria),
      }))
      return { coreo, formato, estudio, categoria, bailarinosRaw }
    })
    const seletivaElencoBatch = seletivaMetas.flatMap(m =>
      m.bailarinosRaw.map(b => ({
        user_id:         user.id,
        nome:            b.nome,
        cpf:             b.cpf,
        data_nascimento: b.data_nascimento,
      }))
    )
    const { data: seletivaElenco, error: seletivaElencoErr } = await supa
      .from('elenco')
      .insert(seletivaElencoBatch)
      .select('id, nome')
    if (seletivaElencoErr) {
      console.warn('Falha ao inserir elenco da seletiva:', seletivaElencoErr.message)
    }
    let seletivaCursor = 0
    const seletivaToInsert = seletivaMetas.map((m, i) => {
      const { coreo, formato, estudio, categoria } = m
      const bailarinos_detalhes = m.bailarinosRaw.map(() => {
        const e = seletivaElenco?.[seletivaCursor++]
        return e
          ? { id: e.id, nome: e.nome, instagram_handle: null }
          : { nome: m.bailarinosRaw[0].nome }  // fallback se elenco falhou
      })
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
        valor_pago: VALOR_POR_FORMATO[formato] ?? 200,
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
          const p = premiosParaNomear[premioIdx]
          nominations.push({ award_id: p.id, award_name: p.name })
          // Top 1 ganha nomination extra pra Melhor Coreografia (idx=2)
          if (idx === 0 && judgeIdx === 0) {
            const p2 = premiosParaNomear[2]
            nominations.push({ award_id: p2.id, award_name: p2.name })
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

    // ─── 8) Workshops + lotes (Etapa 1) ────────────────────────────────────
    // Cria 4 workshops com diversidade de modos. Suffix de timestamp evita
    // colisão de slug UNIQUE quando produtor regera demo várias vezes.
    const slugSuffix = Date.now().toString(36).slice(-5)
    const eventDateStr = startDate.toISOString().slice(0, 10)  // YYYY-MM-DD
    const wsBaseDate = new Date(eventDateStr + 'T09:00:00')
    const workshopsToInsert = DEMO_WORKSHOPS.map((w, i) => {
      const dataInicio = new Date(wsBaseDate.getTime() + i * 4 * 3600000)  // espaça 4h
      const dataFim = new Date(dataInicio.getTime() + (w.duracao_minutos ?? 90) * 60000)
      return {
        event_id: w.standalone ? null : eventId,
        created_by: user.id,
        name: w.nome,
        slug: `${w.slug_base}-${slugSuffix}`,
        description: w.descricao,
        cover_url: w.cover_url,
        professor_name: w.professor_name,
        professor_bio: w.professor_bio,
        professor_bio_short: w.professor_bio_short,
        professor_photo_url: w.professor_photo_url,
        professor_instagram: w.professor_instagram,
        professor_is_public: true,
        modalidade: w.modalidade,
        nivel: w.nivel,
        data_inicio: dataInicio.toISOString(),
        data_fim: dataFim.toISOString(),
        duracao_minutos: w.duracao_minutos,
        local: w.standalone ? 'Estúdio CoreoHub — São Paulo' : 'Sala 2 — Teatro Principal',
        capacidade_max: w.capacidade_max,
        preco_padrao: w.preco_padrao,
        preco_inscritos_mostra: w.preco_inscritos_mostra,
        gratis_para_inscritos: w.gratis_para_inscritos,
        auto_detect_combo: w.auto_detect_combo,
        workshop_commission_percent: 10,
        workshop_fee_mode: 'repassar',
        workshop_max_per_cpf: 4,
        workshop_reservation_minutes: 10,
        is_published: true,
      }
    })
    const { data: insertedWorkshops, error: wsErr } = await supa
      .from('workshops')
      .insert(workshopsToInsert)
      .select('id, name, professor_name, modalidade, data_inicio, duracao_minutos, preco_padrao, gratis_para_inscritos')

    let workshopsOk = 0
    let lotesOk = 0
    let workshopRegsOk = 0
    if (wsErr) {
      console.warn('Falha ao inserir workshops:', wsErr.message)
    } else if (insertedWorkshops && insertedWorkshops.length > 0) {
      workshopsOk = insertedWorkshops.length

      // Lotes: só pro 1º workshop (DEMO_WORKSHOPS[0].tem_lotes=true)
      const ws0 = insertedWorkshops[0]
      const lotsToInsert = [
        { workshop_id: ws0.id, ordem: 1, nome: 'Pré-evento', preco: 60, preco_inscritos_mostra: 40, quantidade_maxima: 15, is_active: true },
        { workshop_id: ws0.id, ordem: 2, nome: 'Regular',    preco: 90, preco_inscritos_mostra: 60, quantidade_maxima: null, is_active: true },
      ]
      const { error: lotsErr } = await supa.from('workshop_lots').insert(lotsToInsert)
      if (lotsErr) console.warn('Falha lots:', lotsErr.message)
      else lotesOk = lotsToInsert.length

      // Workshop registrations: ~3-5 por workshop, mix de status
      const workshopRegsToInsert: any[] = []
      insertedWorkshops.forEach((ws: any, wsIdx: number) => {
        const numRegs = wsIdx === 3 ? 4 : 5  // standalone tem 4, outros 5
        for (let i = 0; i < numRegs; i++) {
          const isFem = Math.random() < 0.7
          const nome = randomNomeCompleto(isFem)
          const cpf = generateValidCpf()
          const phone = `119${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`
          // Mix de status: 60% APROVADO (pago), 15% GRATUITO (combo grátis),
          // 10% CORTESIA, 10% PENDENTE, 5% CANCELADO
          const r = Math.random()
          let status = 'APROVADO'
          if (r < 0.05) status = 'CANCELADO'
          else if (r < 0.15) status = 'PENDENTE'
          else if (r < 0.25) status = 'CORTESIA'
          else if (r < 0.40 && (DEMO_WORKSHOPS[wsIdx]?.gratis_para_inscritos)) status = 'GRATUITO'
          // attended=true só pra APROVADO ou GRATUITO ou CORTESIA, e só pra metade
          const isAttendable = ['APROVADO', 'GRATUITO', 'CORTESIA'].includes(status)
          const attended = isAttendable && Math.random() < 0.7
          const preco = status === 'GRATUITO' || status === 'CORTESIA' ? 0 : Number(DEMO_WORKSHOPS[wsIdx]?.preco_padrao ?? 0)
          const commission = preco > 0 ? +(preco * 0.1).toFixed(2) : 0
          workshopRegsToInsert.push({
            workshop_id: ws.id,
            workshop_lot_id: null,
            lot_nome: null,
            lot_ordem: null,
            buyer_name: nome,
            buyer_email: `${nome.toLowerCase().replace(/\s+/g, '.').normalize('NFD').replace(/[̀-ͯ]/g, '')}@demo.coreohub.local`,
            buyer_cpf: cpf,
            buyer_phone: phone,
            user_id: null,
            combo_registration_id: null,
            is_combo: status === 'GRATUITO',
            preco_base: preco,
            preco_pago: preco,
            status_pagamento: status,
            commission_amount: commission,
            producer_amount: preco - commission,
            fee_mode: 'repassar',
            attended,
            attended_at: attended ? new Date().toISOString() : null,
            paid_at: ['APROVADO', 'GRATUITO', 'CORTESIA'].includes(status) ? new Date().toISOString() : null,
            payment_method: status === 'APROVADO' ? 'CREDIT_CARD' : null,
          })
        }
      })
      const { error: wrErr } = await supa.from('workshop_registrations').insert(workshopRegsToInsert)
      if (wrErr) console.warn('Falha workshop_registrations:', wrErr.message)
      else workshopRegsOk = workshopRegsToInsert.length
    }

    // ─── 8b) Workshop Pass — combo cobrindo os 2 primeiros workshops
    //     vinculados ao evento (índices 0/1 de DEMO_WORKSHOPS, ambos com
    //     event_id preenchido — o 4º workshop é standalone e não entra).
    if (insertedWorkshops && insertedWorkshops.length >= 2) {
      try {
        const { data: pass, error: passErr } = await supa
          .from('workshop_passes')
          .insert([{
            event_id: eventId,
            created_by: user.id,
            name: 'Day Pass — Sábado',
            description: 'Acesso aos 2 workshops do dia com desconto pra quem leva os dois.',
            preco: 130,
            preco_inscritos_mostra: 90,
            auto_detect_combo: true,
            pass_commission_percent: 10,
            pass_fee_mode: 'repassar',
            pass_max_per_cpf: 1,
            pass_reservation_minutes: 10,
            is_published: true,
          }])
          .select('id')
          .single()
        if (passErr || !pass) {
          console.warn('Falha ao criar workshop_pass:', passErr?.message)
        } else {
          const { error: itemsErr } = await supa.from('workshop_pass_items').insert([
            { pass_id: pass.id, workshop_id: insertedWorkshops[0].id },
            { pass_id: pass.id, workshop_id: insertedWorkshops[1].id },
          ])
          if (itemsErr) console.warn('Falha ao inserir workshop_pass_items:', itemsErr.message)
        }
      } catch (e: any) {
        console.warn('Falha no seed de workshop_pass:', e?.message ?? e)
      }
    }

    // ─── 9) Cupons (Tier 2 plateia + Workshops) ─────────────────────────────
    let couponsOk = 0
    const couponsToInsert = DEMO_COUPONS.map(c => ({
      event_id: eventId,
      code: c.code,
      discount_type: c.discount_type,
      discount_value: c.discount_value,
      max_uses: c.max_uses,
      max_uses_per_user: c.max_uses_per_user,
      used_count: 0,
      is_active: true,
      scopes: c.scopes,                      // canônico (TEXT[], migration 20260615)
      scope: deriveScopeLegacy(c.scopes),    // legacy em sync pro fallback
    }))
    const { error: cpErr } = await supa.from('coupons').insert(couponsToInsert)
    if (cpErr) console.warn('Falha coupons:', cpErr.message)
    else couponsOk = couponsToInsert.length

    // ─── 10) Audience tickets demo (Tier 2 plateia) ────────────────────────
    // ~25 tickets distribuídos entre os 3 tipos, mix de status pra dashboard.
    let audienceTicketsOk = 0
    const audienceTicketsToInsert: any[] = []
    for (let i = 0; i < 25; i++) {
      const typeIdx = i % DEMO_INGRESSOS.length
      const t = DEMO_INGRESSOS[typeIdx]
      const isFem = Math.random() < 0.55
      const nome = randomNomeCompleto(isFem)
      const cpf = generateValidCpf()
      const r = Math.random()
      // 75% APROVADO, 10% PENDENTE, 8% CANCELADO, 5% ESTORNADO, 2% CORTESIA
      let status = 'APROVADO'
      if (r < 0.02) status = 'CORTESIA'
      else if (r < 0.07) status = 'ESTORNADO'
      else if (r < 0.15) status = 'CANCELADO'
      else if (r < 0.25) status = 'PENDENTE'
      const kind = t.nome.toLowerCase().includes('meia') ? 'meia'
        : t.nome.toLowerCase().includes('solid') ? 'solidaria' : 'inteira'
      const commission = +(Number(t.preco) * 0.1).toFixed(2)
      audienceTicketsToInsert.push({
        event_id: eventId,
        ticket_type_id: String(typeIdx),
        ticket_type_nome: t.nome,
        ticket_type_kind: kind,
        preco: Number(t.preco),
        buyer_name: nome,
        buyer_email: `${nome.toLowerCase().replace(/\s+/g, '.').normalize('NFD').replace(/[̀-ͯ]/g, '')}@demo.coreohub.local`,
        buyer_cpf: cpf,
        buyer_phone: null,
        status_pagamento: status,
        check_in_status: status === 'APROVADO' && Math.random() < 0.4 ? 'OK' : 'PENDENTE',
        check_in_at: null,
        commission_amount: commission,
        producer_amount: Number(t.preco) - commission,
        fee_mode: 'repassar',
        paid_at: ['APROVADO', 'CORTESIA'].includes(status) ? new Date().toISOString() : null,
        payment_method: status === 'APROVADO' ? 'PIX' : null,
      })
    }
    const { error: atErr } = await supa.from('audience_tickets').insert(audienceTicketsToInsert)
    if (atErr) console.warn('Falha audience_tickets:', atErr.message)
    else audienceTicketsOk = audienceTicketsToInsert.length

    // ─── 11) Certificate templates — REMOVIDO DE PROPÓSITO (2026-07-15) ────
    // certificate_templates é por PRODUTOR, não por evento (UNIQUE(producer_id,
    // template_type), sem coluna event_id). O código que existia aqui deletava
    // + recriava os templates do produtor a cada regeneração do demo — isso
    // sobrescreveu de verdade o certificado "Ouro Real" que o Hemer configurou
    // pro Usualdance Festival (incidente real, descoberto rodando o smoke test
    // desta mudança). certificates_issued (que dependia do template criado
    // aqui) foi removido junto. Ver CLAUDE.md.

    // ─── 12) Demo team — 3 staff fakes pra popular /minha-equipe ───────────
    // Cria 3 auth.users via admin API com metadata flag pra cleanup. Email
    // pattern dedicado (`-${userIdShort}@coreohub-demo.local`) garante que
    // o delete bate só nos staffs DESTE produtor demo.
    let teamOk = 0
    const userIdShortStaff = user.id.slice(0, 8)
    const STAFF_PERMS_DEFAULT = {
      financeiro: false, validar_pagamentos: false,
      cronograma_leitura: true, cronograma_editar: false,
      checkin_inscritos: false, checkin_ingressos: false,
      checkin_workshops: false, checkin_equipe: false, checkin_jurados: false,
      marcacao_palco: false,
      suporte_juri: false, inscricoes_leitura: false,
      triagem: false, vendas_ingressos: false,
    }
    const staffSpec: Array<{ role: string; full_name: string; cargo: string; perms: Record<string, boolean> }> = [
      {
        role: 'COORDENADOR',
        full_name: 'Renata Lopes',
        cargo: 'Coordenadora geral [DEMO]',
        perms: { ...STAFF_PERMS_DEFAULT, cronograma_editar: true, checkin_inscritos: true, checkin_ingressos: true, checkin_workshops: true, checkin_equipe: true, checkin_jurados: true, marcacao_palco: true, suporte_juri: true, inscricoes_leitura: true, triagem: true, vendas_ingressos: true },
      },
      {
        role: 'SONOPLASTA',
        full_name: 'Bruno Yamada',
        cargo: 'Sonoplasta [DEMO]',
        perms: { ...STAFF_PERMS_DEFAULT, cronograma_editar: true },
      },
      {
        role: 'PALCO',
        full_name: 'Camila Tavares',
        cargo: 'Marcadora de palco [DEMO]',
        perms: { ...STAFF_PERMS_DEFAULT, marcacao_palco: true },
      },
    ]
    for (const s of staffSpec) {
      const email = `staff-${s.role.toLowerCase()}-${userIdShortStaff}@coreohub-demo.local`
      try {
        // Recover path: se cleanup anterior deixou auth.user órfão (sem profile),
        // o createUser falha com email-exists. Tenta achar e deletar pra recriar limpo.
        let { data: created, error: cuErr } = await supa.auth.admin.createUser({
          email,
          password: crypto.randomUUID(),
          email_confirm: true,
          user_metadata: {
            full_name: s.full_name,
            demo_creator_id: user.id,
            is_demo: true,
          },
        })
        if (cuErr && cuErr.message?.toLowerCase().includes('already')) {
          console.warn(`[demo-team] ${s.role} já existia em auth.users — limpando órfão`)
          try {
            const { data: list } = await supa.auth.admin.listUsers({ page: 1, perPage: 200 })
            const orphan = list?.users?.find(u => u.email === email)
            if (orphan) {
              await supa.auth.admin.deleteUser(orphan.id)
              const retry = await supa.auth.admin.createUser({
                email, password: crypto.randomUUID(), email_confirm: true,
                user_metadata: { full_name: s.full_name, demo_creator_id: user.id, is_demo: true },
              })
              created = retry.data; cuErr = retry.error
            }
          } catch (e) {
            console.warn(`[demo-team] falha no recover de ${s.role}:`, e)
          }
        }
        if (cuErr || !created?.user) {
          console.warn(`[demo-team] FALHOU createUser ${s.role}:`, cuErr?.message ?? 'sem user')
          continue
        }
        // Trigger handle_new_user já criou profile com role=USER. UPDATE pra papel real.
        // service_role bypassa o trigger protect_profiles_privileged_columns.
        const { error: upErr } = await supa
          .from('profiles')
          .update({
            role: s.role,
            cargo: s.cargo,
            permissoes_custom: s.perms,
            full_name: s.full_name,
            email,
          })
          .eq('id', created.user.id)
        if (upErr) {
          console.warn(`[demo-team] FALHOU update profile ${s.role}:`, upErr.message)
          continue
        }
        console.log(`[demo-team] OK ${s.role} criado: ${created.user.id}`)
        teamOk++
      } catch (e) {
        console.warn(`Exceção criando staff ${s.role}:`, e)
      }
    }

    return json({
      ok: true,
      event_id: eventId,
      stats: {
        team: teamOk,
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
        marcacoes_juri: marcacoesOk,
        deliberations: deliberacoesOk,
        // Etapa 1+2:
        workshops: workshopsOk,
        workshop_lots: lotesOk,
        workshop_registrations: workshopRegsOk,
        coupons: couponsOk,
        audience_tickets: audienceTicketsOk,
      },
    })
  }

  return json({ error: 'unknown_action' }, 400)
})
