-- Transcrição em texto dos áudios de feedback do jurado (planejado 2026-09-04).
-- Cache por avaliação: uma vez transcrita, nunca reprocessa (evita custo
-- duplicado do Gemini e permite servir instantâneo tanto pro produtor
-- gerando o PDF em `/equipe-jurados-config` quanto pro inscrito em
-- `/meus-resultados`). Nunca sobrescrita automaticamente — se o áudio for
-- re-gravado (não deveria acontecer, mas por segurança) o produtor teria
-- que zerar manualmente pra forçar retranscrição.

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS audio_transcript TEXT,
  ADD COLUMN IF NOT EXISTS audio_transcript_generated_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
