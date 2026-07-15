import React, { useState, useEffect, useCallback } from 'react';
import { supabase, resolveActiveEventId } from '../services/supabase';
import {
  Headphones, RefreshCw, Loader2, CheckCircle2,
  AlertTriangle, Wifi, WifiOff, Monitor, User,
  CircleDot, Clock, Radio, Hourglass,
  Maximize2, Minimize2, Megaphone, ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Judge {
  id: string;
  name: string;
  avatar_url?: string;
  is_active: boolean;
  competencias_generos: string[];
  competencias_formatos: string[];
  pin?: string;
}

type JudgeStatus = 'ONLINE' | 'OFFLINE' | 'PROBLEMA';

interface JudgeState {
  judge: Judge;
  status: JudgeStatus;
  note: string;
  lastSeen?: string;
}

interface LiveStatus {
  registration_id: string;
  nome_coreografia: string;
  estilo_danca: string;
  estudio: string;
  started_at: string | null;
  // judge_id → submitted_at (quem ja submeteu pra essa apresentacao)
  submissions: Record<string, string>;
}

// Item 38: cronograma completo pro modo display
interface ScheduleRow {
  id: string;
  nome_coreografia: string;
  estilo_danca: string | null;
  estudio: string | null;
  ordem_apresentacao: number | null;
  categoria: string | null;
}

type ActionMessage = { kind: 'success' | 'warning' | 'error'; text: string };

const statusConfig: Record<JudgeStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  ONLINE:   { label: 'Online',   color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  OFFLINE:  { label: 'Offline',  color: 'text-slate-400',   bg: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10', icon: WifiOff },
  PROBLEMA: { label: 'Problema', color: 'text-amber-500',   bg: 'bg-amber-500/10 border-amber-500/20', icon: AlertTriangle },
};

const SuporteJuri = () => {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [judgeStates, setJudgeStates] = useState<Record<string, JudgeState>>({});
  const [loading, setLoading] = useState(true);
  const [currentStyle, setCurrentStyle] = useState<string>('');
  const [currentPresentation, setCurrentPresentation] = useState<string>('');
  const [online, setOnline] = useState(navigator.onLine);
  // Phase 4: status da apresentacao ao vivo segundo a Mesa de Som
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);

  // Item 38: modo display kiosk + cronograma completo + push offline
  const [displayMode, setDisplayMode] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);
  const [fullSchedule, setFullSchedule] = useState<ScheduleRow[]>([]);
  // Quando push pro Supabase falha (offline/RLS), marca aqui pra mostrar no kiosk
  // que coordenador precisa anunciar em voz alta.
  const [manualLiveId, setManualLiveId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  // Auto-dismiss do toast de ação
  useEffect(() => {
    if (!actionMessage) return;
    const tid = setTimeout(() => setActionMessage(null), 6000);
    return () => clearTimeout(tid);
  }, [actionMessage]);

  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Phase 4: busca apresentacao ao vivo + quais jurados ja submeteram nota
  const fetchLiveStatus = useCallback(async () => {
    try {
      const { data: ev } = await supabase
        .from('events')
        .select('id, live_registration_id, live_started_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!ev?.live_registration_id) {
        setLiveStatus(null);
        return;
      }

      const [{ data: reg }, { data: evals }] = await Promise.all([
        supabase
          .from('registrations')
          .select('id, nome_coreografia, estilo_danca, estudio')
          .eq('id', ev.live_registration_id)
          .maybeSingle(),
        supabase
          .from('evaluations')
          .select('judge_id, submitted_at')
          .eq('registration_id', ev.live_registration_id),
      ]);

      if (!reg) { setLiveStatus(null); return; }

      const submissions: Record<string, string> = {};
      (evals ?? []).forEach((e: any) => {
        if (e.judge_id && e.submitted_at) submissions[e.judge_id] = e.submitted_at;
      });

      setLiveStatus({
        registration_id: reg.id,
        nome_coreografia: reg.nome_coreografia,
        estilo_danca: reg.estilo_danca,
        estudio: reg.estudio,
        started_at: ev.live_started_at,
        submissions,
      });
    } catch (e) {
      console.warn('fetchLiveStatus:', e);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Resolve evento ativo (necessário pra UPDATE em events.live_registration_id)
      const evId = await resolveActiveEventId();
      setEventId(evId);

      // Cronograma completo: mesma fonte que o JudgeTerminal (status=APROVADA),
      // filtrado por evento ativo quando há um. Sem filtro = compat legado.
      let scheduleQuery = supabase
        .from('registrations')
        .select('id, nome_coreografia, estilo_danca, estudio, ordem_apresentacao, categoria')
        .eq('status', 'APROVADA')
        .order('ordem_apresentacao', { ascending: true });
      if (evId) scheduleQuery = scheduleQuery.eq('event_id', evId);

      // Jurado só entra no board "quem está online" se vinculado a ESTE
      // evento (event_judges, migration 20260715) — antes disso, jurado de
      // qualquer evento do produtor (inclusive demo) aparecia aqui.
      let judgesQuery = supabase
        .from('judges')
        .select('id,name,avatar_url,is_active,competencias_generos,competencias_formatos,pin')
        .order('name');
      if (evId) {
        const { data: links } = await supabase.from('event_judges').select('judge_id').eq('event_id', evId);
        const linkedIds = (links ?? []).map(l => l.judge_id);
        judgesQuery = judgesQuery.in('id', linkedIds.length > 0 ? linkedIds : ['00000000-0000-0000-0000-000000000000']);
      }

      const [{ data: judgesData }, { data: scheduleData }] = await Promise.all([
        judgesQuery,
        scheduleQuery,
      ]);

      const list: Judge[] = judgesData || [];
      setJudges(list);
      setFullSchedule((scheduleData ?? []) as ScheduleRow[]);

      // Phase 4: carrega live status em paralelo
      await fetchLiveStatus();

      // Initialize states preserving existing
      setJudgeStates(prev => {
        const next = { ...prev };
        list.forEach(j => {
          if (!next[j.id]) {
            next[j.id] = {
              judge: j,
              status: j.is_active ? 'ONLINE' : 'OFFLINE',
              note: '',
            };
          } else {
            next[j.id].judge = j;
          }
        });
        return next;
      });

      // Próxima na fila pro card de transição
      const next = (scheduleData ?? [])[0];
      if (next) {
        setCurrentPresentation(next.nome_coreografia || '');
        setCurrentStyle(next.estilo_danca || '');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [fetchLiveStatus]);

  // Item 38: marca uma apresentação como ao vivo. Online → UPDATE no Supabase;
  // offline/RLS bloqueado → marcador local + toast pedindo anúncio em voz alta.
  const handleMarkLive = useCallback(async (reg: ScheduleRow) => {
    if (!eventId) {
      setActionMessage({ kind: 'error', text: 'Evento ativo não identificado. Recarregue a página.' });
      return;
    }
    try {
      const { error } = await supabase
        .from('events')
        .update({ live_registration_id: reg.id, live_started_at: new Date().toISOString() })
        .eq('id', eventId);
      if (error) throw error;
      setManualLiveId(null);
      setActionMessage({
        kind: 'success',
        text: `#${reg.ordem_apresentacao ?? '?'} ${reg.nome_coreografia} marcada como ao vivo`,
      });
      await fetchLiveStatus();
    } catch (e) {
      // Fallback: salva localmente pra exibir no kiosk + instrui voz alta
      setManualLiveId(reg.id);
      setActionMessage({
        kind: 'warning',
        text: `Sem conexão. Anuncie "Apresentação número ${reg.ordem_apresentacao ?? '?'}" em voz alta — jurados pulam manualmente no menu ⋮`,
      });
    }
  }, [eventId, fetchLiveStatus]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Phase 4: realtime no events (live_registration_id) + evaluations da live atual
  useEffect(() => {
    const ch = supabase.channel('coordenador-juri-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, () => {
        fetchLiveStatus();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'evaluations' }, () => {
        fetchLiveStatus();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchLiveStatus]);

  const setStatus = (judgeId: string, status: JudgeStatus) => {
    setJudgeStates(prev => ({
      ...prev,
      [judgeId]: { ...prev[judgeId], status, lastSeen: status === 'ONLINE' ? new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : prev[judgeId]?.lastSeen },
    }));
  };

  const setNote = (judgeId: string, note: string) => {
    setJudgeStates(prev => ({ ...prev, [judgeId]: { ...prev[judgeId], note } }));
  };

  const onlineCount  = Object.values(judgeStates).filter(s => s.status === 'ONLINE').length;
  const problemCount = Object.values(judgeStates).filter(s => s.status === 'PROBLEMA').length;

  // Item 38: dados derivados pro modo display
  const liveReg = liveStatus
    ? fullSchedule.find(r => r.id === liveStatus.registration_id) ?? null
    : null;
  const manualLiveReg = manualLiveId
    ? fullSchedule.find(r => r.id === manualLiveId) ?? null
    : null;
  // Em offline, prioriza o que o coordenador acabou de marcar manualmente
  const kioskActive = manualLiveReg ?? liveReg;
  const kioskActiveIdx = kioskActive
    ? fullSchedule.findIndex(r => r.id === kioskActive.id)
    : -1;
  const upcomingList = kioskActiveIdx >= 0
    ? fullSchedule.slice(kioskActiveIdx + 1, kioskActiveIdx + 6)
    : fullSchedule.slice(0, 5);

  // ─── Modo Display (kiosk) ──────────────────────────────────────────────────
  // Tablet do coordenador em modo "anunciador": número GIGANTE da coreografia
  // ao vivo, fila de próximas com botão "Marcar como ao vivo" pra cada uma.
  // Funciona em qualquer rede: online faz UPDATE, offline marca local + toast
  // pedindo anúncio em voz alta (jurados digitam #N no menu ⋮ do terminal).
  if (displayMode) {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-950 text-white overflow-y-auto">
        {/* Topbar do kiosk */}
        <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-white/10 px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Megaphone size={18} className="text-[#ff0068]" />
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
              Modo Display · Coordenador
            </p>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[8px] font-black uppercase tracking-widest ${online ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
              {online ? <Wifi size={10} /> : <WifiOff size={10} />}
              {online ? 'Online' : 'Offline'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition-all"
              title="Atualizar"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setDisplayMode(false)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest transition-all"
            >
              <Minimize2 size={12} /> Sair do display
            </button>
          </div>
        </div>

        {/* Mensagem de ação (online success / offline warning) */}
        <AnimatePresence>
          {actionMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`mx-6 mt-4 px-5 py-3 rounded-2xl border text-sm font-bold ${
                actionMessage.kind === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                actionMessage.kind === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' :
                'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {actionMessage.text}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Card central: número GIGANTE da apresentação ao vivo */}
        <div className="px-6 py-10">
          {kioskActive ? (
            <div className="bg-gradient-to-br from-[#ff0068]/20 via-rose-600/10 to-transparent border-2 border-[#ff0068]/40 rounded-[2rem] p-10 text-center">
              <div className="flex items-center justify-center gap-3 mb-6">
                <Radio size={20} className="text-[#ff0068] animate-pulse" />
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-[#ff0068]">
                  {manualLiveReg ? 'Anunciar agora' : 'Ao vivo no palco'}
                </p>
              </div>
              <p
                className="font-black tabular-nums leading-none text-white tracking-tighter"
                style={{ fontSize: 'clamp(8rem, 28vw, 24rem)' }}
              >
                #{kioskActive.ordem_apresentacao ?? '?'}
              </p>
              <p className="mt-6 text-3xl sm:text-5xl font-black uppercase tracking-tighter italic text-white">
                {kioskActive.nome_coreografia}
              </p>
              <p className="mt-3 text-sm sm:text-lg font-bold uppercase tracking-widest text-slate-400">
                {kioskActive.estudio ?? '—'} · {kioskActive.estilo_danca ?? '—'}
                {kioskActive.categoria && ` · ${kioskActive.categoria}`}
              </p>
              {manualLiveReg && (
                <p className="mt-6 text-[11px] font-black uppercase tracking-widest text-amber-300">
                  Sem rede — anuncie em voz alta. Jurados digitam #{kioskActive.ordem_apresentacao} no menu ⋮ do terminal.
                </p>
              )}
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-[2rem] p-16 text-center">
              <CircleDot size={48} className="mx-auto mb-6 text-slate-500" />
              <p className="text-2xl font-black uppercase tracking-tighter text-slate-300">
                Aguardando início
              </p>
              <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
                Selecione abaixo a apresentação que vai ao palco
              </p>
            </div>
          )}
        </div>

        {/* Lista de próximas (clicável: marcar como ao vivo) */}
        <div className="px-6 pb-16">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-4">
            Próximas apresentações
          </p>
          {fullSchedule.length === 0 ? (
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 py-8 text-center">
              Cronograma vazio
            </p>
          ) : upcomingList.length === 0 ? (
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 py-8 text-center">
              Fim do cronograma
            </p>
          ) : (
            <div className="space-y-2">
              {upcomingList.map(reg => (
                <button
                  key={reg.id}
                  onClick={() => handleMarkLive(reg)}
                  className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#ff0068]/40 transition-all text-left group"
                >
                  <div className="shrink-0 w-16 h-16 rounded-2xl bg-[#ff0068]/10 group-hover:bg-[#ff0068]/20 border border-[#ff0068]/20 flex items-center justify-center transition-all">
                    <span className="text-2xl font-black tabular-nums text-[#ff0068]">
                      {reg.ordem_apresentacao ?? '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-lg uppercase tracking-tight truncate text-white">
                      {reg.nome_coreografia}
                    </p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 truncate">
                      {reg.estudio ?? '—'} · {reg.estilo_danca ?? '—'}
                    </p>
                  </div>
                  <ChevronRight size={20} className="shrink-0 text-slate-500 group-hover:text-[#ff0068] transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
            Coordenador <span className="text-[#ff0068]">do Júri</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            {onlineCount}/{judges.length} jurados online
            {problemCount > 0 && <span className="text-amber-500 ml-2">· {problemCount} problema{problemCount !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-widest ${online ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-100 dark:bg-white/5 text-slate-400 border-slate-200 dark:border-white/10'}`}>
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? 'Conectado' : 'Offline'}
          </div>
          {/* Item 38: toggle pro modo display kiosk (anunciador) */}
          <button
            onClick={() => setDisplayMode(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#ff0068]/10 hover:bg-[#ff0068]/20 border border-[#ff0068]/30 rounded-2xl text-[#ff0068] text-[9px] font-black uppercase tracking-widest transition-all"
            title="Modo display: número grande pra anunciar coreografias em voz alta"
          >
            <Maximize2 size={12} /> Modo display
          </button>
          <button onClick={fetchData} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Item 38: toast de ação (sucesso/aviso offline/erro) */}
      <AnimatePresence>
        {actionMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`px-5 py-3 rounded-2xl border text-[11px] font-bold ${
              actionMessage.kind === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300' :
              actionMessage.kind === 'warning' ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300' :
              'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300'
            }`}
          >
            {actionMessage.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase 4: Apresentação ao vivo (Mesa de Som controla) + status de submissões */}
      {liveStatus ? (
        <div className="bg-rose-500/5 border-2 border-rose-500/30 rounded-3xl overflow-hidden">
          <div className="px-5 py-4 bg-rose-500/10 flex items-center gap-4 border-b border-rose-500/20">
            <div className="w-10 h-10 bg-rose-500 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-rose-500/30">
              <Radio size={18} className="text-white animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-rose-500 mb-0.5">AO VIVO no palco</p>
              <p className="font-black text-base text-slate-900 dark:text-white uppercase tracking-tight truncate">{liveStatus.nome_coreografia}</p>
              <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest truncate">
                {liveStatus.estudio} · {liveStatus.estilo_danca}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Submetidas</p>
              <p className="text-2xl font-black text-rose-500 tabular-nums leading-none">
                {Object.keys(liveStatus.submissions).length}/{judges.length}
              </p>
            </div>
          </div>
          <div className="px-5 py-3 bg-white dark:bg-white/5">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-2">Status dos jurados</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {judges.map(j => {
                const submitted = liveStatus.submissions[j.id];
                return (
                  <div
                    key={j.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border ${
                      submitted
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
                        : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10'
                    }`}
                  >
                    {submitted
                      ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                      : <Hourglass size={12} className="text-amber-500 shrink-0 animate-pulse" />
                    }
                    <span className={`text-[10px] font-black uppercase tracking-tight truncate ${submitted ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}`}>
                      {j.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (currentPresentation || currentStyle) ? (
        <div className="bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-3xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-[#ff0068]/10 rounded-2xl flex items-center justify-center shrink-0">
            <CircleDot size={18} className="text-[#ff0068] animate-pulse" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068] mb-0.5">Próxima na fila</p>
            <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight">{currentPresentation || '—'}</p>
            {currentStyle && <p className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">{currentStyle}</p>}
            <p className="text-xs text-slate-500 mt-1 italic">Mesa de Som ainda não iniciou transmissão</p>
          </div>
        </div>
      ) : null}

      {/* Judge cards */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
      ) : judges.length === 0 ? (
        <div className="py-20 text-center bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-3xl">
          <Headphones size={40} className="mx-auto text-slate-400 mb-3" />
          <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhum jurado cadastrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {judges.map(judge => {
            const state = judgeStates[judge.id];
            if (!state) return null;
            const cfg = statusConfig[state.status];
            const StatusIcon = cfg.icon;

            return (
              <motion.div
                key={judge.id}
                layout
                className={`bg-white dark:bg-slate-900/40 border rounded-3xl p-5 space-y-4 transition-all ${
                  state.status === 'PROBLEMA' ? 'border-amber-500/30' :
                  state.status === 'ONLINE'   ? 'border-emerald-500/20' :
                  'border-slate-200 dark:border-white/5'
                }`}
              >
                {/* Judge info */}
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/10 overflow-hidden flex items-center justify-center">
                      {judge.avatar_url
                        ? <img src={judge.avatar_url} alt={judge.name} className="w-full h-full object-cover" />
                        : <User size={20} className="text-slate-400" />
                      }
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 ${
                      state.status === 'ONLINE' ? 'bg-emerald-500' :
                      state.status === 'PROBLEMA' ? 'bg-amber-500' : 'bg-slate-400'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight truncate">{judge.name}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {judge.competencias_generos.slice(0, 2).map(g => (
                        <span key={g} className="text-[8px] font-black uppercase tracking-widest text-[#ff0068] bg-[#ff0068]/10 px-1.5 py-0.5 rounded-full">{g}</span>
                      ))}
                      {judge.competencias_generos.length > 2 && (
                        <span className="text-[8px] font-black text-slate-400">+{judge.competencias_generos.length - 2}</span>
                      )}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-xl border text-[8px] font-black uppercase tracking-widest shrink-0 ${cfg.bg} ${cfg.color}`}>
                    <StatusIcon size={10} />
                    {cfg.label}
                  </div>
                </div>

                {/* Status buttons */}
                <div className="grid grid-cols-3 gap-1.5">
                  {(['ONLINE', 'OFFLINE', 'PROBLEMA'] as JudgeStatus[]).map(s => {
                    const c = statusConfig[s];
                    const active = state.status === s;
                    const Icon = c.icon;
                    return (
                      <button
                        key={s}
                        onClick={() => setStatus(judge.id, s)}
                        className={`py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1 border ${
                          active ? `${c.bg} ${c.color}` : 'border-slate-200 dark:border-white/10 text-slate-400 hover:border-slate-300 dark:hover:border-white/20'
                        }`}
                      >
                        <Icon size={10} /> {c.label}
                      </button>
                    );
                  })}
                </div>

                {/* Note field — visible only on PROBLEMA */}
                <AnimatePresence>
                  {state.status === 'PROBLEMA' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <textarea
                        rows={2}
                        placeholder="Descreva o problema (ex: terminal travado, sem internet)..."
                        value={state.note}
                        onChange={e => setNote(judge.id, e.target.value)}
                        className="w-full bg-amber-500/5 border border-amber-500/20 rounded-2xl py-2.5 px-3 text-[10px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500/50 transition-all resize-none"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Terminal info */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-white/5">
                  <div className="flex items-center gap-1.5">
                    <Monitor size={11} className="text-slate-400" />
                    <span className="text-[9px] text-slate-400 font-bold uppercase">
                      {judge.pin ? 'PIN configurado' : 'Sem PIN'}
                    </span>
                  </div>
                  {state.lastSeen && (
                    <div className="flex items-center gap-1">
                      <Clock size={9} className="text-slate-400" />
                      <span className="text-[8px] text-slate-400 font-bold">{state.lastSeen}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SuporteJuri;
