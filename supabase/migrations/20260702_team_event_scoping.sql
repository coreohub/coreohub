-- Patch mínimo pra convite de equipe ficar vinculado a um evento específico.
--
-- Problema: team_invites/profiles.role não guardavam PRA QUAL evento a
-- pessoa é equipe. Telas como Cronograma (Schedule.tsx) filtram o seletor
-- de evento por `events.created_by = auth.uid()` — funciona pro produtor,
-- mas um membro de equipe (created_by é do PRODUTOR, não dele) nunca via
-- nenhum evento na lista, mesmo com role/permissões corretas.
--
-- Fix: team_invites.event_id (capturado do evento ativo do produtor ao
-- convidar) + profiles.team_event_id (copiado no aceite do convite).
-- profiles.team_event_id entra na lista de colunas protegidas do trigger
-- de segurança (20260509) pela mesma razão do role: sem isso, qualquer
-- authenticated poderia se auto-atribuir a um evento de outro produtor.

ALTER TABLE team_invites ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_team_invites_event_id ON team_invites(event_id);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_event_id UUID REFERENCES events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_team_event_id ON profiles(team_event_id) WHERE team_event_id IS NOT NULL;

-- Estende o trigger de colunas privilegiadas (20260509_protect_profiles_privileged_columns.sql)
-- pra também proteger team_event_id. Só service_role (Edge Function apply-team-invite)
-- ou super admin podem setar.
CREATE OR REPLACE FUNCTION protect_profiles_privileged_columns() RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- SQL Editor / migrations admin rodam como postgres/supabase_admin, sem
  -- contexto de auth.role()/auth.uid() — sem essa exceção, UPDATE manual
  -- direto no Dashboard era revertido silenciosamente pra OLD (mesmo padrão
  -- já usado em protect_registrations_status_columns).
  IF current_user IN ('postgres', 'supabase_admin', 'supabase_storage_admin') THEN
    RETURN NEW;
  END IF;

  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  NEW.is_super_admin            := OLD.is_super_admin;
  NEW.is_blocked                := OLD.is_blocked;
  NEW.role                      := OLD.role;
  -- is_coordenador_juri nunca existiu como coluna (fix 20260514) — não
  -- reintroduzir essa linha.
  NEW.team_event_id             := OLD.team_event_id;

  NEW.default_commission_percent := OLD.default_commission_percent;

  NEW.asaas_wallet_id           := OLD.asaas_wallet_id;
  NEW.asaas_subconta_id         := OLD.asaas_subconta_id;
  NEW.asaas_api_key             := OLD.asaas_api_key;

  NEW.judge_access_token        := OLD.judge_access_token;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Estende as policies de registrations pra também liberar quem é equipe
-- do evento (profiles.team_event_id = registrations.event_id), não só
-- created_by do evento. Sem isso, mesmo com o picker do Cronograma
-- mostrando o evento certo, a query de inscrições voltava vazia (RLS
-- silenciosamente filtrava tudo).
DROP POLICY IF EXISTS "producer_reads_event_registrations" ON registrations;
CREATE POLICY "producer_reads_event_registrations" ON registrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.team_event_id = registrations.event_id
    )
  );

DROP POLICY IF EXISTS "producer_updates_event_registrations" ON registrations;
CREATE POLICY "producer_updates_event_registrations" ON registrations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.team_event_id = registrations.event_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = registrations.event_id AND e.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.team_event_id = registrations.event_id
    )
  );

NOTIFY pgrst, 'reload schema';
