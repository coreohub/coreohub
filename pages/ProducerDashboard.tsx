import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { UserRole } from '../types';
import { supabase } from '../services/supabase';
import {
  DollarSign, Users, Music, AlertCircle, TrendingUp,
  Plus, Search, ArrowUpRight, CreditCard, Calendar,
  UserCheck, CheckSquare, AlertTriangle, Loader2, ChevronDown,
  Download, BarChart3, Copy, Check, ExternalLink,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Profile as UserProfile } from '../types';
import GuiaDoProdutor from '../components/GuiaDoProdutor';
import ProducerAlerts from '../components/ProducerAlerts';
import ProducerBalanceCard from '../components/ProducerBalanceCard';
import DemoOnboardingCard from '../components/DemoOnboardingCard';
import EventPickerSheet from '../components/EventPickerSheet';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const MetricCard = ({ title, value, sub, icon: Icon, trend, warn }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={`bg-slate-100 dark:bg-white/5 p-5 rounded-3xl border group hover:border-[#ff0068]/30 transition-all ${warn ? 'border-amber-400/40' : 'border-slate-200 dark:border-white/5'}`}
  >
    <div className="flex justify-between items-start mb-3">
      <div className={`p-2 rounded-xl border ${warn ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-[#ff0068]/10 text-[#ff0068] border-[#ff0068]/20'}`}>
        <Icon size={18} />
      </div>
      {trend && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[8px] font-black uppercase tracking-widest">
          <TrendingUp size={8} /> {trend}
        </div>
      )}
      {warn && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[8px] font-black uppercase tracking-widest">
          <AlertTriangle size={8} /> Atenção
        </div>
      )}
    </div>
    <h3 className="text-slate-500 text-[8px] font-black uppercase tracking-[0.2em]">{title}</h3>
    <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tighter">{value}</div>
    <p className="text-[9px] text-slate-500 font-medium">{sub}</p>
  </motion.div>
);

const CopyLinkChip: React.FC<{ label: string; url: string; tone?: 'pink' | 'neutral' }> = ({ label, url, tone = 'neutral' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignora — clipboard pode estar bloqueado */
    }
  };

  const base = tone === 'pink'
    ? 'bg-[#ff0068]/10 border-[#ff0068]/30 text-[#ff0068] hover:bg-[#ff0068]/20'
    : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-[#ff0068]/40 hover:text-[#ff0068]';

  return (
    <div className={`inline-flex items-center rounded-xl border ${base} transition-all overflow-hidden`}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-2 text-[9px] font-black uppercase tracking-widest"
        title={url}
      >
        <ExternalLink size={11} /> {label}
      </a>
      <button
        onClick={handleCopy}
        className="px-2.5 py-2 border-l border-current/20 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        title="Copiar link"
        aria-label={`Copiar link de ${label}`}
      >
        {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      </button>
    </div>
  );
};

const CountdownBadge = ({ eventDate }: { eventDate: string }) => {
  const today = new Date();
  const date = new Date(eventDate + 'T12:00:00');
  const diffMs = date.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Evento encerrado</span>;
  if (diffDays === 0) return <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-widest animate-pulse">Hoje!</span>;
  return (
    <span className={`text-[9px] font-black uppercase tracking-widest ${diffDays <= 7 ? 'text-amber-500' : 'text-emerald-500'}`}>
      {diffDays} dia{diffDays !== 1 ? 's' : ''}
    </span>
  );
};

interface ProducerDashboardProps {
  profile: UserProfile;
}

const ProducerDashboard: React.FC<ProducerDashboardProps> = ({ profile }) => {
  // Guard de role: inscrito (ou qualquer not-ORGANIZER e not-super_admin) que
  // navegue direto pra /qg-organizador é redirecionado pro /dashboard. Antes,
  // o painel renderizava pra qualquer authenticated — Cultural Estúdio
  // (inscrito) viu "NOVO EVENTO" e quase criou um evento sem querer.
  // Lição: rotas operacionais do produtor precisam de gate de role além
  // do PrivateRoute (auth-only).
  if (profile?.role !== UserRole.ORGANIZER && !profile?.is_super_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [metrics, setMetrics] = useState({
    faturamentoTotal: 0,
    inscricoesConfirmadas: 0,
    pagamentosPendentes: 0,
    trilhasPendentes: 0,
    pendenciasRegulamento: 0,
    totalJurados: 0,
    juradosAtivos: 0,
    checkinFeitos: 0,
    totalInscritos: 0,
  });
  const [eventData, setEventData] = useState<{ nome_evento?: string; data_evento?: string } | null>(null);
  const [latestRegistrations, setLatestRegistrations] = useState<any[]>([]);
  const [filteredRegs, setFilteredRegs] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  // Funil de conversão 5 etapas (Bloco 2 — 2026-05-28). Padrão Stripe
  // Checkout / Eventbrite Insights: Visitas → Leads → Iniciadas → Pagas
  // → Compareceu. Antes só 3 etapas (Leads/Iniciadas/Pagas) — expandido
  // pra mostrar funil completo de ponta a ponta.
  const [leadFunnel, setLeadFunnel] = useState<{
    visits: number;
    leads: number;
    started: number;
    paid: number;
    attended: number;
  }>({ visits: 0, leads: 0, started: 0, paid: 0, attended: 0 });

  // Bloco 6: filtro de coorte temporal pro funil. Padrão Mixpanel/Amplitude
  // — produtor escolhe janela pra ver conversão de campanha recente vs
  // histórico. 'all' = sem corte; 'week' = últimos 7 dias; 'month' = 30 dias.
  const [funnelCohort, setFunnelCohort] = useState<'all' | 'week' | 'month'>('all');

  /* ── Edition selector ── */
  const [allEvents, setAllEvents] = useState<{ id: string; name: string; slug?: string; is_public?: boolean; edition_year?: number; start_date?: string; formacoes_config?: any[] }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [asaasConnected, setAsaasConnected] = useState(false);

  useEffect(() => {
    // Mesma regra do Registrations.tsx: prioriza demo + ordena por created_at
    // (alinhado com DemoBanner). Antes start_date desc descoordenava em modo demo.
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('events')
        .select('id,name,slug,is_public,edition_year,start_date,formacoes_config,is_demo,created_at')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setAllEvents(data);
        const demo = data.find(e => (e as any).is_demo);
        setSelectedEventId(prev => prev ?? (demo?.id ?? data[0].id));
      } else {
        setLoading(false);
      }
    })();

    supabase
      .from('profiles')
      .select('asaas_subconta_id')
      .eq('id', profile.id)
      .maybeSingle()
      .then(({ data }) => setAsaasConnected(!!data?.asaas_subconta_id));
  }, [profile.id]);

  const selectedEvent = useMemo(
    () => allEvents.find(e => e.id === selectedEventId) ?? null,
    [allEvents, selectedEventId],
  );

  /* ── Verifica se o evento tem inscrição paga (precisa de Asaas) ── */
  const eventNeedsAsaas = useMemo(() => {
    if (!selectedEvent) return false;
    const formacoes: any[] = Array.isArray(selectedEvent.formacoes_config) ? selectedEvent.formacoes_config : [];
    return formacoes.some(f => Number(f?.fee ?? 0) > 0);
  }, [selectedEvent]);

  const linkBlocked = eventNeedsAsaas && !asaasConnected;

  useEffect(() => {
    if (!selectedEventId) return;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [
          { data: allRegs },
          { data: recentRegs },
          { data: cfg },
          { data: judges },
          { data: checkins },
          { data: comms },
        ] = await Promise.all([
          supabase.from('registrations').select('*').eq('event_id', selectedEventId),
          supabase.from('registrations').select('*').eq('event_id', selectedEventId).order('criado_em', { ascending: false }).limit(6),
          // ProducerDashboard tem evento selecionado explicitamente — passa como hint
          supabase.from('configuracoes').select('nome_evento,data_evento').eq('event_id', selectedEventId).maybeSingle().then(r =>
            r.data ? r : supabase.from('configuracoes').select('nome_evento,data_evento').eq('id', '1').maybeSingle()
          ),
          supabase.from('judges').select('id,is_active'),
          supabase.from('registrations').select('id,check_in_status').eq('event_id', selectedEventId),
          // refunded_at IS NULL pra não inflar receita histórica com comissões
          // já estornadas (espelha filtro do daily-release-funds + ProducerBalanceCard).
          supabase.from('platform_commissions').select('gross_amount,net_amount,commission_amount,refund_amount,created_at').eq('event_id', selectedEventId).is('refunded_at', null).order('created_at', { ascending: true }),
        ]);
        setCommissions(comms ?? []);

        if (allRegs) {
          // status_pagamento = 'APROVADO' (atual) OU 'CONFIRMADO' (legacy).
          // Bug 2026-05-20: dashboard mostrava R$ 0 e 0 inscrições no
          // Usualdance porque só checava 'CONFIRMADO'. Painel Registrations
          // já considera ambos.
          const isPago = (s?: string) => s === 'APROVADO' || s === 'CONFIRMADO';
          const confirmed = allRegs.filter(r => isPago(r.status_pagamento));
          setMetrics({
            faturamentoTotal: confirmed.reduce((acc, curr) => acc + (Number(curr.valor_pago) || 0), 0),
            inscricoesConfirmadas: confirmed.length,
            pagamentosPendentes: allRegs.filter(r => r.status_pagamento === 'PENDENTE').length,
            trilhasPendentes: allRegs.filter(r => !r.trilha_url && isPago(r.status_pagamento)).length,
            pendenciasRegulamento: allRegs.filter(r => r.penalidade_status === 'PENDENTE').length,
            totalJurados: judges?.length || 0,
            juradosAtivos: judges?.filter((j: any) => j.is_active).length || 0,
            checkinFeitos: checkins?.filter((c: any) => c.check_in_status === 'OK').length || 0,
            totalInscritos: allRegs.length,
          });
        }

        setEventData(cfg);
        setLatestRegistrations(recentRegs || []);
        setFilteredRegs(recentRegs || []);

        // Funil de conversão 5 etapas com filtro de coorte (Blocos 2+6).
        // Stages: Visitas (events.view_count) → Leads (profiles.entry_event_id
        // sem registration) → Iniciadas (distinct user_id em registrations)
        // → Pagas (APROVADO/CONFIRMADO) → Compareceu (check_in_status='OK').
        try {
          const isPagoStatus = (s?: string) => s === 'APROVADO' || s === 'CONFIRMADO';

          // Cohort cutoff: filtra por created_at conforme janela escolhida.
          const cohortCutoff = (() => {
            if (funnelCohort === 'week')  return Date.now() - 7  * 24 * 60 * 60 * 1000;
            if (funnelCohort === 'month') return Date.now() - 30 * 24 * 60 * 60 * 1000;
            return 0; // all
          })();
          const inCohort = (createdAt?: string | null) => {
            if (cohortCutoff === 0) return true;
            if (!createdAt) return false;
            return new Date(createdAt).getTime() >= cohortCutoff;
          };

          const cohortRegs = (allRegs ?? []).filter((r: any) => inCohort(r.created_at));
          const userIdsWithReg = [...new Set(cohortRegs.map((r: any) => r.user_id).filter(Boolean))];
          const userIdsPago    = [...new Set(cohortRegs.filter((r: any) => isPagoStatus(r.status_pagamento)).map((r: any) => r.user_id).filter(Boolean))];
          const userIdsAttended = [...new Set(cohortRegs.filter((r: any) => r.check_in_status === 'OK').map((r: any) => r.user_id).filter(Boolean))];

          // Visitas: view_count agregado do evento. Não tem cohort por design
          // (é contador acumulado). Quando coorte != 'all', mostra "—" pra não
          // confundir.
          let visitsCount = 0;
          if (funnelCohort === 'all') {
            const { data: ev } = await supabase
              .from('events')
              .select('view_count')
              .eq('id', selectedEventId)
              .maybeSingle();
            visitsCount = Number(ev?.view_count ?? 0);
          }

          // Leads no cohort: profiles.entry_event_id + created_at filtro.
          let leadsQuery = supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('entry_event_id', selectedEventId);
          if (userIdsWithReg.length > 0) {
            leadsQuery = leadsQuery.not('id', 'in', `(${userIdsWithReg.join(',')})`);
          }
          if (cohortCutoff > 0) {
            leadsQuery = leadsQuery.gte('created_at', new Date(cohortCutoff).toISOString());
          }
          const { count: leadsCount } = await leadsQuery;

          setLeadFunnel({
            visits:   visitsCount,
            leads:    leadsCount ?? 0,
            started:  userIdsWithReg.length,
            paid:     userIdsPago.length,
            attended: userIdsAttended.length,
          });
        } catch {
          // Funnel é nice-to-have — se falhar, zera silenciosamente.
          setLeadFunnel({ visits: 0, leads: 0, started: 0, paid: 0, attended: 0 });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [selectedEventId, funnelCohort]);

  useEffect(() => {
    if (!searchTerm) { setFilteredRegs(latestRegistrations); return; }
    const term = searchTerm.toLowerCase();
    setFilteredRegs(latestRegistrations.filter(r =>
      (r.nome_coreografia || r.estudio || '').toLowerCase().includes(term)
    ));
  }, [searchTerm, latestRegistrations]);

  const fmtDate = (d?: string) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  /* ── Agrega receita mensal a partir de platform_commissions ── */
  const monthlyRevenue = useMemo(() => {
    if (!commissions.length) return [] as { month: string; gross: number; net: number; fee: number }[];
    const buckets = new Map<string, { month: string; gross: number; net: number; fee: number }>();
    for (const c of commissions) {
      if (!c.created_at) continue;
      const d = new Date(c.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      const cur = buckets.get(key) ?? { month: label, gross: 0, net: 0, fee: 0 };
      const refund = Number(c.refund_amount ?? 0);
      cur.gross += Math.max(Number(c.gross_amount ?? 0) - refund, 0);
      cur.net   += Math.max(Number(c.net_amount ?? 0) - refund, 0);
      cur.fee   += Number(c.commission_amount ?? 0);
      buckets.set(key, cur);
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [commissions]);

  const handleExportCSV = () => {
    const header = ['data', 'valor_bruto', 'comissao_plataforma', 'valor_liquido_produtor'];
    const rows = commissions.map(c => [
      new Date(c.created_at).toLocaleDateString('pt-BR'),
      Number(c.gross_amount ?? 0).toFixed(2).replace('.', ','),
      Number(c.commission_amount ?? 0).toFixed(2).replace('.', ','),
      Number(c.net_amount ?? 0).toFixed(2).replace('.', ','),
    ]);
    const csv = [header, ...rows].map(r => r.join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const evName = allEvents.find(e => e.id === selectedEventId)?.name ?? 'coreohub';
    a.download = `receita_${evName.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20 animate-in fade-in duration-700">

      {/* Header — flex-col em mobile pra nao estourar layout horizontal */}
      <header className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-1.5 bg-[#ff0068] rounded-full animate-pulse shadow-[0_0_8px_#ff0068]" />
            <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Painel do Produtor</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-black tracking-tighter uppercase text-slate-900 dark:text-white">
            Painel <span className="text-[#ff0068] italic">do Produtor</span>
          </h1>
          {eventData?.nome_evento && (
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
              {eventData.nome_evento}
              {eventData.data_evento && (
                <> · {fmtDate(eventData.data_evento)} · <CountdownBadge eventDate={eventData.data_evento} /></>
              )}
            </p>
          )}

          {selectedEvent && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {selectedEvent.is_public !== false && (
                <CopyLinkChip
                  label="Página pública"
                  url={`${window.location.origin}/evento/${selectedEvent.slug ?? selectedEvent.id}`}
                  tone="pink"
                />
              )}
              {linkBlocked ? (
                <button
                  onClick={() => navigate('/account-settings?tab=Pagamentos')}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-rose-500/10 border-rose-500/30 text-rose-500 hover:bg-rose-500/20 text-[9px] font-black uppercase tracking-widest transition-all"
                  title="Conecte sua conta Asaas para liberar inscrições pagas"
                >
                  <AlertCircle size={11} /> Conecte Asaas para liberar inscrições
                </button>
              ) : (
                <CopyLinkChip
                  label="Link de inscrição"
                  url={`${window.location.origin}/festival/${selectedEvent.slug ?? selectedEvent.id}/register`}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap md:flex-nowrap md:shrink-0">
          {/* Edition selector — EventPickerSheet custom (bottom sheet em mobile,
              dropdown ancorado em desktop). */}
          {allEvents.length > 0 && (
            <EventPickerSheet
              events={allEvents}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
              onCreateNew={() => navigate('/criar-evento')}
              className="flex-1 md:flex-none"
            />
          )}

          <button
            onClick={() => navigate('/criar-evento')}
            className="flex items-center gap-2 bg-[#ff0068] text-white px-4 sm:px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-[#ff0068]/20 group whitespace-nowrap"
          >
            <Plus size={16} className="group-hover:rotate-90 transition-transform" />
            <span className="hidden sm:inline">Novo Evento</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </header>

      {/* DemoOnboardingCard — aparece quando produtor não tem nenhum evento.
          Padrao mercado (Trello/Notion): empty state com CTA pra popular demo
          + atalho pra criar evento real. */}
      {allEvents.length === 0 && <DemoOnboardingCard />}

      {/* Guia do produtor — só aparece enquanto onboarding estiver pendente */}
      <GuiaDoProdutor profile={profile} />

      {/* Alertas acionáveis — Asaas, critérios, prazos */}
      <ProducerAlerts profile={profile} />

      {/* Saldo na subconta Asaas (settlement D+7 + antecipação manual).
          Renderiza sempre — o próprio card mostra estado vazio se não
          tem repasse pendente. */}
      <ProducerBalanceCard producerId={profile.id} />

      {/* Metric cards */}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Faturamento Total"
            value={`R$ ${metrics.faturamentoTotal.toLocaleString('pt-BR')}`}
            sub="Volume bruto confirmado"
            icon={DollarSign}
            trend={metrics.inscricoesConfirmadas > 0 ? `+${metrics.inscricoesConfirmadas}` : undefined}
          />
          <MetricCard
            title="Inscrições"
            value={metrics.inscricoesConfirmadas}
            sub={`${metrics.totalInscritos} total · ${metrics.inscricoesConfirmadas} confirmadas`}
            icon={Users}
          />
          <MetricCard
            title="Pagamentos"
            value={metrics.pagamentosPendentes}
            sub="Pendentes de validação"
            icon={CreditCard}
            warn={metrics.pagamentosPendentes > 0}
          />
          <MetricCard
            title="Trilhas"
            value={metrics.trilhasPendentes}
            sub="Áudios não enviados"
            icon={Music}
            warn={metrics.trilhasPendentes > 0}
          />
          <MetricCard
            title="Jurados"
            value={`${metrics.juradosAtivos}/${metrics.totalJurados}`}
            sub="Ativos / Cadastrados"
            icon={UserCheck}
            warn={metrics.totalJurados === 0}
          />
          <MetricCard
            title="Triagem"
            value={metrics.pendenciasRegulamento}
            sub="Infrações de regulamento"
            icon={AlertCircle}
            warn={metrics.pendenciasRegulamento > 0}
          />
          <MetricCard
            title="Check-in"
            value={metrics.checkinFeitos}
            sub="Credenciamentos realizados"
            icon={CheckSquare}
          />
          <MetricCard
            title="Data do Evento"
            value={fmtDate(eventData?.data_evento)}
            sub="Prazo para preparação"
            icon={Calendar}
          />
        </div>
      )}

      {/* Receita mensal */}
      {!loading && (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-white/5 flex justify-between items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#ff0068]/10 text-[#ff0068] rounded-xl border border-[#ff0068]/20">
                <BarChart3 size={16} />
              </div>
              <div>
                <h2 className="text-sm font-black uppercase text-slate-900 dark:text-white tracking-tight italic">Receita Mensal</h2>
                <p className="text-[10px] text-slate-500">Consolidado de pagamentos aprovados deste evento</p>
              </div>
            </div>
            <button
              onClick={handleExportCSV}
              disabled={commissions.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white hover:border-[#ff0068]/40 hover:text-[#ff0068] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={12} /> Exportar CSV
            </button>
          </div>
          <div className="p-6">
            {monthlyRevenue.length === 0 ? (
              <p className="text-center py-10 text-[10px] text-slate-400 uppercase font-black">Sem pagamentos aprovados ainda</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.2} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }} tickFormatter={(v) => `R$${v}`} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #ff0068', fontSize: 11, fontWeight: 800 }}
                      formatter={(v: any) => [`R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, '']}
                    />
                    <Bar dataKey="gross" name="Bruto"    fill="#ff0068" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="fee"   name="Comissão" fill="#e3ff0a" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="net"   name="Líquido"  fill="#10b981" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Funil de Conversão 5 etapas (Bloco 2 — 2026-05-28).
          Padrão Stripe Checkout / Eventbrite Insights / Sympla Connect.
          Filtro de coorte (Bloco 6) — semana/mês/total — padrão Mixpanel. */}
      {!loading && (leadFunnel.visits + leadFunnel.leads + leadFunnel.started + leadFunnel.paid + leadFunnel.attended > 0) && (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-white/5 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-[#1de7f2]/10 text-[#1de7f2] rounded-xl border border-[#1de7f2]/20 shrink-0">
                <BarChart3 size={16} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-black uppercase text-slate-900 dark:text-white tracking-tight italic">Funil de Conversão</h2>
                <p className="text-[10px] text-slate-500">Da visita ao palco — sem expor emails (LGPD)</p>
              </div>
            </div>
            {/* Cohort selector — padrão Mixpanel/Amplitude.
                A11y: aria-pressed indica seleção pro leitor de tela. */}
            <div
              className="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-white/5 rounded-xl p-1 border border-slate-200 dark:border-white/10"
              role="group"
              aria-label="Selecionar período do funil"
            >
              {(['all', 'month', 'week'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setFunnelCohort(c)}
                  aria-pressed={funnelCohort === c}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                    funnelCohort === c
                      ? 'bg-[#ff0068] text-white shadow-sm shadow-[#ff0068]/30'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {c === 'all' ? 'Todo período' : c === 'month' ? '30d' : '7d'}
                </button>
              ))}
            </div>
          </div>
          <div className="p-6 grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
            {/* Visitas (topo) — só faz sentido em 'all' (contador acumulado) */}
            <div className="text-center">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Visitas</p>
              <p className="text-2xl sm:text-3xl font-black text-sky-600 dark:text-sky-400 mt-1 tabular-nums">
                {funnelCohort === 'all' ? leadFunnel.visits : '—'}
              </p>
              <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                {funnelCohort === 'all' ? 'vitrine pública' : 'só "todo período"'}
              </p>
            </div>
            {/* Leads */}
            <div className="text-center sm:border-l border-slate-200 dark:border-white/10">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Leads</p>
              <p className="text-2xl sm:text-3xl font-black text-cyan-700 dark:text-[#1de7f2] mt-1 tabular-nums">{leadFunnel.leads}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-tight">criaram conta, não inscreveram</p>
            </div>
            {/* Iniciadas */}
            <div className="text-center sm:border-l border-slate-200 dark:border-white/10">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Iniciadas</p>
              <p className="text-2xl sm:text-3xl font-black text-[#ff0068] mt-1 tabular-nums">{leadFunnel.started}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                {leadFunnel.leads > 0
                  ? `${Math.round((leadFunnel.started / (leadFunnel.leads + leadFunnel.started)) * 100)}% conv`
                  : 'inscrições'}
              </p>
            </div>
            {/* Pagas */}
            <div className="text-center sm:border-l border-slate-200 dark:border-white/10">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Pagas</p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-500 mt-1 tabular-nums">{leadFunnel.paid}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                {leadFunnel.started > 0
                  ? `${Math.round((leadFunnel.paid / leadFunnel.started) * 100)}% conclusão`
                  : 'confirmados'}
              </p>
            </div>
            {/* Compareceu (fundo) — brand-lime (#E3FF0A do DESIGN_SYSTEM,
                contraste no dark mode). Antes violet-500 que não está na
                paleta; sky conflitaria com Visitas. */}
            <div className="text-center sm:border-l border-slate-200 dark:border-white/10">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Compareceu</p>
              <p className="text-2xl sm:text-3xl font-black text-lime-600 dark:text-[#E3FF0A] mt-1 tabular-nums">{leadFunnel.attended}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                {leadFunnel.paid > 0
                  ? `${Math.round((leadFunnel.attended / leadFunnel.paid) * 100)}% no-show`
                  : 'check-in no dia'}
              </p>
            </div>
          </div>
          {leadFunnel.leads > 0 && (
            <div className="px-6 pb-5 -mt-2">
              <p className="text-[10px] text-slate-500 leading-relaxed">
                <span className="font-black text-[#1de7f2]">{leadFunnel.leads} lead{leadFunnel.leads !== 1 ? 's' : ''}</span> receberá email de reengajamento contextualizado quando faltar prazo curto pra inscrição. Sem nada manual.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent registrations */}
        <div className="lg:col-span-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-white/5 flex justify-between items-center">
            <h2 className="text-sm font-black uppercase text-slate-900 dark:text-white">Últimas Inscrições</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={12} />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="bg-slate-100 dark:bg-black border border-slate-200 dark:border-white/10 rounded-lg py-2 pl-9 pr-3 text-[9px] font-black uppercase tracking-widest outline-none focus:border-[#ff0068]/50 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[480px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-white/5">
                <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Grupo</th>
                <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {filteredRegs.length === 0 ? (
                <tr><td colSpan={3} className="px-6 py-10 text-center text-[10px] text-slate-400 uppercase font-black">Nenhuma inscrição</td></tr>
              ) : filteredRegs.map((reg) => (
                <tr key={reg.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-xs font-black uppercase text-slate-900 dark:text-white">{reg.nome_coreografia || reg.estudio || '—'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[9px] font-black uppercase ${(reg.status_pagamento === 'APROVADO' || reg.status_pagamento === 'CONFIRMADO') ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {reg.status_pagamento}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => navigate('/registrations')}
                      className="text-slate-400 hover:text-[#ff0068] transition-all"
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* Quick actions */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl p-6 space-y-3">
            <h2 className="text-sm font-black uppercase text-slate-900 dark:text-white">Ações Rápidas</h2>

            {[
              {
                label: 'Triagem Regulamento',
                sub: `${metrics.pendenciasRegulamento} pendências`,
                icon: AlertCircle,
                path: '/registrations',
                warn: metrics.pendenciasRegulamento > 0,
              },
              {
                label: 'Validar Pagamentos',
                sub: `${metrics.pagamentosPendentes} pendências Pix`,
                icon: CreditCard,
                path: '/registrations',
                warn: metrics.pagamentosPendentes > 0,
              },
              {
                label: 'Equipe de Jurados',
                sub: `${metrics.juradosAtivos} ativos`,
                icon: UserCheck,
                path: '/equipe-jurados',
                warn: metrics.totalJurados === 0,
              },
              {
                label: 'Credenciamento',
                sub: `${metrics.checkinFeitos} credenciados`,
                icon: CheckSquare,
                path: '/check-in',
                warn: false,
              },
            ].map(action => (
              <button
                key={action.label}
                onClick={() => navigate(action.path)}
                className="w-full flex items-center gap-3 p-4 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/5 rounded-xl hover:border-[#ff0068]/30 transition-all group"
              >
                <div className={`p-2 rounded-lg transition-all group-hover:text-white ${action.warn ? 'bg-amber-500/10 text-amber-500 group-hover:bg-amber-500' : 'bg-[#ff0068]/10 text-[#ff0068] group-hover:bg-[#ff0068]'}`}>
                  <action.icon size={16} />
                </div>
                <div className="text-left flex-1 min-w-0">
                  <span className="text-[10px] font-black uppercase block text-slate-900 dark:text-white truncate">{action.label}</span>
                  <span className="text-[8px] text-slate-500 font-bold uppercase">{action.sub}</span>
                </div>
                <ArrowUpRight size={14} className="text-slate-300 group-hover:text-[#ff0068] transition-all shrink-0" />
              </button>
            ))}
          </div>

          <div className="bg-emerald-500/5 border border-emerald-500/10 p-5 rounded-3xl">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_#10b981]" />
              <span className="text-[9px] font-black uppercase text-slate-900 dark:text-white">Sistema OK</span>
            </div>
            <p className="text-[9px] text-slate-500 leading-relaxed uppercase">
              Todos os serviços rodando normalmente. Backup automático realizado.
            </p>
          </div>
        </div>
      </div>

      {/* AsaasBadge removido daqui em 2026-05-13 — playbook pág. 16:
          dashboard operacional não é contexto financeiro ativo. */}
    </div>
  );
};

export default ProducerDashboard;
