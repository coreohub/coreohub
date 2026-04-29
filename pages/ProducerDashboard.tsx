import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import AsaasBadge from '../components/AsaasBadge';

const MetricCard = ({ title, value, sub, icon: Icon, trend, warn }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={`bg-slate-100 dark:bg-white/5 p-5 rounded-3xl border relative overflow-hidden group hover:border-[#ff0068]/30 transition-all ${warn ? 'border-amber-400/40' : 'border-slate-200 dark:border-white/5'}`}
  >
    <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
      <Icon size={60} />
    </div>
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

  /* ── Edition selector ── */
  const [allEvents, setAllEvents] = useState<{ id: string; name: string; slug?: string; is_public?: boolean; edition_year?: number; start_date?: string; formacoes_config?: any[] }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [asaasConnected, setAsaasConnected] = useState(false);

  useEffect(() => {
    supabase
      .from('events')
      .select('id,name,slug,is_public,edition_year,start_date,formacoes_config')
      .order('start_date', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setAllEvents(data);
          setSelectedEventId(prev => prev ?? data[0].id);
        } else {
          setLoading(false);
        }
      });

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
          supabase.from('platform_commissions').select('gross_amount,net_amount,commission_amount,created_at').eq('event_id', selectedEventId).order('created_at', { ascending: true }),
        ]);
        setCommissions(comms ?? []);

        if (allRegs) {
          const confirmed = allRegs.filter(r => r.status_pagamento === 'CONFIRMADO');
          setMetrics({
            faturamentoTotal: confirmed.reduce((acc, curr) => acc + (Number(curr.valor_pago) || 0), 0),
            inscricoesConfirmadas: confirmed.length,
            pagamentosPendentes: allRegs.filter(r => r.status_pagamento === 'PENDENTE').length,
            trilhasPendentes: allRegs.filter(r => !r.trilha_url && r.status_pagamento === 'CONFIRMADO').length,
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
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [selectedEventId]);

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
      cur.gross += Number(c.gross_amount ?? 0);
      cur.net   += Number(c.net_amount ?? 0);
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
    <div className="space-y-8 pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <header className="flex justify-between items-start gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-1.5 bg-[#ff0068] rounded-full animate-pulse shadow-[0_0_8px_#ff0068]" />
            <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.3em]">QG do Produtor</span>
          </div>
          <h1 className="text-4xl font-black tracking-tighter uppercase text-slate-900 dark:text-white">
            Dashboard <span className="text-[#ff0068] italic">Administrativo</span>
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
                  url={`${window.location.origin}/festival/${selectedEvent.id}/register`}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Edition selector */}
          {allEvents.length > 0 && (
            <div className="relative">
              <select
                value={selectedEventId ?? ''}
                onChange={e => setSelectedEventId(e.target.value)}
                className="appearance-none pl-4 pr-9 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white outline-none focus:border-[#ff0068]/50 transition-all cursor-pointer"
              >
                {allEvents.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.edition_year ? `${ev.edition_year} — ` : ''}{ev.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          )}

          <button
            onClick={() => navigate('/account-settings')}
            className="flex items-center gap-2 bg-[#ff0068] text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-[#ff0068]/20 group"
          >
            <Plus size={16} className="group-hover:rotate-90 transition-transform" /> Novo Evento
          </button>
        </div>
      </header>

      {/* Guia do produtor — só aparece enquanto onboarding estiver pendente */}
      <GuiaDoProdutor profile={profile} />

      {/* Alertas acionáveis — Asaas, critérios, prazos */}
      <ProducerAlerts profile={profile} />

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
          <table className="w-full text-left">
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
                    <span className={`text-[9px] font-black uppercase ${reg.status_pagamento === 'CONFIRMADO' ? 'text-emerald-500' : 'text-amber-500'}`}>
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

      <div className="pt-4 border-t border-slate-200 dark:border-white/5">
        <AsaasBadge variant="inline" />
      </div>
    </div>
  );
};

export default ProducerDashboard;
