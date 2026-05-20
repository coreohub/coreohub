-- ─────────────────────────────────────────────────────────────────────────────
-- 20260522 — Dismiss permanente do Guia do Produtor
-- ─────────────────────────────────────────────────────────────────────────────
-- Quando o produtor completa as 4 etapas do guia (perfil + Asaas + evento +
-- link compartilhado) e clica em "Fechar guia", o card "Tudo pronto" some
-- pra sempre. Persistir server-side (não localStorage) pra que o dismiss
-- viaje com o produtor entre dispositivos/sessões.
--
-- Padrão UX: Stripe, Linear e Slack usam server-side flag pra exatamente
-- esse caso (onboarding completo → dashboard limpo permanente).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.onboarding_dismissed_at IS
  'Quando o produtor fechou o Guia do Produtor após completar 100% das etapas. NULL = guia ainda visível.';

NOTIFY pgrst, 'reload schema';
