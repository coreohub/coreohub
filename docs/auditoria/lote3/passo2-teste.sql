-- Conferencia pos-migration B2 (somente leitura): anon/authenticated NAO devem ter EXECUTE; service_role deve.
SELECT has_function_privilege('anon',         'public.resolve_judge_short_code(text)', 'EXECUTE') AS anon_pode,          -- esperado false
       has_function_privilege('authenticated','public.resolve_judge_short_code(text)', 'EXECUTE') AS authenticated_pode, -- esperado false
       has_function_privilege('service_role', 'public.resolve_judge_short_code(text)', 'EXECUTE') AS service_role_pode;  -- esperado true
