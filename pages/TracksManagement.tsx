import React, { useEffect, useState, useRef } from 'react';
import {
  Search, RefreshCw,
  AlertCircle, Play, Mic, Loader2, Sparkles
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { motion, AnimatePresence } from 'motion/react';

const TracksManagement = () => {
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [filteredRegistrations, setFilteredRegistrations] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [currentTrack, setCurrentTrack] = useState<any | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isCounting, setIsCounting] = useState(false);
  const [isAnnouncing, setIsAnnouncing] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const countdownInterval = useRef<NodeJS.Timeout | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: regs } = await supabase
        .from('registrations')
        .select('*')
        .eq('status_trilha', 'ENVIADA')
        .order('criado_em', { ascending: true });
      setRegistrations(regs || []);
      setFilteredRegistrations(regs || []);

      const { data: cfg } = await supabase.from('configuracoes').select('*').eq('id', 1).single();
      setConfig(cfg || { tempo_entrada: 15 });
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (isCounting && countdown > 0) {
      countdownInterval.current = setInterval(() => setCountdown(prev => prev - 1), 1000);
    } else if (countdown === 0 && isCounting) {
      setIsCounting(false);
      if (audioRef.current) { audioRef.current.play(); setIsPlaying(true); }
    }
    return () => { if (countdownInterval.current) clearInterval(countdownInterval.current); };
  }, [isCounting, countdown]);

  const handleAnnounce = () => {
    if (!currentTrack) return;
    setIsAnnouncing(true);
    const utterance = new SpeechSynthesisUtterance(`Com a coreografia ${currentTrack.nome_coreografia}, recebam no palco: ${currentTrack.estudio}`);
    utterance.lang = 'pt-BR';
    utterance.onend = () => {
      setIsAnnouncing(false);
      setCountdown(config?.tempo_entrada || 15);
      setIsCounting(true);
    };
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-48">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic">
          Gestão de <span className="text-[#ff0068]">Sonoplastia</span>
        </h1>
        <button onClick={fetchData} className="p-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-600 dark:text-slate-400 hover:text-[#ff0068] transition-all">
          <RefreshCw size={20} />
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-4 rounded-3xl shadow-sm">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar coreografia..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl text-sm font-bold"
          />
        </div>
      </div>

      <div className="space-y-3">
        {filteredRegistrations.map((reg) => (
          <div key={reg.id} className={`flex items-center gap-4 p-5 rounded-[2rem] border transition-all ${currentTrack?.id === reg.id ? 'bg-[#ff0068]/5 border-[#ff0068]' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/5'}`}>
            <div className="flex-1">
              <h3 className="text-sm font-black uppercase tracking-tight">{reg.nome_coreografia}</h3>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{reg.estudio}</p>
            </div>
            <button onClick={() => setCurrentTrack(reg)} className="px-4 py-2 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-[#ff0068] hover:text-white transition-all">
              Preparar
            </button>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {isCounting && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center">
            <motion.div key={countdown} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-[200px] font-black text-white italic">{countdown}</motion.div>
            <span className="text-[#ff0068] text-xl font-black uppercase tracking-[0.5em] animate-pulse">Entrada em Palco</span>
          </motion.div>
        )}
      </AnimatePresence>

      {currentTrack && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 p-6 shadow-2xl">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#ff0068] rounded-xl flex items-center justify-center text-white"><Sparkles size={24} /></div>
              <div>
                <h4 className="text-sm font-black uppercase italic">{currentTrack.nome_coreografia}</h4>
                <p className="text-[9px] font-bold text-[#ff0068] uppercase">{currentTrack.estudio}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={handleAnnounce} className="px-6 py-3 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20"><Mic size={18} /></button>
              <button onClick={() => { if (isPlaying) audioRef.current?.pause(); else audioRef.current?.play(); setIsPlaying(!isPlaying); }} className="p-4 bg-emerald-500 text-white rounded-xl"><Play size={20} /></button>
            </div>
            <audio ref={audioRef} src={currentTrack.trilha_url} className="hidden" />
          </div>
        </div>
      )}
    </div>
  );
};

export default TracksManagement;
