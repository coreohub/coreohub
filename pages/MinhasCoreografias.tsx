import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import SystemErrorBanner from '../components/SystemErrorBanner';
import {
  Music2, Plus, Trash2, AlertCircle, Loader2, CheckCircle,
  Clapperboard, Calendar, MapPin, Clock, CreditCard, QrCode,
  ChevronRight, AlertTriangle, ShoppingCart, X, Video,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
interface Registration {
  id:                    string;
  user_id:               string;
  event_id:              string | null;
  nome_coreografia:      string | null;
  formato_participacao:  string | null;
  tipo_apresentacao:     string | null;
  estilo_danca:          string | null;
  categoria:             string | null;
  status:                string;
  status_pagamento:      string;
  payment_url:           string | null;
  payment_preference_id: string | null;
  payment_id:            string | null;
  payment_group_id:      string | null;
  mod_fee:               number | null;
  charged_amount:        number | null;
  valor_pago:            number | null;
  paid_at:               string | null;
  created_at:            string;
  // Seletiva por vídeo (Modelo 3) — coreografias em AGUARDANDO_VIDEO carregam
  // essas colunas pra renderização inline (substituindo /minha-seletiva).
  video_url?:            string | null;
  video_status?:         string | null;
  video_fee_status?:     string | null;
  video_approved_at?:    string | null;
  bailarinos_detalhes?:  any[] | null;
  /** Snapshot do video_selection_fee do evento no momento (preview de UI). */
  _videoFee?:            number;
  /** Hidratado do join com events */
  _event?: {
    id:         string;
    name:       string;
    slug:       string | null;
    start_date: string | null;
    location:   string | null;
  };
  /** Preço calculado client-side pra exibição (charged_amount / valor_pago /
   *  mod_fee / fallback formacao.preco). Null quando não há base configurada. */
  _precoDisplay?: number | null;
}

interface AggregatePayment {
  id:               string;
  user_id:          string;
  event_id:         string;
  value_total:      number;
  asaas_payment_id: string | null;
  payment_url:      string | null;
  status:           string;
  expires_at:       string | null;
  created_at:       string;
  paid_at:          string | null;
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
const fmtDate = (d?: string | null): string => {
  if (!d) return '—';
  // Aceita 'YYYY-MM-DD' ou ISO completo.
  const s = d.length === 10 ? `${d}T12:00:00` : d;
  const date = new Date(s);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const fmtMoney = (v?: number | null): string =>
  v != null
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
    : '—';

const diasAte = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diff = d.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
};

/**
 * Mapeia `status_pagamento` do banco pra label/cor da UI. Cobre todos os
 * estados reais que o webhook/cron produz.
 */
const STATUS_PAGAMENTO_CFG: Record<string, { bg: string; text: string; label: string; tone: 'pendente' | 'ok' | 'erro' | 'expirado' }> = {
  PENDENTE:  { bg: 'bg-amber-50 dark:bg-amber-500/10',   text: 'text-amber-700 dark:text-amber-400',     label: 'Aguardando pagamento', tone: 'pendente' },
  APROVADO:  { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', label: 'Confirmada',         tone: 'ok' },
  VENCIDO:   { bg: 'bg-slate-100 dark:bg-white/5',       text: 'text-slate-500',                         label: 'Vencida',              tone: 'expirado' },
  EXPIRADO:  { bg: 'bg-slate-100 dark:bg-white/5',       text: 'text-slate-500',                         label: 'Expirada',             tone: 'expirado' },
  ESTORNADO: { bg: 'bg-slate-100 dark:bg-white/5',       text: 'text-slate-500',                         label: 'Estornada',            tone: 'erro' },
  CANCELADO: { bg: 'bg-slate-100 dark:bg-white/5',       text: 'text-slate-500',                         label: 'Cancelada',            tone: 'erro' },
};
const statusCfg = (s: string) => STATUS_PAGAMENTO_CFG[s] ?? STATUS_PAGAMENTO_CFG.PENDENTE;


/* ══════════════════════════════════════════════════════════════
   COMPONENT
══════════════════════════════════════════════════════════════ */
const MinhasCoreografias = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const novaId = searchParams.get('nova');

  const [registrations, setRegistrations]    = useState<Registration[]>([]);
  const [workshops,     setWorkshops]        = useState<any[]>([]);
  const [activePayments, setActivePayments]  = useState<Record<string, AggregatePayment>>({});
  const [profileCpf, setProfileCpf]          = useState<string | null>(null);
  const [loading,  setLoading]               = useState(true);
  const [error,    setError]                 = useState<string | null>(null);

  const [confirmDel, setConfirmDel]          = useState<Registration | null>(null);
  const [payingEvent, setPayingEvent]        = useState<string | null>(null);
  const [payingSingle, setPayingSingle]      = useState<string | null>(null);
  const [payingTaxa,   setPayingTaxa]        = useState<string | null>(null);
  const [couponInputs, setCouponInputs]      = useState<Record<string, string>>({});
  const [showCoupon,   setShowCoupon]        = useState<Record<string, boolean>>({});
  const [deleting,    setDeleting]           = useState(false);
  const [editingVideo, setEditingVideo]      = useState<string | null>(null);
  const [videoLinkInput, setVideoLinkInput]  = useState('');
  const [actionError,  setActionError]       = useState<Record<string, string>>({});

  // Tabs no topo (padrão Sympla/Eventbrite). Default mostra "Próximas" se
  // tem pelo menos 1 evento futuro; senão "Todas".
  type Tab = 'all' | 'upcoming' | 'past' | 'selecao';
  const [activeTab, setActiveTab] = useState<Tab>('upcoming');

  /* ══════════════════════════════════════════════════════════
     FETCH
  ══════════════════════════════════════════════════════════ */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
        return;
      }

      // Perfil pra checar CPF (necessário antes de gerar fatura agregada — A4).
      const { data: profile } = await supabase
        .from('profiles')
        .select('cpf_cnpj')
        .eq('id', user.id)
        .maybeSingle();
      setProfileCpf(profile?.cpf_cnpj ?? null);

      // Inscrições do user. Não usamos embed PostgREST com events porque
      // registrations tem múltiplas FKs pra events (event_id + outras
      // colunas com FK ambígua) e o embed falha com erro PGRST201.
      // Buscamos events em query separada e mapeamos client-side.
      const { data: regsData, error: regsErr } = await supabase
        .from('registrations')
        .select(`
          id, user_id, event_id,
          nome_coreografia, formato_participacao, tipo_apresentacao,
          estilo_danca, categoria,
          status, status_pagamento,
          payment_url, payment_preference_id, payment_id, payment_group_id,
          mod_fee, charged_amount, valor_pago, paid_at, created_at,
          bailarinos_detalhes,
          video_url, video_status, video_fee_status, video_approved_at
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (regsErr) throw regsErr;
      const regsRaw = regsData ?? [];

      // Carrega events e configuracoes em batch. `formacoes_config` em events
      // + `formatos_precos` em configuracoes são as fontes de preço por
      // formação (mesmas fontes que create-aggregate-payment-asaas lê).
      const eventIds = Array.from(new Set(regsRaw.map((r: any) => r.event_id).filter(Boolean))) as string[];
      let eventsMap:  Record<string, any> = {};
      let configsMap: Record<string, any> = {};
      if (eventIds.length > 0) {
        const [{ data: eventsData }, { data: configsData }] = await Promise.all([
          supabase
            .from('events')
            .select('id, name, slug, start_date, location, formacoes_config, fee_mode, commission_percent, video_selection_fee')
            .in('id', eventIds),
          supabase
            .from('configuracoes')
            .select('event_id, formatos_precos')
            .in('event_id', eventIds),
        ]);
        for (const ev of (eventsData  ?? [])) eventsMap[ev.id]        = ev;
        for (const cf of (configsData ?? [])) configsMap[cf.event_id] = cf;
      }

      // Helper: calcula o preço a mostrar pra uma inscrição. Espelha a lógica
      // de create-aggregate-payment-asaas (sem o passo de lote — pra simples
      // exibição usamos o preço base da formação).
      const calcPrecoDisplay = (r: any): number | null => {
        if (r.charged_amount != null && r.charged_amount > 0) return Number(r.charged_amount);
        if (r.valor_pago     != null && r.valor_pago     > 0) return Number(r.valor_pago);
        // mod_fee é UNIT — se PER_MEMBER, precisa multiplicar. Não retorna direto.
        if (!r.event_id) {
          if (r.mod_fee != null && r.mod_fee > 0) return Number(r.mod_fee);
          return null;
        }
        const formacaoNome: string = (r.formato_participacao ?? r.tipo_apresentacao ?? '').toLowerCase();
        const cfg     = configsMap[r.event_id];
        const ev      = eventsMap[r.event_id];
        const fmCfg   = formacaoNome ? (cfg?.formatos_precos ?? []).find((f: any) => f.nome?.toLowerCase() === formacaoNome) : undefined;
        const fmEvent = formacaoNome ? (ev?.formacoes_config ?? []).find((m: any) => m.name?.toLowerCase() === formacaoNome) : undefined;
        // pricing_type da formação efetivamente escolhida.
        const pricingType: 'FIXED' | 'PER_MEMBER' = fmEvent?.pricing_type ?? 'FIXED';
        const bailarinosCount = Array.isArray(r.bailarinos_detalhes) ? r.bailarinos_detalhes.length : 1;
        const multiplier = (pricingType === 'PER_MEMBER' && bailarinosCount > 1) ? bailarinosCount : 1;

        // Resolve lote vigente (mesma lógica de create-payment-asaas):
        // primeiro lote cuja data_virada está no futuro (ou sem data_virada).
        const resolveLotePrice = (formacao: any): number | null => {
          const lotes: Array<{ preco: number; data_virada: string | null }> = formacao?.lotes ?? [];
          if (lotes.length === 0) return null;
          const today = new Date();
          for (const lot of lotes) {
            if (!lot.data_virada) return Number(lot.preco);
            const d = new Date(lot.data_virada + 'T23:59:59');
            if (d.getTime() >= today.getTime()) return Number(lot.preco);
          }
          return null; // todos lotes vencidos
        };

        // Preferência: mod_fee unit × N → lote vigente (fmCfg/fmEvent) → fee/base_fee legacy → null
        let base: number | null = null;
        if (r.mod_fee != null && r.mod_fee > 0)         base = Number(r.mod_fee);
        else {
          const loteCfg   = resolveLotePrice(fmCfg);
          const loteEvent = resolveLotePrice(fmEvent);
          if (loteCfg != null && loteCfg > 0)           base = loteCfg;
          else if (loteEvent != null && loteEvent > 0)  base = loteEvent;
          else if (fmCfg?.preco != null)                base = Number(fmCfg.preco);
          else if (fmEvent?.fee != null)                base = Number(fmEvent.fee);
          else if (fmEvent?.base_fee != null)           base = Number(fmEvent.base_fee);
        }
        if (base == null || base <= 0) return null;

        const total = base * multiplier;
        // Se o evento repassa a taxa, soma a comissão pra mostrar o que o inscrito paga.
        const feeMode = ev?.fee_mode ?? 'repassar';
        if (feeMode === 'repassar') {
          const pct = Number(ev?.commission_percent ?? 10);
          return parseFloat((total * (1 + pct / 100)).toFixed(2));
        }
        return parseFloat(total.toFixed(2));
      };

      const regs: Registration[] = regsRaw.map((r: any) => ({
        ...r,
        _event:        r.event_id ? eventsMap[r.event_id] : undefined,
        // Snapshot do preço calculado pra exibir. Não é persistido — é só pra UI.
        _precoDisplay: calcPrecoDisplay(r),
        _videoFee:     r.event_id ? Number(eventsMap[r.event_id]?.video_selection_fee ?? 0) : 0,
      }));
      setRegistrations(regs);

      // Active payments: 1 PENDENTE por evento (no máximo).
      const { data: payments } = await supabase
        .from('payments')
        .select('id, user_id, event_id, value_total, asaas_payment_id, payment_url, status, expires_at, created_at, paid_at')
        .eq('user_id', user.id)
        .eq('status', 'PENDENTE');
      const map: Record<string, AggregatePayment> = {};
      for (const p of (payments ?? [])) map[p.event_id] = p as AggregatePayment;
      setActivePayments(map);

      // Workshops do user (best-effort — RLS pode bloquear se conta deletada)
      try {
        const { data: ws } = await supabase
          .from('workshop_registrations')
          .select('id, workshop_id, buyer_email, buyer_name, status_pagamento, preco_pago, paid_at, access_token, created_at, workshops(id, event_id, title, date_from, instructor_name)')
          .eq('buyer_email', user.email ?? '')
          .order('created_at', { ascending: false });
        setWorkshops(ws ?? []);
      } catch { setWorkshops([]); }

      // Ingressos de plateia ficam em /ingressos (persona separada — público
      // geral, família, apreciadores). Decisão 2026-05-20: Minhas Inscrições é
      // só pra coreografias/workshops do artista.
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Limpa o ?nova= depois de 5s pra não persistir na URL.
  useEffect(() => {
    if (!novaId) return;
    const t = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('nova');
        return next;
      }, { replace: true });
    }, 5000);
    return () => clearTimeout(t);
  }, [novaId, setSearchParams]);

  /* ══════════════════════════════════════════════════════════
     DERIVED — agrupar por evento
  ══════════════════════════════════════════════════════════ */
  type Grupo = {
    eventId:    string;
    eventNome:  string;
    eventSlug:  string | null;
    eventData:  string | null;
    eventLocal: string | null;
    pendentes:  Registration[];
    outras:     Registration[];
    seletiva:   Registration[];  // AGUARDANDO_VIDEO + video_status != approved
    workshops:  any[];
    totalPendente: number;
    payment:    AggregatePayment | undefined;
  };

  // Coreografias em fluxo de seletiva (AGUARDANDO_VIDEO + não aprovadas)
  // entram agora no mesmo grupo do evento, mas em uma seção dedicada com
  // botões próprios (Pagar Taxa A, Trocar Vídeo). Antes ficavam numa página
  // separada — consolidado pra match com padrão Sympla/Eventbrite.
  const inSeletivaFlow = (r: any) =>
    r.status_pagamento === 'AGUARDANDO_VIDEO' && r.video_status !== 'approved';
  const seletivaCount = useMemo(
    () => registrations.filter(inSeletivaFlow).length,
    [registrations]
  );

  const grupos: Grupo[] = useMemo(() => {
    const map = new Map<string, Grupo>();
    const ensure = (eventId: string, sample?: { name?: string; slug?: string | null; start_date?: string | null; location?: string | null }) => {
      if (!map.has(eventId)) {
        map.set(eventId, {
          eventId,
          eventNome:  sample?.name ?? 'Evento',
          eventSlug:  sample?.slug ?? null,
          eventData:  sample?.start_date ?? null,
          eventLocal: sample?.location ?? null,
          pendentes:  [],
          outras:     [],
          seletiva:   [],
          workshops:  [],
          totalPendente: 0,
          payment:    activePayments[eventId],
        });
      }
      return map.get(eventId)!;
    };

    for (const r of registrations) {
      if (!r.event_id) continue;
      const g = ensure(r.event_id, {
        name: r._event?.name,
        slug: r._event?.slug,
        start_date: r._event?.start_date,
        location: r._event?.location,
      });
      if (inSeletivaFlow(r)) {
        g.seletiva.push(r);
      } else if (r.status_pagamento === 'PENDENTE') {
        g.pendentes.push(r);
        // Soma o preço calculado pra UI. Quando a fatura agregada existe,
        // o valor real já está em payment.value_total e sobrescreve este total.
        g.totalPendente += Number(r._precoDisplay ?? 0);
      } else {
        g.outras.push(r);
      }
    }

    // Workshops: agrupa por workshops.event_id (workshops podem ser standalone
    // sem evento — caem num grupo "Standalone" com ID fake).
    for (const w of workshops) {
      const eventId = w.workshops?.event_id ?? `workshop-${w.id}`;
      const g = ensure(eventId, { name: w.workshops?.title ?? 'Workshop standalone' });
      g.workshops.push(w);
    }

    // Filtra grupos vazios depois das agregações.
    for (const [key, g] of map) {
      if (g.pendentes.length + g.outras.length + g.seletiva.length + g.workshops.length === 0) {
        map.delete(key);
      }
    }

    // Pendentes primeiro, depois por data do evento.
    return Array.from(map.values()).sort((a, b) => {
      const hasActivityA = a.pendentes.length + a.seletiva.length > 0 ? 1 : 0;
      const hasActivityB = b.pendentes.length + b.seletiva.length > 0 ? 1 : 0;
      if (hasActivityA !== hasActivityB) return hasActivityB - hasActivityA;
      return (a.eventData ?? '').localeCompare(b.eventData ?? '');
    });
  }, [registrations, workshops, activePayments]);

  // Aplica filtro de tab no topo. Marca tudo de hoje em diante como upcoming.
  const todayISO = useMemo(() => new Date().toISOString().split('T')[0], []);
  const isUpcoming = (g: Grupo) => !g.eventData || g.eventData >= todayISO;
  const tabCounts = useMemo(() => ({
    all: grupos.length,
    upcoming: grupos.filter(isUpcoming).length,
    past: grupos.filter(g => !isUpcoming(g)).length,
    selecao: grupos.filter(g => g.seletiva.length > 0).length,
  }), [grupos]);
  const filteredGrupos = useMemo(() => {
    if (activeTab === 'upcoming') return grupos.filter(isUpcoming);
    if (activeTab === 'past')     return grupos.filter(g => !isUpcoming(g));
    if (activeTab === 'selecao')  return grupos.filter(g => g.seletiva.length > 0);
    return grupos;
  }, [grupos, activeTab]);

  /* ══════════════════════════════════════════════════════════
     ACTIONS
  ══════════════════════════════════════════════════════════ */

  /** Valida CPF antes de pagar. Sempre consulta fresh do banco (não usa
   *  estado cacheado) porque o produtor pode ter completado o perfil em
   *  outra aba/sessão. Evita falso-positivo após UPDATE direto no banco. */
  const requireCpf = async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/auth');
      return false;
    }
    const { data: prof } = await supabase
      .from('profiles')
      .select('cpf_cnpj')
      .eq('id', user.id)
      .maybeSingle();
    const cpf = prof?.cpf_cnpj?.replace(/\D/g, '') ?? '';
    setProfileCpf(prof?.cpf_cnpj ?? null);
    if (!cpf) {
      setError('Pra pagar você precisa completar seu CPF no perfil.');
      navigate('/profile');
      return false;
    }
    return true;
  };

  const handlePagarAgregado = async (grupo: Grupo) => {
    if (!(await requireCpf())) return;
    if (grupo.pendentes.length === 0) return;
    setPayingEvent(grupo.eventId);
    setError(null);
    try {
      // Se já existe fatura agregada PENDENTE pra esse evento, abre a URL existente.
      if (grupo.payment?.payment_url) {
        window.location.href = grupo.payment.payment_url;
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada. Faça login novamente.');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-aggregate-payment-asaas`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            event_id:         grupo.eventId,
            registration_ids: grupo.pendentes.map(r => r.id),
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        if (data?.error_code === 'CPF_REQUIRED') {
          navigate('/profile');
          throw new Error('CPF/CNPJ obrigatório. Complete seu perfil.');
        }
        throw new Error(data?.error ?? 'Erro ao gerar fatura.');
      }
      if (data?.invoice_url) {
        window.location.href = data.invoice_url;
      }
    } catch (e: any) {
      setError(e.message);
      setPayingEvent(null);
    }
  };

  const handlePagarSingle = async (reg: Registration) => {
    if (!(await requireCpf())) return;
    // Se a registration já tem payment_url (gerada anteriormente — ou pelo
    // create-payment-asaas legacy, ou pela create-aggregate), reusa.
    if (reg.payment_url) {
      window.location.href = reg.payment_url;
      return;
    }
    setPayingSingle(reg.id);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada.');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment-asaas`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            registration_id: reg.id,
            event_id:        reg.event_id,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error ?? 'Erro ao gerar pagamento.');
      if (data?.invoice_url) {
        window.location.href = data.invoice_url;
      }
    } catch (e: any) {
      setError(e.message);
      setPayingSingle(null);
    }
  };

  // ─── Seletiva: pagar taxa A (Modelo 3) ─────────────────────────────────
  // Antes vivia em SeletivaInscrito.tsx. Migrado pra inline depois do
  // refactor "Minhas Inscrições" (2026-05-19) — uma página única.
  const handlePagarTaxa = async (reg: Registration, couponCode?: string) => {
    if (!(await requireCpf())) return;
    setPayingTaxa(reg.id);
    setActionError(p => ({ ...p, [reg.id]: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const body: Record<string, unknown> = { registration_id: reg.id, event_id: reg.event_id };
      if (couponCode && couponCode.trim()) body.coupon_code = couponCode.trim();
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-video-selection-payment`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify(body),
        }
      );
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? 'Falha ao criar cobrança.');
      if (payload.waived) {
        await fetchAll();
        return;
      }
      if (payload.invoice_url) {
        window.location.href = payload.invoice_url;
      }
    } catch (e: any) {
      setActionError(p => ({ ...p, [reg.id]: e.message ?? 'Erro inesperado.' }));
    } finally {
      setPayingTaxa(null);
    }
  };

  // ─── Seletiva: trocar link do vídeo (enquanto não aprovado) ─────────────
  const handleSaveVideoLink = async (regId: string) => {
    const url = videoLinkInput.trim();
    if (!url) {
      setActionError(p => ({ ...p, [regId]: 'Informe o link do vídeo.' }));
      return;
    }
    try { new URL(url); }
    catch {
      setActionError(p => ({ ...p, [regId]: 'Link inválido. Use URL completa (https://...).' }));
      return;
    }
    try {
      const { error } = await supabase
        .from('registrations')
        .update({
          video_url: url,
          video_status: 'submitted',
          video_submitted_at: new Date().toISOString(),
        })
        .eq('id', regId);
      if (error) throw error;
      setRegistrations(prev =>
        prev.map(r => r.id === regId ? { ...r, video_url: url, video_status: 'submitted' as any } : r)
      );
      setEditingVideo(null);
      setVideoLinkInput('');
      setActionError(p => ({ ...p, [regId]: '' }));
    } catch (e: any) {
      setActionError(p => ({ ...p, [regId]: e.message ?? 'Erro ao salvar.' }));
    }
  };

  const handleDelete = async (reg: Registration) => {
    setDeleting(true);
    setError(null);
    try {
      // Se está numa fatura agregada, primeiro precisamos desfazer.
      // O webhook não pode confirmar uma fatura cuja registrations sumiram.
      // Decisão simples: bloqueia delete quando faz parte de payment PENDENTE.
      // (Sessão futura: cancelar Asaas + remover só essa registration do grupo.)
      if (reg.payment_group_id) {
        throw new Error(
          'Esta inscrição está agrupada numa fatura. Cancele a fatura no checkout ' +
          'ou aguarde o prazo expirar antes de remover.'
        );
      }
      const { error: delErr } = await supabase.from('registrations').delete().eq('id', reg.id);
      if (delErr) throw delErr;
      setRegistrations(prev => prev.filter(r => r.id !== reg.id));
      setConfirmDel(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-16 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  const totalPendentesGlobal = grupos.reduce((s, g) => s + g.pendentes.length, 0);
  const totalConfirmadasGlobal = grupos.reduce(
    (s, g) => s + g.outras.filter(r => r.status_pagamento === 'APROVADO').length,
    0
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
            Minhas <span className="text-[#ff0068]">Inscrições</span>
          </h1>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
            {registrations.length} coreo{registrations.length === 1 ? 'grafia' : 'grafias'}
            {totalConfirmadasGlobal > 0 && ` · ${totalConfirmadasGlobal} confirmada${totalConfirmadasGlobal !== 1 ? 's' : ''}`}
            {totalPendentesGlobal > 0 && ` · ${totalPendentesGlobal} pendente${totalPendentesGlobal !== 1 ? 's' : ''}`}
            {seletivaCount > 0 && ` · ${seletivaCount} em análise`}
            {workshops.length > 0 && ` · ${workshops.length} workshop${workshops.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Banner "X em análise" removido — agora vira tab "Em análise" no topo
          + seção dedicada dentro de cada card de evento (refactor 2026-05-19). */}

      {/* ── Banner "Inscrição criada" ── */}
      {novaId && registrations.some(r => r.id === novaId) && (
        <div className="flex items-start gap-3 p-4 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
          <CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
              Inscrição adicionada
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Adicione mais coreografias antes de pagar pra economizar — pague tudo de uma vez no botão "Pagar todas".
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-600 dark:text-slate-300 text-sm">
          <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {registrations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center">
            <Music2 size={20} className="text-slate-400" />
          </div>
          <div>
            <p className="font-black uppercase tracking-tight text-slate-500">Nenhuma inscrição ainda</p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Acesse a vitrine pública do festival pra se inscrever
            </p>
          </div>
        </div>
      )}

      {/* ── Tabs (padrão Sympla/Eventbrite) ── */}
      {grupos.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {([
            { key: 'upcoming' as Tab, label: 'Próximas',  count: tabCounts.upcoming },
            { key: 'all'      as Tab, label: 'Todas',     count: tabCounts.all },
            { key: 'selecao'  as Tab, label: 'Em análise', count: tabCounts.selecao },
            { key: 'past'     as Tab, label: 'Anteriores', count: tabCounts.past },
          ]).map(t => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                  active
                    ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/20'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {t.label}
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${active ? 'bg-white/20' : 'bg-slate-200 dark:bg-white/10'}`}>{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {filteredGrupos.length === 0 && grupos.length > 0 && (
        <div className="py-12 flex flex-col items-center gap-3 bg-slate-50 dark:bg-white/5 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nada nessa aba.</p>
          <button onClick={() => setActiveTab('all')} className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline">
            Ver todas →
          </button>
        </div>
      )}

      {/* ── Grupos por evento ── */}
      {filteredGrupos.map(grupo => (
        <div key={grupo.eventId} className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden">

          {/* Cabeçalho do evento */}
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/5 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                {grupo.eventNome}
              </p>
              <div className="flex flex-wrap gap-3 mt-0.5">
                {grupo.eventData && (
                  <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                    <Calendar size={9} /> {fmtDate(grupo.eventData)}
                  </span>
                )}
                {grupo.eventLocal && (
                  <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1 truncate">
                    <MapPin size={9} /> {grupo.eventLocal}
                  </span>
                )}
              </div>
            </div>
            {grupo.eventSlug && (
              <button
                onClick={() => navigate(`/festival/${grupo.eventSlug}/inscrever`)}
                className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] flex items-center gap-1 shrink-0"
                title="Inscrever mais coreografias"
              >
                <Plus size={12} /> Nova inscrição
              </button>
            )}
          </div>

          {/* CTA agregado quando há pendentes */}
          {grupo.pendentes.length > 0 && (() => {
            // Se já tem fatura PENDENTE no Asaas, usa o valor dela. Senão, soma estimada.
            const total = grupo.payment?.value_total ?? grupo.totalPendente;
            const expiraDias = grupo.payment?.expires_at ? diasAte(grupo.payment.expires_at) : null;
            return (
              <div className="px-5 py-4 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                      Pagar todas
                    </p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5 tabular-nums">
                      {fmtMoney(total)}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                      {grupo.pendentes.length} coreografia{grupo.pendentes.length !== 1 ? 's' : ''} em 1 PIX
                      {expiraDias != null && expiraDias <= 7 && (
                        <span className="text-slate-500 ml-2">
                          · {expiraDias === 0 ? 'Vence hoje' : `Vence em ${expiraDias} dia${expiraDias !== 1 ? 's' : ''}`}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => handlePagarAgregado(grupo)}
                    disabled={payingEvent === grupo.eventId}
                    className="flex items-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-40 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all"
                  >
                    {payingEvent === grupo.eventId ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <ShoppingCart size={13} />
                    )}
                    Pagar tudo
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Lista de inscrições */}
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {[...grupo.pendentes, ...grupo.outras].map(reg => {
              const st = statusCfg(reg.status_pagamento);
              const isNova = reg.id === novaId;
              const isPendente = reg.status_pagamento === 'PENDENTE';
              const modalidade = reg.tipo_apresentacao ?? reg.formato_participacao ?? null;
              // Preço a mostrar: pagas usam valor_pago real; pendentes usam o
              // calculado client-side (_precoDisplay) com base na formação.
              const valorMostrar = isPendente
                ? reg._precoDisplay ?? null
                : (reg.valor_pago ?? reg.charged_amount ?? reg._precoDisplay ?? null);

              return (
                <div
                  key={reg.id}
                  className={`p-4 flex items-start gap-3 transition-colors ${isNova ? 'bg-slate-50 dark:bg-white/[0.02]' : ''}`}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-slate-100 dark:bg-white/5">
                    <Clapperboard size={14} className="text-slate-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                          {reg.nome_coreografia || 'Sem nome'}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {modalidade && (
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 text-slate-500 text-[8px] font-black uppercase tracking-widest rounded-full">{modalidade}</span>
                          )}
                          {reg.categoria && (
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 text-slate-500 text-[8px] font-black uppercase tracking-widest rounded-full">{reg.categoria}</span>
                          )}
                          {reg.estilo_danca && (
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 text-slate-500 text-[8px] font-black uppercase tracking-widest rounded-full">{reg.estilo_danca}</span>
                          )}
                        </div>
                      </div>

                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${st.bg} ${st.text} ${st.tone === 'ok' ? 'border-emerald-200 dark:border-emerald-500/20' : st.tone === 'pendente' ? 'border-amber-200 dark:border-amber-500/20' : 'border-slate-200 dark:border-white/10'}`}>
                        {st.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                      <div className="text-[10px] font-bold text-slate-500 flex items-center gap-3 tabular-nums">
                        {valorMostrar != null && (
                          <span>{fmtMoney(valorMostrar)}</span>
                        )}
                        {reg.paid_at && (
                          <span className="flex items-center gap-1 text-slate-400">
                            <Clock size={9} /> Pago em {fmtDate(reg.paid_at)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {st.tone === 'ok' && (
                          <>
                            <button
                              onClick={() => navigate('/central-de-midia')}
                              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5 transition-all"
                              title="Enviar trilha sonora desta coreografia"
                            >
                              <Music2 size={11} /> Trilha
                            </button>
                            <button
                              onClick={() => navigate(`/credencial/${reg.id}`)}
                              className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                              title="Credencial (QR)"
                            >
                              <QrCode size={13} />
                            </button>
                          </>
                        )}
                        {isPendente && (
                          <button
                            onClick={() => handlePagarSingle(reg)}
                            disabled={payingSingle === reg.id}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5 disabled:opacity-50 transition-all"
                            title="Pagar só esta inscrição"
                          >
                            {payingSingle === reg.id
                              ? <Loader2 size={11} className="animate-spin" />
                              : <CreditCard size={11} />}
                            Pagar só esta
                          </button>
                        )}
                        {isPendente && !reg.payment_group_id && (
                          <button
                            onClick={() => setConfirmDel(reg)}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                            title="Remover inscrição"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Seção SELETIVA DE VÍDEO (cards inline) ── */}
          {grupo.seletiva.length > 0 && (
            <div className="border-t border-slate-200 dark:border-white/10 p-5 bg-amber-500/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-3">
                <Video size={11} /> Em análise da seletiva ({grupo.seletiva.length})
              </p>
              <div className="space-y-3">
                {grupo.seletiva.map(reg => {
                  const feePending = reg.video_fee_status === 'pending';
                  const fee = Number(reg._videoFee ?? 0);
                  const isEditing = editingVideo === reg.id;
                  return (
                    <div key={reg.id} className="bg-white dark:bg-slate-900/60 border border-amber-500/20 rounded-2xl p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-black text-sm text-slate-900 dark:text-white">{reg.nome_coreografia ?? 'Coreografia'}</p>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                            {[reg.tipo_apresentacao, reg.formato_participacao, reg.categoria, reg.estilo_danca].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase tracking-widest shrink-0">
                          🎬 Em análise
                        </span>
                      </div>

                      {/* Link do vídeo (read-only ou edit inline) */}
                      {isEditing ? (
                        <div className="flex gap-2">
                          <input
                            type="url"
                            value={videoLinkInput}
                            onChange={e => setVideoLinkInput(e.target.value)}
                            placeholder="https://youtube.com/..."
                            className="flex-1 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:border-[#ff0068]"
                          />
                          <button
                            onClick={() => handleSaveVideoLink(reg.id)}
                            className="px-3 py-2 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                          >Salvar</button>
                          <button
                            onClick={() => { setEditingVideo(null); setVideoLinkInput(''); }}
                            className="px-3 py-2 text-slate-500 text-[10px] font-black uppercase tracking-widest"
                          >Cancelar</button>
                        </div>
                      ) : reg.video_url ? (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-slate-400">Vídeo:</span>
                          <a href={reg.video_url} target="_blank" rel="noopener noreferrer" className="text-[#ff0068] hover:underline truncate">{reg.video_url}</a>
                          <button
                            onClick={() => { setEditingVideo(reg.id); setVideoLinkInput(reg.video_url ?? ''); }}
                            className="ml-auto text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068]"
                          >Trocar</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingVideo(reg.id); setVideoLinkInput(''); }}
                          className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline"
                        >+ Adicionar link do vídeo</button>
                      )}

                      {actionError[reg.id] && (
                        <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest">{actionError[reg.id]}</p>
                      )}

                      {/* Ações */}
                      {feePending && fee > 0 && (
                        <div className="pt-2 border-t border-amber-500/10 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">Taxa de seletiva</p>
                              <p className="text-base font-black text-slate-900 dark:text-white tabular-nums">{fmtMoney(fee)}</p>
                            </div>
                            <button
                              onClick={() => handlePagarTaxa(reg, couponInputs[reg.id])}
                              disabled={payingTaxa === reg.id}
                              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0"
                            >
                              {payingTaxa === reg.id ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                              Pagar taxa
                            </button>
                          </div>
                          {/* Cupom: input expansível. Mantém checkout limpo pra
                              quem não tem cupom — clica em "Tem cupom?" pra abrir. */}
                          {showCoupon[reg.id] ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={couponInputs[reg.id] ?? ''}
                                onChange={e => setCouponInputs(p => ({ ...p, [reg.id]: e.target.value.toUpperCase() }))}
                                placeholder="Código do cupom"
                                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500/50 uppercase"
                              />
                              <button
                                onClick={() => { setShowCoupon(p => ({ ...p, [reg.id]: false })); setCouponInputs(p => ({ ...p, [reg.id]: '' })); }}
                                className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-2"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setShowCoupon(p => ({ ...p, [reg.id]: true }))}
                              className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 hover:underline"
                            >
                              Tem cupom?
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Seção WORKSHOPS ── */}
          {grupo.workshops.length > 0 && (
            <div className="border-t border-slate-200 dark:border-white/10 p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5 mb-3">
                <Clapperboard size={11} /> Workshops ({grupo.workshops.length})
              </p>
              <div className="space-y-2">
                {grupo.workshops.map(w => (
                  <div key={w.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-white/5 rounded-xl p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-slate-900 dark:text-white truncate">{w.workshops?.title ?? 'Workshop'}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {w.workshops?.instructor_name && <>com <strong>{w.workshops.instructor_name}</strong> · </>}
                        {w.workshops?.date_from && fmtDate(w.workshops.date_from)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-black text-slate-700 dark:text-slate-200 tabular-nums">{fmtMoney(w.preco_pago)}</p>
                      <p className={`text-[9px] font-black uppercase tracking-widest ${
                        w.status_pagamento === 'APROVADO' || w.status_pagamento === 'PAGO' ? 'text-emerald-500' :
                        w.status_pagamento === 'PENDENTE' ? 'text-amber-500' : 'text-slate-400'
                      }`}>{w.status_pagamento ?? '—'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      ))}

      {/* ── Aviso CPF faltando ── */}
      {registrations.length > 0 && totalPendentesGlobal > 0 && !profileCpf && (
        <div className="flex items-start gap-3 p-4 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
              CPF necessário pra pagar
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Pra gerar a fatura, complete seu CPF no perfil.
            </p>
            <button
              onClick={() => navigate('/profile')}
              className="mt-2 px-3 py-1.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-[9px] uppercase tracking-widest"
            >
              Completar perfil
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          DELETE CONFIRMATION
      ══════════════════════════════════════════════════════════ */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={18} className="text-rose-500" />
            </div>
            <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">
              Remover {confirmDel.nome_coreografia || 'inscrição'}?
            </h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDel(null)}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDel)}
                disabled={deleting}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <><Trash2 size={12} /> Remover</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MinhasCoreografias;

/**
 * Compat com import default — SystemErrorBanner inutilizado no novo layout
 * mas mantido pra evitar bug em outros lugares que façam side-imports.
 */
void SystemErrorBanner;
