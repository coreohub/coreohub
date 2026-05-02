/**
 * Aba "Demo" em AccountSettings.
 *
 * Permite produtor:
 *   - Ver se ja tem evento demo ativo
 *   - Recriar (deleta atual + cria novo) — util pra resetar apos testar
 *   - Remover (sem recriar)
 *
 * Pattern Stripe Test Mode + Notion templates: sempre disponivel pra
 * regerar quantas vezes quiser. Coexiste com eventos reais.
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Loader2, Music, Users, Trophy } from 'lucide-react';
import { demoStatus, demoCreate, demoDelete, type DemoStatus } from '../services/demoApi';

const DemoSettingsTab: React.FC = () => {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'create' | 'delete' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const s = await demoStatus();
      setStatus(s);
    } catch (e: any) {
      console.error('demoStatus:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (status?.has_demo && !confirm('Recriar evento demo? O atual será deletado e um novo será criado com dados aleatórios.')) {
      return;
    }
    setBusy('create');
    setFeedback(null);
    try {
      const result = await demoCreate();
      setFeedback(`✓ Demo criado com ${result.stats.coreografias} coreografias, ${result.stats.jurados} jurados e ${result.stats.prêmios} prêmios.`);
      await load();
      setTimeout(() => window.location.reload(), 1500); // recarrega pra atualizar evento ativo
    } catch (e: any) {
      setFeedback('Erro: ' + (e?.message ?? 'desconhecido'));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Remover evento demo? Todos os dados de demonstração serão apagados (inscrições, jurados, configurações).')) {
      return;
    }
    setBusy('delete');
    setFeedback(null);
    try {
      await demoDelete();
      setFeedback('✓ Evento demo removido.');
      await load();
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      setFeedback('Erro: ' + (e?.message ?? 'desconhecido'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
          Evento de <span className="text-[#ff0068]">Demonstração</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Crie um evento fictício completo (50 coreografias, 3 jurados, prêmios, cronograma) pra explorar todas as features sem afetar dados reais. Coexiste com seus eventos reais.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin text-[#ff0068]" />
        </div>
      ) : status?.has_demo ? (
        // Demo já existe — opções recriar/remover
        <div className="bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-300 dark:border-amber-500/30 rounded-3xl p-6">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle2 size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black uppercase tracking-tight text-amber-700 dark:text-amber-300">
                Evento demo ativo
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                {status.demo?.name}
              </p>
              {status.demo?.created_at && (
                <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5 italic">
                  Criado em {new Date(status.demo.created_at).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleCreate}
              disabled={busy !== null}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {busy === 'create'
                ? <><Loader2 size={14} className="animate-spin" /> Recriando...</>
                : <><RefreshCw size={14} /> Recriar Demo</>
              }
            </button>
            <button
              onClick={handleDelete}
              disabled={busy !== null}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {busy === 'delete'
                ? <><Loader2 size={14} className="animate-spin" /> Removendo...</>
                : <><Trash2 size={14} /> Remover Demo
              </>}
            </button>
          </div>
        </div>
      ) : (
        // Sem demo — oferece criar
        <div className="bg-gradient-to-br from-[#ff0068]/10 via-violet-500/5 to-amber-500/10 border-2 border-[#ff0068]/20 rounded-3xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-[#ff0068]" />
            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ff0068]">
              Adicionar evento de demonstração
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white/60 dark:bg-white/5 rounded-2xl p-3 text-center">
              <Music size={14} className="mx-auto mb-1 text-[#ff0068]" />
              <p className="text-lg font-black text-slate-900 dark:text-white tabular-nums">50</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Coreografias</p>
            </div>
            <div className="bg-white/60 dark:bg-white/5 rounded-2xl p-3 text-center">
              <Users size={14} className="mx-auto mb-1 text-violet-500" />
              <p className="text-lg font-black text-slate-900 dark:text-white tabular-nums">3</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Jurados</p>
            </div>
            <div className="bg-white/60 dark:bg-white/5 rounded-2xl p-3 text-center">
              <Trophy size={14} className="mx-auto mb-1 text-amber-500" />
              <p className="text-lg font-black text-slate-900 dark:text-white tabular-nums">5</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Prêmios</p>
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={busy !== null}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-50"
          >
            {busy === 'create'
              ? <><Loader2 size={14} className="animate-spin" /> Populando...</>
              : <><Sparkles size={14} /> Adicionar Evento de Demonstração</>
            }
          </button>
        </div>
      )}

      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl border ${
          feedback.startsWith('✓')
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
            : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400'
        }`}>
          {feedback.startsWith('✓') ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          <p className="text-xs font-bold">{feedback}</p>
        </div>
      )}

      <div className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-2xl p-4">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          <strong className="text-slate-700 dark:text-slate-300">Como funciona:</strong> dados fictícios são gerados com nomes brasileiros realistas. 90% das inscrições vêm como APROVADAS, 10% pendentes/canceladas. 90% pagas, 10% pendentes. <strong>O nome do evento começa com [DEMO]</strong> pra você não confundir com eventos reais. Banner amarelo aparece em todas as telas internas quando você está no demo.
        </p>
      </div>
    </div>
  );
};

export default DemoSettingsTab;
