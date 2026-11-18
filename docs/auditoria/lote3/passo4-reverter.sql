-- Reverte D1.
GRANT EXECUTE ON FUNCTION public.is_event_fully_free(uuid) TO PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
