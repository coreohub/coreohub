import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { PermissoesCustom } from '../types';

/**
 * Lê permissoes_custom do usuário logado uma única vez. `permissoes_custom`
 * sempre presente (não-nulo) significa "membro de equipe com escopo
 * granular" — só nesse caso a permissão é de fato checada. Produtor,
 * COREOHUB_ADMIN e membro legado sem granularidade (permissoes_custom NULL)
 * mantêm acesso irrestrito, igual ao comportamento de antes dessas
 * permissões existirem.
 */
export function useMyPermissions() {
  const [perms, setPerms] = useState<PermissoesCustom | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setPerms(null); return; }
      const { data } = await supabase.from('profiles').select('permissoes_custom').eq('id', user.id).maybeSingle();
      if (active) setPerms(data?.permissoes_custom ?? null);
    })();
    return () => { active = false; };
  }, []);

  const loading = perms === undefined;
  const has = useCallback(
    (key: keyof PermissoesCustom) => loading || perms === null || perms === undefined || perms[key] === true,
    [perms, loading],
  );

  return { perms, has, loading };
}
