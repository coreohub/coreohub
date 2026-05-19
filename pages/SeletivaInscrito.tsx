import React, { useState, useEffect } from 'react';
import {
  Video, Clock, CheckCircle2, XCircle, AlertTriangle,
  Send, Lock, RefreshCw, MessageSquare, ExternalLink,
  CreditCard, Info, Film,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';
import { submitVideoForSelection } from '../services/supabase';

type VideoStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'conditional';
type VideoFeeStatus = 'not_required' | 'pending' | 'paid' | 'waived';

interface RegistrationWithVideo {
  id: string;
  nome_coreografia: string;
  estudio?: string;
  categoria?: string;
  formacao?: string;
  event_id?: string;
  event_nome?: string;
  video_url?: string | null;
  video_status?: VideoStatus;
  video_feedback?: string | null;
  video_submitted_at?: string | null;
  video_fee_status?: VideoFeeStatus;
  video_fee_payment_id?: string | null;
  video_approved_at?: string | null;
  status_pagamento?: string;
  payment_url?: string | null;
  video_selection_enabled?: boolean;
  video_selection_fee?: number;
  video_selection_fee_required?: boolean;
}

// YouTube URL é a opção indicada (resposta do produto). Mas aceitamos qualquer
// URL válida (Vimeo, Drive, etc.) — só sinalizamos YouTube como recomendado.
const isYoutubeUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === 'youtu.be';
  } catch { return false; }
};

const statusConfig: Record<VideoStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:     { label: 'Aguardando Envio', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',    icon: Clock         },
  submitted:   { label: 'Em Análise',       color: 'text-blue-500 bg-blue-500/10 border-blue-500/20',       icon: Film          },
  approved:    { label: 'Aprovado',          color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  rejected:    { label: 'Reprovado',         color: 'text-rose-500 bg-rose-500/10 border-rose-500/20',       icon: XCircle       },
  conditional: { label: 'Condicional',       color: 'text-purple-500 bg-purple-500/10 border-purple-500/20', icon: AlertTriangle },
};

const feeStatusConfig: Record<VideoFeeStatus, { label: string; color: string }> = {
  not_required: { label: 'Gratuita', color: 'text-emerald-500' },
  pending:      { label: 'Pagamento Pendente', color: 'text-amber-500' },
  paid:         { label: 'Pago', color: 'text-emerald-500' },
  waived:       { label: 'Isento', color: 'text-slate-400' },
};

const SeletivaInscrito: React.FC = () => {
  const [registrations, setRegistrations] = useState<RegistrationWithVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [videoLinks, setVideoLinks] = useState<Record<string, string>>({});
  const [linkError, setLinkError] = useState<Record<string, string>>({});
  const [activeDetail, setActiveDetail] = useState<RegistrationWithVideo | null>(null);
  const [feePaying,   setFeePaying]    = useState<string | null>(null);
  const [inscrPaying, setInscrPaying]  = useState<string | null>(null);
  const [actionError, setActionError]  = useState<Record<string, string>>({});

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Split queries (JOIN events(...) embed pode falhar quando RLS de events
      // restringe leitura pra inscrito não-dono). Mais robusto:
      // 1. Pega registrations do user
      // 2. Pega events por id (RLS de events permite SELECT pra qualquer auth
      //    em eventos públicos do festival)
      const { data: regsData, error } = await supabase
        .from('registrations')
        .select(`
          id, nome_coreografia, estudio, categoria, formacao, event_id,
          video_url, video_status, video_feedback, video_submitted_at,
          video_fee_status, video_fee_payment_id, video_approved_at,
          status_pagamento, payment_url
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const eventIds = Array.from(new Set((regsData ?? []).map((r: any) => r.event_id).filter(Boolean)));
      let eventsMap: Record<string, any> = {};
      if (eventIds.length > 0) {
        const { data: evts } = await supabase
          .from('events')
          .select('id, name, video_selection_enabled, video_selection_fee, video_selection_fee_required')
          .in('id', eventIds);
        for (const e of (evts ?? [])) eventsMap[e.id] = e;
      }

      const mapped: RegistrationWithVideo[] = (regsData || []).map((r: any) => {
        const ev = eventsMap[r.event_id] ?? {};
        return {
          ...r,
          event_nome: ev.name,
          video_selection_enabled: ev.video_selection_enabled ?? false,
          video_selection_fee: ev.video_selection_fee ?? 0,
          video_selection_fee_required: ev.video_selection_fee_required ?? false,
          video_status: r.video_status ?? 'pending',
          video_fee_status: r.video_fee_status ?? 'not_required',
        };
      });

      // Only show registrations where seletiva is enabled
      setRegistrations(mapped.filter(r => r.video_selection_enabled));
    } catch (err) {
      console.error('Erro ao carregar seletivas:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Modelo 3: dispara cobrança da TAXA A (seletiva) e redireciona pro Asaas.
  const handlePagarTaxa = async (reg: RegistrationWithVideo) => {
    setFeePaying(reg.id);
    setActionError(p => ({ ...p, [reg.id]: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-video-selection-payment`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ registration_id: reg.id, event_id: reg.event_id }),
        }
      );
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? 'Falha ao criar cobrança.');
      if (payload.waived) {
        await fetchData();
        return;
      }
      if (payload.invoice_url) {
        window.location.href = payload.invoice_url;
      }
    } catch (e: any) {
      setActionError(p => ({ ...p, [reg.id]: e.message ?? 'Erro inesperado.' }));
    } finally {
      setFeePaying(null);
    }
  };

  // Modelo 2/3 pós-aprovação: dispara cobrança da INSCRIÇÃO CHEIA (taxa B).
  // Reutiliza create-payment-asaas — inscrito já tem JWT + ownership.
  const handlePagarInscricao = async (reg: RegistrationWithVideo) => {
    setInscrPaying(reg.id);
    setActionError(p => ({ ...p, [reg.id]: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment-asaas`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ registration_id: reg.id, event_id: reg.event_id }),
        }
      );
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? 'Falha ao criar cobrança.');
      if (payload.invoice_url) {
        window.location.href = payload.invoice_url;
      }
    } catch (e: any) {
      setActionError(p => ({ ...p, [reg.id]: e.message ?? 'Erro inesperado.' }));
    } finally {
      setInscrPaying(null);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const isValidUrl = (url: string) => {
    try { new URL(url); return true; } catch { return false; }
  };

  const handleSubmit = async (regId: string) => {
    const url = videoLinks[regId]?.trim();
    if (!url) { setLinkError(p => ({ ...p, [regId]: 'Informe o link do vídeo.' })); return; }
    if (!isValidUrl(url)) { setLinkError(p => ({ ...p, [regId]: 'Link inválido. Use uma URL completa (ex: https://...).' })); return; }

    setSubmitting(regId);
    setLinkError(p => ({ ...p, [regId]: '' }));
    try {
      await submitVideoForSelection(regId, url);
      setRegistrations(prev =>
        prev.map(r => r.id === regId ? { ...r, video_status: 'submitted', video_url: url, video_submitted_at: new Date().toISOString() } : r)
      );
      setVideoLinks(p => ({ ...p, [regId]: '' }));
    } catch (err) {
      console.error(err);
      setLinkError(p => ({ ...p, [regId]: 'Erro ao enviar. Tente novamente.' }));
    } finally {
      setSubmitting(null);
    }
  };

  const hasPending = registrations.some(r => r.video_status === 'pending');

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20">
      {/* Header */}
      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
            Seletiva de <span className="text-[#ff0068]">Vídeo</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Envie seu vídeo para pré-seleção do evento
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all"
        >
          <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
        <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Como funciona</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Acompanhe o status da análise da comissão. Você pode trocar o link do vídeo até a aprovação. A trilha sonora será solicitada depois.
          </p>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-24 flex justify-center">
          <RefreshCw className="animate-spin text-[#ff0068]" size={32} />
        </div>
      ) : registrations.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-4 bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-[3rem]">
          <div className="w-16 h-16 bg-slate-200 dark:bg-white/5 rounded-[2rem] flex items-center justify-center text-slate-400">
            <Video size={28} />
          </div>
          <div className="text-center">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhuma seletiva de vídeo ativa</p>
            <p className="text-[10px] text-slate-400 mt-1">Seus eventos inscritos não possuem seletiva de vídeo no momento.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {hasPending && (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-2xl w-fit">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                {registrations.filter(r => r.video_status === 'pending').length} inscrição(ões) aguardando envio
              </span>
            </div>
          )}

          {registrations.map(reg => {
            const st = statusConfig[reg.video_status ?? 'pending'];
            const StatusIcon = st.icon;
            const isBlocked = (reg.video_fee_status === 'pending');
            // Permite enviar/trocar vídeo se ainda não foi aprovado pela comissão
            // (pending = sem link ainda; submitted/conditional = pode trocar; approved = trava).
            const canEditVideo = !isBlocked
              && reg.video_status !== 'approved'
              && reg.video_status !== 'rejected';
            const isFirstSubmit = reg.video_status === 'pending' && !reg.video_url;
            const canSubmit = canEditVideo;

            return (
              <motion.div
                key={reg.id}
                layout
                className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-[2.5rem] overflow-hidden shadow-sm dark:shadow-2xl"
              >
                {/* Card header */}
                <div className="p-6 flex flex-col sm:flex-row gap-4 sm:items-center">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="font-black text-slate-900 dark:text-white uppercase tracking-tight">{reg.nome_coreografia}</p>
                      <span className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border flex items-center gap-1.5 ${st.color}`}>
                        <StatusIcon size={10} />
                        {st.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {reg.event_nome && <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{reg.event_nome}</span>}
                      {reg.categoria && <span className="text-[9px] font-bold text-slate-400 uppercase">· {reg.categoria}</span>}
                      {reg.formacao && <span className="text-[9px] font-bold text-slate-400 uppercase">· {reg.formacao}</span>}
                    </div>
                    {reg.video_selection_fee != null && reg.video_selection_fee > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <CreditCard size={11} className="text-slate-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest">
                          Taxa seletiva: <span className="text-[#ff0068]">R$ {reg.video_selection_fee.toFixed(2).replace('.', ',')}</span>
                          {' · '}
                          <span className={feeStatusConfig[reg.video_fee_status ?? 'not_required'].color}>
                            {feeStatusConfig[reg.video_fee_status ?? 'not_required'].label}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Video link when already submitted */}
                  {reg.video_url && (
                    <a
                      href={reg.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:border-[#ff0068] hover:text-[#ff0068] transition-all shrink-0"
                    >
                      <ExternalLink size={13} /> Ver Vídeo
                    </a>
                  )}
                </div>

                {/* Feedback from producer */}
                {reg.video_feedback && (
                  <div className={`mx-6 mb-4 p-4 rounded-2xl border flex items-start gap-3 ${
                    reg.video_status === 'approved'    ? 'bg-emerald-500/5 border-emerald-500/20' :
                    reg.video_status === 'rejected'    ? 'bg-rose-500/5 border-rose-500/20' :
                    'bg-purple-500/5 border-purple-500/20'
                  }`}>
                    <MessageSquare size={14} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Feedback do Produtor</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{reg.video_feedback}</p>
                    </div>
                  </div>
                )}

                {/* Submit/edit form — Joinville-style: link já vem do wizard,
                    mas inscrito pode trocar enquanto não-aprovado. */}
                {canSubmit && (
                  <div className="border-t border-slate-100 dark:border-white/5 p-6 space-y-3">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      {isFirstSubmit ? 'Enviar link do vídeo' : 'Trocar link do vídeo'}
                    </p>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <input
                          type="url"
                          placeholder="https://youtube.com/watch?v=..."
                          value={videoLinks[reg.id] ?? ''}
                          onChange={e => {
                            setVideoLinks(p => ({ ...p, [reg.id]: e.target.value }));
                            setLinkError(p => ({ ...p, [reg.id]: '' }));
                          }}
                          className="w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068] transition-all"
                        />
                        {linkError[reg.id] && (
                          <p className="mt-1 text-[9px] font-black text-rose-500 uppercase tracking-widest">{linkError[reg.id]}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleSubmit(reg.id)}
                        disabled={submitting === reg.id}
                        className="px-6 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-60 shrink-0"
                      >
                        {submitting === reg.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                        Enviar
                      </button>
                    </div>
                  </div>
                )}

                {/* Blocked by fee — wired pra create-video-selection-payment */}
                {isBlocked && (
                  <div className="border-t border-slate-100 dark:border-white/5 p-6 flex items-center gap-3">
                    <Lock size={16} className="text-amber-500 shrink-0" />
                    <div className="flex-1">
                      <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Pagamento necessário</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Pague a taxa de seletiva para liberar o envio do vídeo.</p>
                      {actionError[reg.id] && (
                        <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mt-1">{actionError[reg.id]}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handlePagarTaxa(reg)}
                      disabled={feePaying === reg.id}
                      className="px-5 py-2.5 bg-amber-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 shrink-0 disabled:opacity-60"
                    >
                      {feePaying === reg.id
                        ? <RefreshCw size={13} className="animate-spin" />
                        : <CreditCard size={13} />}
                      Pagar Taxa
                    </button>
                  </div>
                )}

                {/* Aprovação na seletiva → libera 2ª cobrança (taxa B — inscrição cheia).
                    Mostra quando vídeo APROVADO e inscrição ainda em AGUARDANDO_VIDEO. */}
                {reg.video_status === 'approved' && reg.status_pagamento === 'AGUARDANDO_VIDEO' && (
                  <div className="border-t border-slate-100 dark:border-white/5 p-6 flex items-center gap-3 bg-emerald-50/40 dark:bg-emerald-500/5">
                    <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                    <div className="flex-1">
                      <p className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Vídeo aprovado!</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Conclua sua inscrição pagando o valor da taxa de inscrição.</p>
                      {actionError[reg.id] && (
                        <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mt-1">{actionError[reg.id]}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handlePagarInscricao(reg)}
                      disabled={inscrPaying === reg.id}
                      className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 shrink-0 disabled:opacity-60"
                    >
                      {inscrPaying === reg.id
                        ? <RefreshCw size={13} className="animate-spin" />
                        : <CreditCard size={13} />}
                      Pagar Inscrição
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Detail modal placeholder — future: video preview */}
      <AnimatePresence>
        {activeDetail && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setActiveDetail(null)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SeletivaInscrito;
