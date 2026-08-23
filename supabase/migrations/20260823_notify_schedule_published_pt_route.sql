-- Atualiza notify_schedule_published() (20260709) pra usar a nova rota
-- canônica em PT (/inicio) no lugar de /dashboard — a rota antiga continua
-- funcionando via alias reverso em App.tsx, mas notificações NOVAS devem
-- usar o caminho atual. Nunca editar a migration original já aplicada.
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
    '/inicio', 'Ver ordem'
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

NOTIFY pgrst, 'reload schema';
