-- Escopo de equipe pra audience_tickets + workshop_registrations.
--
-- Achado durante o desenho da venda presencial (PDV): as duas tabelas só
-- tinham RLS de created_by = auth.uid() (dono do evento) desde a criação
-- (20260513/20260519). Diferente de `registrations`, que ganhou escopo de
-- equipe em 20260702_team_event_scoping.sql (via profiles.team_event_id +
-- get_team_event_id()), audience_tickets/workshop_registrations nunca
-- receberam o mesmo fix. Na prática: um membro RECEPCAO/APOIO_WORKSHOP
-- logado com a própria conta (não a do produtor) provavelmente recebe
-- silenciosamente "Sem permissão pra marcar este ingresso" ao tentar
-- check-in de ingresso de plateia ou presença de workshop — mesma classe de
-- bug já documentada em registrations (2026-05-22) e events (2026-07-17).
--
-- Reaproveita get_team_event_id(uid) (SECURITY DEFINER, já existe desde
-- 20260717) pra evitar recursão de RLS em profiles.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY.

-- ── audience_tickets ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS team_reads_linked_audience_tickets ON audience_tickets;
CREATE POLICY team_reads_linked_audience_tickets ON audience_tickets
  FOR SELECT
  TO authenticated
  USING (event_id = get_team_event_id(auth.uid()));

DROP POLICY IF EXISTS team_updates_linked_audience_tickets ON audience_tickets;
CREATE POLICY team_updates_linked_audience_tickets ON audience_tickets
  FOR UPDATE
  TO authenticated
  USING (event_id = get_team_event_id(auth.uid()))
  WITH CHECK (event_id = get_team_event_id(auth.uid()));
-- Nota: protect_audience_tickets_columns_trigger (20260610) já limita o que
-- qualquer não-service_role pode alterar num UPDATE (só check-in + nome/
-- telefone) — essa policy só abre a LINHA pra equipe, não destrava coluna
-- nenhuma além do que o trigger já permite pro produtor dono.

-- ── workshop_registrations (join via workshops.event_id — workshop pode
--    ser standalone com event_id NULL, get_team_event_id nunca bate nesse
--    caso, então workshop standalone continua só do dono, como já era) ────
DROP POLICY IF EXISTS team_reads_linked_workshop_registrations ON workshop_registrations;
CREATE POLICY team_reads_linked_workshop_registrations ON workshop_registrations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_registrations.workshop_id
        AND w.event_id = get_team_event_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS team_updates_linked_workshop_registrations ON workshop_registrations;
CREATE POLICY team_updates_linked_workshop_registrations ON workshop_registrations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_registrations.workshop_id
        AND w.event_id = get_team_event_id(auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
