-- ═══════════════════════════════════════════════════════════════════════
-- Cupons de desconto por evento
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS coupons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  max_uses       INT,
  used_count     INT NOT NULL DEFAULT 0,
  expires_at     DATE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_event    ON coupons(event_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code     ON coupons(event_id, code) WHERE is_active = TRUE;

-- Rastreia qual cupom foi aplicado em cada coreografia
ALTER TABLE coreografias
  ADD COLUMN IF NOT EXISTS coupon_id       UUID REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2);

-- ═══════════════════════════════════════════════════════════════════════
-- Tipo de evento: privado (com gateway) ou governamental (gratuito)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'private'
  CHECK (event_type IN ('private', 'government'));

-- RLS: produtor só vê/edita seus próprios cupons
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "producer_manages_own_coupons" ON coupons;
CREATE POLICY "producer_manages_own_coupons" ON coupons
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = coupons.event_id AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = coupons.event_id AND e.created_by = auth.uid()
    )
  );

-- Qualquer autenticado pode LER cupom ativo para validar no checkout
DROP POLICY IF EXISTS "anyone_can_validate_active_coupon" ON coupons;
CREATE POLICY "anyone_can_validate_active_coupon" ON coupons
  FOR SELECT
  USING (is_active = TRUE);
