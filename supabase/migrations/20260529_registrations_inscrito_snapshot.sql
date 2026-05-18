-- 2026-05-18 · Snapshot dos dados do inscrito na registration + RLS pra
-- producer ler profile dos seus inscritos.
--
-- Problema em prod: /registrations não mostrava dados do inscrito porque
-- RLS de `profiles` bloqueia producer de ler profile de outro usuário.
-- E se o inscrito deletar a conta um dia, os dados do festival somem.
--
-- Solução em 2 frentes:
-- 1) Snapshot (inscrito_nome/email/whatsapp colado na registration no insert
--    do Wizard). LGPD-friendly: dados de fatura imutáveis após emissão.
-- 2) RLS policy permite producer ler profiles de inscritos que pagaram
--    nos seus eventos. Sem expor profiles aleatórios.

-- Colunas já criadas via ALTER TABLE em 2026-05-18 (executado manualmente
-- no Supabase SQL Editor antes desta migration). Mantemos IF NOT EXISTS
-- pra idempotência se a migration for re-aplicada do zero em outro env.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS inscrito_nome     TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS inscrito_email    TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS inscrito_whatsapp TEXT;

-- Backfill: copia o profile atual pras registrations existentes que ainda
-- não têm snapshot. Roda só uma vez (where inscrito_nome IS NULL).
UPDATE registrations r
SET
  inscrito_nome     = COALESCE(r.inscrito_nome,     p.full_name),
  inscrito_email    = COALESCE(r.inscrito_email,    p.email),
  inscrito_whatsapp = COALESCE(r.inscrito_whatsapp, p.whatsapp)
FROM profiles p
WHERE p.id = r.user_id
  AND (r.inscrito_nome IS NULL OR r.inscrito_email IS NULL OR r.inscrito_whatsapp IS NULL);

-- RLS: producer lê profile de qualquer inscrito que tenha registration
-- num evento dele. Producer não pode ler profile aleatório (mantém
-- privacidade dos usuários sem vínculo com o evento dele).
DROP POLICY IF EXISTS "producer_reads_event_inscritos_profiles" ON profiles;
CREATE POLICY "producer_reads_event_inscritos_profiles" ON profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM registrations r
      JOIN events e ON e.id = r.event_id
      WHERE r.user_id     = profiles.id
        AND e.created_by  = auth.uid()
    )
  );
