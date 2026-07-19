-- Fix de acompanhamento à migration 20260719_equipe_access_revocation.sql
-- (mesma sessão, achado durante /code-review antes de anunciar como pronto).
--
-- Dropar "any_authenticated_updates_profile_safe" quebrou uma feature real:
-- CheckIn.tsx (credenciamento de EQUIPE via QR) faz
-- `supabase.from('profiles').update({ last_checkin_at: now }).eq('id', id)`
-- onde `id` é o profile de OUTRA pessoa (o colega escaneado), não o do
-- staff que está escaneando — dependia inteiramente da policy fantasma pra
-- funcionar, nunca teve uma policy própria (confirmado: nenhuma migration
-- anterior criou RLS escopada pra esse UPDATE cross-user).
--
-- Fix: policy nova, escopada por evento — só produtor (dono do evento) ou
-- colega de equipe com permissão checkin_equipe do MESMO team_event_id pode
-- dar UPDATE no profile de outra pessoa. Colunas privilegiadas continuam
-- protegidas pelo trigger protect_profiles_privileged_columns independente
-- de qual policy liberou a linha — essa policy só afeta colunas já
-- desprotegidas (last_checkin_at, full_name, etc), agora com blast radius
-- limitado a "colega do mesmo evento", nunca mais "qualquer authenticated".
CREATE POLICY "equipe_checkin_updates_teammate_profile" ON profiles
  FOR UPDATE
  USING (
    team_event_id IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM events e WHERE e.id = profiles.team_event_id AND e.created_by = auth.uid())
      OR EXISTS (
        SELECT 1 FROM profiles caller
        WHERE caller.id = auth.uid()
          AND caller.team_event_id = profiles.team_event_id
          AND COALESCE((caller.permissoes_custom->>'checkin_equipe')::boolean, false) = true
      )
    )
  )
  WITH CHECK (
    team_event_id IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM events e WHERE e.id = profiles.team_event_id AND e.created_by = auth.uid())
      OR EXISTS (
        SELECT 1 FROM profiles caller
        WHERE caller.id = auth.uid()
          AND caller.team_event_id = profiles.team_event_id
          AND COALESCE((caller.permissoes_custom->>'checkin_equipe')::boolean, false) = true
      )
    )
  );

NOTIFY pgrst, 'reload schema';
