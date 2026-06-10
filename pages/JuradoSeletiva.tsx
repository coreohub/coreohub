/**
 * JuradoSeletiva — fila de seletiva de vídeo do jurado (multi-jurado v1.1).
 *
 * Modo BLIND: esconde estúdio/coreógrafo/inscrito. Mostra só nº de ordem +
 * dados técnicos (estilo/categoria/formação) + player do vídeo. Anti-viés
 * (padrão Joinville/CompetitionSuite).
 *
 * Acesso: jurado logado via PIN (sessão coreohub_judge_session). Rota standalone
 * (JudgeStandaloneRoute no App.tsx, sem layout do produtor).
 *
 * Fluxo:
 *   /judge-login/:token → PIN → /jurado-seletiva
 *   lista vídeos `submitted` ainda não votados por este jurado
 *   vota Aprovar/Reprovar/Condicional + feedback? + score? (0-10) → sai da fila
 *   trigger SQL fn_aggregate_video_evaluations recomputa o status agregado.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Video, Loader2, CheckCircle2, XCircle, AlertTriangle, ArrowLeft, ArrowRight,
  Film, Star, MessageSquare, ShieldCheck, PartyPopper,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { readJudgeSession } from './JudgeLogin';
import {
  fetchVideoQueue, submitVideoEvaluation,
  type VideoQueueItem, type VideoDecision,
} from '../services/judgeApi';

// Converte URL de YouTube/Vimeo pra embed. Fallback: retorna a própria URL.
const toEmbedUrl = (url: string): string => {
  try {
    const u = new URL(url);
    // YouTube
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (u.hostname.includes('youtu.be')) {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
    // Vimeo
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
    return url;
  } catch {
    return url;
  }
};

const DECISIONS: { value: VideoDecision; label: string; icon: any; cls: string; activeCls: string }[] = [
  { value: 'approve',     label: 'Aprovar',     icon: CheckCircle2,  cls: 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10', activeCls: 'bg-emerald-500 text-white border-emerald-500' },
  { value: 'reject',      label: 'Reprovar',    icon: XCircle,       cls: 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10',          activeCls: 'bg-rose-500 text-white border-rose-500' },
  { value: 'conditional', label: 'Condicional', icon: AlertTriangle, cls: 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10',       activeCls: 'bg-amber-500 text-white border-amber-500' },
];

const JuradoSeletiva: React.FC = () => {
  const navigate = useNavigate();
  const session = readJudgeSession();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<VideoQueueItem[]>([]);
  const [totalVoted, setTotalVoted] = useState(0);
  const [evaluatorsCount, setEvaluatorsCount] = useState(1);
  const [rule, setRule] = useState<'majority' | 'unanimous'>('majority');
  const [eventName, setEventName] = useState<string>('');

  const [cursor, setCursor] = useState(0);
  const [decision, setDecision] = useState<VideoDecision | null>(null);
  const [feedback, setFeedback] = useState('');
  const [score, setScore] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchVideoQueue();
      setQueue(data.queue);
      setTotalVoted(data.total_voted);
      setEvaluatorsCount(data.evaluators_count);
      setRule(data.rule);
      setEventName(data.event?.name ?? '');
      setCursor(0);
    } catch (e: any) {
      const msg = e?.message ?? 'failed_to_load';
      if (msg === 'not_allowed_to_evaluate_video') {
        setError('Você não está habilitado a avaliar vídeos neste evento.');
      } else if (msg === 'judge_session_required') {
        setError('Sessão expirada. Faça login novamente.');
      } else {
        setError('Não foi possível carregar a fila de seletiva.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session) { navigate('/', { replace: true }); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = queue[cursor] ?? null;
  const total = queue.length + totalVoted;
  const blindLabel = useMemo(() => {
    if (!current) return '';
    return [current.estilo, current.categoria, current.formacao].filter(Boolean).join(' · ');
  }, [current]);

  const resetForm = () => { setDecision(null); setFeedback(''); setScore(''); };

  const handleSubmit = async () => {
    if (!current || !decision || submitting) return;
    // Score opcional: valida só se preenchido.
    let scoreNum: number | null = null;
    if (score.trim() !== '') {
      const n = Number(score.replace(',', '.'));
      if (Number.isNaN(n) || n < 0 || n > 10) {
        setError('Nota deve ser entre 0 e 10 (ou deixe vazio).');
        return;
      }
      scoreNum = n;
    }
    setSubmitting(true);
    setError(null);
    try {
      const votedIdx = cursor;
      await submitVideoEvaluation(current.id, decision, {
        feedback: feedback.trim() || undefined,
        score: scoreNum,
      });
      // Remove o item votado: o próximo "desliza" pra mesma posição `cursor`.
      // Novo length = queue.length - 1, então o último índice válido é
      // queue.length - 2. Clampa o cursor pra não estourar quando o último
      // item da fila foi votado.
      setQueue(prev => prev.filter((_, i) => i !== votedIdx));
      setCursor(c => Math.max(0, Math.min(c, queue.length - 2)));
      setTotalVoted(v => v + 1);
      resetForm();
    } catch (e: any) {
      setError('Não foi possível salvar seu voto. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const exitToTerminal = () => navigate('/judge-terminal', { replace: true });

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={exitToTerminal}
            className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#ff0068] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] rounded-lg px-1"
          >
            <ArrowLeft size={12} /> Terminal
          </button>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#ff0068]/10 border border-[#ff0068]/20">
            <Video size={12} className="text-[#ff0068]" />
            <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.2em]">Seletiva de Vídeo</span>
          </div>
        </div>

        <div className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Avaliação às <span className="text-[#ff0068]">cegas</span>
          </h1>
          {eventName && (
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{eventName}</p>
          )}
          {/* Progresso */}
          <div className="flex items-center justify-center gap-2 pt-1">
            <div className="h-1.5 w-40 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full bg-[#ff0068] transition-all"
                style={{ width: total > 0 ? `${(totalVoted / total) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-[10px] font-black tabular-nums text-slate-500">{totalVoted}/{total}</span>
          </div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 pt-0.5">
            Banca de {evaluatorsCount} · regra {rule === 'unanimous' ? 'unânime' : 'maioria'}
          </p>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500">
            <AlertTriangle size={14} className="shrink-0" />
            <p className="text-xs font-bold">{error}</p>
          </div>
        )}

        {/* Fila vazia → tudo avaliado */}
        {!current && !error && (
          <div className="text-center py-16 space-y-4">
            <div className="inline-flex p-5 rounded-3xl bg-emerald-500/10 border border-emerald-500/20">
              <PartyPopper size={32} className="text-emerald-500" />
            </div>
            <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
              {totalVoted > 0 ? 'Tudo avaliado!' : 'Nada na fila'}
            </h2>
            <p className="text-xs text-slate-500 font-bold max-w-xs mx-auto leading-relaxed">
              {totalVoted > 0
                ? `Você avaliou ${totalVoted} vídeo${totalVoted === 1 ? '' : 's'}. Obrigado! O resultado é agregado quando todos os jurados votam.`
                : 'Nenhum vídeo aguardando avaliação neste evento por enquanto.'}
            </p>
            <button
              onClick={exitToTerminal}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068]/90 transition-all shadow-lg shadow-[#ff0068]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-950"
            >
              Voltar ao terminal <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* Card de avaliação */}
        {current && (
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden shadow-sm"
            >
              {/* Player */}
              <div className="relative aspect-video bg-black">
                <iframe
                  key={current.id}
                  src={toEmbedUrl(current.video_url)}
                  title={`Vídeo ${current.numero}`}
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  // URL é controlada pelo inscrito — sandbox limita o que o conteúdo
                  // embutido pode fazer (scripts do player sim, top-navigation não).
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>

              <div className="p-5 space-y-4">
                {/* Identificação blind */}
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-2xl bg-[#ff0068]/10 text-[#ff0068] font-black text-sm tabular-nums">
                      {current.numero}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Vídeo (anônimo)</p>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{blindLabel || '—'}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <ShieldCheck size={11} className="text-emerald-500" /> Blind
                  </span>
                </div>

                {/* Decisão */}
                <div className="grid grid-cols-3 gap-2">
                  {DECISIONS.map(d => {
                    const Icon = d.icon;
                    const active = decision === d.value;
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setDecision(d.value)}
                        aria-pressed={active}
                        className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border font-black text-[10px] uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 ${active ? d.activeCls : `bg-transparent ${d.cls}`}`}
                      >
                        <Icon size={18} /> {d.label}
                      </button>
                    );
                  })}
                </div>

                {/* Feedback opcional */}
                <div>
                  <label htmlFor="vid-feedback" className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                    <MessageSquare size={11} /> Feedback (opcional)
                  </label>
                  <textarea
                    id="vid-feedback"
                    value={feedback}
                    onChange={e => setFeedback(e.target.value)}
                    rows={2}
                    spellCheck
                    lang="pt-BR"
                    autoCapitalize="sentences"
                    autoCorrect="on"
                    placeholder="Observações pro inscrito (opcional)…"
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50 resize-none"
                  />
                </div>

                {/* Score opcional */}
                <div className="flex items-center gap-3">
                  <label htmlFor="vid-score" className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <Star size={11} /> Nota (opcional)
                  </label>
                  <input
                    id="vid-score"
                    value={score}
                    onChange={e => setScore(e.target.value)}
                    inputMode="decimal"
                    placeholder="0–10"
                    className="w-24 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50 font-mono text-center"
                  />
                </div>

                {/* Submit */}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!decision || submitting}
                  className="w-full py-3.5 bg-[#ff0068] hover:bg-[#ff0068]/90 disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#ff0068]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
                  {submitting ? 'Salvando…' : 'Confirmar voto e próximo'}
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default JuradoSeletiva;
