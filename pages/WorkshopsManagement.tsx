import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabase';
import VendasTabs from '../components/VendasTabs';
import imageCompression from 'browser-image-compression';
import {
  Plus, Trash2, Pencil, Calendar, Clock, MapPin, Loader2, X, AlertCircle, CheckCircle,
  GraduationCap, User, Tag, Layers, DollarSign, Users, Globe, EyeOff, Camera,
  ShoppingCart, Mail, RefreshCw, UserCheck, Search, Image as ImageIcon,
} from 'lucide-react';

type Nivel = 'iniciante' | 'intermediario' | 'avancado' | 'todos';
type FeeMode = 'repassar' | 'absorver';

interface EventOption { id: string; name: string }

interface WorkshopRow {
  id: string;
  event_id: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  cover_url: string | null;
  professor_name: string;
  professor_bio: string | null;
  professor_bio_short: string | null;
  professor_photo_url: string | null;
  professor_instagram: string | null;
  professor_site_url: string | null;
  professor_is_public: boolean;
  modalidade: string | null;
  nivel: Nivel;
  data_inicio: string;
  data_fim: string | null;
  duracao_minutos: number | null;
  local: string | null;
  capacidade_max: number | null;
  preco_padrao: number;
  preco_inscritos_mostra: number | null;
  gratis_para_inscritos: boolean;
  auto_detect_combo: boolean;
  workshop_commission_percent: number;
  workshop_fee_mode: FeeMode;
  workshop_max_per_cpf: number;
  is_published: boolean;
}

interface JudgeOption {
  id: string;
  name: string;
  avatar_url: string | null;
  mini_bio: string | null;
  instagram: string | null;
}

interface LotRow {
  id: string;
  workshop_id: string;
  ordem: number;
  nome: string;
  preco: number;
  preco_inscritos_mostra: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  quantidade_maxima: number | null;
  is_active: boolean;
}

const NIVEIS: { value: Nivel; label: string }[] = [
  { value: 'todos',         label: 'Todos os níveis' },
  { value: 'iniciante',     label: 'Iniciante' },
  { value: 'intermediario', label: 'Intermediário' },
  { value: 'avancado',      label: 'Avançado' },
];

const fmtCurrency = (n: number) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Combining diacritical marks (U+0300..U+036F). Escape Unicode explícito
// pra não depender do encoding do arquivo (audit T1.6).
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

const slugify = (s: string) =>
  s.toLowerCase()
    .normalize('NFD').replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-')
    .slice(0, 50);

// Formata Date pra value de input datetime-local
const toInputDateTime = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ────────────────────────────────────────────────────────────────────────────

const WorkshopsManagement: React.FC = () => {
  const [events, setEvents]                 = useState<EventOption[]>([]);
  const [selectedScope, setSelectedScope]   = useState<string>('all'); // 'all' | event.id | 'standalone'
  const [workshops, setWorkshops]           = useState<WorkshopRow[]>([]);
  const [lots, setLots]                     = useState<Record<string, LotRow[]>>({});
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [feedback, setFeedback]             = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [showModal, setShowModal]           = useState(false);
  const [editingId, setEditingId]           = useState<string | null>(null);
  const [showLotsModal, setShowLotsModal]   = useState<WorkshopRow | null>(null);
  const [showBuyersModal, setShowBuyersModal] = useState<WorkshopRow | null>(null);
  // Jurados do produtor — pra reaproveitar como professor (nome/foto/bio/@).
  const [judges, setJudges] = useState<JudgeOption[]>([]);

  // ── Form de workshop ────────────────────────────────────────────────────
  const emptyForm = {
    event_id: '' as string | '',
    name: '',
    slug: '',
    description: '',
    cover_url: '',
    professor_name: '',
    professor_bio: '',
    professor_bio_short: '',
    professor_photo_url: '',
    professor_instagram: '',
    professor_site_url: '',
    professor_is_public: true,
    modalidade: '',
    nivel: 'todos' as Nivel,
    data_inicio: '',
    data_fim: '',
    duracao_minutos: '' as string | number,
    local: '',
    capacidade_max: '' as string | number,
    preco_padrao: 0,
    preco_inscritos_mostra: '' as string | number,
    gratis_para_inscritos: false,
    auto_detect_combo: true,
    workshop_commission_percent: 10,
    workshop_fee_mode: 'repassar' as FeeMode,
    workshop_max_per_cpf: 4,
    is_published: false,
  };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Carrega eventos do produtor ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const [evRes, judgesRes] = await Promise.all([
        supabase
          .from('events')
          .select('id, name')
          .eq('created_by', user.id)
          .order('created_at', { ascending: false }),
        // Jurados do produtor (RLS já escopa) — pra reaproveitar como professor.
        supabase
          .from('judges')
          .select('id, name, avatar_url, mini_bio, instagram')
          .order('name'),
      ]);
      if (evRes.data) setEvents(evRes.data);
      if (judgesRes.data) setJudges(judgesRes.data as JudgeOption[]);
    })();
  }, []);

  // ── Carrega workshops + lots ────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    let q = supabase
      .from('workshops')
      .select('*')
      .eq('created_by', user.id)
      .order('data_inicio', { ascending: true });

    if (selectedScope === 'standalone') q = q.is('event_id', null);
    else if (selectedScope !== 'all')   q = q.eq('event_id', selectedScope);

    const { data: ws, error } = await q;
    if (error) {
      console.error(error);
      setFeedback({ kind: 'err', msg: error.message });
      setLoading(false);
      return;
    }
    setWorkshops(ws ?? []);

    // Carrega lots em batch
    if (ws && ws.length > 0) {
      const ids = ws.map(w => w.id);
      const { data: lotData } = await supabase
        .from('workshop_lots')
        .select('*')
        .in('workshop_id', ids)
        .order('ordem', { ascending: true });
      const grouped: Record<string, LotRow[]> = {};
      (lotData ?? []).forEach(l => {
        (grouped[l.workshop_id] ??= []).push(l);
      });
      setLots(grouped);
    } else {
      setLots({});
    }
    setLoading(false);
  }, [selectedScope]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Auto-clear feedback ─────────────────────────────────────────────────
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4500);
    return () => clearTimeout(t);
  }, [feedback]);

  // ── Open create/edit modal ──────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      event_id: selectedScope !== 'all' && selectedScope !== 'standalone' ? selectedScope : '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (w: WorkshopRow) => {
    setEditingId(w.id);
    setForm({
      event_id: w.event_id ?? '',
      name: w.name,
      slug: w.slug ?? '',
      description: w.description ?? '',
      cover_url: w.cover_url ?? '',
      professor_name: w.professor_name,
      professor_bio: w.professor_bio ?? '',
      professor_bio_short: w.professor_bio_short ?? '',
      professor_photo_url: w.professor_photo_url ?? '',
      professor_instagram: w.professor_instagram ?? '',
      professor_site_url: w.professor_site_url ?? '',
      professor_is_public: w.professor_is_public,
      modalidade: w.modalidade ?? '',
      nivel: w.nivel,
      data_inicio: toInputDateTime(w.data_inicio),
      data_fim: toInputDateTime(w.data_fim),
      duracao_minutos: w.duracao_minutos ?? '',
      local: w.local ?? '',
      capacidade_max: w.capacidade_max ?? '',
      preco_padrao: w.preco_padrao,
      preco_inscritos_mostra: w.preco_inscritos_mostra ?? '',
      gratis_para_inscritos: w.gratis_para_inscritos,
      auto_detect_combo: w.auto_detect_combo,
      workshop_commission_percent: w.workshop_commission_percent,
      workshop_fee_mode: w.workshop_fee_mode,
      workshop_max_per_cpf: w.workshop_max_per_cpf,
      is_published: w.is_published,
    });
    setFormError(null);
    setShowModal(true);
  };

  // ── Save workshop ───────────────────────────────────────────────────────
  const saveWorkshop = async () => {
    if (!form.name.trim())           return setFormError('Nome do workshop é obrigatório');
    if (!form.professor_name.trim()) return setFormError('Nome do professor é obrigatório');
    if (!form.data_inicio)           return setFormError('Data de início é obrigatória');
    if (Number(form.preco_padrao) < 0) return setFormError('Preço padrão inválido');
    if (form.gratis_para_inscritos && !form.event_id) {
      return setFormError('"Grátis para inscritos" só funciona com workshop atrelado a um evento');
    }
    if (form.duracao_minutos !== '' && Number(form.duracao_minutos) < 0) {
      return setFormError('Duração inválida');
    }
    if (form.capacidade_max !== '' && Number(form.capacidade_max) < 1) {
      return setFormError('Capacidade deve ser pelo menos 1');
    }

    setSaving(true);
    setFormError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return setFormError('Sessão expirada'); }

    const payload = {
      event_id: form.event_id || null,
      created_by: user.id,
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      description: form.description.trim() || null,
      cover_url: form.cover_url.trim() || null,
      professor_name: form.professor_name.trim(),
      professor_bio: form.professor_bio.trim() || null,
      professor_bio_short: form.professor_bio_short.trim() || null,
      professor_photo_url: form.professor_photo_url.trim() || null,
      professor_instagram: form.professor_instagram.trim() || null,
      professor_site_url: form.professor_site_url.trim() || null,
      professor_is_public: form.professor_is_public,
      modalidade: form.modalidade.trim() || null,
      nivel: form.nivel,
      data_inicio: new Date(form.data_inicio).toISOString(),
      data_fim: form.data_fim ? new Date(form.data_fim).toISOString() : null,
      duracao_minutos: form.duracao_minutos === '' ? null : Number(form.duracao_minutos),
      local: form.local.trim() || null,
      capacidade_max: form.capacidade_max === '' ? null : Number(form.capacidade_max),
      preco_padrao: Number(form.preco_padrao),
      preco_inscritos_mostra: form.preco_inscritos_mostra === '' ? null : Number(form.preco_inscritos_mostra),
      gratis_para_inscritos: form.gratis_para_inscritos,
      auto_detect_combo: form.auto_detect_combo,
      workshop_commission_percent: Number(form.workshop_commission_percent),
      workshop_fee_mode: form.workshop_fee_mode,
      workshop_max_per_cpf: Number(form.workshop_max_per_cpf),
      is_published: form.is_published,
    };

    const { error } = editingId
      ? await supabase.from('workshops').update(payload).eq('id', editingId)
      : await supabase.from('workshops').insert(payload);

    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setShowModal(false);
    setFeedback({ kind: 'ok', msg: editingId ? 'Workshop atualizado' : 'Workshop criado' });
    refresh();
  };

  const togglePublish = async (w: WorkshopRow) => {
    const { error } = await supabase
      .from('workshops')
      .update({ is_published: !w.is_published })
      .eq('id', w.id);
    if (error) {
      setFeedback({ kind: 'err', msg: error.message });
    } else {
      setFeedback({ kind: 'ok', msg: w.is_published ? 'Workshop despublicado' : 'Workshop publicado' });
      refresh();
    }
  };

  const removeWorkshop = async (w: WorkshopRow) => {
    if (!confirm(`Remover "${w.name}"? Inscrições associadas serão apagadas em cascata.`)) return;
    const { error } = await supabase.from('workshops').delete().eq('id', w.id);
    if (error) {
      setFeedback({ kind: 'err', msg: error.message });
    } else {
      setFeedback({ kind: 'ok', msg: 'Workshop removido' });
      refresh();
    }
  };

  const filteredEvents = useMemo(() => events, [events]);

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b0b0f] py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">

        <VendasTabs />

        {/* Header */}
        <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
              <GraduationCap className="text-[#ff0068]" size={28} />
              Workshops
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Crie e venda workshops independentes ou atrelados aos seus festivais. Suporta combo automático para inscritos da mostra.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-[#ff0068] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] transition"
          >
            <Plus size={16} />
            Novo workshop
          </button>
        </div>

        {/* Filtro de escopo */}
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500 dark:text-slate-400">Mostrar:</span>
          <button
            onClick={() => setSelectedScope('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${selectedScope === 'all' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-white/20'}`}
          >
            Todos
          </button>
          <button
            onClick={() => setSelectedScope('standalone')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${selectedScope === 'standalone' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-white/20'}`}
          >
            Sem evento (avulsos)
          </button>
          {filteredEvents.map(ev => (
            <button
              key={ev.id}
              onClick={() => setSelectedScope(ev.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${selectedScope === ev.id ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-white/20'}`}
            >
              {ev.name}
            </button>
          ))}
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`mb-4 rounded-xl border p-3 text-sm flex items-center gap-2 ${feedback.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'}`}>
            {feedback.kind === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {feedback.msg}
          </div>
        )}

        {/* Lista */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
        ) : workshops.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-white/10 p-12 text-center">
            <GraduationCap size={40} className="mx-auto text-slate-400 mb-3" />
            <p className="text-slate-600 dark:text-slate-300 font-bold">Nenhum workshop ainda</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5">Crie seu primeiro workshop em segundos.</p>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-[#ff0068] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] transition"
            >
              <Plus size={16} />
              Criar primeiro workshop
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {workshops.map(w => {
              const wsLots = lots[w.id] ?? [];
              const activeLot = wsLots.find(l => l.is_active &&
                (!l.data_inicio || new Date(l.data_inicio) <= new Date()) &&
                (!l.data_fim     || new Date(l.data_fim)     >= new Date()));
              const eventName = events.find(e => e.id === w.event_id)?.name;
              return (
                <div key={w.id} className="rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {w.is_published ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full"><Globe size={10} />Publicado</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-slate-500/15 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full"><EyeOff size={10} />Rascunho</span>
                        )}
                        {eventName && <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">📌 {eventName}</span>}
                        {!w.event_id && <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Avulso</span>}
                        {w.gratis_para_inscritos && <span className="text-[10px] font-black uppercase tracking-wider bg-violet-500/15 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">Grátis p/ inscritos</span>}
                        {/* Indicador explícito quando preço efetivo é zero (workshop totalmente
                            gratuito, não só pra inscritos). Sem isso o card mostrava só "R$ 0,00"
                            que confunde — ambiguidade entre "não cadastrei preço" e "é grátis".
                            Decisão 2026-05-28: bandeira emerald explícita pra paralelismo com a
                            política "Gratuito" dos ingressos. */}
                        {(activeLot?.preco ?? w.preco_padrao ?? 0) === 0 && !w.gratis_para_inscritos && (
                          <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">Gratuito</span>
                        )}
                      </div>
                      <h3 className="text-xl font-black text-slate-900 dark:text-white">{w.name}</h3>
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1"><User size={12} />{w.professor_name}</span>
                        {w.modalidade && <span className="inline-flex items-center gap-1"><Tag size={12} />{w.modalidade}</span>}
                        <span className="inline-flex items-center gap-1"><Calendar size={12} />{fmtDate(w.data_inicio)}</span>
                        {w.local && <span className="inline-flex items-center gap-1"><MapPin size={12} />{w.local}</span>}
                        {w.duracao_minutos && <span className="inline-flex items-center gap-1"><Clock size={12} />{w.duracao_minutos} min</span>}
                        {w.capacidade_max && <span className="inline-flex items-center gap-1"><Users size={12} />Cap: {w.capacidade_max}</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                        <span className="font-black text-slate-900 dark:text-white">{fmtCurrency(activeLot?.preco ?? w.preco_padrao)}</span>
                        {activeLot && <span className="text-[10px] font-bold uppercase tracking-wider text-[#ff0068]">{activeLot.nome}</span>}
                        {w.preco_inscritos_mostra != null && (
                          <span className="text-xs text-violet-600 dark:text-violet-400">↓ {fmtCurrency(w.preco_inscritos_mostra)} p/ inscritos</span>
                        )}
                        <span className="text-xs text-slate-500 dark:text-slate-500">· {wsLots.length} lote(s)</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setShowLotsModal(w)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                      >
                        <Layers size={12} />Lotes
                      </button>
                      <button
                        onClick={() => setShowBuyersModal(w)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                      >
                        <ShoppingCart size={12} />Compradores
                      </button>
                      <button
                        onClick={() => togglePublish(w)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${w.is_published ? 'border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                      >
                        {w.is_published ? <><EyeOff size={12} />Despublicar</> : <><Globe size={12} />Publicar</>}
                      </button>
                      <button
                        onClick={() => openEdit(w)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                      >
                        <Pencil size={12} />Editar
                      </button>
                      <button
                        onClick={() => removeWorkshop(w)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
                      >
                        <Trash2 size={12} />Remover
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal create/edit */}
      {showModal && (
        <WorkshopFormModal
          form={form}
          setForm={setForm}
          formError={formError}
          saving={saving}
          isEdit={!!editingId}
          events={events}
          judges={judges}
          onClose={() => setShowModal(false)}
          onSave={saveWorkshop}
        />
      )}

      {/* Modal de lotes */}
      {showLotsModal && (
        <LotsModal
          workshop={showLotsModal}
          otherWorkshops={workshops.filter(w => w.id !== showLotsModal.id)}
          onClose={() => { setShowLotsModal(null); refresh(); }}
        />
      )}

      {/* Modal de compradores */}
      {showBuyersModal && (
        <BuyersModal
          workshop={showBuyersModal}
          onClose={() => setShowBuyersModal(null)}
        />
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Modal: lista de compradores do workshop
// ════════════════════════════════════════════════════════════════════════════
interface BuyerRow {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_cpf: string;
  buyer_phone: string | null;
  preco_pago: number;
  status_pagamento: 'PENDENTE' | 'APROVADO' | 'CANCELADO' | 'VENCIDO' | 'ESTORNADO' | 'CORTESIA' | 'GRATUITO';
  payment_method: string | null;
  paid_at: string | null;
  is_combo: boolean;
  attended: boolean;
  attended_at: string | null;
  created_at: string;
  refunded_at: string | null;
  refund_amount: number | null;
  lot_nome: string | null;
}

const onlyDigits = (v: string) => v.replace(/\D/g, '');
const maskCPF = (v: string) => {
  const d = onlyDigits(v).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

const STATUS_LABEL: Record<BuyerRow['status_pagamento'], { label: string; cls: string }> = {
  APROVADO:  { label: 'Aprovado',  cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
  PENDENTE:  { label: 'Pendente',  cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' },
  VENCIDO:   { label: 'Vencido',   cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
  ESTORNADO: { label: 'Estornado', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
  CORTESIA:  { label: 'Cortesia',  cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20' },
  GRATUITO:  { label: 'Grátis',    cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20' },
};

const BuyersModal: React.FC<{ workshop: WorkshopRow; onClose: () => void }> = ({ workshop, onClose }) => {
  const [buyers, setBuyers] = useState<BuyerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | BuyerRow['status_pagamento']>('ALL');
  const [marking, setMarking] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  // Cortesia (convite gratuito direto, sem cupom — padrão Sympla/Eventbrite)
  const [courtesyOpen, setCourtesyOpen] = useState(false);
  const [courtesyForm, setCourtesyForm] = useState({ name: '', email: '', cpf: '', phone: '' });
  const [courtesySaving, setCourtesySaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('workshop_registrations')
      .select('id, buyer_name, buyer_email, buyer_cpf, buyer_phone, preco_pago, status_pagamento, payment_method, paid_at, is_combo, attended, attended_at, created_at, refunded_at, refund_amount, lot_nome')
      .eq('workshop_id', workshop.id)
      .order('created_at', { ascending: false });
    if (error) {
      setFeedback({ kind: 'err', msg: error.message });
    } else {
      setBuyers((data ?? []) as BuyerRow[]);
    }
    setLoading(false);
  }, [workshop.id]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const filtered = useMemo(() => {
    let list = buyers;
    if (statusFilter !== 'ALL') list = list.filter(b => b.status_pagamento === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(b =>
        b.buyer_name.toLowerCase().includes(q) ||
        b.buyer_email.toLowerCase().includes(q) ||
        onlyDigits(b.buyer_cpf).includes(onlyDigits(q))
      );
    }
    return list;
  }, [buyers, statusFilter, search]);

  const stats = useMemo(() => ({
    total: buyers.length,
    aprovados: buyers.filter(b => b.status_pagamento === 'APROVADO').length,
    pendentes: buyers.filter(b => b.status_pagamento === 'PENDENTE').length,
    presentes: buyers.filter(b => b.attended).length,
    receita: buyers.filter(b => b.status_pagamento === 'APROVADO').reduce((a, b) => a + Number(b.preco_pago || 0), 0),
  }), [buyers]);

  // Marca presença (pré-requisito pra emitir certificado).
  const toggleAttended = async (buyer: BuyerRow) => {
    setMarking(buyer.id);
    try {
      const newVal = !buyer.attended;
      const { data: { user } } = await supabase.auth.getUser();
      const { data: updated, error } = await supabase
        .from('workshop_registrations')
        .update({
          attended: newVal,
          attended_at: newVal ? new Date().toISOString() : null,
          attended_by: newVal ? user?.id ?? null : null,
        })
        .eq('id', buyer.id)
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error('Sem permissão pra marcar presença. Aplique as migrations 20260610-12.');
      }
      setBuyers(prev => prev.map(b => b.id === buyer.id
        ? { ...b, attended: newVal, attended_at: newVal ? new Date().toISOString() : null }
        : b));
      setFeedback({ kind: 'ok', msg: newVal ? 'Presença marcada' : 'Presença removida' });
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e.message ?? 'Erro ao marcar presença' });
    } finally {
      setMarking(null);
    }
  };

  const handleAddCourtesy = async () => {
    if (courtesySaving) return;
    const cpf = onlyDigits(courtesyForm.cpf);
    if (!courtesyForm.name.trim() || !courtesyForm.email.trim() || cpf.length !== 11) {
      setFeedback({ kind: 'err', msg: 'Preencha nome, e-mail e CPF válido.' });
      return;
    }
    setCourtesySaving(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('create-courtesy-entry', {
        body: {
          kind: 'workshop',
          workshop_id: workshop.id,
          buyer_name: courtesyForm.name.trim(),
          buyer_email: courtesyForm.email.trim(),
          buyer_cpf: cpf,
          buyer_phone: courtesyForm.phone.trim() || undefined,
        },
      });
      if (invokeErr) {
        let serverMsg: string | null = null;
        try {
          const resp = (invokeErr as any).context?.response;
          if (resp && typeof resp.json === 'function') serverMsg = (await resp.json())?.error ?? null;
        } catch { /* ignore */ }
        throw new Error(serverMsg ?? invokeErr.message ?? 'Falha ao criar cortesia');
      }
      if (data?.error) throw new Error(data.error);
      setCourtesyOpen(false);
      setCourtesyForm({ name: '', email: '', cpf: '', phone: '' });
      setFeedback({ kind: 'ok', msg: 'Cortesia adicionada' });
      await refresh();
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e.message ?? 'Erro ao criar cortesia' });
    } finally {
      setCourtesySaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-4xl max-h-[92dvh] sm:max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-white/10">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Compradores</p>
            <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white truncate">{workshop.name}</h3>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Stats */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total</p>
            <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{stats.total}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Aprovados</p>
            <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.aprovados}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Presentes</p>
            <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
              {stats.presentes} <span className="text-xs text-slate-500 font-bold">/{stats.aprovados}</span>
            </p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Receita</p>
            <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
              {stats.receita.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>
        </div>

        {/* Search + filtro */}
        <div className="px-5 sm:px-6 py-3 border-b border-slate-200 dark:border-white/10 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou CPF…"
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="px-4 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white outline-none dark:[color-scheme:dark]"
          >
            <option value="ALL"        className="bg-white dark:bg-slate-900">Todos</option>
            <option value="APROVADO"   className="bg-white dark:bg-slate-900">Aprovados</option>
            <option value="PENDENTE"   className="bg-white dark:bg-slate-900">Pendentes</option>
            <option value="ESTORNADO"  className="bg-white dark:bg-slate-900">Estornados</option>
            <option value="CORTESIA"   className="bg-white dark:bg-slate-900">Cortesia</option>
            <option value="GRATUITO"   className="bg-white dark:bg-slate-900">Grátis (combo)</option>
          </select>
          <button
            onClick={refresh}
            aria-label="Recarregar"
            className="p-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 hover:text-[#ff0068]"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => setCourtesyOpen(o => !o)}
            aria-expanded={courtesyOpen}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-500/10 border border-violet-500/30 text-violet-600 dark:text-violet-400 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap hover:bg-violet-500/20"
          >
            <Users size={13} /> Adicionar cortesia
          </button>
        </div>

        {courtesyOpen && (
          <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-violet-500/5 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400">
              Convite gratuito direto — sem cupom, sem cobrança Asaas
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="sr-only" htmlFor="ws-courtesy-name">Nome</label>
              <input
                id="ws-courtesy-name"
                value={courtesyForm.name}
                onChange={e => setCourtesyForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nome"
                className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
              />
              <label className="sr-only" htmlFor="ws-courtesy-email">E-mail</label>
              <input
                id="ws-courtesy-email"
                type="email"
                value={courtesyForm.email}
                onChange={e => setCourtesyForm(f => ({ ...f, email: e.target.value }))}
                placeholder="E-mail"
                className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
              />
              <label className="sr-only" htmlFor="ws-courtesy-cpf">CPF</label>
              <input
                id="ws-courtesy-cpf"
                value={courtesyForm.cpf}
                onChange={e => setCourtesyForm(f => ({ ...f, cpf: maskCPF(e.target.value) }))}
                placeholder="CPF"
                className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
              />
              <label className="sr-only" htmlFor="ws-courtesy-phone">Telefone</label>
              <input
                id="ws-courtesy-phone"
                value={courtesyForm.phone}
                onChange={e => setCourtesyForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="Telefone (opcional)"
                className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCourtesyOpen(false)}
                disabled={courtesySaving}
                className="px-4 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-widest"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddCourtesy}
                disabled={courtesySaving}
                className="px-4 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1.5"
              >
                {courtesySaving ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
                {courtesySaving ? 'Salvando...' : 'Confirmar cortesia'}
              </button>
            </div>
          </div>
        )}

        {feedback && (
          <div className={`mx-5 sm:mx-6 mt-3 p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
            feedback.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20'
          }`}>
            {feedback.kind === 'ok' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {feedback.msg}
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <ShoppingCart size={32} className="text-slate-300 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-500">
                {buyers.length === 0 ? 'Nenhum comprador ainda' : 'Nenhum resultado'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(b => {
                const status = STATUS_LABEL[b.status_pagamento];
                return (
                  <div key={b.id} className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`inline-flex items-center text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${status.cls}`}>
                            {status.label}
                          </span>
                          {b.is_combo && (
                            <span className="inline-flex items-center text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                              Combo
                            </span>
                          )}
                          {b.attended && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                              <UserCheck size={9} /> Presente
                            </span>
                          )}
                          {b.lot_nome && (
                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{b.lot_nome}</span>
                          )}
                        </div>
                        <p className="text-sm font-black text-slate-900 dark:text-white truncate">{b.buyer_name}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 mt-0.5">
                          <span className="inline-flex items-center gap-1"><Mail size={10} />{b.buyer_email}</span>
                          <span>CPF {maskCPF(b.buyer_cpf)}</span>
                          {b.buyer_phone && <span>{b.buyer_phone}</span>}
                          <span>{new Date(b.created_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                          {Number(b.preco_pago).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                        {b.payment_method && (
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{b.payment_method}</p>
                        )}
                        {b.refunded_at && (
                          <p className="text-[9px] font-bold uppercase tracking-widest text-rose-500 mt-0.5">
                            Estornado{b.refund_amount != null && ` R$ ${Number(b.refund_amount).toFixed(2)}`}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    {(b.status_pagamento === 'APROVADO' || b.status_pagamento === 'GRATUITO' || b.status_pagamento === 'CORTESIA') && !b.refunded_at && (
                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
                        <button
                          onClick={() => toggleAttended(b)}
                          disabled={marking === b.id}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                            b.attended
                              ? 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
                              : 'bg-[#ff0068] text-white hover:bg-[#d4005a]'
                          }`}
                        >
                          {marking === b.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <UserCheck size={12} />}
                          {b.attended ? 'Remover presença' : 'Marcar presente'}
                        </button>
                        <a
                          href={`mailto:${b.buyer_email}?subject=${encodeURIComponent(`[${workshop.name}] Sobre seu workshop`)}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] transition-all"
                        >
                          <Mail size={12} /> Email
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Modal: form de workshop
// ════════════════════════════════════════════════════════════════════════════
interface WorkshopFormModalProps {
  form: any; setForm: any; formError: string | null; saving: boolean;
  isEdit: boolean; events: EventOption[]; judges: JudgeOption[];
  onClose: () => void; onSave: () => void;
}

const WorkshopFormModal: React.FC<WorkshopFormModalProps> = ({ form, setForm, formError, saving, isEdit, events, judges, onClose, onSave }) => {
  const upd = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  // Reaproveitar jurado já cadastrado como professor (snapshot/cópia — não
  // vincula). Pré-preenche nome/foto/bio/@; campos seguem editáveis depois.
  const applyJudge = (judgeId: string) => {
    const j = judges.find(x => x.id === judgeId);
    if (!j) return;
    setForm((p: any) => ({
      ...p,
      professor_name:        j.name ?? p.professor_name,
      professor_photo_url:   j.avatar_url ?? p.professor_photo_url,
      professor_bio:         j.mini_bio ?? p.professor_bio,
      professor_bio_short:   (j.mini_bio ?? '').slice(0, 140) || p.professor_bio_short,
      professor_instagram:   j.instagram ?? p.professor_instagram,
    }));
  };

  // Audit T3: ESC fecha + lock body scroll
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Upload de foto do professor (mesmo padrão de JudgesManagement: comprime
  // pra webp 320px e salva como base64 inline — não depende de bucket).
  // Usado quando o professor não é jurado já cadastrado (caso comum).
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const handlePhotoUpload = async (file: File) => {
    if (!file) return;
    setPhotoUploading(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.15,
        maxWidthOrHeight: 320,
        useWebWorker: true,
        fileType: 'image/webp',
      });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });
      upd('professor_photo_url', base64);
    } catch (e) {
      console.warn('Falha ao processar foto do professor:', e);
    } finally {
      setPhotoUploading(false);
    }
  };

  // Upload de capa do workshop (estilo Sympla — 16:9 1200×675).
  // Mesmo padrão: comprime e salva base64 inline, sem depender de bucket.
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const handleCoverUpload = async (file: File) => {
    if (!file) return;
    setCoverUploading(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.3,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
        fileType: 'image/webp',
      });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });
      upd('cover_url', base64);
    } catch (e) {
      console.warn('Falha ao processar capa do workshop:', e);
    } finally {
      setCoverUploading(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="workshop-form-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-3xl w-full shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 id="workshop-form-title" className="text-lg sm:text-xl font-black text-slate-900 dark:text-white truncate">{isEdit ? 'Editar workshop' : 'Novo workshop'}</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg shrink-0"><X size={18} /></button>
        </div>

        {formError && (
          <div className="mx-5 sm:mx-6 mt-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-3 text-sm text-rose-700 dark:text-rose-200 flex items-center gap-2 shrink-0">
            <AlertCircle size={16} />{formError}
          </div>
        )}

        <div className="space-y-5 overflow-y-auto px-5 sm:px-6 py-5 flex-1">
          {/* Vínculo com evento */}
          <Section title="Vínculo">
            <Field label="Evento (opcional — deixe vazio para workshop avulso)">
              <select value={form.event_id} onChange={e => upd('event_id', e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-white/10 dark:bg-slate-800 dark:text-white px-3 py-2 text-sm">
                <option value="">— Sem evento (avulso) —</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </Field>
          </Section>

          {/* Identidade */}
          <Section title="Identidade">
            <Field label="Nome do workshop *">
              <input value={form.name} onChange={e => upd('name', e.target.value)} className={inputCls} placeholder="Ex: Jazz Funk Intensivo com Maria Silva" />
            </Field>
            <Field label="Slug (URL pública). Opcional, gerado automático.">
              <input value={form.slug} onChange={e => upd('slug', e.target.value)} className={inputCls} placeholder="jazz-funk-intensivo" />
            </Field>
            <Field label="Descrição">
              <textarea value={form.description} onChange={e => upd('description', e.target.value)} rows={3} className={inputCls} placeholder="O que o aluno vai aprender, pré-requisitos, materiais..." />
            </Field>
            <Field label="Capa do workshop (recomendado 1200×675px, proporção 16:9)">
              <div className="flex items-start gap-4">
                <div className="relative shrink-0 w-32 aspect-video rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-white/10">
                  {form.cover_url ? (
                    <img src={form.cover_url} alt="capa do workshop" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-600">
                      <ImageIcon size={20} />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={coverUploading}
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#ff0068] text-white flex items-center justify-center shadow-lg ring-2 ring-white dark:ring-slate-900 hover:scale-110 transition-transform"
                    title={form.cover_url ? 'Trocar capa' : 'Adicionar capa'}
                    aria-label={form.cover_url ? 'Trocar capa' : 'Adicionar capa'}
                  >
                    {coverUploading
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Camera size={12} />
                    }
                  </button>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => { if (e.target.files?.[0]) handleCoverUpload(e.target.files[0]); }}
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 flex-1">
                  Aparece no card da vitrine e no topo da página pública do workshop. Sem capa, usamos a foto do professor.
                </p>
              </div>
            </Field>
          </Section>

          {/* Professor */}
          <Section title="Professor">
            {/* Reaproveitar jurado já cadastrado — pré-preenche os campos abaixo
                (cópia, não vínculo). Evita recadastrar quem já é jurado do festival. */}
            {judges.length > 0 && (
              <Field label="Reaproveitar jurado cadastrado (opcional)">
                <select
                  defaultValue=""
                  onChange={e => { if (e.target.value) applyJudge(e.target.value); e.target.value = ''; }}
                  className={inputCls}
                >
                  <option value="">— Digitar manualmente —</option>
                  {judges.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </Field>
            )}
            {/* Foto + nome lado a lado em desktop, empilhado em mobile.
                Padrão JudgesManagement: avatar quadrado com Camera overlay no canto. */}
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <img
                  src={form.professor_photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(form.professor_name || 'professor')}`}
                  alt="avatar do professor"
                  className="w-16 h-16 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-white/10"
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#ff0068] text-white flex items-center justify-center shadow-lg ring-2 ring-white dark:ring-slate-900 hover:scale-110 transition-transform"
                  title={form.professor_photo_url ? 'Trocar foto' : 'Adicionar foto'}
                  aria-label={form.professor_photo_url ? 'Trocar foto' : 'Adicionar foto'}
                >
                  {photoUploading
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Camera size={12} />
                  }
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handlePhotoUpload(e.target.files[0]); }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <Field label="Nome do professor *">
                  <input value={form.professor_name} onChange={e => upd('professor_name', e.target.value)} className={inputCls} />
                </Field>
              </div>
            </div>
            <Field label="Bio curta (140 chars — aparece em cards)">
              <input value={form.professor_bio_short} onChange={e => upd('professor_bio_short', e.target.value)} maxLength={140} className={inputCls} />
            </Field>
            <Field label="Bio completa (modal)">
              <textarea value={form.professor_bio} onChange={e => upd('professor_bio', e.target.value)} rows={3} className={inputCls} />
            </Field>
            <Field label="Instagram (ex: @maria.dance)">
              <input value={form.professor_instagram} onChange={e => upd('professor_instagram', e.target.value)} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.professor_is_public} onChange={e => upd('professor_is_public', e.target.checked)} />
              Publicar PersonCard do professor na vitrine do evento
            </label>
          </Section>

          {/* Atividade + Logística */}
          <Section title="Atividade & logística">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Modalidade"><input value={form.modalidade} onChange={e => upd('modalidade', e.target.value)} className={inputCls} placeholder="Jazz, Hip-Hop, Ballet..." /></Field>
              <Field label="Nível">
                <select value={form.nivel} onChange={e => upd('nivel', e.target.value as Nivel)} className={inputCls}>
                  {NIVEIS.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select>
              </Field>
              <Field label="Início *"><input type="datetime-local" value={form.data_inicio} onChange={e => upd('data_inicio', e.target.value)} className={inputCls} /></Field>
              <Field label="Fim"><input type="datetime-local" value={form.data_fim} onChange={e => upd('data_fim', e.target.value)} className={inputCls} /></Field>
              <Field label="Duração (min)"><input type="number" value={form.duracao_minutos} onChange={e => upd('duracao_minutos', e.target.value)} className={inputCls} /></Field>
              <Field label="Capacidade máxima"><input type="number" value={form.capacidade_max} onChange={e => upd('capacidade_max', e.target.value)} className={inputCls} placeholder="vazio = ilimitado" /></Field>
              <Field label="Local">
                <input value={form.local} onChange={e => upd('local', e.target.value)} className={inputCls} placeholder="Estúdio X — Sala 2" />
              </Field>
            </div>
          </Section>

          {/* Pricing */}
          <Section title="Preços">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Preço padrão (R$) *"><input type="number" step="0.01" value={form.preco_padrao} onChange={e => upd('preco_padrao', e.target.value)} className={inputCls} /></Field>
              <Field label="Preço para inscritos da mostra (R$)">
                <input type="number" step="0.01" value={form.preco_inscritos_mostra} onChange={e => upd('preco_inscritos_mostra', e.target.value)} className={inputCls} placeholder="vazio = mesmo preço" />
              </Field>
            </div>
            {form.event_id && (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={form.gratis_para_inscritos} onChange={e => upd('gratis_para_inscritos', e.target.checked)} />
                  Grátis para inscritos da mostra (override do preço acima)
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={form.auto_detect_combo} onChange={e => upd('auto_detect_combo', e.target.checked)} className="mt-1" />
                  <span>
                    Detectar combo automaticamente pelo CPF (cruza com inscrições aprovadas)
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      Se desligado, comprador precisa pedir desconto manualmente
                    </span>
                  </span>
                </label>
              </>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              Lotes específicos com preços e datas ficam no botão "Lotes" depois de criar o workshop.
            </p>
          </Section>

          {/* Limites & taxas (comissão CoreoHub fica fora — só super admin edita) */}
          <Section title="Limites & taxas">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Modo da taxa">
                <select value={form.workshop_fee_mode} onChange={e => upd('workshop_fee_mode', e.target.value as FeeMode)} className={inputCls}>
                  <option value="repassar">Repassar ao comprador</option>
                  <option value="absorver">Absorver no preço</option>
                </select>
              </Field>
              <Field label="Limite por CPF"><input type="number" value={form.workshop_max_per_cpf} onChange={e => upd('workshop_max_per_cpf', e.target.value)} className={inputCls} /></Field>
            </div>
          </Section>

          {/* Publicação */}
          <Section title="Publicação">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.is_published} onChange={e => upd('is_published', e.target.checked)} />
              Publicar na vitrine pública (vendas ativas)
            </label>
          </Section>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-white/10 shrink-0 bg-white dark:bg-slate-900">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">Cancelar</button>
          <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#ff0068] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#ff1a78] disabled:opacity-50 transition">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? 'Salvar alterações' : 'Criar workshop'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Modal: gerenciar lotes do workshop
// ════════════════════════════════════════════════════════════════════════════
interface LotsModalProps { workshop: WorkshopRow; otherWorkshops: WorkshopRow[]; onClose: () => void }

const LotsModal: React.FC<LotsModalProps> = ({ workshop, otherWorkshops, onClose }) => {
  const [lots, setLotsLocal] = useState<LotRow[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  // Texto bruto dos campos numéricos enquanto o usuário digita — value
  // controlado vindo direto de Number(...) "comia" o ponto decimal a cada
  // tecla (ex: digitar "40." virava "40" antes do usuário terminar de
  // digitar os centavos). Guarda o texto literal aqui, só converte pra
  // Number quando salva.
  const [rawNumInputs, setRawNumInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set(otherWorkshops.map(w => w.id)));
  const [applyFeedback, setApplyFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('workshop_lots')
      .select('*')
      .eq('workshop_id', workshop.id)
      .order('ordem', { ascending: true });
    setLotsLocal(data ?? []);
    setDirtyIds(new Set());
    setRawNumInputs({});
    setLoading(false);
  }, [workshop.id]);
  useEffect(() => { refresh(); }, [refresh]);

  const addLot = async () => {
    const nextOrdem = lots.length === 0 ? 1 : Math.max(...lots.map(l => l.ordem)) + 1;
    setSaving(true);
    const { error } = await supabase.from('workshop_lots').insert({
      workshop_id: workshop.id,
      ordem: nextOrdem,
      nome: `${nextOrdem}º lote`,
      preco: workshop.preco_padrao,
      is_active: true,
    });
    setSaving(false);
    if (!error) refresh();
  };

  // Edição local — só vai pro banco quando "Salvar" é clicado.
  const editLot = (id: string, patch: Partial<LotRow>) => {
    setLotsLocal(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
    setDirtyIds(prev => new Set(prev).add(id));
    setSaveFeedback(null);
  };

  // Campos numéricos: mantém o texto literal digitado (rawNumInputs) pra não
  // perder o "." enquanto o usuário ainda está digitando os centavos, e só
  // grava o Number parseado em editLot quando o texto é um número válido.
  const editNumField = (lotId: string, field: 'preco' | 'preco_inscritos_mostra' | 'quantidade_maxima', raw: string) => {
    setRawNumInputs(prev => ({ ...prev, [`${lotId}__${field}`]: raw }));
    if (raw === '') {
      editLot(lotId, { [field]: field === 'preco' ? 0 : null } as Partial<LotRow>);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) editLot(lotId, { [field]: parsed } as Partial<LotRow>);
  };

  const getNumFieldValue = (lot: LotRow, field: 'preco' | 'preco_inscritos_mostra' | 'quantidade_maxima'): string => {
    const key = `${lot.id}__${field}`;
    if (key in rawNumInputs) return rawNumInputs[key];
    const value = lot[field];
    return value == null ? '' : String(value);
  };

  // Ativo/Remover seguem imediatos (ação de 1 clique, não texto digitado).
  const toggleActive = async (id: string, is_active: boolean) => {
    const { error } = await supabase.from('workshop_lots').update({ is_active }).eq('id', id);
    if (!error) refresh();
  };

  const removeLot = async (id: string) => {
    if (!confirm('Remover este lote?')) return;
    await supabase.from('workshop_lots').delete().eq('id', id);
    refresh();
  };

  const lotEditablePayload = (lot: LotRow) => ({
    nome: lot.nome,
    preco: lot.preco,
    preco_inscritos_mostra: lot.preco_inscritos_mostra,
    quantidade_maxima: lot.quantidade_maxima,
    data_inicio: lot.data_inicio,
    data_fim: lot.data_fim,
  });

  const saveAll = async () => {
    if (dirtyIds.size === 0) return;
    setSaving(true);
    setSaveFeedback(null);
    let ok = 0;
    const ids = Array.from(dirtyIds);
    for (const id of ids) {
      const lot = lots.find(l => l.id === id);
      if (!lot) continue;
      const { error } = await supabase.from('workshop_lots').update(lotEditablePayload(lot)).eq('id', id);
      if (!error) ok++;
    }
    setSaving(false);
    setSaveFeedback(ok === ids.length ? 'Alterações salvas.' : `Salvo ${ok} de ${ids.length} lote(s) — verifique erros.`);
    refresh();
  };

  const toggleTarget = (id: string) => {
    setSelectedTargets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const applyLotToOthers = async (lot: LotRow) => {
    const targets = otherWorkshops.filter(w => selectedTargets.has(w.id));
    if (targets.length === 0) return;
    setApplyingId(lot.id);
    setApplyFeedback(null);
    // Garante que o lote de origem está salvo antes de propagar (evita copiar edição não persistida).
    if (dirtyIds.has(lot.id)) {
      await supabase.from('workshop_lots').update(lotEditablePayload(lot)).eq('id', lot.id);
      setDirtyIds(prev => { const next = new Set(prev); next.delete(lot.id); return next; });
    }
    const payload = { ...lotEditablePayload(lot), ordem: lot.ordem, is_active: lot.is_active };
    let ok = 0;
    for (const target of targets) {
      const { data: existing } = await supabase
        .from('workshop_lots')
        .select('id')
        .eq('workshop_id', target.id)
        .eq('ordem', lot.ordem)
        .maybeSingle();
      const { error } = existing
        ? await supabase.from('workshop_lots').update(payload).eq('id', existing.id)
        : await supabase.from('workshop_lots').insert({ ...payload, workshop_id: target.id });
      if (!error) ok++;
    }
    setApplyingId(null);
    setApplyFeedback(`Lote "${lot.nome}" aplicado em ${ok} de ${targets.length} workshop(s).`);
  };

  // Audit T3: ESC fecha + lock body scroll
  const guardedClose = useCallback(() => {
    if (dirtyIds.size > 0 && !confirm('Você tem alterações não salvas nos lotes. Fechar sem salvar?')) return;
    onClose();
  }, [dirtyIds, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') guardedClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [guardedClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="workshop-lots-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      onClick={guardedClose}
    >
      <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-3xl w-full shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="min-w-0">
            <h2 id="workshop-lots-title" className="text-lg sm:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2"><Layers size={18} className="text-[#ff0068] shrink-0" />Lotes</h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">{workshop.name}</p>
          </div>
          <button onClick={guardedClose} aria-label="Fechar" className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg shrink-0"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={24} className="animate-spin text-[#ff0068]" /></div>
        ) : (
          <div className="space-y-3 overflow-y-auto px-5 sm:px-6 py-5 flex-1">
            {lots.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-6">
                Sem lotes. Sem lote ativo, o sistema usa o preço padrão do workshop ({fmtCurrency(workshop.preco_padrao)}).
              </p>
            )}

            {otherWorkshops.length > 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/15 p-3">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Aplicar lote em outros workshops</p>
                <div className="flex flex-wrap gap-2">
                  {otherWorkshops.map(w => (
                    <label key={w.id} className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1">
                      <input type="checkbox" checked={selectedTargets.has(w.id)} onChange={() => toggleTarget(w.id)} />
                      {w.name}
                    </label>
                  ))}
                </div>
                {applyFeedback && <p role="status" aria-live="polite" className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">{applyFeedback}</p>}
              </div>
            )}

            {lots.map(lot => (
              <div key={lot.id} className={`rounded-xl border p-4 bg-slate-50 dark:bg-white/5 ${dirtyIds.has(lot.id) ? 'border-amber-400 dark:border-amber-500/60' : 'border-slate-200 dark:border-white/10'}`}>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    Lote {lot.ordem}
                    {dirtyIds.has(lot.id) && <span className="text-amber-700 dark:text-amber-400 font-bold">· não salvo</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                      <input type="checkbox" checked={lot.is_active} onChange={e => toggleActive(lot.id, e.target.checked)} />
                      Ativo
                    </label>
                    {otherWorkshops.length > 0 && (
                      <button
                        onClick={() => applyLotToOthers(lot)}
                        disabled={applyingId === lot.id || selectedTargets.size === 0}
                        className="inline-flex items-center gap-1 text-xs font-bold text-[#ff0068] hover:bg-[#ff0068]/10 px-2 py-1 rounded-lg disabled:opacity-40"
                      >
                        {applyingId === lot.id ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
                        Aplicar nos outros
                      </button>
                    )}
                    <button onClick={() => removeLot(lot.id)} className="text-rose-500 hover:bg-rose-500/10 p-1 rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Nome">
                    <input value={lot.nome} onChange={e => editLot(lot.id, { nome: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Preço (R$)">
                    <input type="number" step="0.01" value={getNumFieldValue(lot, 'preco')} onChange={e => editNumField(lot.id, 'preco', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Preço inscritos (R$)">
                    <input type="number" step="0.01" value={getNumFieldValue(lot, 'preco_inscritos_mostra')} onChange={e => editNumField(lot.id, 'preco_inscritos_mostra', e.target.value)} className={inputCls} placeholder="vazio = sem desconto" />
                  </Field>
                  <Field label="Estoque (quantidade máx)">
                    <input type="number" value={getNumFieldValue(lot, 'quantidade_maxima')} onChange={e => editNumField(lot.id, 'quantidade_maxima', e.target.value)} className={inputCls} placeholder="vazio = sem limite" />
                  </Field>
                  <Field label="Início (vendas)">
                    <input type="datetime-local" value={toInputDateTime(lot.data_inicio)} onChange={e => editLot(lot.id, { data_inicio: e.target.value ? new Date(e.target.value).toISOString() : null })} className={inputCls} />
                  </Field>
                  <Field label="Fim (vendas)">
                    <input type="datetime-local" value={toInputDateTime(lot.data_fim)} onChange={e => editLot(lot.id, { data_fim: e.target.value ? new Date(e.target.value).toISOString() : null })} className={inputCls} />
                  </Field>
                </div>
              </div>
            ))}
            <button
              onClick={addLot}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/15 px-4 py-3 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Adicionar lote
            </button>
          </div>
        )}

        {!loading && (
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-white/10 shrink-0">
            <p role="status" aria-live="polite" className="text-xs text-slate-500 dark:text-slate-400">
              {saveFeedback ?? (dirtyIds.size > 0 ? `${dirtyIds.size} lote(s) com alterações não salvas.` : '')}
            </p>
            <button
              onClick={saveAll}
              disabled={saving || dirtyIds.size === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-[#ff0068] px-4 py-2.5 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Salvar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers de UI
// ────────────────────────────────────────────────────────────────────────────
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">{title}</h3>
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

export default WorkshopsManagement;
