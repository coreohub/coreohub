/**
 * Página /conferencia — Phase 3 do sistema de jurados
 *
 * Pós-deliberação individual, jurado vê na própria tela:
 * - Suas atribuições (read-only)
 * - Pra cada uma, agregado ANÔNIMO de quantos outros jurados também
 *   atribuíram o mesmo prêmio à mesma coreografia (sem nomes, padrão ISU)
 * - Timer regressivo da janela de conferência (5-10min, configurável)
 *
 * Decisões UX (research-backed, 2026-05-03):
 * - Anônimo: só "5 de 7 jurados" — preserva independência (Eurovision, ISU)
 * - Jurado pode VOLTAR pra /deliberacao e revisar enquanto status=CONFERENCIA
 * - Sem chat / sem debate online — janela de tempo curta força decisão
 * - Coordenador do Júri vê painel completo (com nomes) em outra tela
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, ChevronLeft, Loader2, AlertCircle, Users, Clock,
  Edit3,
} from 'lucide-react';
import { fetchConferencia, type ConferenciaData } from '../services/judgeApi';
import { readJudgeSession } from './JudgeLogin';

const Conferencia: React.FC = () => {
  const navigate = useNavigate();
  const session = readJudgeSession();

  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [data,       setData]       = useState<ConferenciaData | null>(null);
  const [now,        setNow]        = useState(() => Date.now());

  /* ── Load + tick ── */
  useEffect(() => {
    if (!session) { navigate('/'); return; }
    let alive = true;
    (async () => {
      try {
        const d = await fetchConferencia();
        if (alive) setData(d);
      } catch (e: any) {
        if (alive) setError(e?.message ?? 'failed_to_load');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    // Refresh a cada 15s pra capturar novas deliberações de outros jurados
    const refreshInterval = setInterval(async () => {
      try {
        const d = await fetchConferencia();
        if (alive) setData(d);
      } catch { /* silencioso */ }
    }, 15_000);

    // Tick do relógio do timer (1s)
    const tickInterval = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      alive = false;
      clearInterval(refreshInterval);
      clearInterval(tickInterval);
    };
  }, [navigate]);

  /* ── Timer da janela de conferência ── */
  const timerInfo = useMemo(() => {
    if (!data?.event?.conferencia_started_at || !data?.event?.conferencia_duration_seconds) {
      return null;
    }
    const startMs = new Date(data.event.conferencia_started_at).getTime();
    const totalMs = data.event.conferencia_duration_seconds * 1000;
    const endMs   = startMs + totalMs;
    const remainingMs = Math.max(0, endMs - now);
    const minutes = Math.floor(remainingMs / 60_000);
    const seconds = Math.floor((remainingMs % 60_000) / 1000);
    return {
      remainingMs,
      label: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
      expired: remainingMs === 0,
    };
  }, [data, now]);

  /* ── Indexes ── */
  const regsById = useMemo(() => {
    const m = new Map<string, any>();
    (data?.registrations ?? []).forEach(r => m.set(r.id, r));
    return m;
  }, [data]);

  // Pra cada (registration_id, award_id), quantos jurados (incluindo eu) atribuíram
  const aggregateMap = useMemo(() => {
    const m = new Map<string, number>();
    (data?.aggregate ?? []).forEach(a => {
      m.set(`${a.registration_id}:${a.award_id}`, a.judge_count);
    });
    return m;
  }, [data]);

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

  const mine = data?.mine ?? [];
  const status = data?.event?.deliberation_status;

  // Agrupa atribuições por registration pra renderizar cards
  const grouped = mine.reduce<Map<string, typeof mine>>((acc, a) => {
    const arr = acc.get(a.registration_id) ?? [];
    arr.push(a);
    acc.set(a.registration_id, arr);
    return acc;
  }, new Map());

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">

      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between gap-3">
        <button
          onClick={() => navigate('/judge-terminal')}
          className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ChevronLeft size={16} />
          <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Terminal</span>
        </button>
        <div className="text-center">
          <h1 className="text-sm sm:text-base font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Conferência
          </h1>
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
            Agregado anônimo do júri
          </p>
        </div>

        {/* Timer */}
        {timerInfo && !timerInfo.expired && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-full">
            <Clock size={12} className="text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-black tabular-nums text-amber-700 dark:text-amber-400">
              {timerInfo.label}
            </span>
          </div>
        )}
        {timerInfo?.expired && (
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Encerrado</span>
        )}
        {!timerInfo && <div className="w-[80px]" />}
      </header>

      {/* Status banner */}
      {status && status !== 'CONFERENCIA' && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 flex items-center gap-2 justify-center">
          <AlertCircle size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
            {status === 'COLETANDO' && 'Coleta em andamento — aguarde o produtor encerrar.'}
            {status === 'DELIBERACAO' && 'Deliberação ainda aberta — esta tela mostra o que já foi consolidado.'}
            {status === 'LIBERADO' && 'Resultados liberados pelo Coordenador do Júri.'}
          </p>
        </div>
      )}

      {/* Conteúdo */}
      <main className="max-w-5xl mx-auto p-4 pb-24">
        {mine.length === 0 ? (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-12 text-center mt-8">
            <Trophy size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-black uppercase tracking-widest text-slate-400">
              Nenhuma atribuição
            </p>
            <p className="text-[11px] text-slate-400 mt-2 font-bold">
              Você ainda não enviou suas deliberações.
            </p>
            <button
              onClick={() => navigate('/deliberacao')}
              className="mt-5 px-5 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4005a] transition-all"
            >
              Ir para deliberação
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Aviso de anonimato */}
            <div className="flex items-start gap-2 px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
              <Users size={14} className="text-slate-400 shrink-0 mt-0.5" />
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 leading-snug">
                Os números mostram quantos jurados (incluindo você) atribuíram cada prêmio à apresentação.
                <span className="text-slate-400"> Identidades são anônimas pra preservar independência do júri.</span>
              </p>
            </div>

            {Array.from(grouped.entries()).map(([regId, atribs]) => {
              const reg = regsById.get(regId);
              if (!reg) return null;

              return (
                <div
                  key={regId}
                  className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4"
                >
                  <div className="mb-3">
                    <h3 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                      {reg.nome_coreografia}
                    </h3>
                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      {reg.estudio} · {reg.estilo_danca} · {reg.categoria}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {atribs.map(a => {
                      const count = aggregateMap.get(`${regId}:${a.award_id}`) ?? 1;
                      // Heurística visual: 1 = só você, 2-3 = consenso baixo, 4+ = forte
                      const intensityClass =
                        count >= 4
                          ? 'bg-emerald-100 dark:bg-emerald-500/20 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                          : count >= 2
                            ? 'bg-violet-100 dark:bg-violet-500/15 border-violet-200 dark:border-violet-500/30 text-violet-700 dark:text-violet-300'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300';

                      return (
                        <div
                          key={a.award_id}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${intensityClass}`}
                        >
                          <Trophy size={11} />
                          <span className="text-[10px] font-black uppercase tracking-widest">
                            {a.award_name}
                          </span>
                          <span className="px-1.5 py-0.5 bg-white/40 dark:bg-black/20 rounded-full text-[9px] font-black tabular-nums">
                            {count} jurad{count === 1 ? 'o' : 'os'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Voltar pra ajustar */}
        {status === 'CONFERENCIA' && timerInfo && !timerInfo.expired && (
          <div className="mt-6 text-center">
            <button
              onClick={() => navigate('/deliberacao')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-300 dark:hover:bg-slate-700 transition-all"
            >
              <Edit3 size={12} />
              Voltar e revisar deliberação
            </button>
            <p className="mt-2 text-[9px] text-slate-400 font-bold">
              Você pode ajustar enquanto a janela estiver aberta
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Conferencia;
