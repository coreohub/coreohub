-- Registro de uso e limite diário da leitura de planta de assentos por IA (/locais → "Importar de PDF ou imagem").
-- A edge function parse-seat-map conta as linhas do dia (fuso America/Sao_Paulo) para aplicar o limite por produtor
-- e grava tokens e custo estimado de cada leitura. NUNCA guarda o conteúdo do arquivo nem a resposta da IA.
-- Só a service_role escreve; o produtor só enxerga as próprias linhas.

CREATE TABLE IF NOT EXISTS seat_map_parse_usage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  model                 TEXT NOT NULL,
  -- ok = leitura concluída; erro = falha depois de chamar a API; recusado = a IA recusou (stop_reason refusal)
  status                TEXT NOT NULL CHECK (status IN ('ok', 'erro', 'recusado')),
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_estimate_usd     NUMERIC(10, 6) NOT NULL DEFAULT 0,
  duration_ms           INTEGER,
  file_kind             TEXT CHECK (file_kind IN ('pdf', 'image')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seat_map_parse_usage_user_day
  ON seat_map_parse_usage (user_id, created_at DESC);

-- Sem anon: tabela interna. authenticated só lê (RLS filtra às próprias linhas); escrita é da edge function.
GRANT SELECT                         ON seat_map_parse_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON seat_map_parse_usage TO service_role;

ALTER TABLE seat_map_parse_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seat_map_parse_usage_owner_select ON seat_map_parse_usage;
CREATE POLICY seat_map_parse_usage_owner_select
  ON seat_map_parse_usage FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
