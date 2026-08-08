import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import SystemErrorBanner from '../components/SystemErrorBanner';
import {
  Music2, Plus, Trash2, AlertCircle, Loader2, CheckCircle,
  Clapperboard, Calendar, MapPin, Clock, CreditCard, QrCode,
  ChevronRight, AlertTriangle, ShoppingCart, X, Video,
  Users, Pencil, Save, RefreshCw, Lock as LockIcon, Tag, Sparkles, Link2, Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import BailarinosEditor, { type BailarinoFormValue } from '../components/BailarinosEditor';
import StaffTecnicoEditor, { type StaffTecnicoValue } from '../components/StaffTecnicoEditor';
import { unmaskCpfCnpj, validateCpf, parseDataISO, maskCpfCnpj, maskData } from '../utils/masks';
import {
  collectAllBailarinosIds,
  type ElencoById,
  type ElencoRow,
} from '../utils/bailarinos';
import { validateCoupon } from '../services/couponService';
import { isRegistrationPaid } from '../utils/registrationStatus';

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
  staff_tecnico?:        StaffTecnicoValue[] | null;
  instagram_principal?:  string | null;
  discount_token?:       string | null;
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
  /** Snapshot do desconto aplicado no momento da criação (cupom). Padrão
   *  Stripe/Sympla: fatura PENDENTE é imutável — UI mostra o desconto
   *  persistido quando inscrito volta. */
  discount_total?:  number | null;
  coupon_id?:       string | null;
  coupon_code?:     string | null;
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
  // event_id -> tem workshop publicado pra vender. Alimenta o card de upsell
  // "Garanta seu workshop com preço de inscrito" por evento.
  const [eventsWithWorkshops, setEventsWithWorkshops] = useState<Record<string, boolean>>({});
  // id da inscrição cujo link de desconto acabou de ser copiado — feedback
  // visual de 2s no botão (mesmo padrão de Registrations.tsx).
  const [copiedDiscountId, setCopiedDiscountId] = useState<string | null>(null);
  const [profileCpf, setProfileCpf]          = useState<string | null>(null);
  const [loading,  setLoading]               = useState(true);
  const [error,    setError]                 = useState<string | null>(null);

  const [confirmDel, setConfirmDel]          = useState<Registration | null>(null);
  const [payingEvent, setPayingEvent]        = useState<string | null>(null);
  const [payingSingle, setPayingSingle]      = useState<string | null>(null);
  const [payingTaxa,   setPayingTaxa]        = useState<string | null>(null);
  // Modal contextual de CPF (padrão Stripe/Sympla): em vez de navegar pra
  // /profile completo (tela com 8 campos), abre modal com 1 campo só, salva,
  // banner some, fluxo de pagamento continua sem detour. Refator 2026-05-25.
  const [cpfModalOpen, setCpfModalOpen]      = useState(false);
  const [cpfDraft, setCpfDraft]              = useState('');
  const [cpfSaving, setCpfSaving]            = useState(false);
  const [cpfError, setCpfError]              = useState<string | null>(null);
  // Mesmo padrão do CPF, pro nome completo — gate acionado quando o profile
  // veio do login Google com só 1 palavra (apelido/nome social) ou vazio.
  // Nome completo é necessário pra certificado/credencial/nota fiscal.
  const [fullNameModalOpen, setFullNameModalOpen] = useState(false);
  const [fullNameDraft, setFullNameDraft]         = useState('');
  const [fullNameSaving, setFullNameSaving]       = useState(false);
  const [fullNameError, setFullNameError]         = useState<string | null>(null);
  // Reseta os 3 "paying" quando a página volta do bfcache (user clica
  // Voltar no browser depois de ir pro Asaas via window.location.href).
  // Sem isso, o spinner do botão fica girando indefinidamente até F5.
  useEffect(() => {
    const reset = () => {
      setPayingEvent(null);
      setPayingSingle(null);
      setPayingTaxa(null);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  const [couponInputs, setCouponInputs]      = useState<Record<string, string>>({});
  const [showCoupon,   setShowCoupon]        = useState<Record<string, boolean>>({});
  // Cupom no agregado — keyed por event_id (1 cupom por fatura agregada).
  // Padrão Stripe/Sympla/Checkout.tsx: input + botão "Aplicar" → validateCoupon
  // client-side (preview do desconto antes de pagar) → user confirma → server
  // re-valida no momento da criação da fatura (dupla checagem).
  // Aplicado só na CRIAÇÃO da fatura; fatura PENDENTE já criada no Asaas não
  // recebe cupom retroativo (limitação v1).
  const [aggregateCouponInputs,    setAggregateCouponInputs]    = useState<Record<string, string>>({});
  const [showAggregateCoupon,      setShowAggregateCoupon]      = useState<Record<string, boolean>>({});
  const [appliedAggregateCoupons,  setAppliedAggregateCoupons]  = useState<Record<string, { id: string; code: string; discount: number } | null>>({});
  const [applyingAggregateCoupon,  setApplyingAggregateCoupon]  = useState<Record<string, boolean>>({});
  const [aggregateCouponErrors,    setAggregateCouponErrors]    = useState<Record<string, string | null>>({});
  const [deleting,    setDeleting]           = useState(false);
  const [editingVideo, setEditingVideo]      = useState<string | null>(null);
  const [videoLinkInput, setVideoLinkInput]  = useState('');
  const [actionError,  setActionError]       = useState<Record<string, string>>({});

  // Sessão A1 (2026-05-22): inscrito edita dados dos próprios bailarinos
  // direto na /minhas-coreografias. Modal centralizado quando editingBailarinos
  // tem o id da reg. Editor reusado de components/BailarinosEditor.tsx.
  const [editingBailarinos, setEditingBailarinos]   = useState<string | null>(null);
  const [bailarinosForm, setBailarinosForm]         = useState<BailarinoFormValue[]>([]);
  const [instagramPrincipalForm, setInstagramPrincipalForm] = useState<string>('');
  const [staffTecnicoForm, setStaffTecnicoForm]     = useState<StaffTecnicoValue[]>([]);
  const [savingBailarinos, setSavingBailarinos]     = useState(false);
  const [bailarinosError, setBailarinosError]       = useState<string | null>(null);
  // Map event_id → prazo_inscricao (YYYY-MM-DD) pra travar edição após deadline.
  // Decisão 1B locked 2026-05-22: vazio = livre (produtor não definiu).
  const [prazosPorEvento, setPrazosPorEvento] = useState<Record<string, string | null>>({});
  // Map event_id → formacoes_config pra puxar min/max members da modalidade.
  const [formacoesPorEvento, setFormacoesPorEvento] = useState<Record<string, any[]>>({});
  // Map de rows da tabela `elenco` referenciadas em bailarinos_detalhes das
  // inscrições do user. Fonte de verdade dos dados pessoais (CPF/data/nome).
  // Refator 2026-06-01 — o JSONB só tem id+nome+instagram_handle por design.
  const [elencoById, setElencoById] = useState<ElencoById>({});
  // ID do user autenticado, cacheado no fetchAll inicial. Evita round-trips
  // extras a cada click em "Aplicar cupom" (que precisa validar
  // max_uses_per_user via supabase.auth.getUser).
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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
      setCurrentUserId(user.id);

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
          bailarinos_detalhes, instagram_principal, staff_tecnico,
          video_url, video_status, video_fee_status, video_approved_at,
          discount_token
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
            .select('event_id, formatos_precos, prazo_inscricao')
            .in('event_id', eventIds),
        ]);
        for (const ev of (eventsData  ?? [])) eventsMap[ev.id]        = ev;
        for (const cf of (configsData ?? [])) configsMap[cf.event_id] = cf;

        // A1 (2026-05-22): popula prazo_inscricao + formacoes_config pra editor
        // de bailarinos. Decisão 1B: prazo vazio = edição livre.
        const prazos: Record<string, string | null> = {};
        const formacoes: Record<string, any[]> = {};
        for (const cf of (configsData ?? [])) prazos[cf.event_id] = cf.prazo_inscricao ?? null;
        for (const ev of (eventsData ?? [])) formacoes[ev.id] = ev.formacoes_config ?? [];
        setPrazosPorEvento(prazos);
        setFormacoesPorEvento(formacoes);

        // Upsell de workshop: só mostra o card se o evento tem workshop
        // publicado pra vender (evita CTA pra página sem nada).
        const { data: wsAvailable } = await supabase
          .from('workshops')
          .select('event_id')
          .in('event_id', eventIds)
          .eq('is_published', true);
        const wsMap: Record<string, boolean> = {};
        for (const w of (wsAvailable ?? [])) wsMap[w.event_id] = true;
        setEventsWithWorkshops(wsMap);
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

      // Hidrata elenco em batch. Fonte de verdade dos dados pessoais —
      // o JSONB bailarinos_detalhes só tem id+nome+@. RLS inscrito_own_elenco
      // cobre (user_id = auth.uid).
      const allBailarinosIds = collectAllBailarinosIds(regs);
      if (allBailarinosIds.length > 0) {
        const { data: elenco } = await supabase
          .from('elenco')
          .select('id, nome, cpf, data_nascimento')
          .in('id', allBailarinosIds);
        const map: ElencoById = Object.fromEntries(
          (elenco ?? []).map((e: ElencoRow) => [e.id, e])
        );
        setElencoById(map);
      } else {
        setElencoById({});
      }

      // Active payments: 1 PENDENTE por evento (no máximo). JOIN com coupons
      // pra ler o code aplicado (refator cupom 2026-06-01 — fatura PENDENTE
      // exibe desconto persistido quando inscrito volta do gateway).
      const { data: payments } = await supabase
        .from('payments')
        .select('id, user_id, event_id, value_total, discount_total, coupon_id, asaas_payment_id, payment_url, status, expires_at, created_at, paid_at, coupons(code)')
        .eq('user_id', user.id)
        .eq('status', 'PENDENTE');
      const map: Record<string, AggregatePayment> = {};
      for (const p of (payments ?? [])) {
        const coupon = (p as any).coupons as { code: string } | null;
        map[p.event_id] = {
          ...(p as any),
          coupon_code: coupon?.code ?? null,
        } as AggregatePayment;
      }
      setActivePayments(map);

      // Workshops do user (best-effort — RLS pode bloquear se conta deletada).
      // Sem embed PostgREST `workshops(...)` porque dispara 400 cosmético no
      // console quando a query roda em condições específicas. Fetch em 2 passos:
      // registrations -> in() dos workshop_ids. Espelha o mesmo padrão de
      // registrations->events (linha 224 acima).
      try {
        const userEmail = user.email ?? '';
        let ws: any[] = [];
        if (userEmail) {
          const { data: wsRaw } = await supabase
            .from('workshop_registrations')
            .select('id, workshop_id, buyer_email, buyer_name, status_pagamento, preco_pago, paid_at, access_token, created_at')
            .eq('buyer_email', userEmail)
            .order('created_at', { ascending: false });
          const wsList = wsRaw ?? [];
          const wsIds = Array.from(new Set(wsList.map((r: any) => r.workshop_id).filter(Boolean)));
          let wsMap: Record<string, any> = {};
          if (wsIds.length > 0) {
            const { data: wks } = await supabase
              .from('workshops')
              .select('id, event_id, title, date_from, instructor_name')
              .in('id', wsIds);
            for (const w of (wks ?? [])) wsMap[w.id] = w;
          }
          ws = wsList.map((r: any) => ({ ...r, workshops: wsMap[r.workshop_id] ?? null }));
        }
        setWorkshops(ws);
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

    // O CPF pode ter sido auto-capturado do wizard (1º bailarino) — nesse caso
    // o pagador precisa confirmar/editar antes da 1ª cobrança, porque quem paga
    // (coreógrafo) nem sempre é o bailarino. Depois de confirmado uma vez, não
    // pedimos de novo (flag local por usuário).
    const confirmKey = `coreohub_cpf_confirmado_${user.id}`;
    const jaConfirmado = (() => {
      try { return localStorage.getItem(confirmKey) === '1'; } catch { return false; }
    })();

    if (!cpf || !jaConfirmado) {
      // Vazio → digita do zero. Pré-capturado → vem preenchido pra confirmar.
      // (Modal contextual de 1 campo, padrão Stripe/Sympla — refator 2026-05-25.)
      setCpfDraft(cpf ? maskCpfCnpj(cpf) : '');
      setCpfError(null);
      setCpfModalOpen(true);
      return false;
    }
    return true;
  };

  /** Save do CPF via modal contextual. Persiste em ambas as colunas
   *  (cpf_cnpj canônica + document legada por dual-write) pra match com
   *  o que o Profile.tsx agora faz desde 2026-05-25. */
  const handleSaveCpfFromModal = async () => {
    const digits = unmaskCpfCnpj(cpfDraft);
    if (digits.length !== 11) {
      setCpfError('CPF precisa ter 11 dígitos.');
      return;
    }
    if (!validateCpf(digits)) {
      setCpfError('CPF inválido — confere os dígitos.');
      return;
    }
    setCpfSaving(true);
    setCpfError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada — faça login de novo.');
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ cpf_cnpj: digits, document: digits })
        .eq('id', user.id);
      if (upErr) throw upErr;
      // Atualiza state local pra banner sumir imediatamente sem refetch.
      setProfileCpf(digits);
      // Marca como confirmado pelo pagador — não reabre o modal nas próximas
      // compras (a captura automática do wizard já foi revisada por um humano).
      try { localStorage.setItem(`coreohub_cpf_confirmado_${user.id}`, '1'); } catch { /* noop */ }
      setCpfModalOpen(false);
    } catch (e: any) {
      setCpfError(e.message ?? 'Erro ao salvar CPF.');
    } finally {
      setCpfSaving(false);
    }
  };

  /** Valida nome completo antes de pagar. Login Google às vezes traz só 1
   *  palavra (apelido/nome social) — insuficiente pra certificado/credencial/
   *  nota fiscal. Sempre consulta fresh do banco (mesmo motivo do requireCpf). */
  const requireFullName = async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/auth');
      return false;
    }
    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    const nome = String(prof?.full_name ?? '').trim();
    const temSobrenome = nome.split(/\s+/).filter(Boolean).length >= 2;
    if (!temSobrenome) {
      setFullNameDraft(nome);
      setFullNameError(null);
      setFullNameModalOpen(true);
      return false;
    }
    return true;
  };

  const handleSaveFullNameFromModal = async () => {
    const nome = fullNameDraft.trim();
    if (nome.split(/\s+/).filter(Boolean).length < 2) {
      setFullNameError('Digite nome e sobrenome.');
      return;
    }
    setFullNameSaving(true);
    setFullNameError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada — faça login de novo.');
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ full_name: nome })
        .eq('id', user.id);
      if (upErr) throw upErr;
      setFullNameModalOpen(false);
    } catch (e: any) {
      setFullNameError(e.message ?? 'Erro ao salvar nome.');
    } finally {
      setFullNameSaving(false);
    }
  };

  /**
   * Aplica cupom client-side via validateCoupon — mostra preview do desconto
   * ANTES de criar a fatura Asaas. Padrão Stripe/Sympla/Checkout.tsx legacy.
   * Server re-valida no create-aggregate-payment-asaas (dupla checagem +
   * incremento atômico do used_count).
   *
   * Se há fatura PENDENTE no banco, cancela silenciosamente ANTES de
   * aplicar — fatura Asaas tem valor congelado; pra mudar precisa refazer.
   * User não vê essa complexidade.
   */
  const handleApplyAggregateCoupon = async (eventId: string, baseTotal: number, grupo?: Grupo) => {
    const code = aggregateCouponInputs[eventId]?.trim();
    if (!code) return;
    setApplyingAggregateCoupon(p => ({ ...p, [eventId]: true }));
    setAggregateCouponErrors(p => ({ ...p, [eventId]: null }));
    try {
      // Se fatura PENDENTE existe, cancela ANTES de validar/aplicar — pra
      // user sempre poder aplicar cupom (UI nunca trava por fatura existente).
      const existingPayment = grupo?.payment;
      if (existingPayment?.id) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-aggregate-payment`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type':  'application/json',
                },
                body: JSON.stringify({ payment_id: existingPayment.id }),
              }
            );
            // Update local — tira payment + zera registrations linkadas.
            setActivePayments(prev => {
              const next = { ...prev };
              delete next[eventId];
              return next;
            });
            setRegistrations(prev => prev.map(r =>
              r.payment_group_id === existingPayment.id
                ? { ...r, payment_group_id: null, payment_url: null, payment_preference_id: null, charged_amount: null }
                : r
            ));
          }
        } catch (cancelErr) {
          console.warn('[apply coupon] falha cancelar fatura existente:', (cancelErr as Error).message);
          // Não bloqueia — tenta aplicar cupom mesmo assim.
        }
      }

      // userId cacheado no fetchAll inicial — evita round-trip extra a cada
      // click no botão "Aplicar".
      const { coupon, discount } = await validateCoupon(eventId, code, baseTotal, currentUserId ?? undefined);
      setAppliedAggregateCoupons(p => ({ ...p, [eventId]: { id: coupon.id, code: coupon.code, discount } }));
    } catch (e: any) {
      setAggregateCouponErrors(p => ({ ...p, [eventId]: e?.message ?? 'Cupom inválido.' }));
    } finally {
      setApplyingAggregateCoupon(p => ({ ...p, [eventId]: false }));
    }
  };

  const handleRemoveAggregateCoupon = (eventId: string) => {
    setAppliedAggregateCoupons(p => ({ ...p, [eventId]: null }));
    setAggregateCouponInputs(p => ({ ...p, [eventId]: '' }));
    setAggregateCouponErrors(p => ({ ...p, [eventId]: null }));
    setShowAggregateCoupon(p => ({ ...p, [eventId]: false }));
  };

  /**
   * Handler unificado do "X" pra remover cupom. UX padrão: user clica X →
   * sistema decide silenciosamente:
   *   - Sem fatura criada → só limpa state (mesmo handler do applied client).
   *   - Com fatura PENDENTE + cupom → cancela fatura no Asaas + zera local.
   *     Sem confirmação extra (click no X é intenção explícita).
   *
   * Padrão Sympla/Stripe: o user não precisa entender a diferença entre
   * "remover cupom client" e "cancelar fatura". A complexidade fica embutida.
   */
  const [cancellingPayment, setCancellingPayment]       = useState<string | null>(null);
  const [partialCancelWarning, setPartialCancelWarning] = useState<string | null>(null);

  const handleUnifiedRemoveCoupon = async (grupo: Grupo) => {
    const faturaComCupom = grupo.payment?.id && grupo.payment?.coupon_id;
    if (!faturaComCupom) {
      handleRemoveAggregateCoupon(grupo.eventId);
      return;
    }
    const paymentId = grupo.payment!.id;
    setCancellingPayment(paymentId);
    setError(null);
    setPartialCancelWarning(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada.');
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-aggregate-payment`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ payment_id: paymentId }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error ?? 'Erro ao remover cupom.');

      // Edge function retorna 'partial_cancel' quando Asaas 5xx — banner âmbar
      // avisa inscrito que pode haver desincronia.
      if (data?.status === 'partial_cancel') {
        setPartialCancelWarning(
          'Cupom removido, mas o Asaas pode demorar a refletir. ' +
          'Se você receber cobrança pelo link antigo, contate o produtor.'
        );
      }

      // Update local: tira payment do activePayments + zera link das
      // registrations. ~6 round-trips a menos que await fetchAll().
      setActivePayments(prev => {
        const next = { ...prev };
        delete next[grupo.eventId];
        return next;
      });
      setRegistrations(prev => prev.map(r =>
        r.payment_group_id === paymentId
          ? { ...r, payment_group_id: null, payment_url: null, payment_preference_id: null, charged_amount: null }
          : r
      ));
      handleRemoveAggregateCoupon(grupo.eventId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCancellingPayment(null);
    }
  };

  const handlePagarAgregado = async (grupo: Grupo) => {
    if (!(await requireFullName())) return;
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

      const body: Record<string, any> = {
        event_id:         grupo.eventId,
        registration_ids: grupo.pendentes.map(r => r.id),
      };
      // Cupom: prioriza o que foi APLICADO via botão (validado client-side).
      // Fallback no input solto (pra retrocompat caso UI mude).
      const appliedCode = appliedAggregateCoupons[grupo.eventId]?.code;
      const rawCode = aggregateCouponInputs[grupo.eventId]?.trim();
      const couponCode = appliedCode ?? rawCode;
      if (couponCode) body.coupon_code = couponCode;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-aggregate-payment-asaas`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify(body),
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
      // Evento/carrinho 100% gratuito — já aprovado direto, sem Asaas.
      if (data?.free) {
        await fetchAll();
        setPayingEvent(null);
        return;
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
    if (!(await requireFullName())) return;
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

      // Cupom NÃO aplicado em single payment (decisão de produto 2026-05-25).
      // Cupom só funciona em "PAGAR TUDO" (aggregate) — padrão Stripe/Sympla/
      // iFood/Hotmart de 1 cupom por sessão de checkout. Evita exploit onde
      // cupom valor fixo + max_uses_per_user > 1 daria desconto > prorrateado.
      const body: Record<string, any> = {
        registration_id: reg.id,
        event_id:        reg.event_id,
      };

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment-asaas`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify(body),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error ?? 'Erro ao gerar pagamento.');
      // Formação gratuita — já aprovado direto, sem Asaas.
      if (data?.free) {
        await fetchAll();
        setPayingSingle(null);
        return;
      }
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
    if (!(await requireFullName())) return;
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
    // Mesma validação anti-playlist do Wizard: jurado precisa de 1 vídeo único.
    const lower = url.toLowerCase();
    if (/[?&]list=/.test(lower) || /youtube\.com\/playlist\b/.test(lower)) {
      setActionError(p => ({ ...p, [regId]: 'Cole o link de UM vídeo (não playlist). Remova `&list=...` ou copie de novo direto do vídeo.' }));
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

  // A1 (2026-05-22): abre modal de edição de bailarinos. Clone profundo dos
  // dados pra editValues + mascara CPF/data pra digitação confortável.
  // RLS `inscrito_own_registrations` cobre o UPDATE — sem migration nova.
  const startEditingBailarinos = (reg: Registration) => {
    setEditingBailarinos(reg.id);
    setBailarinosError(null);
    // Refator 2026-06-01: CPF/data/nome reais vêm da tabela `elenco` (JSONB
    // bailarinos_detalhes só tem id+nome+@). elencoId carrega o id da row
    // pra save fazer UPDATE em vez de INSERT.
    setBailarinosForm(Array.isArray(reg.bailarinos_detalhes)
      ? reg.bailarinos_detalhes.map((b: any) => {
          const elenco = b?.id ? elencoById[b.id] : null;
          // ISO YYYY-MM-DD → DD/MM/AAAA via maskData (input mascarado)
          const dobIso = String(elenco?.data_nascimento ?? '').trim();
          const dobBR = dobIso
            ? maskData(dobIso.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3$2$1'))
            : '';
          return {
            elencoId:         b?.id || undefined,
            nome:             elenco?.nome ?? b?.nome ?? '',
            cpf:              maskCpfCnpj(String(elenco?.cpf ?? '')),
            data_nascimento:  dobBR,
            instagram_handle: b?.instagram_handle ?? '',
          };
        })
      : []);
    setInstagramPrincipalForm(reg.instagram_principal ?? '');
    setStaffTecnicoForm(Array.isArray(reg.staff_tecnico) ? reg.staff_tecnico : []);
  };

  const cancelEditingBailarinos = () => {
    setEditingBailarinos(null);
    setBailarinosForm([]);
    setInstagramPrincipalForm('');
    setStaffTecnicoForm([]);
    setBailarinosError(null);
  };

  const handleSaveBailarinos = async (reg: Registration) => {
    setSavingBailarinos(true);
    setBailarinosError(null);
    try {
      // Decisão 1B locked 2026-05-22: prazo vazio = edição livre. Se preenchido
      // e expirado, trava.
      if (reg.event_id) {
        const prazo = prazosPorEvento[reg.event_id];
        if (prazo) {
          const today = new Date().toISOString().slice(0, 10);
          if (prazo < today) {
            throw new Error('Inscrições encerradas no evento. Peça pro produtor editar.');
          }
        }
      }

      const formato = reg.formato_participacao ?? '';
      const isGrupoLike = formato === 'Grupo' || formato === 'Conjunto';

      // Normaliza + valida. Mesmas regras de handleSaveEdit em Registrations.
      type Normalized = {
        elencoId?: string;
        nome: string;
        cpf: string;
        data_nascimento: string;
        instagram_handle?: string;
      };
      const normalized: Normalized[] = [];
      for (let i = 0; i < bailarinosForm.length; i++) {
        const b = bailarinosForm[i];
        const cpfDigits = unmaskCpfCnpj(String(b?.cpf ?? ''));
        if (cpfDigits && cpfDigits.length === 11 && !validateCpf(cpfDigits)) {
          throw new Error(`CPF inválido no bailarino ${i + 1}${b?.nome ? ` (${b.nome})` : ''}.`);
        }
        if (cpfDigits && cpfDigits.length !== 11) {
          throw new Error(`CPF incompleto no bailarino ${i + 1}${b?.nome ? ` (${b.nome})` : ''}.`);
        }
        const dobMasked = String(b?.data_nascimento ?? '').trim();
        let dobIso = '';
        if (dobMasked) {
          const iso = parseDataISO(dobMasked);
          if (!iso) throw new Error(`Data de nascimento inválida no bailarino ${i + 1}: use DD/MM/AAAA.`);
          dobIso = iso;
        }
        normalized.push({
          elencoId:         b?.elencoId,
          nome:             String(b?.nome ?? '').trim(),
          cpf:              cpfDigits,
          data_nascimento:  dobIso,
          instagram_handle: isGrupoLike
            ? undefined
            : (String(b?.instagram_handle ?? '').trim().toLowerCase().replace(/^@/, '') || undefined),
        });
      }

      // Refator 2026-06-01: persistência em 2 passos.
      //   1) UPSERT cada bailarino na `elenco` (fonte de verdade dos dados
      //      pessoais). Com elencoId → UPDATE; sem → INSERT (bailarino novo
      //      adicionado na sessão). Captura ids resultantes.
      //   2) UPDATE `registrations.bailarinos_detalhes` com {id, nome,
      //      instagram_handle} pra cada bailarino (referência leve).
      // RLS inscrito_own_elenco (FOR ALL com user_id = auth.uid) cobre os 2
      // caminhos pro inscrito. Adicionar/remover bailarino também tá ok
      // porque inscrito é dono.
      const resolvedIds: string[] = [];
      for (let i = 0; i < normalized.length; i++) {
        const b = normalized[i];
        if (b.elencoId) {
          // UPDATE existente. .select('id') detecta RLS bloqueando.
          const { data, error } = await supabase
            .from('elenco')
            .update({
              nome:            b.nome,
              cpf:             b.cpf,
              data_nascimento: b.data_nascimento || null,
            })
            .eq('id', b.elencoId)
            .select('id');
          if (error) throw error;
          if (!data || data.length === 0) {
            throw new Error(`Sem permissão pra editar o bailarino ${i + 1}. Recarregue e tente de novo.`);
          }
          resolvedIds.push(b.elencoId);
        } else {
          // INSERT novo. user_id = dono da inscrição (= auth.uid pro inscrito).
          const { data, error } = await supabase
            .from('elenco')
            .insert({
              user_id:         reg.user_id,
              nome:            b.nome,
              cpf:             b.cpf,
              data_nascimento: b.data_nascimento || null,
            })
            .select('id')
            .single();
          if (error) throw error;
          if (!data?.id) throw new Error(`Falha ao criar o bailarino ${i + 1}.`);
          resolvedIds.push(data.id);
        }
      }

      // Reconstrói bailarinos_detalhes (referência leve). Mantém apenas os
      // bailarinos que ficaram no form — se inscrito removeu um, o id sai
      // do JSONB. A row em elenco NÃO é deletada (pode estar em outras
      // inscrições; limpeza fica pra cleanup-orphan-elencos futuro).
      const bailarinosDetalhes = normalized.map((b, i) => ({
        id:               resolvedIds[i],
        nome:             b.nome,
        instagram_handle: b.instagram_handle ?? null,
      }));

      const igPrincipal = String(instagramPrincipalForm ?? '').trim().toLowerCase().replace(/^@/, '');
      const patch: Record<string, any> = {
        bailarinos_detalhes: bailarinosDetalhes,
        instagram_principal: isGrupoLike ? (igPrincipal || null) : null,
        staff_tecnico:       staffTecnicoForm.filter(s => s.nome.trim()),
      };

      // .select('id') força PostgREST a retornar rows afetadas — detecta RLS
      // bloqueando (mesmo padrão hardening de pages/Registrations.tsx).
      const { data, error } = await supabase
        .from('registrations')
        .update(patch)
        .eq('id', reg.id)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Sem permissão pra editar essa inscrição. Recarregue a página e tente de novo.');
      }

      // Atualiza state local pra refletir sem refetch.
      setRegistrations(prev => prev.map(r => r.id === reg.id ? { ...r, ...patch } : r));
      // Hidrata elencoById localmente com os dados que acabaram de gravar
      // pra UI mostrar CPF/data sem refetch.
      setElencoById(prev => {
        const next = { ...prev };
        for (let i = 0; i < normalized.length; i++) {
          const b = normalized[i];
          next[resolvedIds[i]] = {
            id:              resolvedIds[i],
            nome:            b.nome,
            cpf:             b.cpf,
            data_nascimento: b.data_nascimento || null,
          };
        }
        return next;
      });
      cancelEditingBailarinos();
    } catch (e: any) {
      setBailarinosError(e.message ?? 'Erro ao salvar.');
    } finally {
      setSavingBailarinos(false);
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
                className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:text-white hover:bg-[#ff0068] border border-[#ff0068]/30 hover:border-[#ff0068] rounded-xl px-3 py-1.5 flex items-center gap-1.5 shrink-0 transition-all"
                title="Inscrever mais coreografias"
              >
                <Plus size={13} /> Nova inscrição
              </button>
            )}
          </div>

          {/* CTA agregado quando há pendentes */}
          {grupo.pendentes.length > 0 && (() => {
            // Se já tem fatura PENDENTE no Asaas, usa o valor dela (já tem
            // cupom embutido se foi aplicado). Senão, soma estimada client-side.
            const faturaPendente = grupo.payment;
            const faturaTemCupom = !!(faturaPendente?.coupon_id && (faturaPendente?.discount_total ?? 0) > 0);
            const faturaSubtotal = faturaTemCupom
              ? (faturaPendente!.value_total + (faturaPendente!.discount_total ?? 0))
              : (faturaPendente?.value_total ?? grupo.totalPendente);
            const subtotal   = faturaSubtotal;
            const expiraDias = faturaPendente?.expires_at ? diasAte(faturaPendente.expires_at) : null;
            // "Tem cupom?" SEMPRE disponível. Se fatura PENDENTE existe sem
            // cupom (user clicou Pagar antes de aplicar), o
            // handleApplyAggregateCoupon cancela a fatura silenciosamente
            // antes de validar. User não sente.
            const applied   = appliedAggregateCoupons[grupo.eventId];
            // Desconto: prioriza o aplicado client-side (input local), fallback
            // pro persistido na fatura PENDENTE.
            const discountAmount = applied?.discount ?? (faturaTemCupom ? (faturaPendente!.discount_total ?? 0) : 0);
            const total          = Math.max(0, subtotal - discountAmount);
            const isApplying = applyingAggregateCoupon[grupo.eventId] === true;
            const couponErr  = aggregateCouponErrors[grupo.eventId] ?? null;
            return (
              <div className="px-5 py-4 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/5 space-y-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                      Pagar todas
                    </p>
                    {total === 0 ? (
                      <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5 italic uppercase tracking-tight">
                        Gratuito
                      </p>
                    ) : discountAmount > 0 ? (
                      <div className="mt-0.5">
                        <p className="text-[10px] font-bold text-slate-400 line-through tabular-nums">
                          {fmtMoney(subtotal)}
                        </p>
                        <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {fmtMoney(total)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5 tabular-nums">
                        {fmtMoney(total)}
                      </p>
                    )}
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
                    ) : total === 0 ? (
                      <Check size={13} />
                    ) : (
                      <ShoppingCart size={13} />
                    )}
                    {total === 0 ? 'Confirmar inscrição gratuita' : 'Pagar tudo'}
                    <ChevronRight size={12} />
                  </button>
                </div>
                {/* Cupom — exclusivo de PAGAR TUDO (decisão de produto 2026-05-25).
                    Padrão Stripe/Sympla/iFood/Hotmart: 1 cupom por sessão de
                    checkout, aplica no total. Cupom não passa pra single payment
                    (linha "Pagar só esta") — evita exploit com cupom valor fixo
                    + max_uses_per_user > 1. */}
                {(applied || faturaTemCupom) ? (
                  <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl">
                    <CheckCircle size={16} className="text-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-black text-sm text-emerald-700 dark:text-emerald-400">
                        {applied?.code ?? faturaPendente?.coupon_code ?? 'Cupom'}
                      </p>
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
                        {fmtMoney(applied?.discount ?? faturaPendente?.discount_total ?? 0)} de desconto
                      </p>
                    </div>
                    <button
                      onClick={() => handleUnifiedRemoveCoupon(grupo)}
                      disabled={cancellingPayment === faturaPendente?.id}
                      className="p-1 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-50 rounded-lg"
                      aria-label="Remover cupom"
                      title="Remover cupom"
                    >
                      {cancellingPayment === faturaPendente?.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <X size={14} />
                      )}
                    </button>
                  </div>
                ) : (
                  showAggregateCoupon[grupo.eventId] ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Cupom de desconto
                      </p>
                      <div className="flex gap-2">
                        <label htmlFor={`aggregate-coupon-${grupo.eventId}`} className="sr-only">
                          Código do cupom de inscrição
                        </label>
                        <input
                          id={`aggregate-coupon-${grupo.eventId}`}
                          type="text"
                          value={aggregateCouponInputs[grupo.eventId] ?? ''}
                          onChange={e => {
                            setAggregateCouponInputs(p => ({ ...p, [grupo.eventId]: e.target.value.toUpperCase() }));
                            if (couponErr) setAggregateCouponErrors(p => ({ ...p, [grupo.eventId]: null }));
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') handleApplyAggregateCoupon(grupo.eventId, subtotal, grupo); }}
                          disabled={isApplying}
                          placeholder="Código do cupom"
                          className="flex-1 px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40 focus:border-[#ff0068]/50 uppercase disabled:opacity-50"
                        />
                        <button
                          onClick={() => handleApplyAggregateCoupon(grupo.eventId, subtotal, grupo)}
                          disabled={isApplying || !(aggregateCouponInputs[grupo.eventId]?.trim())}
                          className="px-4 py-2 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 shrink-0"
                        >
                          {isApplying ? <Loader2 size={12} className="animate-spin" /> : 'Aplicar'}
                        </button>
                        <button
                          onClick={() => {
                            setShowAggregateCoupon(p => ({ ...p, [grupo.eventId]: false }));
                            setAggregateCouponInputs(p => ({ ...p, [grupo.eventId]: '' }));
                            setAggregateCouponErrors(p => ({ ...p, [grupo.eventId]: null }));
                          }}
                          className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-2"
                        >
                          Cancelar
                        </button>
                      </div>
                      {couponErr && (
                        <p className="text-[10px] text-rose-500 flex items-center gap-1.5">
                          <AlertCircle size={11} /> {couponErr}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAggregateCoupon(p => ({ ...p, [grupo.eventId]: true }))}
                      className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline flex items-center gap-1.5"
                    >
                      <Tag size={12} /> Tem cupom de desconto?
                    </button>
                  )
                )}
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
                        {/* A1 (2026-05-22): editar bailarinos. Pendente OU pago.
                            Decisão 1B: trava após prazo_inscricao se preenchido. */}
                        {(st.tone === 'ok' || isPendente) && (
                          <button
                            onClick={() => startEditingBailarinos(reg)}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5 transition-all"
                            title="Editar nome, CPF, data de nascimento e Instagram dos bailarinos"
                          >
                            <Users size={11} /> Editar dados
                          </button>
                        )}
                        {st.tone === 'ok' && (
                          <>
                            <button
                              onClick={() => navigate('/central-de-midia')}
                              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5 transition-all"
                              title="Enviar trilha sonora desta coreografia"
                            >
                              <Music2 size={11} /> Trilha
                            </button>
                            {/* Link de desconto por coreografia (sem CPF/login) —
                                pra família repassar manualmente (WhatsApp) pros
                                pais/bailarinos comprarem workshop com preço de
                                inscrito. Carrega o token até o checkout via
                                /evento/<slug> → /workshop/<id> → /checkout-workshop/<id>. */}
                            {grupo.eventSlug && eventsWithWorkshops[grupo.eventId] && reg.discount_token && (
                              <button
                                onClick={() => {
                                  const url = `${window.location.origin}/evento/${grupo.eventSlug}?discount_token=${reg.discount_token}#workshops`;
                                  navigator.clipboard.writeText(url).then(() => {
                                    setCopiedDiscountId(reg.id);
                                    setTimeout(() => setCopiedDiscountId(prev => (prev === reg.id ? null : prev)), 2000);
                                  });
                                }}
                                className={`px-3 py-1.5 rounded-lg font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5 transition-all ${
                                  copiedDiscountId === reg.id
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-500/20'
                                }`}
                                title="Copiar link de desconto pra mandar pros pais dos bailarinos comprarem o workshop"
                              >
                                {copiedDiscountId === reg.id ? <><Check size={11} /> Copiado</> : <><Link2 size={11} /> Link desconto</>}
                              </button>
                            )}
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
                              <label htmlFor={`selective-coupon-${reg.id}`} className="sr-only">
                                Código do cupom de taxa de seletiva
                              </label>
                              <input
                                id={`selective-coupon-${reg.id}`}
                                type="text"
                                value={couponInputs[reg.id] ?? ''}
                                onChange={e => setCouponInputs(p => ({ ...p, [reg.id]: e.target.value.toUpperCase() }))}
                                placeholder="Código do cupom"
                                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 uppercase"
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

          {/* ── CTA upsell de workshop (Bloco 5) ── */}
          {grupo.eventSlug && eventsWithWorkshops[grupo.eventId] && (() => {
            const temInscricaoPaga = grupo.outras.some(r => isRegistrationPaid(r.status_pagamento));
            return (
              <div className="border-t border-slate-200 dark:border-white/10 p-5">
                <button
                  onClick={() => navigate(`/evento/${grupo.eventSlug}#workshops`)}
                  className="w-full flex items-center justify-between gap-3 bg-gradient-to-r from-[#ff0068]/10 to-violet-500/10 border border-[#ff0068]/30 hover:border-[#ff0068] rounded-2xl p-4 text-left transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Sparkles size={18} className="text-[#ff0068] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 dark:text-white">
                        {temInscricaoPaga
                          ? 'Garanta seu workshop com preço de inscrito'
                          : 'Finalize sua inscrição para garantir o preço de inscrito nos workshops'}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Aprimore sua técnica com quem é referência neste festival.
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-[#ff0068] shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            );
          })()}

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
              onClick={() => { setCpfDraft(''); setCpfError(null); setCpfModalOpen(true); }}
              className="mt-2 px-3 py-1.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-[9px] uppercase tracking-widest"
            >
              Adicionar CPF
            </button>
          </div>
        </div>
      )}

      {/* Modal contextual de CPF (padrão Stripe/Sympla): coleta inline o
          único dado faltando pro fluxo de pagamento, sem detour pra /profile.
          Refator 2026-05-25 — banner amarelo agora abre este modal. */}
      <AnimatePresence>
        {cpfModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !cpfSaving) setCpfModalOpen(false); }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cpf-modal-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Passo final</p>
                  <h3 id="cpf-modal-title" className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white mt-1 italic">
                    {cpfDraft ? 'Confirme o CPF do pagador' : 'Adicionar CPF'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed normal-case">
                    {cpfDraft
                      ? 'Esse CPF vai na fatura como pagador. Confirme, ou ajuste se quem paga for outra pessoa.'
                      : 'Necessário pra gerar a fatura Asaas. Salvamos no seu perfil — não pedimos de novo na próxima compra.'}
                  </p>
                </div>
                {!cpfSaving && (
                  <button
                    onClick={() => setCpfModalOpen(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 shrink-0"
                    aria-label="Fechar"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); handleSaveCpfFromModal(); }}
                className="px-6 pb-6 pt-4 space-y-4"
              >
                <div>
                  <label htmlFor="cpf-modal-input" className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 ml-2">
                    CPF
                  </label>
                  <input
                    id="cpf-modal-input"
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={cpfDraft}
                    onChange={(e) => { setCpfDraft(maskCpfCnpj(e.target.value)); setCpfError(null); }}
                    placeholder="000.000.000-00"
                    disabled={cpfSaving}
                    className="mt-1.5 w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068] focus:ring-2 focus:ring-[#ff0068]/20 transition-all font-mono tracking-wider"
                    maxLength={14}
                  />
                  {cpfError && (
                    <p className="mt-2 text-[11px] text-rose-500 font-bold flex items-center gap-1.5">
                      <AlertCircle size={12} /> {cpfError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={cpfSaving || unmaskCpfCnpj(cpfDraft).length !== 11}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {cpfSaving ? (
                    <><Loader2 size={14} className="animate-spin" /> Salvando…</>
                  ) : (
                    <><CheckCircle size={14} /> Salvar e continuar</>
                  )}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal contextual de nome completo — mesmo padrão do CPF acima.
          Login Google às vezes traz só 1 palavra (apelido); certificado/
          credencial/nota fiscal exigem nome completo. */}
      <AnimatePresence>
        {fullNameModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !fullNameSaving) setFullNameModalOpen(false); }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fullname-modal-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Passo final</p>
                  <h3 id="fullname-modal-title" className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white mt-1 italic">
                    Confirme seu nome completo
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed normal-case">
                    Necessário pra emitir certificado, credencial e nota fiscal corretos. Salvamos no seu perfil — não pedimos de novo.
                  </p>
                </div>
                {!fullNameSaving && (
                  <button
                    onClick={() => setFullNameModalOpen(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 shrink-0"
                    aria-label="Fechar"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); handleSaveFullNameFromModal(); }}
                className="px-6 pb-6 pt-4 space-y-4"
              >
                <div>
                  <label htmlFor="fullname-modal-input" className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 ml-2">
                    Nome completo
                  </label>
                  <input
                    id="fullname-modal-input"
                    type="text"
                    autoFocus
                    value={fullNameDraft}
                    onChange={(e) => { setFullNameDraft(e.target.value); setFullNameError(null); }}
                    placeholder="Nome e sobrenome"
                    disabled={fullNameSaving}
                    className="mt-1.5 w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068] focus:ring-2 focus:ring-[#ff0068]/20 transition-all"
                  />
                  {fullNameError && (
                    <p className="mt-2 text-[11px] text-rose-500 font-bold flex items-center gap-1.5">
                      <AlertCircle size={12} /> {fullNameError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={fullNameSaving || fullNameDraft.trim().split(/\s+/).filter(Boolean).length < 2}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {fullNameSaving ? (
                    <><Loader2 size={14} className="animate-spin" /> Salvando…</>
                  ) : (
                    <><CheckCircle size={14} /> Salvar e continuar</>
                  )}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Banner de partial cancel (Asaas 5xx) — alerta inscrito que fatura
          local foi cancelada mas Asaas pode estar desincronizado. */}
      {partialCancelWarning && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] max-w-md w-[calc(100%-2rem)] p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl shadow-lg flex items-start gap-3" role="alert">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex-1 leading-relaxed">
            {partialCancelWarning}
          </p>
          <button
            onClick={() => setPartialCancelWarning(null)}
            className="text-amber-600 hover:text-amber-700 dark:text-amber-400 shrink-0"
            aria-label="Fechar aviso"
          >
            <X size={14} />
          </button>
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

      {/* ══════════════════════════════════════════════════════════
          A1 (2026-05-22) — Editor inline de bailarinos
          Modal centralizado, reusando components/BailarinosEditor.
          RLS `inscrito_own_registrations` cobre UPDATE.
      ══════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {editingBailarinos && (() => {
          const reg = registrations.find(r => r.id === editingBailarinos);
          if (!reg) return null;
          const formato = reg.formato_participacao ?? '';
          const isGrupoLike = formato === 'Grupo' || formato === 'Conjunto';
          // Tenta puxar min/max de formacoes_config do evento. Fallback amplo
          // (1-50) se evento não definiu — não bloqueia UX.
          const formacaoConfig = reg.event_id
            ? (formacoesPorEvento[reg.event_id] ?? []).find((f: any) => f?.name?.toLowerCase?.() === formato.toLowerCase())
            : null;
          const minMembers = formacaoConfig?.min_members ?? 1;
          const maxMembers = formacaoConfig?.max_members ?? (isGrupoLike ? 50 : 3);

          return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => !savingBailarinos && cancelEditingBailarinos()}
                className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                className="relative bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[92dvh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-white/10"
              >
                <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 px-6 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068] mb-1 flex items-center gap-1.5">
                      <Pencil size={11} /> Editar bailarinos
                    </p>
                    <h2 className="font-black text-lg uppercase tracking-tight text-slate-900 dark:text-white leading-tight">
                      {reg.nome_coreografia ?? 'Coreografia'}
                    </h2>
                    {formato && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        {formato}
                        {reg.categoria ? ` · ${reg.categoria}` : ''}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => !savingBailarinos && cancelEditingBailarinos()}
                    disabled={savingBailarinos}
                    className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-all disabled:opacity-50"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
                    <AlertCircle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                      <strong>CPF e data de nascimento são obrigatórios</strong> pra emitir certificado e validar faixa etária da categoria. Use DD/MM/AAAA na data.
                    </p>
                  </div>

                  <BailarinosEditor
                    bailarinos={bailarinosForm}
                    onChange={setBailarinosForm}
                    formato={formato}
                    instagramPrincipal={instagramPrincipalForm}
                    onInstagramPrincipalChange={setInstagramPrincipalForm}
                    minMembers={minMembers}
                    maxMembers={maxMembers}
                  />

                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                      Equipe técnica (opcional)
                    </p>
                    <StaffTecnicoEditor
                      staff={staffTecnicoForm}
                      onChange={setStaffTecnicoForm}
                    />
                  </div>

                  {bailarinosError && (
                    <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl">
                      <AlertTriangle size={12} className="text-rose-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-rose-700 dark:text-rose-400">{bailarinosError}</p>
                    </div>
                  )}
                </div>

                <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 px-6 py-4 flex items-center justify-end gap-2">
                  <button
                    onClick={cancelEditingBailarinos}
                    disabled={savingBailarinos}
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-all disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleSaveBailarinos(reg)}
                    disabled={savingBailarinos}
                    className="px-4 py-2 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {savingBailarinos ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                    Salvar
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

export default MinhasCoreografias;

/**
 * Compat com import default — SystemErrorBanner inutilizado no novo layout
 * mas mantido pra evitar bug em outros lugares que façam side-imports.
 */
void SystemErrorBanner;
