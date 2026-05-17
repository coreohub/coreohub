-- ═══════════════════════════════════════════════════════════════════════
-- Fix: max_members salvo errado em Duo/Trio em events.formacoes_config
-- ═══════════════════════════════════════════════════════════════════════
-- Bug em pages/AccountSettings.tsx:1746 (antes do fix de 2026-05-17):
--   max_members: (f.minMembers ?? 1) > 1 ? 99 : 1
-- Qualquer formação com min_members > 1 (Duo, Trio, Conjunto/Grupo) salvava
-- max_members = 99. No InscricaoWizard, `maxMembers <= 3` é a branch que
-- pede @ Instagram POR bailarino (Solo/Duo/Trio); `> 3` é a branch do
-- campo único do grupo. Resultado: DUPLA inscrevendo via vitrine via
-- mostrava "@ do grupo ou coreógrafo" em vez de pedir um @ por dançarino.
--
-- Lógica correta (espelha o fix do save):
--   min_members = 1   → max_members = 1   (Solo)
--   min_members = 2   → max_members = 2   (Duo)
--   min_members = 3   → max_members = 3   (Trio)
--   min_members >= 4  → max_members = 99  (Conjunto/Grupo)
--
-- Esta migration normaliza os dados existentes alinhando max_members
-- pra cada formação dentro do JSONB de cada evento.

UPDATE events
SET formacoes_config = (
  SELECT jsonb_agg(
    CASE
      WHEN COALESCE((item->>'min_members')::int, 1) <= 3
        THEN jsonb_set(item, '{max_members}', to_jsonb(COALESCE((item->>'min_members')::int, 1)))
      ELSE jsonb_set(item, '{max_members}', '99'::jsonb)
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(formacoes_config) WITH ORDINALITY AS t(item, ordinality)
)
WHERE formacoes_config IS NOT NULL
  AND jsonb_typeof(formacoes_config) = 'array'
  AND jsonb_array_length(formacoes_config) > 0;
