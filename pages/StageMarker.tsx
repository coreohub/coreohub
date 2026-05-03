import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, CheckCircle2, RotateCcw, AlertTriangle, Clock, Users, Music, ChevronRight, Wifi, WifiOff, Settings2, Save, Loader2, Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';

type TimerState = 'WAITING' | 'MARKING' | 'READY';

interface Presentation {
  id: string;
  nome_coreografia: string;
  estudio: string;
  categoria?: string;
  estilo_danca?: string;
  elenco?: any[];
  ordem_apresentacao?: number;
}

const fmtTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const StageMarker = () => {
  const [state, setState] = useState<TimerState>('WAITING');
  const [remaining, setRemaining] = useState(45);
  const [totalTime, setTotalTime] = useState(45);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingSync, setPendingSync] = useState<any[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [marcarPalcoAtivo, setMarcarPalcoAtivo] = useState(true);
  const [gatilho, setGatilho] = useState<'MANUAL_MARCADOR' | 'MANUAL_COORDENADOR' | 'AUTO_SONOPLASTA'>('MANUAL_MARCADOR');
  const [tempoMarcacao, setTempoMarcacao] = useState(45);
  // Busca/lista de apresentacoes pra navegacao nao-sequencial
  const [showList, setShowList] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [listFilter, setListFilter] = useState<'todas' | 'marcadas' | 'pendentes'>('todas');

  /* ── connectivity ── */
  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  /* ── sync pending records when back online ── */
  useEffect(() => {
    if (!online || pendingSync.length === 0) return;
    const sync = async () => {
      const remaining = [];
      for (const rec of pendingSync) {
        const { error } = await supabase.from('stage_timings').insert(rec);
        if (error) remaining.push(rec);
      }
      setPendingSync(remaining);
    };
    sync();
  }, [online]); // eslint-disable-line

  /* ── load config + presentations ── */
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const { fetchActiveEventConfig } = await import('../services/supabase');
        const [cfg, { data: regs }] = await Promise.all([
          fetchActiveEventConfig('tempo_marcacao_palco,marcar_palco_ativo,gatilho_marcacao'),
          supabase
            .from('registrations')
            .select('id,nome_coreografia,estudio,categoria,estilo_danca,elenco,ordem_apresentacao')
            .eq('status_pagamento', 'CONFIRMADO')
            .order('ordem_apresentacao', { ascending: true }),
        ]);
        const t = cfg?.tempo_marcacao_palco ?? 45;
        setTotalTime(t);
        setRemaining(t);
        setTempoMarcacao(t);
        setMarcarPalcoAtivo(cfg?.marcar_palco_ativo ?? true);
        setGatilho(cfg?.gatilho_marcacao ?? 'MANUAL_MARCADOR');
        setPresentations(regs || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  /* ── countdown ── */
  const stopInterval = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  useEffect(() => {
    if (state !== 'MARKING') { stopInterval(); return; }
    intervalRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          stopInterval();
          // don't auto-complete — just visual alert
          return 0;
        }
        return r - 1;
      });
      setElapsed(e => e + 1);
    }, 1000);
    return stopInterval;
  }, [state, stopInterval]);

  const handleStart = () => {
    setRemaining(totalTime);
    setElapsed(0);
    setStartedAt(new Date());
    setState('MARKING');
  };

  const handleReady = async () => {
    stopInterval();
    const finishedAt = new Date();
    const duration = startedAt ? Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000) : elapsed;
    const current = presentations[currentIndex];
    setState('READY');

    const record = {
      registration_id: current?.id ?? null,
      started_at: startedAt?.toISOString() ?? null,
      finished_at: finishedAt.toISOString(),
      duration_seconds: duration,
      target_seconds: totalTime,
    };

    if (online) {
      const { error } = await supabase.from('stage_timings').insert(record);
      if (error) setPendingSync(p => [...p, record]);
    } else {
      setPendingSync(p => [...p, record]);
    }
  };

  const handleNext = () => {
    setCurrentIndex(i => i + 1);
    setRemaining(totalTime);
    setElapsed(0);
    setStartedAt(null);
    setState('WAITING');
  };

  const handleCancel = () => {
    stopInterval();
    setRemaining(totalTime);
    setElapsed(0);
    setStartedAt(null);
    setState('WAITING');
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await supabase.from('configuracoes').update({
        tempo_marcacao_palco: tempoMarcacao,
        marcar_palco_ativo:   marcarPalcoAtivo,
        gatilho_marcacao:     gatilho,
      }).eq('id', 1);
      setTotalTime(tempoMarcacao);
      setRemaining(tempoMarcacao);
      setShowSettings(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingSettings(false);
    }
  };

  const current  = presentations[currentIndex];
  const next     = presentations[currentIndex + 1];
  const pct      = totalTime > 0 ? ((totalTime - remaining) / totalTime) * 100 : 0;
  const isOverTime = state === 'MARKING' && remaining === 0;
  const isWarning  = state === 'MARKING' && remaining > 0 && remaining <= 10;

  /* ── colors per state ── */
  const stateColor = {
    WAITING: 'from-slate-900 to-slate-950',
    MARKING: isOverTime ? 'from-rose-950 to-slate-950' : isWarning ? 'from-amber-950 to-slate-950' : 'from-slate-800 to-slate-950',
    READY:   'from-emerald-950 to-slate-950',
  }[state];

  const ringColor = {
    WAITING: 'stroke-slate-700',
    MARKING: isOverTime ? 'stroke-rose-500' : isWarning ? 'stroke-amber-400' : 'stroke-[#ff0068]',
    READY:   'stroke-emerald-500',
  }[state];

  const circumference = 2 * Math.PI * 90; // radius 90

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="w-12 h-12 border-4 border-[#ff0068] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-gradient-to-b ${stateColor} text-white rounded-3xl overflow-hidden transition-colors duration-700 min-h-[calc(100vh-5rem)]`}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Marcador de Palco</p>
          <p className="text-[11px] font-black uppercase tracking-widest text-white">
            #{currentIndex + 1} / {presentations.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingSync.length > 0 && (
            <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest bg-amber-400/10 px-2 py-1 rounded-full">
              {pendingSync.length} pend.
            </span>
          )}
          <div className={`flex items-center gap-1 ${online ? 'text-emerald-400' : 'text-slate-500'}`}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
          </div>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`p-2 rounded-xl transition-all ${showSettings ? 'bg-white/20 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
          >
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {/* Barra de busca inline — estilo Registrations (visivel sempre).
          Foco/typing abre dropdown com lista filtrada de coreografias. */}
      <div className="px-5 mb-3 relative">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onFocus={() => setShowList(true)}
            onBlur={() => {
              // Atraso pra permitir click registrar antes do dropdown sumir
              setTimeout(() => setShowList(false), 150);
            }}
            placeholder="Buscar coreografia ou estúdio..."
            className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#ff0068]/50 transition-colors"
          />
          {searchTerm && (
            <button
              onMouseDown={(e) => e.preventDefault()} // evita blur antes do click
              onClick={() => setSearchTerm('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              title="Limpar busca"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Dropdown de resultados — aparece em focus ou typing */}
        {showList && (() => {
          const totalMarcadas = currentIndex;
          const totalPendentes = presentations.length - currentIndex;
          const filtered = presentations.filter(p => {
            const realIdx = presentations.findIndex(x => x.id === p.id);
            const isMarked = realIdx < currentIndex;
            // Filtro de aba
            if (listFilter === 'marcadas' && !isMarked) return false;
            if (listFilter === 'pendentes' && isMarked) return false;
            // Filtro de busca
            if (searchTerm && !(
              p.nome_coreografia?.toLowerCase().includes(searchTerm.toLowerCase()) ||
              p.estudio?.toLowerCase().includes(searchTerm.toLowerCase())
            )) return false;
            return true;
          });
          return (
            <div className="absolute z-30 left-5 right-5 mt-2 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[60vh]">
              {/* Tabs de filtro */}
              <div className="flex items-center gap-1 p-2 border-b border-white/10 bg-white/[0.02]">
                {([
                  { v: 'todas',     label: 'Todas',     count: presentations.length },
                  { v: 'pendentes', label: 'Pendentes', count: totalPendentes },
                  { v: 'marcadas',  label: 'Marcadas',  count: totalMarcadas },
                ] as const).map(tab => {
                  const active = listFilter === tab.v;
                  return (
                    <button
                      key={tab.v}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setListFilter(tab.v)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                        active ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/20' : 'text-slate-400 hover:bg-white/5'
                      }`}
                    >
                      {tab.label}
                      <span className={`px-1.5 py-0.5 rounded text-[8px] ${active ? 'bg-white/20' : 'bg-white/5'}`}>
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="overflow-y-auto divide-y divide-white/5">
                {filtered.map((p) => {
                  const realIdx = presentations.findIndex(x => x.id === p.id);
                  const isCurrent = realIdx === currentIndex;
                  const isMarked  = realIdx < currentIndex;
                  return (
                    <button
                      key={p.id}
                      onMouseDown={(e) => e.preventDefault()} // evita blur fechar antes do click
                      onClick={() => {
                        setCurrentIndex(realIdx);
                        setSearchTerm('');
                        setShowList(false);
                        setState('WAITING');
                        setRemaining(totalTime);
                        setElapsed(0);
                        setStartedAt(null);
                        stopInterval();
                      }}
                      className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                        isCurrent ? 'bg-[#ff0068]/10 hover:bg-[#ff0068]/15' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                        isMarked  ? 'bg-emerald-500/20 text-emerald-400' :
                        isCurrent ? 'bg-[#ff0068] text-white animate-pulse' :
                        'bg-white/5 text-slate-500 border border-white/10'
                      }`}>
                        {isMarked ? <CheckCircle2 size={12} /> : realIdx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-black uppercase tracking-tight truncate ${isCurrent ? 'text-[#ff0068]' : 'text-white'}`}>
                          {p.nome_coreografia}
                        </p>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest truncate">
                          {p.estudio} · {p.estilo_danca} · {p.categoria}
                        </p>
                      </div>
                      {isMarked && (
                        <span className="text-[8px] font-black uppercase tracking-widest text-emerald-400 shrink-0">Marcada</span>
                      )}
                      {isCurrent && (
                        <span className="text-[8px] font-black uppercase tracking-widest text-[#ff0068] shrink-0">Atual</span>
                      )}
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="p-8 text-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                      Nenhuma coreografia encontrada
                    </p>
                  </div>
                )}
              </div>
              <div className="px-4 py-2 border-t border-white/10 bg-white/[0.02] text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
                {currentIndex} marcadas · {presentations.length - currentIndex - 1} pendentes · {presentations.length} total
              </div>
            </div>
          );
        })()}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mx-5 mb-4 bg-white/5 border border-white/10 rounded-2xl p-5 space-y-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Configurações de Marcação de Palco</p>

          {/* Marcar Palco Ativo */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-white">Marcar Palco Ativo</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Exibe indicador de palco ativo na tela do júri</p>
            </div>
            <button
              onClick={() => setMarcarPalcoAtivo(v => !v)}
              className={`w-12 h-6 rounded-full transition-all relative ${marcarPalcoAtivo ? 'bg-[#ff0068]' : 'bg-white/20'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${marcarPalcoAtivo ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>

          {/* Tempo de Marcação */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Tempo de Marcação de Palco (segundos)</label>
            <input
              type="number" min={10} max={300}
              value={tempoMarcacao}
              onChange={e => setTempoMarcacao(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-white font-bold text-sm focus:outline-none focus:border-[#ff0068]/50"
            />
            <p className="text-[10px] text-slate-500 mt-1">Recomendado: 45–90s. Alimenta o cronômetro desta tela.</p>
          </div>

          {/* Gatilho */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Gatilho do Cronômetro</label>
            <div className="space-y-2">
              {([
                { v: 'MANUAL_MARCADOR'    as const, label: 'Manual — Marcador de Palco', desc: 'O próprio marcador inicia a contagem (padrão recomendado).' },
                { v: 'MANUAL_COORDENADOR' as const, label: 'Manual — Coordenador',       desc: 'O coordenador dispara a contagem pelo painel dele.' },
                { v: 'AUTO_SONOPLASTA'    as const, label: 'Automático — Fim do Áudio',  desc: 'Cronômetro inicia quando o sonoplasta encerra a apresentação.' },
              ]).map(opt => {
                const active = gatilho === opt.v;
                return (
                  <button
                    key={opt.v}
                    onClick={() => setGatilho(opt.v)}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${active ? 'border-[#ff0068] bg-[#ff0068]/10' : 'border-white/10 hover:border-white/20'}`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center transition-all ${active ? 'border-[#ff0068] bg-[#ff0068]' : 'border-white/30'}`}>
                      {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <p className={`text-[11px] font-black uppercase tracking-widest ${active ? 'text-[#ff0068]' : 'text-white'}`}>{opt.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#ff0068] hover:bg-[#d4005a] disabled:opacity-50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
          >
            {savingSettings ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Salvar Configurações
          </button>
        </div>
      )}

      {/* Current card */}
      <div className="px-5 pb-4">
        <div className="bg-white/5 border border-white/10 rounded-3xl p-5 space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Preparar para</p>
          <p className="text-xl font-black uppercase tracking-tight leading-tight text-white">
            {current?.nome_coreografia ?? '—'}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {current?.estudio && (
              <span className="text-[9px] font-black uppercase tracking-widest text-[#ff0068]">{current.estudio}</span>
            )}
            {current?.categoria && (
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">· {current.categoria}</span>
            )}
            {current?.estilo_danca && (
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">· {current.estilo_danca}</span>
            )}
          </div>
          {current?.elenco && current.elenco.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1">
              <Users size={12} className="text-slate-400" />
              <span className="text-[9px] font-bold text-slate-400 uppercase">
                {current.elenco.length} bailarino{current.elenco.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Timer ring — main focus */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 gap-6 py-6">
        <div className="relative w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 flex items-center justify-center">
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
            <circle
              cx="100" cy="100" r="90" fill="none"
              strokeWidth="8" strokeLinecap="round"
              className={`${ringColor} transition-all duration-1000`}
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (circumference * pct / 100)}
            />
          </svg>

          <div className="text-center">
            <AnimatePresence mode="wait">
              {state === 'WAITING' && (
                <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                  <Clock size={32} className="text-slate-500 mx-auto mb-2" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Aguardando</p>
                </motion.div>
              )}
              {state === 'MARKING' && (
                <motion.div key="mark" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                  <p className={`text-6xl font-black tabular-nums ${isOverTime ? 'text-rose-400 animate-pulse' : isWarning ? 'text-amber-400' : 'text-white'}`}>
                    {isOverTime ? '+' + fmtTime(elapsed - totalTime) : fmtTime(remaining)}
                  </p>
                  <p className={`text-[9px] font-black uppercase tracking-widest mt-1 ${isOverTime ? 'text-rose-400' : 'text-slate-400'}`}>
                    {isOverTime ? 'Tempo esgotado' : 'Marcando palco'}
                  </p>
                </motion.div>
              )}
              {state === 'READY' && (
                <motion.div key="ready" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                  <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-2" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Palco Pronto</p>
                  <p className="text-[9px] text-slate-400 mt-1">{fmtTime(elapsed)} concluído</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* State label under ring */}
        {isWarning && !isOverTime && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-400/10 border border-amber-400/30 rounded-full"
          >
            <AlertTriangle size={12} className="text-amber-400" />
            <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Últimos segundos!</span>
          </motion.div>
        )}
      </div>

      {/* CTA buttons */}
      <div className="px-5 pb-6 space-y-3 max-w-sm w-full mx-auto">
        <AnimatePresence mode="wait">
          {state === 'WAITING' && (
            <motion.button
              key="start"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              onClick={handleStart}
              className="w-full py-6 bg-[#ff0068] text-white rounded-3xl font-black text-lg uppercase tracking-widest shadow-2xl shadow-[#ff0068]/30 hover:scale-[1.02] active:scale-[0.98] transition-transform flex items-center justify-center gap-3"
            >
              <Play size={24} fill="white" /> Iniciar Marcação
            </motion.button>
          )}

          {state === 'MARKING' && (
            <motion.div key="marking-btns" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              <button
                onClick={handleReady}
                className="w-full py-6 bg-emerald-500 text-white rounded-3xl font-black text-lg uppercase tracking-widest shadow-2xl shadow-emerald-500/30 hover:scale-[1.02] active:scale-[0.98] transition-transform flex items-center justify-center gap-3"
              >
                <CheckCircle2 size={24} /> Palco Pronto
              </button>
              <button
                onClick={handleCancel}
                className="w-full py-3 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-white/5 transition-all"
              >
                Cancelar
              </button>
            </motion.div>
          )}

          {state === 'READY' && (
            <motion.div key="ready-btns" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              {next && (
                <button
                  onClick={handleNext}
                  className="w-full py-5 bg-white/10 border border-white/20 text-white rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-white/15 transition-all flex items-center justify-center gap-2"
                >
                  Próxima Apresentação <ChevronRight size={18} />
                </button>
              )}
              {!next && (
                <div className="text-center py-4">
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Última apresentação concluída 🎉</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Next presentation preview */}
      {next && (
        <div className="mx-5 mb-6 p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-3 max-w-sm w-full self-center">
          <div className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
            <Music size={14} className="text-slate-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Próxima</p>
            <p className="text-[11px] font-black uppercase text-white truncate">{next.nome_coreografia}</p>
            <p className="text-[9px] text-slate-400 truncate">{next.estudio}</p>
          </div>
          <ChevronRight size={14} className="text-slate-500 shrink-0" />
        </div>
      )}
    </div>
  );
};

export default StageMarker;
