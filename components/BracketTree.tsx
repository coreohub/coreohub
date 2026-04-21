import React from 'react';
import { Trophy } from 'lucide-react';
import { motion } from 'motion/react';

interface Match {
  id: string;
  p1: { name: string; avatar: string };
  p2: { name: string; avatar: string };
  winner?: string;
  status: 'pending' | 'active' | 'finished';
}

interface BracketTreeProps {
  matches?: Match[];
}

const BracketTree: React.FC<BracketTreeProps> = ({ matches }) => {
  const defaultMatches: Match[] = [
    { id: '1', p1: { name: 'Nitro', avatar: '' }, p2: { name: 'Storm', avatar: '' }, status: 'active' },
    { id: '2', p1: { name: 'Lil Zoo', avatar: '' }, p2: { name: 'Ami', avatar: '' }, status: 'pending' },
  ];

  const data = matches || defaultMatches;

  return (
    <div className="flex flex-col gap-12 py-10">
      {data.map((match, idx) => (
        <motion.div
          key={match.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.1 }}
          className="relative flex items-center gap-10 group"
        >
          {/* Match Label */}
          <div className="absolute -top-5 left-8 bg-slate-900 border border-white/10 px-4 py-1 rounded-full text-[8px] font-black text-[#e3ff0a] uppercase tracking-[0.2em] z-10 shadow-xl">
            Confronto #{idx + 1}
          </div>

          {/* Match Card */}
          <div className={`flex-1 bg-slate-900/80 rounded-[2.5rem] border-2 transition-all overflow-hidden shadow-2xl ${
            match.status === 'active'
              ? 'border-[#ff0068] ring-4 ring-[#ff0068]/20'
              : match.status === 'finished'
              ? 'border-emerald-500/30'
              : 'border-white/5'
          }`}>
            {/* Player A */}
            <div className="p-6 flex items-center justify-between border-b border-white/5 hover:bg-white/5 transition-all cursor-pointer">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center font-black italic ${
                  match.winner === match.p1.name ? 'text-[#e3ff0a] border-[#e3ff0a]/30' : 'text-[#ff0068]'
                }`}>
                  A
                </div>
                <span className={`text-sm font-black uppercase tracking-tight ${
                  match.winner === match.p1.name ? 'text-[#e3ff0a]' : 'text-white'
                }`}>
                  {match.p1.name}
                </span>
                {match.winner === match.p1.name && (
                  <Trophy size={14} className="text-[#e3ff0a]" />
                )}
              </div>
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-black text-slate-500">
                {match.status === 'finished' && match.winner === match.p1.name ? '✓' : '0'}
              </div>
            </div>

            {/* VS Divider */}
            <div className="h-px bg-white/5 relative">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-3 text-[7px] font-black text-slate-700 italic tracking-widest">
                VS
              </div>
            </div>

            {/* Player B */}
            <div className="p-6 flex items-center justify-between hover:bg-white/5 transition-all cursor-pointer">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center font-black italic ${
                  match.winner === match.p2.name ? 'text-[#e3ff0a] border-[#e3ff0a]/30' : 'text-[#e3ff0a]'
                }`}>
                  B
                </div>
                <span className={`text-sm font-black uppercase tracking-tight ${
                  match.winner === match.p2.name ? 'text-[#e3ff0a]' : 'text-white'
                }`}>
                  {match.p2.name}
                </span>
                {match.winner === match.p2.name && (
                  <Trophy size={14} className="text-[#e3ff0a]" />
                )}
              </div>
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-black text-slate-500">
                {match.status === 'finished' && match.winner === match.p2.name ? '✓' : '0'}
              </div>
            </div>
          </div>

          {/* Connectors */}
          <div className="w-24 flex items-center relative">
            <div className="h-px w-full bg-white/10" />
            <div className={`absolute right-0 w-3 h-3 rounded-full shadow-lg ${
              match.status === 'active'
                ? 'bg-[#ff0068] shadow-[0_0_10px_#ff0068]'
                : match.status === 'finished'
                ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]'
                : 'bg-white/20'
            }`} />
          </div>

          {/* Next Round Slot */}
          <div className="w-56 h-32 border-2 border-dashed border-white/5 rounded-[3rem] flex flex-col items-center justify-center bg-white/5 group-hover:border-[#e3ff0a]/30 transition-all">
            <Trophy size={24} className="text-slate-800 group-hover:text-[#e3ff0a] transition-all mb-2" />
            <span className="text-[8px] font-black uppercase text-slate-700 tracking-widest">Avança para Semifinal</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

export default BracketTree;
