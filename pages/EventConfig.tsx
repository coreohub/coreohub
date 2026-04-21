import React, { useState, useEffect } from 'react';
import {
  Settings2, Trophy, DollarSign,
  Sparkles, Save, Loader2, ChevronRight, ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';

const STEPS = [
  { id: 1, label: 'Geral', icon: Settings2 },
  { id: 2, label: 'Lotes e Preços', icon: DollarSign },
  { id: 3, label: 'Categorias', icon: Trophy },
  { id: 4, label: 'Automação', icon: Sparkles },
];

const EventConfig = () => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<any>({
    name: '',
    default_penalty: 0.5,
    registration_deadline: '',
    price_lote_1: 0,
    price_lote_2: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      const { data } = await supabase.from('events').select('*').eq('id', '1').single();
      if (data) setConfig(data);
      setLoading(false);
    };
    fetchData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await supabase.from('events').update(config).eq('id', '1');
      alert('Configurações salvas!');
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tighter uppercase leading-none">Setup do <span className="text-[#ff0068]">Evento</span></h1>
          <p className="text-slate-500 font-medium text-sm mt-2">Configurações técnicas e financeiras.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 hover:bg-[#ff0068] transition-all border border-white/5"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} Salvar Setup
        </button>
      </header>

      <div className="flex justify-between relative px-4 py-8">
        <div className="absolute top-1/2 left-0 w-full h-px bg-white/5 -translate-y-1/2 z-0" />
        {STEPS.map((s) => (
          <div key={s.id} className="relative z-10 flex flex-col items-center">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border-2 transition-all duration-500 ${step === s.id ? 'bg-[#ff0068] text-white border-slate-950 scale-125 shadow-lg shadow-[#ff0068]/20' : 'bg-slate-950 text-slate-700 border-white/5'}`}>
              <s.icon size={20} />
            </div>
          </div>
        ))}
      </div>

      <main className="bg-slate-900/40 p-10 md:p-14 rounded-[4rem] border border-white/5 shadow-2xl min-h-[400px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="text-[#ff0068] animate-spin" size={40} />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sincronizando Cloud...</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10">
              {step === 1 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Nome do Evento</label>
                    <input type="text" value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} className="w-full p-6 bg-slate-950 rounded-3xl border border-white/5 text-white font-bold text-xl outline-none focus:ring-2 focus:ring-[#ff0068]" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Penalidade de Idade (Pontos)</label>
                    <input type="number" step="0.1" value={config.default_penalty} onChange={e => setConfig({ ...config, default_penalty: parseFloat(e.target.value) })} className="w-full p-6 bg-slate-950 rounded-3xl border border-white/5 text-[#ff0068] font-black text-2xl outline-none" />
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="p-8 bg-slate-950 rounded-3xl border border-white/5 space-y-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Lote 1 (Early Bird)</h3>
                    <input type="number" value={config.price_lote_1} onChange={e => setConfig({ ...config, price_lote_1: Number(e.target.value) })} className="w-full p-4 bg-white/5 rounded-xl text-white font-bold" placeholder="Valor R$" />
                  </div>
                  <div className="p-8 bg-slate-950 rounded-3xl border border-white/5 space-y-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Lote 2 (Regular)</h3>
                    <input type="number" value={config.price_lote_2} onChange={e => setConfig({ ...config, price_lote_2: Number(e.target.value) })} className="w-full p-4 bg-white/5 rounded-xl text-white font-bold" placeholder="Valor R$" />
                  </div>
                </div>
              )}
              <div className="flex justify-between pt-10 border-t border-white/5">
                <button onClick={() => setStep(Math.max(1, step - 1))} className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase hover:text-white transition-all"><ChevronLeft size={16} /> Anterior</button>
                <button onClick={() => setStep(Math.min(4, step + 1))} className="px-10 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">Próximo <ChevronRight size={16} className="inline ml-2" /></button>
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
};

export default EventConfig;
