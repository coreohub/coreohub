-- Corrige vazamento cross-tenant descoberto em revisão: a policy
-- authenticated_reads_team_profiles (20260526) liberava LEITURA de
-- qualquer profile com role de equipe operacional pra QUALQUER usuário
-- autenticado — produtor A conseguia listar nome+e-mail+cargo da equipe
-- de produtor B em /minha-equipe e /credenciais (aba Equipe). Era um
-- trade-off aceito na época ("resolver quando tiver multi-tenant
-- rigoroso"), documentado no comentário da própria migration original.
--
-- profiles.team_event_id (20260702) já dá o vínculo que faltava: agora
-- só quem CRIOU o evento (events.created_by = auth.uid()) enxerga a
-- equipe vinculada a esse evento. Cada membro continua enxergando o
-- próprio profile (id = auth.uid()) e super admin continua vendo tudo.
--
-- Validado em prod antes de aplicar: os 3 membros de equipe existentes
-- (Gravidade/Cultural Estúdio/Will Nunes) já têm team_event_id setado
-- corretamente pro evento do Hemer — não há legado com team_event_id
-- NULL que ficaria invisível pro próprio produtor após esse fix.

DROP POLICY IF EXISTS "authenticated_reads_team_profiles" ON profiles;
CREATE POLICY "authenticated_reads_team_profiles" ON profiles
  FOR SELECT TO authenticated
  USING (
    role IN (
      'STAFF', 'COORDENADOR', 'MESARIO',
      'SONOPLASTA', 'RECEPCAO', 'PALCO'
    )
    AND (
      id = auth.uid()
      OR is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = profiles.team_event_id AND e.created_by = auth.uid()
      )
    )
  );

NOTIFY pgrst, 'reload schema';
