/**
 * Página /deliberacao — Phase 3 do sistema de jurados
 *
 * Pós-bloco/evento, jurado abre essa página no tablet (mesma sessão PIN do
 * /judge-terminal) e vê SÓ as apresentações que ele marcou ⭐. Pra cada
 * marcação, atribui via dropdown qual prêmio ela concorre.
 *
 * Fluxo decidido (research-backed, 2026-05-03):
 * - Tablet-first (mobile graceful)
 * - Atribuição múltipla: uma coreografia pode concorrer a vários prêmios
 *   (ex: "Coreografia X → Melhor Bailarino + Revelação")
 * - Sem campo de texto — áudio do terminal já é a súmula
 * - Submit = snapshot semantics (apaga deliberações antigas, reinsere)
 *   pra ser idempotente e fácil de raciocinar
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Star, Trophy, ChevronLeft, Loader2, Check, AlertCircle,
  Plus, X as XIcon, Send,
} from 'lucide-react';
import { fetchStarred, submitDeliberation, type StarredData, type DeliberationAttribution } from '../services/judgeApi';
import { readJudgeSession } from './JudgeLogin';

type Attribution = { registration_id: string; award_id: string; award_name: string };

const Deliberacao: React.FC = () => {
  const navigate = useNavigate();
  const session = readJudgeSession();

  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [data,       setData]       = useState<StarredData | null>(null);
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);

  /* ── Load ── */
  useEffect(() => {
    if (!session) {
      navigate('/');
      return;
    }
    (async () => {
      try {
        setLoading(true);
        const d = await fetchStarred();
        setData(d);
        // Hidrata atribuições já submetidas
        setAttributions(d.deliberations.map(x => ({
          registration_id: x.registration_id,
          award_id: x.award_id,
          award_name: x.award_name,
        })));
      } catch (e: any) {
        setError(e?.message ?? 'failed_to_load');
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  /* ── Helpers ── */
  const regsById = useMemo(() => {
    const m = new Map<string, any>();
    (data?.registrations ?? []).forEach(r => m.set(r.id, r));
    return m;
  }, [data]);

  const awardsForReg = (registration_id: string) =>
    attributions.filter(a => a.registration_id === registration_id);

  const addAttribution = (registration_id: string, awardId: string) => {
    if (!data) return;
    const award = data.awards.find(a => a.id === awardId);
    if (!award) return;
    // Evita duplicata
    if (attributions.some(a => a.registration_id === registration_id && a.award_id === awardId)) return;
    setAttributions(prev => [...prev, {
      registration_id,
      award_id: awardId,
      award_name: award.name,
    }]);
  };

  const removeAttribution = (registration_id: string, award_id: string) => {
    setAttributions(prev => prev.filter(a =>
      !(a.registration_id === registration_id && a.award_id === award_id)
    ));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload: DeliberationAttribution[] = attributions.map(a => ({
        registration_id: a.registration_id,
        award_id: a.award_id,
        award_name: a.award_name,
      }));
      await submitDeliberation(payload);
      setSubmitted(true);
      // Vai pra conferência depois de 1.5s
      setTimeout(() => navigate('/conferencia'), 1500);
    } catch (e: any) {
      setError(e?.message ?? 'failed_to_submit');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Renders ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <Loader2 size={32} className="text-[#ff0068] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-3">
          <AlertCircle size={32} className="text-rose-500 mx-auto" />
          <p className="text-sm font-bold text-slate-900 dark:text-white">{error}</p>
          <button
            onClick={() => navigate('/judge-terminal')}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-black uppercase tracking-widest"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const marcacoes = data?.marcacoes ?? [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">

      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between gap-3">
        <button
          onClick={() => navigate('/judge-terminal')}
          className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ChevronLeft size={16} />
          <span className="text-[10px] font-black uppercase tracking-widest">Voltar ao terminal</span>
        </button>
        <div className="text-center">
          <h1 className="text-sm sm:text-base font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Deliberação
          </h1>
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
            Atribua prêmios às suas marcações
          </p>
        </div>
        <div className="w-[100px]" /> {/* spacer pra balance */}
      </header>

      {/* Status banner */}
      {data?.event?.deliberation_status && data.event.deliberation_status !== 'DELIBERACAO' && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 flex items-center gap-2 justify-center">
          <AlertCircle size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
            {data.event.deliberation_status === 'COLETANDO' && 'Aguardando produtor encerrar a coleta. Você pode preparar suas atribuições.'}
            {data.event.deliberation_status === 'CONFERENCIA' && 'Deliberação fechada. Conferência em andamento.'}
            {data.event.deliberation_status === 'LIBERADO' && 'Resultados já liberados — atribuições não podem mais ser alteradas.'}
          </p>
        </div>
      )}

      {/* Conteúdo */}
      <main className="max-w-5xl mx-auto p-4 pb-32">

        {marcacoes.length === 0 ? (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-12 text-center mt-8">
            <Star size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-black uppercase tracking-widest text-slate-400">
              Nenhuma marcação
            </p>
            <p className="text-[11px] text-slate-400 mt-2 font-bold">
              Você ainda não marcou nenhuma apresentação como destaque.
            </p>
            <button
              onClick={() => navigate('/judge-terminal')}
              className="mt-5 px-5 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4005a] transition-all"
            >
              Voltar ao terminal
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {marcacoes.length} apresenta{marcacoes.length === 1 ? 'ção marcada' : 'ções marcadas'}
              </span>
              <span className="text-[9px] text-slate-400 font-bold">
                {attributions.length} atribuiç{attributions.length === 1 ? 'ão' : 'ões'}
              </span>
            </div>

            {marcacoes.map(m => {
              const reg = regsById.get(m.registration_id);
              if (!reg) return null;

              const myAttribs = awardsForReg(m.registration_id);
              const availableAwards = (data?.awards ?? []).filter(a =>
                !myAttribs.some(at => at.award_id === a.id)
              );

              return (
                <div
                  key={m.registration_id}
                  className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4"
                >
                  {/* Header do card */}
                  <div className="flex items-start gap-2 mb-3">
                    <Star size={16} className="text-amber-500 fill-amber-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                        {reg.nome_coreografia}
                      </h3>
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        {reg.estudio} · {reg.estilo_danca} · {reg.categoria}
                      </p>
                    </div>
                  </div>

                  {/* Prêmios atribuídos */}
                  {myAttribs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3 pl-6">
                      {myAttribs.map(a => (
                        <button
                          key={a.award_id}
                          onClick={() => removeAttribution(m.registration_id, a.award_id)}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-violet-100 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/30 rounded-full text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-500/25 transition-all"
                          title="Remover esta atribuição"
                        >
                          <Trophy size={10} />
                          <span className="text-[10px] font-black uppercase tracking-widest">{a.award_name}</span>
                          <XIcon size={10} className="opacity-60" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Dropdown pra adicionar prêmio */}
                  {availableAwards.length > 0 && (
                    <div className="pl-6">
                      <select
                        value=""
                        onChange={e => {
                          if (e.target.value) {
                            addAttribution(m.registration_id, e.target.value);
                            e.target.value = '';
                          }
                        }}
                        className="w-full sm:w-auto bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-[#ff0068]/50"
                      >
                        <option value="">+ Atribuir prêmio…</option>
                        {availableAwards.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {availableAwards.length === 0 && myAttribs.length > 0 && (
                    <p className="pl-6 text-[10px] font-bold text-slate-400 italic">
                      Todos os prêmios disponíveis já foram atribuídos a esta apresentação.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer fixo: submit */}
      {marcacoes.length > 0 && (
        <footer className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 px-4 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              {submitted
                ? <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><Check size={12} /> Enviado!</span>
                : `${attributions.length} atribuiç${attributions.length === 1 ? 'ão' : 'ões'} pra enviar`
              }
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitting || submitted}
              className="px-5 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4005a] transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {submitted ? 'Enviado' : 'Enviar deliberação'}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};

export default Deliberacao;
