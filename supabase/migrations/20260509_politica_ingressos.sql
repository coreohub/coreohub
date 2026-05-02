-- Backlog #11 — Politica explicita de ingressos pra plateia.
--
-- Hoje, se o produtor nao cadastra tipos de ingresso em "Ingressos para
-- Audiencia", a secao inteira some da vitrine publica. Resultado: produtor
-- de evento gratuito (ex: Usualdance Festival) nao tem como sinalizar
-- isso, e o publico nao sabe se precisa comprar ingresso ou nao.
-- Workaround atual: cadastrar 1 ingresso fake com preco 0.
--
-- Adiciona coluna `politica_ingressos` em `configuracoes` e `events` com
-- 4 estados:
--   NAO_DEFINIDO — produtor nao escolheu (default; secao oculta)
--   GRATUITO     — banner verde "Entrada gratuita", oculta lista
--   INTERNO      — mostra a lista de tipos cadastrados (comportamento atual)
--   EXTERNO      — mostra botao "Comprar ingressos" linkando pra url_ingressos
--
-- Backfill: eventos existentes com lista preenchida -> INTERNO; com
-- url_ingressos -> EXTERNO; senao -> NAO_DEFINIDO.

-- Garantia: a coluna url_ingressos era assumida pelo frontend (Ingressos.tsx,
-- AccountSettings) mas nunca foi criada via migration explicita. Cria agora
-- pra suportar o modo EXTERNO da politica + corrigir bug latente.
ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS url_ingressos TEXT;

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS politica_ingressos TEXT DEFAULT 'NAO_DEFINIDO';

ALTER TABLE configuracoes
  DROP CONSTRAINT IF EXISTS politica_ingressos_check;
ALTER TABLE configuracoes
  ADD CONSTRAINT politica_ingressos_check
  CHECK (politica_ingressos IN ('NAO_DEFINIDO', 'GRATUITO', 'INTERNO', 'EXTERNO'));

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS politica_ingressos TEXT DEFAULT 'NAO_DEFINIDO';

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_politica_ingressos_check;
ALTER TABLE events
  ADD CONSTRAINT events_politica_ingressos_check
  CHECK (politica_ingressos IN ('NAO_DEFINIDO', 'GRATUITO', 'INTERNO', 'EXTERNO'));

-- Backfill configuracoes
UPDATE configuracoes
SET politica_ingressos = CASE
  WHEN ingressos_audiencia IS NOT NULL
       AND jsonb_typeof(ingressos_audiencia) = 'array'
       AND jsonb_array_length(ingressos_audiencia) > 0
       THEN 'INTERNO'
  WHEN url_ingressos IS NOT NULL AND url_ingressos != ''
       THEN 'EXTERNO'
  ELSE 'NAO_DEFINIDO'
END
WHERE politica_ingressos IS NULL OR politica_ingressos = 'NAO_DEFINIDO';

-- Backfill events
UPDATE events
SET politica_ingressos = CASE
  WHEN ingressos_config IS NOT NULL
       AND jsonb_typeof(ingressos_config) = 'array'
       AND jsonb_array_length(ingressos_config) > 0
       THEN 'INTERNO'
  ELSE 'NAO_DEFINIDO'
END
WHERE politica_ingressos IS NULL OR politica_ingressos = 'NAO_DEFINIDO';

COMMENT ON COLUMN configuracoes.politica_ingressos IS
  'Politica de ingressos pra plateia: NAO_DEFINIDO (oculta) / GRATUITO / INTERNO (lista) / EXTERNO (link). Backlog #11.';
COMMENT ON COLUMN events.politica_ingressos IS
  'Espelho de configuracoes.politica_ingressos. Vitrine publica le daqui.';

NOTIFY pgrst, 'reload schema';
