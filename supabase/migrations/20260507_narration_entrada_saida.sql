-- =====================================================================
-- IA de Narração — Entrada + Saída
-- =====================================================================
-- Pesquisa de mercado (festivais BR + EUA) mostrou padrao:
--   - ENTRADA (universal): 10-25s, ficha tecnica completa, voz solene/grave
--   - SAIDA  (opcional):    3-8s, agradecimento curto / transicao
--
-- Saida e' OPT-IN por evento (toggle narracao_saida_ativa). Disparo manual
-- pelo sonoplasta (botao "Encerrar" na Mesa) — NAO automatico por timer,
-- pois coreografia tem duracao variavel e cortinas/blackouts imprevisiveis.
--
-- Este SQL:
--   1) Adiciona texto_ia_saida + narracao_saida_ativa em configuracoes
--   2) Adiciona kind ('entrada'|'saida') em narration_audios
--   3) Troca UNIQUE (event_id, registration_id) por (event_id, registration_id, kind)
-- =====================================================================


-- 1) Configuracoes: template de saida + toggle ------------------------
ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS texto_ia_saida TEXT DEFAULT NULL;

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS narracao_saida_ativa BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN configuracoes.texto_ia_saida IS 'Template do texto de saida (apos coreografia). Ex: "Muito obrigado, [ESTUDIO]!". NULL = usa default. So tocada se narracao_saida_ativa=true.';
COMMENT ON COLUMN configuracoes.narracao_saida_ativa IS 'Se true, Mesa de Som mostra botao "Encerrar c/ Saida" que toca audio de saida antes de zerar live_registration_id.';


-- 2) narration_audios: kind = 'entrada' | 'saida' ---------------------
ALTER TABLE narration_audios
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'entrada'
    CHECK (kind IN ('entrada', 'saida'));

COMMENT ON COLUMN narration_audios.kind IS 'Tipo da narracao: entrada (antes da coreografia, longa) ou saida (apos, curta). Default entrada pra retrocompat.';

-- Trocar UNIQUE pra incluir kind (1 entrada + 1 saida por registration)
ALTER TABLE narration_audios
  DROP CONSTRAINT IF EXISTS narration_audios_event_id_registration_id_key;

ALTER TABLE narration_audios
  ADD CONSTRAINT narration_audios_event_reg_kind_key
    UNIQUE (event_id, registration_id, kind);
