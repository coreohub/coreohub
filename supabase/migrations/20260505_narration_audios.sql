-- =====================================================================
-- IA de Narração — Pre-rendering com ElevenLabs TTS
-- =====================================================================
-- Modelo decidido (research-backed):
--   A) Voz profissional: ElevenLabs Multilingual v2 (PT-BR épico, custo
--      ~$0.05/100 chars no plano Creator $22/mês)
--   C) Pre-render: produtor gera todos os audios ANTES do evento, salva
--      em Supabase Storage. Zero latencia ao vivo, robustez a Wi-Fi ruim
--   D) Auto-trigger: ao clicar "Iniciar" na Mesa de Som, terminal toca
--      narração automaticamente + ativa live_registration_id em paralelo
--
-- Este SQL cria:
--   - Tabela narration_audios (1 por registration por evento)
--   - Bucket Storage 'narrations' (publicReadable) com RLS
--   - Coluna voice_id em configuracoes pra produtor escolher voz
-- =====================================================================


-- 1) Tabela de narrações pre-renderizadas ----------------------------
CREATE TABLE IF NOT EXISTS narration_audios (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  audio_url       TEXT NOT NULL,
  voice_id        TEXT,
  text_used       TEXT NOT NULL,
  duration_seconds NUMERIC,
  -- created_by = produtor dono do evento (RLS scoping)
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_narration_audios_event   ON narration_audios (event_id);
CREATE INDEX IF NOT EXISTS idx_narration_audios_creator ON narration_audios (created_by);

ALTER TABLE narration_audios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS narration_audios_owner_all ON narration_audios;
CREATE POLICY narration_audios_owner_all ON narration_audios FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());


-- 2) Coluna voice_id em configuracoes --------------------------------
ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS voice_id TEXT DEFAULT NULL;

COMMENT ON COLUMN configuracoes.voice_id IS 'ElevenLabs voice ID escolhida pelo produtor. NULL = usa default (Otto de La Luna). Ex: "21m00Tcm4TlvDq8ikWAM"';


-- 3) Storage bucket pra audios -----------------------------------------
-- (criado via SQL pra ficar idempotente; alternativa eh criar via UI)
INSERT INTO storage.buckets (id, name, public)
VALUES ('narrations', 'narrations', true)
ON CONFLICT (id) DO NOTHING;

-- RLS no bucket: produtor (owner do evento) pode upload/delete; publico le
DROP POLICY IF EXISTS "Narrations: public read" ON storage.objects;
CREATE POLICY "Narrations: public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'narrations');

DROP POLICY IF EXISTS "Narrations: authenticated insert" ON storage.objects;
CREATE POLICY "Narrations: authenticated insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'narrations');

DROP POLICY IF EXISTS "Narrations: owner delete" ON storage.objects;
CREATE POLICY "Narrations: owner delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'narrations' AND owner = auth.uid());


-- 4) Comentarios pra documentacao -------------------------------------
COMMENT ON TABLE narration_audios IS 'Audios de narracao pre-renderizados via ElevenLabs TTS. 1 row por registration por evento. Tocados pela Mesa de Som ao clicar Iniciar.';
COMMENT ON COLUMN narration_audios.text_used IS 'Texto exato enviado pra TTS (template aplicado com [COREOGRAFIA] e [ESTUDIO] substituidos). Util pra debug/regerar';
COMMENT ON COLUMN narration_audios.duration_seconds IS 'Duracao do audio gerado. Util pra tempo de espera antes da musica comecar';
