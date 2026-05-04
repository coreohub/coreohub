-- Phase 5 — Offline-first (FIX da Etapa 1).
--
-- A migration anterior (20260521_offline_idempotency.sql) criou um partial
-- unique index com `WHERE client_uuid IS NOT NULL`. Postgres exige que
-- `ON CONFLICT (col)` tenha o MESMO predicate pra inferir partial unique
-- indexes — mas supabase-js / PostgREST não emite o WHERE. Isso faria a
-- edge function quebrar com:
--
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Bug só explode no replay (1º insert sempre passa sem conflict), então não
-- foi pego em build/check.
--
-- Fix: trocar por UNIQUE INDEX simples. NULLs são tratados como distintos
-- por default em Postgres (NULLS DISTINCT), então clientes legacy continuam
-- convivendo livremente.

DROP INDEX IF EXISTS evaluations_client_uuid_key;

CREATE UNIQUE INDEX IF NOT EXISTS evaluations_client_uuid_key
  ON evaluations (client_uuid);

NOTIFY pgrst, 'reload schema';
