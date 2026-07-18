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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';
import { supabase, supabaseUrl } from '../services/supabase';
import PageHeader from '../components/PageHeader';
import EventPickerSheet, { EventPickerOption } from '../components/EventPickerSheet';
import {
  Award, GraduationCap, Loader2, Save, Send, AlertCircle, CheckCircle, Trash2,
  Type, Palette, Image as ImageIcon, FileSignature, Sparkles, X, Eye, Upload,
} from 'lucide-react';

type TemplateType = 'mostra' | 'workshop';
type PresetId = 'classico' | 'workshop' | 'ouro' | 'moderno' | 'prestigio' | 'custom' | 'oficial-dourado';

interface CertTemplate {
  id?: string;
  producer_id: string;
  template_type: TemplateType;
  name: string;
  /** Compat: aceita os nomes legados (mostra-classico, mostra-premium,
   * workshop-minimalista) mas no save sempre normaliza pra um dos IDs
   * ativos. 'ouro' aposentado do seletor em 2026-07-09 (substituído por
   * moderno/prestigio) — quem já tinha salvo continua renderizando. */
  preset_template: 'classico' | 'workshop' | 'ouro' | 'moderno' | 'prestigio' | 'mostra-classico' | 'workshop-minimalista' | 'mostra-premium' | 'custom' | 'oficial-dourado';
  background_url: string | null;
  /** Logo do evento — só desenhado nos presets moderno/prestigio (única URL
   * colada, mesmo padrão simples do background_url — sem upload dedicado
   * nesta v1). */
  logo_url: string | null;
  layout_json: any[];
  font_family_default: string;
  primary_color: string;
  accent_color: string;
  signature_names: string[];
  signature_titles: string[];
  signature_urls: string[];
}

type EventOption = EventPickerOption;

interface BatchResult { total: number; created: number; skipped: number }

// Aposentado do seletor em 2026-07-09: 'classico' (mostra) e 'ouro' (mostra
// + workshop), substituídos por Moderno/Prestígio — aprovados via mockup
// (2 direções visuais, ver artifact). Quem já tinha 'classico'/'ouro'
// salvo continua renderizando normal (edge function não mudou o
// normalizeVisualPreset desses valores) — só não aparecem mais como opção
// nova. 'Workshop' (minimalista) segue como está, sem mudança.
// Moderno/Prestígio aposentados do seletor em 2026-07-18 (mesmo padrão do
// 'classico'/'ouro' antes deles) — decisão do produtor após comparar com
// molduras de design de verdade (Oficial Dourado). Código não removido:
// quem já tinha salvo continua renderizando igual (normalizeVisualPreset
// na edge function não mudou pra esses valores).
const PRESETS: Array<{ id: PresetId; label: string; desc: string; for: TemplateType }> = [
  { id: 'oficial-dourado', label: 'Oficial Dourado', desc: 'Moldura pronta CoreoHub — bisel dourado, faixa navy, selo. Sem upload, sem customização de cor.', for: 'mostra' as TemplateType },
  { id: 'workshop',  label: 'Workshop',  desc: 'Linhas finas, tipografia clean, foco no nome do aluno.', for: 'workshop' as TemplateType },
  { id: 'oficial-dourado', label: 'Oficial Dourado', desc: 'Mesma moldura pronta CoreoHub, adaptada pro certificado de workshop.', for: 'workshop' as TemplateType },
];

// Cores default por preset — aplicadas só ao trocar de preset num template
// ainda não salvo (não sobrescreve customização já feita). 'oficial-dourado'
// não entra aqui de propósito: a paleta é fixa na edge function, o produtor
// nunca vê/edita cor pra esse preset (ver PRESETS_LOCKED_COLOR abaixo).
const OURO_DEFAULT_ACCENT = '#a97e2e';
const OURO_DEFAULT_PRIMARY = '#241c10';
const MODERNO_DEFAULT_ACCENT = '#1c4f72';
const MODERNO_DEFAULT_PRIMARY = '#1f2937';
const PRESTIGIO_DEFAULT_ACCENT = '#caa23a';
const PRESTIGIO_DEFAULT_PRIMARY = '#171310';
const PRESET_DEFAULT_COLORS: Partial<Record<PresetId, { accent: string; primary: string }>> = {
  ouro:      { accent: OURO_DEFAULT_ACCENT,      primary: OURO_DEFAULT_PRIMARY },
  moderno:   { accent: MODERNO_DEFAULT_ACCENT,   primary: MODERNO_DEFAULT_PRIMARY },
  prestigio: { accent: PRESTIGIO_DEFAULT_ACCENT, primary: PRESTIGIO_DEFAULT_PRIMARY },
};

// Thumbnail real da moldura oficial (mesmo asset que a edge function busca).
const OFICIAL_DOURADO_THUMB = '/certificate-frames/oficial-dourado.jpg';

// Presets com arte pronta (imagem cobre a página inteira) — nesses, editar
// cor de destaque/texto quebraria a harmonia com a arte, então o seletor de
// cor fica escondido. 'custom' entra só depois que o produtor já subiu uma
// imagem (antes disso ele pode estar usando o preset "vazio", sem fundo
// nenhum ainda, aí faz sentido deixar a cor visível como fallback).
const isColorLocked = (preset: PresetId, hasCustomBg: boolean) =>
  preset === 'oficial-dourado' || (preset === 'custom' && hasCustomBg);

/** Normaliza preset legado pro novo nome. */
const normalizePreset = (p?: string | null): PresetId => {
  if (p === 'ouro') return 'ouro';
  if (p === 'moderno') return 'moderno';
  if (p === 'prestigio') return 'prestigio';
  if (p === 'oficial-dourado') return 'oficial-dourado';
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
  const [formPreset, setFormPreset] = useState<PresetId>('moderno');
  const [formBgUrl, setFormBgUrl]   = useState('');
  const [formLogoUrl, setFormLogoUrl] = useState('');
  const [formAccent, setFormAccent] = useState('#ff0068');
  const [formPrimary, setFormPrimary] = useState('#0b0b0f');
  const [formSigs, setFormSigs]     = useState<string[]>([]);
  const [formTitles, setFormTitles] = useState<string[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // Snapshot do que está salvo de fato (só atualiza no load/save) — usado
  // pra avisar quando o produtor tem mudança não salva antes de clicar
  // "Pré-visualizar PDF" (o preview busca o template pelo ID no banco, não
  // reflete o form ainda não salvo).
  const [savedSnapshot, setSavedSnapshot] = useState<{ preset: PresetId; bg: string; logo: string; accent: string; primary: string } | null>(null);
  const isDirty = !savedSnapshot
    || formPreset !== savedSnapshot.preset
    || formBgUrl !== savedSnapshot.bg
    || formLogoUrl !== savedSnapshot.logo
    || formAccent !== savedSnapshot.accent
    || formPrimary !== savedSnapshot.primary;

  // Pré-visualização em PDF (dados fictícios, não toca certificates_issued)
  const [previewing, setPreviewing] = useState(false);

  // Emit batch state
  const [events, setEvents]                 = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent]   = useState<string>('');
  const [emitting, setEmitting]             = useState(false);
  const [lastBatch, setLastBatch]           = useState<BatchResult | null>(null);

  // Lista resumida de certificados emitidos por evento (pra mostrar status)
  const [emittedSummary, setEmittedSummary] = useState<Record<string, { total: number; downloaded: number }>>({});

  // Nome real do evento selecionado pro "Preview ao vivo" — antes mostrava
  // sempre "Festival CoreoHub Demo" fixo, mesmo com um evento real
  // escolhido no dropdown de emissão.
  const previewEventName = events.find(e => e.id === selectedEvent)?.name ?? 'Festival CoreoHub Demo';

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
      const preset = normalizePreset(tpl.preset_template);
      const bg = tpl.background_url ?? '';
      const logo = tpl.logo_url ?? '';
      const accent = tpl.accent_color ?? '#ff0068';
      const primary = tpl.primary_color ?? '#0b0b0f';
      setFormName(tpl.name ?? '');
      setFormPreset(preset);
      setFormBgUrl(bg);
      setFormLogoUrl(logo);
      setFormAccent(accent);
      setFormPrimary(primary);
      setSavedSnapshot({ preset, bg, logo, accent, primary });
      const names = Array.isArray(tpl.signature_names) ? tpl.signature_names : [];
      const titles = Array.isArray(tpl.signature_titles) ? tpl.signature_titles : [];
      setFormSigs(names);
      // Pareia com names: se titles tem menos itens, completa com '' pra alinhar.
      setFormTitles(names.map((_, i) => titles[i] ?? ''));
    } else {
      setTemplate(null);
      // Defaults
      setFormName(`Modelo padrão ${activeType === 'workshop' ? 'Workshop' : 'Mostra'}`);
      setFormPreset('oficial-dourado');
      setFormBgUrl('');
      setFormLogoUrl('');
      setFormAccent(activeType === 'workshop' ? '#ff0068' : MODERNO_DEFAULT_ACCENT);
      setFormPrimary(activeType === 'workshop' ? '#0b0b0f' : MODERNO_DEFAULT_PRIMARY);
      setSavedSnapshot(null);
      setFormSigs([]);
      setFormTitles([]);
    }

    // Eventos do produtor (pra emitir batch) — achado #5 (2026-07-17):
    // já era um <select> explícito (nunca teve o bug de auto-resolver
    // silenciosamente), só trocando pro EventPickerSheet padrão do resto do
    // app (melhor em mobile, mostra badge DEMO).
    const { data: evs } = await supabase
      .from('events')
      .select('id, name, edition_year, is_demo, start_date')
      .eq('created_by', user.id)
      .order('is_demo', { ascending: true })
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

  // Upload do logo do evento — comprime e salva como base64 inline (mesmo
  // padrão de foto/capa em WorkshopsManagement/JudgesManagement, sem
  // depender de bucket novo). fileType PNG (não webp) de propósito: o
  // pdf-lib só embute png/jpg, não decodifica webp.
  const handleLogoUpload = async (file: File) => {
    setLogoUploading(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.15,
        maxWidthOrHeight: 300,
        useWebWorker: true,
        fileType: 'image/png',
      });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });
      setFormLogoUrl(base64);
    } catch (e) {
      console.warn('Falha ao processar logo do evento:', e);
      setFeedback({ kind: 'err', msg: 'Não consegui processar essa imagem. Tente outro arquivo.' });
    } finally {
      setLogoUploading(false);
    }
  };

  // Upload da moldura completa (preset Customizado) — mesmo padrão inline
  // base64 do logo, mas resolução bem maior porque cobre a página inteira
  // (A4 paisagem), não é um ícone pequeno. Quando isCustomFullDesign roda na
  // edge function (preset='custom' + background_url preenchido), essa
  // imagem substitui a moldura inteira: sem overlay claro por cima, sem
  // moldura dupla desenhada — a arte do designer já É o resultado final,
  // só o texto dinâmico (nome, coreografia, evento etc) é escrito por cima.
  const handleBackgroundUpload = async (file: File) => {
    setBgUploading(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.9,
        maxWidthOrHeight: 1800,
        useWebWorker: true,
        fileType: 'image/png',
      });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });
      setFormBgUrl(base64);
    } catch (e) {
      console.warn('Falha ao processar imagem de fundo:', e);
      setFeedback({ kind: 'err', msg: 'Não consegui processar essa imagem. Tente outro arquivo.' });
    } finally {
      setBgUploading(false);
    }
  };

  // Troca de preset: sempre aplica a paleta própria do preset escolhido —
  // clicar num card é uma troca explícita de linguagem visual, então a cor
  // default do preset novo deve substituir a do preset anterior (mesmo se
  // o template já estava salvo com outra cor). Se o produtor quiser uma
  // cor diferente, edita os campos de cor manualmente depois de escolher.
  const selectPreset = (id: 'classico' | 'workshop' | 'ouro' | 'moderno' | 'prestigio' | 'oficial-dourado') => {
    setFormPreset(id);
    const defaults = PRESET_DEFAULT_COLORS[id];
    if (defaults) {
      setFormAccent(defaults.accent);
      setFormPrimary(defaults.primary);
    }
  };

  // ── Pré-visualizar PDF (dados fictícios) ───────────────────────────────
  // Volta a abrir numa aba nova (window.open) — a tentativa de embutir o PDF
  // dentro do card pequeno "Preview ao vivo" piorou a experiência (PDF real
  // é maior/mais detalhado que a caixa quadrada permite mostrar). O que o
  // produtor queria de fato já está coberto: a thumbnail do modelo
  // selecionado aparece sozinha no card ao trocar de preset (ver
  // `formPreset === 'oficial-dourado'` no JSX abaixo), sem precisar gerar
  // PDF nenhum pra isso.
  const previewPdf = async () => {
    if (!template?.id) return;
    setPreviewing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${supabaseUrl}/functions/v1/get-certificate-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ preview: true, template_id: template.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Erro ao gerar preview');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e.message ?? String(e) });
    } finally {
      setPreviewing(false);
    }
  };

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
      logo_url: formLogoUrl.trim() || null,
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
          <PageHeader
            title="Certificados"
            icon={<Award className="text-[#ff0068]" size={28} aria-hidden="true" />}
          />
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
                      onClick={() => selectPreset(p.id as 'classico' | 'workshop' | 'ouro' | 'moderno' | 'prestigio' | 'oficial-dourado')}
                      className={`text-left rounded-xl border p-3 transition ${formPreset === p.id ? 'border-[#ff0068] bg-[#ff0068]/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'}`}
                    >
                      {p.id === 'oficial-dourado' ? (
                        <div className="aspect-[297/210] rounded-md mb-2 overflow-hidden border border-slate-200 dark:border-white/10">
                          <img src={OFICIAL_DOURADO_THUMB} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="aspect-[297/210] rounded-md bg-gradient-to-br from-amber-50 to-rose-50 dark:from-slate-700 dark:to-slate-800 mb-2 flex items-center justify-center">
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{p.label}</span>
                        </div>
                      )}
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
                  <Field label="Moldura completa (A4 paisagem, 842×595pt)">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                      Suba a arte pronta do seu designer (moldura, cores, textura — tudo incluso). O CoreoHub escreve por cima só o texto dinâmico (nome, coreografia, evento, assinaturas, QR), sem aplicar nenhum filtro/overlay na sua imagem.
                    </p>
                    <div className="flex items-center gap-3">
                      {formBgUrl ? (
                        <img src={formBgUrl} alt="Moldura de fundo enviada" className="w-20 h-14 rounded-lg object-cover bg-white border border-slate-200 dark:border-white/10" />
                      ) : (
                        <div className="w-20 h-14 rounded-lg border-2 border-dashed border-slate-300 dark:border-white/10 flex items-center justify-center">
                          <ImageIcon size={18} className="text-slate-400" />
                        </div>
                      )}
                      <input
                        ref={bgInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => { if (e.target.files?.[0]) handleBackgroundUpload(e.target.files[0]); }}
                      />
                      <button
                        type="button"
                        onClick={() => bgInputRef.current?.click()}
                        disabled={bgUploading}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
                      >
                        {bgUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        {formBgUrl ? 'Trocar' : 'Enviar moldura'}
                      </button>
                      {formBgUrl && (
                        <button
                          type="button"
                          onClick={() => setFormBgUrl('')}
                          aria-label="Remover moldura"
                          className="p-2 rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </Field>
                )}
                {(formPreset === 'moderno' || formPreset === 'prestigio' || formPreset === 'oficial-dourado') && (
                  <Field label="Logo do evento (opcional)">
                    <div className="flex items-center gap-3">
                      {formLogoUrl ? (
                        <img src={formLogoUrl} alt="Logo do evento enviado" className="w-14 h-14 rounded-lg object-contain bg-white border border-slate-200 dark:border-white/10" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg border-2 border-dashed border-slate-300 dark:border-white/10 flex items-center justify-center">
                          <ImageIcon size={18} className="text-slate-400" />
                        </div>
                      )}
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => { if (e.target.files?.[0]) handleLogoUpload(e.target.files[0]); }}
                      />
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        disabled={logoUploading}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
                      >
                        {logoUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        {formLogoUrl ? 'Trocar' : 'Enviar logo'}
                      </button>
                      {formLogoUrl && (
                        <button
                          type="button"
                          onClick={() => setFormLogoUrl('')}
                          aria-label="Remover logo"
                          className="p-2 rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </Field>
                )}
                {isColorLocked(formPreset, !!formBgUrl) ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-200 dark:border-white/10 px-3 py-2">
                    Esse modelo já vem com paleta própria (moldura pronta) — cor de destaque/texto fica travada pra não quebrar a harmonia visual.
                  </p>
                ) : (
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
                )}
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
                  {formPreset === 'oficial-dourado' && (
                    <img src={OFICIAL_DOURADO_THUMB} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  )}
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
                        ? `no ${previewEventName} · 06 de junho de 2026`
                        : `no ${previewEventName} · Solo · Ballet Clássico · Juvenil`}
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
                <button
                  onClick={previewPdf}
                  disabled={previewing || !template?.id}
                  className="w-full mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50 transition"
                >
                  {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  Pré-visualizar PDF
                </button>
                {!template?.id && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 italic">Salve o template pra pré-visualizar o PDF real</p>
                )}
                {template?.id && isDirty && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 italic">Você tem alterações não salvas — a pré-visualização vai mostrar a última versão salva, não o que está na tela agora. Salve pra atualizar.</p>
                )}
              </Card>

              {/* Emitir batch */}
              <Card title="Emitir certificados">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Cria 1 certificado por inscrito {activeType === 'mostra' ? 'aprovado' : 'com presença confirmada'}. Idempotente — pode rodar múltiplas vezes.
                </p>
                <Field label="Evento">
                  <EventPickerSheet
                    events={events}
                    selectedEventId={selectedEvent || null}
                    onSelect={setSelectedEvent}
                    emptyLabel="— Selecione um evento —"
                    className="w-full"
                  />
                  {selectedEvent && emittedSummary[selectedEvent] && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5">
                      {emittedSummary[selectedEvent].total} certificado{emittedSummary[selectedEvent].total === 1 ? '' : 's'} já emitido{emittedSummary[selectedEvent].total === 1 ? '' : 's'}.
                    </p>
                  )}
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
