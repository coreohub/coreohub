-- Revogação de acesso de equipe pós-evento (plano aprovado 2026-07-19) +
-- fecha 2 achados de segurança da mesma auditoria.

-- 1) Policy fantasma em profiles — mesma classe de bug já corrigida em
--    registrations (2026-05-22) e events (2026-07-17). "any_authenticated_
--    updates_profile_safe" (USING true, WITH CHECK true) deixava QUALQUER
--    authenticated dar UPDATE em QUALQUER profile de QUALQUER pessoa —
--    colunas privilegiadas (role/team_event_id/permissoes_custom/asaas_*)
--    já eram protegidas pelo trigger, mas full_name/email/cpf/pix_key/cargo
--    etc de um TERCEIRO ficavam livres pra qualquer inscrito sobrescrever.
--    A policy "Permitir tudo para o próprio usuário" (auth.uid()=id) já
--    cobre 100% do self-service legítimo — dropar essa não tira nenhum
--    acesso real de ninguém.
DROP POLICY IF EXISTS "any_authenticated_updates_profile_safe" ON profiles;

-- 2) Grace period configurável por evento (Fase "Revogação de acesso" do
--    plano). Produtor decide quantos dias após o evento a equipe mantém
--    acesso (revisão de certificados, ajuste de resultado etc) antes do
--    cron revogar automaticamente. Default 30d.
ALTER TABLE events ADD COLUMN IF NOT EXISTS equipe_access_days_after INT NOT NULL DEFAULT 30;

NOTIFY pgrst, 'reload schema';
