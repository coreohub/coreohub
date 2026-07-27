-- Cotação avulsa de Terminal de Júri + Operador CoreoHub — venda fora do
-- modelo de comissão padrão, pra produtor cujo evento roda em outra
-- plataforma (não gera venda de ingresso/inscrição via CoreoHub). Ferramenta
-- INTERNA (Super Admin), não self-service pro produtor preencher sozinho.
--
-- 2 tabelas:
-- 1. standalone_pricing_config — faixas de preço editáveis sem deploy
--    (categoria terminal/operador/setup, tier por quantidade, valor min/max).
-- 2. standalone_quotes — 1 registro por cotação gerada (lead + escopo +
--    valores calculados). quote_type reservado pra 'governo' no futuro —
--    v1 só calcula terminal_operador (proposta de governo é modelo de
--    preço próprio, ainda não decidido, ver memória do projeto).
--
-- Deslocamento/hospedagem NÃO entra no cálculo — produtor paga a própria
-- passagem (decisão de produto). Cidade/estado do evento é só informativo.

CREATE TABLE IF NOT EXISTS standalone_pricing_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria   TEXT NOT NULL CHECK (categoria IN ('terminal', 'operador', 'setup')),
  -- chave estável pra matching no cálculo (ex: 'operador_remoto' vs
  -- 'operador_presencial' — categoria sozinha não distingue os 2, e o
  -- `label` é texto editável pelo admin, não pode ser usado como chave).
  -- NULL em tiers de terminal criados à mão depois (matching aí usa qty_min/qty_max).
  chave       TEXT,
  label       TEXT NOT NULL,
  qty_min     INTEGER,          -- NULL = sem piso (ex: operador/setup não escalam por qty)
  qty_max     INTEGER,          -- NULL = sem teto (última faixa, "300+")
  valor_min   NUMERIC(10,2) NOT NULL,
  valor_max   NUMERIC(10,2) NOT NULL,
  unidade     TEXT NOT NULL DEFAULT 'evento', -- 'evento' | 'dia'
  ativo       BOOLEAN NOT NULL DEFAULT true,
  ordem       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS standalone_pricing_config_categoria_idx
  ON standalone_pricing_config (categoria, ordem) WHERE ativo = true;

ALTER TABLE standalone_pricing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_standalone_pricing_config ON standalone_pricing_config;
CREATE POLICY admin_all_standalone_pricing_config ON standalone_pricing_config
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS standalone_quotes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_type            TEXT NOT NULL DEFAULT 'terminal_operador' CHECK (quote_type IN ('terminal_operador', 'governo')),
  status                TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviado', 'fechado', 'perdido')),

  -- Bloco 1: identificação (lead)
  nome_responsavel      TEXT,
  nome_evento           TEXT,
  email                 TEXT,
  whatsapp              TEXT,

  -- Bloco 2: local (informativo, não entra no cálculo — produtor paga a própria passagem)
  cidade                TEXT,
  estado                TEXT,
  datas_evento          TEXT,

  -- Bloco 3: escopo (dirve preço do Terminal)
  qtd_apresentacoes     INTEGER,
  qtd_jurados           INTEGER,
  qtd_dias_competicao   INTEGER,

  -- Bloco 4: Operador
  operador_modalidade   TEXT CHECK (operador_modalidade IN ('remoto', 'presencial', 'nenhum')),
  operador_dias         INTEGER,

  -- Bloco 5: infraestrutura no local
  qtd_tablets_produtor  INTEGER,
  tem_internet_local    BOOLEAN,

  -- Bloco 6: dados pro cadastro (dirve o setup fee)
  tem_planilha_pronta   BOOLEAN,
  tem_regulamento       BOOLEAN,
  lista_jurados_texto   TEXT,

  -- Bloco 7: sinal comercial
  pretende_migrar       BOOLEAN,

  -- Valores calculados no momento da cotação (snapshot — não recalcula
  -- retroativo se a config mudar depois)
  valor_terminal        NUMERIC(10,2),
  valor_setup           NUMERIC(10,2),
  valor_operador        NUMERIC(10,2),
  valor_total           NUMERIC(10,2),

  observacoes           TEXT,
  created_by             UUID REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS standalone_quotes_created_at_idx ON standalone_quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS standalone_quotes_status_idx ON standalone_quotes (status);

ALTER TABLE standalone_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_standalone_quotes ON standalone_quotes;
CREATE POLICY admin_all_standalone_quotes ON standalone_quotes
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- Seed inicial com os valores-âncora combinados na sessão de cotação
-- (2026-07-27) — editáveis depois via painel, isso é só o ponto de partida.
INSERT INTO standalone_pricing_config (categoria, chave, label, qty_min, qty_max, valor_min, valor_max, unidade, ordem) VALUES
  ('terminal', 'terminal_tier_1', 'Até 100 apresentações',        0,   100,  900.00, 1200.00, 'evento', 1),
  ('terminal', 'terminal_tier_2', '101 a 300 apresentações',      101, 300,  1500.00, 2000.00, 'evento', 2),
  ('terminal', 'terminal_tier_3', '300+ apresentações',           301, NULL, 2500.00, 3500.00, 'evento', 3),
  ('setup',    'setup_cadastro',  'Setup / cadastro manual',      NULL, NULL, 300.00, 500.00,  'evento', 1),
  ('operador', 'operador_remoto',     'Suporte remoto',           NULL, NULL, 300.00, 500.00,  'dia', 1),
  ('operador', 'operador_presencial', 'Suporte presencial',       NULL, NULL, 800.00, 1200.00, 'dia', 2)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
