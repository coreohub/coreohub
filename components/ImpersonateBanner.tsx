import React, { useEffect, useState } from 'react';
import { Eye, Loader2, LogOut } from 'lucide-react';
import {
  getImpersonationContext,
  stopImpersonate,
  type ImpersonationContext,
} from '../services/impersonateService';

/** Banner sticky no topo do app quando o super admin está visualizando
    como outro produtor. Mostra contexto + botão "Sair" pra restaurar a
    session original. */
const ImpersonateBanner: React.FC = () => {
  const [ctx, setCtx] = useState<ImpersonationContext | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    setCtx(getImpersonationContext());
    // Cross-tab: se outra aba parar o impersonate, esta atualiza
    const onStorage = () => setCtx(getImpersonationContext());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!ctx) return null;

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await stopImpersonate();
      // Recarrega na página /super-admin pro super admin retomar contexto.
      // Reload é obrigatório pra todos os hooks/queries reagirem ao auth.uid() novo.
      window.location.replace('/super-admin');
    } catch (e: any) {
      alert(`Erro ao voltar pra Super Admin: ${e?.message ?? 'erro desconhecido'}`);
      setStopping(false);
    }
  };

  return (
    <div className="sticky top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-3 shadow-lg">
      <div className="flex items-center gap-2 min-w-0">
        <Eye size={14} className="shrink-0" />
        <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest truncate">
          Visualizando como{' '}
          <strong className="text-amber-950">
            {ctx.target_name ?? ctx.target_email}
          </strong>
          <span className="hidden sm:inline"> · {ctx.target_role}</span>
        </p>
      </div>
      <button
        onClick={handleStop}
        disabled={stopping}
        className="shrink-0 flex items-center gap-1.5 bg-amber-950 text-amber-50 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-900 disabled:opacity-50 transition-colors"
      >
        {stopping ? (
          <><Loader2 size={12} className="animate-spin" /> Saindo…</>
        ) : (
          <><LogOut size={12} /> Sair</>
        )}
      </button>
    </div>
  );
};

export default ImpersonateBanner;
