-- ═══════════════════════════════════════════════════════════════════════════
-- 20260526_notifications_inbox.sql
--
-- Foundation do in-app inbox (Sessao 4.2 B1). Tabela `notifications` armazena
-- avisos endereçados a um user — produtor ou inscrito. Frontend (NotificationBell
-- a vir em B2) lista os do `auth.uid()` ordenados por created_at DESC,
-- destaca `read_at IS NULL`.
--
-- Quem escreve nessa tabela:
--   • Edge Functions (service_role) — disparam notifs automatizadas (ex.: trilha
--     faltando, pagamento aprovado, video reprovado).
--   • Triggers de outras tabelas (futuro) — ex.: AFTER UPDATE em registrations
--     pra notificar quando status_pagamento muda.
--   • Super admin via UI dedicada (futuro).
--
-- Quem lê: cada user só vê os próprios. RLS via `user_id = auth.uid()`.
-- Quem marca como lido: o próprio user (UPDATE em read_at apenas). Trigger
-- garante que TODAS as outras colunas são imutáveis após criação.
--
-- Sem INSERT/DELETE pra client comum — só service_role e super_admin podem
-- criar/apagar notifs (impede spoofing entre users).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Schema ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- event_id nullable: notifs globais (conta confirmada, política de privacidade
  -- atualizada) não pertencem a um evento específico. Quando preenchido, CTA
  -- normalmente leva pra alguma tela contextualizada do evento.
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  -- Tipo livre pra extensão. Convenções já planejadas:
  --   trilha_faltando        — inscrito aprovado mas sem trilha enviada
  --   cpf_faltando           — bailarino com CPF/data_nascimento vazio
  --   pagamento_vencendo     — PIX/boleto a expirar em <24h
  --   pagamento_aprovado     — Asaas confirmou pagamento
  --   video_aprovado         — jurado aprovou submissão de seletiva
  --   video_reprovado        — jurado reprovou submissão de seletiva
  --   producer_kyc_pendente  — KYC Asaas não foi completado
  --   onboarding_concluido   — produtor finalizou wizard inicial
  -- Lista cresce orgânica — texto sem CHECK pra evitar migration por valor novo.
  type        TEXT NOT NULL,
  -- Severity controla cor/ícone na UI. info=cinza, success=verde, warning=amber,
  -- error=rosa (palette CoreoHub). CHECK rejeita typos.
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  -- CTA opcional: quando preenchido, NotificationBell renderiza botão clicável.
  -- URL pode ser absoluta (https://...) ou relativa (/registrations).
  cta_url     TEXT,
  cta_label   TEXT,
  -- Carga útil livre pra dados estruturados (registration_id, payment_id, etc).
  -- UI pode consumir pra navegar diretamente pra recurso específico sem parser.
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- NULL = não lido. UPDATE pelo client seta NOW(). NUNCA volta pra null (trigger
  -- não bloqueia mas convenção: notif lida não desmarca).
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. Índices ──────────────────────────────────────────────────────────────
-- Query mais comum: badge "X não lidas" no header → WHERE user_id = ? AND read_at IS NULL.
-- Partial index é mais barato que full e cobre exatamente esse caso.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Query secundária: lista completa do user → WHERE user_id = ? ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS notifications_user_all_idx
  ON notifications (user_id, created_at DESC);

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- User lê as próprias.
DROP POLICY IF EXISTS "user_reads_own_notifications" ON notifications;
CREATE POLICY "user_reads_own_notifications" ON notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- User atualiza as próprias (na prática só read_at — trigger abaixo impede
-- mexer no resto). USING + WITH CHECK = não pode "transferir" notif pra outro user.
DROP POLICY IF EXISTS "user_updates_own_notifications" ON notifications;
CREATE POLICY "user_updates_own_notifications" ON notifications
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Super admin bypass total.
DROP POLICY IF EXISTS "super_admin_all_notifications" ON notifications;
CREATE POLICY "super_admin_all_notifications" ON notifications
  FOR ALL
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

-- INSERT e DELETE deliberadamente SEM policy = nenhum client autenticado
-- consegue. Edge Functions usam service_role e bypassam RLS direto.

-- ─── 4. Trigger de proteção ──────────────────────────────────────────────────
-- User só pode mudar read_at — todas as outras colunas são imutáveis após
-- INSERT (notif spoofing tipo "mudar o conteúdo do aviso depois" não rola).
-- Mesmo padrão do protect_registrations_status_columns.
CREATE OR REPLACE FUNCTION protect_notifications_columns() RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('postgres', 'supabase_admin', 'supabase_storage_admin') THEN
    RETURN NEW;
  END IF;
  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.id          := OLD.id;
    NEW.user_id     := OLD.user_id;
    NEW.event_id    := OLD.event_id;
    NEW.type        := OLD.type;
    NEW.severity    := OLD.severity;
    NEW.title       := OLD.title;
    NEW.body        := OLD.body;
    NEW.cta_url     := OLD.cta_url;
    NEW.cta_label   := OLD.cta_label;
    NEW.metadata    := OLD.metadata;
    NEW.created_at  := OLD.created_at;
    -- read_at: única coluna que o user pode tocar.
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_notifications_columns_trigger ON notifications;
CREATE TRIGGER protect_notifications_columns_trigger
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION protect_notifications_columns();

-- ─── 5. RPC mark_all_notifications_read ──────────────────────────────────────
-- Update bulk em vez de N requests pra UI "marcar todas como lidas". Retorna
-- contagem afetada pra UI dar feedback ("5 notificações marcadas como lidas").
CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  -- auth.uid() devolve NULL pra anon — UPDATE vira no-op (WHERE user_id = NULL).
  UPDATE notifications
  SET read_at = NOW()
  WHERE user_id = auth.uid() AND read_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION mark_all_notifications_read() TO authenticated;

-- ─── 6. Comentários (docs no schema, ajuda Supabase Studio) ──────────────────
COMMENT ON TABLE notifications IS
  'In-app inbox. Avisos endereçados a um auth.users.id. Frontend lista os do auth.uid() via RLS. Apenas service_role e super_admin podem criar/apagar.';
COMMENT ON COLUMN notifications.type IS
  'Convenções: trilha_faltando, cpf_faltando, pagamento_vencendo, pagamento_aprovado, video_aprovado, video_reprovado, producer_kyc_pendente, onboarding_concluido.';
COMMENT ON COLUMN notifications.metadata IS
  'JSON livre pra UI consumir (ex: {registration_id: "abc", payment_id: "pay_123"}).';

NOTIFY pgrst, 'reload schema';
