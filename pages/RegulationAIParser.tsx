import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, FileText, CheckCircle2, AlertTriangle, RefreshCw,
  FileSearch, Upload, X, ChevronRight, Save, RotateCcw,
  Calendar, Clock, DollarSign, Scale, Trophy, Users,
  Layers, Star, Info, FileUp, Settings, ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { extractRegulationData, extractRegulationFromPdf, RegulationExtract } from '../services/geminiService';
import { uploadRegulationPdf, supabase } from '../services/supabase';

type Step = 'upload' | 'processing' | 'review' | 'done';

// ─── Helper: field wrapper highlighting null fields ────────────────────────────

const Field: React.FC<{
  label: string;
  value: string | number | boolean | null;
  children: React.ReactNode;
  icon?: React.ElementType;
}> = ({ label, value, children, icon: Icon }) => {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    <div className={`space-y-1.5 ${isEmpty ? 'relative' : ''}`}>
      <label className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
        {Icon && <Icon size={10} />}
        {label}
        {isEmpty && (
          <span className="ml-auto flex items-center gap-1 text-amber-500">
            <AlertTriangle size={9} /> Não encontrado
          </span>
        )}
      </label>
      <div className={`rounded-2xl border transition-all ${isEmpty ? 'border-amber-400/40 bg-amber-500/5 dark:border-amber-500/30' : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5'}`}>
        {children}
      </div>
    </div>
  );
};

const inputCls = 'w-full px-4 py-3 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none rounded-2xl';

// ─── Main Component ────────────────────────────────────────────────────────────

const RegulationAIParser: React.FC<{ onApply?: (data: RegulationExtract) => void }> = ({ onApply }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('upload');
  const [inputMode, setInputMode] = useState<'pdf' | 'text'>('pdf');
  const [pastedText, setPastedText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<RegulationExtract | null>(null);
  const [edited, setEdited] = useState<RegulationExtract | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File selection & drag ──

  const handleFileChange = (file: File) => {
    if (file.type !== 'application/pdf') {
      setError('Apenas arquivos PDF são aceitos.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Arquivo muito grande. Máximo 20 MB.');
      return;
    }
    setError('');
    setSelectedFile(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileChange(file);
  }, []);

  // ── Convert file to base64 ──

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // strip "data:application/pdf;base64," prefix
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // ── Run extraction ──

  const handleAnalyze = async () => {
    setError('');
    setStep('processing');

    try {
      let extracted: RegulationExtract;

      if (inputMode === 'pdf' && selectedFile) {
        setProgress('Lendo PDF...');
        const base64 = await fileToBase64(selectedFile);

        setProgress('Enviando ao Gemini...');
        extracted = await extractRegulationFromPdf(base64);

        // Upload to Supabase storage and link no evento ativo (não-bloqueante)
        try {
          setProgress('Salvando regulamento...');
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            // Tenta linkar ao evento mais recente do produtor pra ficar disponível
            // pra download na vitrine pública.
            const { data: ev } = await supabase
              .from('events')
              .select('id')
              .eq('created_by', user.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            const eventId = ev?.id ?? user.id;
            const url = await uploadRegulationPdf(eventId, selectedFile);
            if (ev?.id && url) {
              await supabase.from('events').update({ regulation_pdf_url: url }).eq('id', ev.id);
            }
          }
        } catch (_) { /* storage failure is non-critical */ }
      } else {
        if (!pastedText.trim()) {
          setError('Cole o texto do regulamento antes de analisar.');
          setStep('upload');
          return;
        }
        setProgress('Processando texto...');
        extracted = await extractRegulationData(pastedText);
      }

      setResult(extracted);
      setEdited({ ...extracted });
      setStep('review');
    } catch (err: any) {
      console.error(err);
      setError('Falha ao analisar. Verifique a chave Gemini e tente novamente.');
      setStep('upload');
    } finally {
      setProgress('');
    }
  };

  // ── Save to event ──

  const handleSave = async () => {
    if (!edited) return;
    setSaving(true);
    try {
      const updates: Record<string, any> = {};
      if (edited.event_name)                updates.nome_evento                 = edited.event_name;
      if (edited.address)                   updates.address                     = edited.address;
      if (edited.start_date)                updates.data_evento                 = edited.start_date;
      if (edited.registration_deadline)     updates.registration_deadline       = edited.registration_deadline;
      if (edited.track_submission_deadline) updates.track_submission_deadline   = edited.track_submission_deadline;
      if (edited.video_submission_deadline) updates.video_submission_deadline   = edited.video_submission_deadline;
      if (edited.score_scale)               updates.score_scale                 = edited.score_scale;
      if (edited.inactivity_block_enabled !== null) updates.inactivity_block_enabled = edited.inactivity_block_enabled;
      if (edited.age_reference)             updates.age_reference               = edited.age_reference;
      if (edited.age_tolerance_mode)        updates.age_tolerance_mode          = edited.age_tolerance_mode;
      if (edited.age_tolerance_value)       updates.age_tolerance_value         = edited.age_tolerance_value;
      if (edited.stage_entry_time_seconds)  updates.stage_entry_time_seconds    = edited.stage_entry_time_seconds;
      if (edited.stage_marking_time_seconds) updates.stage_marking_time_seconds  = edited.stage_marking_time_seconds;
      if (edited.registration_lots?.length)  updates.registration_lots           = edited.registration_lots;
      if (edited.categories_config)          updates.categories_config           = edited.categories;
      if (edited.formacoes)                  updates.formacoes_config            = edited.formacoes;
      if (edited.criteria_config)            updates.criteria_config             = edited.criteria;
      if (edited.tiebreaker_rules)           updates.tiebreaker_rules            = edited.tiebreaker_rules;

      const { updateActiveEventConfig } = await import('../services/supabase');
      await updateActiveEventConfig(updates);
      onApply?.(edited);
      setStep('done');
    } catch (err) {
      console.error(err);
      setError('Falha ao salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setSelectedFile(null);
    setPastedText('');
    setResult(null);
    setEdited(null);
    setError('');
  };

  const setField = (key: keyof RegulationExtract, value: any) =>
    setEdited(p => p ? { ...p, [key]: value } : p);

  // ── Count null fields ──

  const nullCount = edited ? Object.values(edited).filter(v => v === null || v === '').length : 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-700 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
            Importar <span className="text-[#ff0068]">Regulamento</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            IA extrai e preenche as configurações do evento automaticamente
          </p>
        </div>
        {step !== 'upload' && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] transition-all"
          >
            <RotateCcw size={13} /> Recomeçar
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3">
        {(['upload', 'processing', 'review', 'done'] as Step[]).map((s, i, arr) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 ${step === s ? 'opacity-100' : step === 'done' || arr.indexOf(step) > i ? 'opacity-60' : 'opacity-30'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black ${step === s ? 'bg-[#ff0068] text-white' : arr.indexOf(step) > i ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-500'}`}>
                {arr.indexOf(step) > i ? <CheckCircle2 size={12} /> : i + 1}
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 hidden sm:inline">
                {s === 'upload' ? 'Upload' : s === 'processing' ? 'Processando' : s === 'review' ? 'Revisão' : 'Concluído'}
              </span>
            </div>
            {i < arr.length - 1 && <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />}
          </React.Fragment>
        ))}
      </div>

      {/* ── STEP: UPLOAD ── */}
      {step === 'upload' && (
        <div className="space-y-6">
          {/* Mode toggle */}
          <div className="flex gap-2 p-1.5 bg-slate-100 dark:bg-white/5 rounded-2xl w-fit">
            {(['pdf', 'text'] as const).map(m => (
              <button
                key={m}
                onClick={() => setInputMode(m)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${inputMode === m ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}
              >
                {m === 'pdf' ? <FileUp size={13} /> : <FileText size={13} />}
                {m === 'pdf' ? 'PDF' : 'Colar Texto'}
              </button>
            ))}
          </div>

          {inputMode === 'pdf' ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative cursor-pointer border-2 border-dashed rounded-[3rem] p-16 flex flex-col items-center gap-5 transition-all ${dragging ? 'border-[#ff0068] bg-[#ff0068]/5' : selectedFile ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-300 dark:border-white/20 hover:border-[#ff0068]/50 hover:bg-[#ff0068]/5'}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFileChange(e.target.files[0]); }}
              />
              <div className={`w-16 h-16 rounded-[2rem] flex items-center justify-center ${selectedFile ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-100 dark:bg-white/10 text-slate-400'}`}>
                {selectedFile ? <CheckCircle2 size={28} /> : <Upload size={28} />}
              </div>
              <div className="text-center">
                {selectedFile ? (
                  <>
                    <p className="font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-tight">{selectedFile.name}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{(selectedFile.size / 1024).toFixed(0)} KB · Clique para trocar</p>
                  </>
                ) : (
                  <>
                    <p className="font-black text-slate-700 dark:text-slate-200 uppercase tracking-tight">Arraste ou clique para enviar</p>
                    <p className="text-[10px] text-slate-400 mt-1">Apenas PDF · Máximo 20 MB</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
                <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-blue-400 font-bold leading-relaxed">
                  Abra seu PDF, selecione todo o texto (Ctrl+A), copie e cole abaixo. Quanto mais texto, melhor a extração.
                </p>
              </div>
              <textarea
                value={pastedText}
                onChange={e => setPastedText(e.target.value)}
                placeholder="Cole aqui o texto completo do regulamento..."
                rows={12}
                className="w-full px-5 py-4 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-[2rem] text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068] transition-all resize-none"
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500">
              <AlertTriangle size={14} className="shrink-0" />
              <p className="text-[10px] font-black uppercase tracking-widest">{error}</p>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={(inputMode === 'pdf' && !selectedFile) || (inputMode === 'text' && !pastedText.trim())}
            className="w-full py-5 bg-slate-950 dark:bg-[#ff0068] text-white rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] flex items-center justify-center gap-4 hover:bg-[#ff0068] transition-all disabled:opacity-40 shadow-2xl shadow-[#ff0068]/20"
          >
            <Sparkles size={18} className="text-yellow-300" />
            Analisar com IA
          </button>
        </div>
      )}

      {/* ── STEP: PROCESSING ── */}
      {step === 'processing' && (
        <div className="py-32 flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full border-4 border-[#ff0068]/20 border-t-[#ff0068] animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles size={24} className="text-[#ff0068]" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tighter">Analisando Regulamento</p>
            <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em] animate-pulse">{progress || 'Processando...'}</p>
          </div>
          <p className="text-[10px] text-slate-400 text-center max-w-xs">A IA está lendo o documento e extraindo todos os dados estruturados. Aguarde...</p>
        </div>
      )}

      {/* ── STEP: REVIEW ── */}
      {step === 'review' && edited && (
        <div className="space-y-8">
          {/* Summary */}
          {edited.summary && (
            <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
              <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                <Sparkles size={11} /> Resumo IA
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{edited.summary}</p>
            </div>
          )}

          {nullCount > 0 && (
            <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
              <AlertTriangle size={16} className="text-amber-500 shrink-0" />
              <div>
                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">{nullCount} campo(s) não encontrado(s)</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Os campos destacados em amarelo não foram identificados no regulamento. Preencha manualmente.</p>
              </div>
            </div>
          )}

          {/* ── Dados Gerais ── */}
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
              <FileText size={12} /> Dados Gerais
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nome do Evento" value={edited.event_name} icon={Star}>
                <input className={inputCls} value={edited.event_name ?? ''} onChange={e => setField('event_name', e.target.value || null)} placeholder="Nome do festival..." />
              </Field>
              <Field label="Local / Endereço" value={edited.address} icon={Info}>
                <input className={inputCls} value={edited.address ?? ''} onChange={e => setField('address', e.target.value || null)} placeholder="Cidade, estado..." />
              </Field>
              <Field label="Data do Evento" value={edited.start_date} icon={Calendar}>
                <input type="date" className={inputCls} value={edited.start_date ?? ''} onChange={e => setField('start_date', e.target.value || null)} />
              </Field>
              <Field label="Prazo de Inscrição" value={edited.registration_deadline} icon={Calendar}>
                <input type="date" className={inputCls} value={edited.registration_deadline ?? ''} onChange={e => setField('registration_deadline', e.target.value || null)} />
              </Field>
              <Field label="Data Limite Trilha Sonora" value={edited.track_submission_deadline} icon={Calendar}>
                <input type="date" className={inputCls} value={edited.track_submission_deadline ?? ''} onChange={e => setField('track_submission_deadline', e.target.value || null)} />
              </Field>
              <Field label="Data Limite Seletiva de Vídeo" value={edited.video_submission_deadline} icon={Calendar}>
                <input type="date" className={inputCls} value={edited.video_submission_deadline ?? ''} onChange={e => setField('video_submission_deadline', e.target.value || null)} />
              </Field>
            </div>
          </section>

          {/* ── Configurações ── */}
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
              <Scale size={12} /> Configurações de Evento
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Tipo de Apresentação" value={edited.event_format} icon={Layers}>
                <select className={inputCls} value={edited.event_format ?? ''} onChange={e => setField('event_format', e.target.value || null)}>
                  <option value="">Selecionar...</option>
                  <option value="RANKING">Mostra Competitiva (RANKING)</option>
                  <option value="PEDAGOGICAL">Mostra Avaliada (PEDAGOGICAL)</option>
                  <option value="GRADUATED">Mostra por Médias (GRADUATED)</option>
                </select>
              </Field>
              <Field label="Escala de Pontuação" value={edited.score_scale} icon={Scale}>
                <select className={inputCls} value={edited.score_scale ?? ''} onChange={e => setField('score_scale', parseFloat(e.target.value) || null)}>
                  <option value="">Selecionar...</option>
                  <option value="9.8">0 a 9,8</option>
                  <option value="97">0 a 97</option>
                  <option value="10">0 a 10</option>
                  <option value="100">0 a 100</option>
                </select>
              </Field>
              <Field label="Referência de Idade" value={edited.age_reference} icon={Users}>
                <select className={inputCls} value={edited.age_reference ?? ''} onChange={e => setField('age_reference', e.target.value || null)}>
                  <option value="">Selecionar...</option>
                  <option value="EVENT_DAY">Data do Evento</option>
                  <option value="YEAR_END">31/12 do Ano</option>
                  <option value="FIXED_DATE">Data Fixa</option>
                </select>
              </Field>
              <Field label="Tolerância" value={edited.age_tolerance_mode} icon={Scale}>
                <div className="flex gap-2 p-1">
                  <select className="flex-1 px-3 py-2 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none" value={edited.age_tolerance_mode ?? ''} onChange={e => setField('age_tolerance_mode', e.target.value || null)}>
                    <option value="">Tipo...</option>
                    <option value="PERCENT">Percentual (%)</option>
                    <option value="FIXED_COUNT">Quantidade fixa</option>
                  </select>
                  <input type="number" min={0} placeholder="Valor" className="w-24 px-3 py-2 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none border-l border-slate-200 dark:border-white/10" value={edited.age_tolerance_value ?? ''} onChange={e => setField('age_tolerance_value', parseFloat(e.target.value) || null)} />
                </div>
              </Field>
              <Field label="Tempo Entrada no Palco (seg)" value={edited.stage_entry_time_seconds} icon={Clock}>
                <input type="number" className={inputCls} value={edited.stage_entry_time_seconds ?? ''} onChange={e => setField('stage_entry_time_seconds', parseInt(e.target.value) || null)} placeholder="Ex: 60" />
              </Field>
              <Field label="Tempo Marcação de Palco (seg)" value={edited.stage_marking_time_seconds} icon={Clock}>
                <input type="number" className={inputCls} value={edited.stage_marking_time_seconds ?? ''} onChange={e => setField('stage_marking_time_seconds', parseInt(e.target.value) || null)} placeholder="Ex: 120" />
              </Field>
            </div>
          </section>

          {/* ── Lotes de inscrição ── */}
          {edited.registration_lots?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <DollarSign size={12} /> Lotes de Inscrição
              </h3>
              <div className="space-y-2">
                {edited.registration_lots.map((lot, i) => (
                  <div key={i} className="grid grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
                    <input className="bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none px-2" value={lot.label} onChange={e => { const lots = [...edited.registration_lots]; lots[i] = { ...lots[i], label: e.target.value }; setField('registration_lots', lots); }} placeholder="Ex: 1º Lote" />
                    <input type="date" className="bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none px-2" value={lot.deadline} onChange={e => { const lots = [...edited.registration_lots]; lots[i] = { ...lots[i], deadline: e.target.value }; setField('registration_lots', lots); }} />
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">R$</span>
                      <input type="number" className="bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none flex-1 px-2" value={lot.price} onChange={e => { const lots = [...edited.registration_lots]; lots[i] = { ...lots[i], price: parseFloat(e.target.value) || 0 }; setField('registration_lots', lots); }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Categorias ── */}
          {edited.categories?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Users size={12} /> Faixas Etárias ({edited.categories.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {edited.categories.map((cat, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl space-y-2">
                    <input className="w-full bg-transparent text-xs font-black text-slate-900 dark:text-white focus:outline-none uppercase" value={cat.name} onChange={e => { const cats = [...edited.categories]; cats[i] = { ...cats[i], name: e.target.value }; setField('categories', cats); }} />
                    <div className="flex items-center gap-2 text-[9px] text-slate-400">
                      <input type="number" className="w-12 bg-transparent focus:outline-none text-slate-900 dark:text-white text-xs" value={cat.min_age} onChange={e => { const cats = [...edited.categories]; cats[i] = { ...cats[i], min_age: parseInt(e.target.value) || 0 }; setField('categories', cats); }} />
                      <span>a</span>
                      <input type="number" className="w-12 bg-transparent focus:outline-none text-slate-900 dark:text-white text-xs" value={cat.max_age} onChange={e => { const cats = [...edited.categories]; cats[i] = { ...cats[i], max_age: parseInt(e.target.value) || 0 }; setField('categories', cats); }} />
                      <span>anos</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Formações ── */}
          {edited.formacoes?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Layers size={12} /> Formações ({edited.formacoes.length})
              </h3>
              <div className="space-y-2">
                {edited.formacoes.map((mod, i) => (
                  <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl items-center">
                    <input className="bg-transparent text-sm font-black text-slate-900 dark:text-white focus:outline-none uppercase" value={mod.name} onChange={e => { const mods = [...edited.formacoes]; mods[i] = { ...mods[i], name: e.target.value }; setField('formacoes', mods); }} />
                    <div className="flex items-center gap-1 text-[9px] text-slate-400"><Clock size={10} /><input type="text" className="w-16 bg-transparent focus:outline-none text-slate-900 dark:text-white text-xs" value={mod.max_time} onChange={e => { const mods = [...edited.formacoes]; mods[i] = { ...mods[i], max_time: e.target.value }; setField('formacoes', mods); }} placeholder="MM:SS" /></div>
                    <div className="flex items-center gap-1 text-[9px] text-slate-400"><DollarSign size={10} /><input type="number" className="w-20 bg-transparent focus:outline-none text-slate-900 dark:text-white text-xs" value={mod.fee} onChange={e => { const mods = [...edited.formacoes]; mods[i] = { ...mods[i], fee: parseFloat(e.target.value) || 0 }; setField('formacoes', mods); }} /></div>
                    <select className="bg-transparent text-[9px] font-black text-slate-500 focus:outline-none uppercase" value={mod.format} onChange={e => { const mods = [...edited.formacoes]; mods[i] = { ...mods[i], format: e.target.value as any }; setField('formacoes', mods); }}>
                      <option value="RANKING">Competitivo</option>
                      <option value="PEDAGOGICAL">Avaliado</option>
                      <option value="GRADUATED">Por Médias</option>
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Quesitos ── */}
          {edited.criteria?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Scale size={12} /> Quesitos e Pesos ({edited.criteria.length})
              </h3>
              <div className="space-y-2">
                {edited.criteria.map((cr, i) => (
                  <div key={i} className="flex gap-3 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl items-center">
                    <input className="flex-1 bg-transparent text-sm font-black text-slate-900 dark:text-white focus:outline-none uppercase" value={cr.name} onChange={e => { const cs = [...edited.criteria]; cs[i] = { ...cs[i], name: e.target.value }; setField('criteria', cs); }} />
                    <div className="flex items-center gap-2 text-[9px] text-slate-400 shrink-0">
                      Peso:
                      <input type="number" step={0.1} min={0} className="w-14 px-2 py-1 bg-slate-200 dark:bg-white/10 rounded-lg text-slate-900 dark:text-white text-xs focus:outline-none text-center font-black" value={cr.weight} onChange={e => { const cs = [...edited.criteria]; cs[i] = { ...cs[i], weight: parseFloat(e.target.value) || 0 }; setField('criteria', cs); }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Prêmios ── */}
          {edited.prizes?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Trophy size={12} /> Prêmios ({edited.prizes.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {edited.prizes.map((prize, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl space-y-2">
                    <input className="w-full bg-transparent text-xs font-black text-slate-900 dark:text-white focus:outline-none uppercase" value={prize.name} onChange={e => { const ps = [...edited.prizes]; ps[i] = { ...ps[i], name: e.target.value }; setField('prizes', ps); }} placeholder="Nome do prêmio" />
                    <input className="w-full bg-transparent text-[10px] text-slate-500 focus:outline-none" value={prize.description} onChange={e => { const ps = [...edited.prizes]; ps[i] = { ...ps[i], description: e.target.value }; setField('prizes', ps); }} placeholder="Descrição..." />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Regras de desempate ── */}
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
              <ChevronRight size={12} /> Regras de Desempate
            </h3>
            <Field label="Descrição das regras" value={edited.tiebreaker_rules}>
              <textarea rows={3} className={inputCls + ' resize-none'} value={edited.tiebreaker_rules ?? ''} onChange={e => setField('tiebreaker_rules', e.target.value || null)} placeholder="Ex: Em caso de empate, prevalece a maior nota em Técnica..." />
            </Field>
          </section>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500">
              <AlertTriangle size={14} className="shrink-0" />
              <p className="text-[10px] font-black uppercase tracking-widest">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4 sticky bottom-4">
            <button onClick={handleReset} className="flex items-center gap-2 px-6 py-4 border border-slate-200 dark:border-white/10 rounded-[2rem] text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all bg-white dark:bg-slate-900 shadow-sm">
              <RotateCcw size={14} /> Refazer
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-3 py-4 bg-[#ff0068] text-white rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] hover:scale-[1.02] transition-all shadow-2xl shadow-[#ff0068]/20 disabled:opacity-60"
            >
              {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
              {saving ? 'Salvando...' : 'Aplicar ao Evento'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP: DONE ── */}
      {step === 'done' && (
        <div className="py-32 flex flex-col items-center gap-6">
          <div className="w-20 h-20 bg-emerald-500/10 rounded-[2rem] flex items-center justify-center text-emerald-500">
            <CheckCircle2 size={36} />
          </div>
          <div className="text-center space-y-2">
            <p className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Configurações Aplicadas!</p>
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Os dados do regulamento foram salvos no seu evento.</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Confira em <strong>Configurações</strong> se a IA acertou os detalhes (categorias, gêneros, prazos, prêmios) e ajuste o que precisar antes de abrir as inscrições.
            </p>
          </div>
          {/* CTA primária: revisar o que foi aplicado */}
          <button
            onClick={() => navigate('/account-settings')}
            className="flex items-center gap-2 px-8 py-4 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20"
          >
            <Settings size={14} /> Revisar Configurações Aplicadas <ArrowRight size={14} />
          </button>
          {/* CTA secundária discreta — só pra quem quer mesmo importar outro */}
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-all"
          >
            <RotateCcw size={11} /> Importar outro regulamento
          </button>
        </div>
      )}
    </div>
  );
};

export default RegulationAIParser;
