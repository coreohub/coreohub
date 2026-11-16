-- Auditoria 2026-11-16 (Lote 2, C#11 e C#8): 16 funções SECURITY DEFINER do schema public sem search_path
-- fixo (permite sequestro por objeto de mesmo nome em schema anterior no path). Conferido: tudo fora de
-- public é qualificado (auth., net.), então fixar 'public, pg_temp' não muda o comportamento. Idempotente.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f);
  END LOOP;
END $$;

-- cleanup_old_audio_feedbacks apaga arquivos do Storage: só o cron (dono) e a service_role precisam executar.
REVOKE EXECUTE ON FUNCTION public.cleanup_old_audio_feedbacks() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_old_audio_feedbacks() TO service_role;
