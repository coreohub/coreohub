-- ════════════════════════════════════════════════════════════════════════════
-- Preço por zona do mapa de assentos — Etapa 1: schema.
--
-- Modelo (pesquisa 2026-11-07: Seats.io, pretix, Tessitura, Billetto):
--   * O evento define até 8 zonas (nome + cor): events.seat_zones.
--   * Cada assento pertence a UMA zona: event_seats.zone_key.
--     NULL = zona "geral" (sem preço próprio: cai no preço-base do lote).
--   * O PREÇO por zona vive em events.ingressos_config[i]:
--       - sem lotes: ingressos_config[i].precos_por_zona = {zona: preco}
--       - com lotes: ingressos_config[i].lotes[j].precos_por_zona = {zona: preco}
--     (jsonb já existente, nenhuma coluna nova de preço).
--   * Zona sem preço informado cai no preço-base (preco do lote/tipo), então
--     evento SEM zonas continua idêntico ao de hoje.
--   * A zona de um assento NÃO muda depois que ele foi reservado/vendido/
--     cortesia (erro mais citado na pesquisa: assento vendido solto da zona).
--
-- Aditiva e segura em produção: só colunas novas com default + 1 trigger que
-- age apenas em UPDATE de zone_key (nenhum fluxo atual escreve essa coluna).
-- Não cria tabela nova, então não precisa de GRANT novo.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS seat_zones JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_seat_zones_check') THEN
    ALTER TABLE events
      ADD CONSTRAINT events_seat_zones_check
      CHECK (jsonb_typeof(seat_zones) = 'array' AND jsonb_array_length(seat_zones) <= 8);
  END IF;
END $$;

ALTER TABLE event_seats
  ADD COLUMN IF NOT EXISTS zone_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_seats_zone_key_check') THEN
    ALTER TABLE event_seats
      ADD CONSTRAINT event_seats_zone_key_check
      CHECK (zone_key IS NULL OR zone_key ~ '^[a-z0-9_-]{1,24}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_seats_zone
  ON event_seats(event_id, zone_key) WHERE zone_key IS NOT NULL;

-- ── Trava: zona não muda com assento reservado/vendido/cortesia ──────────────
CREATE OR REPLACE FUNCTION protect_event_seat_zone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.zone_key IS DISTINCT FROM OLD.zone_key
     AND OLD.status IN ('reservado', 'vendido', 'cortesia') THEN
    RAISE EXCEPTION 'Assento % já está % e não pode trocar de zona.', OLD.seat_id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_event_seat_zone ON event_seats;
CREATE TRIGGER trg_protect_event_seat_zone
  BEFORE UPDATE OF zone_key ON event_seats
  FOR EACH ROW EXECUTE FUNCTION protect_event_seat_zone();

NOTIFY pgrst, 'reload schema';
