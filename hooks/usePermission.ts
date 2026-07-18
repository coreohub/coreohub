import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { PermissoesCustom, UserRole } from '../types';

// Papéis de inscrito comum — nunca passam por convite de equipe, nunca têm
// permissoes_custom preenchido por design. É justamente esse grupo que
// vazava acesso total antes do fix de 2026-07-18 (ver abaixo).
const INSCRITO_LIKE_ROLES = new Set<UserRole>([
  UserRole.STUDIO_DIRECTOR, UserRole.CHOREOGRAPHER, UserRole.INDEPENDENT,
  UserRole.USER, UserRole.SPECTATOR, UserRole.TEAM, UserRole.JUDGE,
]);

/**
 * Lê role + permissoes_custom do usuário logado uma única vez.
 * Produtor (ORGANIZER) e COREOHUB_ADMIN mantêm acesso irrestrito. Cargos
 * operacionais de equipe (COORDENADOR/MESARIO/SONOPLASTA/...) com
 * permissoes_custom preenchido são gateados estritamente pela flag; sem
 * permissoes_custom (conta de equipe legada, criada antes desse sistema
 * existir) mantêm o acesso irrestrito de sempre — não há como saber a
 * granularidade que essa conta deveria ter, e negar tudo quebraria acesso
 * já concedido pelo produtor.
 *
 * Antes (até 2026-07-18), esse fallback permissivo também cobria papéis de
 * INSCRITO comum — que, pela mesma razão (nunca passam por convite de
 * equipe), também nunca têm permissoes_custom preenchido. Resultado: um
 * inscrito digitando a URL de `/qg-organizador` ou `/check-in` direto
 * passava por este gate como se fosse produtor (RLS no backend ainda
 * barrava os DADOS, mas a ROTA renderizava). Fix: `INSCRITO_LIKE_ROLES`
 * nunca herda o fallback permissivo, só é liberado por flag explícita.
 */
export function useMyPermissions() {
  const [perms, setPerms] = useState<PermissoesCustom | null | undefined>(undefined);
  const [role, setRole] = useState<UserRole | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setPerms(null); setRole(null); } return; }
      const { data } = await supabase.from('profiles').select('role, permissoes_custom').eq('id', user.id).maybeSingle();
      if (active) {
        setPerms(data?.permissoes_custom ?? null);
        setRole((data?.role as UserRole) ?? null);
      }
    })();
    return () => { active = false; };
  }, []);

  const loading = perms === undefined || role === undefined;
  const isFullAccessRole =
    role === UserRole.ORGANIZER || role === UserRole.COREOHUB_ADMIN
    || (perms === null && role !== null && !INSCRITO_LIKE_ROLES.has(role));
  const has = useCallback(
    (key: keyof PermissoesCustom) => loading || isFullAccessRole || perms?.[key] === true,
    [perms, loading, isFullAccessRole],
  );

  return { perms, has, loading };
}
