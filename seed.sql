-- ================================================================
-- DANCE PRO FESTIVAL — SEED DE DADOS CORRIGIDO v2
-- Baseado nas colunas reais verificadas no banco
-- Execute no SQL Editor do Supabase
-- ================================================================

SET session_replication_role = replica;

DO $$
DECLARE
  -- ── Usuários ──────────────────────────────────────────────
  v_admin_id      UUID := 'a0000000-0000-0000-0000-000000000001';
  v_producer_id   UUID := 'a0000000-0000-0000-0000-000000000002';
  v_inscrito1_id  UUID := 'a0000000-0000-0000-0000-000000000011';
  v_inscrito2_id  UUID := 'a0000000-0000-0000-0000-000000000012';
  v_inscrito3_id  UUID := 'a0000000-0000-0000-0000-000000000013';
  v_inscrito4_id  UUID := 'a0000000-0000-0000-0000-000000000014';
  v_inscrito5_id  UUID := 'a0000000-0000-0000-0000-000000000015';
  v_inscrito6_id  UUID := 'a0000000-0000-0000-0000-000000000016';
  v_inscrito7_id  UUID := 'a0000000-0000-0000-0000-000000000017';
  v_inscrito8_id  UUID := 'a0000000-0000-0000-0000-000000000018';

  -- ── Evento e Config ────────────────────────────────────────
  v_event_id      UUID := 'b0000000-0000-0000-0000-000000000001';
  v_config_id     UUID := 'b0000000-0000-0000-0000-000000000002';

  -- ── Jurados ────────────────────────────────────────────────
  v_judge1_id     UUID := 'c0000000-0000-0000-0000-000000000001';
  v_judge2_id     UUID := 'c0000000-0000-0000-0000-000000000002';
  v_judge3_id     UUID := 'c0000000-0000-0000-0000-000000000003';
  v_judge4_id     UUID := 'c0000000-0000-0000-0000-000000000004';
  v_judge5_id     UUID := 'c0000000-0000-0000-0000-000000000005';
  v_judge6_id     UUID := 'c0000000-0000-0000-0000-000000000006';

  -- ── Inscrições ────────────────────────────────────────────
  v_reg01_id      UUID := 'd0000000-0000-0000-0000-000000000001';
  v_reg02_id      UUID := 'd0000000-0000-0000-0000-000000000002';
  v_reg03_id      UUID := 'd0000000-0000-0000-0000-000000000003';
  v_reg04_id      UUID := 'd0000000-0000-0000-0000-000000000004';
  v_reg05_id      UUID := 'd0000000-0000-0000-0000-000000000005';
  v_reg06_id      UUID := 'd0000000-0000-0000-0000-000000000006';
  v_reg07_id      UUID := 'd0000000-0000-0000-0000-000000000007';
  v_reg08_id      UUID := 'd0000000-0000-0000-0000-000000000008';
  v_reg09_id      UUID := 'd0000000-0000-0000-0000-000000000009';
  v_reg10_id      UUID := 'd0000000-0000-0000-0000-000000000010';
  v_reg11_id      UUID := 'd0000000-0000-0000-0000-000000000011';
  v_reg12_id      UUID := 'd0000000-0000-0000-0000-000000000012';
  v_reg13_id      UUID := 'd0000000-0000-0000-0000-000000000013';
  v_reg14_id      UUID := 'd0000000-0000-0000-0000-000000000014';
  v_reg15_id      UUID := 'd0000000-0000-0000-0000-000000000015';
  v_reg16_id      UUID := 'd0000000-0000-0000-0000-000000000016';
  v_reg17_id      UUID := 'd0000000-0000-0000-0000-000000000017';
  v_reg18_id      UUID := 'd0000000-0000-0000-0000-000000000018';
  v_reg19_id      UUID := 'd0000000-0000-0000-0000-000000000019';
  v_reg20_id      UUID := 'd0000000-0000-0000-0000-000000000020';
  v_reg21_id      UUID := 'd0000000-0000-0000-0000-000000000021';

BEGIN

-- ================================================================
-- 1. PROFILES
-- Colunas confirmadas: id, full_name, email, role
-- + mp_user_id, mp_access_token, mp_connected_at (adicionadas via ALTER)
-- ================================================================
INSERT INTO profiles (id, full_name, email, role, mp_user_id, mp_access_token, mp_connected_at)
VALUES
  (v_admin_id,    'Super Admin Teste',      'admin@dancepro.com',    'USUALDANCE_ADMIN', NULL, NULL, NULL),
  (v_producer_id, 'Carlos Produtor',        'produtor@dancepro.com', 'ORGANIZER', '2490934794', 'APP_USR-TEST-TOKEN', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, full_name, email, role)
VALUES
  (v_inscrito1_id, 'Studio Ballet Lumiere', 'lumiere@studio.com',   'CHOREOGRAPHER'),
  (v_inscrito2_id, 'Cia Dança Urbana',       'urbana@cia.com',       'CHOREOGRAPHER'),
  (v_inscrito3_id, 'Ana Lima',               'ana@lima.com',         'INDEPENDENT'),
  (v_inscrito4_id, 'Studio K-Move',          'kmove@studio.com',     'CHOREOGRAPHER'),
  (v_inscrito5_id, 'Pedro Dance',            'pedro@dance.com',      'INDEPENDENT'),
  (v_inscrito6_id, 'Grupo Contemporâneo SP', 'gcontemp@sp.com',      'STUDIO_DIRECTOR'),
  (v_inscrito7_id, 'Studio Jazz Brasil',     'jazz@brasil.com',      'CHOREOGRAPHER'),
  (v_inscrito8_id, 'Maria Santos',           'maria@santos.com',     'INDEPENDENT')
ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- 2. EVENTO
-- Colunas confirmadas: id, name, description, start_date, end_date,
--   location, event_date, nome_evento, created_by, scoring_system,
--   commission_type, commission_percent, commission_fixed,
--   video_selection_enabled
-- ================================================================
INSERT INTO events (
  id, name, description,
  start_date, end_date, event_date,
  location, nome_evento,
  created_by, scoring_system,
  commission_type, commission_percent, commission_fixed,
  video_selection_enabled
)
VALUES (
  v_event_id,
  'Dance Pro Festival 2026',
  'O maior festival de dança do estado! Competição em diversas modalidades com os melhores jurados do país.',
  '2026-07-10', '2026-07-12', '2026-07-10',
  'Teatro Municipal — Av. São João, 330 - Centro, São Paulo - SP',
  'Dance Pro Festival 2026',
  v_producer_id,
  'BASE_10',
  'percent', 10.00, 0.00,
  false
)
ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- 3. CONFIGURAÇÕES DO EVENTO
-- Colunas confirmadas: id, event_id, prazo_inscricao,
--   valor_inscricao_solo, valor_inscricao_conjunto, limite_inscricoes,
--   estilos_permitidos, formatos_precos, categorias_predefinidas,
--   nome_festival, local_evento, atualizado_em
-- ================================================================
INSERT INTO configuracoes (
  id, event_id,
  nome_festival, local_evento,
  prazo_inscricao,
  valor_inscricao_solo, valor_inscricao_conjunto,
  limite_inscricoes,
  estilos_permitidos,
  formatos_precos,
  categorias_predefinidas,
  atualizado_em
)
VALUES (
  v_config_id,
  v_event_id,
  'Dance Pro Festival 2026',
  'Teatro Municipal — São Paulo, SP',
  '2026-06-30',
  80.00,
  160.00,
  100,
  '["Ballet Clássico","Hip Hop","Contemporâneo","Jazz","K-Pop","Danças Urbanas"]'::jsonb,
  '[
    {"nome":"Solo",       "preco":80.00,  "min":1,  "max":1},
    {"nome":"Duo",        "preco":120.00, "min":2,  "max":2},
    {"nome":"Trio",       "preco":140.00, "min":3,  "max":3},
    {"nome":"Grupo",      "preco":160.00, "min":4,  "max":15},
    {"nome":"Supergrupo", "preco":200.00, "min":16, "max":50}
  ]'::jsonb,
  '[
    {"nome":"Infantil","idade_min":5, "idade_max":11},
    {"nome":"Juvenil", "idade_min":12,"idade_max":17},
    {"nome":"Adulto",  "idade_min":18,"idade_max":99},
    {"nome":"Misto",   "idade_min":5, "idade_max":99}
  ]'::jsonb,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- 4. JURADOS
-- Colunas confirmadas: id, name, specialty, avatar_url,
--   language, assigned_categories, is_active
-- ================================================================
INSERT INTO judges (id, name, specialty, avatar_url, language, assigned_categories, is_active)
VALUES
  (v_judge1_id, 'Fernanda Oliveira',
   'Ballet Clássico, Contemporâneo',
   'https://i.pravatar.cc/150?img=1', 'pt',
   '["Infantil","Juvenil","Adulto"]'::jsonb, true),

  (v_judge2_id, 'Marcos Vinicius',
   'Hip Hop, Danças Urbanas, Dança de Rua',
   'https://i.pravatar.cc/150?img=2', 'pt',
   '["Juvenil","Adulto"]'::jsonb, true),

  (v_judge3_id, 'Carla Rodrigues',
   'Contemporâneo, Jazz',
   'https://i.pravatar.cc/150?img=3', 'pt',
   '["Infantil","Juvenil","Adulto"]'::jsonb, true),

  (v_judge4_id, 'Diego Park',
   'K-Pop, Jazz',
   'https://i.pravatar.cc/150?img=4', 'pt',
   '["Juvenil","Adulto"]'::jsonb, true),

  (v_judge5_id, 'Ana Beatriz Costa',
   'Jazz, Contemporâneo, Ballet Clássico',
   'https://i.pravatar.cc/150?img=5', 'pt',
   '["Infantil","Juvenil","Adulto"]'::jsonb, true),

  (v_judge6_id, 'Roberto Alves',
   'Hip Hop, Dança de Rua, Danças Urbanas',
   'https://i.pravatar.cc/150?img=6', 'pt',
   '["Juvenil","Adulto"]'::jsonb, true)

ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- 5. INSCRIÇÕES — 21 registros
-- Colunas confirmadas: id, event_id, user_id, status, created_at,
--   valor_pago, status_pagamento, nome_coreografia,
--   tipo_apresentacao, estilo_danca, data_inscricao
-- ================================================================
INSERT INTO registrations (
  id, event_id, user_id,
  nome_coreografia, tipo_apresentacao, estilo_danca,
  status, status_pagamento,
  valor_pago, data_inscricao, created_at
)
VALUES
  -- ── SOLOS CONFIRMADOS (5) ────────────────────────────────
  (v_reg01_id, v_event_id, v_inscrito3_id, 'Solidão',          'Solo', 'Contemporâneo',  'APROVADA','CONFIRMADO',  80.00, '2026-05-01', NOW()-INTERVAL '5 days'),
  (v_reg02_id, v_event_id, v_inscrito3_id, 'Força Interior',   'Solo', 'Ballet Clássico','APROVADA','CONFIRMADO',  80.00, '2026-05-01', NOW()-INTERVAL '5 days'),
  (v_reg03_id, v_event_id, v_inscrito8_id, 'Florescer',        'Solo', 'Ballet Clássico','APROVADA','CONFIRMADO',  80.00, '2026-05-02', NOW()-INTERVAL '4 days'),
  (v_reg04_id, v_event_id, v_inscrito5_id, 'Na Quebrada',      'Solo', 'Hip Hop',        'APROVADA','CONFIRMADO',  80.00, '2026-05-02', NOW()-INTERVAL '4 days'),
  (v_reg05_id, v_event_id, v_inscrito5_id, 'K-Style Solo',     'Solo', 'K-Pop',          'APROVADA','CONFIRMADO',  80.00, '2026-05-03', NOW()-INTERVAL '4 days'),

  -- ── DUOS CONFIRMADOS (3) ─────────────────────────────────
  (v_reg06_id, v_event_id, v_inscrito1_id, 'Pas de Deux Moderno','Duo','Contemporâneo',  'APROVADA','CONFIRMADO', 120.00, '2026-05-01', NOW()-INTERVAL '5 days'),
  (v_reg07_id, v_event_id, v_inscrito2_id, 'Street Duo',       'Duo', 'Hip Hop',        'APROVADA','CONFIRMADO', 120.00, '2026-05-03', NOW()-INTERVAL '3 days'),
  (v_reg08_id, v_event_id, v_inscrito4_id, 'Twin K-Pop',       'Duo', 'K-Pop',          'APROVADA','CONFIRMADO', 120.00, '2026-05-03', NOW()-INTERVAL '3 days'),

  -- ── TRIOS CONFIRMADOS (2) ────────────────────────────────
  (v_reg09_id, v_event_id, v_inscrito7_id, 'Jazz Trio Explosion','Trio','Jazz',          'APROVADA','CONFIRMADO', 140.00, '2026-05-01', NOW()-INTERVAL '5 days'),
  (v_reg10_id, v_event_id, v_inscrito1_id, 'Pointe Trio',      'Trio','Ballet Clássico', 'APROVADA','CONFIRMADO', 140.00, '2026-05-02', NOW()-INTERVAL '4 days'),

  -- ── GRUPOS CONFIRMADOS (3) — stress test de palco ────────
  (v_reg11_id, v_event_id, v_inscrito1_id, 'Ballet das Flores', 'Grupo','Ballet Clássico','APROVADA','CONFIRMADO',160.00,'2026-04-25', NOW()-INTERVAL '6 days'),
  (v_reg12_id, v_event_id, v_inscrito2_id, 'Urban Crew Attack', 'Grupo','Hip Hop',        'APROVADA','CONFIRMADO',160.00,'2026-04-26', NOW()-INTERVAL '5 days'),
  (v_reg13_id, v_event_id, v_inscrito6_id, 'Despertar Contemporâneo','Grupo','Contemporâneo','APROVADA','CONFIRMADO',160.00,'2026-04-27',NOW()-INTERVAL '4 days'),

  -- ── SUPERGRUPOS CONFIRMADOS (2) — máximo stress ───────────
  (v_reg14_id, v_event_id, v_inscrito6_id, 'Cia Completa — Gala','Supergrupo','Contemporâneo','APROVADA','CONFIRMADO',200.00,'2026-04-20',NOW()-INTERVAL '7 days'),
  (v_reg15_id, v_event_id, v_inscrito4_id, 'K-Pop Mega Show',   'Supergrupo','K-Pop',        'APROVADA','CONFIRMADO',200.00,'2026-04-22',NOW()-INTERVAL '6 days'),

  -- ── PENDENTES (4) ────────────────────────────────────────
  (v_reg16_id, v_event_id, v_inscrito3_id, 'Renascimento',     'Solo', 'Contemporâneo',  'PENDENTE','PENDENTE',    0.00, '2026-06-01', NOW()-INTERVAL '2 days'),
  (v_reg17_id, v_event_id, v_inscrito8_id, 'Hip Hop Party',    'Duo',  'Hip Hop',        'PENDENTE','PENDENTE',    0.00, '2026-06-02', NOW()-INTERVAL '1 day'),
  (v_reg18_id, v_event_id, v_inscrito7_id, 'Jazz Fever',       'Solo', 'Jazz',           'PENDENTE','PENDENTE',    0.00, '2026-06-02', NOW()-INTERVAL '1 day'),
  (v_reg19_id, v_event_id, v_inscrito2_id, 'Street Vibes',     'Trio', 'Danças Urbanas', 'PENDENTE','PENDENTE',    0.00, '2026-06-03', NOW()),

  -- ── RECUSADOS (2) ────────────────────────────────────────
  (v_reg20_id, v_event_id, v_inscrito5_id, 'Breaking Free',    'Solo', 'Hip Hop',        'CANCELADA','RECUSADO',   0.00, '2026-05-15', NOW()-INTERVAL '3 days'),
  (v_reg21_id, v_event_id, v_inscrito8_id, 'Lyrical Dream',    'Duo',  'Contemporâneo',  'CANCELADA','RECUSADO',   0.00, '2026-05-16', NOW()-INTERVAL '2 days')

ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- 6. ELENCO — bailarinos dos grupos e supergrupos
-- Colunas confirmadas: id, user_id, nome, cpf, data_nascimento
-- ================================================================

-- Ballet das Flores (11 bailarinas infantis)
INSERT INTO elenco (id, user_id, nome, cpf, data_nascimento) VALUES
  (gen_random_uuid(), v_inscrito1_id, 'Sofia Lima',         '001.001.001-01', '2015-03-12'),
  (gen_random_uuid(), v_inscrito1_id, 'Isabella Ferreira',  '001.001.001-02', '2015-07-22'),
  (gen_random_uuid(), v_inscrito1_id, 'Valentina Costa',    '001.001.001-03', '2016-01-15'),
  (gen_random_uuid(), v_inscrito1_id, 'Laura Mendes',       '001.001.001-04', '2015-11-08'),
  (gen_random_uuid(), v_inscrito1_id, 'Beatriz Oliveira',   '001.001.001-05', '2016-04-30'),
  (gen_random_uuid(), v_inscrito1_id, 'Julia Santos',       '001.001.001-06', '2015-09-18'),
  (gen_random_uuid(), v_inscrito1_id, 'Camila Pereira',     '001.001.001-07', '2016-02-25'),
  (gen_random_uuid(), v_inscrito1_id, 'Alice Rodrigues',    '001.001.001-08', '2015-06-14'),
  (gen_random_uuid(), v_inscrito1_id, 'Luiza Alves',        '001.001.001-09', '2016-08-03'),
  (gen_random_uuid(), v_inscrito1_id, 'Giovanna Castro',    '001.001.001-10', '2015-12-20'),
  (gen_random_uuid(), v_inscrito1_id, 'Mariana Silva',      '001.001.001-11', '2016-05-09')
ON CONFLICT DO NOTHING;

-- Urban Crew Attack (12 dançarinos adultos)
INSERT INTO elenco (id, user_id, nome, cpf, data_nascimento) VALUES
  (gen_random_uuid(), v_inscrito2_id, 'Gabriel Santos',     '002.001.001-01', '2002-05-15'),
  (gen_random_uuid(), v_inscrito2_id, 'Lucas Ferreira',     '002.001.001-02', '2003-08-22'),
  (gen_random_uuid(), v_inscrito2_id, 'Matheus Costa',      '002.001.001-03', '2002-11-30'),
  (gen_random_uuid(), v_inscrito2_id, 'Rafael Lima',        '002.001.001-04', '2001-03-10'),
  (gen_random_uuid(), v_inscrito2_id, 'Pedro Alves',        '002.001.001-05', '2003-06-18'),
  (gen_random_uuid(), v_inscrito2_id, 'Thiago Mendes',      '002.001.001-06', '2002-09-05'),
  (gen_random_uuid(), v_inscrito2_id, 'Gustavo Oliveira',   '002.001.001-07', '2001-12-28'),
  (gen_random_uuid(), v_inscrito2_id, 'Felipe Rodrigues',   '002.001.001-08', '2003-02-14'),
  (gen_random_uuid(), v_inscrito2_id, 'Bruno Castro',       '002.001.001-09', '2002-07-20'),
  (gen_random_uuid(), v_inscrito2_id, 'Diego Pereira',      '002.001.001-10', '2001-04-08'),
  (gen_random_uuid(), v_inscrito2_id, 'Vitor Silva',        '002.001.001-11', '2003-10-16'),
  (gen_random_uuid(), v_inscrito2_id, 'Carlos Monteiro',    '002.001.001-12', '2002-01-25')
ON CONFLICT DO NOTHING;

-- Despertar Contemporâneo (8 dançarinos)
INSERT INTO elenco (id, user_id, nome, cpf, data_nascimento) VALUES
  (gen_random_uuid(), v_inscrito6_id, 'Renata Gomes',       '003.001.001-01', '2000-06-20'),
  (gen_random_uuid(), v_inscrito6_id, 'Samuel Costa',       '003.001.001-02', '1999-03-13'),
  (gen_random_uuid(), v_inscrito6_id, 'Tainá Lima',         '003.001.001-03', '2001-08-27'),
  (gen_random_uuid(), v_inscrito6_id, 'Ursula Borges',      '003.001.001-04', '1998-05-01'),
  (gen_random_uuid(), v_inscrito6_id, 'Victor Nunes',       '003.001.001-05', '2000-10-09'),
  (gen_random_uuid(), v_inscrito6_id, 'Wanderson Freitas',  '003.001.001-06', '1999-12-14'),
  (gen_random_uuid(), v_inscrito6_id, 'Xavier Moura',       '003.001.001-07', '2001-04-22'),
  (gen_random_uuid(), v_inscrito6_id, 'Yasmin Torres',      '003.001.001-08', '2000-07-31')
ON CONFLICT DO NOTHING;

-- Cia Completa — Gala (22 dançarinos — stress test máximo)
INSERT INTO elenco (id, user_id, nome, cpf, data_nascimento) VALUES
  (gen_random_uuid(), v_inscrito6_id, 'Aline Nascimento',   '004.001.001-01', '1998-04-12'),
  (gen_random_uuid(), v_inscrito6_id, 'Bruna Moreira',      '004.001.001-02', '2000-07-25'),
  (gen_random_uuid(), v_inscrito6_id, 'Camille Duarte',     '004.001.001-03', '1999-01-18'),
  (gen_random_uuid(), v_inscrito6_id, 'Daniela Freitas',    '004.001.001-04', '2001-09-30'),
  (gen_random_uuid(), v_inscrito6_id, 'Eduarda Pinto',      '004.001.001-05', '1998-12-05'),
  (gen_random_uuid(), v_inscrito6_id, 'Fernanda Luz',       '004.001.001-06', '2000-03-22'),
  (gen_random_uuid(), v_inscrito6_id, 'Gabriela Monteiro',  '004.001.001-07', '1999-06-14'),
  (gen_random_uuid(), v_inscrito6_id, 'Helena Barbosa',     '004.001.001-08', '2001-11-08'),
  (gen_random_uuid(), v_inscrito6_id, 'Igor Cavalcante',    '004.001.001-09', '1998-08-19'),
  (gen_random_uuid(), v_inscrito6_id, 'João Carvalho',      '004.001.001-10', '2000-02-28'),
  (gen_random_uuid(), v_inscrito6_id, 'Karen Teixeira',     '004.001.001-11', '1999-05-07'),
  (gen_random_uuid(), v_inscrito6_id, 'Leonardo Azevedo',   '004.001.001-12', '2001-10-15'),
  (gen_random_uuid(), v_inscrito6_id, 'Marcela Ramos',      '004.001.001-13', '1998-07-23'),
  (gen_random_uuid(), v_inscrito6_id, 'Nathan Correia',     '004.001.001-14', '2000-04-11'),
  (gen_random_uuid(), v_inscrito6_id, 'Olivia Souza',       '004.001.001-15', '1999-09-16'),
  (gen_random_uuid(), v_inscrito6_id, 'Paulo Henrique',     '004.001.001-16', '2001-01-29'),
  (gen_random_uuid(), v_inscrito6_id, 'Quinn Ferreira',     '004.001.001-17', '1998-11-04'),
  (gen_random_uuid(), v_inscrito6_id, 'Ricardo Gomes',      '004.001.001-18', '2000-06-20'),
  (gen_random_uuid(), v_inscrito6_id, 'Silvana Costa',      '004.001.001-19', '1999-03-13'),
  (gen_random_uuid(), v_inscrito6_id, 'Tiago Lima',         '004.001.001-20', '2001-08-27'),
  (gen_random_uuid(), v_inscrito6_id, 'Ursula Mota',        '004.001.001-21', '1998-05-01'),
  (gen_random_uuid(), v_inscrito6_id, 'Valeria Nunes',      '004.001.001-22', '2000-10-09')
ON CONFLICT DO NOTHING;

-- K-Pop Mega Show (18 dançarinos)
INSERT INTO elenco (id, user_id, nome, cpf, data_nascimento) VALUES
  (gen_random_uuid(), v_inscrito4_id, 'Akemi Tanaka',       '005.001.001-01', '2002-03-15'),
  (gen_random_uuid(), v_inscrito4_id, 'Bianca Lee',         '005.001.001-02', '2003-07-22'),
  (gen_random_uuid(), v_inscrito4_id, 'Chris Kim',          '005.001.001-03', '2002-11-10'),
  (gen_random_uuid(), v_inscrito4_id, 'Dani Park',          '005.001.001-04', '2001-05-28'),
  (gen_random_uuid(), v_inscrito4_id, 'Emily Cho',          '005.001.001-05', '2003-01-14'),
  (gen_random_uuid(), v_inscrito4_id, 'Fabi Jung',          '005.001.001-06', '2002-09-03'),
  (gen_random_uuid(), v_inscrito4_id, 'Gigi Han',           '005.001.001-07', '2001-12-19'),
  (gen_random_uuid(), v_inscrito4_id, 'Hana Yoon',          '005.001.001-08', '2003-04-07'),
  (gen_random_uuid(), v_inscrito4_id, 'Ivy Choi',           '005.001.001-09', '2002-08-25'),
  (gen_random_uuid(), v_inscrito4_id, 'Jasmine Kang',       '005.001.001-10', '2001-02-11'),
  (gen_random_uuid(), v_inscrito4_id, 'Kiki Moon',          '005.001.001-11', '2003-06-30'),
  (gen_random_uuid(), v_inscrito4_id, 'Luna Seo',           '005.001.001-12', '2002-10-17'),
  (gen_random_uuid(), v_inscrito4_id, 'Mia Baek',           '005.001.001-13', '2001-04-04'),
  (gen_random_uuid(), v_inscrito4_id, 'Nabi Jang',          '005.001.001-14', '2003-08-21'),
  (gen_random_uuid(), v_inscrito4_id, 'Ola Shin',           '005.001.001-15', '2002-12-08'),
  (gen_random_uuid(), v_inscrito4_id, 'Pika Nam',           '005.001.001-16', '2001-06-15'),
  (gen_random_uuid(), v_inscrito4_id, 'Quinn Oh',           '005.001.001-17', '2003-02-26'),
  (gen_random_uuid(), v_inscrito4_id, 'Rina Kwon',          '005.001.001-18', '2002-07-13')
ON CONFLICT DO NOTHING;

-- ================================================================
-- 7. AVALIAÇÕES
-- Colunas confirmadas: id, event_id, registration_id, judge_id,
--   final_score, text_comments, created_at
-- ================================================================
INSERT INTO evaluations (id, event_id, registration_id, judge_id, final_score, text_comments, created_at)
VALUES
  -- Solidão (reg01)
  (gen_random_uuid(), v_event_id, v_reg01_id, v_judge1_id, 8.84, 'Excelente expressão corporal e domínio técnico.',           NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg01_id, v_judge3_id, 9.00, 'Coreografia criativa com boa musicalidade.',                 NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg01_id, v_judge5_id, 8.69, 'Boa performance. Pequenas imprecisões técnicas.',            NOW()-INTERVAL '1 day'),

  -- Força Interior (reg02)
  (gen_random_uuid(), v_event_id, v_reg02_id, v_judge1_id, 9.13, 'Técnica de ballet impecável. Postura e linhas perfeitas.',   NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg02_id, v_judge3_id, 9.06, 'Interpretação madura para a categoria.',                     NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg02_id, v_judge5_id, 8.88, 'Boa execução técnica com musicalidade refinada.',            NOW()-INTERVAL '1 day'),

  -- Florescer (reg03) — empate para testar desempate
  (gen_random_uuid(), v_event_id, v_reg03_id, v_judge1_id, 8.25, 'Boa performance para categoria juvenil.',                    NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg03_id, v_judge5_id, 8.25, 'Potencial evidente. Continuar desenvolvendo a técnica.',     NOW()-INTERVAL '1 day'),

  -- Na Quebrada (reg04) — líder Hip Hop
  (gen_random_uuid(), v_event_id, v_reg04_id, v_judge2_id, 9.44, 'Potência, ritmo e autenticidade. Referência no estilo.',     NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg04_id, v_judge6_id, 9.19, 'Freestyle de alto nível com coreografia sólida.',            NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg04_id, v_judge3_id, 9.31, 'Impactante. Domínio completo do palco.',                     NOW()-INTERVAL '1 day'),

  -- K-Style Solo (reg05)
  (gen_random_uuid(), v_event_id, v_reg05_id, v_judge4_id, 8.94, 'Sincronismo e energia K-Pop bem executados.',                NOW()-INTERVAL '1 day'),

  -- Pas de Deux Moderno (reg06)
  (gen_random_uuid(), v_event_id, v_reg06_id, v_judge3_id, 8.56, 'Conexão entre os dançarinos notável.',                       NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg06_id, v_judge5_id, 8.44, 'Boa execução. Podem explorar mais a dramaturgia.',           NOW()-INTERVAL '1 day'),

  -- Jazz Trio Explosion (reg09)
  (gen_random_uuid(), v_event_id, v_reg09_id, v_judge5_id, 9.25, 'Sincronismo perfeito e energia contagiante.',                NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg09_id, v_judge3_id, 9.25, 'Técnica jazz de alto nível. Conjunto muito bem treinado.',   NOW()-INTERVAL '1 day'),

  -- Ballet das Flores (reg11) — grupo infantil
  (gen_random_uuid(), v_event_id, v_reg11_id, v_judge1_id, 8.44, 'Conjunto bem treinado para a faixa etária.',                 NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg11_id, v_judge5_id, 8.56, 'Apresentação encantadora. Uniforme e sincronizado.',         NOW()-INTERVAL '1 day'),

  -- Urban Crew Attack (reg12) — top scores
  (gen_random_uuid(), v_event_id, v_reg12_id, v_judge2_id, 9.56, 'A melhor crew do evento. Nível internacional.',              NOW()-INTERVAL '1 day'),
  (gen_random_uuid(), v_event_id, v_reg12_id, v_judge6_id, 9.38, 'Formações impecáveis e domínio do estilo.',                  NOW()-INTERVAL '1 day')

ON CONFLICT DO NOTHING;

-- ================================================================
-- 8. COMISSÕES DA PLATAFORMA
-- Colunas confirmadas: id, registration_id, event_id, producer_id,
--   gross_amount, commission_amount, net_amount,
--   mp_payment_id, commission_type, created_at
-- ================================================================
INSERT INTO platform_commissions (
  id, registration_id, event_id, producer_id,
  gross_amount, commission_amount, net_amount,
  mp_payment_id, commission_type, created_at
)
VALUES
  (gen_random_uuid(), v_reg01_id,  v_event_id, v_producer_id,  80.00,  8.00,  72.00, 'MP-TEST-001', 'percent', NOW()-INTERVAL '5 days'),
  (gen_random_uuid(), v_reg02_id,  v_event_id, v_producer_id,  80.00,  8.00,  72.00, 'MP-TEST-002', 'percent', NOW()-INTERVAL '5 days'),
  (gen_random_uuid(), v_reg03_id,  v_event_id, v_producer_id,  80.00,  8.00,  72.00, 'MP-TEST-003', 'percent', NOW()-INTERVAL '4 days'),
  (gen_random_uuid(), v_reg04_id,  v_event_id, v_producer_id,  80.00,  8.00,  72.00, 'MP-TEST-004', 'percent', NOW()-INTERVAL '4 days'),
  (gen_random_uuid(), v_reg05_id,  v_event_id, v_producer_id,  80.00,  8.00,  72.00, 'MP-TEST-005', 'percent', NOW()-INTERVAL '4 days'),
  (gen_random_uuid(), v_reg06_id,  v_event_id, v_producer_id, 120.00, 12.00, 108.00, 'MP-TEST-006', 'percent', NOW()-INTERVAL '5 days'),
  (gen_random_uuid(), v_reg07_id,  v_event_id, v_producer_id, 120.00, 12.00, 108.00, 'MP-TEST-007', 'percent', NOW()-INTERVAL '3 days'),
  (gen_random_uuid(), v_reg08_id,  v_event_id, v_producer_id, 120.00, 12.00, 108.00, 'MP-TEST-008', 'percent', NOW()-INTERVAL '3 days'),
  (gen_random_uuid(), v_reg09_id,  v_event_id, v_producer_id, 140.00, 14.00, 126.00, 'MP-TEST-009', 'percent', NOW()-INTERVAL '5 days'),
  (gen_random_uuid(), v_reg10_id,  v_event_id, v_producer_id, 140.00, 14.00, 126.00, 'MP-TEST-010', 'percent', NOW()-INTERVAL '4 days'),
  (gen_random_uuid(), v_reg11_id,  v_event_id, v_producer_id, 160.00, 16.00, 144.00, 'MP-TEST-011', 'percent', NOW()-INTERVAL '6 days'),
  (gen_random_uuid(), v_reg12_id,  v_event_id, v_producer_id, 160.00, 16.00, 144.00, 'MP-TEST-012', 'percent', NOW()-INTERVAL '5 days'),
  (gen_random_uuid(), v_reg13_id,  v_event_id, v_producer_id, 160.00, 16.00, 144.00, 'MP-TEST-013', 'percent', NOW()-INTERVAL '4 days'),
  (gen_random_uuid(), v_reg14_id,  v_event_id, v_producer_id, 200.00, 20.00, 180.00, 'MP-TEST-014', 'percent', NOW()-INTERVAL '7 days'),
  (gen_random_uuid(), v_reg15_id,  v_event_id, v_producer_id, 200.00, 20.00, 180.00, 'MP-TEST-015', 'percent', NOW()-INTERVAL '6 days')
ON CONFLICT DO NOTHING;

END $$;

SET session_replication_role = DEFAULT;

-- ================================================================
-- VERIFICAÇÃO — rode após o seed:
-- ================================================================
-- SELECT COUNT(*) FROM profiles      WHERE id LIKE 'a0000000%';  -- 10
-- SELECT COUNT(*) FROM registrations WHERE event_id = 'b0000000-0000-0000-0000-000000000001'; -- 21
-- SELECT COUNT(*) FROM evaluations   WHERE event_id = 'b0000000-0000-0000-0000-000000000001'; -- 20
-- SELECT COUNT(*) FROM elenco;                                                                 -- ~71
-- SELECT COUNT(*) FROM judges        WHERE id LIKE 'c0000000%';  -- 6
-- SELECT COUNT(*) FROM platform_commissions WHERE event_id = 'b0000000-0000-0000-0000-000000000001'; -- 15
-- SELECT SUM(commission_amount) FROM platform_commissions WHERE event_id = 'b0000000-0000-0000-0000-000000000001'; -- R$ 160.00

-- ================================================================
-- RESET — para limpar os dados de teste:
-- ================================================================
/*
SET session_replication_role = replica;
DELETE FROM platform_commissions WHERE event_id = 'b0000000-0000-0000-0000-000000000001';
DELETE FROM evaluations          WHERE event_id = 'b0000000-0000-0000-0000-000000000001';
DELETE FROM registrations        WHERE event_id = 'b0000000-0000-0000-0000-000000000001';
DELETE FROM elenco               WHERE user_id   LIKE 'a0000000%';
DELETE FROM configuracoes        WHERE id        = 'b0000000-0000-0000-0000-000000000002';
DELETE FROM events               WHERE id        = 'b0000000-0000-0000-0000-000000000001';
DELETE FROM judges               WHERE id        LIKE 'c0000000%';
DELETE FROM profiles             WHERE id        LIKE 'a0000000%';
SET session_replication_role = DEFAULT;
*/
