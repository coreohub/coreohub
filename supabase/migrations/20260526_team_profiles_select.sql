-- Permite qualquer user autenticado LER profiles cujo role esteja na
-- lista de papeis de equipe operacional. Antes, a unica SELECT policy
-- de profiles era super_admin_reads_all_profiles + a default 'auth.uid()
-- = id' (cada user le so o proprio). Resultado: telas /minha-equipe e
-- /credenciais aba Equipe mostravam 0 membros mesmo com staff cadastrado
-- e role correto no banco.
--
-- Trade-off conhecido: produtor A pode listar staff de produtor B.
-- Aceitavel pro lancamento (lista so nome+role+cargo, dados nao
-- sensiveis). Pra multi-tenant rigoroso futuro: adicionar coluna
-- profiles.created_by_producer (ou usar user_metadata.demo_creator_id
-- ja gravado no signup) e restringir USING(produtor = auth.uid()).

DROP POLICY IF EXISTS "authenticated_reads_team_profiles" ON profiles;
CREATE POLICY "authenticated_reads_team_profiles" ON profiles
  FOR SELECT TO authenticated
  USING (
    role IN (
      'STAFF', 'COORDENADOR', 'MESARIO',
      'SONOPLASTA', 'RECEPCAO', 'PALCO'
    )
  );

NOTIFY pgrst, 'reload schema';
