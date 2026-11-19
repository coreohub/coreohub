-- Lote 3, D2: 5.334 de 5.658 notas em `evaluations` pertenciam a eventos ja apagados (179 eventos, sem inscricao
-- nem, em geral, jurado). Nenhuma tela as alcanca e apagar um evento nao apagava as notas.
-- 1) copia as orfas para uma tabela de backup (so service_role/postgres), 2) apaga SOMENTE se a copia bate,
-- 3) cria a FK com cascata para parar de gerar orfas. Reverter: docs/auditoria/lote3/passo5-reverter.sql
CREATE TABLE IF NOT EXISTS public.evaluations_orfas_backup_20261119 AS
  SELECT ev.* FROM public.evaluations ev
  WHERE NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = ev.event_id);

ALTER TABLE public.evaluations_orfas_backup_20261119 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evaluations_orfas_backup_20261119 FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_orfas INT; v_backup INT;
BEGIN
  SELECT count(*) INTO v_orfas FROM public.evaluations ev WHERE NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = ev.event_id);
  SELECT count(*) INTO v_backup FROM public.evaluations_orfas_backup_20261119;
  IF v_backup < v_orfas THEN
    RAISE EXCEPTION 'backup (%) menor que as orfas (%): nada foi apagado', v_backup, v_orfas;
  END IF;
  DELETE FROM public.evaluations ev
   WHERE NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = ev.event_id)
     AND EXISTS (SELECT 1 FROM public.evaluations_orfas_backup_20261119 b WHERE b.id = ev.id);
END $$;

ALTER TABLE public.evaluations
  ADD CONSTRAINT evaluations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
