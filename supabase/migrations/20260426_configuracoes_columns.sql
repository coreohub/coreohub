-- Adiciona todas as colunas que o frontend (AccountSettings) usa em configuracoes
-- Idempotente: roda quantas vezes precisar. Não derruba dados.

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS nome_evento             text,
  ADD COLUMN IF NOT EXISTS local_evento            text,
  ADD COLUMN IF NOT EXISTS cidade_estado           text,
  ADD COLUMN IF NOT EXISTS data_evento             text,
  ADD COLUMN IF NOT EXISTS prazo_inscricao         text,
  ADD COLUMN IF NOT EXISTS prazo_trilhas           text,
  ADD COLUMN IF NOT EXISTS tipos_apresentacao      jsonb,
  ADD COLUMN IF NOT EXISTS escala_notas            text,
  ADD COLUMN IF NOT EXISTS pin_inactivity_minutes  int,
  ADD COLUMN IF NOT EXISTS medal_thresholds        jsonb,
  ADD COLUMN IF NOT EXISTS estilos                 jsonb,
  ADD COLUMN IF NOT EXISTS formatos                jsonb,
  ADD COLUMN IF NOT EXISTS categorias              jsonb,
  ADD COLUMN IF NOT EXISTS tolerancia              jsonb,
  ADD COLUMN IF NOT EXISTS age_reference           text,
  ADD COLUMN IF NOT EXISTS age_reference_date      date,
  ADD COLUMN IF NOT EXISTS tempo_entrada           int,
  ADD COLUMN IF NOT EXISTS intervalo_seguranca     int,
  ADD COLUMN IF NOT EXISTS texto_ia                text,
  ADD COLUMN IF NOT EXISTS marcar_palco_ativo      boolean,
  ADD COLUMN IF NOT EXISTS tempo_marcacao_palco    int,
  ADD COLUMN IF NOT EXISTS gatilho_marcacao        text,
  ADD COLUMN IF NOT EXISTS links                   jsonb,
  ADD COLUMN IF NOT EXISTS regras_avaliacao        jsonb,
  ADD COLUMN IF NOT EXISTS premios_especiais       jsonb,
  ADD COLUMN IF NOT EXISTS atualizado_em           timestamptz;

-- Garante que o cache do PostgREST recarregue o schema
NOTIFY pgrst, 'reload schema';
