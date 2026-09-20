import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Upload, CheckCircle2, RefreshCw, AlertCircle, Copy, ArrowRight, Ticket,
} from 'lucide-react';
import { createEvent, supabase, uploadEventCover } from '../services/supabase';
import { generateEventSlug } from '../services/eventSlug';

/**
 * Wizard de criação do Plano Espetáculo (docs/mostra-pricing-spec.md).
 * Deliberadamente muito mais simples que o OnboardingWizard do Festival —
 * sem formações/categorias/critérios/júri (fora de escopo confirmado na
 * spec). Só o essencial pra vender ingresso de plateia: nome, data, local,
 * capa. billing_plan='espetaculo' já entra no INSERT (trigger
 * sync_commission_percent_from_billing_plan aplica 7,9% sozinho — só roda
 * em UPDATE a proteção contra escrita não-privilegiada, então o INSERT do
 * próprio produtor já nasce com o plano certo, sem gate de admin).
 */

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const EspetaculoWizard: React.FC = () => {
  const navigate = useNavigate();
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdEvent, setCreatedEvent] = useState<{ id: string; slug: string } | null>(null);
  const createInFlightRef = useRef(false);

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    setError(null);
    try {
      const url = await uploadEventCover(`temp_espetaculo_${Date.now()}`, file);
      setCoverUrl(url);
    } catch {
      setError('Erro ao carregar capa. Tente outra imagem.');
    } finally {
      setUploadingCover(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError('Informe o nome do espetáculo.'); return; }
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada — faça login de novo.');

      const editionYear = startDate ? (new Date(startDate).getFullYear() || new Date().getFullYear()) : new Date().getFullYear();

      // Mesma defesa contra duplicata do OnboardingWizard — evento do mesmo
      // produtor com mesmo nome+ano já existente redireciona em vez de duplicar.
      const { data: existing } = await supabase
        .from('events')
        .select('id, slug')
        .eq('created_by', user.id)
        .ilike('name', name.trim())
        .eq('edition_year', editionYear)
        .maybeSingle();
      if (existing?.id) {
        setCreatedEvent({ id: existing.id, slug: existing.slug ?? '' });
        return;
      }

      const { slug } = await generateEventSlug(name, editionYear);

      const payload: any = {
        name,
        slug,
        created_by:   user.id,
        start_date:   startDate || null,
        city,
        state,
        location:     city + (state ? `, ${state}` : ''),
        cover_url:    coverUrl || undefined,
        edition_year: editionYear,
        is_public:    true,
        event_type:   'private',
        // Plano Espetáculo — docs/mostra-pricing-spec.md. commission_percent
        // e audience_commission_percent derivam sozinhos (7,9%) via trigger
        // já existente no banco.
        billing_plan: 'espetaculo',
        // Liga a bilheteria de plateia — mesma infra do Festival, já testada.
        // Sem tipo de ingresso configurado ainda, então o botão "Comprar" só
        // vira funcional depois que o produtor cadastrar os tipos em
        // Configurações → Ingressos.
        politica_ingressos:     'INTERNO',
        audience_sales_enabled: false,
      };

      const result: any = await createEvent(payload);
      const ev = Array.isArray(result) ? result[0] : result;
      if (!ev?.id) throw new Error('Não foi possível criar o espetáculo.');

      setCreatedEvent({ id: ev.id, slug: ev.slug ?? slug });
    } catch (e: any) {
      setError(e.message ?? 'Erro ao criar o espetáculo.');
    } finally {
      setSaving(false);
      createInFlightRef.current = false;
    }
  };

  const publicLink = createdEvent
    ? `${window.location.origin}/evento/${createdEvent.slug || createdEvent.id}`
    : '';

  const handleCopyLink = async () => {
    if (!publicLink) return;
    try { await navigator.clipboard.writeText(publicLink); } catch {}
  };

  const inputCls = 'w-full p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-white/5 text-slate-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-[#ff0068] transition-all';
  const labelCls = 'text-[10px] font-black text-slate-500 uppercase tracking-widest px-1';

  if (createdEvent) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5 text-center">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Espetáculo criado!</h1>
            <p className="text-xs text-slate-500 mt-1">Agora falta configurar os tipos de ingresso e ligar a venda.</p>
          </div>
          <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
            <span className="flex-1 text-xs text-slate-500 truncate text-left">{publicLink}</span>
            <button onClick={handleCopyLink} className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 shrink-0" aria-label="Copiar link">
              <Copy size={14} />
            </button>
          </div>
          <button
            onClick={() => navigate('/account-settings')}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-sm uppercase tracking-widest"
          >
            <Ticket size={16} /> Configurar ingressos <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#e3ff0a]/10 border border-[#e3ff0a]/20">
            <Sparkles size={12} className="text-[#a8b800] dark:text-[#e3ff0a]" />
            <span className="text-[9px] font-black text-[#a8b800] dark:text-[#e3ff0a] uppercase tracking-[0.3em]">Plano Espetáculo</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase text-slate-900 dark:text-white">
            Coloque sua <span className="text-[#ff0068] italic">mostra</span> no ar
          </h1>
          <p className="text-xs text-slate-500 font-bold leading-relaxed">
            Bilheteria de plateia pra espetáculo de fim de ano — sem júri, sem cronograma competitivo. Só ingresso, cupom e credenciamento.
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5 shadow-sm"
          >
            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="space-y-2">
              <label className={labelCls}>Nome do espetáculo</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Ex: Espetáculo de Fim de Ano 2026" />
            </div>

            <div className="space-y-2">
              <label className={labelCls}>Data</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <label className={labelCls}>Cidade</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)} className={inputCls} placeholder="Ex: Votuporanga" />
              </div>
              <div className="space-y-2">
                <label className={labelCls}>UF</label>
                <select value={state} onChange={e => setState(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className={labelCls}>Capa</label>
              {/* flex-col no mobile — input file nativo tem largura intrínseca
                  (botão + "No file chosen") que não encolhe, causava overflow
                  horizontal em 375px quando ficava lado a lado com a prévia. */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="w-28 h-16 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden flex items-center justify-center shrink-0">
                  {coverUrl ? <img src={coverUrl} className="w-full h-full object-cover" alt="Capa" /> : <Upload size={16} className="text-slate-300 dark:text-slate-700" />}
                </div>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  disabled={uploadingCover}
                  className="min-w-0 text-[10px] text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:text-[10px] file:font-black file:bg-[#ff0068] file:text-white file:cursor-pointer"
                />
              </div>
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              Comissão fixa de <strong className="text-slate-600 dark:text-slate-300">7,9% sobre o ingresso vendido</strong>, sem mensalidade nem taxa fixa — só paga se vender.
            </p>

            <button
              onClick={handleCreate}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-60 text-white rounded-xl font-black text-sm uppercase tracking-widest"
            >
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <><CheckCircle2 size={16} /> Criar espetáculo</>}
            </button>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default EspetaculoWizard;
