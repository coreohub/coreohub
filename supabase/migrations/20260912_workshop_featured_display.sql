-- ════════════════════════════════════════════════════════════════════════════
-- Workshops: destaque visual (card dourado + selo) + ordem manual de exibição
-- Frente 3 do planejamento do Vicenza Dance Camp (Lorrayne) — mas genérico
-- pra qualquer produtor que queira destacar 1 pass/workshop como "melhor
-- custo-benefício" na vitrine, igual pedido dela no PDF de precificação.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS display_order INT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_badge_text TEXT;

COMMENT ON COLUMN workshops.display_order IS
  'Ordem manual de exibição na vitrine (menor = primeiro). NULL = cai no fallback por data_inicio.';
COMMENT ON COLUMN workshops.is_featured IS
  'Card em destaque na vitrine (maior, borda/acabamento dourado) — ex: pass "melhor custo-benefício" de um camp.';
COMMENT ON COLUMN workshops.featured_badge_text IS
  'Texto do selo mostrado no card em destaque, ex: "MELHOR CUSTO-BENEFÍCIO". NULL = sem selo mesmo com is_featured=true.';

NOTIFY pgrst, 'reload schema';
