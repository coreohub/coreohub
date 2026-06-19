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
  Users, DollarSign, AlertCircle, Undo2, X,
} from 'lucide-react';
import AsaasBadge from '../components/AsaasBadge';
import VendasTabs from '../components/VendasTabs';
import { maskCpfCnpj, unmaskCpfCnpj } from '../utils/masks';

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
  group_id: string | null;
  refunded_at: string | null;
  refund_amount: number | null;
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
  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  // Refund modal (Tier 2)
  const [refundTarget, setRefundTarget] = useState<Row | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundProcessing, setRefundProcessing] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  // Detail drawer (Stripe Dashboard pattern: row click → side sheet com detalhes)
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  // Cortesia (convite gratuito direto, sem cupom — padrão Sympla/Eventbrite)
  const [courtesyOpen, setCourtesyOpen] = useState(false);
  const [courtesyForm, setCourtesyForm] = useState({ name: '', email: '', cpf: '', phone: '' });
  const [courtesySaving, setCourtesySaving] = useState(false);
  const [courtesyError, setCourtesyError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const eventId = await resolveActiveEventId();
      if (!eventId) { setErr('Nenhum evento ativo encontrado.'); setLoading(false); return; }
      setEventId(eventId);
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

  // ─── Refund (Tier 2) ──────────────────────────────────────────────────────
  const handleRefund = async () => {
    if (!refundTarget || refundProcessing) return;
    setRefundError(null);
    setRefundProcessing(true);
    try {
      // supabase.functions.invoke usa o session token do user logado (produtor)
      // automaticamente como Authorization, e adiciona apikey.
      const { data, error: invokeErr } = await supabase.functions.invoke('refund-audience-ticket', {
        body: {
          ticket_id: refundTarget.id,
          reason: refundReason.trim() || undefined,
        },
      });
      // Quando a função retorna non-2xx com body JSON {error}, supabase-js
      // não devolve em `data` — coloca em invokeErr.context.response. Lemos
      // pra mostrar a mensagem real (ex: "Boleto não pode ser estornado") em
      // vez do genérico "Edge Function returned a non-2xx status code".
      if (invokeErr) {
        let serverMsg: string | null = null;
        try {
          const ctx = (invokeErr as any).context;
          const resp = ctx?.response;
          if (resp && typeof resp.json === 'function') {
            const body = await resp.json();
            serverMsg = body?.error ?? null;
          }
        } catch { /* ignore */ }
        throw new Error(serverMsg ?? invokeErr.message ?? 'Falha ao processar reembolso');
      }
      if (data?.error) throw new Error(data.error);
      setRefundTarget(null);
      setRefundReason('');
      await load();
    } catch (e: any) {
      setRefundError(e.message ?? String(e));
    } finally {
      setRefundProcessing(false);
    }
  };

  // ─── Cortesia (convite gratuito direto) ──────────────────────────────────
  const handleAddCourtesy = async () => {
    if (!eventId || courtesySaving) return;
    setCourtesyError(null);
    const cpf = unmaskCpfCnpj(courtesyForm.cpf);
    if (!courtesyForm.name.trim() || !courtesyForm.email.trim() || cpf.length !== 11) {
      setCourtesyError('Preencha nome, e-mail e CPF válido.');
      return;
    }
    setCourtesySaving(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('create-courtesy-entry', {
        body: {
          kind: 'audience',
          event_id: eventId,
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
      await load();
    } catch (e: any) {
      setCourtesyError(e.message ?? String(e));
    } finally {
      setCourtesySaving(false);
    }
  };

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
      <VendasTabs />
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
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
            onClick={() => { setCourtesyError(null); setCourtesyOpen(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-500/20"
          >
            <Users size={12} /> Adicionar cortesia
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
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 dark:border-white/5 last:border-b-0 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer"
                    onClick={() => setDetailRow(r)}
                  >
                    <Td>
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        {new Date(r.created_at).toLocaleDateString('pt-BR')}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </Td>
                    <Td>
                      <p className="font-bold text-slate-900 dark:text-white hover:text-[#ff0068]">{r.buyer_name}</p>
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
                    <Td>
                      <StatusBadge status={r.status_pagamento} />
                      {r.refunded_at && (
                        <p className="text-[9px] text-rose-500 mt-0.5">
                          {r.group_id && r.refund_amount == null
                            ? <>Em grupo · {formatBRL(r.preco)}</>
                            : <>{formatBRL(Number(r.refund_amount ?? r.preco))}</>}
                        </p>
                      )}
                    </Td>
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
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline"
                      >
                        Ver <ExternalLink size={10} />
                      </a>
                    </Td>
                    <Td>
                      {r.status_pagamento === 'APROVADO' && !r.refunded_at && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setRefundTarget(r); setRefundReason(''); setRefundError(null); }}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg text-[10px] font-black uppercase tracking-widest"
                        >
                          <Undo2 size={10} /> Estornar
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Selo Asaas — listagem de cobrança/extrato é ponto obrigatório
              conforme Playbook Asaas (Resolução Conjunta nº 16/2025 BCB). */}
          <div className="px-4 py-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-center">
            <AsaasBadge variant="compact" />
          </div>
        </div>
      )}

      {/* Modal de reembolso (Tier 2) */}
      {courtesyOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                  Adicionar cortesia
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Convite gratuito direto — sem cupom, sem cobrança Asaas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCourtesyOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
                disabled={courtesySaving}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Nome</label>
                <input
                  value={courtesyForm.name}
                  onChange={e => setCourtesyForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">E-mail</label>
                <input
                  type="email"
                  value={courtesyForm.email}
                  onChange={e => setCourtesyForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">CPF</label>
                <input
                  value={courtesyForm.cpf}
                  onChange={e => setCourtesyForm(f => ({ ...f, cpf: maskCpfCnpj(e.target.value) }))}
                  placeholder="000.000.000-00"
                  className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Telefone (opcional)</label>
                <input
                  value={courtesyForm.phone}
                  onChange={e => setCourtesyForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                />
              </div>
            </div>

            {courtesyError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-300 flex items-start gap-2" aria-live="polite">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{courtesyError}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCourtesyOpen(false)}
                disabled={courtesySaving}
                className="flex-1 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[11px] font-black uppercase tracking-widest"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAddCourtesy}
                disabled={courtesySaving}
                className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-2"
              >
                {courtesySaving ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                {courtesySaving ? 'Salvando...' : 'Adicionar cortesia'}
              </button>
            </div>
          </div>
        </div>
      )}

      {refundTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                  Estornar ingresso
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Reembolso integral via Asaas. Operação irreversível.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRefundTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
                disabled={refundProcessing}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 bg-slate-50 dark:bg-white/5 rounded-xl p-4 border border-slate-200 dark:border-white/10">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-slate-500">Comprador</span>
                <span className="font-bold text-slate-900 dark:text-white">{refundTarget.buyer_name}</span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-slate-500">Tipo</span>
                <span className="font-bold text-slate-900 dark:text-white">{refundTarget.ticket_type_nome}</span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-slate-500">Valor</span>
                <span className="font-black text-[#ff0068]">{formatBRL(refundTarget.preco)}</span>
              </div>
              {refundTarget.group_id && (
                <div className="mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
                  <AlertCircle size={12} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold leading-snug">
                    Compra com múltiplos ingressos: o estorno cancela TODOS os ingressos da mesma compra (Asaas reembolsa o pagamento inteiro).
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                Motivo (opcional, será enviado ao comprador)
              </label>
              <textarea
                value={refundReason}
                onChange={e => setRefundReason(e.target.value)}
                placeholder="Ex: cancelamento do evento, duplicidade, etc."
                rows={3}
                className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 resize-none"
              />
            </div>

            {refundError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-300 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{refundError}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRefundTarget(null)}
                disabled={refundProcessing}
                className="flex-1 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[11px] font-black uppercase tracking-widest"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRefund}
                disabled={refundProcessing}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white rounded-xl text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-2"
              >
                {refundProcessing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                {refundProcessing ? 'Processando...' : 'Estornar agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer de detalhes do comprador (Stripe Dashboard pattern: side sheet
          em desktop, bottom sheet em mobile). Abre ao clicar em qualquer linha. */}
      {detailRow && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center sm:justify-end animate-in fade-in duration-200"
          onClick={() => setDetailRow(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 w-full sm:max-w-md sm:h-screen rounded-t-3xl sm:rounded-none sm:rounded-l-3xl shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 px-5 py-4 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Detalhes do ingresso</p>
                <h3 className="text-base font-black tracking-tight text-slate-900 dark:text-white truncate">
                  {detailRow.buyer_name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 shrink-0"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <Section title="Comprador">
                <Field label="Nome" value={detailRow.buyer_name} />
                <Field label="E-mail" value={detailRow.buyer_email} mono />
                <Field label="CPF" value={formatCpf(detailRow.buyer_cpf)} mono />
                {detailRow.buyer_phone && <Field label="Telefone" value={detailRow.buyer_phone} mono />}
              </Section>

              <Section title="Ingresso">
                <Field label="Tipo" value={detailRow.ticket_type_nome + (detailRow.ticket_type_kind === 'meia' ? ' (meia)' : '')} />
                <Field label="Valor pago" value={formatBRL(detailRow.preco)} highlight />
                {detailRow.producer_amount != null && (
                  <Field label="Líquido (você)" value={formatBRL(Number(detailRow.producer_amount))} />
                )}
                {detailRow.commission_amount != null && (
                  <Field label="Comissão CoreoHub" value={formatBRL(Number(detailRow.commission_amount))} />
                )}
                {detailRow.fee_mode && (
                  <Field label="Modo" value={detailRow.fee_mode === 'repassar' ? 'Repassar (comprador paga)' : 'Absorver (você paga)'} />
                )}
              </Section>

              <Section title="Status">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pagamento</span>
                  <StatusBadge status={detailRow.status_pagamento} />
                </div>
                {detailRow.payment_method && (
                  <Field label="Método" value={detailRow.payment_method} />
                )}
                {detailRow.paid_at && (
                  <Field label="Pago em" value={new Date(detailRow.paid_at).toLocaleString('pt-BR')} />
                )}
                <Field
                  label="Check-in"
                  value={
                    detailRow.check_in_status === 'OK' && detailRow.check_in_at
                      ? `OK · ${new Date(detailRow.check_in_at).toLocaleString('pt-BR')}`
                      : 'Pendente'
                  }
                />
              </Section>

              {detailRow.refunded_at && (
                <Section title="Estorno">
                  <Field label="Em" value={new Date(detailRow.refunded_at).toLocaleString('pt-BR')} />
                  {detailRow.refund_amount != null && (
                    <Field label="Valor" value={formatBRL(Number(detailRow.refund_amount))} />
                  )}
                </Section>
              )}

              <Section title="Datas">
                <Field label="Compra criada" value={new Date(detailRow.created_at).toLocaleString('pt-BR')} />
              </Section>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <a
                  href={`/meu-ingresso/${detailRow.access_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] font-black uppercase tracking-widest"
                >
                  Ver ingresso público <ExternalLink size={12} />
                </a>
                {detailRow.status_pagamento === 'APROVADO' && !detailRow.refunded_at && (
                  <button
                    type="button"
                    onClick={() => {
                      setRefundTarget(detailRow);
                      setRefundReason('');
                      setRefundError(null);
                      setDetailRow(null);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-[11px] font-black uppercase tracking-widest"
                  >
                    <Undo2 size={12} /> Estornar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">{title}</h4>
    <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-200 dark:divide-white/10">
      {children}
    </div>
  </div>
);

const Field: React.FC<{ label: string; value: string; mono?: boolean; highlight?: boolean }> = ({ label, value, mono, highlight }) => (
  <div className="flex items-start justify-between gap-3 px-3 py-2">
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 shrink-0">{label}</span>
    <span className={`text-xs text-right break-all ${mono ? 'font-mono' : ''} ${highlight ? 'font-black tabular-nums text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
      {value}
    </span>
  </div>
);

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
