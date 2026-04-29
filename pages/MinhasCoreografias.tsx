import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { getGenres } from '../services/genreService';
import { EventStyle } from '../types';
import {
  Music2, Plus, Trash2, X, ChevronRight, ChevronLeft,
  AlertCircle, Loader2, Users, User, CheckCircle,
  AlertTriangle, Info, Clapperboard, Pencil,
  Calendar, MapPin, Lock, ShieldAlert, Clock,
  CreditCard, Star,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
interface Bailarino {
  id: string;
  nome: string;
  cpf: string;
  data_nascimento: string;
}

interface Categoria {
  name: string;
  min_age: number;
  max_age: number;
}

interface Formacao {
  name: string;
  min_members: number;
  max_members: number;
  fee?: number;
  format?: string;
}

interface EventData {
  id: string;
  name: string;
  start_date?: string;
  location?: string;
  categories_config?: Categoria[];
  formacoes_config?: Formacao[];
}

interface Coreografia {
  id: string;
  nome: string;
  event_id?: string;
  event_nome?: string;
  event_data?: string;
  estilo_nome?: string;
  subgenero?: string;
  categoria_nome?: string;
  formacao?: string;
  bailarinos_ids: string[];
  status: string;
  created_at: string;
  _bailarinos_nomes?: string[];
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */

/** Calculates age on a specific reference date (event date) */
const calcAgeOnDate = (dob: string, refDateStr: string): number => {
  if (!refDateStr) {
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }
  const birth = new Date(dob + 'T00:00:00');
  const ref   = new Date(refDateStr + 'T00:00:00');
  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
  return age;
};

const fmtDate = (d?: string) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const fmtCurrency = (v?: number) =>
  v != null ? `R$ ${v.toFixed(2).replace('.', ',')}` : '—';

/* ── Status config ── */
const STATUS_CFG: Record<string, { bg: string; text: string; label: string }> = {
  RASCUNHO:            { bg: 'bg-slate-100 dark:bg-white/8',            text: 'text-slate-500',                        label: 'Rascunho'              },
  PRONTA:              { bg: 'bg-emerald-100 dark:bg-emerald-500/15',   text: 'text-emerald-600 dark:text-emerald-400', label: 'Pronta'                },
  PRONTO:              { bg: 'bg-emerald-100 dark:bg-emerald-500/15',   text: 'text-emerald-600 dark:text-emerald-400', label: 'Pronta'                },
  AGUARDANDO_PAGAMENTO:{ bg: 'bg-amber-100 dark:bg-amber-500/15',       text: 'text-amber-600 dark:text-amber-400',     label: 'Aguardando Pagamento'  },
  INSCRITA:            { bg: 'bg-indigo-100 dark:bg-indigo-500/15',     text: 'text-indigo-600 dark:text-indigo-400',   label: 'Inscrita'              },
  CANCELADA:           { bg: 'bg-rose-100 dark:bg-rose-500/15',         text: 'text-rose-600 dark:text-rose-400',       label: 'Cancelada'             },
};

/* ── Setup SQL ── */
const SETUP_SQL = `-- Execute no SQL Editor do Supabase
alter table coreografias
  add column if not exists event_id uuid,
  add column if not exists event_nome text default '',
  add column if not exists event_data date,
  add column if not exists formacao text default '';`;

const EMPTY_FORM = {
  nome:              '',
  event_id:          '',
  event_nome:        '',
  event_data:        '',
  estilo_nome:       '',
  subgenero:         '',
  categoria_nome:    '',
  cat_min_age:       0,
  cat_max_age:       99,
  formacao:          '',
  mod_min:           1,
  mod_max:           99,
  mod_fee:           0,
  bailarinos_ids:    [] as string[],
};

const STEP_LABELS = ['Evento & Nome', 'Estilo · Categoria · Formação', 'Elenco', 'Confirmação'];

/* ══════════════════════════════════════════════════════════════
   COMPONENT
══════════════════════════════════════════════════════════════ */
const MinhasCoreografias = () => {
  /* ── master data ── */
  const navigate = useNavigate();
  const [coreografias,  setCoreografias]  = useState<Coreografia[]>([]);
  const [elenco,        setElenco]        = useState<Bailarino[]>([]);
  const [vitrineRegs,   setVitrineRegs]   = useState<any[]>([]);
  const [allEvents,     setAllEvents]     = useState<EventData[]>([]);
  const [globalCats,    setGlobalCats]    = useState<Categoria[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [tableError,    setTableError]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  /* ── event-specific data ── */
  const [stylesForEvent, setStylesForEvent]   = useState<EventStyle[]>([]);
  const [loadingStyles,  setLoadingStyles]    = useState(false);

  /* ── wizard ── */
  const [showForm,    setShowForm]    = useState(false);
  const [step,        setStep]        = useState(1);
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [formErrors,  setFormErrors]  = useState<Record<string, string>>({});
  const [saving,      setSaving]      = useState(false);

  /* ── list actions ── */
  const [confirmDel,  setConfirmDel]  = useState<string | null>(null);

  /* ── "Usar dados do ano anterior" ── */
  const [showPrefillBanner, setShowPrefillBanner] = useState(false);

  /* ── age reference (loaded from global config) ── */
  const [ageRefMode,      setAgeRefMode]      = useState<'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE'>('EVENT_DAY');
  const [ageRefFixedDate, setAgeRefFixedDate] = useState<string>('');

  /* ── tolerance rule (loaded from global config) ── */
  const [toleranceRule, setToleranceRule] = useState<{
    mode: 'PERCENT' | 'COUNT';
    value: number;
    enforcement: 'FLEXIBLE' | 'STRICT';
  }>({ mode: 'PERCENT', value: 20, enforcement: 'FLEXIBLE' });

  /* ══════════════════════════════════════════════════════════
     DATA FETCHING
  ══════════════════════════════════════════════════════════ */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [coreoRes, elencoRes, eventsRes, configsRes, registrationsRes] = await Promise.all([
        supabase.from('coreografias').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('elenco').select('*').eq('user_id', user.id).order('nome'),
        supabase.from('events').select('id,name,start_date,location').order('start_date'),
        supabase.from('configuracoes').select('event_id,nome_festival,local_evento,prazo_inscricao,categorias_predefinidas,formatos_precos,tolerancia,age_reference,age_reference_date'),
        // Inscrições feitas via vitrine pública (tabela registrations).
        // Workaround enquanto a unificação (#12 backlog) não é feita.
        supabase
          .from('registrations')
          .select('id, event_id, nome_coreografia, formato_participacao, categoria, estilo_danca, status_pagamento, payment_url, criado_em')
          .eq('user_id', user.id)
          .order('criado_em', { ascending: false }),
      ]);
      setVitrineRegs(registrationsRes.data ?? []);

      if (coreoRes.error?.code === '42P01') { setTableError(true); return; }
      if (coreoRes.error) throw coreoRes.error;

      const bailarinos = elencoRes.data || [];
      setElenco(bailarinos);

      // Merge events with their configuracoes (categories + modalities)
      const configsMap: Record<string, any> = {};
      for (const cfg of (configsRes.data || [])) {
        if (cfg.event_id) configsMap[cfg.event_id] = cfg;
      }

      let eventos: EventData[] = (eventsRes.data || []).map(ev => {
        const cfg = configsMap[ev.id];
        return {
          id:                ev.id,
          name:              ev.name,
          start_date:        ev.start_date  || undefined,
          location:          ev.location    || undefined,
          categories_config: cfg?.categorias_predefinidas || [],
          formacoes_config: cfg?.formatos_precos         || [],
        };
      });

      // Fallback: if no events in table but configuracoes has a festival name
      if (eventos.length === 0) {
        const firstCfg = configsRes.data?.[0];
        if (firstCfg?.nome_festival) {
          eventos = [{
            id:               '00000000-0000-0000-0000-000000000001',
            name:             firstCfg.nome_festival,
            start_date:       firstCfg.prazo_inscricao || undefined,
            location:         firstCfg.local_evento    || undefined,
            categories_config: firstCfg.categorias_predefinidas || [],
            formacoes_config: firstCfg.formatos_precos         || [],
          }];
        }
      }

      setAllEvents(eventos);
      // Global cats from first configuracoes entry as fallback
      const firstCfg = configsRes.data?.[0];
      setGlobalCats(firstCfg?.categorias_predefinidas || []);

      // Load age reference and tolerance from config
      if (firstCfg?.age_reference) setAgeRefMode(firstCfg.age_reference);
      if (firstCfg?.age_reference_date) setAgeRefFixedDate(firstCfg.age_reference_date);
      if (firstCfg?.tolerancia) {
        setToleranceRule({
          mode: firstCfg.tolerancia.mode ?? 'PERCENT',
          value: firstCfg.tolerancia.value ?? 20,
          enforcement: firstCfg.tolerancia.enforcement ?? 'FLEXIBLE',
        });
      }

      const enriched: Coreografia[] = (coreoRes.data || []).map(c => ({
        ...c,
        _bailarinos_nomes: (c.bailarinos_ids || [])
          .map((id: string) => bailarinos.find(b => b.id === id)?.nome)
          .filter(Boolean),
      }));
      setCoreografias(enriched);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* Load styles when event changes */
  useEffect(() => {
    if (!form.event_id) { setStylesForEvent([]); return; }
    setLoadingStyles(true);
    getGenres(form.event_id)
      .then(s => setStylesForEvent(s.filter(x => x.is_active)))
      .catch(() => setStylesForEvent([]))
      .finally(() => setLoadingStyles(false));
  }, [form.event_id]);

  /* ══════════════════════════════════════════════════════════
     DERIVED DATA
  ══════════════════════════════════════════════════════════ */
  const selectedEvent = useMemo(
    () => allEvents.find(e => e.id === form.event_id) || null,
    [allEvents, form.event_id]
  );

  const categoriasForEvent = useMemo(
    () => selectedEvent?.categories_config?.length
      ? selectedEvent.categories_config
      : globalCats,
    [selectedEvent, globalCats]
  );

  const formacoesForEvent = useMemo(
    () => selectedEvent?.formacoes_config || [],
    [selectedEvent]
  );

  const selectedStyle = stylesForEvent.find(s => s.name === form.estilo_nome);

  /**
   * Resolves the age reference date according to the producer's config:
   *   EVENT_DAY   → the event's start date
   *   YEAR_END    → Dec 31 of the event's year
   *   FIXED_DATE  → an explicit date chosen by the producer
   */
  const resolveRefDate = useCallback((eventDateStr: string): string => {
    if (ageRefMode === 'YEAR_END') {
      const year = eventDateStr
        ? new Date(eventDateStr + 'T12:00:00').getFullYear()
        : new Date().getFullYear();
      return `${year}-12-31`;
    }
    if (ageRefMode === 'FIXED_DATE' && ageRefFixedDate) {
      return ageRefFixedDate;
    }
    // EVENT_DAY (default)
    return eventDateStr || new Date().toISOString().slice(0, 10);
  }, [ageRefMode, ageRefFixedDate]);

  /* Human-readable label for the current reference mode */
  const ageRefLabel = useMemo(() => {
    const refDate = resolveRefDate(form.event_data);
    const fmt = refDate
      ? new Date(refDate + 'T12:00:00').toLocaleDateString('pt-BR')
      : '—';
    const modes: Record<string, string> = {
      EVENT_DAY:  `Data do evento (${fmt})`,
      YEAR_END:   `31/12 do ano do evento (${fmt})`,
      FIXED_DATE: `Data personalizada (${fmt})`,
    };
    return modes[ageRefMode] ?? fmt;
  }, [ageRefMode, resolveRefDate, form.event_data]);

  /* Dancer eligibility based on resolved reference date */
  const isDancerEligible = useCallback((b: Bailarino): boolean => {
    if (!form.categoria_nome || (!form.cat_min_age && !form.cat_max_age)) return true;
    const refDate = resolveRefDate(form.event_data);
    const age = calcAgeOnDate(b.data_nascimento, refDate);
    return age >= form.cat_min_age && age <= form.cat_max_age;
  }, [form.categoria_nome, form.cat_min_age, form.cat_max_age, form.event_data, resolveRefDate]);

  /* Tolerance violation check based on selected dancers */
  const toleranceStatus = useMemo(() => {
    const selected = form.bailarinos_ids
      .map(id => elenco.find(b => b.id === id))
      .filter((b): b is Bailarino => Boolean(b));

    if (!form.categoria_nome || selected.length === 0) {
      return { violates: false, outCount: 0, totalCount: 0, pct: 0, allowedLimit: 0, limitLabel: '' };
    }

    const outOfRange = selected.filter(b => !isDancerEligible(b));
    const outCount = outOfRange.length;
    const totalCount = selected.length;
    const pct = totalCount > 0 ? (outCount / totalCount) * 100 : 0;

    let violates = false;
    let allowedLimit = 0;
    let limitLabel = '';
    if (toleranceRule.mode === 'PERCENT') {
      violates = pct > toleranceRule.value;
      allowedLimit = toleranceRule.value;
      limitLabel = `${toleranceRule.value}%`;
    } else {
      violates = outCount > toleranceRule.value;
      allowedLimit = toleranceRule.value;
      limitLabel = `${toleranceRule.value} pessoa(s)`;
    }

    return { violates, outCount, totalCount, pct, allowedLimit, limitLabel };
  }, [form.bailarinos_ids, form.categoria_nome, elenco, isDancerEligible, toleranceRule]);

  /* ══════════════════════════════════════════════════════════
     VALIDATION
  ══════════════════════════════════════════════════════════ */
  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    if (s === 1) {
      if (!form.nome.trim())  errs.nome     = 'Dê um nome à coreografia';
      if (!form.event_id)     errs.event_id = 'Selecione o evento';
    }
    if (s === 2) {
      if (!form.estilo_nome)  errs.estilo   = 'Selecione o estilo de dança';
      if (!form.categoria_nome) errs.categoria = 'Selecione a categoria';
      if (!form.formacao)      errs.formacao = 'Selecione a formação';
    }
    if (s === 3) {
      const eligible = form.bailarinos_ids.filter(id =>
        isDancerEligible(elenco.find(b => b.id === id)!)
      );
      if (eligible.length < form.mod_min)
        errs.bailarinos = `Esta formação requer no mínimo ${form.mod_min} bailarino(s) elegível(is)`;
      if (form.bailarinos_ids.length > form.mod_max)
        errs.bailarinos = `Esta formação permite no máximo ${form.mod_max === 99 ? '∞' : form.mod_max} bailarino(s)`;

      // Tolerance enforcement: STRICT mode blocks; FLEXIBLE allows with warning
      if (toleranceRule.enforcement === 'STRICT' && toleranceStatus.violates) {
        errs.bailarinos = `Tolerância excedida: ${toleranceStatus.outCount} bailarino(s) fora da faixa etária. Limite: até ${toleranceStatus.limitLabel}.`;
      }
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => { if (validateStep(step)) setStep(s => s + 1); };
  const handleBack = () => { setStep(s => s - 1); setFormErrors({}); };

  /* ══════════════════════════════════════════════════════════
     SAVE
  ══════════════════════════════════════════════════════════ */
  const handleSave = async () => {
    if (!validateStep(3)) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const payload = {
        user_id:        user.id,
        nome:           form.nome.trim(),
        event_id:       form.event_id   || null,
        event_nome:     form.event_nome || '',
        event_data:     form.event_data || null,
        estilo_nome:    form.estilo_nome,
        subgenero:      form.subgenero,
        categoria_nome: form.categoria_nome,
        formacao:       form.formacao,
        mod_fee:        form.mod_fee || 0,
        bailarinos_ids: form.bailarinos_ids,
        status:         'AGUARDANDO_PAGAMENTO',
        tolerance_violation: toleranceStatus.violates ? {
          out_count:    toleranceStatus.outCount,
          total_count:  toleranceStatus.totalCount,
          pct:          Math.round(toleranceStatus.pct * 10) / 10,
          limit_label:  toleranceStatus.limitLabel,
          mode:         toleranceRule.mode,
          flagged_at:   new Date().toISOString(),
        } : null,
      };
      if (editingId) {
        const { error: err } = await supabase.from('coreografias').update(payload).eq('id', editingId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('coreografias').insert([payload]);
        if (err) throw err;
      }
      closeForm();
      fetchAll();
    } catch (e: any) {
      setFormErrors({ _global: e.message });
    } finally {
      setSaving(false);
    }
  };

  /* ══════════════════════════════════════════════════════════
     FORM HELPERS
  ══════════════════════════════════════════════════════════ */
  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setStep(1);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setStep(1);
    setShowForm(true);
  };

  const openEdit = (c: Coreografia) => {
    setEditingId(c.id);
    const allCats = allEvents.find(e => e.id === c.event_id)?.categories_config || globalCats;
    const cat = allCats.find(x => x.name === c.categoria_nome);
    const mod = allEvents.find(e => e.id === c.event_id)?.formacoes_config?.find(m => m.name === c.formacao);
    setForm({
      nome:           c.nome,
      event_id:       c.event_id      || '',
      event_nome:     c.event_nome    || '',
      event_data:     c.event_data    || '',
      estilo_nome:    c.estilo_nome   || '',
      subgenero:      c.subgenero     || '',
      categoria_nome: c.categoria_nome || '',
      cat_min_age:    cat?.min_age    ?? 0,
      cat_max_age:    cat?.max_age    ?? 99,
      formacao:       c.formacao       || '',
      mod_min:        mod?.min_members ?? 1,
      mod_max:        mod?.max_members ?? 99,
      mod_fee:        mod?.fee        ?? 0,
      bailarinos_ids: c.bailarinos_ids || [],
    });
    setFormErrors({});
    setStep(1);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await supabase.from('coreografias').delete().eq('id', id);
    setCoreografias(prev => prev.filter(c => c.id !== id));
    setConfirmDel(null);
  };

  const toggleBailarino = (id: string, eligible: boolean) => {
    if (!eligible) return; // HARD LOCK — ineligible dancers cannot be selected
    setForm(prev => ({
      ...prev,
      bailarinos_ids: prev.bailarinos_ids.includes(id)
        ? prev.bailarinos_ids.filter(x => x !== id)
        : [...prev.bailarinos_ids, id],
    }));
  };

  /**
   * Finds the most recent coreografia from a different event to pre-fill the new form.
   * Only shown when starting a new inscription (not editing).
   */
  const previousCoreografia = useMemo(() => {
    if (editingId) return null;
    // Filter for coreografias from other events that have style/modality data
    const fromOtherEvents = coreografias.filter(
      c => c.event_id !== form.event_id && (c.estilo_nome || c.formacao)
    );
    if (fromOtherEvents.length === 0) return null;
    // Most recent = first in list (already ordered by created_at desc from fetchAll)
    return fromOtherEvents[0];
  }, [coreografias, form.event_id, editingId]);

  const handlePrefillFromPrevious = () => {
    if (!previousCoreografia) return;
    const mod = formacoesForEvent.find(m => m.name === previousCoreografia.formacao);
    setForm(prev => ({
      ...prev,
      estilo_nome:    previousCoreografia.estilo_nome   || prev.estilo_nome,
      subgenero:      previousCoreografia.subgenero     || prev.subgenero,
      formacao:       mod ? previousCoreografia.formacao! : prev.formacao,
      mod_min:        mod?.min_members ?? prev.mod_min,
      mod_max:        mod?.max_members ?? prev.mod_max,
      mod_fee:        mod?.fee         ?? prev.mod_fee,
      bailarinos_ids: (previousCoreografia.bailarinos_ids || []).filter(id =>
        elenco.some(b => b.id === id)
      ),
    }));
    setShowPrefillBanner(false);
    setStep(2);
  };

  /* ══════════════════════════════════════════════════════════
     SETUP BANNER (table missing)
  ══════════════════════════════════════════════════════════ */
  if (tableError) {
    return (
      <div className="max-w-2xl mx-auto mt-10 p-6 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
        <div className="flex items-center gap-3 mb-3">
          <AlertTriangle className="text-amber-500 shrink-0" size={20} />
          <h2 className="font-black uppercase tracking-tight text-amber-700 dark:text-amber-400">Tabela não encontrada</h2>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
          Execute o SQL abaixo no <strong>Editor SQL</strong> do Supabase:
        </p>
        <pre className="bg-black/10 dark:bg-black/40 p-4 rounded-xl text-xs text-amber-800 dark:text-amber-200 overflow-x-auto whitespace-pre-wrap font-mono select-all">
          {SETUP_SQL}
        </pre>
        <button onClick={() => { setTableError(false); fetchAll(); }}
          className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all">
          <Loader2 size={12} /> Verificar Novamente
        </button>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     MAIN RENDER
  ══════════════════════════════════════════════════════════ */
  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Minhas <span className="text-[#ff0068]">Coreografias</span>
          </h1>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
            {coreografias.length} inscrição{coreografias.length !== 1 ? 'ões' : ''} · Gerencie suas participações
          </p>
        </div>
        <button
          onClick={openAdd}
          disabled={elenco.length === 0 || allEvents.length === 0}
          title={
            elenco.length === 0 ? 'Cadastre bailarinos em "Meu Elenco" primeiro'
            : allEvents.length === 0 ? 'Nenhum evento disponível'
            : undefined
          }
          className="flex items-center gap-2 px-4 py-2.5 bg-[#ff0068] hover:bg-[#d4005a] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 active:scale-95 transition-all"
        >
          <Plus size={14} /> Nova Inscrição
        </button>
      </div>

      {/* ── Inscrições via vitrine pública (tabela registrations) ── */}
      {/* Workaround pra dívida #12 do backlog: unificar coreografias + registrations */}
      {!loading && vitrineRegs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Inscrições recentes
          </h2>
          <div className="space-y-2">
            {vitrineRegs.map(reg => {
              const ev = allEvents.find(e => e.id === reg.event_id);
              const statusColor = reg.status_pagamento === 'CONFIRMADO' || reg.status_pagamento === 'APROVADO'
                ? 'text-emerald-500 bg-emerald-500/10'
                : 'text-amber-500 bg-amber-500/10';
              const statusLabel = reg.status_pagamento === 'CONFIRMADO' || reg.status_pagamento === 'APROVADO'
                ? 'Confirmada'
                : 'Aguardando pagamento';
              return (
                <div key={reg.id} className="flex items-center gap-4 p-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight truncate">
                      {reg.nome_coreografia ?? '(sem nome)'}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                      {ev?.name ?? 'Evento'} · {reg.formato_participacao} · {reg.categoria}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${statusColor} shrink-0`}>
                    {statusLabel}
                  </span>
                  {reg.status_pagamento !== 'CONFIRMADO' && reg.status_pagamento !== 'APROVADO' && (
                    <button
                      onClick={() => navigate(`/festival/${reg.event_id}/checkout?registration_id=${reg.id}`)}
                      className="px-4 py-2 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4005a] transition-all shrink-0"
                    >
                      Pagar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Warnings (só para fluxo de coreografias com elenco) ── */}
      {!loading && elenco.length === 0 && coreografias.length === 0 && vitrineRegs.length === 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[9px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
            Pra montar grupos com elenco próprio, cadastre bailarinos em <strong>Meu Elenco</strong>. Pra inscrições simples (Solo, Duo), use a vitrine pública dos eventos.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[#ff0068]" />
        </div>
      ) : coreografias.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
            <Music2 size={24} className="text-slate-400" />
          </div>
          <div>
            <p className="font-black uppercase tracking-tight text-slate-500">Nenhuma inscrição</p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Crie sua primeira inscrição em um evento
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {coreografias.map(c => {
            const st = STATUS_CFG[c.status] || STATUS_CFG.RASCUNHO;
            return (
              <div key={c.id} className="p-4 bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/8 rounded-2xl hover:border-slate-300 dark:hover:border-white/15 transition-all">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-500/15 flex items-center justify-center shrink-0">
                    <Clapperboard size={16} className="text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{c.nome}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                        <button onClick={() => openEdit(c)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-all" title="Editar">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => setConfirmDel(c.id)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 transition-all" title="Remover">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {c.event_nome && (
                      <p className="text-[9px] font-bold text-slate-500 mt-0.5 flex items-center gap-1">
                        <Calendar size={9} /> {c.event_nome} {c.event_data && `· ${fmtDate(c.event_data)}`}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {c.estilo_nome && (
                        <span className="px-2 py-0.5 bg-[#ff0068]/10 text-[#ff0068] text-[7px] font-black uppercase tracking-widest rounded-full">{c.estilo_nome}</span>
                      )}
                      {c.categoria_nome && (
                        <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-[7px] font-black uppercase tracking-widest rounded-full">{c.categoria_nome}</span>
                      )}
                      {c.formacao && (
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 text-slate-500 text-[7px] font-black uppercase tracking-widest rounded-full">{c.formacao}</span>
                      )}
                    </div>
                    {c._bailarinos_nomes && c._bailarinos_nomes.length > 0 && (
                      <p className="text-[8px] font-bold text-slate-400 mt-1 truncate">
                        {c._bailarinos_nomes.join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          DELETE CONFIRMATION
      ══════════════════════════════════════════════════════════ */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-500/15 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-rose-500" />
            </div>
            <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">Remover inscrição?</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDel(null)}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                Cancelar
              </button>
              <button onClick={() => handleDelete(confirmDel)}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                <Trash2 size={12} /> Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          WIZARD MODAL
      ══════════════════════════════════════════════════════════ */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl flex flex-col max-h-[92vh]">

            {/* ── Modal header ── */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-white/8 shrink-0">
              <div>
                <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  {editingId ? 'Editar Inscrição' : 'Nova Inscrição'}
                </h2>
                <div className="flex items-center gap-1.5 mt-2">
                  {STEP_LABELS.map((label, i) => {
                    const s = i + 1;
                    return (
                      <React.Fragment key={label}>
                        <div className={`h-1.5 rounded-full transition-all duration-300 ${s < step ? 'bg-emerald-500 w-4' : s === step ? 'bg-[#ff0068] w-7' : 'bg-slate-200 dark:bg-white/10 w-3'}`} />
                      </React.Fragment>
                    );
                  })}
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    {STEP_LABELS[step - 1]}
                  </span>
                </div>
              </div>
              <button onClick={closeForm}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 transition-all">
                <X size={16} />
              </button>
            </div>

            {/* ── Modal body ── */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">

              {/* ════════════════════════
                  STEP 1: Evento + Nome
              ════════════════════════ */}
              {step === 1 && (
                <>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                      Nome da Coreografia *
                    </label>
                    <input type="text" value={form.nome}
                      onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                      placeholder="Ex: Ritmo da Rua"
                      className={`w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none transition-colors
                        ${formErrors.nome ? 'border-rose-400' : 'border-slate-200 dark:border-white/10 focus:border-[#ff0068]'}`}
                    />
                    {formErrors.nome && <p className="text-[9px] text-rose-500 font-bold mt-1">{formErrors.nome}</p>}
                  </div>

                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                      Evento *
                    </label>
                    {allEvents.length === 0 ? (
                      <div className="p-4 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[9px] text-slate-400 font-bold text-center">
                        Nenhum evento disponível no sistema.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {allEvents.map(ev => {
                          const selected = form.event_id === ev.id;
                          return (
                            <button key={ev.id}
                              onClick={() => setForm(f => ({
                                ...f,
                                event_id:    ev.id,
                                event_nome:  ev.name,
                                event_data:  ev.start_date || '',
                                estilo_nome: '',
                                subgenero:   '',
                                categoria_nome: '',
                                cat_min_age: 0,
                                cat_max_age: 99,
                                formacao:    '',
                                mod_min: 1,
                                mod_max: 99,
                                mod_fee: 0,
                                bailarinos_ids: [],
                              }))}
                              className={`w-full px-4 py-3 rounded-xl border text-left transition-all active:scale-[0.99]
                                ${selected
                                  ? 'bg-[#ff0068]/5 dark:bg-[#ff0068]/10 border-[#ff0068]'
                                  : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                                }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${selected ? 'bg-[#ff0068] text-white' : 'bg-slate-100 dark:bg-white/8 text-slate-400'}`}>
                                  <Star size={14} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className={`font-black text-[11px] uppercase tracking-tight truncate ${selected ? 'text-[#ff0068]' : 'text-slate-700 dark:text-slate-200'}`}>
                                    {ev.name}
                                  </p>
                                  <div className="flex gap-3 mt-0.5">
                                    {ev.start_date && (
                                      <span className="text-[8px] font-bold text-slate-400 flex items-center gap-1">
                                        <Calendar size={8} /> {fmtDate(ev.start_date)}
                                      </span>
                                    )}
                                    {ev.location && (
                                      <span className="text-[8px] font-bold text-slate-400 flex items-center gap-1 truncate">
                                        <MapPin size={8} /> {ev.location}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {selected && <CheckCircle size={16} className="text-[#ff0068] shrink-0" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {formErrors.event_id && <p className="text-[9px] text-rose-500 font-bold mt-1">{formErrors.event_id}</p>}
                  </div>

                  {/* ── "Usar dados do ano anterior" banner ── */}
                  {previousCoreografia && form.event_id && !editingId && (
                    <div className="flex items-start gap-3 p-4 bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/25 rounded-xl">
                      <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0">
                        <Clock size={14} className="text-violet-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-400">
                          Dados do ano anterior disponíveis
                        </p>
                        <p className="text-[9px] font-bold text-violet-600/70 dark:text-violet-400/70 mt-0.5">
                          Pré-preencher estilo, subgênero, formação e elenco de{' '}
                          <strong>{previousCoreografia.event_nome || 'edição anterior'}</strong>?
                        </p>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={handlePrefillFromPrevious}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all active:scale-95"
                          >
                            <CheckCircle size={10} /> Usar dados anteriores
                          </button>
                          <button
                            onClick={() => setShowPrefillBanner(false)}
                            className="px-3 py-1.5 text-violet-500 hover:text-violet-700 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all"
                          >
                            Ignorar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ════════════════════════
                  STEP 2: Estilo + Categoria + Formação
              ════════════════════════ */}
              {step === 2 && (
                <>
                  {/* Estilo */}
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                      Estilo de Dança *
                    </label>
                    {loadingStyles ? (
                      <div className="flex items-center gap-2 p-3 text-slate-400 text-[9px]">
                        <Loader2 size={12} className="animate-spin" /> Carregando estilos...
                      </div>
                    ) : stylesForEvent.length === 0 ? (
                      <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl text-[9px] text-amber-700 dark:text-amber-300 font-bold">
                        Nenhum estilo configurado para este evento ainda.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {stylesForEvent.map(s => (
                          <button key={s.id}
                            onClick={() => setForm(f => ({ ...f, estilo_nome: s.name, subgenero: '' }))}
                            className={`px-3 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest text-left transition-all active:scale-95
                              ${form.estilo_nome === s.name
                                ? 'bg-[#ff0068]/10 border-[#ff0068] text-[#ff0068]'
                                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-300 dark:hover:border-white/20'
                              }`}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {formErrors.estilo && <p className="text-[9px] text-rose-500 font-bold mt-1">{formErrors.estilo}</p>}
                  </div>

                  {/* Subgênero (conditional) */}
                  {selectedStyle && selectedStyle.sub_types.length > 0 && (
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                        Subgênero <span className="text-slate-300 dark:text-white/30 font-bold normal-case">(opcional)</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedStyle.sub_types.map(sub => (
                          <button key={sub.name}
                            onClick={() => setForm(f => ({ ...f, subgenero: f.subgenero === sub.name ? '' : sub.name }))}
                            className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest text-left transition-all active:scale-95
                              ${form.subgenero === sub.name
                                ? 'bg-violet-100 dark:bg-violet-500/15 border-violet-400 text-violet-600 dark:text-violet-400'
                                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-300 dark:hover:border-white/20'
                              }`}
                          >
                            {sub.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Categoria */}
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                      Categoria Etária *
                    </label>
                    {categoriasForEvent.length === 0 ? (
                      <div className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[9px] text-slate-400 font-bold">
                        Categorias não configuradas para este evento.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {categoriasForEvent.map(cat => (
                          <button key={cat.name}
                            onClick={() => setForm(f => ({
                              ...f,
                              categoria_nome: f.categoria_nome === cat.name ? '' : cat.name,
                              cat_min_age: f.categoria_nome === cat.name ? 0 : cat.min_age,
                              cat_max_age: f.categoria_nome === cat.name ? 99 : cat.max_age,
                              bailarinos_ids: [],
                            }))}
                            className={`w-full px-4 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between active:scale-[0.99]
                              ${form.categoria_nome === cat.name
                                ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-400 dark:border-indigo-500'
                                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                              }`}
                          >
                            <span className={`font-black text-[10px] uppercase tracking-widest ${form.categoria_nome === cat.name ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300'}`}>
                              {cat.name}
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 tabular-nums">
                              {cat.min_age}–{cat.max_age} anos
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {formErrors.categoria && <p className="text-[9px] text-rose-500 font-bold mt-1">{formErrors.categoria}</p>}
                  </div>

                  {/* Formação */}
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                      Formação *
                    </label>
                    {formacoesForEvent.length === 0 ? (
                      <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl text-[9px] text-amber-700 dark:text-amber-300 font-bold">
                        Formações não configuradas para este evento. Configure em <strong>Configurações → Formações</strong>.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {formacoesForEvent.map(mod => (
                          <button key={mod.name}
                            onClick={() => setForm(f => ({
                              ...f,
                              formacao: mod.name,
                              mod_min: mod.min_members,
                              mod_max: mod.max_members,
                              mod_fee: mod.fee ?? 0,
                              bailarinos_ids: [],
                            }))}
                            className={`px-3 py-3 rounded-xl border text-left transition-all active:scale-95
                              ${form.formacao === mod.name
                                ? 'bg-[#ff0068]/10 border-[#ff0068]'
                                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                              }`}
                          >
                            <p className={`font-black text-[10px] uppercase tracking-widest ${form.formacao === mod.name ? 'text-[#ff0068]' : 'text-slate-600 dark:text-slate-300'}`}>
                              {mod.name}
                            </p>
                            <p className="text-[8px] text-slate-400 font-bold mt-0.5">
                              {mod.min_members === mod.max_members
                                ? `${mod.min_members} pessoa`
                                : `${mod.min_members}–${mod.max_members === 99 ? '∞' : mod.max_members} pessoas`
                              }
                              {mod.fee ? ` · ${fmtCurrency(mod.fee)}` : ''}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                    {formErrors.formacao && <p className="text-[9px] text-rose-500 font-bold mt-1">{formErrors.formacao}</p>}
                  </div>
                </>
              )}

              {/* ════════════════════════
                  STEP 3: Bailarinos
              ════════════════════════ */}
              {step === 3 && (
                <>
                  {/* Context banner */}
                  <div className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl">
                    <Info size={12} className="text-slate-400 shrink-0 mt-0.5" />
                    <div className="text-[9px] font-bold text-slate-400 space-y-0.5">
                      <p>
                        Formação <span className="text-slate-600 dark:text-slate-300">{form.formacao}</span>:
                        {' '}{form.mod_min === form.mod_max ? `exatamente ${form.mod_min}` : `${form.mod_min}–${form.mod_max === 99 ? '∞' : form.mod_max}`} bailarino(s).
                        {' '}Selecionados: <span className="text-[#ff0068] font-black">{form.bailarinos_ids.length}</span>
                      </p>
                      {form.categoria_nome && form.event_data && (
                        <p className="flex items-center gap-1">
                          <Lock size={9} className="text-rose-400" />
                          Idades calculadas por: <span className="text-slate-600 dark:text-slate-300">{ageRefLabel}</span>
                          {' '}· Faixa válida: <span className="text-indigo-500">{form.cat_min_age}–{form.cat_max_age} anos</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Dancer list */}
                  <div className="space-y-2">
                    {elenco.map(b => {
                      const refDate  = resolveRefDate(form.event_data);
                      const age      = calcAgeOnDate(b.data_nascimento, refDate);
                      const eligible = isDancerEligible(b);
                      const selected = form.bailarinos_ids.includes(b.id);

                      return (
                        <button key={b.id}
                          onClick={() => toggleBailarino(b.id, eligible)}
                          disabled={!eligible}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all
                            ${!eligible
                              ? 'bg-rose-50/60 dark:bg-rose-500/5 border-rose-200 dark:border-rose-500/20 cursor-not-allowed opacity-75'
                              : selected
                                ? 'bg-[#ff0068]/5 dark:bg-[#ff0068]/10 border-[#ff0068] active:scale-[0.99]'
                                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/8 hover:border-slate-300 dark:hover:border-white/20 active:scale-[0.99]'
                            }`}
                        >
                          {/* Checkbox / Lock icon */}
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all
                            ${!eligible
                              ? 'bg-rose-100 dark:bg-rose-500/20 border-rose-300 dark:border-rose-500/40'
                              : selected
                                ? 'bg-[#ff0068] border-[#ff0068]'
                                : 'border-slate-300 dark:border-white/20'
                            }`}
                          >
                            {!eligible
                              ? <Lock size={10} className="text-rose-500" />
                              : selected
                                ? <CheckCircle size={12} className="text-white" />
                                : null
                            }
                          </div>

                          {/* Name */}
                          <div className="flex-1 min-w-0">
                            <p className={`font-black text-[11px] uppercase tracking-tight ${!eligible ? 'text-rose-500 dark:text-rose-400' : selected ? 'text-[#ff0068]' : 'text-slate-700 dark:text-slate-200'}`}>
                              {b.nome}
                            </p>
                            {!eligible && form.categoria_nome && (
                              <p className="text-[8px] font-bold text-rose-500 mt-0.5 flex items-center gap-1">
                                <ShieldAlert size={8} />
                                {age} anos ({ageRefLabel}) — fora da faixa {form.cat_min_age}–{form.cat_max_age} anos
                              </p>
                            )}
                          </div>

                          {/* Age badge */}
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                            !eligible
                              ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400'
                              : 'bg-slate-100 dark:bg-white/5 text-slate-500'
                          }`}>
                            {age} anos
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {formErrors.bailarinos && (
                    <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-[9px] font-bold">
                      <AlertCircle size={12} /> {formErrors.bailarinos}
                    </div>
                  )}

                  {toleranceStatus.violates && toleranceRule.enforcement === 'FLEXIBLE' && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl">
                      <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 space-y-1">
                        <p className="font-black uppercase tracking-widest">Tolerância excedida</p>
                        <p>
                          {toleranceStatus.outCount} de {toleranceStatus.totalCount} bailarino(s) fora da faixa etária
                          {toleranceRule.mode === 'PERCENT' && ` (${Math.round(toleranceStatus.pct)}%)`}.
                          Limite do evento: até {toleranceStatus.limitLabel}.
                        </p>
                        <p className="font-bold">Sua inscrição ficará pendente de aprovação manual do produtor.</p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ════════════════════════
                  STEP 4: Confirmação
              ════════════════════════ */}
              {step === 4 && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-2 py-2">
                    <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center">
                      <CreditCard size={24} className="text-amber-500" />
                    </div>
                    <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white">Confirmar Inscrição</p>
                    <p className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                      Status: Aguardando Pagamento
                    </p>
                  </div>

                  {/* Summary */}
                  {[
                    { label: 'Coreografia',  value: form.nome },
                    { label: 'Evento',        value: `${form.event_nome} · ${fmtDate(form.event_data)}` },
                    { label: 'Estilo',        value: [form.estilo_nome, form.subgenero].filter(Boolean).join(' › ') },
                    { label: 'Categoria',     value: `${form.categoria_nome} (${form.cat_min_age}–${form.cat_max_age} anos)` },
                    { label: 'Formação',       value: form.formacao },
                    { label: 'Bailarinos',    value: `${form.bailarinos_ids.length} selecionado(s)` },
                    ...(form.mod_fee > 0 ? [{ label: 'Valor da inscrição', value: fmtCurrency(form.mod_fee) }] : []),
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-100 dark:border-white/5 last:border-0">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">{label}</span>
                      <span className="text-[10px] font-black text-slate-900 dark:text-white text-right">{value || '—'}</span>
                    </div>
                  ))}

                  {/* Dancer names */}
                  {form.bailarinos_ids.length > 0 && (
                    <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-2">Elenco Selecionado</p>
                      <div className="space-y-1">
                        {form.bailarinos_ids.map(id => {
                          const b = elenco.find(x => x.id === id);
                          if (!b) return null;
                          const age = calcAgeOnDate(b.data_nascimento, resolveRefDate(form.event_data));
                          return (
                            <div key={id} className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200">{b.nome}</span>
                              <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400">{age} anos ✓</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {formErrors._global && (
                    <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-xs">
                      <AlertCircle size={12} /> {formErrors._global}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Modal footer ── */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-white/8 shrink-0 flex gap-3">
              {step > 1 && (
                <button onClick={handleBack}
                  className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  <ChevronLeft size={13} /> Voltar
                </button>
              )}

              {step < 4 ? (
                <button onClick={handleNext}
                  className="flex-1 py-3 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 active:scale-95 transition-all flex items-center justify-center gap-2">
                  Próximo <ChevronRight size={13} />
                </button>
              ) : (
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving
                    ? <Loader2 size={14} className="animate-spin" />
                    : <><CreditCard size={13} /> {editingId ? 'Salvar Alterações' : 'Inscrever — Aguardando Pagamento'}</>
                  }
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MinhasCoreografias;
