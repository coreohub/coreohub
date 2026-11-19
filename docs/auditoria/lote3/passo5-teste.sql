-- Pos-migration B4/D2 (leitura). Esperado: orfas_restantes=0, backup=5334 (ou o numero na hora), validas inalteradas (324+), FK existe.
select (select count(*) from public.evaluations ev where not exists (select 1 from public.events e where e.id=ev.event_id)) orfas_restantes,
       (select count(*) from public.evaluations_orfas_backup_20261119) backup,
       (select count(*) from public.evaluations) total_atual,
       (select count(*) from pg_constraint where conname='evaluations_event_id_fkey') fk,
       (select string_agg(id||'='||coalesce(file_size_limit::text,'null'), ', ' order by id) from storage.buckets) buckets;
