-- ═══════════════════════════════════════════════════════════════════════════
-- 20260709_notify_schedule_published.sql
--
-- Fase 3 do plano draft→publish do Cronograma (ver 20260708_schedule_publish.sql).
-- Ao publicar a ordem de apresentação, o produtor precisa disparar uma
-- notificação in-app pra cada inscrito com coreografia publicada — sem isso,
-- ninguém sabe que a posição mudou a não ser que abra o app por acaso.
--
-- `notifications` não tem policy de INSERT pra client comum (só service_role/
-- super_admin, decisão de 2026-05-22 pra impedir spoofing entre users) — por
-- isso a escrita precisa passar por uma RPC SECURITY DEFINER, igual o padrão
-- já usado em `mark_all_notifications_read()`.
--
-- A função valida que quem chama é o dono do evento (ou super_admin) antes
-- de inserir qualquer coisa — sem isso, qualquer authenticated poderia
-- notificar os inscritos de um evento que não é dele.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION notify_schedule_published(p_event_id uuid)
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized to notify this event';
  END IF;

  INSERT INTO notifications (user_id, event_id, type, severity, title, body, cta_url, cta_label)
  SELECT DISTINCT
    r.user_id, p_event_id, 'ordem_publicada', 'info',
    'Ordem de apresentação publicada',
    'Confira sua posição na fila de apresentação na tela Início.',
    '/dashboard', 'Ver ordem'
  FROM registrations r
  WHERE r.event_id = p_event_id
    AND r.user_id IS NOT NULL
    AND r.excluded_from_schedule = false
    AND r.ordem_apresentacao_publicado IS NOT NULL
    AND (r.status = 'APROVADA' OR r.status_pagamento IN ('APROVADO', 'CONFIRMADO'));

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION notify_schedule_published(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
