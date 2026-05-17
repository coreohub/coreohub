-- ═══════════════════════════════════════════════════════════════════════
-- Fase 4B — Pixels de marketing por produtor (GA4 + Meta Pixel)
-- ═══════════════════════════════════════════════════════════════════════
-- Cada produtor pluga seus próprios IDs de tracking pra ver eventos do
-- festival dele isolados no GA/Pixel próprio. CoreoHub continua medindo
-- agregado na conta master (já configurada no index.html).
--
-- Eventos disparados em paralelo nas páginas públicas do festival:
-- - PublicEventPage (vitrine)
-- - InscricaoWizard (passos 1-4)
-- - Checkout
-- - Página de sucesso pós-pagamento
--
-- IDs são públicos por design (vão no HTML do cliente). RLS de events já
-- restringe escrita ao dono do evento, então herda o controle.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS producer_ga4_id        TEXT,
  ADD COLUMN IF NOT EXISTS producer_meta_pixel_id TEXT;

COMMENT ON COLUMN events.producer_ga4_id IS
  'Measurement ID GA4 do produtor (formato G-XXXXXXXXXX). Dispara eventos em paralelo ao GA master da CoreoHub.';
COMMENT ON COLUMN events.producer_meta_pixel_id IS
  'Pixel ID Meta/Facebook do produtor (15-16 dígitos). Dispara eventos em paralelo ao Pixel master da CoreoHub.';
