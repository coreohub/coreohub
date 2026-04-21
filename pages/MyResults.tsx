import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { UserRole } from '../types';
import { Trophy, Star, Music, Loader2, Volume2, Award, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface MyResultsProps {
  activeRole: UserRole;
}

interface MyRegistration {
  id: string;
  nome_coreografia: string;
  estudio: string;
  estilo_danca: string;
  categoria: string;
  status: string;
  media_final?: number;
  classificacao_final?: number;
  resultado_publicado?: boolean;
  evaluations: {
    judge_name: string;
    scores: Record<string, number>;
    final: number;
    audio_url?: string;
  }[];
}

const ScoreBadge = ({ score }: { score: number }) => {
  const color = score >= 9
    ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30'
    : score >= 7
      ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-300 dark:border-yellow-500/30'
      : 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-500/30';

  return (
    <span className={`px-3 py-1 rounded-xl border font-black text-lg italic ${color}`}>
      {score.toFixed(2)}
    </span>
  );
};

const MyResults: React.FC<MyResultsProps> = ({ activeRole }) => {
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

  useEffect(() => {
    const fetchMyResults = async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Busca inscrições do usuário logado
        const { data: regs, error: regError } = await supabase
          .from('registrations')
          .select('*')
          .eq('user_id', user.id)
          .order('criado_em', { ascending: false });

        if (regError) throw regError;

        if (!regs || regs.length === 0) {
          setRegistrations([]);
          return;
        }

        // Para cada inscrição, busca avaliações
        const withEvals: MyRegistration[] = await Promise.all(
          regs.map(async (reg) => {
            const { data: evals } = await supabase
              .from('evaluations')
              .select('*, judges(name)')
              .eq('registration_id', reg.id);

            const evaluations = (evals || []).map((e: any) => ({
              judge_name: e.judges?.name || 'Jurado',
              scores: e.scores || {},
              final: Number(e.final_weighted_average) || 0,
              audio_url: e.audio_url,
            }));

            return {
              id: reg.id,
              nome_coreografia: reg.nome_coreografia || '—',
              estudio: reg.estudio || '—',
              estilo_danca: reg.estilo_danca || '—',
              categoria: reg.categoria || '—',
              status: reg.status || '—',
              media_final: reg.media_final,
              classificacao_final: reg.classificacao_final,
              resultado_publicado: reg.resultado_publicado,
              evaluations,
            };
          })
        );

        setRegistrations(withEvals);
      } catch (err) {
        console.error('MyResults error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMyResults();
  }, []);

  const playAudio = (url: string) => {
    if (playingAudio === url) {
      setPlayingAudio(null);
      return;
    }
    setPlayingAudio(url);
    const audio = new Audio(url);
    audio.play();
    audio.onended = () => setPlayingAudio(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="text-[#ff0068] animate-spin" />
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Buscando seus resultados...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      <div>
        <h1 className="text-3xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
          Meus <span className="text-[#ff0068]">Resultados</span>
        </h1>
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
          Avaliações e notas das suas inscrições
        </p>
      </div>

      {registrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
          <Music size={64} className="text-slate-300 dark:text-slate-700" />
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">Nenhuma inscrição encontrada</h2>
            <p className="text-slate-500 text-sm mt-2">Suas inscrições em festivais aparecerão aqui.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {registrations.map((reg, idx) => {
            const overallAvg = reg.evaluations.length > 0
              ? reg.evaluations.reduce((a, b) => a + b.final, 0) / reg.evaluations.length
              : null;
            const isPublished = reg.resultado_publicado;
            const isExpanded = expandedId === reg.id;

            return (
              <motion.div
                key={reg.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.06 }}
                className={`bg-white dark:bg-white/5 border rounded-3xl overflow-hidden transition-all shadow-sm ${
                  isExpanded
                    ? 'border-[#ff0068]/40'
                    : 'border-slate-200 dark:border-white/10'
                }`}
              >
                {/* Card header */}
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : reg.id)}
                >
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isPublished ? 'bg-[#ff0068]/10 dark:bg-[#ff0068]/20 text-[#ff0068]' : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600'}`}>
                    {isPublished ? <Trophy size={24} /> : <Music size={24} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{reg.nome_coreografia}</p>
                    <p className="text-[9px] font-bold text-slate-500 uppercase">{reg.estudio} • {reg.categoria} • {reg.estilo_danca}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {isPublished && overallAvg != null ? (
                      <div className="text-right">
                        <ScoreBadge score={overallAvg} />
                        {reg.classificacao_final && (
                          <p className="text-[9px] font-black text-slate-500 uppercase mt-1">
                            {reg.classificacao_final}° lugar
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">
                        {reg.evaluations.length > 0 ? 'Aguardando publicação' : 'Sem avaliação'}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </div>

                {/* Expanded evaluations */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-slate-200 dark:border-white/10"
                    >
                      <div className="p-6 space-y-4">
                        {reg.evaluations.length === 0 ? (
                          <p className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest text-center py-4">
                            Nenhuma avaliação registrada ainda
                          </p>
                        ) : (
                          reg.evaluations.map((ev, i) => (
                            <div key={i} className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/5 rounded-2xl p-4 space-y-3">
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <Award size={14} className="text-[#ff0068]" />
                                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">{ev.judge_name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  {ev.audio_url && (
                                    <button
                                      onClick={() => playAudio(ev.audio_url!)}
                                      className={`p-2 rounded-xl transition-all ${playingAudio === ev.audio_url ? 'bg-[#ff0068] text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-[#ff0068]'}`}
                                    >
                                      <Volume2 size={14} />
                                    </button>
                                  )}
                                  {isPublished && <ScoreBadge score={ev.final} />}
                                </div>
                              </div>

                              {isPublished && Object.keys(ev.scores).length > 0 && (
                                <div className="grid grid-cols-2 gap-2">
                                  {Object.entries(ev.scores).map(([criterion, val]) => (
                                    <div key={criterion} className="flex justify-between items-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2">
                                      <span className="text-[8px] font-black uppercase text-slate-400 tracking-widest">{criterion}</span>
                                      <span className="text-sm font-black text-slate-900 dark:text-white">{Number(val).toFixed(1)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyResults;
