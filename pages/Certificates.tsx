/**
 * Certificates — Editor de templates + emissão em lote.
 *
 * Etapa 2 — modelo lazy-cache:
 *   • Producer cria 1 template por (mostra | workshop) — `certificate_templates`
 *   • Botão "Emitir certificados" chama edge function `emit-certificates-batch`
 *     que cria N rows em `certificates_issued` com pdf_url=NULL.
 *   • PDFs são gerados sob demanda quando inscrito clica "Baixar".
 *
 * Auditoria 2026-05-07: simplificado pra 2 templates (classico + workshop).
 * Antes tinha 3 (mostra-classico/mostra-premium/workshop-minimalista) —
 * mostra-premium duplicava visual e confundia produtor. Aceita os nomes
 * legados pra retrocompat (mostra-premium → classico no save).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import {
  Award, GraduationCap, Loader2, Save, Send, AlertCircle, CheckCircle, Trash2,
  Type, Palette, Image as ImageIcon, FileSignature, Sparkles, X,
} from 'lucide-react';

type TemplateType = 'mostra' | 'workshop';

interface CertTemplate {
  id?: string;
  producer_id: string;
  template_type: TemplateType;
  name: string;
  /** Compat: aceita os nomes legados (mostra-classico, mostra-premium,
   * workshop-minimalista) mas no save sempre normaliza pra 'classico' ou
   * 'workshop'. */
  preset_template: 'classico' | 'workshop' | 'mostra-classico' | 'workshop-minimalista' | 'mostra-premium' | 'custom';
  background_url: string | null;
  layout_json: any[];
  font_family_default: string;
  primary_color: string;
  accent_color: string;
  signature_names: string[];
  signature_titles: string[];
  signature_urls: string[];
}

interface EventOption { id: string; name: string }

interface BatchResult { total: number; created: number; skipped: number }

// 2 templates ativos. Os legados (mostra-classico, mostra-premium,
// workshop-minimalista) caem em 'classico' ou 'workshop' no save.
const PRESETS = [
  { id: 'classico', label: 'Clássico', desc: 'Borda dupla rosa, fundo creme, texto centralizado. Padrão pra mostras competitivas.', for: 'mostra'   as TemplateType },
  { id: 'workshop', label: 'Workshop', desc: 'Linhas finas, tipografia clean, foco no nome do aluno.',                              for: 'workshop' as TemplateType },
];

/** Normaliza preset legado pro novo nome. */
const normalizePreset = (p?: string | null): 'classico' | 'workshop' | 'custom' => {
  if (p === 'mostra-classico' || p === 'mostra-premium' || p === 'classico') return 'classico';
  if (p === 'workshop-minimalista' || p === 'workshop') return 'workshop';
  return 'custom';
};

const Certificates: React.FC = () => {
  const [activeType, setActiveType] = useState<TemplateType>('mostra');
  const [userId, setUserId]         = useState<string | null>(null);
  const [template, setTemplate]     = useState<CertTemplate | null>(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [feedback, setFeedback]     = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Form state (controlled)
  const [formName, setFormName]     = useState('');
  const [formPreset, setFormPreset] = useState<'classico' | 'workshop' | 'custom'>('classico');
  const [formBgUrl, setFormBgUrl]   = useState('');
  const [formAccent, setFormAccent] = useState('#ff0068');
  const [formPrimary, setFormPrimary] = useState('#0b0b0f');
  const [formSigs, setFormSigs]     = useState<string[]>([]);
  const [formTitles, setFormTitles] = useState<string[]>([]);

  // Emit batch state
  const [events, setEvents]                 = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent]   = useState<string>('');
  const [emitting, setEmitting]             = useState(false);
  const [lastBatch, setLastBatch]           = useState<BatchResult | null>(null);

  // Lista resumida de certificados emitidos por evento (pra mostrar status)
  const [emittedSummary, setEmittedSummary] = useState<Record<string, { total: number; downloaded: number }>>({});

  // ── Carrega user + template do tipo ativo ──────────────────────────────
  const loadTemplate = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserId(user.id);

    // Carrega template
    const { data: tpl } = await supabase
      .from('certificate_templates')
      .select('*')
      .eq('producer_id', user.id)
      .eq('template_type', activeType)
      .maybeSingle();

    if (tpl) {
      setTemplate(tpl as CertTemplate);
      setFormName(tpl.name ?? '');
      setFormPreset(normalizePreset(tpl.preset_template));
      setFormBgUrl(tpl.background_url ?? '');
      setFormAccent(tpl.accent_color ?? '#ff0068');
      setFormPrimary(tpl.primary_color ?? '#0b0b0f');
      const names = Array.isArray(tpl.signature_names) ? tpl.signature_names : [];
      const titles = Array.isArray(tpl.signature_titles) ? tpl.signature_titles : [];
      setFormSigs(names);
      // Pareia com names: se titles tem menos itens, completa com '' pra alinhar.
      setFormTitles(names.map((_, i) => titles[i] ?? ''));
    } else {
      setTemplate(null);
      // Defaults
      setFormName(`Modelo padrão ${activeType === 'workshop' ? 'Workshop' : 'Mostra'}`);
      setFormPreset(activeType === 'workshop' ? 'workshop' : 'classico');
      setFormBgUrl('');
      setFormAccent('#ff0068');
      setFormPrimary('#0b0b0f');
      setFormSigs([]);
      setFormTitles([]);
    }

    // Eventos do produtor (pra emitir batch)
    const { data: evs } = await supabase
      .from('events')
      .select('id, name')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });
    if (evs) setEvents(evs);

    // Resumo de emissões por evento
    if (evs && evs.length > 0) {
      const evIds = evs.map(e => e.id);
      const { data: certs } = await supabase
        .from('certificates_issued')
        .select('event_id, pdf_url, download_count')
        .in('event_id', evIds)
        .eq('template_type', activeType);
      const summary: Record<string, { total: number; downloaded: number }> = {};
      for (const c of certs ?? []) {
        if (!c.event_id) continue;
        const s = summary[c.event_id] ??= { total: 0, downloaded: 0 };
        s.total += 1;
        if (c.pdf_url) s.downloaded += 1;
      }
      setEmittedSummary(summary);
    }

    setLoading(false);
  }, [activeType]);

  useEffect(() => { loadTemplate(); }, [loadTemplate]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4500);
    return () => clearTimeout(t);
  }, [feedback]);

  // ── Save template ──────────────────────────────────────────────────────
  const saveTemplate = async () => {
    if (!userId) return;
    setSaving(true);
    // Filtra signatários vazios + pareia titles. Se nome em branco, descarta
    // o índice todo (não envia title órfão).
    const validSigs: { name: string; title: string }[] = [];
    formSigs.forEach((name, i) => {
      if (name.trim()) validSigs.push({ name: name.trim(), title: (formTitles[i] ?? '').trim() });
    });

    const payload: Partial<CertTemplate> = {
      producer_id: userId,
      template_type: activeType,
      name: formName.trim() || null as any,
      preset_template: formPreset,
      background_url: formBgUrl.trim() || null,
      accent_color: formAccent,
      primary_color: formPrimary,
      signature_names:  validSigs.map(s => s.name),
      signature_titles: validSigs.map(s => s.title),
      // layout_json: deixamos vazio → edge function usa DEFAULT_LAYOUT do preset
      layout_json: [],
    };
    const { error } = template?.id
      ? await supabase.from('certificate_templates').update(payload).eq('id', template.id)
      : await supabase.from('certificate_templates').insert(payload as any);

    setSaving(false);
    if (error) {
      setFeedback({ kind: 'err', msg: error.message });
    } else {
      setFeedback({ kind: 'ok', msg: 'Template salvo' });
      loadTemplate();
    }
  };

  // ── Emit batch ──────────────────────────────────────────────────────────
  const emitBatch = async () => {
    if (!selectedEvent) return;
    if (!template?.id) {
      setFeedback({ kind: 'err', msg: 'Salve o template antes de emitir' });
      return;
    }
    setEmitting(true);
    setLastBatch(null);
    try {
      const { data, error } = await supabase.functions.invoke('emit-certificates-batch', {
        body: { event_id: selectedEvent, template_type: activeType },
      });
      if (error) throw new Error(error.message ?? 'Erro');
      if (data?.error) throw new Error(data.error);
      setLastBatch(data as BatchResult);
      setFeedback({ kind: 'ok', msg: `${data.created} novo(s) emitido(s) · ${data.skipped} já existiam` });
      loadTemplate();
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e.message ?? String(e) });
    } finally {
      setEmitting(false);
    }
  };

  // Filtra presets estritamente pelo tipo ativo (audit T3: "premium serve pra
  // ambos" causava duplicação visual em Mostra e Workshop confundindo produtor).
  const visiblePresets = useMemo(() =>
    PRESETS.filter(p => p.for === activeType),
    [activeType]);

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">

        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 dark:text-white flex items-center gap-3">
            <Award className="text-[#ff0068]" size={28} aria-hidden="true" />
            Certificados
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure o template e emita certificados pra inscritos com presença confirmada. PDFs são gerados sob demanda quando o inscrito baixar.
          </p>
        </div>

        {/* Tabs Mostra | Workshop */}
        <div className="flex bg-white dark:bg-white/5 p-1 rounded-2xl border border-slate-200 dark:border-white/10 mb-6">
          <TabButton active={activeType === 'mostra'}   onClick={() => setActiveType('mostra')}   icon={Award} label="Mostra" />
          <TabButton active={activeType === 'workshop'} onClick={() => setActiveType('workshop')} icon={GraduationCap} label="Workshop" />
        </div>

        {feedback && (
          <div className={`mb-4 rounded-xl border p-3 text-sm flex items-center gap-2 ${feedback.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'}`}>
            {feedback.kind === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {feedback.msg}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Coluna 1+2: Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Preset */}
              <Card title="Modelo">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {visiblePresets.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setFormPreset(p.id as any)}
                      className={`text-left rounded-xl border p-3 transition ${formPreset === p.id ? 'border-[#ff0068] bg-[#ff0068]/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'}`}
                    >
                      <div className="aspect-[297/210] rounded-md bg-gradient-to-br from-amber-50 to-rose-50 dark:from-slate-700 dark:to-slate-800 mb-2 flex items-center justify-center">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{p.label}</span>
                      </div>
                      <p className="text-xs font-black text-slate-900 dark:text-white">{p.label}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{p.desc}</p>
                    </button>
                  ))}
                  <button
                    onClick={() => setFormPreset('custom')}
                    className={`text-left rounded-xl border p-3 transition ${formPreset === 'custom' ? 'border-[#ff0068] bg-[#ff0068]/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'}`}
                  >
                    <div className="aspect-[297/210] rounded-md bg-slate-100 dark:bg-white/5 mb-2 flex items-center justify-center border-2 border-dashed border-slate-300 dark:border-white/10">
                      <ImageIcon size={20} className="text-slate-400" />
                    </div>
                    <p className="text-xs font-black text-slate-900 dark:text-white">Customizado</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Use seu próprio fundo</p>
                  </button>
                </div>
              </Card>

              {/* Identidade */}
              <Card title="Identidade">
                <Field label="Nome interno do template">
                  <input value={formName} onChange={e => setFormName(e.target.value)} className={inputCls} placeholder="Ex: Mostra Cia X 2026" />
                </Field>
                {formPreset === 'custom' && (
                  <Field label="URL da imagem de fundo (A4 landscape)">
                    <input value={formBgUrl} onChange={e => setFormBgUrl(e.target.value)} className={inputCls} placeholder="https://..." />
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cor de destaque (rosa CoreoHub default)">
                    <div className="flex items-center gap-2">
                      <input type="color" value={formAccent} onChange={e => setFormAccent(e.target.value)} className="w-12 h-10 rounded-lg cursor-pointer" />
                      <input value={formAccent} onChange={e => setFormAccent(e.target.value)} className={inputCls} />
                    </div>
                  </Field>
                  <Field label="Cor do texto principal">
                    <div className="flex items-center gap-2">
                      <input type="color" value={formPrimary} onChange={e => setFormPrimary(e.target.value)} className="w-12 h-10 rounded-lg cursor-pointer" />
                      <input value={formPrimary} onChange={e => setFormPrimary(e.target.value)} className={inputCls} />
                    </div>
                  </Field>
                </div>
              </Card>

              {/* Assinaturas */}
              <Card title="Assinaturas (rodapé)">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Até 3 assinaturas. Adicione o <strong>nome</strong> e a <strong>função/cargo</strong> de cada signatário (ex: "Maria Silva" — "Diretora Artística").
                </p>
                <div className="space-y-3">
                  {formSigs.map((nome, i) => (
                    <div key={i} className="flex flex-col sm:flex-row gap-2 p-3 sm:p-0 border sm:border-0 border-slate-200 dark:border-white/10 rounded-xl">
                      <input
                        value={nome}
                        onChange={e => {
                          const next = [...formSigs]; next[i] = e.target.value; setFormSigs(next);
                        }}
                        placeholder="Nome completo"
                        className={`${inputCls} min-w-0 flex-1`}
                      />
                      <input
                        value={formTitles[i] ?? ''}
                        onChange={e => {
                          const next = [...formTitles];
                          // Garante que o array de titles tem o mesmo tamanho de sigs
                          while (next.length < formSigs.length) next.push('');
                          next[i] = e.target.value;
                          setFormTitles(next);
                        }}
                        placeholder="Função / cargo (ex: Diretor)"
                        className={`${inputCls} min-w-0 flex-1`}
                      />
                      <button
                        onClick={() => {
                          setFormSigs(formSigs.filter((_, idx) => idx !== i));
                          setFormTitles(formTitles.filter((_, idx) => idx !== i));
                        }}
                        aria-label={`Remover assinatura ${i + 1}`}
                        className="p-2.5 sm:px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 self-end sm:self-auto"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {formSigs.length < 3 && (
                    <button
                      onClick={() => { setFormSigs([...formSigs, '']); setFormTitles([...formTitles, '']); }}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/15 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                    >
                      <FileSignature size={12} />Adicionar assinatura
                    </button>
                  )}
                </div>
              </Card>

              <button
                onClick={saveTemplate}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-[#ff0068] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] disabled:opacity-50 transition"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {template?.id ? 'Salvar alterações' : 'Salvar template'}
              </button>
            </div>

            {/* Coluna 3: Preview + Emitir */}
            <div className="space-y-6">
              {/* Preview WYSIWYG com dados de exemplo (padrão Sympla/Even3).
                  Renderização CSS — PDF final tem QR + assinatura digital. */}
              <Card title="Preview ao vivo">
                <div
                  className="aspect-[297/210] rounded-md border-2 relative overflow-hidden flex items-center justify-center"
                  style={{
                    background: '#fefdf6',
                    borderColor: formAccent,
                  }}
                >
                  {formBgUrl && formPreset === 'custom' && (
                    <img src={formBgUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                  )}
                  <div className="absolute inset-2 border" style={{ borderColor: formAccent, borderWidth: 0.5 }} />
                  <div className="relative text-center px-3 sm:px-4 w-full">
                    <p className="font-black tracking-tighter" style={{ color: formPrimary, fontSize: 'clamp(10px, 3vw, 22px)' }}>CERTIFICADO</p>
                    <p className="text-[7px] font-bold uppercase tracking-widest mt-1" style={{ color: formAccent }}>
                      {activeType === 'workshop' ? 'DE PARTICIPAÇÃO EM WORKSHOP' : 'DE PARTICIPAÇÃO'}
                    </p>
                    <p className="italic text-[8px] mt-2 text-slate-500">Certificamos que</p>
                    <p className="font-black tracking-tight mt-0.5" style={{ color: formPrimary, fontSize: 'clamp(8px, 2.5vw, 16px)' }}>
                      Maria Silva Oliveira
                    </p>
                    <p className="text-[7px] mt-1.5 text-slate-500">
                      {activeType === 'workshop'
                        ? 'participou do workshop'
                        : 'participou da coreografia'}
                    </p>
                    <p className="font-black" style={{ color: formAccent, fontSize: 'clamp(7px, 1.8vw, 11px)' }}>
                      {activeType === 'workshop' ? '"Hip-hop Fundamentos"' : '"Renascer"'}
                    </p>
                    <p className="text-[6px] mt-1 text-slate-500">
                      {activeType === 'workshop'
                        ? 'no Festival CoreoHub Demo · 06 de junho de 2026'
                        : 'no Festival CoreoHub Demo · Solo · Ballet Clássico · Juvenil'}
                    </p>

                    {/* Assinaturas — pareadas com cargo se houver */}
                    {formSigs.filter(Boolean).length > 0 && (
                      <div className="mt-3 sm:mt-4 flex justify-center gap-3 sm:gap-6">
                        {formSigs.map((nome, i) => nome && (
                          <div key={i} className="text-center">
                            <div className="border-t mx-auto" style={{ borderColor: formPrimary, width: 'clamp(40px, 12vw, 80px)' }} />
                            <p className="font-bold mt-0.5" style={{ color: formPrimary, fontSize: 'clamp(6px, 1.5vw, 9px)' }}>
                              {nome}
                            </p>
                            {formTitles[i] && (
                              <p className="italic" style={{ color: formAccent, fontSize: 'clamp(5px, 1.2vw, 7px)' }}>
                                {formTitles[i]}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 italic mt-2">
                  Preview com dados de exemplo. PDF final terá nome real do inscrito + QR de validação no rodapé.
                </p>
              </Card>

              {/* Emitir batch */}
              <Card title="Emitir certificados">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Cria 1 certificado por inscrito {activeType === 'mostra' ? 'aprovado' : 'com presença confirmada'}. Idempotente — pode rodar múltiplas vezes.
                </p>
                <Field label="Evento">
                  <select value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)} className={inputCls}>
                    <option value="">— Selecione um evento —</option>
                    {events.map(ev => {
                      const s = emittedSummary[ev.id];
                      const tag = s ? ` (${s.total} emitido${s.total === 1 ? '' : 's'})` : '';
                      return <option key={ev.id} value={ev.id}>{ev.name}{tag}</option>;
                    })}
                  </select>
                </Field>
                <button
                  onClick={emitBatch}
                  disabled={!selectedEvent || emitting || !template?.id}
                  className="w-full mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff0068] hover:bg-[#d4005a] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#ff0068]/20 disabled:opacity-50 transition"
                >
                  {emitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Emitir certificados
                </button>
                {!template?.id && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 italic">Salve o template antes de emitir</p>
                )}
                {lastBatch && (
                  <div className="mt-3 rounded-xl bg-violet-500/10 border border-violet-500/30 p-3 text-xs text-violet-700 dark:text-violet-200">
                    <p className="font-bold mb-1">Resultado:</p>
                    <p>Elegíveis: {lastBatch.total}</p>
                    <p>Novos emitidos: {lastBatch.created}</p>
                    <p>Já existiam: {lastBatch.skipped}</p>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────
const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: any; label: string }> = ({ active, onClick, icon: Icon, label }) => (
  <button
    onClick={onClick}
    className={`flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all ${active ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-lg' : 'text-slate-500'}`}
  >
    <Icon size={13} />{label}
  </button>
);

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-5">
    <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">{title}</h3>
    <div className="space-y-3">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">{label}</span>
    {children}
  </label>
);

const inputCls = 'w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff0068]/30';

export default Certificates;
