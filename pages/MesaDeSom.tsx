import React, { useState, useEffect } from 'react';
import {
  Music, Volume2, Play, Pause, SkipForward,
  Search, Loader2, AlertCircle, Clock
} from 'lucide-react';
import { supabase } from '../services/supabase';

const MesaDeSom = () => {
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentTrack, setCurrentTrack] = useState<any | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('registrations')
        .select('*')
        .eq('status', 'APROVADA')
        .order('ordem_apresentacao', { ascending: true });

      if (error) throw error;
      setRegistrations(data || []);

      const { data: cfg } = await supabase
        .from('configuracoes')
        .select('*')
        .eq('id', 1)
        .single();

      if (cfg) setConfig(cfg);
    } catch (err) {
      console.error('Erro ao buscar cronograma:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const conflicts = React.useMemo(() => {
    const conflictMap: Record<string, { dancerName: string; otherIndex: number }[]> = {};
    const dancerPositions: Record<string, number[]> = {};
    const minInterval = config?.intervalo_seguranca || 3;

    registrations.forEach((reg, index) => {
      const elenco = reg.elenco || [];
      elenco.forEach((dancer: any) => {
        const id = dancer.cpf || dancer.name || dancer.full_name;
        if (!id) return;

        if (!dancerPositions[id]) {
          dancerPositions[id] = [];
        }
        dancerPositions[id].push(index);
      });
    });

    Object.entries(dancerPositions).forEach(([dancerId, positions]) => {
      if (positions.length < 2) return;

      for (let i = 0; i < positions.length - 1; i++) {
        const currentPos = positions[i];
        const nextPos = positions[i + 1];

        if (nextPos - currentPos < minInterval) {
          const reg1 = registrations[currentPos];
          const reg2 = registrations[nextPos];

          const dancerName = reg1.elenco.find((d: any) => (d.cpf || d.name || d.full_name) === dancerId)?.full_name || dancerId;

          if (!conflictMap[reg1.id]) conflictMap[reg1.id] = [];
          conflictMap[reg1.id].push({ dancerName, otherIndex: nextPos + 1 });

          if (!conflictMap[reg2.id]) conflictMap[reg2.id] = [];
          conflictMap[reg2.id].push({ dancerName, otherIndex: currentPos + 1 });
        }
      }
    });

    return conflictMap;
  }, [registrations, config?.intervalo_seguranca]);

  const handleAnnounce = (reg: any) => {
    if (!window.speechSynthesis) {
      alert('Seu navegador não suporta a funcionalidade de narração.');
      return;
    }

    window.speechSynthesis.cancel();

    const template = config?.texto_ia?.trim()
      || 'Com a coreografia [COREOGRAFIA], recebam no palco: [ESTUDIO]';
    const text = template
      .replaceAll('[COREOGRAFIA]', reg.nome_coreografia ?? '')
      .replaceAll('[ESTUDIO]', reg.estudio ?? '');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.9;

    window.speechSynthesis.speak(utterance);
  };

  const handlePrepare = (reg: any) => {
    setCurrentTrack(reg);
    setIsPlaying(false);
  };

  const filteredSchedule = registrations.filter(reg =>
    reg.nome_coreografia.toLowerCase().includes(searchTerm.toLowerCase()) ||
    reg.estudio.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-700 min-h-screen pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-black uppercase tracking-tight italic text-slate-900 dark:text-white">
            Mesa de <span className="text-[#ff0068]">Som</span>
          </h1>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Controle de áudio e anúncios em tempo real</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="BUSCAR COREOGRAFIA..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl py-2 pl-9 pr-4 text-[10px] font-black uppercase tracking-widest focus:outline-none focus:border-[#ff0068]/50 transition-all w-64"
            />
          </div>
        </div>
      </div>

      <div className="bg-slate-900 rounded-[2rem] p-6 border border-white/10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#ff0068]/10 blur-[80px] rounded-full -mr-32 -mt-32" />

        <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
          <div className="w-24 h-24 bg-[#ff0068]/20 rounded-3xl flex items-center justify-center text-[#ff0068] shadow-inner">
            <Music size={40} className={isPlaying ? 'animate-bounce' : ''} />
          </div>

          <div className="flex-1 text-center md:text-left space-y-2">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-[0.3em]">
                {isPlaying ? 'REPRODUZINDO AGORA' : 'AGUARDANDO COMANDO'}
              </span>
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tighter italic text-white">
              {currentTrack?.nome_coreografia || 'Nenhuma selecionada'}
            </h2>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              {currentTrack?.estudio || 'Selecione uma coreografia abaixo'}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => currentTrack && handleAnnounce(currentTrack)}
              disabled={!currentTrack}
              className="p-4 bg-white/5 text-white rounded-2xl hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              title="Anunciar com Narração IA"
            >
              <Volume2 size={24} className="group-hover:text-[#ff0068] transition-colors" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={!currentTrack}
              className="w-16 h-16 bg-[#ff0068] text-white rounded-2xl flex items-center justify-center shadow-lg shadow-[#ff0068]/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
            </button>
            <button
              className="p-4 bg-white/5 text-white rounded-2xl hover:bg-white/10 transition-all"
              title="Próxima"
            >
              <SkipForward size={24} />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-white/2">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-slate-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cronograma de Apresentações</span>
          </div>
          <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest">{filteredSchedule.length} Coreografias</span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-white/5 max-h-[500px] overflow-y-auto">
          {isLoading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 text-[#ff0068] animate-spin mx-auto mb-2" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Carregando cronograma...</p>
            </div>
          ) : filteredSchedule.length === 0 ? (
            <div className="p-12 text-center">
              <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nenhuma coreografia encontrada</p>
            </div>
          ) : (
            filteredSchedule.map((reg, index) => {
              const regConflicts = conflicts[reg.id] || [];
              return (
                <div
                  key={reg.id}
                  className={`flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-white/2 transition-colors group ${currentTrack?.id === reg.id ? 'bg-[#ff0068]/5' : ''} ${regConflicts.length > 0 ? 'bg-rose-500/5' : ''}`}
                >
                  <div className="w-8 text-[10px] font-black text-slate-400">
                    {String(index + 1).padStart(2, '0')}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className={`text-xs font-black uppercase tracking-tight truncate ${currentTrack?.id === reg.id ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
                        {reg.nome_coreografia}
                      </h4>
                      {regConflicts.length > 0 && (
                        <div className="relative group/conflict">
                          <div className="p-1 bg-rose-500 text-white rounded-full animate-bounce cursor-help">
                            <AlertCircle size={10} />
                          </div>
                          <div className="absolute left-0 bottom-full mb-2 w-48 p-2 bg-slate-900 text-white text-[8px] rounded-lg shadow-2xl opacity-0 group-hover/conflict:opacity-100 pointer-events-none transition-opacity z-50 border border-white/10">
                            <p className="font-black uppercase tracking-widest text-rose-500 mb-1">Conflito</p>
                            {regConflicts.map((c, i) => (
                              <p key={i}>Bailarino(a) {c.dancerName} em #{c.otherIndex}</p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{reg.estudio}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAnnounce(reg)}
                      className="p-2 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-xl transition-all"
                      title="Anunciar com Narração IA"
                    >
                      <Volume2 size={16} />
                    </button>
                    <button
                      onClick={() => handlePrepare(reg)}
                      className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                        currentTrack?.id === reg.id
                          ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/20'
                          : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/20'
                      }`}
                    >
                      {currentTrack?.id === reg.id ? 'No Ar' : 'Preparar'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default MesaDeSom;
