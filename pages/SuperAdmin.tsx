import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  listInvites, createInvite, deleteInvite, buildInviteUrl,
  type ProducerInvite,
} from '../services/inviteService';
import {
  Crown, DollarSign, Users, Calendar, TrendingUp, Loader2,
  AlertCircle, Mail, Copy, Trash2, Plus, X, Check, Lock, Unlock,
  ExternalLink, BarChart3, Download,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface ProducerRow {
  id: string;
  full_name: string | null;
  email: string | null;
  is_blocked: boolean;
  asaas_subconta_id: string | null;
  events_count: number;
  total_gross: number;
  total_commission: number;
}

interface CommissionRow {
  id: string;
  event_id: string;
  producer_id: string;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  created_at: string;
}

interface EventRow {
  id: string;
  name: string;
  slug: string | null;
  created_by: string | null;
  start_date: string | null;
  event_type: 'private' | 'government' | null;
  commission_type: 'PERCENT' | 'FIXED' | null;
  commission_percent: number | null;
  commission_fixed: number | null;
  fee_mode: 'repassar' | 'absorver' | null;
  is_public: boolean | null;
}

const SuperAdmin = () => {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const [commissions, setCommissions]   = useState<CommissionRow[]>([]);
  const [producers, setProducers]       = useState<ProducerRow[]>([]);
  const [eventsByName, setEventsByName] = useState<Map<string, string>>(new Map());
  const [eventsList, setEventsList]     = useState<EventRow[]>([]);
  const [invites, setInvites]           = useState<ProducerInvite[]>([]);
  const [eventSearch, setEventSearch]   = useState('');
  const [eventFilter, setEventFilter]   = useState<'all' | 'private' | 'government' | 'free'>('all');
  const [eventEdit, setEventEdit]       = useState<EventRow | null>(null);

  /* Modal de convite */
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm]           = useState({ email: '', full_name: '' });
  const [inviteSaving, setInviteSaving]       = useState(false);
  const [inviteError, setInviteError]         = useState<string | null>(null);
  const [copiedToken, setCopiedToken]         = useState<string | null>(null);

  /* Verificação de acesso */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_super_admin, role')
        .eq('id', user.id)
        .single();
      setAuthorized(Boolean(profile?.is_super_admin) || profile?.role === 'USUALDANCE_ADMIN');
    })();
  }, [navigate]);

  /* Carrega dados */
  useEffect(() => {
    if (!authorized) return;
    (async () => {
      setLoading(true);
      try {
        const [
          { data: comms },
          { data: profs },
          { data: evs },
          inviteList,
        ] = await Promise.all([
          supabase.from('platform_commissions')
            .select('*')
            .order('created_at', { ascending: false }),
          supabase.from('profiles')
            .select('id, full_name, email, is_blocked, asaas_subconta_id'),
          supabase.from('events')
            .select('id, name, slug, created_by, start_date, event_type, commission_type, commission_percent, commission_fixed, fee_mode, is_public')
            .order('start_date', { ascending: false }),
          listInvites(),
        ]);

        setCommissions(comms ?? []);
        setInvites(inviteList);

        const eventMap = new Map<string, string>();
        const eventsByProducer = new Map<string, number>();
        for (const ev of evs ?? []) {
          eventMap.set(ev.id, ev.name);
          if (ev.created_by) {
            eventsByProducer.set(ev.created_by, (eventsByProducer.get(ev.created_by) ?? 0) + 1);
          }
        }
        setEventsByName(eventMap);
        setEventsList((evs ?? []) as EventRow[]);

        const grossByProducer      = new Map<string, number>();
        const commissionByProducer = new Map<string, number>();
        for (const c of comms ?? []) {
          if (!c.producer_id || c.refunded_at) continue;
          grossByProducer.set(c.producer_id,      (grossByProducer.get(c.producer_id)      ?? 0) + Number(c.gross_amount      ?? 0));
          commissionByProducer.set(c.producer_id, (commissionByProducer.get(c.producer_id) ?? 0) + Number(c.commission_amount ?? 0));
        }

        // Só exibe produtores que têm evento OU subconta Asaas configurada
        const enriched = (profs ?? [])
          .filter(p => eventsByProducer.has(p.id) || p.asaas_subconta_id)
          .map<ProducerRow>(p => ({
            id:                p.id,
            full_name:         p.full_name,
            email:             p.email,
            is_blocked:        Boolean(p.is_blocked),
            asaas_subconta_id: p.asaas_subconta_id,
            events_count:      eventsByProducer.get(p.id) ?? 0,
            total_gross:       grossByProducer.get(p.id) ?? 0,
            total_commission:  commissionByProducer.get(p.id) ?? 0,
          }))
          .sort((a, b) => b.total_commission - a.total_commission);
        setProducers(enriched);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [authorized]);

  /* Métricas globais */
  const stats = useMemo(() => {
    const active = commissions.filter(c => !(c as any).refunded_at);
    const grossTotal      = active.reduce((s, c) => s + Number(c.gross_amount      ?? 0), 0);
    const commissionTotal = active.reduce((s, c) => s + Number(c.commission_amount ?? 0), 0);
    return {
      grossTotal,
      commissionTotal,
      transactionsCount: active.length,
      producersCount:    producers.length,
    };
  }, [commissions, producers]);

  /* Gráfico mensal */
  const monthly = useMemo(() => {
    const buckets = new Map<string, { month: string; bruto: number; comissao: number }>();
    for (const c of commissions) {
      if ((c as any).refunded_at) continue;
      const d = new Date(c.created_at);
      const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      const cur = buckets.get(key) ?? { month: label, bruto: 0, comissao: 0 };
      cur.bruto    += Number(c.gross_amount      ?? 0);
      cur.comissao += Number(c.commission_amount ?? 0);
      buckets.set(key, cur);
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [commissions]);

  /* Top eventos */
  const topEvents = useMemo(() => {
    const byEvent = new Map<string, number>();
    for (const c of commissions) {
      if ((c as any).refunded_at || !c.event_id) continue;
      byEvent.set(c.event_id, (byEvent.get(c.event_id) ?? 0) + Number(c.commission_amount ?? 0));
    }
    return Array.from(byEvent.entries())
      .map(([eventId, commission]) => ({ eventId, name: eventsByName.get(eventId) ?? '—', commission }))
      .sort((a, b) => b.commission - a.commission)
      .slice(0, 5);
  }, [commissions, eventsByName]);

  /* Ações */
  const handleToggleBlock = async (p: ProducerRow) => {
    const action = p.is_blocked ? 'desbloquear' : 'bloquear';
    if (!confirm(`Confirmar ${action} do produtor "${p.full_name ?? p.email}"?`)) return;
    await supabase.from('profiles').update({ is_blocked: !p.is_blocked }).eq('id', p.id);
    setProducers(list => list.map(x => x.id === p.id ? { ...x, is_blocked: !x.is_blocked } : x));
  };

  const handleCreateInvite = async () => {
    setInviteError(null);
    if (!inviteForm.email.trim()) { setInviteError('Informe o e-mail.'); return; }
    setInviteSaving(true);
    try {
      const inv = await createInvite(inviteForm);
      setInvites(list => [inv, ...list]);
      setShowInviteModal(false);
      setInviteForm({ email: '', full_name: '' });
      // Copia já o link para a área de transferência
      const url = buildInviteUrl(inv.token);
      await navigator.clipboard.writeText(url).catch(() => {});
      setCopiedToken(inv.token);
      setTimeout(() => setCopiedToken(null), 3000);
    } catch (e: any) {
      setInviteError(e.message?.includes('duplicate') ? 'Já existe um convite para esse e-mail.' : e.message);
    } finally {
      setInviteSaving(false);
    }
  };

  const handleCopyInvite = async (inv: ProducerInvite) => {
    const url = buildInviteUrl(inv.token);
    await navigator.clipboard.writeText(url);
    setCopiedToken(inv.token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleDeleteInvite = async (inv: ProducerInvite) => {
    if (!confirm(`Excluir convite para ${inv.email}?`)) return;
    await deleteInvite(inv.id);
    setInvites(list => list.filter(x => x.id !== inv.id));
  };

  const handleSaveEventCommission = async (patch: Partial<EventRow>) => {
    if (!eventEdit) return;
    const update: Record<string, any> = {};
    if (patch.commission_type    !== undefined) update.commission_type    = patch.commission_type;
    if (patch.commission_percent !== undefined) update.commission_percent = patch.commission_percent;
    if (patch.commission_fixed   !== undefined) update.commission_fixed   = patch.commission_fixed;
    if (patch.fee_mode           !== undefined) update.fee_mode           = patch.fee_mode;
    if (patch.event_type         !== undefined) update.event_type         = patch.event_type;
    if (patch.is_public          !== undefined) update.is_public          = patch.is_public;

    const { error: updErr } = await supabase.from('events').update(update).eq('id', eventEdit.id);
    if (updErr) { alert('Falha ao salvar: ' + updErr.message); return; }
    setEventsList(list => list.map(e => e.id === eventEdit.id ? { ...e, ...patch } : e));
    setEventEdit(null);
  };

  const handleMakeEventFree = async (ev: EventRow) => {
    if (!confirm(`Tornar "${ev.name}" gratuito? Comissão zera e taxa Asaas é absorvida pela plataforma.`)) return;
    const { error: updErr } = await supabase.from('events')
      .update({ commission_percent: 0, commission_fixed: 0, fee_mode: 'absorver' })
      .eq('id', ev.id);
    if (updErr) { alert('Falha: ' + updErr.message); return; }
    setEventsList(list => list.map(e => e.id === ev.id ? { ...e, commission_percent: 0, commission_fixed: 0, fee_mode: 'absorver' } : e));
  };

  const handleToggleEventPublic = async (ev: EventRow) => {
    const next = !ev.is_public;
    const { error: updErr } = await supabase.from('events').update({ is_public: next }).eq('id', ev.id);
    if (updErr) { alert('Falha: ' + updErr.message); return; }
    setEventsList(list => list.map(e => e.id === ev.id ? { ...e, is_public: next } : e));
  };

  const handleExportCSV = () => {
    const header = ['data', 'evento', 'produtor', 'bruto', 'comissao', 'liquido', 'status'];
    const producerById = new Map(producers.map(p => [p.id, p.full_name ?? p.email ?? '—']));
    const rows = commissions.map(c => [
      new Date(c.created_at).toLocaleDateString('pt-BR'),
      eventsByName.get(c.event_id) ?? '—',
      producerById.get(c.producer_id) ?? '—',
      Number(c.gross_amount      ?? 0).toFixed(2).replace('.', ','),
      Number(c.commission_amount ?? 0).toFixed(2).replace('.', ','),
      Number(c.net_amount        ?? 0).toFixed(2).replace('.', ','),
      (c as any).refunded_at ? 'reembolsado' : 'aprovado',
    ]);
    const csv = [header, ...rows].map(r => r.join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coreohub_plataforma_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* Estados de carregamento e acesso */
  if (authorized === null) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 size={32} className="animate-spin text-[#ff0068]" /></div>;
  }
  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-sm">
          <Lock size={40} className="text-amber-400 mx-auto" />
          <p className="font-black text-xl text-slate-900 dark:text-white uppercase italic">Acesso Restrito</p>
          <p className="text-slate-500 text-sm">Esta área é exclusiva para administradores da plataforma.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <header className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Crown size={12} className="text-[#e3ff0a]" />
            <span className="text-[9px] font-black text-[#e3ff0a] uppercase tracking-[0.3em]">Painel da Plataforma</span>
          </div>
          <h1 className="text-4xl font-black tracking-tighter uppercase text-slate-900 dark:text-white">
            Super <span className="text-[#ff0068] italic">Admin</span>
          </h1>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Visão consolidada da CoreoHub</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            disabled={commissions.length === 0}
            className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white hover:border-[#ff0068]/40 hover:text-[#ff0068] transition-all disabled:opacity-40"
          >
            <Download size={12} /> CSV
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 bg-[#ff0068] hover:bg-[#e0005c] text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-xl shadow-[#ff0068]/20"
          >
            <Plus size={14} /> Convidar Produtor
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
          <AlertCircle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
      ) : (
        <>
          {/* Métricas */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={DollarSign}
              label="GMV Total"
              value={`R$ ${stats.grossTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
              sub="Volume bruto da plataforma"
            />
            <MetricCard
              icon={TrendingUp}
              label="Receita CoreoHub"
              value={`R$ ${stats.commissionTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
              sub={`${stats.transactionsCount} transações aprovadas`}
              tone="emerald"
            />
            <MetricCard
              icon={Users}
              label="Produtores"
              value={stats.producersCount}
              sub="Com evento ou subconta ativa"
            />
            <MetricCard
              icon={Calendar}
              label="Eventos"
              value={eventsByName.size}
              sub="Cadastrados na plataforma"
            />
          </div>

          {/* Receita mensal */}
          <Section icon={BarChart3} title="Receita Mensal Consolidada" sub="Soma de todos os produtores">
            {monthly.length === 0 ? (
              <p className="text-center py-10 text-[10px] text-slate-400 uppercase font-black">Sem comissões registradas ainda</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.2} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }} tickFormatter={(v) => `R$${v}`} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #ff0068', fontSize: 11, fontWeight: 800 }}
                      formatter={(v: any) => [`R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, '']}
                    />
                    <Bar dataKey="bruto"    name="GMV"      fill="#ff0068" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="comissao" name="CoreoHub" fill="#e3ff0a" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top eventos */}
            <Section icon={TrendingUp} title="Top 5 Eventos" sub="Maior receita para a CoreoHub" className="lg:col-span-1">
              {topEvents.length === 0 ? (
                <p className="text-center py-6 text-[10px] text-slate-400 uppercase font-black">Sem dados</p>
              ) : (
                <ul className="space-y-2">
                  {topEvents.map((ev, i) => (
                    <li key={ev.eventId} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                      <span className="text-2xl font-black text-[#ff0068] tabular-nums">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-slate-900 dark:text-white truncate">{ev.name}</p>
                        <p className="text-[10px] text-slate-500 font-bold">R$ {ev.commission.toFixed(2)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Convites pendentes */}
            <Section icon={Mail} title="Convites Pendentes" sub={`${invites.filter(i => !i.used_at).length} aguardando uso`} className="lg:col-span-2">
              {invites.length === 0 ? (
                <p className="text-center py-6 text-[10px] text-slate-400 uppercase font-black">Nenhum convite criado</p>
              ) : (
                <ul className="space-y-2">
                  {invites.map(inv => {
                    const expired = new Date(inv.expires_at).getTime() < Date.now();
                    return (
                      <li key={inv.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs font-black text-slate-900 dark:text-white truncate">{inv.full_name ?? inv.email}</p>
                            {inv.used_at ? (
                              <span className="text-[9px] font-black uppercase text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">Usado</span>
                            ) : expired ? (
                              <span className="text-[9px] font-black uppercase text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">Expirado</span>
                            ) : (
                              <span className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">Pendente</span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 truncate">{inv.email}</p>
                        </div>
                        {!inv.used_at && !expired && (
                          <button
                            onClick={() => handleCopyInvite(inv)}
                            className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 transition-colors"
                            title="Copiar link"
                          >
                            {copiedToken === inv.token ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteInvite(inv)}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          {/* Tabela de eventos */}
          <Section icon={Calendar} title="Eventos da Plataforma" sub="Gerencie comissão, tipo e visibilidade na vitrine">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <input
                type="text"
                value={eventSearch}
                onChange={e => setEventSearch(e.target.value)}
                placeholder="Buscar por nome..."
                className="flex-1 min-w-[180px] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
              />
              <div className="flex gap-2">
                {(['all','private','government','free'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setEventFilter(f)}
                    className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      eventFilter === f
                        ? 'bg-[#ff0068] text-white'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {f === 'all' ? 'Todos' : f === 'private' ? 'Privados' : f === 'government' ? 'Governo' : 'Gratuitos'}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const producerById = new Map(producers.map(p => [p.id, p.full_name ?? p.email ?? '—']));
              const term = eventSearch.toLowerCase();
              const filtered = eventsList.filter(ev => {
                if (term && !ev.name?.toLowerCase().includes(term)) return false;
                if (eventFilter === 'private'    && ev.event_type !== 'private')    return false;
                if (eventFilter === 'government' && ev.event_type !== 'government') return false;
                if (eventFilter === 'free' && (Number(ev.commission_percent ?? 0) > 0 || Number(ev.commission_fixed ?? 0) > 0)) return false;
                return true;
              });

              if (filtered.length === 0) {
                return <p className="text-center py-6 text-[10px] text-slate-400 uppercase font-black">Nenhum evento encontrado</p>;
              }

              return (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-white/5">
                        <th className="px-4 py-3">Evento</th>
                        <th className="px-4 py-3">Produtor</th>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Comissão</th>
                        <th className="px-4 py-3">Vitrine</th>
                        <th className="px-4 py-3 text-right" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {filtered.map(ev => {
                        const isFree = Number(ev.commission_percent ?? 0) === 0 && Number(ev.commission_fixed ?? 0) === 0;
                        return (
                          <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                            <td className="px-4 py-3">
                              <p className="text-xs font-black text-slate-900 dark:text-white">{ev.name}</p>
                              {ev.slug && <p className="text-[9px] text-slate-400">/{ev.slug}</p>}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300 truncate max-w-[180px]">
                              {ev.created_by ? producerById.get(ev.created_by) ?? '—' : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                              {ev.start_date ? new Date(ev.start_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                ev.event_type === 'government'
                                  ? 'text-blue-500 bg-blue-500/10'
                                  : 'text-slate-500 bg-slate-100 dark:bg-white/5'
                              }`}>
                                {ev.event_type === 'government' ? 'Governo' : 'Privado'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs tabular-nums">
                              {isFree ? (
                                <span className="text-emerald-500 font-black uppercase tracking-widest text-[9px]">Gratuito</span>
                              ) : (
                                <span className="text-slate-700 dark:text-slate-300">
                                  {ev.commission_type === 'FIXED'
                                    ? `R$ ${Number(ev.commission_fixed ?? 0).toFixed(2)}`
                                    : `${Number(ev.commission_percent ?? 0)}%`
                                  }
                                  {ev.fee_mode === 'absorver' && <span className="ml-1 text-[8px] text-slate-400">(absorve)</span>}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => handleToggleEventPublic(ev)}
                                className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full transition-colors ${
                                  ev.is_public
                                    ? 'text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20'
                                    : 'text-slate-400 bg-slate-100 dark:bg-white/5 hover:bg-slate-200'
                                }`}
                                title={ev.is_public ? 'Clique para ocultar' : 'Clique para publicar'}
                              >
                                {ev.is_public ? 'Pública' : 'Oculta'}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-1">
                                {!isFree && (
                                  <button
                                    onClick={() => handleMakeEventFree(ev)}
                                    className="p-2 rounded-lg text-emerald-500 hover:bg-emerald-500/10"
                                    title="Tornar gratuito"
                                  >
                                    <DollarSign size={14} />
                                  </button>
                                )}
                                <button
                                  onClick={() => setEventEdit(ev)}
                                  className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10"
                                  title="Editar comissão"
                                >
                                  <BarChart3 size={14} />
                                </button>
                                {ev.slug && (
                                  <a
                                    href={`/evento/${ev.slug}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10"
                                    title="Abrir vitrine"
                                  >
                                    <ExternalLink size={14} />
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </Section>

          {/* Tabela de produtores */}
          <Section icon={Users} title="Produtores Ativos" sub="Ordenado por receita gerada para a CoreoHub">
            {producers.length === 0 ? (
              <p className="text-center py-6 text-[10px] text-slate-400 uppercase font-black">Nenhum produtor ainda</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-white/5">
                      <th className="px-4 py-3">Produtor</th>
                      <th className="px-4 py-3">Eventos</th>
                      <th className="px-4 py-3">GMV</th>
                      <th className="px-4 py-3">Comissão</th>
                      <th className="px-4 py-3">Asaas</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {producers.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                        <td className="px-4 py-3">
                          <p className="text-xs font-black text-slate-900 dark:text-white">{p.full_name ?? '—'}</p>
                          <p className="text-[10px] text-slate-500">{p.email}</p>
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-300">{p.events_count}</td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-300 tabular-nums">R$ {p.total_gross.toFixed(2)}</td>
                        <td className="px-4 py-3 text-xs font-black text-[#ff0068] tabular-nums">R$ {p.total_commission.toFixed(2)}</td>
                        <td className="px-4 py-3">
                          {p.asaas_subconta_id
                            ? <span className="text-[9px] font-black uppercase text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">Conectado</span>
                            : <span className="text-[9px] font-black uppercase text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full">—</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {p.is_blocked
                            ? <span className="text-[9px] font-black uppercase text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">Bloqueado</span>
                            : <span className="text-[9px] font-black uppercase text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">Ativo</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleToggleBlock(p)}
                            className={`p-2 rounded-lg transition-colors ${p.is_blocked ? 'text-emerald-500 hover:bg-emerald-500/10' : 'text-rose-500 hover:bg-rose-500/10'}`}
                            title={p.is_blocked ? 'Desbloquear' : 'Bloquear'}
                          >
                            {p.is_blocked ? <Unlock size={14} /> : <Lock size={14} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {/* Modal Editar Comissão */}
      {eventEdit && (
        <EventCommissionModal
          event={eventEdit}
          onClose={() => setEventEdit(null)}
          onSave={handleSaveEventCommission}
        />
      )}

      {/* Modal Convite */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Novo Convite</h3>
                <p className="text-xs text-slate-500 mt-0.5">Gera um link único de cadastro para o produtor.</p>
              </div>
              <button onClick={() => { setShowInviteModal(false); setInviteError(null); }} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">E-mail do Produtor</label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="produtor@exemplo.com"
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Nome (opcional)</label>
                <input
                  type="text"
                  value={inviteForm.full_name}
                  onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="João da Silva"
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                />
              </div>

              {inviteError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400">{inviteError}</p>
                </div>
              )}

              <button
                onClick={handleCreateInvite}
                disabled={inviteSaving}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-xl font-black text-sm uppercase tracking-widest"
              >
                {inviteSaving ? <Loader2 size={16} className="animate-spin" /> : <><ExternalLink size={16} /> Gerar Link de Convite</>}
              </button>
              <p className="text-[10px] text-center text-slate-400">O link é copiado automaticamente para sua área de transferência.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard: React.FC<{ icon: any; label: string; value: any; sub: string; tone?: 'pink' | 'emerald' }> = ({ icon: Icon, label, value, sub, tone = 'pink' }) => {
  const tones = {
    pink:    'bg-[#ff0068]/10 text-[#ff0068] border-[#ff0068]/20',
    emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  };
  return (
    <div className="bg-slate-100 dark:bg-white/5 p-5 rounded-3xl border border-slate-200 dark:border-white/5">
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-3 ${tones[tone]}`}>
        <Icon size={18} />
      </div>
      <h3 className="text-slate-500 text-[8px] font-black uppercase tracking-[0.2em]">{label}</h3>
      <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tighter">{value}</div>
      <p className="text-[9px] text-slate-500 font-medium">{sub}</p>
    </div>
  );
};

const Section: React.FC<{ icon: any; title: string; sub?: string; className?: string; children: React.ReactNode }> = ({ icon: Icon, title, sub, className = '', children }) => (
  <div className={`bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden ${className}`}>
    <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center gap-3">
      <div className="p-2 bg-[#ff0068]/10 text-[#ff0068] rounded-xl border border-[#ff0068]/20">
        <Icon size={14} />
      </div>
      <div>
        <h2 className="text-sm font-black uppercase text-slate-900 dark:text-white tracking-tight italic">{title}</h2>
        {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
      </div>
    </div>
    <div className="p-6">{children}</div>
  </div>
);

/* ────────────────────────────────────────────────────────────────────────
   Modal de edição de comissão de evento
   ──────────────────────────────────────────────────────────────────────── */
const EventCommissionModal: React.FC<{
  event: EventRow;
  onClose: () => void;
  onSave: (patch: Partial<EventRow>) => void;
}> = ({ event, onClose, onSave }) => {
  const [type, setType]         = useState<'PERCENT' | 'FIXED'>(event.commission_type ?? 'PERCENT');
  const [percent, setPercent]   = useState<number>(Number(event.commission_percent ?? 10));
  const [fixed, setFixed]       = useState<number>(Number(event.commission_fixed ?? 0));
  const [feeMode, setFeeMode]   = useState<'repassar' | 'absorver'>(event.fee_mode ?? 'repassar');
  const [eventType, setEventType] = useState<'private' | 'government'>(event.event_type ?? 'private');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">Editar Comissão</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{event.name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Tipo de evento */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Tipo de Evento</label>
            <div className="grid grid-cols-2 gap-2">
              {(['private','government'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setEventType(t)}
                  className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                    eventType === t
                      ? 'bg-[#ff0068] text-white border-[#ff0068]'
                      : 'bg-slate-50 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                  }`}
                >
                  {t === 'private' ? 'Privado' : 'Governo'}
                </button>
              ))}
            </div>
          </div>

          {/* Modelo */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Modelo</label>
            <div className="grid grid-cols-2 gap-2">
              {(['PERCENT','FIXED'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                    type === t
                      ? 'bg-[#ff0068]/10 text-[#ff0068] border-[#ff0068]/40'
                      : 'bg-slate-50 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                  }`}
                >
                  {t === 'PERCENT' ? 'Percentual' : 'Valor Fixo'}
                </button>
              ))}
            </div>
          </div>

          {/* Valor */}
          {type === 'PERCENT' ? (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Percentual (%)</label>
              <input
                type="number" min={0} max={100} step={0.1}
                value={percent}
                onChange={e => setPercent(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Valor Fixo (R$)</label>
              <input
                type="number" min={0} step={0.01}
                value={fixed}
                onChange={e => setFixed(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
              />
            </div>
          )}

          {/* Quem paga a taxa Asaas */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Taxa Asaas</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: 'repassar' as const, label: 'Repassar', desc: 'Inscrito paga a taxa' },
                { v: 'absorver' as const, label: 'Absorver', desc: 'Plataforma paga' },
              ]).map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setFeeMode(opt.v)}
                  className={`py-3 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all text-left ${
                    feeMode === opt.v
                      ? 'bg-[#ff0068]/10 text-[#ff0068] border-[#ff0068]/40'
                      : 'bg-slate-50 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                  }`}
                >
                  <div>{opt.label}</div>
                  <div className="text-[8px] font-medium normal-case text-slate-400 mt-1">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => onSave({
              commission_type:    type,
              commission_percent: type === 'PERCENT' ? percent : 0,
              commission_fixed:   type === 'FIXED'   ? fixed   : 0,
              fee_mode:           feeMode,
              event_type:         eventType,
            })}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-sm uppercase tracking-widest"
          >
            <Check size={16} /> Salvar Comissão
          </button>
        </div>
      </div>
    </div>
  );
};

export default SuperAdmin;
