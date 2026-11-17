-- Nome opcional da sessao do espetaculo ("Elenco 1", "Elenco 2"...). Por sessao: nao entra nos campos
-- compartilhados do sync_session_group_shared. Vazio = a tela mostra so data e horario, como sempre.
ALTER TABLE events ADD COLUMN IF NOT EXISTS session_label TEXT;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_session_label_len;
ALTER TABLE events ADD CONSTRAINT events_session_label_len CHECK (session_label IS NULL OR char_length(session_label) <= 40);

-- A lista publica de sessoes passa a devolver o nome. Muda o tipo de retorno, entao recria a funcao.
DROP FUNCTION IF EXISTS public.get_event_sessions_public(uuid);
CREATE FUNCTION public.get_event_sessions_public(p_event_id uuid)
 RETURNS TABLE(id uuid, slug text, name text, start_date date, event_time text, is_current boolean, session_label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.slug, e.name, e.start_date, e.event_time, (e.id = p_event_id) AS is_current, e.session_label
    FROM events e
    JOIN events cur ON cur.id = p_event_id
   WHERE cur.session_group_id IS NOT NULL
     AND e.session_group_id = cur.session_group_id
     AND e.is_public IS TRUE
     AND e.payment_sandbox = cur.payment_sandbox
     AND (e.id = p_event_id OR e.start_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
   ORDER BY e.start_date, e.event_time NULLS LAST;
$function$;
GRANT EXECUTE ON FUNCTION public.get_event_sessions_public(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
