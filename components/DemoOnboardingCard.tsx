/**
 * Card de empty state pra produtor sem eventos.
 *
 * Pattern Trello/Notion (research-backed): produtor novo loga e ve telas
 * vazias = 60%+ drop-off. Solucao: oferece "evento de demonstracao" populado
 * pra ele explorar todas as features sem cadastrar 50 coreografias na unha.
 *
 * Aparece SO quando allEvents.length === 0 no Dashboard.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Plus, Loader2, Check, Trophy, Users, Music } from 'lucide-react';
import { demoCreate } from '../services/demoApi';

const DemoOnboardingCard: React.FC = () => {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const handleCreateDemo = async () => {
    setCreating(true);
    try {
      const result = await demoCreate();
      // Recarrega pra puxar o novo evento
      window.location.reload();
    } catch (e: any) {
      alert('Erro ao criar evento demo: ' + (e?.message ?? 'desconhecido'));
      setCreating(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-[#ff0068]/10 via-violet-500/5 to-amber-500/10 border-2 border-[#ff0068]/20 rounded-3xl p-8 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-8 opacity-5">
        <Sparkles size={120} />
      </div>

      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-[#ff0068]" />
          <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ff0068]">
            Comece a explorar
          </span>
        </div>

        <h2 className="text-3xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white mb-2">
          Bem-vindo ao <span className="text-[#ff0068]">CoreoHub</span>
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl mb-6 leading-relaxed">
          Você ainda não criou nenhum evento. Pra explorar todas as features (Mesa de Som, Terminal de Júri, Coordenador, Premiação, Resultados), <strong className="text-slate-900 dark:text-white">adicione um evento de demonstração</strong> com dados fictícios e teste tudo sem afetar dados reais.
        </p>

        {/* Stats do que será criado */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white/60 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 text-center">
            <Music size={16} className="mx-auto mb-1 text-[#ff0068]" />
            <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">50</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Coreografias</p>
          </div>
          <div className="bg-white/60 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 text-center">
            <Users size={16} className="mx-auto mb-1 text-violet-500" />
            <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">3</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Jurados</p>
          </div>
          <div className="bg-white/60 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 text-center">
            <Trophy size={16} className="mx-auto mb-1 text-amber-500" />
            <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">5</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Prêmios</p>
          </div>
          <div className="bg-white/60 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 text-center">
            <Check size={16} className="mx-auto mb-1 text-emerald-500" />
            <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">5</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Estilos</p>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleCreateDemo}
            disabled={creating}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-50"
          >
            {creating
              ? <><Loader2 size={14} className="animate-spin" /> Populando...</>
              : <><Sparkles size={14} /> Adicionar Evento de Demonstração</>
            }
          </button>
          <button
            onClick={() => navigate('/account-settings')}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 text-slate-700 dark:text-slate-200 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all"
          >
            <Plus size={14} /> Criar Meu Primeiro Evento
          </button>
        </div>

        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-4 italic">
          Você pode remover ou recriar o evento de demonstração a qualquer momento em <strong>Configurações</strong>.
        </p>
      </div>
    </div>
  );
};

export default DemoOnboardingCard;
