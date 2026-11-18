-- Pos-migration D1 (leitura): esperado anon=false, authenticated=true, service_role=true.
select has_function_privilege('anon','public.is_event_fully_free(uuid)','EXECUTE') anon,
       has_function_privilege('authenticated','public.is_event_fully_free(uuid)','EXECUTE') authenticated,
       has_function_privilege('service_role','public.is_event_fully_free(uuid)','EXECUTE') service_role;
