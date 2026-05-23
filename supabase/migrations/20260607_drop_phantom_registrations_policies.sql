-- ═══════════════════════════════════════════════════════════════════════════
-- 20260607_drop_phantom_registrations_policies.sql
--
-- DROP de 2 policies fantasmas em `registrations` criadas via Dashboard
-- manual em algum momento e esquecidas. Ambas com USING true / WITH CHECK
-- true — permitem qualquer caller autenticado fazer UPDATE em qualquer
-- registration (incluindo de outros produtores). Risco de segurança alto.
--
-- Policies a remover:
--   - "Acesso Total Registrations" (cmd ALL, qual true, with_check true)
--   - "Permitir Atualização" (cmd UPDATE, qual true, with_check true)
--
-- Policies legítimas (criadas em migrations versionadas, mantidas):
--   - inscrito_own_registrations (FOR ALL, user_id = auth.uid)
--   - producer_updates_event_registrations (FOR UPDATE, produtor do evento) — 20260525
--   - super_admin_all_registrations (FOR ALL, is_super_admin)
--
-- Descobertas via diagnóstico SQL durante atacar o bug "payment_group_id
-- não zera" em 2026-06-01. Confirmado via grep que NÃO existem em nenhuma
-- migration versionada.
--
-- Idempotente: DROP POLICY IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Acesso Total Registrations" ON registrations;
DROP POLICY IF EXISTS "Permitir Atualização"       ON registrations;

NOTIFY pgrst, 'reload schema';
