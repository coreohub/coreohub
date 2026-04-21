import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, ArrowLeft, Trophy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const JudgePractice = () => {
  const navigate = useNavigate();
  const [comment, setComment] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [activeCriterion, setActiveCriterion] = useState(0);

  const criteria = [
    { id: 1, name: 'Técnica',      weight: 3, description: 'Precisão dos movimentos, alinhamento e controle corporal.' },
    { id: 2, name: 'Performance',  weight: 3, description: 'Expressão, carisma e conexão com o público.' },
    { id: 3, name: 'Musicalidade', weight: 2, description: 'Sincronia com a trilha, ritmo e interpretação musical.' },
    { id: 4, name: 'Figurino',     weight: 1, description: 'Adequação do figurino ao estilo e à proposta artística.' },
    { id: 5, name: 'Composição',   weight: 1, description: 'Criatividade coreográfica e uso do espaço cênico.' },
  ];

  const [scores, setScores] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  const totalScore = Object.entries(scores).reduce((acc, [id, val]) => {
    const criterion = criteria.find(c => c.id === Number(id));
    return acc + (val * (criterion?.weight || 1));
  }, 0) / totalWeight;

  const handleReset = () => {
    setScores({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    setComment('');
    setIsSubmitted(false);
    setActiveCriterion(0);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-4 bg-white/5 rounded-2xl hover:bg-white/10 transition-all">
              <ArrowLeft size={20} />
            </button>
            <div>
              <span className="px-2 py-0.5 bg-[#ff0068]/20 text-[#ff0068] text-[10px] font-black uppercase tracking-widest rounded-full">Modo Treinamento</span>
              <h1 className="text-3xl font-black uppercase tracking-tight">Prática de Julgamento</h1>
            </div>
          </div>
          <div className="flex items-center gap-6 p-6 bg-white/5 rounded-[2.5rem] border border-white/10">
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nota Final</p>
              <p className="text-3xl font-black text-[#ff0068]">{totalScore.toFixed(1)}</p>
            </div>
            <button onClick={handleReset} className="p-3 text-slate-400 hover:text-white transition-all">
              <RotateCcw size={20} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-4">
            {criteria.map((crit, index) => (
              <div
                key={crit.id}
                onClick={() => setActiveCriterion(index)}
                className={`p-6 rounded-[2rem] border transition-all cursor-pointer ${activeCriterion === index ? 'bg-[#ff0068]/10 border-[#ff0068]/30' : 'bg-white/5 border-white/5'}`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-black uppercase tracking-widest text-white">{crit.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{crit.description}</p>
                  </div>
                  <p className="text-2xl font-black text-[#ff0068]">{scores[crit.id] || 0}</p>
                </div>
                {activeCriterion === index && (
                  <input
                    type="range" min="0" max="10" step="0.1"
                    value={scores[crit.id]}
                    onChange={(e) => setScores({ ...scores, [crit.id]: Number(e.target.value) })}
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none accent-[#ff0068]"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="space-y-6">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Escreva suas observações técnicas..."
              className="w-full h-64 p-6 bg-white/5 rounded-[2rem] border border-white/5 text-white outline-none focus:ring-2 focus:ring-[#ff0068] transition-all resize-none"
            />
            <button
              onClick={() => setIsSubmitted(true)}
              className="w-full py-6 bg-[#ff0068] text-white rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] hover:scale-105 transition-all shadow-2xl shadow-[#ff0068]/20"
            >
              Simular Envio <Play size={18} className="inline ml-2" />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isSubmitted && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-black/90 backdrop-blur-xl z-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-900 p-10 rounded-[3rem] border border-white/10 text-center space-y-6">
              <div className="w-20 h-20 bg-[#e3ff0a]/20 text-[#e3ff0a] rounded-[2rem] flex items-center justify-center mx-auto">
                <Trophy size={40} />
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tight">Excelente Trabalho!</h2>
              <p className="text-slate-400">Você concluiu a simulação. Nota final: {totalScore.toFixed(1)}</p>
              <button onClick={handleReset} className="w-full py-5 bg-[#ff0068] text-white rounded-2xl font-black text-xs uppercase tracking-widest">
                Praticar Novamente
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default JudgePractice;
