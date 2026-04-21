import React, { useState } from 'react';
import { UserPlus, Award, Settings, ShieldCheck, Fingerprint, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const JudgeManagement = () => {
  const [showManager, setShowManager] = useState(false);
  const [selectedJudge, setSelectedJudge] = useState<any>(null);

  const judges = [
    { id: 1, name: 'Carlos Mendes', specialty: 'Jazz / Urbanas', status: 'online' },
    { id: 2, name: 'Juliana Silveira', specialty: 'Ballet Clássico', status: 'online' },
    { id: 3, name: 'Rodrigo Souza', specialty: 'Contemporâneo', status: 'offline' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tighter uppercase leading-none">Banca de <span className="text-[#ff0068]">Jurados</span></h1>
          <p className="text-slate-500 font-medium text-sm mt-2">Terminais técnicos e competências de avaliação.</p>
        </div>
        <button className="bg-[#ff0068] text-white px-10 py-4 rounded-[2rem] font-black text-[10px] uppercase tracking-widest flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-[#ff0068]/30">
          <UserPlus size={20} /> Convidar Jurado
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {judges.map(judge => (
          <div key={judge.id} className="bg-slate-900/40 p-8 rounded-[3rem] border border-white/5 flex flex-col items-center text-center group hover:border-[#ff0068] transition-all relative overflow-hidden shadow-2xl">
            <div className="absolute top-6 right-6">
              <div className={`w-2 h-2 rounded-full animate-pulse ${judge.status === 'online' ? 'bg-[#e3ff0a] shadow-[0_0_10px_#e3ff0a]' : 'bg-slate-700'}`} />
            </div>
            <div className="w-24 h-24 rounded-[2.5rem] bg-slate-950 mb-4 overflow-hidden border-4 border-slate-900 shadow-2xl">
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${judge.name}`} alt={judge.name} />
            </div>
            <h3 className="font-black text-white mb-1 uppercase tracking-tight">{judge.name}</h3>
            <span className="px-3 py-1 bg-white/5 rounded-full text-[8px] font-black text-slate-500 uppercase tracking-widest mb-6">Terminal: J-{judge.id}</span>

            <div className="w-full bg-slate-950/50 p-4 rounded-2xl border border-white/5 mb-6 text-left">
              <span className="block text-[7px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1"><Fingerprint size={10} /> Competências</span>
              <div className="flex flex-wrap gap-1">
                {judge.specialty.split(' / ').map(tag => (
                  <span key={tag} className="text-[8px] font-black bg-[#ff0068]/10 text-[#ff0068] px-2 py-1 rounded-md uppercase">{tag}</span>
                ))}
              </div>
            </div>

            <button
              onClick={() => { setSelectedJudge(judge); setShowManager(true); }}
              className="w-full py-4 bg-slate-950 text-white rounded-2xl hover:bg-[#ff0068] transition-all text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
            >
              <Settings size={14} /> Atribuir Categorias
            </button>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {showManager && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowManager(false)} className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-2xl bg-slate-900 rounded-[3.5rem] border border-white/5 overflow-hidden shadow-2xl">
              <div className="p-10 border-b border-white/5 flex justify-between items-center bg-white/5">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 rounded-3xl bg-[#ff0068] flex items-center justify-center text-white shadow-xl shadow-[#ff0068]/20"><Award size={32} /></div>
                  <div>
                    <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Assinatura Técnica</h2>
                    <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest">{selectedJudge?.name}</p>
                  </div>
                </div>
                <button onClick={() => setShowManager(false)} className="p-4 hover:bg-white/5 rounded-2xl transition-all"><X size={24} className="text-slate-500" /></button>
              </div>
              <div className="p-10 space-y-8">
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Categorias Autorizadas</label>
                  <div className="flex flex-wrap gap-2">
                    {['Infantil', 'Júnior', 'Adulto', 'Profissional'].map(cat => (
                      <button key={cat} className="px-4 py-2 bg-slate-950 border border-white/5 rounded-xl text-[10px] font-black text-slate-400 uppercase hover:border-[#ff0068] hover:text-white transition-all">{cat}</button>
                    ))}
                  </div>
                </div>
                <div className="p-6 bg-[#ff0068]/5 border border-[#ff0068]/10 rounded-2xl flex gap-4 items-start">
                  <ShieldCheck className="text-[#ff0068] shrink-0" size={24} />
                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed uppercase">Este jurado só poderá avaliar coreografias das categorias selecionadas. O terminal será bloqueado automaticamente para outras categorias.</p>
                </div>
                <button onClick={() => setShowManager(false)} className="w-full py-6 bg-[#ff0068] text-white rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl hover:scale-[1.02] transition-all">Confirmar Banca Técnica</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default JudgeManagement;
