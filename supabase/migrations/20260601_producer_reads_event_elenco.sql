-- ═══════════════════════════════════════════════════════════════════════════
-- 20260601_producer_reads_event_elenco.sql
--
-- Permite ao PRODUTOR (created_by do evento) ler rows de `elenco` que estão
-- referenciadas pelas inscrições do próprio evento via `bailarinos_detalhes`.
--
-- Necessário pra feature "dados pendentes" (cron + banner + chip): o helper
-- agora faz JOIN entre `registrations.bailarinos_detalhes[].id` e `elenco.id`
-- pra verificar CPF/data_nascimento reais. Sem essa policy, produtor enxerga
-- `elenco` filtrado por RLS (0 rows pra inscrições de outros users) e o
-- helper trataria TUDO como incompleto (mesmo bug do 4602573, agora vindo
-- do RLS em vez do shape errado).
--
-- Decisão de escopo (LGPD): filtra elenco PELOS IDs que aparecem em
-- registrations do produtor, em vez de expor todo o elenco do user inscrito.
-- Custo: subquery com `jsonb_array_elements` por row de elenco consultada,
-- mas em escala atual (poucas centenas de bailarinos por evento) tolerável.
--
-- O DROP IF EXISTS desse nome já existia em 20260428_security_rls.sql:111
-- (preparado mas nunca criado) — só preenchemos agora.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "producer_reads_event_elenco" ON elenco;
CREATE POLICY "producer_reads_event_elenco" ON elenco
  FOR SELECT
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
  );

NOTIFY pgrst, 'reload schema';
