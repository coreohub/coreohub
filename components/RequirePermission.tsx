import React from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useMyPermissions } from '../hooks/usePermission';
import { PermissoesCustom } from '../types';

/**
 * Blinda uma rota pra membros de equipe com permissoes_custom granular.
 * Antes, `permissoes_custom` só decidia o que aparecia no Sidebar — quem
 * tinha o link direto acessava a página inteira mesmo sem a permissão
 * marcada. Produtor/COREOHUB_ADMIN/membro legado (permissoes_custom NULL)
 * nunca são bloqueados por este componente.
 *
 * `perm` aceita uma chave só ou uma lista (libera se QUALQUER uma bater —
 * ex: /registrations serve tanto quem tem inscricoes_leitura quanto quem
 * só tem triagem).
 */
const RequirePermission = ({
  perm, children,
}: {
  perm: keyof PermissoesCustom | (keyof PermissoesCustom)[];
  children: React.ReactNode;
}) => {
  const { has, loading } = useMyPermissions();
  const keys = Array.isArray(perm) ? perm : [perm];
  const allowed = keys.some(k => has(k));

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={28} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center py-16 px-6 bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-3xl">
        <ShieldAlert size={40} className="mx-auto text-slate-400 mb-3" />
        <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Acesso restrito</p>
        <p className="text-[11px] text-slate-400 mt-2">Você não tem permissão pra acessar esta página. Fale com o coordenador do evento.</p>
      </div>
    );
  }

  return <>{children}</>;
};

export default RequirePermission;
