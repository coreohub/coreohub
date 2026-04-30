import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Save, ArrowLeft, FileText, Info, RefreshCw,
  AlertCircle, Sparkles, Upload, Check, FileUp,
} from 'lucide-react';

const DRAFT_KEY = 'coreohub_create_event_draft';
import { motion, AnimatePresence } from 'motion/react';
import { createEvent, supabase } from '../services/supabase';
import { formatEventWhatsApp } from '../utils/formatters';
import { extractRegulationData, extractRegulationFromPdf, RegulationExtract } from '../services/geminiService';
import { EventFormat } from '../types';

type TabType = 'general' | 'regulation';

const CreateEvent = () => {
  const navigate = useNavigate();
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    edition_year: new Date().getFullYear(),
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
    formacoes_config: [
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
    slots_limit: 0,
    event_type: 'private' as 'private' | 'government',
    registration_lots: [] as { label: string; deadline: string; price: number }[],
    is_public: true,
    city: '',
    state: '',
    instagram_event: '',
    tiktok_event: '',
    youtube_event: '',
    whatsapp_event: '',
    website_event: '',
    email_event: '',
    regulation_pdf_url: '',
  });

  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      try { setFormData(JSON.parse(saved)); } catch {}
    }
  }, []);

  useEffect(() => {
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    }, 800);
    return () => clearTimeout(draftTimer.current);
  }, [formData]);

  const applyExtract = (x: RegulationExtract) => {
    const rid = () => Math.random().toString(36).substring(7);
    setFormData(prev => ({
      ...prev,
      name:                  prev.name                 || x.event_name               || '',
      address:               prev.address              || x.address                  || '',
      start_date:            prev.start_date           || x.start_date               || '',
      registration_deadline: prev.registration_deadline || x.registration_deadline   || '',
      default_format:        x.event_format ? (x.event_format as EventFormat) : prev.default_format,
      score_scale:           (x.score_scale === 10 || x.score_scale === 100) ? x.score_scale : prev.score_scale,
      age_tolerance_mode:    x.age_tolerance_mode  ?? prev.age_tolerance_mode,
      age_tolerance_value:   x.age_tolerance_value ?? prev.age_tolerance_value,
      formacoes_config:  [...prev.formacoes_config,  ...x.formacoes.map(m   => ({ ...m, id: rid(), min_members: 1, max_members: 1, slots_limit: 100, weight: 0, categories: [] }))],
      categories_config: [...prev.categories_config, ...x.categories.map(c  => ({ ...c, id: rid(), fee: 0, slots_limit: 0, weight: 0 }))],
      criteria_config:   [...prev.criteria_config,   ...x.criteria.map(cr   => ({ id: rid(), name: cr.name, weight: cr.weight, fee: 0, slots_limit: 0 }))],
      registration_lots: [...prev.registration_lots, ...x.registration_lots],
    }));
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPdf(true);
    setError(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
      });
      const x = await extractRegulationFromPdf(b64);
      applyExtract(x);
    } catch {
      setError('Erro ao analisar o PDF. Tente colar o texto do regulamento.');
    } finally {
      setUploadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const handleAIAnalysis = async () => {
    if (!formData.rules_text) return;
    setAnalyzing(true);
    setError(null);
    try {
      const x = await extractRegulationData(formData.rules_text);
      applyExtract(x);
    } catch {
      setError('Erro na análise da IA.');
    } finally {
      setAnalyzing(false);
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
    } catch {
      setError('Erro ao carregar capa.');
    } finally {
      setUploadingCover(false);
    }
  };

  const slugify = (text: string) =>
    text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');

  const handleCreate = async () => {
    if (!formData.name || !formData.agreed) {
      setError('Preencha o nome e aceite os termos.');
      return;
    }
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');
      const slug = `${slugify(formData.name)}-${Math.random().toString(36).substring(2, 8)}`;
      await createEvent({ ...formData, slug, created_by: user.id });
      localStorage.removeItem(DRAFT_KEY);
      navigate('/qg-organizador');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const tabs = [
    { id: 'general',    label: 'Identidade', short: 'Geral', icon: Info     },
    { id: 'regulation', label: 'Documentos', short: 'Docs',  icon: FileText },
  ];

  const inputCls = 'w-full p-5 bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-white/5 text-slate-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-[#ff0068] transition-all';
  const labelCls = 'text-[10px] font-black text-slate-500 uppercase tracking-widest px-1';

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4 md:p-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/qg-organizador')}
            className="shrink-0 p-2.5 bg-slate-100 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter leading-none">
              Criar <span className="text-[#ff0068]">Festival</span>
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-slate-500 text-[9px] font-bold uppercase tracking-widest hidden sm:block">Setup inicial do seu evento</p>
              {draftSaved && (
                <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                  <Check size={9} /> Rascunho salvo
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={isSaving}
          className="shrink-0 px-4 sm:px-8 py-3 sm:py-4 bg-[#ff0068] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2 shadow-xl shadow-[#ff0068]/20 disabled:opacity-60"
        >
          {isSaving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          <span className="hidden sm:inline">{isSaving ? 'Salvando...' : 'Salvar Festival'}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-900/50 rounded-3xl border border-slate-200 dark:border-white/5">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`flex-1 py-3 sm:py-4 rounded-2xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-white dark:bg-white/10 text-[#ff0068] shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <tab.icon size={14} className="shrink-0" />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.short}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white dark:bg-slate-900/40 p-4 sm:p-8 md:p-12 rounded-2xl sm:rounded-[3rem] border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-2xl min-h-[500px]">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">

            {/* ─── IDENTIDADE ─────────────────────────────────────────────── */}
            {activeTab === 'general' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* Tipo do evento */}
                <div className="md:col-span-2 space-y-2">
                  <label className={labelCls}>Tipo do Evento</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, event_type: 'private' })}
                      className={`p-5 rounded-2xl border text-left transition-all ${
                        formData.event_type === 'private'
                          ? 'bg-[#ff0068]/10 border-[#ff0068]'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-white/5 hover:border-[#ff0068]/40'
                      }`}
                    >
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Privado</p>
                      <p className="text-xs font-bold mt-1 text-slate-700 dark:text-slate-300">
                        Com cobrança de inscrição via Asaas (split automático).
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, event_type: 'government' })}
                      className={`p-5 rounded-2xl border text-left transition-all ${
                        formData.event_type === 'government'
                          ? 'bg-emerald-500/10 border-emerald-500'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-white/5 hover:border-emerald-500/40'
                      }`}
                    >
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Governamental</p>
                      <p className="text-xs font-bold mt-1 text-slate-700 dark:text-slate-300">
                        Inscrição gratuita, sem gateway. Ideal para JOMI/prefeituras.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Nome */}
                <div className="md:col-span-2 space-y-2">
                  <label className={labelCls}>Nome do Festival</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className={inputCls}
                    placeholder="Ex: Grand Festival 2025"
                  />
                </div>

                {/* Data início */}
                <div className="space-y-2">
                  <label className={labelCls}>Data de Início</label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                    className={inputCls}
                  />
                </div>

                {/* Prazo de inscrição */}
                <div className="space-y-2">
                  <label className={labelCls}>Prazo de Inscrição</label>
                  <input
                    type="date"
                    value={formData.registration_deadline}
                    onChange={e => setFormData({ ...formData, registration_deadline: e.target.value })}
                    className={inputCls}
                  />
                </div>

                {/* Localização */}
                <div className="space-y-2">
                  <label className={labelCls}>Localização</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className={inputCls}
                    placeholder="Cidade, Teatro..."
                  />
                </div>

                {/* Ano da edição */}
                <div className="space-y-2">
                  <label className={labelCls}>Ano da Edição</label>
                  <input
                    type="number"
                    min={2020}
                    max={2099}
                    value={formData.edition_year}
                    onChange={e => setFormData({ ...formData, edition_year: Number(e.target.value) })}
                    className={inputCls}
                    placeholder="Ex: 2026"
                  />
                </div>

                {/* Capa */}
                <div className="md:col-span-2 space-y-4">
                  <label className={labelCls}>Capa do Evento</label>
                  <div className="flex items-center gap-6">
                    <div className="w-40 h-24 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden flex items-center justify-center">
                      {formData.cover_url
                        ? <img src={formData.cover_url} className="w-full h-full object-cover" alt="Capa" />
                        : <Upload className="text-slate-300 dark:text-slate-700" />}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleCoverUpload}
                      disabled={uploadingCover}
                      className="text-[10px] text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-[#ff0068] file:text-white file:cursor-pointer"
                    />
                  </div>
                </div>

                {/* Vitrine pública */}
                <div className="md:col-span-2 mt-4 pt-8 border-t border-slate-100 dark:border-white/5 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-black uppercase tracking-tighter text-slate-900 dark:text-white">Vitrine pública</h3>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                        Aparece em /festivais e na página pública do evento
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, is_public: !formData.is_public })}
                      className={`relative w-14 h-8 rounded-full transition-colors ${formData.is_public ? 'bg-[#ff0068]' : 'bg-slate-300 dark:bg-slate-700'}`}
                    >
                      <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${formData.is_public ? 'translate-x-7' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2 md:col-span-2">
                      <label className={labelCls}>Cidade</label>
                      <input type="text" value={formData.city} onChange={e => setFormData({ ...formData, city: e.target.value })} className={inputCls.replace('p-5', 'p-4')} placeholder="Ex: Recife" />
                    </div>
                    <div className="space-y-2">
                      <label className={labelCls}>UF</label>
                      <select
                        value={formData.state}
                        onChange={e => setFormData({ ...formData, state: e.target.value })}
                        className={inputCls.replace('p-5', 'p-4')}
                      >
                        <option value="">—</option>
                        {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                          <option key={uf} value={uf}>{uf}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className={labelCls}>Instagram</label>
                      <input type="text" value={formData.instagram_event} onChange={e => setFormData({ ...formData, instagram_event: e.target.value })} className={inputCls.replace('p-5', 'p-4')} placeholder="@meufestival ou URL" />
                    </div>
                    <div className="space-y-2">
                      <label className={labelCls}>TikTok</label>
                      <input type="text" value={formData.tiktok_event} onChange={e => setFormData({ ...formData, tiktok_event: e.target.value })} className={inputCls.replace('p-5', 'p-4')} placeholder="@meufestival" />
                    </div>
                    <div className="space-y-2">
                      <label className={labelCls}>YouTube</label>
                      <input type="text" value={formData.youtube_event} onChange={e => setFormData({ ...formData, youtube_event: e.target.value })} className={inputCls.replace('p-5', 'p-4')} placeholder="@canalfestival" />
                    </div>
                    <div className="space-y-2">
                      <label className={labelCls}>WhatsApp</label>
                      <input
                        type="text"
                        value={formatEventWhatsApp(formData.whatsapp_event)}
                        onChange={e => setFormData({ ...formData, whatsapp_event: e.target.value.replace(/\D/g, '').slice(0, 13) })}
                        className={inputCls.replace('p-5', 'p-4')}
                        placeholder="+55 17 99877-6655"
                        inputMode="tel"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className={labelCls}>Site oficial</label>
                      <input type="text" value={formData.website_event} onChange={e => setFormData({ ...formData, website_event: e.target.value })} className={inputCls.replace('p-5', 'p-4')} placeholder="https://meufestival.com.br" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className={labelCls}>E-mail de contato</label>
                      <input type="email" value={formData.email_event} onChange={e => setFormData({ ...formData, email_event: e.target.value })} className={inputCls.replace('p-5', 'p-4')} placeholder="contato@meufestival.com.br" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className={labelCls}>Regulamento ou Edital (PDF)</label>
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const { uploadEventRules } = await import('../services/supabase');
                            // Antes do evento existir, usa um id temporário (timestamp).
                            // Após criar o evento real, o file fica linkado pela URL.
                            const tempId = formData.name?.toLowerCase().replace(/\s+/g, '-') || `draft-${Date.now()}`;
                            const url = await uploadEventRules(tempId, file);
                            setFormData({ ...formData, regulation_pdf_url: url });
                          } catch (err: any) {
                            alert(`Erro ao enviar PDF: ${err?.message ?? err}`);
                          }
                        }}
                        className={inputCls.replace('p-5', 'p-4')}
                      />
                      {formData.regulation_pdf_url && (
                        <p className="text-[10px] text-emerald-500">
                          ✓ Regulamento enviado.{' '}
                          <a href={formData.regulation_pdf_url} target="_blank" rel="noopener noreferrer" className="underline">Ver PDF</a>
                        </p>
                      )}
                      <p className="text-[10px] text-slate-400">
                        Aceita regulamento privado ou edital público.
                        Disponibilizado pra download na página pública do festival.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── DOCUMENTOS ─────────────────────────────────────────────── */}
            {activeTab === 'regulation' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-base font-black uppercase tracking-tighter text-slate-900 dark:text-white">Regulamento</h3>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                      Envie o PDF ou cole o texto — a IA pré-preenche o formulário
                    </p>
                  </div>
                  <button
                    onClick={handleAIAnalysis}
                    disabled={analyzing || !formData.rules_text}
                    className="flex items-center gap-2 px-4 py-2 bg-[#e3ff0a]/10 text-[#e3ff0a] rounded-xl text-[10px] font-black uppercase hover:bg-[#e3ff0a] hover:text-black transition-all disabled:opacity-40"
                  >
                    {analyzing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Analisar texto
                  </button>
                </div>

                {/* PDF upload area */}
                <div
                  onClick={() => !uploadingPdf && pdfInputRef.current?.click()}
                  className={`flex items-center gap-4 p-5 bg-slate-50 dark:bg-slate-950 rounded-2xl border-2 border-dashed transition-all ${
                    uploadingPdf
                      ? 'border-[#ff0068]/40 cursor-wait'
                      : 'border-slate-200 dark:border-white/10 cursor-pointer hover:border-[#ff0068]/60 hover:bg-[#ff0068]/[0.02]'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-all ${uploadingPdf ? 'bg-[#ff0068]/20 text-[#ff0068]' : 'bg-[#ff0068]/10 text-[#ff0068]'}`}>
                    {uploadingPdf
                      ? <RefreshCw size={20} className="animate-spin" />
                      : <FileUp size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">
                      {uploadingPdf ? 'Analisando PDF com IA…' : 'Enviar PDF do Regulamento'}
                    </p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                      {uploadingPdf ? 'Aguarde, isso pode levar alguns segundos' : 'A IA extrai nome, datas, formações e critérios automaticamente'}
                    </p>
                  </div>
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handlePdfUpload}
                  />
                </div>

                {/* Text area */}
                <div className="space-y-2">
                  <label className={labelCls}>Ou cole o texto aqui</label>
                  <textarea
                    rows={8}
                    value={formData.rules_text}
                    onChange={e => setFormData({ ...formData, rules_text: e.target.value })}
                    className="w-full p-6 bg-slate-50 dark:bg-slate-950 rounded-3xl border border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-300 font-medium text-sm outline-none focus:ring-2 focus:ring-[#ff0068] resize-none transition-all"
                    placeholder="Cole aqui o regulamento do seu festival…"
                  />
                </div>

                {/* Agree terms */}
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, agreed: !formData.agreed })}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shrink-0 ${
                      formData.agreed ? 'bg-[#ff0068] border-[#ff0068] text-white' : 'border-slate-300 dark:border-white/10'
                    }`}
                  >
                    {formData.agreed && <Check size={16} />}
                  </button>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Concordo com os termos de uso da plataforma
                  </span>
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
