import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import {
  Headphones, RefreshCw, Loader2, CheckCircle2,
  AlertTriangle, Wifi, WifiOff, Monitor, User,
  CircleDot, Clock,
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

  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: judgesData }, { data: schedule }] = await Promise.all([
        supabase.from('judges').select('id,name,avatar_url,is_active,competencias_generos,competencias_formatos,pin').order('name'),
        supabase
          .from('registrations')
          .select('nome_coreografia,estilo_danca,ordem_apresentacao')
          .eq('status_pagamento', 'CONFIRMADO')
          .order('ordem_apresentacao', { ascending: true })
          .limit(1),
      ]);

      const list: Judge[] = judgesData || [];
      setJudges(list);

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

      if (schedule && schedule.length > 0) {
        setCurrentPresentation(schedule[0].nome_coreografia || '');
        setCurrentStyle(schedule[0].estilo_danca || '');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
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
          <button onClick={fetchData} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Em julgamento agora */}
      {(currentPresentation || currentStyle) && (
        <div className="bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-3xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-[#ff0068]/10 rounded-2xl flex items-center justify-center shrink-0">
            <CircleDot size={18} className="text-[#ff0068] animate-pulse" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068] mb-0.5">Em julgamento agora</p>
            <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight">{currentPresentation || '—'}</p>
            {currentStyle && <p className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">{currentStyle}</p>}
          </div>
        </div>
      )}

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
