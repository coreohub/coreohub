import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchSeatTipo, SEAT_TIPO_LABEL } from '../utils/seatTipo';
import {
  Search, CheckCircle2, User, QrCode, RefreshCw,
  X, AlertCircle, Clock, DollarSign, Music2, Armchair, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';
import { trackFeatureUsed } from '../services/appAnalytics';
import { isRegistrationPaid, SCHEDULABLE_REGISTRATIONS_OR_FILTER } from '../utils/registrationStatus';
import PageHeader from '../components/PageHeader';
import { PermissoesCustom } from '../types';
import { useMyPermissions } from '../hooks/usePermission';
import { checkTicketSession, sessionText, type SessionInfo } from '../utils/checkinSession';
import { parseSeatInput } from '../utils/seatBlock';

type ScanKind = 'INSCRITO' | 'INGRESSO' | 'WORKSHOP' | 'EQUIPE' | 'JURADO';

const SCAN_KIND_LABEL: Record<ScanKind, string> = {
  INSCRITO: 'Inscrito', INGRESSO: 'Ingresso', WORKSHOP: 'Workshop', EQUIPE: 'Equipe', JURADO: 'Jurado',
};
const SCAN_KIND_PERM: Record<ScanKind, keyof PermissoesCustom> = {
  INSCRITO: 'checkin_inscritos', INGRESSO: 'checkin_ingressos', WORKSHOP: 'checkin_workshops',
  EQUIPE: 'checkin_equipe', JURADO: 'checkin_jurados',
};

interface CheckInItem {
  id: string;
  nome_coreografia: string;
  estudio?: string;
  status_pagamento: string;
  status_trilha?: string;
  trilha_url?: string;
  check_in_status?: string;
  check_in_at?: string;
  excluded_from_schedule?: boolean;
}

type FilterTab = 'TODOS' | 'PENDENTE' | 'OK';

interface TicketRow {
  id: string;
  event_id: string;
  ticket_type_nome: string | null;
  ticket_type_kind?: string | null;
  buyer_name: string;
  status_pagamento: string;
  check_in_status: string | null;
  check_in_at: string | null;
  seat_id: string | null;
  qr_code: string | null;
}
const TICKET_COLS = 'id, event_id, ticket_type_nome, ticket_type_kind, buyer_name, status_pagamento, check_in_status, check_in_at, seat_id, qr_code';
const SESSION_COLS = 'id, name, start_date, end_date, event_time, session_group_id, sessao_status';
const PAID_TICKET = ['APROVADO', 'CORTESIA'];

const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
    ok ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  }`}>
    {label}
  </span>
);

const CheckIn = () => {
  const [items, setItems] = useState<CheckInItem[]>([]);
  const [filtered, setFiltered] = useState<CheckInItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('TODOS');

  /* QR scanner */
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanResult, setScanResult] = useState<{
    type: 'success' | 'error' | 'duplicate';
    message: string;
    name?: string;
    kind?: ScanKind;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const scanSessionRef = useRef(0); // cada abertura do scanner tem um token; stop invalida os awaits pendentes
  const [cameraMsg, setCameraMsg] = useState<string | null>(null);
  // Ingresso de outra sessão/dia: o operador decide (liberar mesmo assim ou não).
  const [pending, setPending] = useState<{ ticket: TicketRow; message: string } | null>(null);
  const [ticketStats, setTicketStats] = useState<Array<{ id: string; label: string; total: number; entered: number }>>([]);
  const [ticketQuery, setTicketQuery] = useState('');
  const [ticketHits, setTicketHits] = useState<TicketRow[]>([]);
  const [ticketSearching, setTicketSearching] = useState(false);
  const [busyTicket, setBusyTicket] = useState<string | null>(null);
  const [sessionLabels, setSessionLabels] = useState<Record<string, string>>({});
  const sessionCache = useRef(new Map<string, { info: SessionInfo | null; siblings: SessionInfo[]; failed: boolean }>());

  /* ── minhas permissões ── */
  const { has: hasPerm, loading: permsLoading } = useMyPermissions();
  const canScan = useCallback((kind: ScanKind) => hasPerm(SCAN_KIND_PERM[kind]), [hasPerm]);
  const hasInscritosAccess = hasPerm('checkin_inscritos');

  /* ── fetch ── */
  const fetchData = useCallback(async () => {
    if (!permsLoading && !hasInscritosAccess) { setLoading(false); return; }
    setLoading(true);
    try {
      // Mesmo filtro do Cronograma (Schedule.tsx): só inscrição PAGA (status_pagamento
      // APROVADO/CONFIRMADO — cobre eventos gratuitos) OU já aprovada manualmente
      // (status='APROVADA'), e nunca a que o produtor removeu do cronograma.
      const { data, error } = await supabase
        .from('registrations')
        .select('id,nome_coreografia,estudio,status_pagamento,status_trilha,trilha_url,check_in_status,check_in_at,excluded_from_schedule')
        .or(SCHEDULABLE_REGISTRATIONS_OR_FILTER)
        .order('nome_coreografia', { ascending: true });
      if (error) throw error;
      setItems((data || []).filter((r: CheckInItem) => !r.excluded_from_schedule));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [permsLoading, hasInscritosAccess]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── sessão de um ingresso (cada sessão é um evento; irmãs = mesmo session_group_id) ── */
  const loadSession = useCallback(async (eventId: string) => {
    const hit = sessionCache.current.get(eventId);
    if (hit) return hit;
    const { data: ev, error } = await supabase.from('events').select(SESSION_COLS).eq('id', eventId).maybeSingle();
    if (error) console.error('[CheckIn] sessão do ingresso:', error.message);
    let siblings: SessionInfo[] = [];
    if (ev?.session_group_id) {
      const { data: sib, error: sibErr } = await supabase.from('events').select(SESSION_COLS).eq('session_group_id', ev.session_group_id);
      if (sibErr) console.error('[CheckIn] sessões irmãs:', sibErr.message);
      siblings = (sib ?? []) as SessionInfo[];
    }
    const out = { info: (ev ?? null) as SessionInfo | null, siblings: siblings.length > 0 ? siblings : ev ? [ev as SessionInfo] : [], failed: Boolean(error) || !ev };
    // Falha de leitura (rede ruim, RLS) nunca vai pro cache: a próxima leitura tenta de novo.
    if (!out.failed) sessionCache.current.set(eventId, out);
    return out;
  }, []);

  /* ── quantos ingressos já entraram, por sessão ── */
  const statsReq = useRef(0);
  const fetchTicketStats = useCallback(async () => {
    const req = ++statsReq.current;
    if (permsLoading || !hasPerm('checkin_ingressos')) { setTicketStats([]); return; }
    const rows: Array<{ event_id: string; check_in_status: string | null }> = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await supabase
        .from('audience_tickets')
        .select('event_id, check_in_status')
        .in('status_pagamento', PAID_TICKET)
        .order('id', { ascending: true })
        .range(from, from + 999);
      if (error) { console.error('[CheckIn] contagem de ingressos:', error.message); return; }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const byEvent = new Map<string, { total: number; entered: number }>();
    for (const r of rows) {
      const cur = byEvent.get(r.event_id) ?? { total: 0, entered: 0 };
      cur.total += 1;
      if (r.check_in_status === 'OK') cur.entered += 1;
      byEvent.set(r.event_id, cur);
    }
    const ids = [...byEvent.keys()];
    if (req !== statsReq.current) return;
    if (ids.length === 0) { setTicketStats([]); return; }
    const { data: evs, error: evErr } = await supabase.from('events').select('id, name, start_date, event_time').in('id', ids);
    if (evErr) console.error('[CheckIn] sessões da contagem:', evErr.message);
    const list = (evs ?? []).map(e => ({
      id: e.id as string,
      sort: `${e.start_date ?? ''}${e.event_time ?? ''}`,
      label: sessionText(e as SessionInfo) || (e.name as string),
      ...(byEvent.get(e.id as string) ?? { total: 0, entered: 0 }),
    }));
    list.sort((a, b) => a.sort.localeCompare(b.sort));
    if (req !== statsReq.current) return;
    setTicketStats(list.map(({ id, label, total, entered }) => ({ id, label, total, entered })));
  }, [permsLoading, hasPerm]);

  useEffect(() => { fetchTicketStats(); }, [fetchTicketStats]);

  /* ── busca de comprador/assento (cliente esqueceu o QR) ── */
  useEffect(() => {
    const q = ticketQuery.trim().replace(/[,()%]/g, ' ').trim();
    if (q.length < 2 || !hasPerm('checkin_ingressos')) { setTicketHits([]); setTicketSearching(false); return; }
    setTicketSearching(true);
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const seat = parseSeatInput(q);
      const seatId = seat && seat.row.length <= 2 ? `${seat.row}-${seat.n}` : null;
      let query = supabase.from('audience_tickets').select(TICKET_COLS).in('status_pagamento', PAID_TICKET);
      query = seatId ? query.or(`buyer_name.ilike.%${q}%,seat_id.eq.${seatId}`) : query.ilike('buyer_name', `%${q}%`);
      const { data, error } = await query.order('buyer_name', { ascending: true }).limit(20);
      if (cancelled) return;
      if (error) console.error('[CheckIn] busca de ingresso:', error.message);
      const hits = (data ?? []) as TicketRow[];
      const labels: Record<string, string> = {};
      for (const eid of new Set(hits.map(h => h.event_id))) {
        const { info } = await loadSession(eid);
        labels[eid] = sessionText(info);
      }
      if (cancelled) return;
      setSessionLabels(prev => ({ ...prev, ...labels }));
      setTicketHits(hits);
      setTicketSearching(false);
    }, 300);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [ticketQuery, hasPerm, loadSession]);

  /* ── filter ── */
  useEffect(() => {
    let list = items;
    if (search) {
      const t = search.toLowerCase();
      list = list.filter(i =>
        i.nome_coreografia?.toLowerCase().includes(t) ||
        i.estudio?.toLowerCase().includes(t)
      );
    }
    if (filterTab === 'OK')      list = list.filter(i => i.check_in_status === 'OK');
    if (filterTab === 'PENDENTE') list = list.filter(i => i.check_in_status !== 'OK');
    setFiltered(list);
  }, [items, search, filterTab]);

  /* ── manual check-in toggle ── */
  const handleToggle = async (item: CheckInItem) => {
    if (!isRegistrationPaid(item.status_pagamento)) return;
    const newStatus = item.check_in_status === 'OK' ? null : 'OK';
    const now = newStatus === 'OK' ? new Date().toISOString() : null;

    const { error } = await supabase
      .from('registrations')
      .update({ check_in_status: newStatus, check_in_at: now })
      .eq('id', item.id);
    if (error) { console.error(error); return; }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, check_in_status: newStatus ?? undefined, check_in_at: now ?? undefined } : i));
  };

  /* ── process QR result — tenta resolver em 5 tipos (registration → ticket
        → workshop → profile staff → judge). Primeiro hit ganha. ── */
  const STAFF_ROLES = ['STAFF', 'MESARIO', 'SONOPLASTA', 'RECEPCAO', 'PALCO', 'COORDENADOR'];
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Marca a entrada do ingresso (compare-and-swap) e mostra o resultado com a sessão e o assento.
  const completeTicket = useCallback(async (ticket: TicketRow, sessaoTxt: string) => {
    const now = new Date().toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    // Compare-and-swap: WHERE check_in_status='PENDENTE' fecha a corrida de
    // 2 tablets escaneando o mesmo QR quase junto — só o primeiro UPDATE
    // que chegar bate na cláusula, o segundo já encontra 0 rows.
    const { data: updated, error: upErr } = await supabase
      .from('audience_tickets')
      .update({ check_in_status: 'OK', check_in_at: now, check_in_by: user?.id ?? null })
      .eq('id', ticket.id)
      .eq('check_in_status', 'PENDENTE')
      .select('id');
    if (upErr) {
      setScanResult({ type: 'error', message: `Falha ao marcar: ${upErr.message}`, name: ticket.buyer_name, kind: 'INGRESSO' });
      return;
    }
    // 0 rows pode ser: (a) outro operador escaneou o mesmo QR nesse
    // intervalo (perdeu a corrida) ou (b) RLS bloqueou silenciosamente.
    // Reconsulta pra diferenciar em vez de mostrar mensagem genérica.
    if (!updated || updated.length === 0) {
      const { data: recheck } = await supabase
        .from('audience_tickets')
        .select('check_in_status, check_in_at')
        .eq('id', ticket.id)
        .maybeSingle();
      if (recheck?.check_in_status === 'OK') {
        const t = recheck.check_in_at ? formatTime(recheck.check_in_at) : '';
        setScanResult({ type: 'duplicate', message: `Ingresso já usado${t ? ' às ' + t : ''} (outro operador escaneou primeiro).`, name: ticket.buyer_name, kind: 'INGRESSO' });
      } else {
        setScanResult({ type: 'error', message: 'Sem permissão pra marcar este ingresso. Acione o coordenador.', name: ticket.buyer_name, kind: 'INGRESSO' });
      }
      return;
    }
    const meiaSuffix = ticket.ticket_type_kind === 'meia' ? ' (verificar documento de meia)' : '';
    const seatTipo = await fetchSeatTipo(ticket.event_id, ticket.seat_id);
    const tipoLabel = SEAT_TIPO_LABEL[seatTipo];
    const pcdNote = seatTipo === 'acompanhante' ? ' (acompanhante de PCD)' : tipoLabel ? ` (${tipoLabel.toLowerCase()} — verificar comprovação PCD)` : '';
    const seatSuffix = ticket.seat_id ? ` — Assento ${ticket.seat_id}${pcdNote}` : '';
    const sessaoSuffix = sessaoTxt ? ` — Sessão ${sessaoTxt}` : '';
    setScanResult({
      type: 'success',
      message: `Ingresso ${ticket.ticket_type_nome ?? ''} liberado${meiaSuffix}${sessaoSuffix}${seatSuffix}!`.replace('Ingresso  liberado', 'Ingresso liberado'),
      name: ticket.buyer_name,
      kind: 'INGRESSO',
    });
    setTicketHits(prev => prev.map(h => h.id === ticket.id ? { ...h, check_in_status: 'OK', check_in_at: now } : h));
    // Otimista: soma 1 na sessão do ingresso, sem baixar a tabela inteira a cada entrada (egress).
    statsReq.current += 1;
    setTicketStats(prev => prev.map(st => st.id === ticket.event_id ? { ...st, entered: Math.min(st.total, st.entered + 1) } : st));
  }, []);

  // Confere uso, pagamento e SESSÃO do ingresso. Sessão errada não libera sozinho: pede confirmação.
  const handleTicket = useCallback(async (ticket: TicketRow, force = false) => {
    if (ticket.check_in_status === 'OK') {
      const t = ticket.check_in_at ? formatTime(ticket.check_in_at) : '';
      setScanResult({ type: 'duplicate', message: `Ingresso já usado${t ? ' às ' + t : ''}.`, name: ticket.buyer_name, kind: 'INGRESSO' });
      return;
    }
    if (!PAID_TICKET.includes(String(ticket.status_pagamento))) {
      setScanResult({ type: 'error', message: `Pagamento ${String(ticket.status_pagamento).toLowerCase()}. Procure o coordenador.`, name: ticket.buyer_name, kind: 'INGRESSO' });
      return;
    }
    const { info, siblings, failed } = await loadSession(ticket.event_id);
    if (failed && !force) {
      setScanResult(null);
      setPending({ ticket, message: 'Não consegui conferir a sessão deste ingresso (sinal fraco?).' });
      return;
    }
    if (!force) {
      const verdict = checkTicketSession(info, siblings);
      if (verdict.level === 'warn') {
        setScanResult(null);
        setPending({ ticket, message: verdict.message });
        return;
      }
    }
    await completeTicket(ticket, sessionText(info));
  }, [loadSession, completeTicket]);

  const processQrId = useCallback(async (rawId: string) => {
    const id = rawId.trim();
    if (!id) {
      setScanResult({ type: 'error', message: 'QR vazio.' });
      return;
    }

    // 1) Inscrição (registrations.id)
    const item = canScan('INSCRITO') ? items.find(i => i.id === id) : undefined;
    if (item) {
      if (item.check_in_status === 'OK') {
        const t = item.check_in_at ? formatTime(item.check_in_at) : '';
        setScanResult({ type: 'duplicate', message: `Já credenciado${t ? ' às ' + t : ''}.`, name: item.nome_coreografia, kind: 'INSCRITO' });
        return;
      }
      if (!isRegistrationPaid(item.status_pagamento)) {
        setScanResult({ type: 'error', message: 'Pagamento não confirmado. Procure o coordenador.', name: item.nome_coreografia, kind: 'INSCRITO' });
        return;
      }
      const now = new Date().toISOString();
      const { data: updated, error: upErr } = await supabase
        .from('registrations')
        .update({ check_in_status: 'OK', check_in_at: now })
        .eq('id', id)
        .select('id');
      if (upErr) {
        setScanResult({ type: 'error', message: `Falha ao marcar: ${upErr.message}`, name: item.nome_coreografia, kind: 'INSCRITO' });
        return;
      }
      if (!updated || updated.length === 0) {
        setScanResult({ type: 'error', message: 'Sem permissão pra marcar este check-in. Acione o coordenador.', name: item.nome_coreografia, kind: 'INSCRITO' });
        return;
      }
      setItems(prev => prev.map(i => i.id === id ? { ...i, check_in_status: 'OK', check_in_at: now } : i));
      setScanResult({ type: 'success', message: 'Check-in realizado!', name: item.nome_coreografia, kind: 'INSCRITO' });
      trackFeatureUsed('checkin_qr_scan', { kind: 'INSCRITO' });
      return;
    }

    // 2) Ingresso plateia (audience_tickets.id)
    // O QR do ingresso é o id — ou, depois de uma transferência de titularidade, o qr_code novo.
    // O id de um ingresso transferido deixa de valer (o titular anterior ainda tem esse QR salvo).
    let ticket: TicketRow | null = null;
    if (canScan('INGRESSO')) {
      const { data: byId } = await supabase.from('audience_tickets').select(TICKET_COLS).eq('id', id).maybeSingle();
      if (byId?.qr_code) {
        setScanResult({ type: 'error', message: 'QR desatualizado: este ingresso foi transferido para outro titular. Peça o QR novo.', name: byId.buyer_name, kind: 'INGRESSO' });
        return;
      }
      ticket = (byId as TicketRow | null) ?? null;
      if (!ticket) {
        const { data: byQr } = await supabase.from('audience_tickets').select(TICKET_COLS).eq('qr_code', id).maybeSingle();
        ticket = (byQr as TicketRow | null) ?? null;
      }
    }
    if (ticket) {
      await handleTicket(ticket);
      return;
    }

    // 3) Workshop (workshop_registrations.access_token)
    const { data: ws } = canScan('WORKSHOP')
      ? await supabase
          .from('workshop_registrations')
          .select('id, buyer_name, attended, attended_at, status_pagamento, workshops(name)')
          .eq('access_token', id)
          .maybeSingle()
      : { data: null };
    if (ws) {
      const wsAny = ws as any;
      const workshopName = Array.isArray(wsAny.workshops) ? wsAny.workshops[0]?.name : wsAny.workshops?.name;
      if (ws.attended) {
        const t = ws.attended_at ? formatTime(ws.attended_at) : '';
        setScanResult({ type: 'duplicate', message: `Workshop já marcado${t ? ' às ' + t : ''}.`, name: ws.buyer_name, kind: 'WORKSHOP' });
        return;
      }
      if (!['APROVADO', 'CORTESIA', 'GRATUITO'].includes(String(ws.status_pagamento))) {
        setScanResult({ type: 'error', message: `Pagamento ${String(ws.status_pagamento).toLowerCase()}. Procure o coordenador.`, name: ws.buyer_name, kind: 'WORKSHOP' });
        return;
      }
      const now = new Date().toISOString();
      const { data: { user } } = await supabase.auth.getUser();
      const { data: updated, error: upErr } = await supabase
        .from('workshop_registrations')
        .update({ attended: true, attended_at: now, attended_by: user?.id ?? null })
        .eq('id', ws.id)
        .select('id');
      if (upErr) {
        setScanResult({ type: 'error', message: `Falha ao marcar: ${upErr.message}`, name: ws.buyer_name, kind: 'WORKSHOP' });
        return;
      }
      if (!updated || updated.length === 0) {
        setScanResult({ type: 'error', message: 'Sem permissão pra marcar este workshop. Acione o coordenador.', name: ws.buyer_name, kind: 'WORKSHOP' });
        return;
      }
      setScanResult({ type: 'success', message: `${workshopName ?? 'Workshop'} — presença marcada!`, name: ws.buyer_name, kind: 'WORKSHOP' });
      return;
    }

    // 4) Equipe (profiles.id com role staff/coordenador)
    const { data: profile } = canScan('EQUIPE')
      ? await supabase
          .from('profiles')
          .select('id, full_name, role, cargo, last_checkin_at')
          .eq('id', id)
          .maybeSingle()
      : { data: null };
    if (profile && STAFF_ROLES.includes(String(profile.role))) {
      const isCoord = profile.role === 'COORDENADOR';
      if (profile.last_checkin_at) {
        const t = formatTime(profile.last_checkin_at);
        setScanResult({ type: 'duplicate', message: `Já registrado às ${t}.`, name: profile.full_name, kind: 'EQUIPE' });
        return;
      }
      const now = new Date().toISOString();
      // .select('id') detecta RLS bloqueando silenciosamente (0 rows
      // afetadas, sem erro) — mesmo hardening já usado no caso WORKSHOP
      // acima. Relevante aqui porque o UPDATE é cross-user (staff marcando
      // OUTRO colega), coberto por policy escopada por evento desde
      // 2026-07-19 (20260719b_equipe_checkin_scoped_policy.sql).
      const { data: updated, error: upErr } = await supabase
        .from('profiles')
        .update({ last_checkin_at: now })
        .eq('id', id)
        .select('id');
      if (upErr) {
        setScanResult({ type: 'error', message: `Falha ao marcar: ${upErr.message}`, name: profile.full_name, kind: 'EQUIPE' });
        return;
      }
      if (!updated || updated.length === 0) {
        setScanResult({ type: 'error', message: 'Sem permissão pra marcar essa pessoa. Acione o coordenador.', name: profile.full_name, kind: 'EQUIPE' });
        return;
      }
      const label = profile.cargo || (isCoord ? 'Coordenação' : 'Equipe');
      setScanResult({ type: 'success', message: `${label} chegou!`, name: profile.full_name, kind: 'EQUIPE' });
      return;
    }

    // 5) Jurado (judges.id)
    const { data: judge } = canScan('JURADO')
      ? await supabase
          .from('judges')
          .select('id, name, last_checkin_at')
          .eq('id', id)
          .maybeSingle()
      : { data: null };
    if (judge) {
      if (judge.last_checkin_at) {
        const t = formatTime(judge.last_checkin_at);
        setScanResult({ type: 'duplicate', message: `Jurado já registrado às ${t}.`, name: judge.name, kind: 'JURADO' });
        return;
      }
      const now = new Date().toISOString();
      const { data: updated, error: upErr } = await supabase
        .from('judges')
        .update({ last_checkin_at: now })
        .eq('id', id)
        .select('id');
      if (upErr) {
        setScanResult({ type: 'error', message: `Falha ao marcar: ${upErr.message}`, name: judge.name, kind: 'JURADO' });
        return;
      }
      if (!updated || updated.length === 0) {
        setScanResult({ type: 'error', message: 'Sem permissão pra marcar este jurado. Acione o coordenador.', name: judge.name, kind: 'JURADO' });
        return;
      }
      setScanResult({ type: 'success', message: 'Jurado registrado!', name: judge.name, kind: 'JURADO' });
      return;
    }

    const allowedKinds = (['INSCRITO', 'INGRESSO', 'WORKSHOP', 'EQUIPE', 'JURADO'] as ScanKind[])
      .filter(canScan).map(k => SCAN_KIND_LABEL[k]);
    setScanResult({
      type: 'error',
      message: allowedKinds.length > 0
        ? `QR não reconhecido nos tipos que você pode escanear (${allowedKinds.join(', ')}).`
        : 'Você não tem permissão pra escanear nenhum tipo de crachá. Acione o coordenador.',
    });
  }, [items, canScan, handleTicket]);

  /* ── QR scanner via BarcodeDetector or fallback ── */
  const startScanner = async () => {
    // Toque duplo ou "próximo" com a câmera ainda aberta: fecha a anterior antes de abrir outra.
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    const token = ++scanSessionRef.current;
    const stale = () => token !== scanSessionRef.current;
    setScanResult(null);
    setPending(null);
    setCameraMsg(null);
    setScannerOpen(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMsg('Este navegador não deixa usar a câmera (é preciso uma conexão segura e um navegador atual). Digite o código abaixo.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (stale()) { stream.getTracks().forEach(t => t.stop()); return; } // fechou enquanto pedia permissão
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => { /* o autoplay do iOS pode recusar; o quadro continua ao tocar */ });
      }
      // BarcodeDetector (Chrome/Android) ou, sem ele (Safari/iPhone), leitura por canvas com a jsQR.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const BD = (window as any).BarcodeDetector;
      let decode: (video: HTMLVideoElement) => Promise<string | null>;
      if (BD) {
        const detector = new BD({ formats: ['qr_code'] });
        decode = async video => {
          const codes = await detector.detect(video);
          return codes.length > 0 ? String(codes[0].rawValue) : null;
        };
      } else {
        const { default: jsQR } = await import('jsqr');
        if (stale()) { stream.getTracks().forEach(t => t.stop()); streamRef.current = null; return; }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let last = 0;
        decode = async video => {
          const nowMs = performance.now();
          if (!ctx || nowMs - last < 150 || !video.videoWidth) return null;
          last = nowMs;
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          return jsQR(img.data, img.width, img.height)?.data ?? null;
        };
      }
      const scan = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          scanLoopRef.current = requestAnimationFrame(scan);
          return;
        }
        try {
          const value = await decode(videoRef.current);
          if (value) {
            stopScanner();
            await processQrId(value);
          } else {
            scanLoopRef.current = requestAnimationFrame(scan);
          }
        } catch {
          scanLoopRef.current = requestAnimationFrame(scan);
        }
      };
      scanLoopRef.current = requestAnimationFrame(scan);
    } catch (e: any) {
      console.error('Camera error:', e);
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      const name = e?.name as string | undefined;
      setCameraMsg(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'A câmera está bloqueada. Permita o acesso à câmera no navegador (cadeado ao lado do endereço) e toque em Escanear de novo, ou digite o código abaixo.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'Este aparelho não tem câmera disponível. Digite o código abaixo.'
            : 'Não foi possível abrir a câmera (ela pode estar em uso por outro app). Digite o código abaixo.',
      );
    }
  };

  const stopScanner = useCallback(() => {
    scanSessionRef.current += 1;
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setScannerOpen(false);
  }, []);

  useEffect(() => () => { stopScanner(); }, [stopScanner]);

  // Retorno tátil na portaria (barulho, fila): curto = liberou; longo duplo = recusou ou já usado.
  useEffect(() => {
    if (!scanResult || typeof navigator === 'undefined' || !navigator.vibrate) return;
    navigator.vibrate(scanResult.type === 'success' ? 80 : [200, 80, 200]);
  }, [scanResult]);

  /* ── counts ── */
  const total     = items.length;
  const doneCount = items.filter(i => i.check_in_status === 'OK').length;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 pb-20">

      {/* Header */}
      <div className="bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-white/5 px-4 pt-5 pb-4 space-y-4 sticky top-0 z-30">
        <PageHeader
          title={<>Creden<span className="text-[#ff0068]">ciamento</span></>}
          subtitle={hasInscritosAccess ? `${doneCount} / ${total} credenciados` : 'Escaneie o QR pra marcar presença'}
          actions={
            <>
              <button
                onClick={() => { sessionCache.current.clear(); fetchData(); fetchTicketStats(); }}
                aria-label="Atualizar"
                title="Atualizar"
                className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={startScanner}
                className="flex items-center gap-2 px-4 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20"
              >
                <QrCode size={16} /> Escanear QR
              </button>
            </>
          }
        />

        {hasInscritosAccess && (
          <>
            {/* Progress bar */}
            <div className="h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: total > 0 ? `${(doneCount / total) * 100}%` : '0%' }}
                transition={{ duration: 0.5 }}
              />
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="text"
                placeholder="Buscar coreografia ou estúdio..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50 transition-all"
              />
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-2xl">
              {(['TODOS', 'PENDENTE', 'OK'] as FilterTab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterTab(t)}
                  className={`flex-1 min-h-11 py-2.5 px-1 rounded-xl text-[10px] font-black uppercase tracking-tight sm:tracking-widest transition-all ${
                    filterTab === t
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  {t === 'TODOS' ? `Todos (${total})` : t === 'OK' ? `Feitos (${doneCount})` : `Pendentes (${total - doneCount})`}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Ingressos da plateia: entradas por sessão + busca de comprador/assento ── */}
      {hasPerm('checkin_ingressos') && (
        <div className="px-4 pt-4">
          <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-3xl p-4 space-y-3">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Armchair size={14} /> Ingressos da plateia
            </p>
            {ticketStats.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum ingresso pago ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {ticketStats.map(st => (
                  <li key={st.id} className="flex items-center gap-3 text-xs">
                    <span className="w-28 shrink-0 font-black text-slate-700 dark:text-slate-200">{st.label}</span>
                    <div className="flex-1 h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${st.total > 0 ? (st.entered / st.total) * 100 : 0}%` }} />
                    </div>
                    <span className="shrink-0 text-slate-500"><strong className="text-slate-900 dark:text-white">{st.entered}</strong> de {st.total} entraram</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="text"
                value={ticketQuery}
                onChange={e => setTicketQuery(e.target.value)}
                placeholder="Esqueceu o QR? Busque pelo nome do comprador ou pelo assento (G 13)"
                aria-label="Buscar ingresso por nome do comprador ou assento"
                className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50"
              />
            </div>
            {ticketSearching && <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Buscando...</p>}
            {!ticketSearching && ticketQuery.trim().length >= 2 && ticketHits.length === 0 && (
              <p className="text-xs text-slate-400">Nenhum ingresso pago encontrado.</p>
            )}
            {ticketHits.length > 0 && (
              <ul className="space-y-2">
                {ticketHits.map(h => {
                  const entered = h.check_in_status === 'OK';
                  return (
                    <li key={h.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${entered ? 'border-emerald-500/30' : 'border-slate-200 dark:border-white/10'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight truncate">{h.buyer_name}</p>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">
                          {[h.ticket_type_nome, sessionLabels[h.event_id] ? `Sessão ${sessionLabels[h.event_id]}` : null, h.seat_id ? `Assento ${h.seat_id}` : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => { if (busyTicket) return; setBusyTicket(h.id); try { await handleTicket(h); } finally { setBusyTicket(null); } }}
                        disabled={entered || busyTicket === h.id}
                        className={`shrink-0 min-h-11 px-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all disabled:cursor-not-allowed ${
                          entered
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 hover:bg-[#ff0068] hover:text-white hover:border-transparent'
                        }`}
                      >
                        {entered ? `Entrou${h.check_in_at ? ' ' + formatTime(h.check_in_at) : ''}` : 'Liberar'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 px-4 pt-4 space-y-2">
        {!hasInscritosAccess ? (
          <div className="py-20 text-center">
            <QrCode size={40} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Toque em "Escanear QR" acima</p>
            <p className="text-[10px] text-slate-400 mt-1">Seu acesso é só pra credenciamento por QR — sem lista de inscrições.</p>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#ff0068] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nenhuma inscrição encontrada</p>
          </div>
        ) : filtered.map(item => {
          const checkedIn   = item.check_in_status === 'OK';
          const pago        = isRegistrationPaid(item.status_pagamento);
          const trilhaOk    = !!(item.trilha_url);
          const canCheckIn  = pago;

          return (
            <div
              key={item.id}
              className={`bg-white dark:bg-slate-900/50 border rounded-3xl p-4 flex items-center gap-3 transition-all ${
                checkedIn ? 'border-emerald-500/30' : 'border-slate-200 dark:border-white/5'
              }`}
            >
              {/* Avatar dot */}
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                checkedIn ? 'bg-emerald-500/10' : 'bg-slate-100 dark:bg-white/5'
              }`}>
                {checkedIn
                  ? <CheckCircle2 size={18} className="text-emerald-500" />
                  : <User size={18} className="text-slate-400" />
                }
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight truncate leading-tight">
                  {item.nome_coreografia}
                </p>
                {item.estudio && (
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">{item.estudio}</p>
                )}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <StatusBadge ok={pago}     label={pago ? 'Pago' : 'Pendente'} />
                  <StatusBadge ok={trilhaOk} label={trilhaOk ? 'Trilha OK' : 'Sem Trilha'} />
                  {checkedIn && item.check_in_at && (
                    <span className="text-[8px] font-bold text-slate-400 uppercase">
                      {new Date(item.check_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>

              {/* Action */}
              <button
                onClick={() => handleToggle(item)}
                disabled={!canCheckIn}
                className={`shrink-0 w-20 min-h-11 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                  checkedIn
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : 'bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 hover:bg-[#ff0068] hover:text-white hover:border-transparent'
                }`}
              >
                {checkedIn ? 'OK ✓' : 'Check'}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── QR Scanner modal ── */}
      <AnimatePresence>
        {scannerOpen && (
          <div className="fixed inset-0 z-[100] bg-black flex flex-col h-[100dvh]">
            <div className="flex items-center justify-between px-5 pt-6 pb-3 shrink-0">
              <div>
                <p className="text-white font-black uppercase text-lg tracking-tighter">Escanear QR Code</p>
                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Aponte para o QR do ingresso ou da credencial</p>
              </div>
              <button onClick={stopScanner} className="p-2 text-slate-400 hover:text-white transition-all">
                <X size={24} />
              </button>
            </div>

            {/* Camera — altura mínima garantida pra não espremer quando o teclado
                abre pro campo manual logo abaixo (dvh evita o salto da barra de
                URL do navegador mobile mudando a viewport no meio do scan). */}
            <div className="flex-1 min-h-[180px] relative overflow-hidden">
              <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
              {cameraMsg && (
                <div role="alert" className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-rose-500/90 text-white text-sm font-bold p-4 text-center">
                  {cameraMsg}
                </div>
              )}
              {/* Scan frame overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-[min(60vw,220px)] h-[min(60vw,220px)] relative">
                  <div className="absolute inset-0 border-2 border-white/20 rounded-3xl" />
                  <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-[#ff0068] rounded-tl-2xl" />
                  <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-[#ff0068] rounded-tr-2xl" />
                  <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-[#ff0068] rounded-bl-2xl" />
                  <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-[#ff0068] rounded-br-2xl" />
                  {/* Scan line */}
                  <motion.div
                    className="absolute left-2 right-2 h-0.5 bg-[#ff0068] opacity-70 rounded-full"
                    animate={{ top: ['10%', '90%', '10%'] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
              </div>
            </div>

            {/* Manual input fallback */}
            {/* Intentional dark: vive dentro do scanner modal (bg-black com câmera).
                Tem que casar com o overlay escuro do BarcodeDetector. shrink-0 +
                altura fixa da câmera acima garantem que esse bloco nunca fica
                espremido/cortado em tela baixa (achado real: campo minúsculo e
                sem botão visível de confirmar, só Enter, difícil de usar no celular). */}
            <div className="shrink-0 px-5 py-4 space-y-2.5 bg-slate-950 border-t border-white/10 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-center">Ou insira o código manualmente</p>
              <form
                className="flex gap-2"
                onSubmit={async e => {
                  e.preventDefault();
                  const input = e.currentTarget.elements.namedItem('manualQr') as HTMLInputElement;
                  const val = input.value;
                  stopScanner();
                  await processQrId(val);
                }}
              >
                <input
                  name="manualQr"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder="Digite ou cole o código do ingresso ou da inscrição..."
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-white text-base font-mono focus:outline-none focus:border-[#ff0068]/50"
                />
                <button
                  type="submit"
                  className="shrink-0 px-5 py-3.5 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff1a7d] transition-all"
                >
                  OK
                </button>
              </form>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Ingresso de outra sessão/dia: o operador confirma ── */}
      <AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4"
          >
            <div role="alertdialog" aria-modal="true" aria-label="Ingresso de outra sessão" onKeyDown={e => { if (e.key === 'Escape') setPending(null); }} className="w-full max-w-sm rounded-3xl bg-amber-500 p-5 shadow-2xl space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle size={24} className="text-white shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-black text-sm uppercase tracking-tight leading-tight">{pending.ticket.buyer_name}</p>
                  <p className="text-white text-[12px] font-bold mt-1">{pending.message}</p>
                  {pending.ticket.seat_id && <p className="text-white/90 text-[11px] font-bold mt-1">Assento {pending.ticket.seat_id}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setPending(null)}
                  className="flex-1 min-h-11 rounded-2xl bg-white/20 text-white text-[10px] font-black uppercase tracking-widest"
                >
                  Não liberar
                </button>
                <button
                  type="button"
                  onClick={async () => { const t = pending.ticket; if (busyTicket) return; setBusyTicket(t.id); setPending(null); try { await handleTicket(t, true); } finally { setBusyTicket(null); } }}
                  className="flex-1 min-h-11 rounded-2xl bg-white text-amber-700 text-[10px] font-black uppercase tracking-widest"
                >
                  Liberar mesmo assim
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Scan result toast ── */}
      <AnimatePresence>
        {scanResult && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-24 inset-x-4 z-[200] flex justify-center"
          >
            <div className={`w-full max-w-sm rounded-3xl p-5 shadow-2xl flex items-start gap-4 ${
              scanResult.type === 'success'   ? 'bg-emerald-500' :
              scanResult.type === 'duplicate' ? 'bg-amber-500'   : 'bg-rose-500'
            }`}>
              {scanResult.type === 'success'   && <CheckCircle2 size={24} className="text-white shrink-0 mt-0.5" />}
              {scanResult.type === 'duplicate' && <Clock         size={24} className="text-white shrink-0 mt-0.5" />}
              {scanResult.type === 'error'     && <AlertCircle   size={24} className="text-white shrink-0 mt-0.5" />}
              <div className="flex-1">
                {scanResult.kind && (
                  <span className="inline-block text-[8px] font-black uppercase tracking-widest bg-white/25 text-white px-1.5 py-0.5 rounded mb-1">
                    {scanResult.kind === 'INSCRITO' ? 'Inscrito'
                      : scanResult.kind === 'INGRESSO' ? 'Ingresso'
                      : scanResult.kind === 'WORKSHOP' ? 'Workshop'
                      : scanResult.kind === 'EQUIPE' ? 'Equipe'
                      : 'Jurado'}
                  </span>
                )}
                {scanResult.name && (
                  <p className="text-white font-black text-sm uppercase tracking-tight leading-tight">{scanResult.name}</p>
                )}
                <p className="text-white/90 text-[11px] font-bold mt-0.5">{scanResult.message}</p>
                <button
                  type="button"
                  onClick={startScanner}
                  className="mt-3 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-2xl bg-white/25 hover:bg-white/35 text-white text-[10px] font-black uppercase tracking-widest"
                >
                  <QrCode size={14} /> Escanear próximo
                </button>
              </div>
              <button onClick={() => setScanResult(null)} className="text-white/70 hover:text-white shrink-0">
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CheckIn;
