-- Rastreio de funil de leads: associa cada profile ao evento onde o lead
-- entrou (vitrine pública /evento/<slug> → click "Inscreva-se" → /auth).
-- Quem entra direto em /auth (sem passar por vitrine) fica NULL — esses
-- não recebem email de reengajamento (sem contexto pra personalizar).
--
-- Padrão Sympla/Eventbrite: notificação contextualizada por evento, não
-- broadcast genérico. LGPD-compliant (produtor vê só números agregados,
-- nunca lista de emails).
--
-- Plano completo em [[plano-leads-reengajamento]].

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS entry_event_id UUID
    REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_entry_event_id_idx
  ON profiles(entry_event_id)
  WHERE entry_event_id IS NOT NULL;

COMMENT ON COLUMN profiles.entry_event_id IS
  'Evento de origem do lead (vitrine pública). Capturado no signup via localStorage. NULL = lead direto sem contexto.';

NOTIFY pgrst, 'reload schema';
