import React, { useState } from 'react';
import { Swords, Settings2, Save, LayoutGrid, Zap, Shuffle } from 'lucide-react';
import { motion } from 'motion/react';

const BattleConfig = () => {
  const [config, setConfig] = useState({
    rounds: 3,
    round_time: 60,
    judges_count: 3,
    bracket_type: 'SINGLE_ELIMINATION',
    participants_count: 16
  });

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter italic">
            Battle <span className="text-[#e3ff0a]">Engine</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Configuração do motor de batalhas
          </p>
        </div>
        <button className="px-8 py-4 bg-[#e3ff0a] text-black rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2 shadow-xl shadow-[#e3ff0a]/20">
          <Save size={18} /> Salvar Configuração
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Settings Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/40 p-8 rounded-[3rem] border border-white/5 space-y-8">
            <div className="flex items-center gap-3">
              <Settings2 className="text-[#e3ff0a]" size={20} />
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Parâmetros Técnicos</h3>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-1 flex justify-between">
                  <span>Rounds por Batalha</span>
                  <span className="text-[#e3ff0a]">{config.rounds}</span>
                </label>
                <input
                  type="range" min="1" max="5"
                  value={config.rounds}
                  onChange={e => setConfig({ ...config, rounds: parseInt(e.target.value) })}
                  className="w-full accent-[#e3ff0a]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-1 flex justify-between">
                  <span>Tempo por Round (Seg)</span>
                  <span className="text-[#e3ff0a]">{config.round_time}s</span>
                </label>
                <input
                  type="range" min="30" max="120" step="15"
                  value={config.round_time}
                  onChange={e => setConfig({ ...config, round_time: parseInt(e.target.value) })}
                  className="w-full accent-[#e3ff0a]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-1">Número de Jurados</label>
                <div className="flex gap-2">
                  {[3, 5, 7].map(n => (
                    <button
                      key={n}
                      onClick={() => setConfig({ ...config, judges_count: n })}
                      className={`flex-1 py-3 rounded-xl font-black text-xs transition-all ${
                        config.judges_count === n
                          ? 'bg-[#e3ff0a] text-black'
                          : 'bg-slate-950 text-slate-500 border border-white/5'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#ff0068]/5 border border-[#ff0068]/10 p-8 rounded-[3rem] space-y-4">
            <div className="flex items-center gap-3 text-[#ff0068]">
              <Zap size={20} />
              <h3 className="text-sm font-black uppercase tracking-widest">Quick Actions</h3>
            </div>
            <button className="w-full py-4 bg-slate-950 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest border border-white/5 hover:border-[#ff0068] transition-all flex items-center justify-center gap-2">
              <Shuffle size={16} /> Sortear Chaves Aleatórias
            </button>
            <button className="w-full py-4 bg-slate-950 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest border border-white/5 hover:border-[#ff0068] transition-all flex items-center justify-center gap-2">
              <LayoutGrid size={16} /> Resetar Torneio
            </button>
          </div>
        </div>

        {/* Preview Panel */}
        <div className="lg:col-span-2 bg-slate-900/40 rounded-[4rem] border border-white/5 p-12 flex flex-col items-center justify-center text-center space-y-6">
          <div className="w-24 h-24 rounded-[2.5rem] bg-white/5 flex items-center justify-center text-slate-700">
            <LayoutGrid size={48} />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Preview do Chaveamento</h3>
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">
              O sistema gerará uma chave de {config.participants_count} participantes
            </p>
          </div>
          <div className="w-full max-w-md p-6 bg-slate-950 rounded-3xl border border-white/5 flex justify-between items-center">
            <div className="text-left">
              <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Formato Atual</p>
              <p className="text-sm font-black text-[#e3ff0a] uppercase tracking-tight">Eliminação Simples</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Total de Lutas</p>
              <p className="text-sm font-black text-white uppercase tracking-tight">{config.participants_count - 1} Confrontos</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 w-full max-w-md mt-4">
            <div className="p-4 bg-slate-950 rounded-2xl border border-white/5 text-center">
              <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest mb-1">Rounds</p>
              <p className="text-2xl font-black text-[#e3ff0a]">{config.rounds}</p>
            </div>
            <div className="p-4 bg-slate-950 rounded-2xl border border-white/5 text-center">
              <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest mb-1">Seg/Round</p>
              <p className="text-2xl font-black text-[#e3ff0a]">{config.round_time}</p>
            </div>
            <div className="p-4 bg-slate-950 rounded-2xl border border-white/5 text-center">
              <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest mb-1">Jurados</p>
              <p className="text-2xl font-black text-[#e3ff0a]">{config.judges_count}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BattleConfig;
