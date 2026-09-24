/**
 * CheckoutIngresso — ingressos de plateia, guest checkout (sem login).
 *
 * Carrinho MULTI-TIPO: comprador mistura tipos (2 Inteiras + 1 Meia) num só
 * pagamento. 1 cobrança Asaas, lista de QRs por email. Padrão Sympla/Eventbrite.
 *
 * Rotas:
 *   /checkout-ingresso/<idOrSlug>           ← carrinho via location.state.cart (vitrine)
 *   /checkout-ingresso/<idOrSlug>/<idx>     ← legado: link antigo de 1 tipo (vira cart {idx:1})
 *
 * Fluxo:
 *   vitrine (+/− por tipo) → "Ir pro carrinho" → AQUI (resumo editável + dados)
 *   → POST create-audience-ticket (items[]) → redirect Asaas → webhook confirma
 *   → comprador recebe email com 1 link /meu-ingresso/<token> por ingresso.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { edgeErrorBody, edgeErrorMessage } from '../utils/edgeError';
import SandboxBanner from '../components/SandboxBanner';
import {
  Ticket, Loader2, AlertCircle, ArrowLeft, ShieldCheck, User as UserIcon, Mail, Phone, FileText, Minus, Plus,
  Tag, X, Check, Trash2, Armchair, Clock, Users,
} from 'lucide-react';
import AsaasBadge from '../components/AsaasBadge';
import CheckoutLegalNotice from '../components/CheckoutLegalNotice';
import SeatGrid from '../components/SeatGrid';
import SeatLegend from '../components/SeatLegend';
import { useSeatMap } from '../hooks/useSeatMap';
import { companionBySpecial, isSpecialTipo, seatsSatisfyRules, tipoFromRow, type SeatTipo } from '../utils/seatSelection';
import { ticketSeatKind, type TicketSeatKind } from '../supabase/functions/_shared/seat-rules';
import { resolveLote, todayISO, type Lote } from '../utils/lotes';
import { isEventOver } from '../utils/eventStatus';
// Fonte única da matemática de comissão/split (compartilhada com a edge
// create-audience-ticket). Garante que o total exibido bate com a cobrança.
import { computeAudienceCart } from '../supabase/functions/_shared/audience-pricing';

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0);
const round2 = (n: number) => parseFloat((n ?? 0).toFixed(2));

// CPF validation (mod-11)
const isValidCpf = (cpf: string): boolean => {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(d[i]) * (10 - i);
  let c = 11 - (s % 11);
  if (c >= 10) c = 0;
  if (c !== parseInt(d[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(d[i]) * (11 - i);
  c = 11 - (s % 11);
  if (c >= 10) c = 0;
  return c === parseInt(d[10]);
};

const formatCpf = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};
const formatPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
};

const detectKind = (nome: string): string => {
  const n = String(nome ?? '').toLowerCase();
  if (n.includes('meia')) return 'meia';
  if (n.includes('solidári') || n.includes('solidari')) return 'solidaria';
  if (n.includes('cortes')) return 'cortesia';
  return 'inteira';
};

type LineItem = {
  idx: number;
  nome: string;
  kind: string;
  precoUnit: number;
  qty: number;
  loteNome: string | null;
  quantidadeTotal: number | null;
  /** comum | pcd | acompanhante — regras de assento (Fase 3). */
  seatKind: TicketSeatKind;
};

export default function CheckoutIngresso() {
  const { idOrSlug, ticketTypeIdx } = useParams<{ idOrSlug: string; ticketTypeIdx?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Carrinho inicial: location.state.cart (vitrine) OU :ticketTypeIdx (link legado).
  const initialCart = useMemo<Record<string, number>>(() => {
    const st = (location.state as any)?.cart;
    if (st && typeof st === 'object' && Object.keys(st).length > 0) {
      const c: Record<string, number> = {};
      for (const [k, v] of Object.entries(st)) {
        const n = Math.floor(Number(v));
        if (n > 0) c[String(k)] = n;
      }
      if (Object.keys(c).length > 0) return c;
    }
    if (ticketTypeIdx !== undefined) {
      const i = parseInt(ticketTypeIdx, 10);
      if (Number.isFinite(i)) return { [String(i)]: 1 };
    }
    return {};
  }, []); // só no mount

  const [event, setEvent] = useState<any>(null);
  const [cart, setCart] = useState<Record<string, number>>(initialCart);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf]     = useState('');
  const [phone, setPhone] = useState('');
  const [paying, setPaying] = useState(false);
  const [refundAccepted, setRefundAccepted] = useState(false);

  // Assento numerado (Fase 2 Stage 3) — layout do venue + status ao vivo
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  // Ref espelha a seleção pro callback do polling (fecha sobre o valor atual, não o do render antigo).
  const selectedSeatsRef = useRef<string[]>([]);
  selectedSeatsRef.current = selectedSeats;
  const [seatLostNotice, setSeatLostNotice] = useState<string | null>(null);
  // Hold ao escolher o assento (A2): token de sessão + prazo da reserva.
  const [holdToken, setHoldToken] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const heldSeatsRef = useRef<string[]>([]);   // último conjunto que o servidor confirmou
  const holdVersionRef = useRef(0);

  // Estoque por idx + cupom
  const [stockByIdx, setStockByIdx] = useState<Record<string, { remaining: number | null; sold_out: boolean }>>({});
  const [couponInput, setCouponInput] = useState('');
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);          // desconto sobre o total do carrinho
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  // ─── Hidrata evento ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!idOrSlug) return;
    (async () => {
      setLoading(true);
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
        const filterCol = isUuid ? 'id' : 'slug';
        const { data: ev, error: evErr } = await supabase
          .from('events')
          .select('id, name, slug, start_date, end_date, location, cover_url, ingressos_config, audience_sales_enabled, audience_commission_percent, audience_fee_mode, audience_max_per_cpf, audience_max_per_purchase, politica_ingressos, seat_map_enabled, payment_sandbox')
          .eq(filterCol, idOrSlug)
          .maybeSingle();
        if (evErr || !ev) { setError('Evento não encontrado.'); return; }
        if (!ev.audience_sales_enabled || ev.politica_ingressos !== 'INTERNO') {
          setError('Venda de ingressos não está disponível para este evento.');
          return;
        }
        // Fix 2026-06-28: checava `event_date`, coluna legada sempre NULL nos
        // eventos reais — esse bloqueio nunca disparava. Fonte real é
        // start_date/end_date (preenchidas pelo painel).
        if (isEventOver(ev)) {
          setError('Este evento já aconteceu. Vendas de ingressos encerradas.');
          return;
        }
        setEvent(ev);
        // Sanitiza o cart contra os tipos válidos do evento (descarta idx morto).
        const ingressos: any[] = Array.isArray(ev.ingressos_config) ? ev.ingressos_config : [];
        setCart(prev => {
          const next: Record<string, number> = {};
          for (const [k, q] of Object.entries(prev)) {
            const t = ingressos[Number(k)];
            if (t?.nome && q > 0) next[k] = q;
          }
          return next;
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [idOrSlug]);

  // ─── Linhas do carrinho (resolve preço vigente + kind + estoque) ──────────
  const lines = useMemo<LineItem[]>(() => {
    if (!event) return [];
    const ingressos: any[] = Array.isArray(event.ingressos_config) ? event.ingressos_config : [];
    const today = todayISO();
    return Object.entries(cart)
      .map(([k, qty]) => {
        const idx = Number(k);
        const t = ingressos[idx];
        if (!t?.nome || qty <= 0) return null;
        const lotes: Lote[] = Array.isArray(t.lotes) ? t.lotes : [];
        const r = resolveLote(lotes, today);
        const precoUnit = r ? Number(r.lote.preco ?? 0) : Number(t.preco ?? 0);
        const quantidadeTotal = t.quantidade_total != null && Number(t.quantidade_total) > 0
          ? Number(t.quantidade_total) : null;
        return {
          idx,
          nome: String(t.nome),
          kind: detectKind(t.nome),
          precoUnit,
          qty,
          loteNome: (r?.lote as any)?.nome ?? null,
          quantidadeTotal,
          seatKind: ticketSeatKind(t),
        } as LineItem;
      })
      .filter(Boolean)
      .sort((a, b) => a!.idx - b!.idx) as LineItem[];
  }, [event, cart]);

  const maxPurchase = Math.max(1, Math.min(
    Number(event?.audience_max_per_purchase ?? 6),
    Number(event?.audience_max_per_cpf ?? 6),
  ));
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const pcdQty = lines.reduce((s, l) => s + (l.seatKind === 'pcd' ? l.qty : 0), 0);
  const compQty = lines.reduce((s, l) => s + (l.seatKind === 'acompanhante' ? l.qty : 0), 0);
  const comumQty = totalQty - pcdQty - compQty;
  // Ingresso "Acompanhante de PCD" configurado no evento (quando existir).
  const companionTypeIdx = useMemo(() => {
    const ing: any[] = Array.isArray(event?.ingressos_config) ? event.ingressos_config : [];
    const i = ing.findIndex(t => t?.nome && ticketSeatKind(t) === 'acompanhante');
    return i >= 0 ? i : null;
  }, [event]);

  // Carrinho encolheu depois de já ter assento(s) escolhido(s) → corta o excesso.
  useEffect(() => {
    setSelectedSeats(prev => prev.length > totalQty ? prev.slice(0, totalQty) : prev);
  }, [totalQty]);

  // ─── Estoque: carrega + faz polling 30s pros tipos do carrinho ────────────
  useEffect(() => {
    if (!event?.id) return;
    const typesWithLimit = lines
      .filter(l => l.quantidadeTotal != null)
      .map(l => ({ id: String(l.idx), total: l.quantidadeTotal }));
    if (typesWithLimit.length === 0) { setStockByIdx({}); return; }
    let cancelled = false;
    const tick = async () => {
      const { data: rows } = await supabase.rpc('get_audience_stock', {
        p_event_id: event.id,
        p_types: typesWithLimit,
      });
      if (cancelled || !Array.isArray(rows)) return;
      const map: Record<string, { remaining: number | null; sold_out: boolean }> = {};
      for (const r of rows as Array<{ ticket_type_id: string; remaining: number | null; sold_out: boolean }>) {
        map[String(r.ticket_type_id)] = { remaining: r.remaining, sold_out: r.sold_out };
      }
      setStockByIdx(map);
    };
    void tick();
    const interval = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, JSON.stringify(lines.map(l => [l.idx, l.quantidadeTotal]))]);

  // ─── Assento numerado: layout (1x) + status ao vivo (polling 15s) ─────────
  const seatMapEnabled = Boolean(event?.seat_map_enabled);

  // Evento mudou (navegação sem reload completo) — nunca carrega assento
  // selecionado de um evento diferente (o hook já reseta layout/status).
  useEffect(() => {
    setSelectedSeats([]);
  }, [event?.id]);

  const { rowsConfig, seatStatuses, markSeatsOccupied } = useSeatMap({
    eventId: event?.id,
    enabled: seatMapEnabled,
    pollMs: 15_000,
    holdToken,
    onLayoutError: setError,
    // Assento que o comprador tinha escolhido pode ter sido pego por outro
    // enquanto ele preenchia o form — descarta da seleção automaticamente.
    onStatusUpdate: map => {
      const lost = selectedSeatsRef.current.filter(id => map[id]?.status !== 'livre');
      if (lost.length === 0) return;
      setSelectedSeats(prev => prev.filter(id => !lost.includes(id)));
      setSeatLostNotice(`${lost.length === 1 ? 'O lugar' : 'Os lugares'} ${lost.join(', ')} ${lost.length === 1 ? 'não está mais disponível' : 'não estão mais disponíveis'}. Escolha outro no mapa.`);
    },
  });

  // Token do hold: persiste na aba (sessionStorage) pra sobreviver a um reload;
  // um reload dentro dos 10 min ainda reconhece os assentos como "meus".
  useEffect(() => {
    if (!event?.id || !seatMapEnabled) { setHoldToken(null); return; }
    const key = `coreohub:seat-hold:${event.id}`;
    let tok: string | null = null;
    try { tok = sessionStorage.getItem(key); } catch { /* sessionStorage indisponível */ }
    if (!tok || tok.length < 16) {
      tok = crypto.randomUUID();
      try { sessionStorage.setItem(key, tok); } catch { /* segue só em memória */ }
    }
    heldSeatsRef.current = [];
    setHoldExpiresAt(null);
    setHoldToken(tok);
  }, [event?.id, seatMapEnabled]);

  // Reserva no servidor a cada mudança de seleção (debounce curto). Só a última
  // resposta vale (versão). Falha = volta pro último conjunto confirmado.
  useEffect(() => {
    if (!event?.id || !holdToken || !seatMapEnabled) return;
    if (selectedSeats.length === 0 && heldSeatsRef.current.length === 0) return;
    const same = selectedSeats.length === heldSeatsRef.current.length
      && selectedSeats.every(id => heldSeatsRef.current.includes(id));
    if (same) return;
    const version = ++holdVersionRef.current;
    const timer = setTimeout(async () => {
      const wanted = [...selectedSeats];
      const { data, error: holdErr } = await supabase.rpc('hold_event_seats', {
        p_event_id: event.id, p_seat_ids: wanted, p_hold_token: holdToken, p_hold_minutes: 10,
        p_pcd_qty: pcdQty, p_comp_qty: compQty,
      });
      if (version !== holdVersionRef.current) return; // mudou de novo enquanto esperava
      if (holdErr) {
        console.error('[CheckoutIngresso] erro hold_event_seats:', holdErr.message);
        // P0001 = regra de negócio do servidor (mensagem já é para o comprador).
        setSeatLostNotice(holdErr.code === 'P0001' ? holdErr.message : 'Não foi possível reservar o lugar agora. Tente de novo.');
        setSelectedSeats(heldSeatsRef.current);
        return;
      }
      const rows = (Array.isArray(data) ? data : []) as Array<{ seat_id: string; reserved: boolean; seconds_left: number | null }>;
      const failed = rows.filter(r => !r.reserved).map(r => r.seat_id);
      if (failed.length > 0) {
        markSeatsOccupied(failed);
        setSeatLostNotice(`${failed.length === 1 ? 'O lugar' : 'Os lugares'} ${failed.join(', ')} ${failed.length === 1 ? 'acabou de ser reservado' : 'acabaram de ser reservados'} por outra pessoa. Escolha outro.`);
        setSelectedSeats(heldSeatsRef.current);
        return;
      }
      heldSeatsRef.current = wanted;
      // Prazo pelo relógio do BANCO (segundos restantes), nunca pelo do aparelho.
      const left = rows.find(r => r.seconds_left != null)?.seconds_left;
      const now = Date.now();
      setNowMs(now);
      setHoldExpiresAt(wanted.length > 0 && left != null ? now + left * 1000 : null);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeats, holdToken, event?.id, seatMapEnabled, pcdQty, compQty]);

  // Relógio da reserva: 1 tick/s só enquanto há hold. Zerou = solta a seleção.
  useEffect(() => {
    if (!holdExpiresAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);
  useEffect(() => {
    if (!holdExpiresAt || nowMs < holdExpiresAt) return;
    heldSeatsRef.current = [];
    holdVersionRef.current++;
    setHoldExpiresAt(null);
    setSelectedSeats([]);
    setSeatLostNotice('Sua reserva expirou e os lugares foram liberados. Escolha novamente.');
  }, [nowMs, holdExpiresAt]);
  const holdRemainingSec = holdExpiresAt ? Math.max(0, Math.ceil((holdExpiresAt - nowMs) / 1000)) : null;

  // ── Fase 3: assento PCD/cadeirante + acompanhante ─────────────────────────
  const companionOfSpecial = useMemo(() => companionBySpecial(rowsConfig), [rowsConfig]);
  const tipoOfSeat = (id: string): SeatTipo => {
    const st = seatStatuses[id]?.seat_tipo as SeatTipo | undefined;
    if (st) return st;
    const cut = id.lastIndexOf('-');
    const row = rowsConfig?.find(r => r.codigo === id.slice(0, cut));
    return row ? tipoFromRow(row, Number(id.slice(cut + 1))) : 'comum';
  };
  const isReleased = (id: string) => seatStatuses[id]?.liberado ?? tipoOfSeat(id) === 'comum';

  const toggleSeat = (seatId: string) => {
    setSeatLostNotice(null);
    const prev = selectedSeatsRef.current;
    if (prev.includes(seatId)) {
      // Tirar o assento PCD leva junto o acompanhante dele (e o ingresso dele do carrinho).
      const comp = companionOfSpecial[seatId];
      const dropComp = !!comp && prev.includes(comp);
      setSelectedSeats(prev.filter(id => id !== seatId && !(dropComp && id === comp)));
      if (dropComp && companionTypeIdx != null) setLineQty(companionTypeIdx, (cart[String(companionTypeIdx)] ?? 0) - 1);
      return;
    }
    if (seatStatuses[seatId]?.status !== 'livre') return;
    if (prev.length >= totalQty) return; // já escolheu a quantidade do carrinho
    setSelectedSeats([...prev, seatId]);
  };

  // Ingresso PCD/acompanhante removido do carrinho: solta os lugares que sobraram.
  useEffect(() => {
    if (!seatMapEnabled) return;
    setSelectedSeats(prev => {
      let esp = 0, ac = 0;
      const out: string[] = [];
      for (const id of prev) {
        const t = tipoOfSeat(id);
        if (!isReleased(id) && isSpecialTipo(t)) { if (esp >= pcdQty) continue; esp++; }
        else if (!isReleased(id) && t === 'acompanhante') { if (ac >= compQty) continue; ac++; }
        out.push(id);
      }
      return out.length === prev.length ? prev : out;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcdQty, compQty, seatMapEnabled]);

  // Oferta "Vai com acompanhante?": assento PCD escolhido, sem acompanhante ainda, com vizinho livre.
  const companionOffer = useMemo(() => {
    if (!seatMapEnabled || companionTypeIdx == null || totalQty >= maxPurchase) return null;
    for (const id of selectedSeats) {
      if (!isSpecialTipo(tipoOfSeat(id))) continue;
      const comp = companionOfSpecial[id];
      if (!comp || selectedSeats.includes(comp)) continue;
      if (seatStatuses[comp]?.status !== 'livre') continue;
      return { special: id, comp };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatMapEnabled, companionTypeIdx, totalQty, maxPurchase, selectedSeats, companionOfSpecial, seatStatuses, rowsConfig]);

  const addCompanion = () => {
    if (!companionOffer || companionTypeIdx == null) return;
    setLineQty(companionTypeIdx, (cart[String(companionTypeIdx)] ?? 0) + 1);
    setSelectedSeats(prev => (prev.includes(companionOffer.comp) ? prev : [...prev, companionOffer.comp]));
  };

  // ─── Edição de quantidade (respeita meia=1, estoque, máx por compra) ──────
  const setLineQty = (idx: number, nextQty: number) => {
    setCart(prev => {
      const line = lines.find(l => l.idx === idx);
      const isMeia = line?.kind === 'meia';
      const remaining = stockByIdx[String(idx)]?.remaining ?? Infinity;
      const typeCap = Math.min(isMeia ? 1 : 99, remaining);
      // Garante que o total não estoura o limite por compra.
      const othersQty = Object.entries(prev).reduce((s, [k, q]) => s + (Number(k) === idx ? 0 : q), 0);
      const globalCap = Math.max(0, maxPurchase - othersQty);
      const clamped = Math.max(0, Math.min(nextQty, typeCap, globalCap));
      const next = { ...prev };
      if (clamped <= 0) delete next[String(idx)];
      else next[String(idx)] = clamped;
      return next;
    });
  };

  // ─── Cupom: aplica + re-valida quando o total muda (cart-level) ───────────
  const totalBase = useMemo(() => round2(lines.reduce((s, l) => s + l.precoUnit * l.qty, 0)), [lines]);

  const validateCoupon = async (code: string): Promise<{ discount: number } | { error: string }> => {
    const { data, error: invokeErr } = await supabase.functions.invoke('validate-audience-coupon', {
      body: { event_id: event.id, code, base_value: totalBase },
    });
    if (invokeErr) return { error: await edgeErrorMessage(invokeErr, 'Cupom inválido') };
    if (data?.error) return { error: data.error };
    if (!data?.code) return { error: 'Cupom inválido' };
    return { discount: Number(data.discount) };
  };

  const handleApplyCoupon = async () => {
    if (!event || couponLoading) return;
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponError(null);
    setCouponLoading(true);
    try {
      const res = await validateCoupon(code);
      if ('error' in res) { setCouponError(res.error); setAppliedCouponCode(null); setCouponDiscount(0); return; }
      setAppliedCouponCode(code);
      setCouponDiscount(round2(res.discount));
    } finally {
      setCouponLoading(false);
    }
  };
  const handleRemoveCoupon = () => {
    setAppliedCouponCode(null);
    setCouponDiscount(0);
    setCouponInput('');
    setCouponError(null);
  };

  // Re-valida o cupom quando o carrinho muda (desconto depende do total).
  useEffect(() => {
    if (!event || !appliedCouponCode || totalBase <= 0) return;
    let cancelled = false;
    (async () => {
      const res = await validateCoupon(appliedCouponCode);
      if (cancelled) return;
      if ('error' in res) { setCouponError(res.error); setAppliedCouponCode(null); setCouponDiscount(0); }
      else setCouponDiscount(round2(res.discount));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalBase, appliedCouponCode]);

  // ─── Breakdown — usa a MESMA fonte que a edge (computeAudienceCart) pra
  // bater centavo-a-centavo com a cobrança gerada. Fonte única em _shared. ───
  const breakdown = useMemo(() => {
    if (!event || lines.length === 0) return null;
    const feeMode = event.audience_fee_mode ?? 'repassar';
    try {
      const r = computeAudienceCart({
        resolved: lines.map(l => ({
          idx: l.idx, nome: l.nome, kind: l.kind,
          quantity: l.qty, precoUnit: l.precoUnit, quantidadeTotal: l.quantidadeTotal,
        })),
        totalBase,
        discountTotal: Math.min(couponDiscount, totalBase),
        commissionPercent: Number(event.audience_commission_percent ?? 10),
        feeMode,
      });
      return {
        feeMode,
        totalBase,
        totalDiscount: r.discountApplied,
        totalFee: r.commissionTotal,
        totalCharged: r.chargedTotal,
      };
    } catch {
      // Desconto > base (cupom inválido pro carrinho) — não quebra o render.
      // A validação de cupom já previne; aqui é só defesa em profundidade.
      return null;
    }
  }, [event, lines, totalBase, couponDiscount]);

  // ─── Submit ────────────────────────────────────────────────────────────────
  const anySoldOut = lines.some(l => stockByIdx[String(l.idx)]?.sold_out === true);
  const specialSelected = selectedSeats.filter(id => isSpecialTipo(tipoOfSeat(id))).length;
  const compSelected = selectedSeats.filter(id => tipoOfSeat(id) === 'acompanhante').length;
  const seatsReady = !seatMapEnabled || (selectedSeats.length === totalQty && seatsSatisfyRules(specialSelected, compSelected, pcdQty, compQty));
  const canSubmit = !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && isValidCpf(cpf) && totalQty >= 1 && !paying && !anySoldOut && seatsReady;

  const handlePay = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit || !event) return;
    setPaying(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('create-audience-ticket', {
        body: {
          event_id: event.id,
          items: lines.map(l => ({ ticket_type_idx: l.idx, quantity: l.qty })),
          buyer: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            cpf: cpf.replace(/\D/g, ''),
            phone: phone.replace(/\D/g, '') || undefined,
          },
          coupon_code: appliedCouponCode ?? undefined,
          ...(seatMapEnabled ? { seat_ids: selectedSeats, hold_token: holdToken ?? undefined } : {}),
        },
      });
      if (invokeErr) {
        const body = await edgeErrorBody(invokeErr);
        if (Array.isArray(body?.occupied_seats) && body.occupied_seats.length > 0) {
          setSelectedSeats(prev => prev.filter(id => !body.occupied_seats.includes(id)));
          markSeatsOccupied(body.occupied_seats);
        }
        throw new Error(await edgeErrorMessage(invokeErr, 'Erro ao gerar pagamento. Tente novamente.'));
      }
      if (data?.error) {
        // Assento(s) escolhido(s) foram pegos por outro comprador entre a
        // seleção e o clique em pagar — limpa só esses e deixa escolher de novo.
        if (Array.isArray(data.occupied_seats) && data.occupied_seats.length > 0) {
          setSelectedSeats(prev => prev.filter(id => !data.occupied_seats.includes(id)));
          markSeatsOccupied(data.occupied_seats);
        }
        throw new Error(data.error);
      }
      if (!data?.invoice_url) throw new Error('URL de pagamento não retornada.');
      window.location.href = data.invoice_url;
    } catch (err: any) {
      setError(err.message ?? String(err));
      setPaying(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#ff0068]" size={32} />
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white/5 border border-red-500/30 rounded-2xl p-6 text-center">
          <AlertCircle className="text-red-400 mx-auto mb-3" size={32} />
          <p className="text-white font-bold mb-2">Não foi possível carregar</p>
          <p className="text-sm text-slate-400 mb-4">{error}</p>
          <button onClick={() => navigate(-1)} className="text-xs font-black text-[#ff0068] uppercase tracking-widest">
            ← Voltar
          </button>
        </div>
      </div>
    );
  }

  // Carrinho vazio (refresh sem state, ou removeu tudo) → volta pro evento.
  if (event && lines.length === 0) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
          <Ticket className="text-slate-500 mx-auto mb-3" size={32} />
          <p className="text-white font-bold mb-2">Seu carrinho está vazio</p>
          <p className="text-sm text-slate-400 mb-4">Escolha os ingressos na página do evento.</p>
          <button
            onClick={() => navigate(`/evento/${idOrSlug}`)}
            className="inline-flex items-center gap-2 text-xs font-black text-[#ff0068] uppercase tracking-widest"
          >
            <ArrowLeft size={14} /> Ver ingressos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0b0f] text-white">
      {/* Página transacional/pessoal: fora do índice de busca (também via X-Robots-Tag no vercel.json). */}
      <meta name="robots" content="noindex, nofollow" />
      {(event as any)?.payment_sandbox && <SandboxBanner />}
      {event?.cover_url && (
        <div className="relative h-32 md:h-48 overflow-hidden">
          <img src={event.cover_url} alt="" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0b0b0f]" />
        </div>
      )}

      <div className={`max-w-2xl mx-auto px-4 py-6 relative ${event?.cover_url ? '-mt-8' : ''}`}>
        <button
          onClick={() => navigate(`/evento/${idOrSlug}`)}
          className="inline-flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-[#ff0068] mb-6"
        >
          <ArrowLeft size={14} /> Voltar pro evento
        </button>

        <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter mb-1">
          Seu carrinho
        </h1>
        <p className="text-sm text-slate-400 mb-6">{event.name}</p>

        {/* Resumo editável do carrinho */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 space-y-3">
          <p className="text-xs font-black text-slate-300 uppercase tracking-widest">Ingressos</p>
          {lines.map(l => {
            const remaining = stockByIdx[String(l.idx)]?.remaining ?? Infinity;
            const isMeia = l.kind === 'meia';
            const typeCap = Math.min(isMeia ? 1 : 99, remaining);
            const atGlobalMax = totalQty >= maxPurchase;
            const soldOut = stockByIdx[String(l.idx)]?.sold_out === true;
            return (
              <div key={l.idx} className="flex items-center justify-between gap-3 border-t border-white/5 pt-3 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-black uppercase tracking-tight text-white truncate">{l.nome}</p>
                  {l.loteNome && (
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{l.loteNome}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5">{formatBRL(l.precoUnit)} cada</p>
                  {soldOut && <p className="text-[10px] font-bold text-rose-300 mt-0.5">Esgotado</p>}
                  {!soldOut && remaining !== Infinity && remaining <= 10 && (
                    <p className="text-[10px] font-bold text-amber-300 mt-0.5">Últimos {remaining}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    aria-label={l.qty <= 1 ? `Remover ${l.nome} do carrinho` : `Diminuir quantidade de ${l.nome}`}
                    onClick={() => setLineQty(l.idx, l.qty - 1)}
                    className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
                  >
                    {l.qty <= 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                  </button>
                  <span className="text-base font-black tabular-nums w-5 text-center">{l.qty}</span>
                  <button
                    type="button"
                    aria-label={`Adicionar um ${l.nome}`}
                    disabled={l.qty >= typeCap || atGlobalMax}
                    title={atGlobalMax ? `Máximo de ${maxPurchase} ingressos por compra` : (l.qty >= typeCap ? 'Limite deste tipo atingido' : undefined)}
                    onClick={() => setLineQty(l.idx, l.qty + 1)}
                    className="w-8 h-8 rounded-lg bg-[#ff0068]/80 hover:bg-[#ff0068] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {totalQty >= maxPurchase && (
            <p className="text-[10px] text-slate-500 text-right pt-1">Máx. {maxPurchase} ingressos por compra.</p>
          )}
          {lines.some(l => l.kind === 'meia') && (
            <p className="text-[10px] text-amber-300/80 pt-1 flex items-start gap-1.5">
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              <span><strong>Lei 12.933:</strong> meia-entrada é nominativa e limitada a 1 por CPF. Apresente o documento que comprove o benefício na entrada.</span>
            </p>
          )}
        </div>

        {/* Cupom de desconto */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4">
          <p className="text-xs font-black text-slate-300 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Tag size={12} className="text-[#ff0068]" /> Cupom de desconto
          </p>
          {appliedCouponCode ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
              <div className="flex items-center gap-2 min-w-0">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-300 truncate">{appliedCouponCode}</p>
                  <p className="text-[10px] text-emerald-200">−{formatBRL(couponDiscount)} no total</p>
                </div>
              </div>
              <button type="button" onClick={handleRemoveCoupon} className="p-1 rounded-lg text-slate-400 hover:text-rose-400" aria-label="Remover cupom">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={couponInput}
                onChange={e => { setCouponInput(e.target.value.toUpperCase()); if (couponError) setCouponError(null); }}
                placeholder="EX: FAMILIA5"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm font-mono font-bold uppercase outline-none focus:border-[#ff0068]/50"
              />
              <button
                type="button"
                onClick={handleApplyCoupon}
                disabled={!couponInput.trim() || couponLoading}
                className="px-4 py-2.5 bg-[#ff0068]/20 hover:bg-[#ff0068]/30 disabled:opacity-30 text-[#ff0068] rounded-xl text-[10px] font-black uppercase tracking-widest"
              >
                {couponLoading ? <Loader2 className="animate-spin" size={14} /> : 'Aplicar'}
              </button>
            </div>
          )}
          {couponError && (
            <p className="mt-2 text-[10px] text-rose-300 flex items-center gap-1">
              <AlertCircle size={10} /> {couponError}
            </p>
          )}
        </div>

        {/* Escolher lugar (Fase 2 — assento numerado, só quando o evento liga o mapa) */}
        {seatMapEnabled && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 lg:w-[min(1100px,calc(100vw-2rem))] lg:relative lg:left-1/2 lg:-translate-x-1/2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Armchair size={14} /> Escolher lugar
              </p>
              <p className="text-[10px] text-slate-500">
                {selectedSeats.length}/{totalQty} selecionado{totalQty === 1 ? '' : 's'}
              </p>
            </div>

            {seatLostNotice && (
              <div role="alert" aria-live="polite" className="mb-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="flex-1">{seatLostNotice}</span>
                <button type="button" aria-label="Fechar aviso" onClick={() => setSeatLostNotice(null)} className="text-amber-300/70 hover:text-amber-200 cursor-pointer">
                  <X size={14} />
                </button>
              </div>
            )}

            {holdRemainingSec != null ? (
              <p
                role="timer"
                aria-live="off"
                className={`mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[11px] font-black tabular-nums ${
                  holdRemainingSec <= 60 ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                }`}
              >
                <Clock size={12} aria-hidden="true" />
                Lugares reservados por {String(Math.floor(holdRemainingSec / 60)).padStart(2, '0')}:{String(holdRemainingSec % 60).padStart(2, '0')}
              </p>
            ) : (
              <p className="text-[10px] text-slate-500 mb-3">
                Ao escolher um lugar, ele fica reservado para você por 10 minutos.
              </p>
            )}

            <SeatGrid
              rowsConfig={rowsConfig}
              seatStatuses={seatStatuses}
              selectedSeats={selectedSeats}
              onToggle={toggleSeat}
              size="md"
              variant="dark"
              pcdQty={pcdQty}
              compQty={compQty}
              comumQty={comumQty}
              onBlocked={setSeatLostNotice}
            />

            {companionOffer && (
              <div className="mt-3 flex items-center gap-3 bg-sky-500/10 border border-sky-500/30 rounded-xl p-3 text-xs text-sky-200">
                <Users size={16} className="shrink-0" aria-hidden="true" />
                <p className="flex-1">
                  <strong>Vai com acompanhante?</strong> O lugar {companionOffer.comp}, ao lado do {companionOffer.special}, está reservado para ele.
                </p>
                <button type="button" onClick={addCompanion}
                  className="px-3 py-2 rounded-lg bg-sky-500/30 hover:bg-sky-500/50 text-[10px] font-black uppercase tracking-widest cursor-pointer">
                  Adicionar acompanhante
                </button>
              </div>
            )}

            {pcdQty > 0 && specialSelected < pcdQty && (
              <p className="mt-3 text-[11px] text-sky-300">Escolha {pcdQty - specialSelected} lugar{pcdQty - specialSelected === 1 ? '' : 'es'} PCD (azul) para o seu pedido.</p>
            )}
            {compQty > 0 && compSelected < compQty && (
              <p className="mt-2 text-[11px] text-sky-300">Escolha o lugar do acompanhante, ao lado do lugar PCD.</p>
            )}

            <SeatLegend rowsConfig={rowsConfig} variant="dark" />
          </div>
        )}

        {/* Form do comprador */}
        <form onSubmit={handlePay} noValidate>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 space-y-3">
          <p className="text-xs font-black text-slate-300 uppercase tracking-widest mb-2">Dados do comprador</p>

          <Field label="Nome completo" icon={<UserIcon size={14} />} htmlFor="buyer-name">
            <input id="buyer-name" name="name" value={name} onChange={e => setName(e.target.value)}
              placeholder="Seu nome" autoComplete="name" required
              className="bg-transparent w-full text-sm outline-none placeholder:text-slate-600" />
          </Field>

          <Field label="Email" icon={<Mail size={14} />} htmlFor="buyer-email">
            <input id="buyer-email" name="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com" autoComplete="email" required
              className="bg-transparent w-full text-sm outline-none placeholder:text-slate-600" />
          </Field>

          <Field label="CPF" icon={<FileText size={14} />} hint="Obrigatório por lei" htmlFor="buyer-cpf">
            <input id="buyer-cpf" name="cpf" value={cpf} onChange={e => setCpf(formatCpf(e.target.value))}
              inputMode="numeric" placeholder="000.000.000-00" autoComplete="off" required
              className="bg-transparent w-full text-sm outline-none placeholder:text-slate-600 font-mono tracking-wide" />
          </Field>
          {cpf.replace(/\D/g, '').length === 11 && !isValidCpf(cpf) && (
            <p className="text-[10px] text-rose-300 -mt-2 flex items-center gap-1">
              <AlertCircle size={10} /> CPF inválido — verifique se digitou corretamente
            </p>
          )}

          <Field label="Telefone (opcional)" icon={<Phone size={14} />} htmlFor="buyer-phone">
            <input id="buyer-phone" name="phone" value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
              inputMode="tel" type="tel" placeholder="(00) 00000-0000" autoComplete="tel"
              className="bg-transparent w-full text-sm outline-none placeholder:text-slate-600 font-mono tracking-wide" />
          </Field>
        </div>

        {/* Resumo de valores */}
        {breakdown && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 space-y-2">
            {lines.map(l => (
              <Row key={l.idx} label={`${l.qty}× ${l.nome}`} value={formatBRL(l.precoUnit * l.qty)} />
            ))}
            {breakdown.totalDiscount > 0 && (
              <Row label={`Cupom ${appliedCouponCode ?? ''}`} value={`−${formatBRL(breakdown.totalDiscount)}`} />
            )}
            {breakdown.feeMode === 'repassar' && (
              <Row label="Taxa de serviço" value={formatBRL(breakdown.totalFee)} hint="Cobrada pela plataforma." />
            )}
            <div className="border-t border-white/10 pt-2 mt-2 flex items-baseline justify-between">
              <p className="font-black uppercase text-sm">Total</p>
              <p className="text-2xl font-black text-[#ff0068]">{formatBRL(breakdown.totalCharged)}</p>
            </div>
            {breakdown.feeMode === 'absorver' && (
              <p className="text-[10px] text-slate-500 mt-1">A taxa de serviço é absorvida pelo organizador.</p>
            )}
          </div>
        )}

        {error && (
          <div role="alert" aria-live="polite" className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-sm text-red-300 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="mb-4">
          <CheckoutLegalNotice accepted={refundAccepted} onAcceptedChange={setRefundAccepted} theme="dark" />
        </div>

        <button
          type="submit"
          disabled={!canSubmit || !refundAccepted}
          title={
            !seatsReady ? 'Escolha seu(s) lugar(es) antes de continuar'
              : !refundAccepted ? 'Aceite a política de reembolso para prosseguir'
              : undefined
          }
          className="w-full py-4 bg-[#ff0068] hover:bg-[#ff0068]/90 disabled:bg-white/10 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#ff0068]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
        >
          {paying ? <Loader2 className="animate-spin" size={16} /> : <Ticket size={16} />}
          {paying ? 'Gerando pagamento...' : 'Continuar pro pagamento'}
        </button>
        </form>

        <p className="text-center text-[11px] text-slate-500 mt-3">
          Sua vaga só é confirmada após o pagamento ser aprovado.
        </p>

        <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-500">
          <ShieldCheck size={12} className="text-emerald-400" />
          Pagamento seguro processado por
          <AsaasBadge variant="compact" theme="negative" width={100} height={30} />
        </div>

        <p className="text-[10px] text-slate-500 text-center mt-3 leading-relaxed">
          Após confirmar o pagamento (PIX/cartão/boleto), você recebe seus ingressos digitais com QR no email.
        </p>
      </div>
    </div>
  );
}

function Field({ label, icon, hint, htmlFor, children }: { label: string; icon: React.ReactNode; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
        {hint && <p className="text-[9px] text-slate-500">{hint}</p>}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl focus-within:border-[#ff0068]/50 transition-colors">
        <span className="text-slate-500">{icon}</span>
        {children}
      </div>
    </label>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-bold tabular-nums">{value}</span>
      </div>
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
