-- ═══════════════════════════════════════════════════════════════════════════
-- 20260602_producer_updates_event_elenco.sql
--
-- Permite ao PRODUTOR fazer UPDATE em rows de `elenco` referenciadas em
-- inscrições do próprio evento (mesmo critério da policy FOR SELECT de
-- 20260601). Sem isso, produtor edita CPF/nome/data via modal do painel
-- /registrations e o UPDATE retorna 0 rows silently — mesmo bug do RLS
-- de registrations descoberto em 2026-05-21 (commit ded2e3e).
--
-- Escopo deliberado:
-- - SÓ FOR UPDATE. Produtor NÃO faz INSERT nem DELETE em elenco. Isso é
--   responsabilidade do INSCRITO (dono da row, via inscrito_own_elenco).
-- - UI no painel /registrations bloqueia "+ Adicionar" e "Remover" pra
--   produtor (prop canAddRemove=false no BailarinosEditor).
-- - Se produtor precisa adicionar um bailarino, pede pro inscrito completar
--   via /minhas-coreografias.
--
-- WITH CHECK = mesma USING garante que produtor não consegue "mover" a row
-- pra um inscrito de outro produtor (alterando user_id). Trigger separado
-- protegendo user_id imutável fica pra próxima sessão se virar problema.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "producer_updates_event_elenco" ON elenco;
CREATE POLICY "producer_updates_event_elenco" ON elenco
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM registrations r
      JOIN events e ON e.id = r.event_id
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(r.bailarinos_detalhes, '[]'::jsonb)
      ) AS bd
      WHERE e.created_by = auth.uid()
        AND (bd->>'id') = elenco.id::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM registrations r
      JOIN events e ON e.id = r.event_id
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(r.bailarinos_detalhes, '[]'::jsonb)
      ) AS bd
      WHERE e.created_by = auth.uid()
        AND (bd->>'id') = elenco.id::text
    )
  );

NOTIFY pgrst, 'reload schema';
