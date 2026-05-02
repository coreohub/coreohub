import React, { useState, useEffect, useMemo } from 'react';
import {
  Video, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Clock, Film, Search, X, MessageSquare, ExternalLink,
  Settings2, ToggleLeft, ToggleRight, Calendar, DollarSign,
  Save, Info, Filter, Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';
import { reviewVideoSubmission } from '../services/supabase';

type VideoStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'conditional';

interface RegWithVideo {
  id: string;
  nome_coreografia: string;
  estudio?: string;
  categoria?: string;
  formato_participacao?: string;
  video_url?: string | null;
  video_status: VideoStatus;
  video_feedback?: string | null;
  video_submitted_at?: string | null;
  video_fee_status?: string;
  profiles?: { full_name: string };
}

interface EventVideoConfig {
  video_selection_enabled: boolean;
  video_submission_deadline: string;
  video_selection_fee: number;
  video_selection_fee_required: boolean;
  video_fee_refund_policy: 'no_refund' | 'full_refund' | 'partial_refund';
}

const STATUS_FILTER_OPTIONS: { value: VideoStatus | 'ALL'; label: string; color: string }[] = [
  { value: 'ALL',         label: 'Todos',           color: 'text-slate-500' },
  { value: 'pending',     label: 'Aguardando',       color: 'text-amber-500' },
  { value: 'submitted',   label: 'Enviados',         color: 'text-blue-500'  },
  { value: 'approved',    label: 'Aprovados',        color: 'text-emerald-500' },
  { value: 'rejected',    label: 'Reprovados',       color: 'text-rose-500'  },
  { value: 'conditional', label: 'Condicionais',     color: 'text-purple-500'},
];

const statusChip = (status: VideoStatus) => {
  const map = {
    pending:     { label: 'Aguardando',  bg: 'bg-amber-500/10 text-amber-500 border-amber-500/20',     icon: Clock         },
    submitted:   { label: 'Em Análise',  bg: 'bg-blue-500/10 text-blue-500 border-blue-500/20',        icon: Film          },
    approved:    { label: 'Aprovado',    bg: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', icon: CheckCircle2 },
    rejected:    { label: 'Reprovado',   bg: 'bg-rose-500/10 text-rose-500 border-rose-500/20',         icon: XCircle       },
    conditional: { label: 'Condicional', bg: 'bg-purple-500/10 text-purple-500 border-purple-500/20',  icon: AlertTriangle },
  };
  const s = map[status];
  const Icon = s.icon;
  return (
    <span className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border flex items-center gap-1 ${s.bg}`}>
      <Icon size={9} /> {s.label}
    </span>
  );
};

const VideoSelection: React.FC = () => {
  const [registrations, setRegistrations] = useState<RegWithVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<VideoStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [reviewing, setReviewing] = useState<RegWithVideo | null>(null);
  const [feedback, setFeedback] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Config state
  const [config, setConfig] = useState<EventVideoConfig>({
    video_selection_enabled: false,
    video_submission_deadline: '',
    video_selection_fee: 0,
    video_selection_fee_required: false,
    video_fee_refund_policy: 'no_refund',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [{ data: regs, error }, { data: evt }] = await Promise.all([
        supabase
          .from('registrations')
          .select('id, nome_coreografia, estudio, categoria, formato_participacao, video_url, video_status, video_feedback, video_submitted_at, video_fee_status, profiles(full_name)')
          .order('video_submitted_at', { ascending: false, nullsFirst: false }),
        supabase
          .from('configuracoes')
          .select('video_selection_enabled, video_submission_deadline, video_selection_fee, video_selection_fee_required, video_fee_refund_policy')
          .eq('id', 1)
          .single(),
      ]);

      if (error) throw error;
      setRegistrations((regs || []).map((r: any) => ({
        ...r,
        video_status: r.video_status ?? 'pending',
      })));

      if (evt) {
        setConfig({
          video_selection_enabled: evt.video_selection_enabled ?? false,
          video_submission_deadline: evt.video_submission_deadline ?? '',
          video_selection_fee: evt.video_selection_fee ?? 0,
          video_selection_fee_required: evt.video_selection_fee_required ?? false,
          video_fee_refund_policy: evt.video_fee_refund_policy ?? 'no_refund',
        });
      }
    } catch (err) {
      console.error('Erro ao carregar seletivas:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    let list = registrations;
    if (statusFilter !== 'ALL') list = list.filter(r => r.video_status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.nome_coreografia?.toLowerCase().includes(q) ||
        r.estudio?.toLowerCase().includes(q) ||
        r.profiles?.full_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [registrations, statusFilter, search]);

  const stats = useMemo(() => ({
    total:       registrations.length,
    pending:     registrations.filter(r => r.video_status === 'pending').length,
    submitted:   registrations.filter(r => r.video_status === 'submitted').length,
    approved:    registrations.filter(r => r.video_status === 'approved').length,
    rejected:    registrations.filter(r => r.video_status === 'rejected').length,
    conditional: registrations.filter(r => r.video_status === 'conditional').length,
  }), [registrations]);

  const handleReview = async (decision: Extract<VideoStatus, 'approved' | 'rejected' | 'conditional'>) => {
    if (!reviewing) return;
    setSavingReview(true);
    try {
      await reviewVideoSubmission(reviewing.id, decision, feedback || undefined);
      setRegistrations(prev =>
        prev.map(r => r.id === reviewing.id ? { ...r, video_status: decision, video_feedback: feedback || null } : r)
      );
      setReviewing(null);
      setFeedback('');
    } catch (err) {
      console.error(err);
    } finally {
      setSavingReview(false);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const { error } = await supabase
        .from('configuracoes')
        .update({
          video_selection_enabled: config.video_selection_enabled,
          video_submission_deadline: config.video_submission_deadline || null,
          video_selection_fee: config.video_selection_fee,
          video_selection_fee_required: config.video_selection_fee_required,
          video_fee_refund_policy: config.video_fee_refund_policy,
        })
        .eq('id', 1);
      if (error) throw error;
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2500);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingConfig(false);
    }
  };

  const embedUrl = (url: string) => {
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    return null;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20">
      {/* Header */}
      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
            Seletiva de <span className="text-[#ff0068]">Vídeo</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Gestão e revisão dos vídeos enviados
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConfig(p => !p)}
            className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-[10px] font-black uppercase tracking-widest transition-all ${showConfig ? 'bg-[#ff0068] text-white border-[#ff0068]' : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:text-[#ff0068]'}`}
          >
            <Settings2 size={16} /> Configurações
          </button>
          <button onClick={fetchData} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all">
            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Config Panel */}
      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-[2.5rem] overflow-hidden shadow-sm"
          >
            <div className="p-6 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#ff0068]/10 rounded-xl flex items-center justify-center text-[#ff0068]">
                  <Settings2 size={18} />
                </div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tighter">Configurações da Seletiva</h3>
              </div>
              <button onClick={() => setShowConfig(false)} className="p-2 text-slate-400 hover:text-rose-500 transition-all">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Toggle ativo */}
              <div className="col-span-full flex items-center justify-between p-4 bg-slate-50 dark:bg-white/5 rounded-2xl">
                <div>
                  <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight">Seletiva Ativa</p>
                  <p className="text-[9px] text-slate-400 mt-0.5">Quando ativo, os inscritos verão a área de envio de vídeo.</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, video_selection_enabled: !p.video_selection_enabled }))}>
                  {config.video_selection_enabled
                    ? <ToggleRight size={36} className="text-[#ff0068]" />
                    : <ToggleLeft size={36} className="text-slate-400" />
                  }
                </button>
              </div>

              {/* Deadline */}
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Calendar size={11} /> Data Limite Envio</label>
                <input
                  type="datetime-local"
                  value={config.video_submission_deadline}
                  onChange={e => setConfig(p => ({ ...p, video_submission_deadline: e.target.value }))}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068] transition-all"
                />
              </div>

              {/* Taxa */}
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><DollarSign size={11} /> Taxa de Seletiva (R$)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00 = Gratuita"
                  value={config.video_selection_fee || ''}
                  onChange={e => setConfig(p => ({ ...p, video_selection_fee: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068] transition-all"
                />
              </div>

              {/* Política de reembolso */}
              {config.video_selection_fee > 0 && (
                <div className="space-y-2 col-span-full">
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Política de Reembolso em caso de Reprovação</label>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { v: 'no_refund',      l: 'Sem Reembolso' },
                      { v: 'partial_refund', l: 'Parcial'        },
                      { v: 'full_refund',    l: 'Reembolso Total'},
                    ] as const).map(opt => (
                      <button
                        key={opt.v}
                        onClick={() => setConfig(p => ({ ...p, video_fee_refund_policy: opt.v }))}
                        className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${config.video_fee_refund_policy === opt.v ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/20' : 'bg-slate-100 dark:bg-white/5 text-slate-500 border border-slate-200 dark:border-white/10'}`}
                      >
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 flex justify-end">
              <button
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="flex items-center gap-2 px-6 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-60"
              >
                {savingConfig ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {configSaved ? 'Salvo!' : 'Salvar Configurações'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total',       value: stats.total,       color: 'text-slate-900 dark:text-white' },
          { label: 'Aguardando',  value: stats.pending,     color: 'text-amber-500'  },
          { label: 'Enviados',    value: stats.submitted,   color: 'text-blue-500'   },
          { label: 'Aprovados',   value: stats.approved,    color: 'text-emerald-500'},
          { label: 'Reprovados',  value: stats.rejected,    color: 'text-rose-500'   },
          { label: 'Condicionais',value: stats.conditional, color: 'text-purple-500' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-center">
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Buscar coreografia, estúdio ou responsável..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068] transition-all"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`flex items-center gap-1.5 px-4 py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all border ${statusFilter === opt.value ? 'bg-[#ff0068] text-white border-[#ff0068] shadow-lg shadow-[#ff0068]/20' : `bg-white dark:bg-slate-900/50 border-slate-200 dark:border-white/10 ${opt.color}`}`}
            >
              <Filter size={10} /> {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-24 flex justify-center">
          <RefreshCw className="animate-spin text-[#ff0068]" size={32} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-4 bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-[3rem]">
          <div className="w-16 h-16 bg-slate-200 dark:bg-white/5 rounded-[2rem] flex items-center justify-center text-slate-400">
            <Video size={28} />
          </div>
          <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
            {registrations.length === 0 ? 'Nenhum vídeo enviado ainda' : 'Nenhum resultado para o filtro'}
          </p>
        </div>
      ) : (
        <>
        {/* Mobile: cards empilhados (< sm). Botão grande pra revisar. */}
        <div className="sm:hidden space-y-3">
          {filtered.map(reg => (
            <div key={reg.id} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-900 dark:text-white uppercase tracking-tight text-sm truncate">
                    {reg.nome_coreografia}
                  </p>
                  <p className="text-[9px] text-[#ff0068] font-bold uppercase tracking-widest mt-0.5">
                    {reg.formato_participacao} {reg.categoria ? `· ${reg.categoria}` : ''}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                    {reg.profiles?.full_name ?? reg.estudio ?? '—'}
                  </p>
                </div>
                <div className="shrink-0">{statusChip(reg.video_status)}</div>
              </div>
              {reg.video_status === 'submitted' ? (
                <button
                  onClick={() => { setReviewing(reg); setFeedback(reg.video_feedback ?? ''); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 active:scale-95 transition-all"
                >
                  <Video size={14} /> Revisar Vídeo
                </button>
              ) : (
                <button
                  onClick={() => { setReviewing(reg); setFeedback(reg.video_feedback ?? ''); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                  <MessageSquare size={14} /> Rever decisão
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Desktop: tabela (sm+). */}
        <div className="hidden sm:block bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-hidden shadow-sm dark:shadow-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
                <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Coreografia</th>
                <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">Responsável</th>
                <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest hidden sm:table-cell">Categoria</th>
                <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {filtered.map(reg => (
                <tr key={reg.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                  <td className="px-6 py-4">
                    <p className="font-black text-slate-900 dark:text-white uppercase tracking-tight text-sm">{reg.nome_coreografia}</p>
                    <p className="text-[9px] text-[#ff0068] font-bold uppercase tracking-widest">{reg.formato_participacao}</p>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{reg.profiles?.full_name ?? reg.estudio ?? '—'}</p>
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{reg.categoria ?? '—'}</p>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex justify-center">{statusChip(reg.video_status)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      {reg.video_url && (
                        <a
                          href={reg.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500 hover:text-white transition-all"
                          title="Ver vídeo"
                        >
                          <ExternalLink size={15} />
                        </a>
                      )}
                      {reg.video_status === 'submitted' && (
                        <button
                          onClick={() => { setReviewing(reg); setFeedback(reg.video_feedback ?? ''); }}
                          className="px-4 py-2 bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-[#ff0068] hover:text-white transition-all"
                        >
                          Revisar
                        </button>
                      )}
                      {(reg.video_status === 'approved' || reg.video_status === 'rejected' || reg.video_status === 'conditional') && (
                        <button
                          onClick={() => { setReviewing(reg); setFeedback(reg.video_feedback ?? ''); }}
                          className="p-2 bg-slate-100 dark:bg-white/5 text-slate-400 rounded-xl hover:text-[#ff0068] transition-all"
                          title="Rever decisão"
                        >
                          <MessageSquare size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Review Modal */}
      <AnimatePresence>
        {reviewing && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setReviewing(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl max-h-[90vh] flex flex-col"
            >
              {/* Modal header */}
              <div className="p-6 border-b border-slate-100 dark:border-white/5 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
                    Revisar <span className="text-[#ff0068]">Vídeo</span>
                  </h2>
                  <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">{reviewing.nome_coreografia}</p>
                </div>
                <button onClick={() => setReviewing(null)} className="p-2 text-slate-400 hover:text-rose-500 transition-all">
                  <X size={22} />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 p-6 space-y-6">
                {/* Video embed */}
                {reviewing.video_url && (() => {
                  const embed = embedUrl(reviewing.video_url);
                  return embed ? (
                    <div className="rounded-2xl overflow-hidden bg-slate-950 aspect-video w-full">
                      <iframe
                        src={embed}
                        className="w-full h-full"
                        allowFullScreen
                        title="Vídeo seletiva"
                      />
                    </div>
                  ) : (
                    <a
                      href={reviewing.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl hover:border-[#ff0068] transition-all group"
                    >
                      <ExternalLink size={18} className="text-[#ff0068] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Link do Vídeo</p>
                        <p className="text-xs text-slate-600 dark:text-slate-300 truncate group-hover:text-[#ff0068] transition-all">{reviewing.video_url}</p>
                      </div>
                    </a>
                  );
                })()}

                {/* Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Responsável</p>
                    <p className="text-xs font-black text-slate-900 dark:text-white mt-1">{reviewing.profiles?.full_name ?? reviewing.estudio ?? '—'}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-2xl">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Categoria</p>
                    <p className="text-xs font-black text-slate-900 dark:text-white mt-1">{reviewing.categoria ?? '—'}</p>
                  </div>
                </div>

                {/* Feedback */}
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <MessageSquare size={11} /> Feedback (opcional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Deixe um comentário para o grupo..."
                    value={feedback}
                    onChange={e => setFeedback(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068] transition-all resize-none"
                  />
                </div>

                {/* Decision buttons */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Decisão</p>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => handleReview('approved')}
                      disabled={savingReview}
                      className="flex flex-col items-center gap-2 py-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-white hover:border-emerald-500 transition-all disabled:opacity-50 shadow-sm"
                    >
                      {savingReview ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle2 size={20} />}
                      Aprovar
                    </button>
                    <button
                      onClick={() => handleReview('conditional')}
                      disabled={savingReview}
                      className="flex flex-col items-center gap-2 py-4 bg-purple-500/10 border border-purple-500/20 text-purple-500 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-purple-500 hover:text-white hover:border-purple-500 transition-all disabled:opacity-50 shadow-sm"
                    >
                      {savingReview ? <RefreshCw size={18} className="animate-spin" /> : <AlertTriangle size={20} />}
                      Condicional
                    </button>
                    <button
                      onClick={() => handleReview('rejected')}
                      disabled={savingReview}
                      className="flex flex-col items-center gap-2 py-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-all disabled:opacity-50 shadow-sm"
                    >
                      {savingReview ? <RefreshCw size={18} className="animate-spin" /> : <XCircle size={20} />}
                      Reprovar
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VideoSelection;
