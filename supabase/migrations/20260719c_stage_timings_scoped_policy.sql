-- Achado na varredura completa de policies fantasma pedida logo depois da
-- sessão de revogação de acesso (2026-07-19) — mesma varredura que a
-- pendência do CLAUDE.md já recomendava fazer de uma vez.
--
-- "Equipe pode inserir timings" (stage_timings, INSERT) tinha
-- WITH CHECK(true) pra role `public` — ou seja, literalmente qualquer um,
-- nem precisa estar logado, podia inserir linhas arbitrárias em
-- stage_timings (duração de apresentação por registration_id). Essa tabela
-- alimenta o Marcador de Palco (StageMarker.tsx) e é a fonte de dado pra
-- feature futura de "penalidade por tempo excedido"
-- ([[backlog_penalidade_tempo_excedido]]) — poluir esses dados tem efeito
-- real em apuração, não é só cosmético.
--
-- stage_timings não tem event_id direto — só registration_id. Escopo via
-- join em registrations.event_id, mesmo padrão da policy de check-in de
-- equipe (20260719b): produtor dono do evento OU equipe com
-- marcacao_palco=true do mesmo team_event_id que o evento da inscrição.
DROP POLICY IF EXISTS "Equipe pode inserir timings" ON stage_timings;

CREATE POLICY "equipe_marcacao_palco_inserts_timings" ON stage_timings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM registrations r
      JOIN events e ON e.id = r.event_id
      WHERE r.id = stage_timings.registration_id
        AND (
          e.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM profiles caller
            WHERE caller.id = auth.uid()
              AND caller.team_event_id = e.id
              AND COALESCE((caller.permissoes_custom->>'marcacao_palco')::boolean, false) = true
          )
        )
    )
  );

NOTIFY pgrst, 'reload schema';
