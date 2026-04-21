import React, { useState, useEffect } from 'react';
import { Swords, Timer, Music, Trophy, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../services/supabase';

const BattleArenaLive = () => {
  const [activeMatch, setActiveMatch] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isPaused, setIsPaused] = useState(true);

  useEffect(() => {
    setActiveMatch({
      p1: { name: 'B-Boy Nitro', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Nitro', votes: 2 },
      p2: { name: 'B-Girl Storm', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Storm', votes: 1 },
      phase: 'Quartas de Final',
      category: 'Breaking Solo Pro'
    });
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (!isPaused && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isPaused, timeLeft]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-slate-950 text-white overflow-hidden flex flex-col p-8 lg:p-16">
      {/* Background Effects */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#ff0068] rounded-full blur-[150px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#e3ff0a] rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Header Info */}
      <div className="relative z-10 flex justify-between items-start mb-12">
        <div className="flex items-center gap-8">
          <div className="p-6 bg-[#ff0068] rounded-[2rem] shadow-[0_0_50px_rgba(255,0,104,0.4)] animate-bounce">
            <Swords size={48} />
          </div>
          <div>
            <h1 className="text-6xl font-black uppercase tracking-tighter italic leading-none">
              Arena <span className="text-[#ff0068]">Live</span>
            </h1>
            <div className="flex items-center gap-4 mt-2">
              <span className="px-4 py-1 bg-white/10 rounded-full text-[12px] font-black uppercase tracking-widest">
                {activeMatch?.category}
              </span>
              <span className="text-[#ff0068] text-[12px] font-black uppercase tracking-widest flex items-center gap-2">
                <div className="w-2 h-2 bg-[#ff0068] rounded-full animate-ping" /> {activeMatch?.phase}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-4">
          <div className={`px-12 py-6 rounded-[2.5rem] border-4 flex items-center gap-6 transition-all ${
            timeLeft < 10 ? 'border-rose-500 bg-rose-500/20 animate-pulse' : 'border-white/10 bg-white/5'
          }`}>
            <Timer size={40} className={timeLeft < 10 ? 'text-rose-500' : 'text-[#e3ff0a]'} />
            <span className="text-7xl font-black font-mono tracking-tighter">{formatTime(timeLeft)}</span>
          </div>
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="px-8 py-3 bg-white/10 hover:bg-white/20 rounded-full text-[10px] font-black uppercase tracking-widest transition-all"
          >
            {isPaused ? 'Iniciar Round' : 'Pausar Round'}
          </button>
        </div>
      </div>

      {/* Main Stage */}
      <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-7 gap-12 items-center">
        {/* Player 1 */}
        <div className="lg:col-span-3 flex flex-col items-center gap-10 group">
          <motion.div initial={{ x: -100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="relative">
            <div className="w-80 h-80 rounded-[5rem] bg-slate-900 border-8 border-[#ff0068] overflow-hidden shadow-[0_0_100px_rgba(255,0,104,0.3)] group-hover:scale-105 transition-all duration-700">
              <img src={activeMatch?.p1.avatar} className="w-full h-full object-cover" alt={activeMatch?.p1.name} />
            </div>
            <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-[#ff0068] rounded-3xl flex items-center justify-center text-4xl font-black italic shadow-2xl">A</div>
          </motion.div>
          <div className="text-center space-y-2">
            <h2 className="text-7xl font-black uppercase tracking-tighter italic text-white">{activeMatch?.p1.name}</h2>
            <div className="flex justify-center gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className={`w-12 h-3 rounded-full ${i < (activeMatch?.p1.votes || 0) ? 'bg-[#ff0068] shadow-[0_0_15px_#ff0068]' : 'bg-white/10'}`} />
              ))}
            </div>
          </div>
        </div>

        {/* VS Divider */}
        <div className="lg:col-span-1 flex flex-col items-center justify-center gap-6">
          <div className="w-32 h-32 rounded-full bg-white/5 border-2 border-white/10 flex items-center justify-center text-5xl font-black italic text-slate-700 shadow-2xl">VS</div>
          <div className="h-40 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
        </div>

        {/* Player 2 */}
        <div className="lg:col-span-3 flex flex-col items-center gap-10 group">
          <motion.div initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="relative">
            <div className="w-80 h-80 rounded-[5rem] bg-slate-900 border-8 border-[#e3ff0a] overflow-hidden shadow-[0_0_100px_rgba(227,255,10,0.3)] group-hover:scale-105 transition-all duration-700">
              <img src={activeMatch?.p2.avatar} className="w-full h-full object-cover" alt={activeMatch?.p2.name} />
            </div>
            <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-[#e3ff0a] text-black rounded-3xl flex items-center justify-center text-4xl font-black italic shadow-2xl">B</div>
          </motion.div>
          <div className="text-center space-y-2">
            <h2 className="text-7xl font-black uppercase tracking-tighter italic text-white">{activeMatch?.p2.name}</h2>
            <div className="flex justify-center gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className={`w-12 h-3 rounded-full ${i < (activeMatch?.p2.votes || 0) ? 'bg-[#e3ff0a] shadow-[0_0_15px_#e3ff0a]' : 'bg-white/10'}`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Stats */}
      <div className="relative z-10 h-40 bg-white/5 backdrop-blur-xl rounded-[3rem] border border-white/10 flex items-center justify-around px-20 mt-12">
        <div className="flex items-center gap-6">
          <Music className="text-[#e3ff0a]" size={40} />
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">DJ On Deck</p>
            <p className="text-2xl font-black uppercase tracking-tight">Classic Breakbeats Vol. 4</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <Users className="text-[#ff0068]" size={40} />
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Público Live</p>
            <p className="text-2xl font-black uppercase tracking-tight">1,240 Pessoas</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <Trophy className="text-[#e3ff0a]" size={40} />
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Premiação</p>
            <p className="text-2xl font-black uppercase tracking-tight">R$ 5.000,00</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BattleArenaLive;
