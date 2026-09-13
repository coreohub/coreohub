import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabase';
import VendasTabs from '../components/VendasTabs';
import { resolveActiveWorkshopLot } from '../utils/lotes';
import imageCompression from 'browser-image-compression';
import {
  Plus, Trash2, Pencil, Calendar, Clock, MapPin, Loader2, X, AlertCircle, CheckCircle,
  GraduationCap, User, Tag, Layers, DollarSign, Users, Globe, EyeOff, Camera,
  ShoppingCart, Mail, RefreshCw, UserCheck, Search, Image as ImageIcon, Ticket, Sparkles,
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
  display_order: number | null;
  is_featured: boolean;
  featured_badge_text: string | null;
  hospedagem_delta: number | null;
  hospedagem_noites: string[] | null;
  camp_dias: string[] | null;
  early_arrival_delta: number | null;
  late_departure_delta: number | null;
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

// Subconjunto de workshop_registrations usado só pra agregar os KPIs do topo.
interface RegStat {
  workshop_id: string;
  status_pagamento: string;
  preco_pago: number | null;
  attended: boolean | null;
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
  // Inscrições das aulas visíveis (escopo atual) — alimenta a régua de KPIs
  // no topo. Agregação client-side, mesmo padrão de VendasOverview.
  const [regs, setRegs]                     = useState<RegStat[]>([]);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [feedback, setFeedback]             = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [showModal, setShowModal]           = useState(false);
  const [editingId, setEditingId]           = useState<string | null>(null);
  const [showLotsModal, setShowLotsModal]   = useState<WorkshopRow | null>(null);
  const [showLodgingModal, setShowLodgingModal] = useState(false);
  const [showDayCapacityModal, setShowDayCapacityModal] = useState(false);
  const [showDayOptionsModal, setShowDayOptionsModal] = useState<WorkshopRow | null>(null);
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
    display_order: '' as string | number,
    is_featured: false,
    featured_badge_text: '',
    hospedagem_delta: '' as string | number,
    hospedagem_noites: [] as string[], // datas YYYY-MM-DD, selecionadas via input date + chips
    camp_dias: [] as string[], // datas YYYY-MM-DD — capacidade diária combinada
    early_arrival_delta: '' as string | number,
    late_departure_delta: '' as string | number,
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

    // Carrega lots + inscrições em batch (workshop_registrations não tem
    // event_id direto — filtra por workshop_id das aulas visíveis).
    if (ws && ws.length > 0) {
      const ids = ws.map(w => w.id);
      const [{ data: lotData }, { data: regData }] = await Promise.all([
        supabase
          .from('workshop_lots')
          .select('*')
          .in('workshop_id', ids)
          .order('ordem', { ascending: true }),
        supabase
          .from('workshop_registrations')
          .select('workshop_id, status_pagamento, preco_pago, attended')
          .in('workshop_id', ids),
      ]);
      const grouped: Record<string, LotRow[]> = {};
      (lotData ?? []).forEach(l => {
        (grouped[l.workshop_id] ??= []).push(l);
      });
      setLots(grouped);
      setRegs((regData ?? []) as RegStat[]);
    } else {
      setLots({});
      setRegs([]);
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
      display_order: w.display_order ?? '',
      is_featured: w.is_featured,
      featured_badge_text: w.featured_badge_text ?? '',
      hospedagem_delta: w.hospedagem_delta ?? '',
      hospedagem_noites: Array.isArray(w.hospedagem_noites) ? w.hospedagem_noites : [],
      camp_dias: Array.isArray(w.camp_dias) ? w.camp_dias : [],
      early_arrival_delta: w.early_arrival_delta ?? '',
      late_departure_delta: w.late_departure_delta ?? '',
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
    const hospedagemNoitesParsed: string[] = form.hospedagem_noites ?? [];
    if (form.hospedagem_delta !== '' && hospedagemNoitesParsed.length === 0) {
      return setFormError('Informe as noites de hospedagem (ou limpe o valor do acréscimo)');
    }
    if (form.hospedagem_delta === '' && hospedagemNoitesParsed.length > 0) {
      return setFormError('Informe o valor do acréscimo de hospedagem (ou limpe as noites)');
    }
    const campDiasParsed: string[] = form.camp_dias ?? [];
    if (form.early_arrival_delta !== '' && form.hospedagem_delta === '') {
      return setFormError('Chegada antecipada exige hospedagem configurada nesse pass');
    }
    if (form.late_departure_delta !== '' && form.hospedagem_delta === '') {
      return setFormError('Saída estendida exige hospedagem configurada nesse pass');
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
      display_order: form.display_order === '' ? null : Number(form.display_order),
      is_featured: form.is_featured,
      featured_badge_text: form.is_featured ? (form.featured_badge_text.trim() || null) : null,
      hospedagem_delta: form.hospedagem_delta === '' ? null : Number(form.hospedagem_delta),
      hospedagem_noites: hospedagemNoitesParsed.length > 0 ? hospedagemNoitesParsed : null,
      camp_dias: campDiasParsed.length > 0 ? campDiasParsed : null,
      early_arrival_delta: form.early_arrival_delta === '' ? null : Number(form.early_arrival_delta),
      late_departure_delta: form.late_departure_delta === '' ? null : Number(form.late_departure_delta),
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

  // ── KPIs agregados do escopo atual ───────────────────────────────────────
  // "Vagas vendidas" inclui cortesia/combo grátis (ocupam vaga), mas só
  // APROVADO entra na receita (cortesia/grátis = R$ 0). Mesma regra do modal
  // de Compradores e da decisão 2026-06-19.
  const salesStats = useMemo(() => {
    const ocupa = (s: string) => s === 'APROVADO' || s === 'GRATUITO' || s === 'CORTESIA';
    const receita = regs
      .filter(r => r.status_pagamento === 'APROVADO')
      .reduce((acc, r) => acc + Number(r.preco_pago ?? 0), 0);
    const vagasVendidas = regs.filter(r => ocupa(r.status_pagamento)).length;
    const pendentes = regs.filter(r => r.status_pagamento === 'PENDENTE').length;
    const presentes = regs.filter(r => r.attended).length;
    const capacidadeTotal = workshops.reduce((acc, w) => acc + (w.capacidade_max ?? 0), 0);
    return { receita, vagasVendidas, pendentes, presentes, capacidadeTotal };
  }, [regs, workshops]);

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto">

        <VendasTabs />

        {/* Header */}
        <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 dark:text-white flex items-center gap-3">
              <GraduationCap className="text-[#ff0068]" size={28} />
              Workshops
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Crie e venda workshops independentes ou atrelados aos seus festivais. Suporta combo automático para inscritos da mostra.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedScope !== 'all' && selectedScope !== 'standalone' && (
              <button
                onClick={() => setShowLodgingModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/40 px-4 py-2.5 text-sm font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition"
              >
                Hospedagem do evento
              </button>
            )}
            {selectedScope !== 'all' && selectedScope !== 'standalone' && (
              <button
                onClick={() => setShowDayCapacityModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-500/10 border border-sky-500/40 px-4 py-2.5 text-sm font-bold text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 transition"
              >
                Capacidade diária
              </button>
            )}
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-[#ff0068] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] transition"
            >
              <Plus size={16} />
              Novo workshop
            </button>
          </div>
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

        {/* Régua de KPIs do escopo atual — padrão Eventbrite/Sympla:
            gestão + vendas na mesma tela. Espelha VendasIngressos. */}
        {!loading && workshops.length > 0 && (
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            <WsMetric icon={DollarSign} label="Receita" value={fmtCurrency(salesStats.receita)} sub="pagamentos aprovados" />
            <WsMetric
              icon={Users}
              label="Vagas vendidas"
              value={salesStats.capacidadeTotal > 0 ? `${salesStats.vagasVendidas} / ${salesStats.capacidadeTotal}` : String(salesStats.vagasVendidas)}
              sub={salesStats.capacidadeTotal > 0 ? `${Math.round((salesStats.vagasVendidas / salesStats.capacidadeTotal) * 100)}% lotado` : 'inclui cortesias'}
              tone="neutral"
            />
            <WsMetric icon={Clock} label="Pendentes" value={String(salesStats.pendentes)} sub="aguardando pagamento" tone="warn" />
            <WsMetric icon={UserCheck} label="Presenças" value={`${salesStats.presentes} / ${salesStats.vagasVendidas}`} sub="check-ins confirmados" tone="neutral" />
          </div>
        )}

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
              const activeLot = resolveActiveWorkshopLot(wsLots);
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
                        onClick={() => setShowDayOptionsModal(w)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                      >
                        <Calendar size={12} />Dias
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

      {/* Modal de hospedagem do evento (pool de vagas por noite) */}
      {showLodgingModal && selectedScope !== 'all' && selectedScope !== 'standalone' && (
        <LodgingNightsModal
          eventId={selectedScope}
          onClose={() => setShowLodgingModal(false)}
        />
      )}

      {/* Modal de capacidade diária combinada (teto por dia, somando todos os passes) */}
      {showDayCapacityModal && selectedScope !== 'all' && selectedScope !== 'standalone' && (
        <DayCapacityModal
          eventId={selectedScope}
          onClose={() => setShowDayCapacityModal(false)}
        />
      )}

      {/* Modal de dias disponíveis (Day Pass) — por workshop */}
      {showDayOptionsModal && (
        <DayOptionsModal
          workshop={showDayOptionsModal}
          onClose={() => setShowDayOptionsModal(null)}
        />
      )}

      {/* Passes (Day Pass/Full Pass) — só faz sentido dentro de 1 evento
          específico, já que agrupa workshops desse mesmo festival. */}
      {selectedScope !== 'all' && selectedScope !== 'standalone' && (
        <PassesSection
          eventId={selectedScope}
          workshopsInEvent={workshops}
        />
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Card de métrica do topo (mesmo padrão visual de VendasIngressos)
// ════════════════════════════════════════════════════════════════════════════
// `tone`: rosa só pro número-estrela (receita); âmbar pra pendência real;
// cinza neutro pro resto (achado 2026-08-08/09).
const WsMetric: React.FC<{ icon: React.ElementType; label: string; value: string; sub?: string; tone?: 'brand' | 'neutral' | 'warn' }> = ({ icon: Icon, label, value, sub, tone = 'brand' }) => (
  <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
    <div className={`p-2 rounded-xl inline-flex mb-2 ${
      tone === 'warn'    ? 'bg-amber-500/10 text-amber-500' :
      tone === 'neutral' ? 'bg-slate-200/60 dark:bg-white/10 text-slate-500 dark:text-slate-400' :
                            'bg-[#ff0068]/10 text-[#ff0068]'
    }`}>
      <Icon size={16} aria-hidden />
    </div>
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    <p className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white tabular-nums">{value}</p>
    {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
  </div>
);

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
// Modal: hospedagem do evento — pool de vagas por noite, compartilhado entre
// todos os passes/workshops do evento (quem marca "incluir hospedagem" em
// qualquer produto disputa o mesmo quarto de hotel na mesma data).
// ════════════════════════════════════════════════════════════════════════════
interface LodgingNight {
  id: string;
  night_date: string;
  capacity_max: number;
}
interface LodgingStockRow {
  night_date: string;
  capacity_max: number;
  ocupadas: number;
  restantes: number;
  esgotado: boolean;
}
interface LodgingGuest {
  registration_id: string;
  buyer_name: string;
  buyer_cpf: string;
  buyer_email: string;
  buyer_phone: string | null;
  workshop_name: string;
  night_date: string;
  early_arrival: boolean;
  late_departure: boolean;
}

const LodgingNightsModal: React.FC<{ eventId: string; onClose: () => void }> = ({ eventId, onClose }) => {
  const [nights, setNights] = useState<LodgingNight[]>([]);
  const [stock, setStock] = useState<Record<string, LodgingStockRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newCap, setNewCap] = useState<string | number>('');
  // Ver/exportar hóspedes por noite (pedido da Lorrayne: quantas pessoas e
  // quem são, pra ela organizar diretamente com o hotel).
  const [showGuests, setShowGuests] = useState(false);
  const [guests, setGuests] = useState<LodgingGuest[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: nightsData, error: nErr }, { data: stockData }] = await Promise.all([
      supabase.from('event_lodging_nights').select('id, night_date, capacity_max').eq('event_id', eventId).order('night_date'),
      supabase.rpc('get_lodging_stock', { p_event_id: eventId }),
    ]);
    if (nErr) setError(nErr.message);
    setNights(nightsData ?? []);
    const byNight: Record<string, LodgingStockRow> = {};
    (stockData ?? []).forEach((r: LodgingStockRow) => { byNight[r.night_date] = r; });
    setStock(byNight);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { refresh(); }, [refresh]);

  const loadGuests = useCallback(async () => {
    setLoadingGuests(true);
    try {
      const { data: wsData } = await supabase.from('workshops').select('id, name').eq('event_id', eventId);
      const wsIds = (wsData ?? []).map(w => w.id);
      const wsNameById: Record<string, string> = {};
      (wsData ?? []).forEach(w => { wsNameById[w.id] = w.name; });
      if (wsIds.length === 0) { setGuests([]); return; }

      const { data: regs } = await supabase
        .from('workshop_registrations')
        .select('id, buyer_name, buyer_cpf, buyer_email, buyer_phone, workshop_id, early_arrival, late_departure')
        .in('workshop_id', wsIds)
        .eq('inclui_hospedagem', true)
        .in('status_pagamento', ['APROVADO', 'GRATUITO', 'CORTESIA']);
      const regIds = (regs ?? []).map(r => r.id);
      if (regIds.length === 0) { setGuests([]); return; }

      const { data: nightsData } = await supabase
        .from('workshop_registration_lodging_nights')
        .select('workshop_registration_id, night_date')
        .in('workshop_registration_id', regIds);

      const regById: Record<string, any> = {};
      (regs ?? []).forEach(r => { regById[r.id] = r; });

      const rows: LodgingGuest[] = (nightsData ?? []).map(n => {
        const r = regById[n.workshop_registration_id] as any;
        return {
          registration_id: n.workshop_registration_id,
          buyer_name: r?.buyer_name ?? '',
          buyer_cpf: r?.buyer_cpf ?? '',
          buyer_email: r?.buyer_email ?? '',
          buyer_phone: r?.buyer_phone ?? null,
          workshop_name: wsNameById[r?.workshop_id] ?? '',
          night_date: n.night_date,
          early_arrival: !!r?.early_arrival,
          late_departure: !!r?.late_departure,
        };
      });
      rows.sort((a, b) => a.night_date.localeCompare(b.night_date) || a.buyer_name.localeCompare(b.buyer_name));
      setGuests(rows);
    } finally {
      setLoadingGuests(false);
    }
  }, [eventId]);

  const toggleGuests = () => {
    const next = !showGuests;
    setShowGuests(next);
    if (next && guests.length === 0) loadGuests();
  };

  const exportGuestsCsv = () => {
    const header = ['Noite', 'Nome', 'Documento', 'E-mail', 'Telefone', 'Passe', 'Chegada antecipada', 'Saída estendida'];
    const lines = guests.map(g => [
      g.night_date,
      g.buyer_name,
      g.buyer_cpf,
      g.buyer_email,
      g.buyer_phone ?? '',
      g.workshop_name,
      g.early_arrival ? 'sim' : 'não',
      g.late_departure ? 'sim' : 'não',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hospedagem-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const addNight = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return setError('Data inválida');
    if (newCap === '' || Number(newCap) < 0) return setError('Capacidade inválida');
    setSaving(true);
    const { error: insErr } = await supabase.from('event_lodging_nights').insert({
      event_id: eventId, night_date: newDate, capacity_max: Number(newCap),
    });
    setSaving(false);
    if (insErr) return setError(insErr.message.includes('duplicate') ? 'Essa noite já está cadastrada' : insErr.message);
    setNewDate(''); setNewCap('');
    refresh();
  };

  const updateCapacity = async (id: string, cap: number) => {
    if (cap < 0) return;
    const { error: updErr } = await supabase.from('event_lodging_nights').update({ capacity_max: cap }).eq('id', id);
    if (updErr) setError(updErr.message);
    else refresh();
  };

  const removeNight = async (id: string) => {
    const { error: delErr } = await supabase.from('event_lodging_nights').delete().eq('id', id);
    if (delErr) setError(delErr.message);
    else refresh();
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="lodging-modal-title" className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-xl w-full shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div>
            <h2 id="lodging-modal-title" className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">Hospedagem do evento</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Vagas de hotel por noite — compartilhadas entre todos os passes que oferecem hospedagem.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg shrink-0"><X size={18} /></button>
        </div>

        {error && (
          <div className="mx-5 sm:mx-6 mt-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-3 text-sm text-rose-700 dark:text-rose-200 flex items-center gap-2 shrink-0">
            <AlertCircle size={16} />{error}
          </div>
        )}

        <div className="overflow-y-auto px-5 sm:px-6 py-4 flex-1 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-slate-400" size={24} /></div>
          ) : nights.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma noite cadastrada ainda. Adicione abaixo cada data que o hotel cobre, com o total de vagas disponíveis nela.</p>
          ) : (
            <div className="space-y-2">
              {nights.map(n => {
                const s = stock[n.night_date];
                return (
                  <div key={n.id} className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white w-28 shrink-0">
                      {new Date(n.night_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </span>
                    <input
                      type="number"
                      defaultValue={n.capacity_max}
                      onBlur={e => { const v = Number(e.target.value); if (v !== n.capacity_max) updateCapacity(n.id, v); }}
                      className="w-20 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-2 py-1 text-sm"
                    />
                    <span className={`text-xs font-bold shrink-0 ${s?.esgotado ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>
                      {s ? `${s.ocupadas}/${s.capacity_max} ocupadas${s.esgotado ? ' · esgotado' : ''}` : '0 ocupadas'}
                    </span>
                    <button onClick={() => removeNight(n.id)} aria-label={`Remover noite ${n.night_date}`} className="ml-auto p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
            <label className="block flex-1">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Data (noite)</span>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-3 py-2 text-sm" />
            </label>
            <label className="block w-28">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Vagas</span>
              <input type="number" value={newCap} onChange={e => setNewCap(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-3 py-2 text-sm" />
            </label>
            <button onClick={addNight} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0068] px-4 py-2 text-sm font-bold text-white hover:bg-[#ff1a78] disabled:opacity-50 transition">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Adicionar
            </button>
          </div>

          {/* Ver/exportar hóspedes — pra ela organizar direto com o hotel */}
          <div className="pt-3 border-t border-slate-200 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={toggleGuests}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-[#ff0068]"
              >
                {showGuests ? 'Ocultar hóspedes' : 'Ver hóspedes por noite'}
              </button>
              {showGuests && guests.length > 0 && (
                <button
                  onClick={exportGuestsCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
                >
                  Exportar CSV
                </button>
              )}
            </div>
            {showGuests && (
              loadingGuests ? (
                <div className="flex justify-center py-6"><Loader2 className="animate-spin text-slate-400" size={20} /></div>
              ) : guests.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">Ninguém com hospedagem confirmada ainda.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 dark:text-slate-400">
                        <th className="pr-3 py-1 font-bold">Noite</th>
                        <th className="pr-3 py-1 font-bold">Nome</th>
                        <th className="pr-3 py-1 font-bold">Passe</th>
                        <th className="pr-3 py-1 font-bold">Contato</th>
                        <th className="pr-3 py-1 font-bold">Extras</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guests.map((g, i) => (
                        <tr key={`${g.registration_id}-${g.night_date}`} className={i % 2 === 0 ? '' : 'bg-slate-50 dark:bg-white/5'}>
                          <td className="pr-3 py-1 whitespace-nowrap font-bold text-slate-900 dark:text-white">
                            {new Date(g.night_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                          </td>
                          <td className="pr-3 py-1">{g.buyer_name}</td>
                          <td className="pr-3 py-1">{g.workshop_name}</td>
                          <td className="pr-3 py-1 text-slate-500 dark:text-slate-400">{g.buyer_email}</td>
                          <td className="pr-3 py-1 text-slate-500 dark:text-slate-400">
                            {g.early_arrival && 'chegada+ '}{g.late_departure && 'saída+'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-white/10 shrink-0 bg-white dark:bg-slate-900">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">Fechar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Modal: capacidade diária COMBINADA do evento — teto de participantes por
// dia-calendário, somando TODOS os passes que ocupam aquele dia (Experience+
// Week+Final+Day+Single Class). Mesmo padrão de LodgingNightsModal, só que
// pra presença no camp em vez de noite de hotel.
// ════════════════════════════════════════════════════════════════════════════
interface DayCapacityRow { id: string; day_date: string; capacity_max: number }
interface DayCapacityStockRow { day_date: string; capacity_max: number; ocupadas: number; restantes: number; esgotado: boolean }

const DayCapacityModal: React.FC<{ eventId: string; onClose: () => void }> = ({ eventId, onClose }) => {
  const [days, setDays] = useState<DayCapacityRow[]>([]);
  const [stock, setStock] = useState<Record<string, DayCapacityStockRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newCap, setNewCap] = useState<string | number>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: daysData, error: dErr }, { data: stockData }] = await Promise.all([
      supabase.from('event_day_capacity').select('id, day_date, capacity_max').eq('event_id', eventId).order('day_date'),
      supabase.rpc('get_event_day_stock', { p_event_id: eventId }),
    ]);
    if (dErr) setError(dErr.message);
    setDays(daysData ?? []);
    const byDay: Record<string, DayCapacityStockRow> = {};
    (stockData ?? []).forEach((r: DayCapacityStockRow) => { byDay[r.day_date] = r; });
    setStock(byDay);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const addDay = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return setError('Data inválida');
    if (newCap === '' || Number(newCap) < 0) return setError('Capacidade inválida');
    setSaving(true);
    const { error: insErr } = await supabase.from('event_day_capacity').insert({
      event_id: eventId, day_date: newDate, capacity_max: Number(newCap),
    });
    setSaving(false);
    if (insErr) return setError(insErr.message.includes('duplicate') ? 'Esse dia já está cadastrado' : insErr.message);
    setNewDate(''); setNewCap('');
    refresh();
  };

  const updateCapacity = async (id: string, cap: number) => {
    if (cap < 0) return;
    const { error: updErr } = await supabase.from('event_day_capacity').update({ capacity_max: cap }).eq('id', id);
    if (updErr) setError(updErr.message);
    else refresh();
  };

  const removeDay = async (id: string) => {
    const { error: delErr } = await supabase.from('event_day_capacity').delete().eq('id', id);
    if (delErr) setError(delErr.message);
    else refresh();
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="daycap-modal-title" className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-xl w-full shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div>
            <h2 id="daycap-modal-title" className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">Capacidade diária</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Teto de participantes por dia — soma TODOS os passes que ocupam aquele dia (marcados em "Dias de camp" no formulário de cada pass, ou pelo dia escolhido no Day Pass). Sem cadastro pra uma data = sem limite.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg shrink-0"><X size={18} /></button>
        </div>

        {error && (
          <div className="mx-5 sm:mx-6 mt-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-3 text-sm text-rose-700 dark:text-rose-200 flex items-center gap-2 shrink-0">
            <AlertCircle size={16} />{error}
          </div>
        )}

        <div className="overflow-y-auto px-5 sm:px-6 py-4 flex-1 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-slate-400" size={24} /></div>
          ) : days.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum teto cadastrado ainda — todos os dias ficam sem limite até você adicionar um aqui.</p>
          ) : (
            <div className="space-y-2">
              {days.map(d => {
                const s = stock[d.day_date];
                return (
                  <div key={d.id} className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white w-28 shrink-0">
                      {new Date(d.day_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </span>
                    <input
                      type="number"
                      defaultValue={d.capacity_max}
                      onBlur={e => { const v = Number(e.target.value); if (v !== d.capacity_max) updateCapacity(d.id, v); }}
                      className="w-20 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-2 py-1 text-sm"
                    />
                    <span className={`text-xs font-bold shrink-0 ${s?.esgotado ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>
                      {s ? `${s.ocupadas}/${s.capacity_max} ocupadas${s.esgotado ? ' · esgotado' : ''}` : '0 ocupadas'}
                    </span>
                    <button onClick={() => removeDay(d.id)} aria-label={`Remover teto de ${d.day_date}`} className="ml-auto p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
            <label className="block flex-1">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Data</span>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-3 py-2 text-sm" />
            </label>
            <label className="block w-28">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Teto</span>
              <input type="number" value={newCap} onChange={e => setNewCap(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-3 py-2 text-sm" />
            </label>
            <button onClick={addDay} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0068] px-4 py-2 text-sm font-bold text-white hover:bg-[#ff1a78] disabled:opacity-50 transition">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Adicionar
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-white/10 shrink-0 bg-white dark:bg-slate-900">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">Fechar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Modal: dias disponíveis (Day Pass) — quando configurado, o comprador é
// obrigado a escolher 1 dia no checkout; cada dia tem sua própria capacidade
// (ou ilimitada se em branco). Genérico — qualquer produtor pode usar pra
// qualquer workshop, não é exclusivo de camp multi-dia.
// ════════════════════════════════════════════════════════════════════════════
interface DayOption {
  id: string;
  day_date: string;
  label: string | null;
  capacity_max: number | null;
}
interface DayStockRow {
  day_option_id: string;
  ocupadas: number;
  restantes: number | null;
  esgotado: boolean;
}

const DayOptionsModal: React.FC<{ workshop: WorkshopRow; onClose: () => void }> = ({ workshop, onClose }) => {
  const [options, setOptions] = useState<DayOption[]>([]);
  const [stock, setStock] = useState<Record<string, DayStockRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newCap, setNewCap] = useState<string | number>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: optData, error: oErr }, { data: stockData }] = await Promise.all([
      supabase.from('workshop_day_options').select('id, day_date, label, capacity_max').eq('workshop_id', workshop.id).order('day_date'),
      supabase.rpc('get_workshop_day_stock', { p_workshop_id: workshop.id }),
    ]);
    if (oErr) setError(oErr.message);
    setOptions(optData ?? []);
    const byOption: Record<string, DayStockRow> = {};
    (stockData ?? []).forEach((r: DayStockRow) => { byOption[r.day_option_id] = r; });
    setStock(byOption);
    setLoading(false);
  }, [workshop.id]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const addOption = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return setError('Data inválida');
    setSaving(true);
    const { error: insErr } = await supabase.from('workshop_day_options').insert({
      workshop_id: workshop.id,
      day_date: newDate,
      label: newLabel.trim() || null,
      capacity_max: newCap === '' ? null : Number(newCap),
    });
    setSaving(false);
    if (insErr) return setError(insErr.message.includes('duplicate') ? 'Esse dia já está cadastrado' : insErr.message);
    setNewDate(''); setNewLabel(''); setNewCap('');
    refresh();
  };

  const removeOption = async (id: string) => {
    const { error: delErr } = await supabase.from('workshop_day_options').delete().eq('id', id);
    if (delErr) setError(delErr.message);
    else refresh();
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="day-options-modal-title" className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-xl w-full shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div>
            <h2 id="day-options-modal-title" className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">Dias disponíveis — {workshop.name}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Se cadastrar pelo menos 1 dia aqui, o comprador é obrigado a escolher um no checkout (ex: Day Pass). Sem nenhum dia cadastrado, o workshop funciona normal (sem escolha).</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg shrink-0"><X size={18} /></button>
        </div>

        {error && (
          <div className="mx-5 sm:mx-6 mt-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-3 text-sm text-rose-700 dark:text-rose-200 flex items-center gap-2 shrink-0">
            <AlertCircle size={16} />{error}
          </div>
        )}

        <div className="overflow-y-auto px-5 sm:px-6 py-4 flex-1 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-slate-400" size={24} /></div>
          ) : options.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum dia cadastrado ainda.</p>
          ) : (
            <div className="space-y-2">
              {options.map(o => {
                const s = stock[o.id];
                return (
                  <div key={o.id} className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2">
                    <div className="w-32 shrink-0">
                      <span className="text-sm font-bold text-slate-900 dark:text-white block">
                        {new Date(o.day_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
                      </span>
                      {o.label && <span className="text-[11px] text-slate-500 dark:text-slate-400">{o.label}</span>}
                    </div>
                    <span className={`text-xs font-bold shrink-0 ${s?.esgotado ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>
                      {o.capacity_max == null ? 'sem limite' : `${s?.ocupadas ?? 0}/${o.capacity_max}${s?.esgotado ? ' · esgotado' : ''}`}
                    </span>
                    <button onClick={() => removeOption(o.id)} aria-label={`Remover dia ${o.day_date}`} className="ml-auto p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
            <label className="block">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Data</span>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-3 py-2 text-sm" />
            </label>
            <label className="block flex-1 min-w-[140px]">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Rótulo (opcional)</span>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Ex: Ballet & Jazz" className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-3 py-2 text-sm" />
            </label>
            <label className="block w-28">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Vagas</span>
              <input type="number" value={newCap} onChange={e => setNewCap(e.target.value)} placeholder="sem limite" className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 dark:text-white px-3 py-2 text-sm" />
            </label>
            <button onClick={addOption} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0068] px-4 py-2 text-sm font-bold text-white hover:bg-[#ff1a78] disabled:opacity-50 transition">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Adicionar
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-white/10 shrink-0 bg-white dark:bg-slate-900">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10">Fechar</button>
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

  // "Noites cobertas"/"Dias de camp" — chips de data + input nativo, em vez de
  // texto cru separado por vírgula (frágil pro produtor digitar sem erro).
  const [newHospedagemNoite, setNewHospedagemNoite] = useState('');
  const [newCampDia, setNewCampDia] = useState('');
  const fmtDataBR = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');
  const addDateToField = (field: 'hospedagem_noites' | 'camp_dias', value: string, reset: (v: string) => void) => {
    if (!value) return;
    const atual: string[] = form[field] ?? [];
    if (!atual.includes(value)) {
      upd(field, [...atual, value].sort());
    }
    reset('');
  };
  const removeDateFromField = (field: 'hospedagem_noites' | 'camp_dias', value: string) => {
    upd(field, (form[field] ?? []).filter((d: string) => d !== value));
  };

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
        maxSizeMB: 0.15,
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
            <div>
              <span id="workshop-cover-label" className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Capa do workshop (recomendado 1200×675px, proporção 16:9)
              </span>
              <div className="flex items-start gap-4">
                <div className="relative shrink-0 w-32 aspect-video rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-white/10">
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
                    aria-describedby="workshop-cover-label"
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
            </div>
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
          <Section title="Hospedagem (add-on)">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Some ao preço do lote quando o comprador marca "incluir hospedagem" no checkout. As vagas por noite são controladas em "Hospedagem do evento" (botão no topo da lista). Quando o workshop tem "Dias" (Day Pass) cadastrados, a noite reservada segue o dia escolhido no checkout em vez desta lista fixa.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Acréscimo (R$)">
                <input type="number" step="0.01" value={form.hospedagem_delta} onChange={e => upd('hospedagem_delta', e.target.value)} className={inputCls} placeholder="vazio = sem hospedagem" />
              </Field>
              <Field label="Noites cobertas">
                {form.hospedagem_noites.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.hospedagem_noites.map((d: string) => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200 text-xs font-bold px-2.5 py-1">
                        {fmtDataBR(d)}
                        <button type="button" onClick={() => removeDateFromField('hospedagem_noites', d)} aria-label={`Remover ${fmtDataBR(d)}`} className="text-slate-500 hover:text-rose-500">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input type="date" value={newHospedagemNoite} onChange={e => setNewHospedagemNoite(e.target.value)} className={inputCls} />
                  <button type="button" onClick={() => addDateToField('hospedagem_noites', newHospedagemNoite, setNewHospedagemNoite)} className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#ff0068] px-3 py-2 text-xs font-bold text-white hover:bg-[#ff1a78] transition">
                    <Plus size={14} /> Adicionar
                  </button>
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <Field label="Chegada antecipada — acréscimo (R$, opcional)">
                <input type="number" step="0.01" value={form.early_arrival_delta} onChange={e => upd('early_arrival_delta', e.target.value)} className={inputCls} placeholder="vazio = opção desligada" />
              </Field>
              <Field label="Saída estendida — acréscimo (R$, opcional)">
                <input type="number" step="0.01" value={form.late_departure_delta} onChange={e => upd('late_departure_delta', e.target.value)} className={inputCls} placeholder="vazio = opção desligada" />
              </Field>
            </div>
          </Section>

          <Section title="Capacidade diária combinada (opcional)">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dias-calendário que este pass ocupa pra fins de teto diário do evento (soma junto com todos os outros passes na mesma data). Configure o teto por dia no botão "Capacidade diária" no topo da lista. Deixe vazio se este pass não deve entrar nessa conta (ex: quando o workshop já tem "Dias" cadastrados pra Day Pass — nesse caso o dia escolhido no checkout já entra sozinho).
            </p>
            <Field label="Dias de camp">
              {form.camp_dias.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.camp_dias.map((d: string) => (
                    <span key={d} className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200 text-xs font-bold px-2.5 py-1">
                      {fmtDataBR(d)}
                      <button type="button" onClick={() => removeDateFromField('camp_dias', d)} aria-label={`Remover ${fmtDataBR(d)}`} className="text-slate-500 hover:text-rose-500">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input type="date" value={newCampDia} onChange={e => setNewCampDia(e.target.value)} className={inputCls} />
                <button type="button" onClick={() => addDateToField('camp_dias', newCampDia, setNewCampDia)} className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#ff0068] px-3 py-2 text-xs font-bold text-white hover:bg-[#ff1a78] transition">
                  <Plus size={14} /> Adicionar
                </button>
              </div>
            </Field>
          </Section>

          <Section title="Destaque na vitrine">
            <Field label="Ordem de exibição (opcional)">
              <input type="number" value={form.display_order} onChange={e => upd('display_order', e.target.value)} className={inputCls} placeholder="vazio = ordena por data" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.is_featured} onChange={e => upd('is_featured', e.target.checked)} />
              Destacar este card (maior, acabamento dourado)
            </label>
            {form.is_featured && (
              <Field label="Texto do selo">
                <input value={form.featured_badge_text} onChange={e => upd('featured_badge_text', e.target.value)} className={inputCls} placeholder="MELHOR CUSTO-BENEFÍCIO" maxLength={40} />
              </Field>
            )}
          </Section>

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

// ════════════════════════════════════════════════════════════════════════════
// Seção: Passes (Day Pass/Full Pass) — pacote fixo de acesso a N workshops
// do mesmo evento, vendido como produto único (padrão NUVO/JUMP). Compra cria
// N workshop_registrations (1 por workshop incluso) sob 1 só cobrança Asaas.
// ════════════════════════════════════════════════════════════════════════════
interface PassRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  preco: number;
  preco_inscritos_mostra: number | null;
  auto_detect_combo: boolean;
  pass_commission_percent: number;
  pass_fee_mode: FeeMode;
  pass_max_per_cpf: number;
  is_published: boolean;
  workshop_ids: string[];
}

const PassesSection: React.FC<{ eventId: string; workshopsInEvent: WorkshopRow[] }> = ({ eventId, workshopsInEvent }) => {
  const [passes, setPasses]   = useState<PassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Modal de compradores do pass
  const [buyersPass, setBuyersPass] = useState<PassRow | null>(null);

  // Cortesia de pass: id do pass com form aberto, ou null
  const [courtesyPassId, setCourtesyPassId] = useState<string | null>(null);
  const [courtesyForm, setCourtesyForm] = useState({ name: '', email: '', cpf: '', phone: '' });
  const [courtesySaving, setCourtesySaving] = useState(false);

  const emptyForm = {
    name: '',
    description: '',
    preco: 0,
    preco_inscritos_mostra: '' as string | number,
    auto_detect_combo: true,
    pass_commission_percent: 10,
    pass_fee_mode: 'repassar' as FeeMode,
    pass_max_per_cpf: 1,
    is_published: false,
    workshop_ids: [] as string[],
  };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: passesData, error } = await supabase
      .from('workshop_passes')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    if (error) {
      setFeedback({ kind: 'err', msg: error.message });
      setLoading(false);
      return;
    }
    const list = passesData ?? [];
    if (list.length > 0) {
      const { data: itemsData } = await supabase
        .from('workshop_pass_items')
        .select('pass_id, workshop_id')
        .in('pass_id', list.map(p => p.id));
      const byPass: Record<string, string[]> = {};
      (itemsData ?? []).forEach((it: any) => { (byPass[it.pass_id] ??= []).push(it.workshop_id); });
      setPasses(list.map(p => ({ ...p, workshop_ids: byPass[p.id] ?? [] })));
    } else {
      setPasses([]);
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4500);
    return () => clearTimeout(t);
  }, [feedback]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (p: PassRow) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description ?? '',
      preco: p.preco,
      preco_inscritos_mostra: p.preco_inscritos_mostra ?? '',
      auto_detect_combo: p.auto_detect_combo,
      pass_commission_percent: p.pass_commission_percent,
      pass_fee_mode: p.pass_fee_mode,
      pass_max_per_cpf: p.pass_max_per_cpf,
      is_published: p.is_published,
      workshop_ids: p.workshop_ids,
    });
    setFormError(null);
    setShowModal(true);
  };

  const savePass = async () => {
    if (!form.name.trim()) return setFormError('Nome do pass é obrigatório');
    if (Number(form.preco) <= 0) return setFormError('Preço do pass deve ser maior que zero');
    if (form.workshop_ids.length < 2) return setFormError('Selecione pelo menos 2 workshops pro pass');

    setSaving(true);
    setFormError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return setFormError('Sessão expirada'); }

    const payload = {
      event_id: eventId,
      created_by: user.id,
      name: form.name.trim(),
      description: form.description.trim() || null,
      preco: Number(form.preco),
      preco_inscritos_mostra: form.preco_inscritos_mostra === '' ? null : Number(form.preco_inscritos_mostra),
      auto_detect_combo: form.auto_detect_combo,
      pass_commission_percent: Number(form.pass_commission_percent),
      pass_fee_mode: form.pass_fee_mode,
      pass_max_per_cpf: Number(form.pass_max_per_cpf),
      is_published: form.is_published,
    };

    let passId = editingId;
    if (editingId) {
      const { error } = await supabase.from('workshop_passes').update(payload).eq('id', editingId);
      if (error) { setSaving(false); return setFormError(error.message); }
    } else {
      const { data, error } = await supabase.from('workshop_passes').insert(payload).select('id').single();
      if (error || !data) { setSaving(false); return setFormError(error?.message ?? 'Falha ao criar pass'); }
      passId = data.id;
    }

    // Sincroniza itens: deleta todos e reinsere (simples, sem diffing — pass
    // raramente tem mais que 10 workshops, custo desprezível).
    if (passId) {
      await supabase.from('workshop_pass_items').delete().eq('pass_id', passId);
      const { error: itemsErr } = await supabase
        .from('workshop_pass_items')
        .insert(form.workshop_ids.map(wid => ({ pass_id: passId, workshop_id: wid })));
      if (itemsErr) {
        setSaving(false);
        return setFormError(`Pass salvo, mas falha ao vincular workshops: ${itemsErr.message}`);
      }
    }

    setSaving(false);
    setShowModal(false);
    setFeedback({ kind: 'ok', msg: editingId ? 'Pass atualizado' : 'Pass criado' });
    refresh();
  };

  const togglePublish = async (p: PassRow) => {
    const { error } = await supabase.from('workshop_passes').update({ is_published: !p.is_published }).eq('id', p.id);
    if (error) setFeedback({ kind: 'err', msg: error.message });
    else { setFeedback({ kind: 'ok', msg: p.is_published ? 'Pass despublicado' : 'Pass publicado' }); refresh(); }
  };

  const removePass = async (p: PassRow) => {
    if (!confirm(`Remover o pass "${p.name}"? Inscrições já feitas por esse pass não são afetadas.`)) return;
    const { error } = await supabase.from('workshop_passes').delete().eq('id', p.id);
    if (error) setFeedback({ kind: 'err', msg: error.message });
    else { setFeedback({ kind: 'ok', msg: 'Pass removido' }); refresh(); }
  };

  const openCourtesy = (passId: string) => {
    setCourtesyPassId(passId);
    setCourtesyForm({ name: '', email: '', cpf: '', phone: '' });
  };

  const handleAddPassCourtesy = async () => {
    if (courtesySaving || !courtesyPassId) return;
    const cpf = courtesyForm.cpf.replace(/\D/g, '');
    if (!courtesyForm.name.trim() || !courtesyForm.email.trim() || cpf.length !== 11) {
      setFeedback({ kind: 'err', msg: 'Preencha nome, e-mail e CPF válido.' });
      return;
    }
    setCourtesySaving(true);
    try {
      const { error: invokeErr } = await supabase.functions.invoke('create-courtesy-entry', {
        body: {
          kind: 'pass',
          pass_id: courtesyPassId,
          buyer_name: courtesyForm.name.trim(),
          buyer_email: courtesyForm.email.trim(),
          buyer_cpf: cpf,
          buyer_phone: courtesyForm.phone.trim() || undefined,
        },
      });
      if (invokeErr) throw new Error(invokeErr.message);
      setFeedback({ kind: 'ok', msg: 'Cortesia de pass adicionada. E-mail enviado com os vouchers.' });
      setCourtesyPassId(null);
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e.message ?? 'Erro ao criar cortesia' });
    } finally {
      setCourtesySaving(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900 dark:text-white flex items-center gap-2">
            <Ticket className="text-[#ff0068]" size={20} />
            Passes
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Pacote fixo de acesso a vários workshops (Day Pass/Full Pass). Esgota se qualquer workshop incluso esgotar.
          </p>
        </div>
        <button
          onClick={openCreate}
          disabled={workshopsInEvent.length < 2}
          title={workshopsInEvent.length < 2 ? 'Cadastre pelo menos 2 workshops nesse evento primeiro' : undefined}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-white px-4 py-2.5 text-sm font-bold text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-40 transition"
        >
          <Plus size={16} />
          Novo pass
        </button>
      </div>

      {feedback && (
        <div className={`mb-4 rounded-xl border p-3 text-sm flex items-center gap-2 ${feedback.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'}`}>
          {feedback.kind === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {feedback.msg}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 size={24} className="animate-spin text-[#ff0068]" /></div>
      ) : passes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">Nenhum pass criado pra esse evento ainda.</p>
      ) : (
        <div className="grid gap-3">
          {passes.map(p => (
            <div key={p.id} className="rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {p.is_published ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full"><Globe size={10} />Publicado</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-slate-500/15 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full"><EyeOff size={10} />Rascunho</span>
                    )}
                    <span className="text-[10px] font-black uppercase tracking-wider bg-[#ff0068]/15 text-[#ff0068] px-2 py-0.5 rounded-full">Pass</span>
                  </div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{p.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {p.workshop_ids.length} workshops inclusos: {p.workshop_ids.map(wid => workshopsInEvent.find(w => w.id === wid)?.name ?? '?').join(', ')}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-black text-slate-900 dark:text-white">{fmtCurrency(p.preco)}</span>
                    {p.preco_inscritos_mostra != null && (
                      <span className="text-xs text-violet-600 dark:text-violet-400">↓ {fmtCurrency(p.preco_inscritos_mostra)} p/ inscritos</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => togglePublish(p)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${p.is_published ? 'border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                  >
                    {p.is_published ? <><EyeOff size={12} />Despublicar</> : <><Globe size={12} />Publicar</>}
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                  >
                    <Pencil size={12} />Editar
                  </button>
                  <button
                    onClick={() => setBuyersPass(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                    aria-label="Ver compradores deste pass"
                  >
                    <ShoppingCart size={12} />Compradores
                  </button>
                  <button
                    onClick={() => openCourtesy(p.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 dark:border-violet-500/30 px-3 py-1.5 text-xs font-bold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition"
                    aria-label="Adicionar cortesia neste pass"
                  >
                    <Users size={12} />Cortesia
                  </button>
                  <button
                    onClick={() => removePass(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
                  >
                    <Trash2 size={12} />Remover
                  </button>
                </div>
              </div>

              {courtesyPassId === p.id && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 mb-3">
                    Convite gratuito — acesso a todos os workshops deste pass
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="sr-only" htmlFor={`pass-courtesy-name-${p.id}`}>Nome</label>
                    <input
                      id={`pass-courtesy-name-${p.id}`}
                      value={courtesyForm.name}
                      onChange={e => setCourtesyForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Nome"
                      className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
                    />
                    <label className="sr-only" htmlFor={`pass-courtesy-email-${p.id}`}>E-mail</label>
                    <input
                      id={`pass-courtesy-email-${p.id}`}
                      type="email"
                      value={courtesyForm.email}
                      onChange={e => setCourtesyForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="E-mail"
                      className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
                    />
                    <label className="sr-only" htmlFor={`pass-courtesy-cpf-${p.id}`}>CPF</label>
                    <input
                      id={`pass-courtesy-cpf-${p.id}`}
                      value={courtesyForm.cpf}
                      onChange={e => setCourtesyForm(f => ({ ...f, cpf: maskCPF(e.target.value) }))}
                      placeholder="CPF"
                      className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
                    />
                    <label className="sr-only" htmlFor={`pass-courtesy-phone-${p.id}`}>Telefone</label>
                    <input
                      id={`pass-courtesy-phone-${p.id}`}
                      value={courtesyForm.phone}
                      onChange={e => setCourtesyForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="Telefone (opcional)"
                      className="px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50"
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => setCourtesyPassId(null)}
                      disabled={courtesySaving}
                      className="px-4 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-widest"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleAddPassCourtesy}
                      disabled={courtesySaving}
                      className="px-4 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1.5"
                    >
                      {courtesySaving ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
                      {courtesySaving ? 'Salvando...' : 'Confirmar cortesia'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {buyersPass && (
        <PassBuyersModal
          pass={buyersPass}
          workshopsInEvent={workshopsInEvent}
          onClose={() => setBuyersPass(null)}
        />
      )}

      {showModal && (
        <PassFormModal
          form={form}
          setForm={setForm}
          formError={formError}
          saving={saving}
          isEdit={!!editingId}
          workshopsInEvent={workshopsInEvent}
          onClose={() => setShowModal(false)}
          onSave={savePass}
        />
      )}
    </div>
  );
};

interface PassFormModalProps {
  form: any; setForm: any; formError: string | null; saving: boolean;
  isEdit: boolean; workshopsInEvent: WorkshopRow[];
  onClose: () => void; onSave: () => void;
}

const PassFormModal: React.FC<PassFormModalProps> = ({ form, setForm, formError, saving, isEdit, workshopsInEvent, onClose, onSave }) => {
  const upd = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const toggleWorkshop = (id: string) => {
    setForm((p: any) => ({
      ...p,
      workshop_ids: p.workshop_ids.includes(id)
        ? p.workshop_ids.filter((x: string) => x !== id)
        : [...p.workshop_ids, id],
    }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pass-form-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 id="pass-form-title" className="text-lg sm:text-xl font-black text-slate-900 dark:text-white truncate">{isEdit ? 'Editar pass' : 'Novo pass'}</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg shrink-0"><X size={18} /></button>
        </div>

        {formError && (
          <div className="mx-5 sm:mx-6 mt-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-3 text-sm text-rose-700 dark:text-rose-200 flex items-center gap-2 shrink-0">
            <AlertCircle size={16} />{formError}
          </div>
        )}

        <div className="space-y-5 overflow-y-auto px-5 sm:px-6 py-5 flex-1">
          <Section title="Identidade">
            <Field label="Nome do pass *">
              <input value={form.name} onChange={e => upd('name', e.target.value)} className={inputCls} placeholder="Ex: Full Pass — Todos os workshops" />
            </Field>
            <Field label="Descrição">
              <textarea value={form.description} onChange={e => upd('description', e.target.value)} rows={2} className={inputCls} placeholder="O que o pass inclui, pra quem é indicado..." />
            </Field>
          </Section>

          <Section title="Workshops inclusos (mín. 2) *">
            <div className="space-y-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 p-3">
              {workshopsInEvent.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhum workshop cadastrado nesse evento ainda.</p>
              ) : (
                workshopsInEvent.map(w => (
                  <label key={w.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" checked={form.workshop_ids.includes(w.id)} onChange={() => toggleWorkshop(w.id)} />
                    {w.name}
                  </label>
                ))
              )}
            </div>
          </Section>

          <Section title="Preços">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Preço do pass (R$) *"><input type="number" step="0.01" value={form.preco} onChange={e => upd('preco', e.target.value)} className={inputCls} /></Field>
              <Field label="Preço para inscritos da mostra (R$)">
                <input type="number" step="0.01" value={form.preco_inscritos_mostra} onChange={e => upd('preco_inscritos_mostra', e.target.value)} className={inputCls} placeholder="vazio = mesmo preço" />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.auto_detect_combo} onChange={e => upd('auto_detect_combo', e.target.checked)} className="mt-1" />
              <span>
                Detectar combo automaticamente pelo CPF (cruza com inscrições aprovadas)
                <span className="block text-xs text-slate-500 dark:text-slate-400">Se desligado, comprador paga o preço cheio</span>
              </span>
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-start gap-1.5">
              <Sparkles size={12} className="mt-0.5 shrink-0" />
              Preço é fixo — o pass esgota assim que qualquer workshop incluso ficar sem vaga (tudo-ou-nada).
            </p>
          </Section>

          <Section title="Limites & taxas">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Modo da taxa">
                <select value={form.pass_fee_mode} onChange={e => upd('pass_fee_mode', e.target.value as FeeMode)} className={inputCls}>
                  <option value="repassar">Repassar ao comprador</option>
                  <option value="absorver">Absorver no preço</option>
                </select>
              </Field>
              <Field label="Limite de passes por CPF"><input type="number" value={form.pass_max_per_cpf} onChange={e => upd('pass_max_per_cpf', e.target.value)} className={inputCls} /></Field>
            </div>
          </Section>

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
            {isEdit ? 'Salvar alterações' : 'Criar pass'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Modal de compradores do pass — agrupa workshop_registrations por pass_group_id
// (padrão Sympla/Eventbrite: 1 linha por compra, não por workshop incluso)
// ════════════════════════════════════════════════════════════════════════════
interface PassBuyerGroup {
  pass_group_id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_cpf: string;
  status_pagamento: string;
  total_preco: number;
  paid_at: string | null;
  is_combo: boolean;
  created_at: string;
  items: Array<{ workshop_id: string; attended: boolean; attended_at: string | null }>;
}

const PASS_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  APROVADO:  { label: 'Aprovado',  cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
  PENDENTE:  { label: 'Pendente',  cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' },
  VENCIDO:   { label: 'Vencido',   cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
  ESTORNADO: { label: 'Estornado', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
  CORTESIA:  { label: 'Cortesia',  cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20' },
  GRATUITO:  { label: 'Grátis',    cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20' },
};

const PassBuyersModal: React.FC<{
  pass: PassRow;
  workshopsInEvent: WorkshopRow[];
  onClose: () => void;
}> = ({ pass, workshopsInEvent, onClose }) => {
  const [buyers, setBuyers] = useState<PassBuyerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('workshop_registrations')
        .select('id, pass_group_id, buyer_name, buyer_email, buyer_cpf, status_pagamento, preco_pago, paid_at, is_combo, created_at, workshop_id, attended, attended_at')
        .eq('pass_id', pass.id)
        .order('created_at', { ascending: false });

      // Agrupar por pass_group_id client-side
      const grouped: Record<string, PassBuyerGroup> = {};
      for (const row of data ?? []) {
        const gid = row.pass_group_id ?? row.id;
        if (!grouped[gid]) {
          grouped[gid] = {
            pass_group_id: gid,
            buyer_name: row.buyer_name,
            buyer_email: row.buyer_email,
            buyer_cpf: row.buyer_cpf,
            status_pagamento: row.status_pagamento,
            total_preco: 0,
            paid_at: row.paid_at,
            is_combo: row.is_combo,
            created_at: row.created_at,
            items: [],
          };
        }
        grouped[gid].total_preco += row.preco_pago ?? 0;
        grouped[gid].items.push({ workshop_id: row.workshop_id, attended: row.attended, attended_at: row.attended_at });
      }
      setBuyers(Object.values(grouped).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      setLoading(false);
    })();
  }, [pass.id]);

  const filtered = useMemo(() => {
    if (!search.trim()) return buyers;
    const q = search.trim().toLowerCase();
    return buyers.filter(b => b.buyer_name.toLowerCase().includes(q) || b.buyer_email.toLowerCase().includes(q));
  }, [buyers, search]);

  const stats = useMemo(() => {
    const total = buyers.length;
    const cortesias = buyers.filter(b => b.status_pagamento === 'CORTESIA').length;
    const aprovados = buyers.filter(b => b.status_pagamento === 'APROVADO').length;
    const receita = buyers.filter(b => b.status_pagamento === 'APROVADO').reduce((s, b) => s + b.total_preco, 0);
    return { total, cortesias, aprovados, receita };
  }, [buyers]);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pass-buyers-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-4xl max-h-[92dvh] sm:max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Compradores do pass</p>
            <h3 id="pass-buyers-title" className="text-lg sm:text-xl font-black text-slate-900 dark:text-white truncate">{pass.name}</h3>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Stats */}
        {!loading && (
          <div className="px-5 sm:px-6 py-3 border-b border-slate-200 dark:border-white/10 flex flex-wrap gap-4 shrink-0">
            <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total</p><p className="text-xl font-black text-slate-900 dark:text-white">{stats.total}</p></div>
            <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Aprovados</p><p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{stats.aprovados}</p></div>
            {stats.cortesias > 0 && <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cortesias</p><p className="text-xl font-black text-violet-600 dark:text-violet-400">{stats.cortesias}</p></div>}
            <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Receita</p><p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{fmtCurrency(stats.receita)}</p></div>
          </div>
        )}

        {/* Search */}
        <div className="px-5 sm:px-6 py-3 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou e-mail..."
              className="w-full pl-8 pr-4 py-2 bg-slate-100 dark:bg-white/5 border border-transparent focus:border-[#ff0068]/30 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none"
            />
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 divide-y divide-slate-100 dark:divide-white/5">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-[#ff0068]" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ShoppingCart size={32} className="text-slate-300 dark:text-slate-700" />
              <p className="text-sm text-slate-500">{buyers.length === 0 ? 'Nenhuma venda de pass ainda.' : 'Nenhum resultado para a busca.'}</p>
            </div>
          ) : (
            filtered.map(b => {
              const st = PASS_STATUS_LABEL[b.status_pagamento] ?? { label: b.status_pagamento, cls: 'bg-slate-500/10 text-slate-600' };
              const attendedCount = b.items.filter(i => i.attended).length;
              return (
                <div key={b.pass_group_id} className="px-5 sm:px-6 py-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                        {b.is_combo && <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">Combo</span>}
                      </div>
                      <p className="font-bold text-slate-900 dark:text-white text-sm truncate">{b.buyer_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{b.buyer_email}</p>
                      {/* Workshops incluídos */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {b.items.map(item => {
                          const ws = workshopsInEvent.find(w => w.id === item.workshop_id);
                          return (
                            <span
                              key={item.workshop_id}
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${item.attended ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' : 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'}`}
                            >
                              {item.attended && <UserCheck size={9} aria-hidden />}
                              {ws?.name ?? item.workshop_id.slice(0, 8)}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-black text-base tabular-nums ${b.status_pagamento === 'CORTESIA' ? 'text-violet-600 dark:text-violet-400' : 'text-slate-900 dark:text-white'}`}>
                        {b.status_pagamento === 'CORTESIA' ? 'Cortesia' : fmtCurrency(b.total_preco)}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{attendedCount}/{b.items.length} frequentado{b.items.length !== 1 ? 's' : ''}</p>
                      <p className="text-[10px] text-slate-400">{fmtDate(b.created_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
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
