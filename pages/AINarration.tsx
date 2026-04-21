import React, { useState } from 'react';
import { Mic2, Sparkles, Copy, RefreshCw, Volume2, PlayCircle, Terminal } from 'lucide-react';
import { generateNarrationScript } from '../services/gemini';

const inputCls = 'w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-4 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm';
const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1';

const AINarration = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [formData, setFormData] = useState({
    name: 'B-Boy Nitro',
    style: 'Breaking',
    school: 'Urban Crew SP',
    achievements: 'Campeão Regional 2024',
    vibe: 'Agressiva e Energética'
  });

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const script = await generateNarrationScript(formData);
      setResult(script || '');
    } finally {
      setLoading(false);
    }
  };

  const handleSpeak = () => {
    if (!result || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  };

  const handleCopy = () => {
    if (result) navigator.clipboard.writeText(result);
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
            AI <span className="text-[#ff0068]">Voice</span> Master
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Roteiros de locução épicos via Gemini Pro
          </p>
        </div>
        <div className="px-4 py-2 bg-[#ff0068]/10 border border-[#ff0068]/20 rounded-full flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-[#ff0068] rounded-full animate-pulse shadow-[0_0_8px_#ff0068]" />
          <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest">Neural Engine Online</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form panel */}
        <div className="bg-slate-100 dark:bg-slate-900/40 p-6 rounded-3xl border border-slate-200 dark:border-white/5 space-y-5">
          <div className="flex items-center gap-3 pb-2 border-b border-slate-200 dark:border-white/5">
            <div className="w-8 h-8 rounded-xl bg-[#ff0068]/10 flex items-center justify-center text-[#ff0068]">
              <Terminal size={16} />
            </div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tighter">Prompt de Locução</h3>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Nome/Alias</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Estilo</label>
                <input
                  type="text"
                  value={formData.style}
                  onChange={e => setFormData({ ...formData, style: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Tom de Voz (Vibe)</label>
              <select
                value={formData.vibe}
                onChange={e => setFormData({ ...formData, vibe: e.target.value })}
                className={inputCls}
              >
                <option>Agressiva e Energética</option>
                <option>Mística e Profunda</option>
                <option>Clássica e Elegante</option>
                <option>Hype e Street</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full py-4 bg-[#ff0068] text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.25em] shadow-lg shadow-[#ff0068]/20 hover:scale-[1.02] transition-all flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? 'Compondo Roteiro...' : 'Gerar Locução Épica'}
          </button>
        </div>

        {/* Output panel */}
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-[#ff0068] to-[#e3ff0a] rounded-3xl blur opacity-10 group-hover:opacity-20 transition duration-1000" />
          <div className="relative h-full bg-slate-100 dark:bg-slate-950 rounded-3xl border border-slate-200 dark:border-white/10 p-6 flex flex-col min-h-[320px]">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-200 dark:border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#ff0068] rounded-full" />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Script Gerado</span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={handleCopy} className="p-2 bg-slate-200 dark:bg-white/5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all">
                  <Copy size={14} />
                </button>
                <button onClick={handleSpeak} disabled={!result} className="p-2 bg-slate-200 dark:bg-white/5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-[#ff0068] transition-all disabled:opacity-30">
                  <Volume2 size={14} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <Mic2 className="text-[#ff0068] animate-bounce" size={28} />
                  <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em] animate-pulse">Sintetizando Voz...</p>
                </div>
              ) : result ? (
                <div className="space-y-4">
                  <p className="text-sm font-bold text-slate-900 dark:text-white leading-relaxed">
                    {result}
                  </p>
                  <div className="pt-4 border-t border-slate-200 dark:border-white/5">
                    <button onClick={handleSpeak} className="flex items-center gap-2 text-[10px] font-black text-[#ff0068] uppercase tracking-widest hover:text-slate-900 dark:hover:text-white transition-all">
                      <PlayCircle size={16} /> Ouvir Preview (TTS)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                  <Mic2 size={36} className="mb-3 text-slate-400 dark:text-white" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white">Aguardando comando...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AINarration;
