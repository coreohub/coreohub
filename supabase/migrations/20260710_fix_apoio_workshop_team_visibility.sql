-- Fix: role APOIO_WORKSHOP (Apoio de Workshop) existe desde 2026-07-08
-- como preset em EquipeProdutor.tsx (EQUIPE_ROLES), mas nunca foi
-- adicionado à lista de roles liberada pela policy de leitura de
-- profiles (authenticated_reads_team_profiles, 20260708). Resultado:
-- membro convidado como Apoio de Workshop funciona normalmente (escaneia
-- QR de presença), mas some da tela /minha-equipe — RLS bloqueia a
-- leitura do profile, então o produtor não consegue ver, editar
-- permissões nem remover essa pessoa pela UI.

DROP POLICY IF EXISTS "authenticated_reads_team_profiles" ON profiles;
CREATE POLICY "authenticated_reads_team_profiles" ON profiles
  FOR SELECT TO authenticated
  USING (
    role IN (
      'STAFF', 'COORDENADOR', 'MESARIO',
      'SONOPLASTA', 'RECEPCAO', 'PALCO', 'APOIO_WORKSHOP'
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
