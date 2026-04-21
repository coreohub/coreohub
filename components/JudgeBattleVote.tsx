import React, { useState } from 'react';
import { Check, UserCheck } from 'lucide-react';

interface JudgeBattleVoteProps {
  match: { p1: { name: string }; p2: { name: string } };
  onConfirm: (winner: 'A' | 'B' | 'TIE') => void;
  allowTie?: boolean;
}

const JudgeBattleVote: React.FC<JudgeBattleVoteProps> = ({ match, onConfirm, allowTie = true }) => {
  const [selection, setSelection] = useState<'A' | 'B' | 'TIE' | null>(null);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#020617] p-10 gap-10 overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#ff0068] via-white/10 to-[#ff0068]" />

      <div className="flex items-center justify-center gap-20 py-8">
        <div className="text-center">
          <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em] mb-2">Lado Esquerdo</p>
          <div className="px-6 py-2 bg-[#ff0068]/10 border border-[#ff0068]/20 rounded-full text-[#ff0068] text-xs font-black uppercase">PLAYER A</div>
        </div>
        <div className="w-20 h-20 bg-white/5 rounded-full border border-white/10 flex items-center justify-center text-slate-500 font-black italic shadow-2xl">VS</div>
        <div className="text-center">
          <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em] mb-2">Lado Direito</p>
          <div className="px-6 py-2 bg-[#ff0068]/10 border border-[#ff0068]/20 rounded-full text-[#ff0068] text-xs font-black uppercase">PLAYER B</div>
        </div>
      </div>

      <div className="flex-1 flex gap-10">
        <button
          onClick={() => setSelection('A')}
          className={`flex-1 flex flex-col items-center justify-center gap-10 rounded-[5rem] border-4 transition-all relative ${
            selection === 'A'
              ? 'bg-[#ff0068] border-white shadow-[0_0_120px_rgba(255,0,104,0.4)] scale-[1.03]'
              : 'bg-white/5 border-white/5 hover:border-[#ff0068]/40'
          }`}
        >
          <div className="w-56 h-56 rounded-[4rem] bg-slate-900 border-8 border-white/5 overflow-hidden shadow-2xl">
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${match.p1.name}`} className="w-full h-full" alt={match.p1.name} />
          </div>
          <div className="text-center">
            <h4 className={`text-5xl font-black uppercase tracking-tighter mb-2 ${selection === 'A' ? 'text-slate-950' : 'text-white'}`}>{match.p1.name}</h4>
            <span className={`text-xs font-black uppercase tracking-[0.5em] ${selection === 'A' ? 'text-slate-900/50' : 'text-slate-500'}`}>RED SIDE / A</span>
          </div>
          {selection === 'A' && (
            <div className="absolute top-10 right-10 bg-white p-6 rounded-[2.5rem] text-[#ff0068] shadow-2xl animate-in zoom-in">
              <UserCheck size={48} />
            </div>
          )}
        </button>

        <button
          onClick={() => setSelection('B')}
          className={`flex-1 flex flex-col items-center justify-center gap-10 rounded-[5rem] border-4 transition-all relative ${
            selection === 'B'
              ? 'bg-[#ff0068] border-white shadow-[0_0_120px_rgba(255,0,104,0.4)] scale-[1.03]'
              : 'bg-white/5 border-white/5 hover:border-[#ff0068]/40'
          }`}
        >
          <div className="w-56 h-56 rounded-[4rem] bg-slate-900 border-8 border-white/5 overflow-hidden shadow-2xl">
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${match.p2.name}`} className="w-full h-full" alt={match.p2.name} />
          </div>
          <div className="text-center">
            <h4 className="text-5xl font-black uppercase tracking-tighter mb-2 text-white">{match.p2.name}</h4>
            <span className={`text-xs font-black uppercase tracking-[0.5em] ${selection === 'B' ? 'text-white/60' : 'text-slate-500'}`}>BLUE SIDE / B</span>
          </div>
          {selection === 'B' && (
            <div className="absolute top-10 right-10 bg-white p-6 rounded-[2.5rem] text-[#ff0068] shadow-2xl animate-in zoom-in">
              <UserCheck size={48} />
            </div>
          )}
        </button>
      </div>

      <div className="h-40 flex items-center justify-center gap-8 mt-4">
        {allowTie && (
          <button
            onClick={() => setSelection('TIE')}
            className={`h-full px-16 rounded-[3rem] border-4 font-black text-sm uppercase tracking-[0.4em] transition-all ${
              selection === 'TIE'
                ? 'bg-[#e3ff0a] border-white text-slate-950 shadow-2xl'
                : 'bg-white/5 border-white/5 text-slate-500 hover:text-white'
            }`}
          >
            Empate (Tie)
          </button>
        )}
        <button
          disabled={!selection}
          onClick={() => selection && onConfirm(selection)}
          className={`h-full px-32 rounded-[3.5rem] font-black text-sm uppercase tracking-[0.6em] shadow-2xl transition-all flex items-center gap-6 ${
            selection
              ? 'bg-[#e3ff0a] text-slate-950 hover:scale-105'
              : 'bg-white/5 text-slate-800 border border-white/5 cursor-not-allowed opacity-30'
          }`}
        >
          {selection ? 'Confirmar Veredito' : 'Escolha o Vencedor'} {selection && <Check size={28} />}
        </button>
      </div>
    </div>
  );
};

export default JudgeBattleVote;
