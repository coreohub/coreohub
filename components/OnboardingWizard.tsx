import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, FileUp, ArrowRight, ArrowLeft, Trophy, Star,
  CheckCircle2, RefreshCw, AlertCircle, Copy, MessageCircle,
  Settings2, Loader2,
} from 'lucide-react';
import { createEvent, supabase } from '../services/supabase';
import { extractRegulationFromPdfOrThrow, isExtractEmpty, RegulationExtract } from '../services/geminiService';
import { eventTemplates, getTemplate, TemplateId } from '../services/eventTemplates';
import { generateEventSlug } from '../services/eventSlug';
import { EventFormat } from '../types';

type Step = 1 | 2 | 3;

/** Mescla arrays de configs sem duplicar por `name` — primeira ocorrência vence. */
const mergeByName = <T extends { name: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter(it => {
    const k = it.name.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const OnboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  // Contador em vez de bool simples — dragenter/dragleave disparam pra cada
  // filho do drop zone (ícone, texto, etc), não só pra borda externa. Sem
  // isso o highlight "pisca" ao arrastar por cima dos elementos internos.
  const dragCounterRef = useRef(0);
  // Guard síncrono contra double-click. setSaving é assíncrono (React state),
  // então cliques rápidos podem entrar no handleCreate antes do re-render
  // desabilitar o botão — bug que gerou 10 events duplicados em produção.
  const createInFlightRef = useRef(false);

  const [data, setData] = useState({
    name: '',
    city: '',
    state: '',
    start_date: '',
    templates: [] as TemplateId[],
  });

  const [createdEvent, setCreatedEvent] = useState<{ id: string; slug: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const toggleTemplate = (id: TemplateId) => {
    setData(prev => ({
      ...prev,
      templates: prev.templates.includes(id)
        ? prev.templates.filter(t => t !== id)
        : [...prev.templates, id],
    }));
  };

  const canAdvanceStep1 = !!(data.name.trim() && data.city.trim() && data.start_date);
  const canAdvanceStep2 = data.templates.length > 0;

  const processPdfFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Envie um arquivo PDF.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
      });

      const x: RegulationExtract = await extractRegulationFromPdfOrThrow(b64);

      if (isExtractEmpty(x)) {
        setError('A IA processou o PDF mas não conseguiu extrair dados. Preencha manualmente abaixo.');
        return;
      }

      setData(prev => ({
        ...prev,
        name:       prev.name       || x.event_name  || '',
        start_date: prev.start_date || x.start_date  || '',
        // Usa city/state que a própria IA já separa do endereço (mesmo
        // schema do /importar-regulamento) — split(',')[0] no address bruto
        // pegava o nome da RUA como cidade em endereços tipo "Rua São
        // Paulo, 3546 – Bairro - CEP" (bug real achado 2026-08-13).
        city:       prev.city       || x.city  || '',
        state:      prev.state      || x.state || '',
      }));
    } catch (err: any) {
      const msg = err?.message ?? 'Erro desconhecido';
      console.error('[wizard] erro ao analisar PDF:', err);
      setError(`Falha na análise do PDF: ${msg}`);
    } finally {
      setAnalyzing(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const handlePdfInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || analyzing) return;
    processPdfFile(file);
  };

  const handlePdfDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (analyzing) return;
    dragCounterRef.current += 1;
    setIsDraggingPdf(true);
  };

  const handlePdfDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingPdf(false);
    }
  };

  const handlePdfDragOver = (e: React.DragEvent) => {
    // Sem isso o navegador recusa o drop (cursor vira "proibido").
    e.preventDefault();
    e.stopPropagation();
  };

  const handlePdfDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingPdf(false);
    if (analyzing) return;
    const file = e.dataTransfer.files?.[0];
    if (file) processPdfFile(file);
  };

  const handleCreate = async () => {
    if (data.templates.length === 0) return;
    // Guard síncrono — bloqueia double-click antes do React re-renderizar
    // o disabled. Sem isso, cliques rápidos criam events duplicados.
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada — faça login de novo.');

      // Defesa em profundidade: se já existe event do mesmo produtor com
      // mesmo nome (case-insensitive) e mesmo ano, redireciona pra ele em
      // vez de criar duplicado. Cobre o caso de wizard aberto em 2 abas
      // ou usuário voltando depois de já ter criado.
      const editionYearCheck = new Date(data.start_date).getFullYear() || new Date().getFullYear();
      const { data: existing } = await supabase
        .from('events')
        .select('id, slug')
        .eq('created_by', user.id)
        .ilike('name', data.name.trim())
        .eq('edition_year', editionYearCheck)
        .maybeSingle();
      if (existing?.id) {
        setCreatedEvent({ id: existing.id, slug: existing.slug ?? '' });
        setStep(3);
        return;
      }

      // Combina os templates selecionados (Competitiva tem prioridade como default).
      const tpls = data.templates.map(getTemplate);
      const hasCompetitiva = data.templates.includes('COMPETITIVA');
      const baseTpl = hasCompetitiva ? getTemplate('COMPETITIVA') : tpls[0];

      // Slug "festival-ano" via helper centralizado (Fase 2 — Slug Hardening).
      // O helper resolve colisão de unicidade no banco automaticamente (-2, -3, ...),
      // valida palavras reservadas e não duplica ano quando o nome já contém.
      const editionYear = new Date(data.start_date).getFullYear() || new Date().getFullYear();
      const { slug } = await generateEventSlug(data.name, editionYear);

      // Payload validado contra o schema real da tabela events (testado via
      // db-introspect). Detalhes (categorias, estilos, critérios, tolerância,
      // preços por formação) ficam em /account-settings.
      const payload: any = {
        name:             data.name,
        slug,
        created_by:       user.id,
        start_date:       data.start_date,
        city:             data.city,
        state:            data.state,
        location:         data.city + (data.state ? `, ${data.state}` : ''),
        edition_year:     editionYear,
        is_public:        true,
        formacoes_config: mergeByName(tpls.flatMap(t => t.formacoes_config)),
        event_type:       'private',
      };

      const result: any = await createEvent(payload);
      const ev = Array.isArray(result) ? result[0] : result;
      if (!ev?.id) throw new Error('Não foi possível criar o evento.');

      setCreatedEvent({ id: ev.id, slug: ev.slug ?? slug });
      setStep(3);
    } catch (e: any) {
      setError(e.message ?? 'Erro ao criar o evento.');
    } finally {
      setSaving(false);
      createInFlightRef.current = false;
    }
  };

  // Prefere slug pra link bonito compartilhável (Fase 1 — Padronização de URLs).
  // UUID como fallback se slug ainda não está disponível (criação falhou em algum ponto).
  const publicLink = createdEvent
    ? `${window.location.origin}/festival/${createdEvent.slug || createdEvent.id}/register`
    : '';

  const handleCopyLink = async () => {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt('Copie o link manualmente:', publicLink);
    }
  };

  const handleShareWhatsapp = () => {
    if (!publicLink) return;
    const text = `Inscrições abertas pra ${data.name}!\n\n${publicLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-8 sm:py-16">
      <div className="max-w-2xl mx-auto">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {[1, 2, 3].map(s => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                s < step      ? 'bg-emerald-500 w-8' :
                s === step    ? 'bg-[#ff0068] w-12' :
                                'bg-slate-200 dark:bg-white/10 w-5'
              }`}
            />
          ))}
          <span className="ml-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {step}/3
          </span>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500 text-xs font-bold flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span className="break-words">{error}</span>
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* ───────── STEP 1: Identidade ───────── */}
          {step === 1 && (
            <motion.div
              key="s1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Passo 1 de 3</span>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
                  Vamos criar seu <span className="text-[#ff0068]">festival</span>
                </h1>
                <p className="text-sm text-slate-500 font-medium">
                  Comece pelo básico — você refina os detalhes depois.
                </p>
              </div>

              {/* Atalho PDF — clicável ou arrastável (drag-and-drop) */}
              <button
                type="button"
                onClick={() => !analyzing && pdfInputRef.current?.click()}
                onDragEnter={handlePdfDragEnter}
                onDragOver={handlePdfDragOver}
                onDragLeave={handlePdfDragLeave}
                onDrop={handlePdfDrop}
                className={`w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-dashed transition-all ${
                  analyzing
                    ? 'border-[#ff0068]/40 bg-[#ff0068]/5 cursor-wait'
                    : isDraggingPdf
                    ? 'border-[#e3ff0a] bg-[#e3ff0a]/15 scale-[1.01]'
                    : 'border-[#e3ff0a]/40 bg-[#e3ff0a]/5 hover:border-[#e3ff0a] hover:bg-[#e3ff0a]/10'
                }`}
              >
                <div className="w-12 h-12 rounded-xl bg-[#e3ff0a]/20 flex items-center justify-center text-[#e3ff0a] shrink-0">
                  {analyzing
                    ? <RefreshCw size={20} className="animate-spin" />
                    : <Sparkles size={20} />}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {analyzing ? 'Analisando PDF…' : isDraggingPdf ? 'Solte o PDF aqui' : 'Tem o regulamento em PDF?'}
                  </p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                    {analyzing ? 'Aguarde — é rápido' : isDraggingPdf ? 'A IA preenche os campos abaixo' : 'Clique ou arraste o arquivo aqui'}
                  </p>
                </div>
                <FileUp size={18} className="text-slate-400 shrink-0" />
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={handlePdfInputChange}
                />
              </button>

              <div className="space-y-4 bg-white dark:bg-slate-900/60 rounded-3xl border border-slate-200 dark:border-white/10 p-6">
                <Field label="Nome do festival">
                  <input
                    type="text"
                    value={data.name}
                    onChange={e => setData({ ...data, name: e.target.value })}
                    placeholder="Ex: Grand Festival 2026"
                    className={inputCls}
                  />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <Field label="Cidade">
                      <input
                        type="text"
                        value={data.city}
                        onChange={e => setData({ ...data, city: e.target.value })}
                        placeholder="Ex: Recife"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <Field label="UF">
                    <select
                      value={data.state}
                      onChange={e => setData({ ...data, state: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf =>
                        <option key={uf} value={uf}>{uf}</option>
                      )}
                    </select>
                  </Field>
                </div>

                <Field label="Data de início">
                  <input
                    type="date"
                    value={data.start_date}
                    onChange={e => setData({ ...data, start_date: e.target.value })}
                    className={inputCls}
                  />
                </Field>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!canAdvanceStep1}
                className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-40 disabled:hover:scale-100"
              >
                Continuar <ArrowRight size={15} />
              </button>
            </motion.div>
          )}

          {/* ───────── STEP 2: Formato ───────── */}
          {step === 2 && (
            <motion.div
              key="s2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Passo 2 de 3</span>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
                  Como vai ser seu <span className="text-[#ff0068]">festival?</span>
                </h1>
                <p className="text-sm text-slate-500 font-medium">
                  Pode escolher uma ou as duas — seu festival pode ter modalidades de cada tipo.
                </p>
              </div>

              <div className="space-y-3">
                {eventTemplates.map(tpl => {
                  const selected = data.templates.includes(tpl.id);
                  const Icon = tpl.id === 'COMPETITIVA' ? Trophy : Star;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => toggleTemplate(tpl.id)}
                      className={`w-full text-left p-6 rounded-3xl border-2 transition-all ${
                        selected
                          ? 'border-[#ff0068] bg-[#ff0068]/5 scale-[1.01]'
                          : 'border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 hover:border-[#ff0068]/40'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all ${
                          selected ? 'bg-[#ff0068] text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-500'
                        }`}>
                          <Icon size={22} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                              {tpl.label}
                            </h3>
                            {selected && <CheckCircle2 size={16} className="text-[#ff0068]" />}
                          </div>
                          <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest mt-0.5">
                            {tpl.tagline}
                          </p>
                          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium leading-relaxed mt-2">
                            {tpl.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="px-5 py-4 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:text-slate-900 dark:hover:text-white transition-all flex items-center gap-2"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!canAdvanceStep2 || saving}
                  className="flex-1 flex items-center justify-center gap-2 py-4 bg-[#ff0068] text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-40 disabled:hover:scale-100"
                >
                  {saving
                    ? <><Loader2 size={15} className="animate-spin" /> Criando…</>
                    : <>Criar festival <ArrowRight size={15} /></>}
                </button>
              </div>
            </motion.div>
          )}

          {/* ───────── STEP 3: Pronto ───────── */}
          {step === 3 && createdEvent && (
            <motion.div
              key="s3"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="text-center space-y-3">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: 0.1 }}
                  className="inline-flex w-20 h-20 rounded-full bg-emerald-500/10 items-center justify-center"
                >
                  <CheckCircle2 size={42} className="text-emerald-500" />
                </motion.div>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
                  Seu festival <span className="text-emerald-500">foi criado!</span>
                </h1>
                <p className="text-sm text-slate-500 font-medium max-w-md mx-auto">
                  Próximos passos: configurar preços, gêneros, jurados e critérios em <strong>Configurações</strong>.
                </p>
              </div>

              <div className="bg-white dark:bg-slate-900/60 rounded-3xl border border-slate-200 dark:border-white/10 p-6 space-y-4">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Link de inscrição</p>
                  <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-white/5">
                    <p className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate flex-1">
                      {publicLink}
                    </p>
                    <button
                      onClick={handleCopyLink}
                      className="px-3 py-2 bg-[#ff0068] text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-1.5 shrink-0"
                    >
                      {linkCopied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                      {linkCopied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleShareWhatsapp}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-emerald-500/20"
                >
                  <MessageCircle size={16} /> Compartilhar no WhatsApp
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => navigate('/account-settings')}
                  className="flex items-center justify-center gap-2 py-3.5 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:border-[#ff0068]/40 transition-all"
                >
                  <Settings2 size={13} /> Configurar depois
                </button>
                <button
                  onClick={() => navigate('/qg-organizador')}
                  className="flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] text-white rounded-2xl font-black text-[11px] uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-[#ff0068]/30"
                >
                  Ir pro painel <ArrowRight size={13} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const inputCls = 'w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-[#ff0068]/50 focus:ring-2 focus:ring-[#ff0068]/20 transition-all';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
      {label}
    </label>
    {children}
  </div>
);

export default OnboardingWizard;
