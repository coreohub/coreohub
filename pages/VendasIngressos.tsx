/**
 * VendasIngressos — Painel produtor de venda de ingressos de plateia (Tier 1).
 *
 * Mostra resumo (total vendido, ingressos confirmados, pendentes), lista de
 * compras com filtro/busca, link pra ingresso individual e export CSV.
 *
 * RLS já filtra: producer só lê tickets do seu próprio evento.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { edgeErrorMessage } from '../utils/edgeError';
import { supabase, resolveActiveEventId, fetchMyTeamEventIds, ownedOrTeamEventsFilter } from '../services/supabase';
import {
  Ticket, Loader2, Search, Download, ExternalLink, CheckCircle2, Clock, XCircle, RotateCcw,
  Users, DollarSign, AlertCircle, Undo2, X, Store, Copy, QrCode, Printer, Armchair, CalendarClock,
} from 'lucide-react';
import AsaasBadge from '../components/AsaasBadge';
import VendasTabs from '../components/VendasTabs';
import EventPickerSheet from '../components/EventPickerSheet';
import SeatGrid from '../components/SeatGrid';
import SeatLegend from '../components/SeatLegend';
import { ticketSeatKind } from '../supabase/functions/_shared/seat-rules';
import { SEAT_TIPO_LABEL, seatTipoFromLayout } from '../utils/seatTipo';
import { useSeatMap } from '../hooks/useSeatMap';
import { companionBySpecial, tipoFromRow, isSpecialTipo, type SeatTipo } from '../utils/seatSelection';
import { maskCpfCnpj, unmaskCpfCnpj, maskTelefoneBR, unmaskTelefoneBR } from '../utils/masks';

interface TicketTypeConfig {
  nome: string;
  preco?: number;
  kind?: string;
  lotes?: Array<{ data_virada: string | null; preco: number }>;
}

interface Row {
  id: string;
  event_id: string;
  ticket_type_nome: string;
  ticket_type_kind: string;
  seat_id?: string | null;
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
  payment_id?: string | null;
  sessao_escolha?: 'manter' | 'credito' | 'restituicao' | null;
  sessao_escolha_erro?: string | null;
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
  { id: 'CREDITO',   label: 'Em crédito' },
];

const VendasIngressos: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [eventName, setEventName] = useState<string>('');
  const [eventId, setEventId] = useState<string | null>(null);
  // Seletor de evento (mesmo padrão de Registrations.tsx/Venues.tsx) — sem
  // isso, esta tela nunca tinha jeito nenhum de mostrar um evento is_demo=true
  // (resolveActiveEventId() sem hint sempre prioriza evento real, ver
  // CLAUDE.md 2026-07-12). Default continua resolvendo o evento real como
  // sempre; o picker só existe pra permitir override manual (ex: testar
  // assento numerado/PDV num evento de teste sem mexer no evento real).
  const [allEvents, setAllEvents] = useState<{ id: string; name: string; edition_year?: number | null; is_demo?: boolean | null }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  // Cancelar/adiar sessão (Decreto 13.108 arts. 20-22)
  const [sessionInfo, setSessionInfo] = useState<{ status: string; motivo: string | null; start_date: string | null; event_time: string | null }>({ status: 'agendada', motivo: null, start_date: null, event_time: null });
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionForm, setSessionForm] = useState<{ status: 'adiada' | 'cancelada' | 'agendada'; nova_data: string; nova_hora: string; motivo: string }>({ status: 'adiada', nova_data: '', nova_hora: '', motivo: '' });
  const [sessionConfirmed, setSessionConfirmed] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionResult, setSessionResult] = useState<{ notified: number; failed: number; no_email: number } | null>(null);
  // Escolhas dos compradores + restituição em lote (Fase 5, 4b)
  const [bulkConfirm, setBulkConfirm] = useState<'pedidos' | 'todos' | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ refunded: number; failed: number; skipped_used: number; failures: Array<{ buyer: string | null; error: string }> } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
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
  // Venda no balcão (PDV) — PIX no balcão (comissão normal, auto-confirma via
  // webhook) ou cartão via Asaas Tap (pagamento já feito fisicamente, sem API
  // pra confirmar sozinho — comissão 0%, decisão de produto 2026-07-19).
  const [ticketTypes, setTicketTypes] = useState<TicketTypeConfig[]>([]);
  const [pdvOpen, setPdvOpen] = useState(false);
  const [pdvForm, setPdvForm] = useState({ name: '', email: '', cpf: '', phone: '' });
  const [pdvTypeIdx, setPdvTypeIdx] = useState(0);
  const [pdvQuantity, setPdvQuantity] = useState(1);
  const [pdvMethod, setPdvMethod] = useState<'pix' | 'cartao_tap'>('pix');
  const [pdvSaving, setPdvSaving] = useState(false);
  const [pdvError, setPdvError] = useState<string | null>(null);
  const [pdvResult, setPdvResult] = useState<{
    ticketId: string; accessToken: string; paymentMethod: 'pix' | 'cartao_tap';
    status: string; pix?: { encodedImage: string | null; payload: string | null };
  } | null>(null);
  const [pdvCopied, setPdvCopied] = useState(false);

  // Assento numerado (Fase 2 Stage 4) — mini-mapa read-only + seletor no PDV
  const [seatMapEnabled, setSeatMapEnabled] = useState(false);
  const [pdvSelectedSeats, setPdvSelectedSeats] = useState<string[]>([]);
  // Venda PCD + acompanhante na MESMA venda (padrão Ticketmaster/Bilheteria Digital).
  const [pdvCompanion, setPdvCompanion] = useState(false);

  const load = async (targetEventId: string) => {
    setLoading(true);
    setErr(null);
    try {
      setEventId(targetEventId);
      const { data: ev } = await supabase.from('events').select('name, ingressos_config, seat_map_enabled, sessao_status, sessao_motivo, start_date, event_time').eq('id', targetEventId).maybeSingle();
      setEventName(ev?.name ?? '');
      setTicketTypes(Array.isArray(ev?.ingressos_config) ? (ev!.ingressos_config as TicketTypeConfig[]).filter(t => t?.nome) : []);
      setSeatMapEnabled(Boolean((ev as any)?.seat_map_enabled));
      setSessionInfo({ status: (ev as any)?.sessao_status ?? 'agendada', motivo: (ev as any)?.sessao_motivo ?? null, start_date: (ev as any)?.start_date ?? null, event_time: (ev as any)?.event_time ?? null });
      const { data, error } = await supabase
        .from('audience_tickets')
        .select('*')
        .eq('event_id', targetEventId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as Row[]);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  // Init: lista completa de eventos do produtor (pro picker, inclui demo com
  // badge) + resolve o padrão inicial via resolveActiveEventId() (evento real
  // sempre ganha de um demo mais recente — comportamento inalterado pra quem
  // nunca usa o picker).
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Equipe (operador) vê também as sessões irmãs do espetáculo vinculado.
      const teamEventIds = await fetchMyTeamEventIds();
      const [{ data: events }, defaultId] = await Promise.all([
        supabase
          .from('events')
          .select('id,name,edition_year,is_demo,created_at,start_date,event_time')
          .or(ownedOrTeamEventsFilter(user.id, teamEventIds))
          .order('created_at', { ascending: false }),
        resolveActiveEventId(),
      ]);
      if (events) setAllEvents(events);
      if (!defaultId) { setErr('Nenhum evento ativo encontrado.'); setLoading(false); return; }
      setSelectedEventId(prev => prev ?? defaultId);
    })();
  }, []);

  useEffect(() => { if (selectedEventId) load(selectedEventId); }, [selectedEventId]);

  // Realtime: assina mudanças em audience_tickets do evento selecionado.
  // RLS já garante que producer só recebe eventos do próprio evento.
  useEffect(() => {
    if (!selectedEventId) return;
    const channel = supabase
      .channel(`audience-tickets-${selectedEventId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'audience_tickets',
        filter: `event_id=eq.${selectedEventId}`,
      }, () => {
        // Reload silencioso (sem flicker do Loader)
        supabase
          .from('audience_tickets')
          .select('*')
          .eq('event_id', selectedEventId)
          .order('created_at', { ascending: false })
          .then(({ data }) => {
            if (data) setRows(data as Row[]);
          });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedEventId]);

  // Recarrega quando aba volta a ficar visível (ex: produtor confere após
  // teste de pagamento em outra aba)
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible' && selectedEventId) load(selectedEventId); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [selectedEventId]);

  // ─── Assento numerado: layout (1x) + status (30s parado, 10s com PDV aberto) ─
  const { rowsConfig, seatStatuses } = useSeatMap({
    eventId,
    enabled: seatMapEnabled,
    pollMs: pdvOpen ? 10_000 : 30_000,
  });

  const seatSummary = useMemo(() => {
    const all = Object.values(seatStatuses);
    return {
      total: all.length,
      vendido: all.filter(s => s.status === 'vendido' || s.status === 'cortesia').length,
      reservado: all.filter(s => s.status === 'reservado').length,
      livre: all.filter(s => s.status === 'livre').length,
    };
  }, [seatStatuses]);

  // O tipo escolhido define as regras de assento (Fase 3). Um ingresso PCD pode levar
  // o acompanhante na mesma venda (2º ingresso, tipo "acompanhante" do evento).
  const pdvSeatKind = ticketSeatKind(ticketTypes[pdvTypeIdx] as any);
  const pdvCompanionTypeIdx = useMemo(() => {
    const i = ticketTypes.findIndex(t => t?.nome && ticketSeatKind(t as any) === 'acompanhante');
    return i >= 0 ? i : null;
  }, [ticketTypes]);
  const pdvCompOn = pdvSeatKind === 'pcd' && pdvCompanion && pdvCompanionTypeIdx != null;
  const pdvTotalQty = pdvQuantity + (pdvCompOn ? 1 : 0);
  const pdvPcdQty = pdvSeatKind === 'pcd' ? pdvQuantity : 0;
  const pdvCompQty = pdvSeatKind === 'acompanhante' ? pdvQuantity : (pdvCompOn ? 1 : 0);
  const pdvComumQty = pdvSeatKind === 'comum' ? pdvQuantity : 0;

  const pdvCompanionOfSpecial = useMemo(() => companionBySpecial(rowsConfig), [rowsConfig]);
  const pdvTipoOfSeat = (id: string): SeatTipo => {
    const st = seatStatuses[id]?.seat_tipo as SeatTipo | undefined;
    if (st) return st;
    const cut = id.lastIndexOf('-');
    const row = rowsConfig?.find(r => r.codigo === id.slice(0, cut));
    return row ? tipoFromRow(row, Number(id.slice(cut + 1))) : 'comum';
  };

  // Oferta "Adicionar acompanhante": 1 ingresso PCD com assento especial escolhido, vizinho livre.
  const pdvCompanionOffer = useMemo(() => {
    if (!seatMapEnabled || pdvSeatKind !== 'pcd' || pdvQuantity !== 1 || pdvCompanionTypeIdx == null || pdvCompanion) return null;
    for (const id of pdvSelectedSeats) {
      if (!isSpecialTipo(pdvTipoOfSeat(id))) continue;
      const comp = pdvCompanionOfSpecial[id];
      if (!comp || pdvSelectedSeats.includes(comp)) continue;
      if (seatStatuses[comp]?.status !== 'livre') continue;
      return { special: id, comp };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatMapEnabled, pdvSeatKind, pdvQuantity, pdvCompanionTypeIdx, pdvCompanion, pdvSelectedSeats, pdvCompanionOfSpecial, seatStatuses, rowsConfig]);

  const addPdvCompanion = () => {
    if (!pdvCompanionOffer) return;
    setPdvCompanion(true);
    setPdvSelectedSeats(prev => (prev.includes(pdvCompanionOffer.comp) ? prev : [...prev, pdvCompanionOffer.comp]));
  };

  const togglePdvSeat = (seatId: string) => {
    const prev = pdvSelectedSeats;
    if (prev.includes(seatId)) {
      // Tirar o assento PCD leva junto o acompanhante dele (a venda volta a 1 ingresso).
      const comp = pdvCompanionOfSpecial[seatId];
      if (pdvCompanion && comp && prev.includes(comp)) {
        setPdvSelectedSeats(prev.filter(id => id !== seatId && id !== comp));
        setPdvCompanion(false);
        return;
      }
      if (pdvCompanion && pdvTipoOfSeat(seatId) === 'acompanhante') setPdvCompanion(false);
      setPdvSelectedSeats(prev.filter(id => id !== seatId));
      return;
    }
    if (seatStatuses[seatId]?.status !== 'livre') return;
    if (prev.length >= pdvTotalQty) return;
    setPdvSelectedSeats([...prev, seatId]);
  };

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
      if (eventId) await load(eventId);
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
          buyer_phone: unmaskTelefoneBR(courtesyForm.phone) || undefined,
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
      if (eventId) await load(eventId);
    } catch (e: any) {
      setCourtesyError(e.message ?? String(e));
    } finally {
      setCourtesySaving(false);
    }
  };

  // ─── Venda no balcão (PDV) ────────────────────────────────────────────────
  const resolveDisplayPreco = (t: TicketTypeConfig): number => {
    const lotes = Array.isArray(t.lotes) ? t.lotes : [];
    if (lotes.length > 0) {
      const todayISO = new Date().toISOString().slice(0, 10);
      const idx = lotes.findIndex(l => !l.data_virada || l.data_virada >= todayISO);
      return Number((idx >= 0 ? lotes[idx] : lotes[lotes.length - 1])?.preco ?? 0);
    }
    return Number(t.preco ?? 0);
  };

  const handleSellPdv = async () => {
    if (!eventId || pdvSaving) return;
    setPdvError(null);
    const cpf = unmaskCpfCnpj(pdvForm.cpf);
    if (!pdvForm.name.trim() || !pdvForm.email.trim() || cpf.length !== 11) {
      setPdvError('Preencha nome, e-mail e CPF válido.');
      return;
    }
    if (seatMapEnabled && pdvSelectedSeats.length !== pdvTotalQty) {
      setPdvError(`Escolha exatamente ${pdvTotalQty} assento(s).`);
      return;
    }
    // PCD + acompanhante: 2 itens na mesma venda; assentos na ordem dos itens (PCD primeiro).
    const orderedSeats = pdvCompOn
      ? [...pdvSelectedSeats.filter(id => pdvTipoOfSeat(id) !== 'acompanhante'), ...pdvSelectedSeats.filter(id => pdvTipoOfSeat(id) === 'acompanhante')]
      : pdvSelectedSeats;
    setPdvSaving(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('create-pdv-ticket', {
        body: {
          event_id: eventId,
          ...(pdvCompOn
            ? { items: [
                { ticket_type_idx: pdvTypeIdx, quantity: pdvQuantity },
                { ticket_type_idx: pdvCompanionTypeIdx, quantity: 1 },
              ] }
            : { ticket_type_idx: pdvTypeIdx, quantity: pdvQuantity }),
          buyer: {
            name: pdvForm.name.trim(),
            email: pdvForm.email.trim(),
            cpf,
            phone: unmaskTelefoneBR(pdvForm.phone) || undefined,
          },
          payment_method: pdvMethod,
          ...(seatMapEnabled ? { seat_ids: orderedSeats } : {}),
        },
      });
      if (invokeErr) {
        let serverMsg: string | null = null;
        try {
          const resp = (invokeErr as any).context?.response;
          if (resp && typeof resp.json === 'function') serverMsg = (await resp.json())?.error ?? null;
        } catch { /* ignore */ }
        throw new Error(serverMsg ?? invokeErr.message ?? 'Falha ao vender ingresso');
      }
      if (data?.error) {
        if (Array.isArray(data.occupied_seats) && data.occupied_seats.length > 0) {
          setPdvSelectedSeats(prev => prev.filter((id: string) => !data.occupied_seats.includes(id)));
        }
        throw new Error(data.error);
      }
      const ticket = data.tickets?.[0];
      setPdvResult({
        ticketId: ticket.id,
        accessToken: ticket.access_token,
        paymentMethod: data.payment_method,
        status: data.status_pagamento,
        pix: data.pix,
      });
      if (eventId) await load(eventId);
    } catch (e: any) {
      setPdvError(e.message ?? String(e));
    } finally {
      setPdvSaving(false);
    }
  };

  // Pedidos com ingresso confirmado (1 e-mail por pedido, igual à edge function).
  const sessionBuyers = useMemo(() => {
    const orders = new Set<string>();
    for (const r of rows) {
      if (r.status_pagamento !== 'APROVADO' || r.refunded_at || !r.buyer_email) continue;
      orders.add(r.group_id ?? `solo:${r.id}`);
    }
    return orders.size;
  }, [rows]);

  // Pedidos (1 por group_id) da sessão adiada/cancelada, agrupados pela escolha do comprador.
  const sessionPanel = useMemo(() => {
    const orders = new Map<string, Row[]>();
    for (const r of rows) {
      if (['PENDENTE', 'CANCELADO', 'VENCIDO', 'CORTESIA'].includes(r.status_pagamento)) continue;
      const key = r.group_id ?? `solo:${r.id}`;
      orders.set(key, [...(orders.get(key) ?? []), r]);
    }
    const total = (list: Row[]) => list.reduce((s, r) => s + Number(r.preco ?? 0) + (r.fee_mode === 'repassar' ? Number(r.commission_amount ?? 0) : 0), 0);
    let manter = 0, credito = 0, estornados = 0, semEscolha = 0, restituicaoPendente = 0, falhas = 0, semPagamento = 0;
    let valorSemEscolha = 0, valorPendente = 0;
    for (const list of orders.values()) {
      const st = list[0].status_pagamento;
      const escolha = list[0].sessao_escolha ?? null;
      if (st === 'CREDITO') credito++;
      else if (st === 'ESTORNADO') estornados++;
      else if (st === 'APROVADO' && !list[0].payment_id) semPagamento++; // cortesia/balcão: sem cobrança Asaas pra estornar
      else if (st === 'APROVADO' && escolha === 'restituicao') { restituicaoPendente++; valorPendente += total(list); if (list[0].sessao_escolha_erro) falhas++; }
      else if (st === 'APROVADO' && escolha === 'manter') manter++;
      else if (st === 'APROVADO') { semEscolha++; valorSemEscolha += total(list); }
    }
    return { manter, credito, estornados, semEscolha, restituicaoPendente, falhas, semPagamento, valorSemEscolha, valorPendente };
  }, [rows]);

  const runBulkRefund = async (mode: 'pedidos' | 'todos') => {
    if (!eventId || bulkRunning) return;
    setBulkRunning(true);
    setBulkError(null);
    setBulkResult(null);
    const skip: string[] = [];
    const acc = { refunded: 0, failed: 0, skipped_used: 0, failures: [] as Array<{ buyer: string | null; error: string }> };
    try {
      for (let i = 0; i < 20; i++) {
        const { data, error: invokeErr } = await supabase.functions.invoke('refund-session-orders', {
          body: { event_id: eventId, mode, skip_orders: skip },
        });
        if (invokeErr) throw new Error(await edgeErrorMessage(invokeErr, 'Não foi possível processar as restituições.'));
        if (data?.error) throw new Error(data.error);
        acc.refunded += data.refunded ?? 0;
        acc.failed += data.failed ?? 0;
        acc.skipped_used = Math.max(acc.skipped_used, (data.skipped_used ?? []).length);
        for (const fl of (data.failures ?? [])) { skip.push(fl.order_id); acc.failures.push({ buyer: fl.buyer, error: fl.error }); }
        if (!data.remaining) break;
      }
      setBulkResult(acc);
      setBulkConfirm(null);
    } catch (e: any) {
      setBulkError(e.message ?? String(e));
      setBulkResult(acc);
    } finally {
      setBulkRunning(false);
      if (selectedEventId) void load(selectedEventId);
    }
  };

  const openSessionModal = () => {
    setSessionError(null);
    setSessionResult(null);
    setSessionConfirmed(false);
    setSessionForm({ status: 'adiada', nova_data: '', nova_hora: sessionInfo.event_time?.slice(0, 5) ?? '', motivo: '' });
    setSessionOpen(true);
  };

  const handleSessionChange = async () => {
    if (!eventId || sessionSaving) return;
    setSessionSaving(true);
    setSessionError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('update-session-status', {
        body: {
          event_id: eventId,
          status: sessionForm.status,
          nova_data: sessionForm.status === 'adiada' ? sessionForm.nova_data : undefined,
          nova_hora: sessionForm.status === 'adiada' ? (sessionForm.nova_hora || undefined) : undefined,
          motivo: sessionForm.status === 'agendada' ? undefined : sessionForm.motivo,
        },
      });
      if (invokeErr) throw new Error(await edgeErrorMessage(invokeErr, 'Não foi possível atualizar a sessão.'));
      if (data?.error) throw new Error(data.error);
      setSessionResult({ notified: data?.notified ?? 0, failed: data?.failed ?? 0, no_email: data?.no_email ?? 0 });
      if (selectedEventId) void load(selectedEventId);
    } catch (e: any) {
      setSessionError(e.message ?? String(e));
    } finally {
      setSessionSaving(false);
    }
  };

  const closePdvModal = () => {
    setPdvOpen(false);
    setPdvResult(null);
    setPdvError(null);
    setPdvForm({ name: '', email: '', cpf: '', phone: '' });
    setPdvTypeIdx(0);
    setPdvQuantity(1);
    setPdvMethod('pix');
    setPdvSelectedSeats([]); setPdvCompanion(false);
  };

  // Enquanto o PIX no balcão está PENDENTE, o realtime (assinatura já
  // existente logo acima) atualiza `rows` sozinho quando o webhook confirma
  // — aqui só refletimos isso dentro do modal aberto, sem polling extra.
  const pdvLiveRow = pdvResult ? rows.find(r => r.id === pdvResult.ticketId) : undefined;
  const pdvConfirmed = pdvResult?.paymentMethod === 'cartao_tap' || pdvLiveRow?.status_pagamento === 'APROVADO';

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
        <div className="flex items-center gap-2 flex-wrap">
          {allEvents.length > 0 && (
            <EventPickerSheet
              events={allEvents}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
              className="w-full sm:w-auto"
            />
          )}
          <button
            onClick={() => selectedEventId && load(selectedEventId)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10"
          >
            <RotateCcw size={12} /> Atualizar
          </button>
          <button
            onClick={() => { setCourtesyError(null); setCourtesyOpen(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-500/10 border border-violet-500/30 text-violet-600 dark:text-violet-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-500/20"
          >
            <Users size={12} /> Adicionar cortesia
          </button>
          <button
            onClick={openSessionModal}
            disabled={!eventId}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-500/20 disabled:opacity-40"
          >
            <CalendarClock size={12} /> {sessionInfo.status === 'agendada' ? 'Cancelar ou adiar sessão' : 'Alterar aviso da sessão'}
          </button>
          <button
            onClick={() => { setPdvError(null); setPdvOpen(true); }}
            disabled={ticketTypes.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500/20 disabled:bg-slate-100 dark:disabled:bg-white/5 disabled:border-slate-200 dark:disabled:border-white/10 disabled:text-slate-400 dark:disabled:text-slate-500"
          >
            <Store size={12} /> Vender no balcão
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

      {/* Escolhas dos compradores numa sessão adiada/cancelada + restituição em lote (Decreto 13.108 arts. 20-22) */}
      {sessionInfo.status !== 'agendada' && (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <CalendarClock size={12} /> Sessão {sessionInfo.status === 'cancelada' ? 'cancelada' : 'adiada'}: escolhas dos compradores
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {([
              ['Sem resposta', sessionPanel.semEscolha],
              ...(sessionInfo.status === 'adiada' ? [['Mantiveram', sessionPanel.manter]] : []),
              ['Em crédito', sessionPanel.credito],
              ['Restituição pedida', sessionPanel.restituicaoPendente],
              ['Estornados', sessionPanel.estornados],
            ] as Array<[string, number]>).map(([label, n]) => (
              <div key={label} className="bg-slate-50 dark:bg-white/5 rounded-xl py-2 px-1">
                <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{n}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
              </div>
            ))}
          </div>
          {sessionPanel.semPagamento > 0 && (
            <p className="text-xs text-slate-500">{sessionPanel.semPagamento} pedido(s) sem cobrança na plataforma (cortesia ou venda no balcão): não entram no estorno em lote; devolva por fora, se for o caso.</p>
          )}
          {sessionPanel.falhas > 0 && (
            <p className="text-xs text-rose-600 dark:text-rose-300 flex items-start gap-1.5"><AlertCircle size={12} className="mt-0.5 shrink-0" /> {sessionPanel.falhas} restituição(ões) falharam no Asaas. Reprocesse abaixo; se persistir, confira o saldo da conta.</p>
          )}

          {bulkConfirm ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2 text-xs text-amber-800 dark:text-amber-200">
              <p>
                {bulkConfirm === 'pedidos'
                  ? `Estornar ${sessionPanel.restituicaoPendente} pedido(s) que pediram restituição, total de ${formatBRL(sessionPanel.valorPendente)} (com as taxas).`
                  : `Estornar ${sessionPanel.semEscolha + sessionPanel.restituicaoPendente} pedido(s), total de ${formatBRL(sessionPanel.valorSemEscolha + sessionPanel.valorPendente)} (com as taxas), incluindo quem não respondeu. Quem já usou o ingresso na entrada é pulado.`}
                {' '}O estorno sai da sua conta Asaas e não pode ser desfeito.
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={bulkRunning} onClick={() => setBulkConfirm(null)} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-white/10 text-[10px] font-black uppercase tracking-widest">Voltar</button>
                <button type="button" disabled={bulkRunning} onClick={() => runBulkRefund(bulkConfirm)} className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1.5 disabled:opacity-50">
                  {bulkRunning ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} {bulkRunning ? 'Estornando...' : 'Confirmar estorno'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={sessionPanel.restituicaoPendente === 0} onClick={() => { setBulkResult(null); setBulkError(null); setBulkConfirm('pedidos'); }}
                className="px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[10px] font-black uppercase tracking-widest disabled:opacity-40">
                Processar restituições pedidas ({sessionPanel.restituicaoPendente})
              </button>
              {sessionInfo.status === 'cancelada' && (
                <button type="button" disabled={sessionPanel.semEscolha + sessionPanel.restituicaoPendente === 0} onClick={() => { setBulkResult(null); setBulkError(null); setBulkConfirm('todos'); }}
                  className="px-4 py-2 rounded-xl bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40">
                  Restituir todos ({sessionPanel.semEscolha + sessionPanel.restituicaoPendente})
                </button>
              )}
            </div>
          )}

          {bulkError && <p className="text-xs text-rose-600 dark:text-rose-300 flex items-start gap-1.5"><AlertCircle size={12} className="mt-0.5 shrink-0" /> {bulkError}</p>}
          {bulkResult && (
            <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
              <p>Estornados agora: <strong>{bulkResult.refunded}</strong>{bulkResult.failed > 0 && <> · falharam: <strong>{bulkResult.failed}</strong></>}{bulkResult.skipped_used > 0 && <> · pulados (já usaram o ingresso): <strong>{bulkResult.skipped_used}</strong></>}</p>
              {bulkResult.failures.slice(0, 5).map((fl, i) => <p key={i} className="text-rose-600 dark:text-rose-300">{fl.buyer ?? 'Comprador'}: {fl.error}</p>)}
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-300 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric icon={Ticket} label="Vendidos" value={String(metrics.aprovados)} sub={`${metrics.pendentes} pendentes`} tone="neutral" />
        <Metric icon={DollarSign} label="Total bruto" value={formatBRL(metrics.totalBruto)} sub={`Líquido ${formatBRL(metrics.totalLiquido)}`} />
        <Metric icon={Users} label="Check-ins" value={`${metrics.checkedIn} / ${metrics.aprovados}`} sub="presenças confirmadas" tone="neutral" />
        <Metric icon={Clock} label="Pendentes" value={String(metrics.pendentes)} sub="aguardando pagamento" tone="warn" />
      </div>

      {/* Mapa de assentos (Fase 2 — só eventos com seat_map_enabled) */}
      {seatMapEnabled && (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-wrap items-center gap-3">
          <Armchair size={18} className="text-slate-400 shrink-0" />
          <p className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Assentos</p>
          <div className="flex-1 flex flex-wrap items-center gap-4 text-xs">
            <span className="text-slate-500">
              <strong className="text-slate-900 dark:text-white">{seatSummary.vendido}</strong> vendidos
            </span>
            <span className="text-slate-500">
              <strong className="text-amber-600 dark:text-amber-400">{seatSummary.reservado}</strong> reservados
            </span>
            <span className="text-slate-500">
              <strong className="text-emerald-600 dark:text-emerald-400">{seatSummary.livre}</strong> livres
            </span>
            <span className="text-slate-400">de {seatSummary.total} no total</span>
          </div>
        </div>
      )}

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
                      {r.seat_id && (
                        <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          Lugar {r.seat_id}
                          {SEAT_TIPO_LABEL[seatTipoFromLayout(rowsConfig, r.seat_id)] && (
                            <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 text-[9px] uppercase tracking-widest">
                              {seatTipoFromLayout(rowsConfig, r.seat_id) === 'acompanhante' ? 'Acompanhante' : 'PCD'}
                            </span>
                          )}
                        </p>
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
          <div className="px-4 py-2 border-t border-slate-200 dark:border-white/10 flex items-center justify-center">
            <AsaasBadge variant="compact" width={100} height={30} />
          </div>
        </div>
      )}

      {/* Modal de reembolso (Tier 2) */}
      {courtesyOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="courtesy-modal-title">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 id="courtesy-modal-title" className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
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
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="courtesy-name" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Nome</label>
                <input
                  id="courtesy-name"
                  value={courtesyForm.name}
                  onChange={e => setCourtesyForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="courtesy-email" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">E-mail</label>
                <input
                  id="courtesy-email"
                  type="email"
                  value={courtesyForm.email}
                  onChange={e => setCourtesyForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                />
              </div>
              <div>
                <label htmlFor="courtesy-cpf" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">CPF</label>
                <input
                  id="courtesy-cpf"
                  value={courtesyForm.cpf}
                  onChange={e => setCourtesyForm(f => ({ ...f, cpf: maskCpfCnpj(e.target.value) }))}
                  placeholder="000.000.000-00"
                  className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                />
              </div>
              <div>
                <label htmlFor="courtesy-phone" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">WhatsApp (opcional)</label>
                <input
                  id="courtesy-phone"
                  value={courtesyForm.phone}
                  onChange={e => setCourtesyForm(f => ({ ...f, phone: maskTelefoneBR(e.target.value) }))}
                  placeholder="(00) 00000-0000"
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
                className="flex-1 py-3 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white rounded-xl text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-2"
              >
                {courtesySaving ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                {courtesySaving ? 'Salvando...' : 'Adicionar cortesia'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de venda no balcão (PDV) */}
      {pdvOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="pdv-modal-title">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5 max-h-[92dvh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 id="pdv-modal-title" className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                  Vender no balcão
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {pdvResult ? 'Ingresso gerado' : 'Recepção com o comprador na frente — sem passar pelo checkout online'}
                </p>
              </div>
              <button
                type="button"
                onClick={closePdvModal}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
                disabled={pdvSaving}
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {!pdvResult ? (
              <>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="pdv-type" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Tipo de ingresso</label>
                    <select
                      id="pdv-type"
                      value={pdvTypeIdx}
                      onChange={e => { setPdvTypeIdx(Number(e.target.value)); setPdvSelectedSeats([]); setPdvCompanion(false); }}
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white dark:[color-scheme:dark] focus:outline-none focus:border-[#ff0068]/50"
                    >
                      {ticketTypes.map((t, idx) => (
                        <option key={idx} value={idx}>{t.nome} — {formatBRL(resolveDisplayPreco(t))}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pdv-qty" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Quantidade</label>
                    <input
                      id="pdv-qty"
                      type="number"
                      min={1}
                      max={20}
                      value={pdvQuantity}
                      onChange={e => {
                        const q = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                        setPdvQuantity(q);
                        setPdvCompanion(false);
                        setPdvSelectedSeats(prev => prev.filter(id => pdvTipoOfSeat(id) !== 'acompanhante' || pdvSeatKind === 'acompanhante').slice(0, q));
                      }}
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                    />
                  </div>

                  {seatMapEnabled && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                          <Armchair size={12} /> Escolher lugar
                        </span>
                        <span className="text-[10px] text-slate-500">{pdvSelectedSeats.length}/{pdvTotalQty}</span>
                      </div>
                      <div className="border border-slate-200 dark:border-white/10 rounded-xl p-2">
                        <SeatGrid
                          rowsConfig={rowsConfig}
                          seatStatuses={seatStatuses}
                          selectedSeats={pdvSelectedSeats}
                          onToggle={togglePdvSeat}
                          size="sm"
                          variant="auto"
                          pcdQty={pdvPcdQty}
                          compQty={pdvCompQty}
                          comumQty={pdvComumQty}
                          onBlocked={setPdvError}
                        />
                        <SeatLegend rowsConfig={rowsConfig} variant="auto" />
                      </div>
                      {pdvCompanionOffer && (
                        <div className="mt-2 flex items-center gap-3 bg-sky-500/10 border border-sky-500/30 rounded-xl p-3 text-xs text-sky-700 dark:text-sky-200">
                          <p className="flex-1">
                            <strong>Vai com acompanhante?</strong> O lugar {pdvCompanionOffer.comp}, ao lado do {pdvCompanionOffer.special}, está reservado para ele. Sai na mesma venda.
                          </p>
                          <button
                            type="button"
                            onClick={addPdvCompanion}
                            className="px-3 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-[10px] font-black uppercase tracking-widest cursor-pointer"
                          >
                            Adicionar acompanhante
                          </button>
                        </div>
                      )}
                      {pdvCompOn && (
                        <p className="mt-2 text-[11px] text-sky-700 dark:text-sky-300">
                          Venda com acompanhante: {pdvQuantity}× PCD + 1× {ticketTypes[pdvCompanionTypeIdx as number]?.nome}.
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label htmlFor="pdv-name" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Nome do comprador</label>
                    <input
                      id="pdv-name"
                      value={pdvForm.name}
                      onChange={e => setPdvForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label htmlFor="pdv-email" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">E-mail</label>
                    <input
                      id="pdv-email"
                      type="email"
                      value={pdvForm.email}
                      onChange={e => setPdvForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                    />
                  </div>
                  <div>
                    <label htmlFor="pdv-cpf" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">CPF</label>
                    <input
                      id="pdv-cpf"
                      value={pdvForm.cpf}
                      onChange={e => setPdvForm(f => ({ ...f, cpf: maskCpfCnpj(e.target.value) }))}
                      placeholder="000.000.000-00"
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                    />
                  </div>
                  <div>
                    <label htmlFor="pdv-phone" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">WhatsApp (opcional)</label>
                    <input
                      id="pdv-phone"
                      value={pdvForm.phone}
                      onChange={e => setPdvForm(f => ({ ...f, phone: maskTelefoneBR(e.target.value) }))}
                      placeholder="(00) 00000-0000"
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Forma de pagamento</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPdvMethod('pix')}
                        className={`py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border ${
                          pdvMethod === 'pix'
                            ? 'bg-[#ff0068] border-[#ff0068] text-white'
                            : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Pix (QR na tela)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPdvMethod('cartao_tap')}
                        className={`py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border ${
                          pdvMethod === 'cartao_tap'
                            ? 'bg-[#ff0068] border-[#ff0068] text-white'
                            : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Cartão (débito/crédito)
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      {pdvMethod === 'pix'
                        ? 'Gera um QR Pix pra mostrar na tela. Confirma sozinho quando o cliente pagar — comissão normal.'
                        : 'Cobre na sua própria maquininha (Asaas Tap, Stone, Cielo, PagSeguro etc.) e só confirme aqui pra registrar. Sem comissão CoreoHub — o pagamento não passa pelo split.'}
                    </p>
                  </div>
                </div>

                {pdvError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-300 flex items-start gap-2" aria-live="polite">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{pdvError}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closePdvModal}
                    disabled={pdvSaving}
                    className="flex-1 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[11px] font-black uppercase tracking-widest"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSellPdv}
                    disabled={pdvSaving || ticketTypes.length === 0 || (seatMapEnabled && pdvSelectedSeats.length !== pdvTotalQty)}
                    className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-xl text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-2"
                  >
                    {pdvSaving ? <Loader2 size={14} className="animate-spin" /> : <Store size={14} />}
                    {pdvSaving ? 'Gerando...' : pdvMethod === 'pix' ? 'Gerar QR Pix' : 'Confirmar venda'}
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                {pdvResult.paymentMethod === 'pix' && !pdvConfirmed && (
                  <div className="text-center space-y-3">
                    {pdvResult.pix?.encodedImage ? (
                      <img
                        src={`data:image/png;base64,${pdvResult.pix.encodedImage}`}
                        alt="QR Code Pix"
                        className="w-56 h-56 mx-auto rounded-xl border border-slate-200 dark:border-white/10"
                      />
                    ) : (
                      <div className="w-56 h-56 mx-auto rounded-xl border border-dashed border-slate-300 dark:border-white/10 flex items-center justify-center">
                        <QrCode size={40} className="text-slate-400" />
                      </div>
                    )}
                    {pdvResult.pix?.payload && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(pdvResult.pix!.payload!);
                          setPdvCopied(true);
                          setTimeout(() => setPdvCopied(false), 2000);
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300"
                      >
                        <Copy size={12} /> {pdvCopied ? 'Copiado!' : 'Copiar código Pix'}
                      </button>
                    )}
                    <p className="text-xs text-slate-500 flex items-center justify-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" /> Aguardando pagamento do cliente...
                    </p>
                  </div>
                )}

                {pdvConfirmed && (
                  <div className="text-center space-y-3">
                    <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 size={28} className="text-emerald-500" />
                    </div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {pdvResult.paymentMethod === 'cartao_tap' ? 'Venda confirmada!' : 'Pagamento recebido!'}
                    </p>
                    <a
                      href={`/meu-ingresso/${pdvResult.accessToken}?print=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#ff0068] text-white rounded-xl text-[11px] font-black uppercase tracking-widest"
                    >
                      <Printer size={14} /> Abrir ingresso pra imprimir
                    </a>
                  </div>
                )}

                <button
                  type="button"
                  onClick={closePdvModal}
                  className="w-full py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[11px] font-black uppercase tracking-widest"
                >
                  {pdvConfirmed ? 'Fechar' : 'Fechar (continua aguardando em segundo plano)'}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Cancelar / adiar sessão (Decreto 13.108 arts. 20-22): grava por edge function e avisa os compradores por e-mail */}
      {sessionOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="session-modal-title">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[92dvh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 id="session-modal-title" className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
                  Cancelar ou adiar sessão
                </h3>
                <p className="text-xs text-slate-500 mt-1">{eventName}</p>
              </div>
              <button type="button" onClick={() => setSessionOpen(false)} disabled={sessionSaving} aria-label="Fechar" className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                <X size={18} />
              </button>
            </div>

            {sessionResult ? (
              <div className="space-y-4">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-sm text-emerald-700 dark:text-emerald-300 space-y-1">
                  <p className="font-bold">Sessão atualizada.</p>
                  <p>Avisos enviados: <strong>{sessionResult.notified}</strong>{sessionResult.failed > 0 && <> · falharam: <strong>{sessionResult.failed}</strong></>}{sessionResult.no_email > 0 && <> · ingressos sem e-mail: <strong>{sessionResult.no_email}</strong></>}</p>
                  {sessionResult.failed > 0 && <p className="text-xs">Os avisos que falharam precisam ser reenviados: fale com o suporte.</p>}
                </div>
                <button type="button" onClick={() => setSessionOpen(false)} className="w-full py-3 bg-[#ff0068] text-white rounded-xl text-[11px] font-black uppercase tracking-widest">Fechar</button>
              </div>
            ) : (
              <>
                <fieldset className="space-y-2">
                  <legend className="sr-only">O que aconteceu com a sessão</legend>
                  {([
                    ['adiada', 'Adiar para outra data'],
                    ['cancelada', 'Cancelar a sessão'],
                    ...(sessionInfo.status !== 'agendada' ? [['agendada', 'Desfazer: a sessão está mantida']] : []),
                  ] as Array<[string, string]>).map(([value, label]) => (
                    <label key={value} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer text-sm font-bold ${sessionForm.status === value ? 'border-[#ff0068] bg-[#ff0068]/10 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300'}`}>
                      <input type="radio" name="session-status" checked={sessionForm.status === value} onChange={() => setSessionForm(f => ({ ...f, status: value as any }))} className="accent-[#ff0068]" />
                      {label}
                    </label>
                  ))}
                </fieldset>

                {sessionForm.status === 'adiada' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="session-date" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Nova data</label>
                      <input id="session-date" type="date" value={sessionForm.nova_data} onChange={e => setSessionForm(f => ({ ...f, nova_data: e.target.value }))}
                        className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white dark:[color-scheme:dark] focus:outline-none focus:border-[#ff0068]/50" />
                    </div>
                    <div>
                      <label htmlFor="session-time" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Horário</label>
                      <input id="session-time" type="time" value={sessionForm.nova_hora} onChange={e => setSessionForm(f => ({ ...f, nova_hora: e.target.value }))}
                        className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white dark:[color-scheme:dark] focus:outline-none focus:border-[#ff0068]/50" />
                    </div>
                  </div>
                )}

                {sessionForm.status !== 'agendada' && (
                  <div>
                    <label htmlFor="session-motivo" className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Motivo (vai no aviso aos compradores)</label>
                    <textarea id="session-motivo" rows={3} maxLength={500} value={sessionForm.motivo} onChange={e => setSessionForm(f => ({ ...f, motivo: e.target.value }))}
                      placeholder="Ex.: indisponibilidade do teatro na data original"
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50" />
                  </div>
                )}

                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <p><strong>{sessionBuyers}</strong> pedido{sessionBuyers === 1 ? '' : 's'} com ingresso confirmado {sessionBuyers === 1 ? 'receberá' : 'receberão'} um e-mail agora.</p>
                  {sessionForm.status === 'cancelada' && <p>As vendas desta sessão serão encerradas. Os compradores têm direito à restituição integral, com as taxas (Decreto 13.108/2026, arts. 20 a 22); as escolhas chegam por e-mail e você as processa pelo botão de estorno de cada ingresso.</p>}
                  {sessionForm.status === 'adiada' && <p>Os ingressos continuam valendo para a nova data. Quem preferir crédito ou restituição integral, com as taxas, responderá o e-mail.</p>}
                </div>

                <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={sessionConfirmed} onChange={e => setSessionConfirmed(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#ff0068]" />
                  Entendo que os compradores serão avisados por e-mail agora.
                </label>

                {sessionError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-300 flex items-start gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" /><span>{sessionError}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setSessionOpen(false)} disabled={sessionSaving} className="flex-1 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-[11px] font-black uppercase tracking-widest">Voltar</button>
                  <button type="button" onClick={handleSessionChange} disabled={sessionSaving || !sessionConfirmed}
                    className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-400 text-white rounded-xl text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-2">
                    {sessionSaving ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                    {sessionSaving ? 'Enviando avisos...' : 'Confirmar e avisar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
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
                {detailRow.seat_id && (
                  <Field
                    label="Lugar"
                    value={`${detailRow.seat_id}${SEAT_TIPO_LABEL[seatTipoFromLayout(rowsConfig, detailRow.seat_id)] ? ` — ${SEAT_TIPO_LABEL[seatTipoFromLayout(rowsConfig, detailRow.seat_id)]}` : ''}`}
                  />
                )}
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

// `tone`: rosa só pro número-estrela do card (dinheiro); âmbar pra pendência
// real; cinza neutro pro resto — evita todo ícone de métrica virar rosa sem
// motivo (achado 2026-08-08/09).
const Metric: React.FC<{ icon: any; label: string; value: string; sub?: string; tone?: 'brand' | 'neutral' | 'warn' }> = ({ icon: Icon, label, value, sub, tone = 'brand' }) => (
  <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
    <div className={`p-2 rounded-xl inline-flex mb-2 ${
      tone === 'warn'    ? 'bg-amber-500/10 text-amber-500' :
      tone === 'neutral' ? 'bg-slate-200/60 dark:bg-white/10 text-slate-500 dark:text-slate-400' :
                            'bg-[#ff0068]/10 text-[#ff0068]'
    }`}>
      <Icon size={16} aria-hidden />
    </div>
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
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
    CREDITO:   { label: 'Crédito',    cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',   icon: Ticket },
    VENCIDO:   { label: 'Vencido',    cls: 'bg-slate-500/10 text-slate-500',                          icon: XCircle },
    CORTESIA:  { label: 'Cortesia',   cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',   icon: CheckCircle2 },
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
