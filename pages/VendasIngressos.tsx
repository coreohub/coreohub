/**
 * VendasIngressos — Painel produtor de venda de ingressos de plateia (Tier 1).
 *
 * Mostra resumo (total vendido, ingressos confirmados, pendentes), lista de
 * compras com filtro/busca, link pra ingresso individual e export CSV.
 *
 * RLS já filtra: producer só lê tickets do seu próprio evento.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { supabase, resolveActiveEventId } from '../services/supabase';
import {
  Ticket, Loader2, Search, Download, ExternalLink, CheckCircle2, Clock, XCircle, RotateCcw,
  Users, DollarSign, AlertCircle,
} from 'lucide-react';

interface Row {
  id: string;
  event_id: string;
  ticket_type_nome: string;
  ticket_type_kind: string;
  preco: number;
  buyer_name: string;
  buyer_email: string;
  buyer_cpf: string;
  buyer_phone: string | null;
  status_pagamento: string;
  payment_method: string | null;
  paid_at: string | null;
  check_in_status: string;
  check_in_at: string | null;
  access_token: string;
  commission_amount: number | null;
  producer_amount: number | null;
  fee_mode: string | null;
  created_at: string;
}

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0);
const formatCpf = (d: string) => d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'todos',     label: 'Todos' },
  { id: 'APROVADO',  label: 'Confirmados' },
  { id: 'PENDENTE',  label: 'Pendentes' },
  { id: 'CANCELADO', label: 'Cancelados' },
  { id: 'ESTORNADO', label: 'Estornados' },
];

const VendasIngressos: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [eventName, setEventName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const eventId = await resolveActiveEventId();
      if (!eventId) { setErr('Nenhum evento ativo encontrado.'); setLoading(false); return; }
      const { data: ev } = await supabase.from('events').select('name').eq('id', eventId).maybeSingle();
      setEventName(ev?.name ?? '');
      const { data, error } = await supabase
        .from('audience_tickets')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as Row[]);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Realtime: assina mudanças em audience_tickets do evento ativo.
  // RLS já garante que producer só recebe eventos do próprio evento.
  useEffect(() => {
    let channel: any = null;
    (async () => {
      const eventId = await resolveActiveEventId();
      if (!eventId) return;
      channel = supabase
        .channel(`audience-tickets-${eventId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'audience_tickets',
          filter: `event_id=eq.${eventId}`,
        }, () => {
          // Reload silencioso (sem flicker do Loader)
          supabase
            .from('audience_tickets')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false })
            .then(({ data }) => {
              if (data) setRows(data as Row[]);
            });
        })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  // Recarrega quando aba volta a ficar visível (ex: produtor confere após
  // teste de pagamento em outra aba)
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []);

  // ─── Métricas ─────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const aprovados = rows.filter(r => r.status_pagamento === 'APROVADO');
    const pendentes = rows.filter(r => r.status_pagamento === 'PENDENTE');
    const totalLiquido = aprovados.reduce((s, r) => s + Number(r.producer_amount ?? 0), 0);
    const totalBruto   = aprovados.reduce((s, r) => s + Number(r.preco ?? 0), 0);
    const totalComissao = aprovados.reduce((s, r) => s + Number(r.commission_amount ?? 0), 0);
    const checkedIn = aprovados.filter(r => r.check_in_status === 'OK').length;
    return {
      total: rows.length,
      aprovados: aprovados.length,
      pendentes: pendentes.length,
      totalLiquido, totalBruto, totalComissao,
      checkedIn,
    };
  }, [rows]);

  // ─── Filtros ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'todos' && r.status_pagamento !== statusFilter) return false;
      if (!q) return true;
      return (
        r.buyer_name.toLowerCase().includes(q) ||
        r.buyer_email.toLowerCase().includes(q) ||
        r.buyer_cpf.includes(q.replace(/\D/g, ''))
      );
    });
  }, [rows, search, statusFilter]);

  // ─── Export CSV ───────────────────────────────────────────────────────────
  const exportCsv = () => {
    const header = [
      'Data compra', 'Tipo', 'Comprador', 'Email', 'CPF', 'Telefone',
      'Preço', 'Status', 'Pago em', 'Check-in', 'Método', 'Líquido produtor', 'Comissão',
    ];
    const csv = [
      header.join(';'),
      ...filtered.map(r => [
        new Date(r.created_at).toLocaleString('pt-BR'),
        r.ticket_type_nome,
        r.buyer_name,
        r.buyer_email,
        formatCpf(r.buyer_cpf),
        r.buyer_phone ?? '',
        Number(r.preco).toFixed(2).replace('.', ','),
        r.status_pagamento,
        r.paid_at ? new Date(r.paid_at).toLocaleString('pt-BR') : '',
        r.check_in_status === 'OK' && r.check_in_at ? new Date(r.check_in_at).toLocaleString('pt-BR') : '',
        r.payment_method ?? '',
        Number(r.producer_amount ?? 0).toFixed(2).replace('.', ','),
        Number(r.commission_amount ?? 0).toFixed(2).replace('.', ','),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')),
    ].join('\n');

    const blob = new Blob([new TextEncoder().encode('﻿' + csv)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vendas-ingressos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-[#ff0068] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Vendas de <span className="text-[#ff0068]">Ingressos</span>
          </h1>
          {eventName && <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mt-1">{eventName}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10"
          >
            <RotateCcw size={12} /> Atualizar
          </button>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-30"
          >
            <Download size={12} /> Exportar CSV
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-300 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric icon={Ticket} label="Vendidos" value={String(metrics.aprovados)} sub={`${metrics.pendentes} pendentes`} />
        <Metric icon={DollarSign} label="Total bruto" value={formatBRL(metrics.totalBruto)} sub={`Líquido ${formatBRL(metrics.totalLiquido)}`} />
        <Metric icon={Users} label="Check-ins" value={`${metrics.checkedIn} / ${metrics.aprovados}`} sub="presenças confirmadas" />
        <Metric icon={Clock} label="Pendentes" value={String(metrics.pendentes)} sub="aguardando pagamento" />
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10">
          <Search size={14} className="text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, email ou CPF..."
            className="bg-transparent flex-1 text-sm outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${
                statusFilter === f.id
                  ? 'bg-[#ff0068] text-white'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-white/5 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl p-12 text-center">
          <Ticket size={32} className="text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700 dark:text-white">Nenhum ingresso ainda</p>
          <p className="text-xs text-slate-500 mt-1">
            Compras aparecem aqui assim que o pagamento é confirmado.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                <tr className="text-left">
                  <Th>Data</Th>
                  <Th>Comprador</Th>
                  <Th>Tipo</Th>
                  <Th>Valor</Th>
                  <Th>Status</Th>
                  <Th>Check-in</Th>
                  <Th>Ingresso</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-white/5 last:border-b-0 hover:bg-slate-50 dark:hover:bg-white/5">
                    <Td>
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        {new Date(r.created_at).toLocaleDateString('pt-BR')}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </Td>
                    <Td>
                      <p className="font-bold text-slate-900 dark:text-white">{r.buyer_name}</p>
                      <p className="text-[10px] text-slate-500">{r.buyer_email}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{formatCpf(r.buyer_cpf)}</p>
                    </Td>
                    <Td>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{r.ticket_type_nome}</p>
                      {r.ticket_type_kind === 'meia' && (
                        <p className="text-[9px] uppercase tracking-widest text-amber-600 dark:text-amber-400 font-black">Meia</p>
                      )}
                    </Td>
                    <Td>
                      <p className="font-black tabular-nums text-slate-900 dark:text-white">{formatBRL(r.preco)}</p>
                      {r.producer_amount != null && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                          Líq. {formatBRL(Number(r.producer_amount))}
                        </p>
                      )}
                    </Td>
                    <Td><StatusBadge status={r.status_pagamento} /></Td>
                    <Td>
                      {r.check_in_status === 'OK' ? (
                        <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={10} /> OK
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </Td>
                    <Td>
                      <a
                        href={`/meu-ingresso/${r.access_token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline"
                      >
                        Ver <ExternalLink size={10} />
                      </a>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500">{children}</th>
);
const Td: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <td className="px-4 py-3 align-middle">{children}</td>
);

const Metric: React.FC<{ icon: any; label: string; value: string; sub?: string }> = ({ icon: Icon, label, value, sub }) => (
  <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
    <div className="p-2 rounded-xl bg-[#ff0068]/10 text-[#ff0068] inline-flex mb-2">
      <Icon size={16} />
    </div>
    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    <p className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white">{value}</p>
    {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
  </div>
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { label: string; cls: string; icon: any }> = {
    APROVADO:  { label: 'Confirmado', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
    PENDENTE:  { label: 'Pendente',   cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',     icon: Clock },
    CANCELADO: { label: 'Cancelado',  cls: 'bg-slate-500/10 text-slate-500',                          icon: XCircle },
    ESTORNADO: { label: 'Estornado',  cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',         icon: XCircle },
    VENCIDO:   { label: 'Vencido',    cls: 'bg-slate-500/10 text-slate-500',                          icon: XCircle },
    CORTESIA:  { label: 'Cortesia',   cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',         icon: CheckCircle2 },
  };
  const cfg = map[status] ?? { label: status, cls: 'bg-slate-500/10 text-slate-500', icon: AlertCircle };
  const Icon = cfg.icon;
  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${cfg.cls}`}>
      <Icon size={10} />
      {cfg.label}
    </div>
  );
};

export default VendasIngressos;
