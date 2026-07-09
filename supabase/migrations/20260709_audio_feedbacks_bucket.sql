-- O bucket 'audio-feedbacks' é referenciado em 3 lugares (services/supabase.ts,
-- JudgeTerminal.tsx fluxo legado, judge-login edge function) desde sempre,
-- mas nunca foi criado em produção — só existe o bucket 'judges_audio'
-- (nome diferente, provavelmente criado à mão e nunca sincronizado com o
-- código). Resultado: todo upload de comentário em áudio do jurado falhava
-- silenciosamente (a nota seguia sem áudio, sem erro visível pro jurado).
-- Mesmo padrão do bucket 'narrations' (20260505_narration_audios.sql).

INSERT INTO storage.buckets (id, name, public)
VALUES ('audio-feedbacks', 'audio-feedbacks', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Audio feedbacks: public read" ON storage.objects;
CREATE POLICY "Audio feedbacks: public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'audio-feedbacks');

DROP POLICY IF EXISTS "Audio feedbacks: authenticated insert" ON storage.objects;
CREATE POLICY "Audio feedbacks: authenticated insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'audio-feedbacks');

DROP POLICY IF EXISTS "Audio feedbacks: owner delete" ON storage.objects;
CREATE POLICY "Audio feedbacks: owner delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'audio-feedbacks' AND owner = auth.uid());
