import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Save, ArrowLeft, FileText,
  Settings, Info, RefreshCw,
  Scale, AlertCircle, Sparkles,
  Upload, Trash2, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createEvent, supabase } from '../services/supabase';
import { analyzeRegulation } from '../services/geminiService';
import { EventFormat } from '../types';
import EventFormatSelector from '../components/EventFormatSelector';

type TabType = 'general' | 'regulation' | 'technical' | 'judging';

const CreateEvent = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    start_date: '',
    end_date: '',
    address: '',
    cover_url: '',
    rules_text: '',
    rules_pdf_url: '',
    agreed: false,
    default_format: EventFormat.RANKING as EventFormat,
    score_scale: 10 as 10 | 100,
    age_reference_date: '',
    age_tolerance_mode: 'PERCENT' as 'PERCENT' | 'FIXED_COUNT',
    age_tolerance_value: 0,
    modalities_config: [
      { id: 'm1', name: 'Solo', min_members: 1, max_members: 1, fee: 0, slots_limit: 100, weight: 0, format: EventFormat.RANKING, categories: ['Infantil', 'Júnior', 'Adulto'] },
      { id: 'm2', name: 'Duo', min_members: 2, max_members: 2, fee: 0, slots_limit: 50, weight: 0, format: EventFormat.RANKING, categories: ['Infantil', 'Júnior', 'Adulto'] },
    ] as any[],
    categories_config: [
      { id: 'c1', name: 'Infantil', min_age: 7, max_age: 11, fee: 0, slots_limit: 0, weight: 0 },
      { id: 'c2', name: 'Júnior', min_age: 12, max_age: 14, fee: 0, slots_limit: 0, weight: 0 },
      { id: 'c3', name: 'Adulto', min_age: 15, max_age: 99, fee: 0, slots_limit: 0, weight: 0 },
    ] as any[],
    styles_config: [
      { id: 's1', name: 'Urbanas', fee: 0, slots_limit: 0, weight: 0 },
      { id: 's2', name: 'Jazz', fee: 0, slots_limit: 0, weight: 0 },
    ] as any[],
    criteria_config: [
      { id: 'cr1', name: 'Técnica', weight: 40, fee: 0, slots_limit: 0 },
      { id: 'cr2', name: 'Musicalidade', weight: 30, fee: 0, slots_limit: 0 },
      { id: 'cr3', name: 'Presença', weight: 30, fee: 0, slots_limit: 0 },
    ] as any[],
    registration_deadline: '',
    category_price: 0,
    slots_limit: 0
  });

  const [newModality, setNewModality] = useState({ name: '', min_members: 1, max_members: 1, fee: 0, slots_limit: 0, weight: 0, format: EventFormat.RANKING, categories: [] as string[] });
  const [analyzing, setAnalyzing] = useState(false);

  const handleAddModality = () => {
    if (newModality.name.trim()) {
      setFormData({ ...formData, modalities_config: [...formData.modalities_config, { ...newModality, id: Math.random().toString(36).substring(7) }] });
      setNewModality({ name: '', min_members: 1, max_members: 1, fee: 0, slots_limit: 0, weight: 0, format: EventFormat.RANKING, categories: [] });
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const { uploadEventCover } = await import('../services/supabase');
      const url = await uploadEventCover('temp_' + Date.now(), file);
      setFormData({ ...formData, cover_url: url });
    } catch (err) {
      setError('Erro ao carregar capa.');
    } finally {
      setUploadingCover(false);
    }
  };

  const handleAIAnalysis = async () => {
    if (!formData.rules_text) return;
    setAnalyzing(true);
    try {
      const analysis = await analyzeRegulation(formData.rules_text);
      setFormData(prev => ({
        ...prev,
        modalities_config: [...prev.modalities_config, ...analysis.modalities.map(m => ({ ...m, id: Math.random().toString(36).substring(7) }))],
        categories_config: [...prev.categories_config, ...analysis.categories.map(c => ({ ...c, id: Math.random().toString(36).substring(7) }))],
      }));
    } catch (err) {
      setError('Erro na análise da IA.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.name || !formData.agreed) {
      setError('Preencha o nome e aceite os termos.');
      return;
    }
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');
      await createEvent({ ...formData, created_by: user.id });
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'Identidade', icon: Info },
    { id: 'regulation', label: 'Documentos', icon: FileText },
    { id: 'technical', label: 'Regras Técnicas', icon: Settings },
    { id: 'judging', label: 'Julgamento', icon: Scale },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-4 md:p-0">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="p-3 bg-white/5 rounded-2xl border border-white/5 text-slate-400 hover:text-white transition-all">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-black text-white uppercase tracking-tighter">Criar <span className="text-[#ff0068]">Festival</span></h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Setup inicial do seu evento</p>
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={isSaving}
          className="px-8 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2 shadow-xl shadow-[#ff0068]/20"
        >
          {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
          {isSaving ? 'Salvando...' : 'Salvar Festival'}
        </button>
      </div>

      {error && <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500 text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}

      <div className="flex gap-2 p-2 bg-slate-900/50 rounded-3xl border border-white/5">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeTab === tab.id ? 'bg-white/10 text-[#e3ff0a] shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-slate-900/40 p-8 md:p-12 rounded-[3rem] border border-white/5 shadow-2xl min-h-[500px]">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
            {activeTab === 'general' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="md:col-span-2 space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Nome do Festival</label>
                  <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full p-5 bg-slate-950 rounded-2xl border border-white/5 text-white font-bold outline-none focus:ring-2 focus:ring-[#ff0068] transition-all" placeholder="Ex: Grand Festival 2025" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Data de Início</label>
                  <input type="date" value={formData.start_date} onChange={e => setFormData({ ...formData, start_date: e.target.value })} className="w-full p-5 bg-slate-950 rounded-2xl border border-white/5 text-white font-bold outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Localização</label>
                  <input type="text" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} className="w-full p-5 bg-slate-950 rounded-2xl border border-white/5 text-white font-bold outline-none" placeholder="Cidade, Teatro..." />
                </div>
                <div className="md:col-span-2 space-y-4">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Capa do Evento</label>
                  <div className="flex items-center gap-6">
                    <div className="w-40 h-24 bg-slate-950 rounded-2xl border border-white/5 overflow-hidden flex items-center justify-center">
                      {formData.cover_url ? <img src={formData.cover_url} className="w-full h-full object-cover" /> : <Upload className="text-slate-700" />}
                    </div>
                    <input type="file" onChange={handleCoverUpload} className="text-[10px] text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-[#ff0068] file:text-white" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'regulation' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-black text-white uppercase tracking-tighter">Regulamento</h3>
                  <button onClick={handleAIAnalysis} disabled={analyzing || !formData.rules_text} className="flex items-center gap-2 px-4 py-2 bg-[#e3ff0a]/10 text-[#e3ff0a] rounded-xl text-[10px] font-black uppercase hover:bg-[#e3ff0a] hover:text-black transition-all">
                    {analyzing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />} Analisar com IA
                  </button>
                </div>
                <textarea rows={10} value={formData.rules_text} onChange={e => setFormData({ ...formData, rules_text: e.target.value })} className="w-full p-6 bg-slate-950 rounded-3xl border border-white/5 text-slate-300 font-medium text-sm outline-none focus:ring-2 focus:ring-[#ff0068] resize-none" placeholder="Cole aqui o regulamento do seu festival..." />
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                  <button onClick={() => setFormData({ ...formData, agreed: !formData.agreed })} className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${formData.agreed ? 'bg-[#ff0068] border-[#ff0068] text-white' : 'border-white/10'}`}>
                    {formData.agreed && <Check size={16} />}
                  </button>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Concordo com os termos de uso da plataforma</span>
                </div>
              </div>
            )}

            {activeTab === 'technical' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Limite de Vagas Total</label>
                    <input type="number" value={formData.slots_limit} onChange={e => setFormData({ ...formData, slots_limit: Number(e.target.value) })} className="w-full p-5 bg-slate-950 rounded-2xl border border-white/5 text-white font-bold outline-none" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Prazo de Inscrição</label>
                    <input type="date" value={formData.registration_deadline} onChange={e => setFormData({ ...formData, registration_deadline: e.target.value })} className="w-full p-5 bg-slate-950 rounded-2xl border border-white/5 text-white font-bold outline-none" />
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Modalidades Ativas</h4>
                  <div className="grid grid-cols-1 gap-3">
                    {formData.modalities_config.map(mod => (
                      <div key={mod.id} className="p-4 bg-slate-950 rounded-2xl border border-white/5 flex justify-between items-center group">
                        <div>
                          <span className="text-sm font-black text-white uppercase">{mod.name}</span>
                          <span className="ml-3 text-[10px] text-slate-500 font-bold uppercase tracking-widest">{mod.format}</span>
                        </div>
                        <button onClick={() => setFormData({ ...formData, modalities_config: formData.modalities_config.filter(m => m.id !== mod.id) })} className="text-slate-700 hover:text-rose-500 transition-all"><Trash2 size={16} /></button>
                      </div>
                    ))}
                    <div className="flex gap-2 mt-4">
                      <input type="text" value={newModality.name} onChange={e => setNewModality({ ...newModality, name: e.target.value })} className="flex-1 p-4 bg-slate-950 rounded-2xl border border-white/5 text-white text-xs font-bold outline-none" placeholder="Nova Modalidade (Ex: Trio)" />
                      <button onClick={handleAddModality} className="px-6 bg-[#e3ff0a] text-black rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all">Adicionar</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'judging' && (
              <div className="space-y-8">
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Formato do Evento</h4>
                  <EventFormatSelector
                    selected={formData.default_format}
                    onSelect={(format) => setFormData({ ...formData, default_format: format })}
                  />
                </div>
                <div className="p-8 bg-[#ff0068]/5 border border-[#ff0068]/10 rounded-3xl space-y-4">
                  <h3 className="text-lg font-black text-white uppercase tracking-tighter flex items-center gap-2"><Scale className="text-[#ff0068]" /> Escala de Notas</h3>
                  <div className="flex gap-4">
                    {[10, 100].map(scale => (
                      <button key={scale} onClick={() => setFormData({ ...formData, score_scale: scale as 10 | 100 })} className={`flex-1 py-4 rounded-2xl font-black text-xs transition-all border ${formData.score_scale === scale ? 'bg-[#ff0068] border-[#ff0068] text-white shadow-lg' : 'bg-slate-950 border-white/5 text-slate-500 hover:text-white'}`}>Escala 0 a {scale}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Critérios de Avaliação</h4>
                  <div className="grid grid-cols-1 gap-3">
                    {formData.criteria_config.map(cr => (
                      <div key={cr.id} className="p-4 bg-slate-950 rounded-2xl border border-white/5 flex justify-between items-center">
                        <span className="text-sm font-black text-white uppercase">{cr.name}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-black text-[#e3ff0a] uppercase tracking-widest">{cr.weight}%</span>
                          <button onClick={() => setFormData({ ...formData, criteria_config: formData.criteria_config.filter(c => c.id !== cr.id) })} className="text-slate-700 hover:text-rose-500"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CreateEvent;
