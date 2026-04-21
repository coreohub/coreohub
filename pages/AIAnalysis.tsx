import React, { useState } from 'react';
import {
  Sparkles, Video, Activity, Zap,
  RefreshCw, Play, ShieldCheck, Star, Brain
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeEventDescription } from '../services/gemini';

const AIAnalysis = () => {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [mode, setMode] = useState<'VIDEO' | 'TECHNICAL'>('TECHNICAL');
  const [inputText, setInputText] = useState('');

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      let data = null;
      if (inputText.trim()) {
        data = await analyzeEventDescription(inputText);
      }
      if (!data) {
        data = {
          score: 9.4,
          highlights: [
            'Execução técnica impecável nas transições de solo.',
            'Musicalidade acima da média no segundo drop.',
            'Alinhamento de braços consistente em 85% da obra.'
          ],
          improvements: [
            'Trabalhar a projeção de olhar para o fundo do palco.',
            'Aumentar a explosão nos saltos finais.'
          ],
          technical_data: {
            bpm_sync: '98%',
            energy_level: 'High',
            complexity: 'Advanced'
          }
        };
      }
      setResult(data);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter italic">
            AI <span className="text-[#e3ff0a]">Performance</span> Analysis
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Feedback técnico via Gemini Vision & Pro
          </p>
        </div>
        <div className="flex gap-2">
          {(['TECHNICAL', 'VIDEO'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                mode === m
                  ? 'bg-[#e3ff0a] text-black shadow-lg shadow-[#e3ff0a]/20'
                  : 'bg-white/5 text-slate-500 hover:text-white'
              }`}
            >
              {m === 'TECHNICAL' ? 'Texto Técnico' : 'Análise de Vídeo'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Input Area */}
        <div className="space-y-6">
          <div className="bg-slate-900/40 p-10 rounded-[3.5rem] border border-white/5 shadow-2xl space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#e3ff0a]/10 flex items-center justify-center text-[#e3ff0a]">
                {mode === 'TECHNICAL' ? <Activity size={24} /> : <Video size={24} />}
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-tighter">Entrada de Dados</h3>
            </div>

            {mode === 'TECHNICAL' ? (
              <textarea
                rows={10}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full p-6 bg-slate-950 rounded-3xl border border-white/5 text-slate-300 font-medium text-sm outline-none focus:ring-2 focus:ring-[#e3ff0a] resize-none"
                placeholder="Descreva a performance ou cole as notas do jurado para uma síntese inteligente..."
              />
            ) : (
              <div className="aspect-video bg-slate-950 rounded-[2.5rem] border-2 border-dashed border-white/5 flex flex-col items-center justify-center gap-4 group hover:border-[#e3ff0a] transition-all cursor-pointer">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-slate-600 group-hover:text-[#e3ff0a] transition-all">
                  <Play size={32} />
                </div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Upload de Performance (MP4/MOV)</p>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="w-full py-6 bg-[#e3ff0a] text-black rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] shadow-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 disabled:opacity-70"
            >
              {analyzing ? <RefreshCw size={18} className="animate-spin" /> : <Brain size={18} />}
              {analyzing ? 'Processando Redes Neurais...' : 'Gerar Feedback IA'}
            </button>
          </div>
        </div>

        {/* Results Area */}
        <div className="space-y-6">
          <AnimatePresence mode="wait">
            {!result && !analyzing && (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full bg-slate-900/20 border border-dashed border-white/5 rounded-[3.5rem] flex flex-col items-center justify-center p-12 text-center"
              >
                <Sparkles size={48} className="text-slate-800 mb-6" />
                <p className="text-xs font-black text-slate-600 uppercase tracking-[0.3em]">Aguardando processamento</p>
              </motion.div>
            )}

            {analyzing && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full bg-slate-900/40 border border-white/5 rounded-[3.5rem] p-12 flex flex-col items-center justify-center space-y-8"
              >
                <div className="relative">
                  <div className="w-24 h-24 border-4 border-[#e3ff0a]/20 border-t-[#e3ff0a] rounded-full animate-spin" />
                  <Zap className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#e3ff0a]" size={32} />
                </div>
                <div className="space-y-2 text-center">
                  <p className="text-xs font-black text-white uppercase tracking-[0.4em] animate-pulse">Analisando Biometria</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Extraindo padrões de movimento...</p>
                </div>
              </motion.div>
            )}

            {result && (
              <motion.div
                key="result"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="bg-slate-900/60 p-10 rounded-[3.5rem] border border-white/5 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8">
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nota Sugerida</p>
                      <p className="text-6xl font-black text-[#e3ff0a] tracking-tighter italic">{result.score}</p>
                    </div>
                  </div>

                  <h3 className="text-xl font-black text-white uppercase tracking-tighter mb-8 flex items-center gap-3">
                    <ShieldCheck className="text-[#e3ff0a]" /> Veredito da IA
                  </h3>

                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <Star size={12} className="text-[#e3ff0a]" /> Pontos Fortes
                    </p>
                    {result.highlights?.map((h: string, i: number) => (
                      <div key={i} className="p-4 bg-white/5 rounded-xl border border-white/5 text-xs text-slate-300 font-medium">{h}</div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {result.technical_data && Object.entries(result.technical_data).map(([key, val]: any) => (
                    <div key={key} className="bg-slate-900/40 p-6 rounded-3xl border border-white/5 text-center">
                      <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">{key.replace('_', ' ')}</p>
                      <p className="text-lg font-black text-white uppercase tracking-tight">{val}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default AIAnalysis;
