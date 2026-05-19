import React, { useEffect, useState, useMemo } from 'react';
import {
  Search, Download, RefreshCw,
  Trash2, AlertTriangle, X, DollarSign,
  ShieldAlert, CheckCircle2, Clock, Users, Info, ChevronDown,
  Undo2, Loader2, Eye, Music2, Video, Calendar, User, Instagram,
  TrendingUp, ExternalLink,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { refundRegistration } from '../services/refundService';

const Registrations = () => {
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [filteredRegistrations, setFilteredRegistrations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('ALL');
  const [modalidadeFilter, setModalidadeFilter] = useState('ALL');
  const [categoriaFilter, setCategoriaFilter] = useState('ALL');
  const [estiloFilter, setEstiloFilter] = useState('ALL');
  const [inscritoFilter, setInscritoFilter] = useState('ALL');
  // Sessão 3 P4 backlog painel produtor — filtro por range de data
  const [dateFilter, setDateFilter] = useState<'ALL' | 'today' | '7d' | '30d' | 'month'>('ALL');
  const [refundModal, setRefundModal] = useState<any>(null);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const handleOpenRefund = (reg: any) => {
    setRefundModal(reg);
    // Pré-preenche com valor pago (padrão Asaas/Stripe). Produtor edita
    // pra reembolso parcial. Tenta valor_total → valor_pago (legacy) → vazio.
    const valorPago = reg?.valor_total ?? reg?.valor_pago ?? null;
    setRefundAmount(valorPago != null && Number(valorPago) > 0 ? String(valorPago) : '');
    setRefundReason('');
    setRefundError(null);
  };

  const handleConfirmRefund = async () => {
    if (!refundModal) return;
    setRefunding(true);
    setRefundError(null);
    try {
      const result = await refundRegistration({
        registration_id: refundModal.id,
        amount:          refundAmount ? Number(refundAmount) : undefined,
        reason:          refundReason || undefined,
      });
      setRegistrations(prev => prev.map(r => r.id === refundModal.id
        ? { ...r, status_pagamento: 'ESTORNADO', refunded_at: new Date().toISOString(), refund_amount: result.refund_amount }
        : r));
      setRefundModal(null);
    } catch (e: any) {
      setRefundError(e.message);
    } finally {
      setRefunding(false);
    }
  };
  const [tab, setTab] = useState<'LIST' | 'TRIAGEM'>('LIST');
  const [reviewingReg, setReviewingReg] = useState<any>(null);
  // Modal "Ver detalhes" — pedido pelo produtor (Usualdance 2026-05-18).
  // Linha da tabela vira clicável (estilo Notion/Linear). Abre modal com
  // todos os campos: coreografia, bailarinos, trilha, vídeo, pagamento.
  const [viewingReg, setViewingReg] = useState<any>(null);

  /* tolerance + config loaded once */
  const [toleranceRule, setToleranceRule] = useState<{ mode: 'PERCENT' | 'COUNT'; value: number }>({ mode: 'PERCENT', value: 20 });
  const [ageRefMode, setAgeRefMode] = useState<'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE'>('EVENT_DAY');
  const [ageRefFixed, setAgeRefFixed] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [triageAction, setTriageAction] = useState<{ reg: any; decision: 'APPROVE' | 'PENALIZE' | 'DISQUALIFY' } | null>(null);

  /* Edition selector */
  const [allEvents, setAllEvents] = useState<{ id: string; name: string; edition_year?: number }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  /* Evento ativo (nome + slug) — usado no CTA do empty state pra compor o
     link público do evento. Carregado junto do fetchData. */
  const [activeEventInfo, setActiveEventInfo] = useState<{ name?: string; slug?: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    // Default do dropdown: primeiro evento (ordenado por created_at desc).
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('events')
        .select('id,name,edition_year,start_date,is_demo,created_at')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setAllEvents(data);
        setSelectedEventId(prev => prev ?? data[0].id);
      }
    })();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Schema real usa created_at (não criado_em). order com coluna inexistente
      // fazia o select falhar silently — explicação do "0 inscrições" no demo.
      // Pull events.video_selection_enabled pra o modal de detalhes mostrar a
      // seção "Vídeo (seletiva)" só quando o evento tem a feature habilitada.
      // Profiles NÃO podem ser embed porque registrations.user_id referencia
      // auth.users(id), não profiles(id) — Postgrest não infere a FK e o query
      // inteiro retorna 0 rows (bug em prod 2026-05-18). Fetch separado abaixo.
      // Sem embed events(...) — o embed quebrava a query inteira (Postgrest
      // retornava 0 rows) quando a RLS de events não permitia ler o evento
      // pai. Bug em prod 2026-05-18: /seletiva-video mostrava a inscrição
      // mas /registrations zerava. Fetch separado abaixo pega o flag de
      // video_selection_enabled do evento ativo (1 query por mount).
      let regsQuery = supabase
        .from('registrations')
        .select('*')
        .order('created_at', { ascending: false });
      if (selectedEventId) regsQuery = regsQuery.eq('event_id', selectedEventId);

      const { fetchActiveEventConfig } = await import('../services/supabase');
      const [
        { data, error },
        cfg,
      ] = await Promise.all([
        regsQuery,
        fetchActiveEventConfig('tolerancia,age_reference,age_reference_date,data_evento'),
      ]);
      if (error) throw error;

      // Hidrata profiles em batch (1 query extra). Vazio se nenhuma inscrição
      // tem user_id (fluxo antigo guest). Map por id pra lookup O(1) no merge.
      const userIds = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
      let profilesById: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, email, whatsapp')
          .in('id', userIds);
        profilesById = Object.fromEntries((profs || []).map(p => [p.id, p]));
      }

      // Fetch separado do evento ativo (modal + empty state precisam).
      // Não pode ser embed na query principal porque travava o query
      // inteiro em prod (ver bug 2026-05-18).
      let activeEvent: { video_selection_enabled?: boolean; name?: string; slug?: string } | null = null;
      if (selectedEventId) {
        const { data: ev } = await supabase
          .from('events')
          .select('video_selection_enabled, name, slug')
          .eq('id', selectedEventId)
          .maybeSingle();
        activeEvent = ev;
        setActiveEventInfo(ev);
      }

      const enriched = (data || []).map(r => ({
        ...r,
        profiles: r.user_id ? profilesById[r.user_id] ?? null : null,
        events: activeEvent,
      }));
      setRegistrations(enriched);
      setFilteredRegistrations(enriched);

      if (cfg?.tolerancia) setToleranceRule(cfg.tolerancia);
      if (cfg?.age_reference) setAgeRefMode(cfg.age_reference as 'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE');
      if (cfg?.age_reference_date) setAgeRefFixed(cfg.age_reference_date);
      if (cfg?.data_evento) setEventDate(cfg.data_evento);
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    // Webhook sempre salva 'APROVADO'. Manter consistência aqui também
    // — o painel deve mostrar o mesmo valor em ambos os caminhos
    // (pagamento real via Asaas + aprovação manual pelo produtor).
    const { error } = await supabase.from('registrations').update({ status: 'APROVADA', status_pagamento: 'APROVADO' }).eq('id', id);
    if (error) return;
    setRegistrations(prev => prev.map(reg => reg.id === id ? { ...reg, status: 'APROVADA', status_pagamento: 'APROVADO' } : reg));
    setReviewingReg(null);
  };

  /* age-tolerance helpers */
  const resolveRefDate = (regEventDate?: string): string => {
    const base = regEventDate || eventDate || new Date().toISOString().slice(0, 10);
    if (ageRefMode === 'YEAR_END') {
      const year = new Date(base + 'T12:00:00').getFullYear();
      return `${year}-12-31`;
    }
    if (ageRefMode === 'FIXED_DATE' && ageRefFixed) return ageRefFixed;
    return base;
  };

  const calcAge = (dob: string, refDate: string) => {
    const birth = new Date(dob + 'T00:00:00');
    const ref = new Date(refDate + 'T00:00:00');
    let age = ref.getFullYear() - birth.getFullYear();
    const m = ref.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
    return age;
  };

  /**
   * Checks if a registration violates the age tolerance rule.
   * Returns { violates: boolean, outCount: number, totalCount: number, pct: number }
   */
  const checkViolation = (reg: any) => {
    const bailarinos: any[] = reg.bailarinos_detalhes || [];
    if (!bailarinos.length || !reg.cat_min_age || !reg.cat_max_age) {
      return { violates: false, outCount: 0, totalCount: bailarinos.length, pct: 0 };
    }
    const refDate = resolveRefDate(reg.event_data);
    const outOfRange = bailarinos.filter(b => {
      if (!b.data_nascimento) return false;
      const age = calcAge(b.data_nascimento, refDate);
      return age < reg.cat_min_age || age > reg.cat_max_age;
    });
    const outCount = outOfRange.length;
    const totalCount = bailarinos.length;
    const pct = totalCount > 0 ? (outCount / totalCount) * 100 : 0;

    let violates = false;
    if (toleranceRule.mode === 'PERCENT') violates = pct > toleranceRule.value;
    else violates = outCount > toleranceRule.value;

    return { violates, outCount, totalCount, pct, outOfRange };
  };

  /* registrations that actually have a violation */
  // Helper: webhook usa 'APROVADO'. Legado de meses atrás usava 'CONFIRMADO'.
  // Aceitar ambos pra cobrir rows antigas até backfill.
  const isPago = (s?: string) => s === 'APROVADO' || s === 'CONFIRMADO';

  const violatingRegs = useMemo(() => {
    return registrations
      .filter(r => isPago(r.status_pagamento))
      .filter(r => {
        const { violates } = checkViolation(r);
        return violates;
      })
      .map(r => ({ ...r, _violation: checkViolation(r) }));
  }, [registrations, toleranceRule, ageRefMode, ageRefFixed, eventDate]); // eslint-disable-line

  // Só dispara fetchData quando selectedEventId já resolveu — antes disso, o
  // primeiro fetch trazia TODOS os registros (sem filter), depois o segundo
  // fetch filtrava por evento e zerava se não batesse. Daí o flash "aparece
  // e some". Solução: aguardar resolução do evento ativo, evita 2 requests
  // e o flicker do estado intermediário.
  useEffect(() => {
    if (selectedEventId) fetchData();
    // Se allEvents resolveu vazio (produtor sem eventos), libera o loading
    else if (allEvents.length > 0 && !selectedEventId) setIsLoading(false);
  }, [selectedEventId, allEvents.length]); // eslint-disable-line

  useEffect(() => {
    let result = registrations;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(reg =>
        reg.nome_coreografia?.toLowerCase().includes(term) ||
        reg.estudio?.toLowerCase().includes(term) ||
        reg.profiles?.full_name?.toLowerCase().includes(term) ||
        reg.profiles?.email?.toLowerCase().includes(term)
      );
    }
    if (paymentFilter !== 'ALL') {
      // 'APROVADO' do filtro cobre rows antigas com 'CONFIRMADO' também.
      result = paymentFilter === 'APROVADO'
        ? result.filter(reg => isPago(reg.status_pagamento))
        : result.filter(reg => reg.status_pagamento === paymentFilter);
    }
    if (modalidadeFilter !== 'ALL') result = result.filter(reg => reg.formato_participacao === modalidadeFilter);
    if (categoriaFilter !== 'ALL') result = result.filter(reg => reg.categoria === categoriaFilter);
    if (estiloFilter !== 'ALL')    result = result.filter(reg => reg.estilo_danca === estiloFilter);
    if (inscritoFilter !== 'ALL')  result = result.filter(reg => (reg.inscrito_nome ?? reg.profiles?.full_name) === inscritoFilter);
    // Filtro por data — usa created_at (data da inscrição)
    if (dateFilter !== 'ALL') {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const cutoff = (() => {
        if (dateFilter === 'today') return startOfDay;
        if (dateFilter === '7d')    return startOfDay - 6 * 86400_000;
        if (dateFilter === '30d')   return startOfDay - 29 * 86400_000;
        if (dateFilter === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        return 0;
      })();
      result = result.filter(reg => {
        const t = new Date(reg.created_at ?? reg.criado_em ?? 0).getTime();
        return t >= cutoff;
      });
    }
    setFilteredRegistrations(result);
  }, [searchTerm, paymentFilter, modalidadeFilter, categoriaFilter, estiloFilter, inscritoFilter, dateFilter, registrations]);

  /* Stats no topo — cards de KPI (padrão Stripe Dashboard).
     Derivados de registrations (não filteredRegistrations) pra manter
     contexto global do evento mesmo com filtros ativos. */
  const stats = useMemo(() => {
    const total = registrations.length;
    const confirmadas = registrations.filter(r => isPago(r.status_pagamento)).length;
    const pendentes   = registrations.filter(r => r.status_pagamento === 'PENDENTE').length;
    // Helper: extrai o valor "esperado" da inscrição (snapshot ou config).
    const valorDe = (r: any) => Number(r.valor_pago ?? r.valor_total ?? r.charged_amount ?? r.mod_fee ?? 0) || 0;
    // Receita já recebida (APROVADO)
    const receita     = registrations.filter(r => isPago(r.status_pagamento)).reduce((s, r) => s + valorDe(r), 0);
    // Sessão 3 P9: receita prevista = soma das pendentes que ainda podem pagar.
    const receitaPrevista = registrations
      .filter(r => r.status_pagamento === 'PENDENTE')
      .reduce((s, r) => s + valorDe(r), 0);
    return { total, confirmadas, pendentes, receita, receitaPrevista };
  }, [registrations]);

  /* Listas únicas pros dropdowns de filtro. Derivadas do dataset bruto pra
     não sumir opções quando o user já filtrou. */
  const categoriasDisponiveis = useMemo(() => {
    return [...new Set(registrations.map(r => r.categoria).filter(Boolean))].sort();
  }, [registrations]);
  const estilosDisponiveis = useMemo(() => {
    return [...new Set(registrations.map(r => r.estilo_danca).filter(Boolean))].sort();
  }, [registrations]);
  /* Lista de inscritos únicos pro filtro. Usa snapshot inscrito_nome primeiro
     (sobrevive a delete de profile), fallback pro profile fetched. Crítico
     pra dona de estúdio: ela inscreve N coreografias, filtro mostra todas. */
  const inscritosDisponiveis = useMemo(() => {
    return [...new Set(registrations.map(r => r.inscrito_nome ?? r.profiles?.full_name).filter(Boolean))].sort();
  }, [registrations]);

  const handleExportCSV = () => {
    if (filteredRegistrations.length === 0) return;
    const headers = [
      'Data', 'Coreografia', 'Modalidade', 'Tipo', 'Estúdio',
      'Categoria', 'Estilo', 'Inscrito', 'Email', 'WhatsApp',
      'Status Inscrição', 'Status Pagamento', 'Valor (R$)',
    ];
    const escape = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filteredRegistrations.map(r => [
      r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '',
      r.nome_coreografia ?? '',
      r.formato_participacao ?? '',
      r.tipo_apresentacao ?? '',
      r.estudio ?? '',
      r.categoria ?? '',
      r.estilo_danca ?? '',
      r.profiles?.full_name ?? '',
      r.profiles?.email ?? '',
      r.profiles?.whatsapp ?? '',
      r.status ?? '',
      r.status_pagamento ?? '',
      r.valor_total != null ? Number(r.valor_total).toFixed(2) : '',
    ].map(escape).join(','));
    // BOM UTF-8 pro Excel BR abrir com acentuação correta
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscricoes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleTriageDecision = async (regId: string, decision: 'APPROVE' | 'PENALIZE' | 'DISQUALIFY') => {
    let update: any = { penalidade_status: 'RESOLVIDO' };
    if (decision === 'APPROVE')     update = { ...update, penalidade_aplicada: 'NENHUMA' };
    if (decision === 'PENALIZE')    update = { ...update, penalidade_aplicada: 'DESCONTO_NOTA' };
    if (decision === 'DISQUALIFY')  update = { ...update, status: 'DESCLASSIFICADA', penalidade_aplicada: 'DESCLASSIFICACAO' };
    await supabase.from('registrations').update(update).eq('id', regId);
    setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, ...update } : r));
    setTriageAction(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APROVADO':
      case 'CONFIRMADO': return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';
      case 'PENDENTE': return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20';
      case 'VENCIDO':
      case 'EXPIRADO': return 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20';
      case 'ESTORNADO':
      case 'CANCELADO': return 'bg-slate-100 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-500/20';
      default: return 'bg-slate-100 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-500/20';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Inscrições</h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Controle mestre do festival</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:shrink-0">
          {/* Edition selector */}
          {allEvents.length > 0 && (
            <div className="relative w-full sm:w-auto">
              <select
                value={selectedEventId ?? ''}
                onChange={e => setSelectedEventId(e.target.value)}
                className="w-full sm:w-auto appearance-none pl-4 pr-9 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white outline-none focus:border-[#ff0068]/50 transition-all cursor-pointer truncate dark:[color-scheme:dark]"
              >
                {allEvents.map(ev => (
                  <option key={ev.id} value={ev.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                    {ev.edition_year ? `${ev.edition_year} — ` : ''}{ev.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={fetchData} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all shrink-0">
              <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleExportCSV}
              disabled={filteredRegistrations.length === 0}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-40 disabled:cursor-not-allowed"
              title={filteredRegistrations.length === 0 ? 'Nada pra exportar com os filtros atuais' : `Exportar ${filteredRegistrations.length} inscrição(ões)`}
            >
              <Download size={14} /> Exportar CSV
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-4 border-b border-slate-200 dark:border-white/5">
        {['LIST', 'TRIAGEM'].map((t: any) => (
          <button key={t} onClick={() => setTab(t)} className={`pb-4 px-2 text-[10px] font-black uppercase tracking-widest transition-all relative ${tab === t ? 'text-[#ff0068]' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>
            {t === 'LIST' ? 'Lista Geral' : 'Triagem de Regulamento'}
            {tab === t && <motion.div layoutId="tab" className="absolute bottom-0 left-0 w-full h-1 bg-[#ff0068] rounded-full" />}
          </button>
        ))}
      </div>

      {tab === 'LIST' ? (
        <div className="space-y-6">
          {/* Stats cards — padrão Stripe Dashboard. KPIs do evento ativo,
              não respeitam filtros (visão macro mesmo com filtro estreito). */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={<Users size={14} />}        label="Total"       value={String(stats.total)}       tone="slate" />
            <StatCard icon={<CheckCircle2 size={14} />} label="Confirmadas" value={String(stats.confirmadas)} tone="emerald" />
            <StatCard icon={<Clock size={14} />}        label="Pendentes"   value={String(stats.pendentes)}   tone="amber" />
            <StatCard icon={<TrendingUp size={14} />}   label="Receita"     value={`R$ ${stats.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} tone="pink" />
            {/* Sessão 3 P9: receita prevista = soma das pendentes que ainda
                podem virar pagamento. Ajuda o produtor a saber o teto da
                edição sem ter que filtrar e somar mentalmente. */}
            <StatCard icon={<TrendingUp size={14} />}   label="Prevista"    value={`R$ ${stats.receitaPrevista.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} tone="slate" />
          </div>

          <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-3xl border border-slate-200 dark:border-white/5 flex flex-col gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input type="text" placeholder="Buscar coreografia, estúdio, inscrito ou e-mail..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
              <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-3 py-3 text-[10px] font-black uppercase text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark]">
                <option value="ALL"        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Pagamento: Todos</option>
                <option value="APROVADO"   className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Confirmado</option>
                <option value="PENDENTE"   className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Pendente</option>
                <option value="VENCIDO"    className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Vencido</option>
                <option value="ESTORNADO"  className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Estornado</option>
                <option value="EXPIRADO"   className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Expirado</option>
              </select>
              {/* Sessão 3 P4: filtro por range de data */}
              <select value={dateFilter} onChange={e => setDateFilter(e.target.value as any)} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-3 py-3 text-[10px] font-black uppercase text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark]">
                <option value="ALL"   className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Data: Todas</option>
                <option value="today" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Hoje</option>
                <option value="7d"    className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">7 dias</option>
                <option value="30d"   className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">30 dias</option>
                <option value="month" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Este mês</option>
              </select>
              <select value={modalidadeFilter} onChange={e => setModalidadeFilter(e.target.value)} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-3 py-3 text-[10px] font-black uppercase text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark]">
                <option value="ALL"   className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Modalidade: Todas</option>
                <option value="Solo"  className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Solo</option>
                <option value="Duo"   className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Duo</option>
                <option value="Trio"  className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Trio</option>
                <option value="Grupo" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Grupo</option>
              </select>
              <select value={categoriaFilter} onChange={e => setCategoriaFilter(e.target.value)} disabled={categoriasDisponiveis.length === 0} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-3 py-3 text-[10px] font-black uppercase text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark] disabled:opacity-50">
                <option value="ALL" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Categoria: Todas</option>
                {categoriasDisponiveis.map(c => (
                  <option key={c} value={c} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">{c}</option>
                ))}
              </select>
              <select value={estiloFilter} onChange={e => setEstiloFilter(e.target.value)} disabled={estilosDisponiveis.length === 0} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-3 py-3 text-[10px] font-black uppercase text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark] disabled:opacity-50">
                <option value="ALL" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Estilo: Todos</option>
                {estilosDisponiveis.map(e => (
                  <option key={e} value={e} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">{e}</option>
                ))}
              </select>
              <select value={inscritoFilter} onChange={e => setInscritoFilter(e.target.value)} disabled={inscritosDisponiveis.length === 0} className="col-span-2 lg:col-span-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-3 py-3 text-[10px] font-black uppercase text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark] disabled:opacity-50">
                <option value="ALL" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Inscrito: Todos</option>
                {inscritosDisponiveis.map(n => (
                  <option key={n} value={n} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">{n}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mobile: cards (md:hidden). Em desktop renderiza a table abaixo.
              Padrão Sympla/Mercado Pago — em mobile cada inscrição vira card
              tap-friendly, sem scroll horizontal. */}
          <div className="md:hidden space-y-3">
            {isLoading ? (
              <div className="py-20 text-center bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl">
                <RefreshCw className="animate-spin mx-auto text-[#ff0068]" size={32} />
              </div>
            ) : filteredRegistrations.length === 0 ? (
              <div className="py-16 px-4 text-center bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl">
                {registrations.length === 0 ? (
                  <div className="max-w-md mx-auto space-y-5">
                    <div className="w-16 h-16 mx-auto bg-[#ff0068]/10 rounded-3xl flex items-center justify-center">
                      <Users size={28} className="text-[#ff0068]" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Nenhuma inscrição ainda</p>
                      <p className="text-[11px] text-slate-500 mt-1 normal-case font-normal">Compartilhe o link do evento pros bailarinos se inscreverem.</p>
                    </div>
                    {activeEventInfo?.slug && (() => {
                      const url = `${window.location.origin}/evento/${activeEventInfo.slug}`;
                      return (
                        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 flex items-center gap-2 text-left">
                          <code className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate font-mono">{url}</code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(url).then(() => {
                                setCopiedLink(true);
                                setTimeout(() => setCopiedLink(false), 2000);
                              });
                            }}
                            className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shrink-0 ${copiedLink ? 'bg-emerald-500 text-white' : 'bg-[#ff0068] text-white hover:bg-[#e0005c]'}`}
                          >
                            {copiedLink ? <><CheckCircle2 size={12} /> Copiado</> : <><Eye size={12} /> Copiar</>}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <>
                    <p className="text-slate-500 font-black uppercase text-xs">Nenhuma inscrição encontrada</p>
                    <button
                      onClick={() => {
                        setSearchTerm('');
                        setPaymentFilter('ALL');
                        setModalidadeFilter('ALL');
                        setCategoriaFilter('ALL');
                        setEstiloFilter('ALL');
                      }}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068] hover:text-white transition-all"
                    >
                      <X size={12} /> Limpar filtros
                    </button>
                  </>
                )}
              </div>
            ) : (
              filteredRegistrations.map(reg => (
                <div
                  key={reg.id}
                  onClick={() => setViewingReg(reg)}
                  className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl p-4 cursor-pointer hover:border-[#ff0068]/30 transition-all"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-slate-900 dark:text-white uppercase tracking-tight text-sm">{reg.nome_coreografia}</p>
                      <p className="text-[9px] text-[#ff0068] font-bold uppercase tracking-widest mt-0.5">{reg.tipo_apresentacao}{reg.formato_participacao ? ` · ${reg.formato_participacao}` : ''}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border whitespace-nowrap ${getStatusColor(reg.status_pagamento)}`}>{reg.status_pagamento}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] mb-3">
                    {(reg.inscrito_nome ?? reg.profiles?.full_name) && (
                      <div className="min-w-0">
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Inscrito</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold truncate">{reg.inscrito_nome ?? reg.profiles?.full_name}</p>
                      </div>
                    )}
                    {reg.estudio && (
                      <div className="min-w-0">
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Estúdio</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold truncate">{reg.estudio}</p>
                      </div>
                    )}
                    {reg.categoria && (
                      <div className="min-w-0">
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Categoria</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold truncate">{reg.categoria}</p>
                      </div>
                    )}
                    {reg.created_at && (
                      <div>
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Data</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold">{new Date(reg.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })}</p>
                      </div>
                    )}
                    {reg.valor_total != null && Number(reg.valor_total) > 0 && (
                      <div>
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Valor</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold">R$ {Number(reg.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-1 pt-3 border-t border-slate-100 dark:border-white/5">
                    <button
                      onClick={e => { e.stopPropagation(); setViewingReg(reg); }}
                      className="p-2 text-slate-500 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg transition-all"
                      title="Ver detalhes"
                    ><Eye size={16} /></button>
                    {reg.status_pagamento === 'PENDENTE' && (
                      <button
                        onClick={e => { e.stopPropagation(); setReviewingReg(reg); }}
                        className="p-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-500 hover:text-white transition-all"
                        title="Validar pagamento"
                      ><DollarSign size={16} /></button>
                    )}
                    {(reg.status_pagamento === 'CONFIRMADO' || reg.status_pagamento === 'APROVADO') && (
                      <button
                        onClick={e => { e.stopPropagation(); handleOpenRefund(reg); }}
                        className="p-2 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-500 hover:text-white transition-all"
                        title="Reembolsar"
                      ><Undo2 size={16} /></button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop: tabela tradicional (hidden md:block). */}
          <div className="hidden md:block bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-x-auto shadow-sm dark:shadow-2xl">
            <table className="w-full min-w-[640px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Coreografia</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden lg:table-cell">Inscrito</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden md:table-cell">Estúdio</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden xl:table-cell">Categoria</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden xl:table-cell">Data</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right hidden md:table-cell">Valor</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Pagamento</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {isLoading ? (
                  <tr><td colSpan={8} className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-[#ff0068]" size={32} /></td></tr>
                ) : filteredRegistrations.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      {/* 2 estados de vazio diferentes:
                          1) Sem inscrições nenhuma no evento → CTA pra compartilhar
                             o link público (chama bailarinos pra se inscreverem).
                          2) Tem inscrições mas filtros zeraram → reset dos filtros. */}
                      {registrations.length === 0 ? (
                        <div className="max-w-md mx-auto space-y-5 px-4">
                          <div className="w-16 h-16 mx-auto bg-[#ff0068]/10 rounded-3xl flex items-center justify-center">
                            <Users size={28} className="text-[#ff0068]" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Nenhuma inscrição ainda</p>
                            <p className="text-[11px] text-slate-500 mt-1 normal-case font-normal">Compartilhe o link do evento pros bailarinos se inscreverem.</p>
                          </div>
                          {activeEventInfo?.slug ? (() => {
                            const url = `${window.location.origin}/evento/${activeEventInfo.slug}`;
                            return (
                              <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 flex items-center gap-2 text-left">
                                <code className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate font-mono">{url}</code>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(url).then(() => {
                                      setCopiedLink(true);
                                      setTimeout(() => setCopiedLink(false), 2000);
                                    });
                                  }}
                                  className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shrink-0 ${
                                    copiedLink
                                      ? 'bg-emerald-500 text-white'
                                      : 'bg-[#ff0068] text-white hover:bg-[#e0005c]'
                                  }`}
                                >
                                  {copiedLink ? <><CheckCircle2 size={12} /> Copiado</> : <><Eye size={12} /> Copiar</>}
                                </button>
                              </div>
                            );
                          })() : (
                            <p className="text-[10px] text-slate-400 normal-case">Configure um <em>slug</em> pro evento pra gerar o link de compartilhamento.</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <p className="text-slate-500 font-black uppercase text-xs">Nenhuma inscrição encontrada</p>
                          <button
                            onClick={() => {
                              setSearchTerm('');
                              setPaymentFilter('ALL');
                              setModalidadeFilter('ALL');
                              setCategoriaFilter('ALL');
                              setEstiloFilter('ALL');
                              setInscritoFilter('ALL');
                            }}
                            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068] hover:text-white transition-all"
                          >
                            <X size={12} /> Limpar filtros
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ) : filteredRegistrations.map(reg => (
                  <tr
                    key={reg.id}
                    onClick={() => setViewingReg(reg)}
                    className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                    title="Ver detalhes da inscrição"
                  >
                    <td className="px-4 sm:px-8 py-6">
                      <p className="font-black text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-[#ff0068] transition-colors">{reg.nome_coreografia}</p>
                      <p className="text-[9px] text-[#ff0068] font-bold uppercase tracking-widest">{reg.tipo_apresentacao}</p>
                      {/* Mostra estúdio + categoria em mobile (colunas escondidas em <md/<lg) */}
                      <p className="text-[10px] text-slate-500 mt-1 md:hidden">{reg.estudio}{reg.categoria ? ` · ${reg.categoria}` : ''}</p>
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-xs font-bold text-slate-700 dark:text-slate-200 hidden lg:table-cell truncate max-w-[160px]">
                      {reg.inscrito_nome ?? reg.profiles?.full_name ?? <span className="text-slate-400 font-normal">—</span>}
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-xs font-bold text-slate-600 dark:text-slate-300 hidden md:table-cell">{reg.estudio}</td>
                    <td className="px-4 sm:px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden xl:table-cell">{reg.categoria}</td>
                    <td className="px-4 sm:px-8 py-6 text-[10px] text-slate-500 hidden xl:table-cell whitespace-nowrap">
                      {reg.created_at ? new Date(reg.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-right text-xs font-bold text-slate-700 dark:text-slate-300 hidden md:table-cell whitespace-nowrap">
                      {(() => {
                        // Webhook novo (2026-05-31) seta valor_pago. Legado usa valor_total. Fallback final: mod_fee.
                        const v = Number(reg.valor_pago ?? reg.valor_total ?? reg.mod_fee ?? 0);
                        return v > 0
                          ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : <span className="text-slate-400 font-normal">—</span>;
                      })()}
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-center">
                      <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${getStatusColor(reg.status_pagamento)}`}>{reg.status_pagamento}</span>
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-right">
                      {/* stopPropagation em cada ação pra clique na linha não disparar.
                          Botão de ver explícito (Eye) pra dar affordance — mesmo com a linha clicável,
                          padrão Notion/Linear mantém ícone visível pra reduzir incerteza. */}
                      <div className="flex justify-end gap-1 sm:gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); setViewingReg(reg); }}
                          className="p-2 text-slate-500 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg transition-all"
                          title="Ver detalhes"
                        ><Eye size={16} /></button>
                        {reg.status_pagamento === 'PENDENTE' && (
                          <button
                            onClick={e => { e.stopPropagation(); setReviewingReg(reg); }}
                            className="p-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-500 hover:text-white transition-all"
                            title="Validar pagamento"
                          ><DollarSign size={16} /></button>
                        )}
                        {(reg.status_pagamento === 'CONFIRMADO' || reg.status_pagamento === 'APROVADO') && (
                          <button
                            onClick={e => { e.stopPropagation(); handleOpenRefund(reg); }}
                            className="p-2 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-500 hover:text-white transition-all"
                            title="Reembolsar"
                          ><Undo2 size={16} /></button>
                        )}
                        <button
                          onClick={e => e.stopPropagation()}
                          className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-all opacity-50 cursor-not-allowed"
                          title="Remover (em breve)"
                          disabled
                        ><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── TRIAGEM DE REGULAMENTO ── */
        <div className="space-y-6">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
            <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest">Regra Ativa</p>
              <p className="text-[10px] text-amber-600 dark:text-amber-300 mt-0.5">
                Tolerância: {toleranceRule.mode === 'PERCENT'
                  ? `até ${toleranceRule.value}% do grupo fora da faixa etária`
                  : `até ${toleranceRule.value} participante(s) fora da faixa etária`}
                {' · '}Referência: {ageRefMode === 'EVENT_DAY' ? 'data do evento' : ageRefMode === 'YEAR_END' ? '31/12 do ano' : ageRefFixed || 'data fixa'}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="py-20 flex justify-center"><RefreshCw className="animate-spin text-[#ff0068]" size={28} /></div>
          ) : violatingRegs.length === 0 ? (
            <div className="py-20 text-center bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-[3rem]">
              <CheckCircle2 className="mx-auto text-emerald-500 mb-4" size={40} />
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhuma infração pendente de triagem</p>
              <p className="text-[10px] text-slate-400 mt-1">Todas as inscrições confirmadas estão dentro da tolerância configurada.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                {violatingRegs.length} inscrição(ões) aguardando decisão
              </p>
              {violatingRegs.map(reg => (
                <div
                  key={reg.id}
                  className="bg-white dark:bg-slate-900/50 border border-amber-300/40 dark:border-amber-500/20 rounded-3xl p-5 flex flex-col sm:flex-row gap-4 sm:items-center"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-amber-500/10 rounded-2xl flex items-center justify-center shrink-0">
                      <ShieldAlert size={18} className="text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-slate-900 dark:text-white uppercase truncate">{reg.nome_coreografia || '—'}</p>
                      <p className="text-[9px] text-slate-500 uppercase tracking-widest">{reg.estudio} · {reg.categoria}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Users size={10} className="text-amber-500" />
                        <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                          {reg._violation.outCount}/{reg._violation.totalCount} fora da faixa
                          {' '}({reg._violation.pct.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 shrink-0 flex-wrap">
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'APPROVE' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-white transition-all"
                    >
                      <CheckCircle2 size={12} /> Aprovar
                    </button>
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'PENALIZE' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-amber-500 hover:text-white transition-all"
                    >
                      <Clock size={12} /> Penalizar
                    </button>
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'DISQUALIFY' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all"
                    >
                      <AlertTriangle size={12} /> Desclassificar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {/* ── Triage decision modal ── */}
        {triageAction && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTriageAction(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                  {triageAction.decision === 'APPROVE'    && <span className="text-emerald-500">Aprovar</span>}
                  {triageAction.decision === 'PENALIZE'   && <span className="text-amber-500">Penalizar</span>}
                  {triageAction.decision === 'DISQUALIFY' && <span className="text-rose-500">Desclassificar</span>}
                </h2>
                <button onClick={() => setTriageAction(null)} className="p-2 text-slate-500 hover:text-rose-500"><X size={20} /></button>
              </div>
              <div className="p-8 space-y-5">
                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl">
                  <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest">Inscrição</p>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase mt-1">{triageAction.reg.nome_coreografia || '—'}</p>
                  <p className="text-[9px] text-amber-500 font-black uppercase mt-0.5">
                    {triageAction.reg._violation.outCount} fora da faixa etária
                    {' '}({triageAction.reg._violation.pct.toFixed(0)}%)
                  </p>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {triageAction.decision === 'APPROVE'    && 'A inscrição será aprovada com exceção de tolerância registrada.'}
                  {triageAction.decision === 'PENALIZE'   && 'Uma penalidade de desconto de nota será aplicada na avaliação.'}
                  {triageAction.decision === 'DISQUALIFY' && 'A inscrição será desclassificada e não concorrerá a resultados.'}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setTriageAction(null)} className="flex-1 py-3 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleTriageDecision(triageAction.reg.id, triageAction.decision)}
                    className={`flex-1 py-3 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg ${
                      triageAction.decision === 'APPROVE'    ? 'bg-emerald-500 shadow-emerald-500/20 hover:scale-105' :
                      triageAction.decision === 'PENALIZE'   ? 'bg-amber-500 shadow-amber-500/20 hover:scale-105' :
                      'bg-rose-500 shadow-rose-500/20 hover:scale-105'
                    }`}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reviewingReg && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setReviewingReg(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Auditoria <span className="text-[#ff0068]">Financeira</span></h2>
                <button onClick={() => setReviewingReg(null)} className="p-2 text-slate-500 hover:text-rose-500"><X size={24} /></button>
              </div>
              <div className="p-8 space-y-6">
                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-2">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Coreografia</p>
                  <p className="text-sm font-black text-slate-900 dark:text-white uppercase">{reviewingReg.nome_coreografia}</p>
                </div>
                <div className="p-4 bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-2xl flex justify-between items-center">
                  <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest">Valor Total</span>
                  <span className="text-xl font-black text-[#ff0068]">R$ {reviewingReg.valor_total || '0,00'}</span>
                </div>
                <button onClick={() => handleApprove(reviewingReg.id)} className="w-full py-5 bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl shadow-emerald-500/20">Confirmar Recebimento</button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── Refund modal ── */}
        {refundModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !refunding && setRefundModal(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl border border-amber-500/20">
                    <Undo2 size={16} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight italic">Reembolso</h2>
                    <p className="text-[10px] text-slate-500">{refundModal.nome_coreografia ?? refundModal.estudio ?? '—'}</p>
                  </div>
                </div>
                <button onClick={() => !refunding && setRefundModal(null)} disabled={refunding} className="p-2 text-slate-500 hover:text-rose-500 disabled:opacity-50"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                    O valor será estornado pela Asaas para o bailarino. Sua comissão também é estornada proporcionalmente. <strong>Ação irreversível.</strong>
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Valor a reembolsar</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={refundAmount}
                    onChange={e => setRefundAmount(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500/50"
                  />
                  {(refundModal?.valor_total ?? refundModal?.valor_pago) != null && (
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      Pago: <strong className="text-slate-700 dark:text-slate-300">R$ {Number(refundModal?.valor_total ?? refundModal?.valor_pago).toFixed(2)}</strong>. Edite pra reembolsar parcialmente.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Motivo (opcional)</label>
                  <textarea
                    rows={3}
                    value={refundReason}
                    onChange={e => setRefundReason(e.target.value)}
                    placeholder="Ex: Cancelamento solicitado pelo bailarino..."
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500/50 resize-none"
                  />
                </div>

                {refundError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                    <AlertTriangle size={14} className="text-red-500 shrink-0" />
                    <p className="text-xs text-red-600 dark:text-red-400">{refundError}</p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setRefundModal(null)}
                    disabled={refunding}
                    className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirmRefund}
                    disabled={refunding}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                  >
                    {refunding ? <Loader2 size={14} className="animate-spin" /> : <><Undo2 size={14} /> Confirmar Reembolso</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal "Ver Detalhes" — pedido produtor Usualdance 2026-05-18.
          Estilo Notion/Linear: linha clicável abre painel lateral/modal
          com tudo sobre a inscrição. Padrão dashboard moderno. */}
      <AnimatePresence>
        {viewingReg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setViewingReg(null)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              {/* Header sticky */}
              <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 px-6 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068] mb-1">{viewingReg.tipo_apresentacao ?? '—'}</p>
                  <h2 className="font-black text-lg uppercase tracking-tight text-slate-900 dark:text-white leading-tight">{viewingReg.nome_coreografia ?? 'Sem nome'}</h2>
                  {viewingReg.estudio && <p className="text-[11px] text-slate-500 mt-1">{viewingReg.estudio}</p>}
                </div>
                <button onClick={() => setViewingReg(null)} className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-all shrink-0">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Inscrito — quem fez a inscrição (dono da conta).
                    Fallback: usa snapshot inscrito_* da registration quando o
                    profile não pôde ser lido (RLS bloqueando ou conta deletada).
                    Garante que produtor sempre vê os dados de contato. */}
                {(() => {
                  const nome     = viewingReg.profiles?.full_name ?? viewingReg.inscrito_nome;
                  const email    = viewingReg.profiles?.email     ?? viewingReg.inscrito_email;
                  const whatsapp = viewingReg.profiles?.whatsapp  ?? viewingReg.inscrito_whatsapp;
                  if (!nome && !email && !whatsapp && !viewingReg.estudio) return null;
                  return (
                    <section>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><User size={12} /> Inscrito</h3>
                      <dl className="grid grid-cols-2 gap-3 text-[12px]">
                        <DetailItem label="Nome" value={nome} />
                        <DetailItem label="E-mail" value={email} />
                        <DetailItem label="WhatsApp" value={whatsapp} />
                        <DetailItem label="Estúdio / Escola" value={viewingReg.estudio} />
                      </dl>
                    </section>
                  );
                })()}

                {/* Coreografia */}
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><Music2 size={12} /> Coreografia</h3>
                  <dl className="grid grid-cols-2 gap-3 text-[12px]">
                    <DetailItem label="Modalidade" value={viewingReg.formato_participacao} />
                    <DetailItem label="Categoria" value={viewingReg.categoria} />
                    <DetailItem label="Estilo / Gênero" value={viewingReg.estilo_danca} />
                    <DetailItem label="Subgênero" value={viewingReg.subgenero} />
                    <DetailItem label="Coreógrafo(a)" value={viewingReg.coreografo_nome} />
                    <DetailItem label="Duração" value={viewingReg.duracao_minutos ? `${viewingReg.duracao_minutos} min` : null} />
                  </dl>
                </section>

                {/* Bailarinos */}
                {Array.isArray(viewingReg.bailarinos_detalhes) && viewingReg.bailarinos_detalhes.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><Users size={12} /> Bailarinos ({viewingReg.bailarinos_detalhes.length})</h3>
                    <div className="space-y-2">
                      {viewingReg.bailarinos_detalhes.map((b: any, i: number) => (
                        <div key={i} className="flex items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-bold text-slate-900 dark:text-white truncate">{b.nome ?? `Bailarino ${i + 1}`}</p>
                            <p className="text-[10px] text-slate-400">CPF {formatCpf(b.cpf)} · Nasc. {formatDateBR(b.data_nascimento)}</p>
                          </div>
                          {b.instagram_handle && (
                            <a href={`https://instagram.com/${b.instagram_handle.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[#ff0068] hover:underline text-[10px] font-bold flex items-center gap-1 shrink-0">
                              <Instagram size={11} /> {b.instagram_handle}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                    {viewingReg.instagram_principal && (
                      <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                        <Instagram size={11} /> Grupo/coreógrafo: <a href={`https://instagram.com/${viewingReg.instagram_principal.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[#ff0068] hover:underline font-bold">{viewingReg.instagram_principal}</a>
                      </p>
                    )}
                  </section>
                )}

                {/* Mídia — Vídeo (seletiva) só aparece se o evento usa essa feature.
                    Antes mostrava 'pending' pra qualquer evento, confundindo o produtor. */}
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><Video size={12} /> Trilha sonora{viewingReg.events?.video_selection_enabled ? ' & Vídeo' : ''}</h3>
                  <div className="space-y-2 text-[12px]">
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                      <span className="text-slate-500">Trilha sonora</span>
                      {viewingReg.trilha_url ? (
                        <a href={viewingReg.trilha_url.startsWith('http') ? viewingReg.trilha_url : '#'} target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 size={12} /> Enviada
                        </a>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                          <Clock size={12} /> Pendente
                        </span>
                      )}
                    </div>
                    {/* Vídeo seletiva: condicional pelo flag do evento */}
                    {viewingReg.events?.video_selection_enabled && (
                      <>
                        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                          <span className="text-slate-500">Vídeo (seletiva)</span>
                          <span className={`font-bold flex items-center gap-1 ${
                            viewingReg.video_status === 'approved' ? 'text-emerald-600 dark:text-emerald-400' :
                            viewingReg.video_status === 'rejected' ? 'text-rose-600 dark:text-rose-400' :
                            'text-amber-600 dark:text-amber-400'
                          }`}>
                            {viewingReg.video_status === 'approved' ? <><CheckCircle2 size={12} /> Aprovado</> :
                             viewingReg.video_status === 'rejected' ? <><X size={12} /> Reprovado</> :
                             viewingReg.video_status === 'submitted' ? <><Clock size={12} /> Em análise</> :
                             <><Clock size={12} /> {viewingReg.video_status ?? 'Pendente'}</>}
                          </span>
                        </div>
                        {viewingReg.video_feedback && (
                          <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Feedback do vídeo</p>
                            <p className="text-[11px] text-slate-700 dark:text-slate-300">{viewingReg.video_feedback}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>

                {/* Pagamento */}
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><DollarSign size={12} /> Pagamento</h3>
                  <dl className="grid grid-cols-2 gap-3 text-[12px]">
                    {/* Sessão 3 — valor por inscrição (P1 backlog painel produtor). */}
                    {(() => {
                      const v = Number(viewingReg.valor_pago ?? viewingReg.valor_total ?? viewingReg.charged_amount ?? viewingReg.mod_fee ?? 0);
                      return v > 0 ? (
                        <DetailItem label="Valor pago" value={`R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                      ) : null;
                    })()}
                    <DetailItem label="Status" value={viewingReg.status_pagamento} />
                    <DetailItem label="Método" value={viewingReg.payment_method ?? viewingReg.metodo_pagamento} />
                    <DetailItem label="ID Asaas" value={viewingReg.payment_id} mono />
                    {viewingReg.coupon_id && (
                      <DetailItem label="Cupom aplicado" value={`R$ ${Number(viewingReg.discount_amount ?? 0).toFixed(2)} de desconto`} />
                    )}
                    <DetailItem label="Status da inscrição" value={viewingReg.status} />
                  </dl>
                </section>

                {/* Tempos / Timeline — Sessão 3 P2 backlog painel produtor */}
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><Calendar size={12} /> Timeline</h3>
                  {(() => {
                    type TimelineIcon = 'created' | 'audio' | 'video' | 'paid' | 'refund';
                    const events: Array<{ label: string; at: string | null; icon: TimelineIcon }> = [
                      { label: 'Inscrição criada',  at: viewingReg.created_at ?? viewingReg.criado_em ?? null, icon: 'created' as TimelineIcon },
                      { label: 'Trilha enviada',    at: viewingReg.trilha_url ? (viewingReg.trilha_uploaded_at ?? viewingReg.updated_at ?? null) : null, icon: 'audio' as TimelineIcon },
                      { label: 'Vídeo enviado',    at: viewingReg.video_url ? (viewingReg.video_uploaded_at ?? null) : null, icon: 'video' as TimelineIcon },
                      { label: 'Pagamento confirmado', at: viewingReg.paid_at ?? null, icon: 'paid' as TimelineIcon },
                      { label: 'Reembolsada',       at: viewingReg.refunded_at ?? null, icon: 'refund' as TimelineIcon },
                    ].filter(e => e.at);

                    if (events.length === 0) {
                      return <p className="text-[11px] text-slate-500">Sem eventos registrados ainda.</p>;
                    }

                    return (
                      <ol className="space-y-2 relative pl-4 border-l-2 border-slate-200 dark:border-white/10">
                        {events.map((e, i) => (
                          <li key={i} className="relative">
                            <span className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                              e.icon === 'paid' ? 'bg-emerald-500' :
                              e.icon === 'refund' ? 'bg-rose-500' :
                              e.icon === 'audio' || e.icon === 'video' ? 'bg-amber-500' :
                              'bg-slate-400'
                            }`} />
                            <p className="text-[11px] font-black text-slate-700 dark:text-slate-200">{e.label}</p>
                            <p className="text-[10px] text-slate-500">
                              {new Date(e.at!).toLocaleString('pt-BR', {
                                day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
                              })}
                            </p>
                          </li>
                        ))}
                      </ol>
                    );
                  })()}
                </section>
              </div>

              {/* Footer com ações rápidas */}
              <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 px-6 py-4 flex flex-wrap justify-end gap-2">
                {/* Sessão 3 P3: WhatsApp pré-preenchido. Aparece em qualquer
                    status quando o inscrito tem whatsapp cadastrado.
                    Mensagem varia por contexto (cobrar pagamento / confirmar
                    logística / aviso de inscrição vencida). */}
                {viewingReg.profiles?.whatsapp && (() => {
                  const digits = String(viewingReg.profiles?.whatsapp ?? '').replace(/\D/g, '');
                  if (!digits) return null;
                  const phone = digits.startsWith('55') ? digits : `55${digits}`;
                  const nome = viewingReg.profiles?.full_name ?? '';
                  const coreo = viewingReg.nome_coreografia ?? '';
                  const eventoNome = activeEventInfo?.name ?? '';
                  const url = viewingReg.payment_url
                    ?? (viewingReg.payment_id ? `https://www.asaas.com/i/${String(viewingReg.payment_id).replace(/^pay_/, '')}` : '');

                  let body: string;
                  if (viewingReg.status_pagamento === 'PENDENTE') {
                    body = `Oi ${nome.split(' ')[0]}! Aqui é da produção${eventoNome ? ` do ${eventoNome}` : ''}. Sua inscrição "${coreo}" ainda está aguardando pagamento.` +
                      (url ? `\n\nPra confirmar é só pagar por aqui: ${url}` : '') +
                      `\n\nQualquer dúvida me chama por aqui. 🎉`;
                  } else if (viewingReg.status_pagamento === 'APROVADO' || viewingReg.status_pagamento === 'CONFIRMADO') {
                    body = `Oi ${nome.split(' ')[0]}! Aqui é da produção${eventoNome ? ` do ${eventoNome}` : ''}. Tô passando pra falar sobre a sua inscrição "${coreo}".`;
                  } else if (viewingReg.status_pagamento === 'VENCIDO' || viewingReg.status_pagamento === 'EXPIRADO') {
                    body = `Oi ${nome.split(' ')[0]}! Aqui é da produção${eventoNome ? ` do ${eventoNome}` : ''}. Sua inscrição "${coreo}" venceu sem pagamento. Se ainda quiser participar, me chama por aqui pra ver as opções.`;
                  } else {
                    body = `Oi ${nome.split(' ')[0]}! Aqui é da produção${eventoNome ? ` do ${eventoNome}` : ''} sobre sua inscrição "${coreo}".`;
                  }
                  const msg = encodeURIComponent(body);
                  return (
                    <a
                      href={`https://wa.me/${phone}?text=${msg}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-xl transition-all flex items-center gap-2"
                      title="Enviar mensagem pelo WhatsApp"
                    >
                      📱 WhatsApp
                    </a>
                  );
                })()}
                {/* Deep link Asaas — abre a fatura pública (mesma URL que o
                    pagador vê). Aceita payment_id com ou sem prefixo 'pay_'. */}
                {viewingReg.payment_id && (
                  <a
                    href={`https://www.asaas.com/i/${String(viewingReg.payment_id).replace(/^pay_/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl transition-all flex items-center gap-2"
                    title="Abrir fatura no Asaas (nova aba)"
                  >
                    <ExternalLink size={12} /> Abrir no Asaas
                  </a>
                )}
                {(viewingReg.status_pagamento === 'CONFIRMADO' || viewingReg.status_pagamento === 'APROVADO') && (
                  <button
                    onClick={() => { handleOpenRefund(viewingReg); setViewingReg(null); }}
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded-xl transition-all flex items-center gap-2"
                  >
                    <Undo2 size={12} /> Reembolsar
                  </button>
                )}
                <button
                  onClick={() => setViewingReg(null)}
                  className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl transition-all"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

/** Máscaras visuais — CPF 000.000.000-00 e data ISO → dd/mm/yyyy.
 *  Retorna '—' pra valor vazio. Tolera string já mascarada (só formata
 *  o que tem 11 dígitos limpos). Data aceita 'YYYY-MM-DD' ou ISO completo. */
const formatCpf = (raw?: string | null): string => {
  if (!raw) return '—';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 11) return raw;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};
const formatDateBR = (raw?: string | null): string => {
  if (!raw) return '—';
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

/** KPI card no topo da lista. Padrão Stripe Dashboard: número grande +
 *  label + ícone tonalizado. Tom controla cor do ícone/borda esquerda. */
const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; tone: 'slate' | 'emerald' | 'amber' | 'pink' }> = ({ icon, label, value, tone }) => {
  const tones = {
    slate:   { bg: 'bg-slate-500/10',   text: 'text-slate-600 dark:text-slate-400',     border: 'border-slate-200 dark:border-white/5' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-500/20' },
    amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400',     border: 'border-amber-200 dark:border-amber-500/20' },
    pink:    { bg: 'bg-[#ff0068]/10',   text: 'text-[#ff0068]',                          border: 'border-[#ff0068]/20' },
  }[tone];
  return (
    <div className={`bg-white dark:bg-slate-900/40 border ${tones.border} rounded-2xl p-4 flex items-center gap-3`}>
      <div className={`w-9 h-9 rounded-xl ${tones.bg} ${tones.text} flex items-center justify-center shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 truncate">{label}</p>
        <p className="text-lg font-black text-slate-900 dark:text-white truncate">{value}</p>
      </div>
    </div>
  );
};

/** Helper de item de detalhe (label + valor). Esconde quando valor é vazio
 *  pra modal não exibir "—" pra campos que o inscrito não preencheu. */
const DetailItem: React.FC<{ label: string; value?: string | null; mono?: boolean }> = ({ label, value, mono }) => {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{label}</dt>
      <dd className={`text-slate-900 dark:text-white break-all ${mono ? 'font-mono text-[11px]' : 'font-bold'}`}>{value}</dd>
    </div>
  );
};

export default Registrations;
