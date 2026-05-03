-- SECURITY FIX (2026-05-15): a policy anon_reads_public_judges introduzida em
-- 20260514_judges_public_profile.sql expunha PIN + judge_access_token de
-- jurados marcados como is_public=true. Atacante anônimo podia rodar
-- supabase.from('judges').select('*').eq('is_public', true) via PostgREST e
-- pegar o PIN de 4 dígitos do jurado.
--
-- Fix: drop da policy. A RPC get_public_judges_for_event (security definer)
-- continua funcionando pra anon e retorna SÓ campos seguros — é a única
-- via de leitura pública agora.

DROP POLICY IF EXISTS "anon_reads_public_judges" ON judges;

-- Confirma que a RPC continua acessível pra anon (idempotente)
GRANT EXECUTE ON FUNCTION get_public_judges_for_event(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
