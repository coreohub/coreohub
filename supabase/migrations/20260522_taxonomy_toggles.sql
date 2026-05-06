-- Toggles de taxonomia do evento (Sprint UX produtor — pesquisa de mercado 2026-05-06)
--
-- aceita_danca_inclusiva: produtor sinaliza explicitamente que aceita inscrições
-- de Dança Inclusiva (PCD). Transversal — qualquer estilo pode ser feito por PCD.
-- Default false; produtor opta in.
--
-- nivel_tecnico_enabled: habilita o eixo opcional "nível técnico" (Iniciante /
-- Intermediário / Avançado / Profissional). FAD/YAGP NÃO usam; JOPEF/VIBE usam.
-- Default false pra simplificar MVP — produtor liga quando precisar.

ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS aceita_danca_inclusiva BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nivel_tecnico_enabled  BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
