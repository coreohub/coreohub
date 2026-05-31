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

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  Ticket, Loader2, AlertCircle, ArrowLeft, ShieldCheck, User as UserIcon, Mail, Phone, FileText, Minus, Plus,
  Tag, X, Check, Trash2,
} from 'lucide-react';
import AsaasBadge from '../components/AsaasBadge';
import CheckoutLegalNotice from '../components/CheckoutLegalNotice';
import { resolveLote, todayISO, type Lote } from '../utils/lotes';

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
          .select('id, name, slug, event_date, location, cover_url, ingressos_config, audience_sales_enabled, audience_commission_percent, audience_fee_mode, audience_max_per_cpf, audience_max_per_purchase, politica_ingressos')
          .eq(filterCol, idOrSlug)
          .maybeSingle();
        if (evErr || !ev) { setError('Evento não encontrado.'); return; }
        if (!ev.audience_sales_enabled || ev.politica_ingressos !== 'INTERNO') {
          setError('Venda de ingressos não está disponível para este evento.');
          return;
        }
        if (ev.event_date) {
          const deadline = new Date(ev.event_date + 'T23:59:59');
          if (deadline.getTime() < Date.now()) {
            setError('Este evento já aconteceu. Vendas de ingressos encerradas.');
            return;
          }
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
    if (invokeErr) return { error: invokeErr.message ?? 'Cupom inválido' };
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

  // ─── Breakdown (replica a distribuição do edge p/ bater com a cobrança) ───
  const breakdown = useMemo(() => {
    if (!event || lines.length === 0) return null;
    const commPct = Number(event.audience_commission_percent ?? 10);
    const feeMode = event.audience_fee_mode ?? 'repassar';
    const discountTotal = Math.min(couponDiscount, totalBase);
    let chargedTotal = 0, commTotal = 0, discountApplied = 0;
    for (const l of lines) {
      const typeBase = l.precoUnit * l.qty;
      const typeDiscount = totalBase > 0 ? round2(discountTotal * (typeBase / totalBase)) : 0;
      const discountPerTicket = round2(typeDiscount / l.qty);
      const baseFeeUnit = round2(l.precoUnit - discountPerTicket);
      const commUnit = round2(baseFeeUnit * (commPct / 100));
      const chargedUnit = feeMode === 'repassar' ? round2(baseFeeUnit + commUnit) : baseFeeUnit;
      chargedTotal += round2(chargedUnit * l.qty);
      commTotal += round2(commUnit * l.qty);
      discountApplied += round2(discountPerTicket * l.qty);
    }
    return {
      feeMode,
      totalBase,
      totalDiscount: round2(discountApplied),
      totalFee: round2(commTotal),
      totalCharged: round2(chargedTotal),
    };
  }, [event, lines, totalBase, couponDiscount]);

  // ─── Submit ────────────────────────────────────────────────────────────────
  const anySoldOut = lines.some(l => stockByIdx[String(l.idx)]?.sold_out === true);
  const canSubmit = !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && isValidCpf(cpf) && totalQty >= 1 && !paying && !anySoldOut;

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
        },
      });
      if (invokeErr) throw new Error(invokeErr.message ?? 'Erro ao gerar pagamento. Tente novamente.');
      if (data?.error) throw new Error(data.error);
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
      {event?.cover_url && (
        <div className="relative h-32 md:h-48 overflow-hidden">
          <img src={event.cover_url} alt="" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0b0b0f]" />
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-6 -mt-8 relative">
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
          title={!refundAccepted ? 'Aceite a política de reembolso para prosseguir' : undefined}
          className="w-full py-4 bg-[#ff0068] hover:bg-[#ff0068]/90 disabled:bg-white/10 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#ff0068]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f]"
        >
          {paying ? <Loader2 className="animate-spin" size={16} /> : <Ticket size={16} />}
          {paying ? 'Gerando pagamento...' : 'Continuar pro pagamento'}
        </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-500">
          <ShieldCheck size={12} className="text-emerald-400" />
          Pagamento seguro processado por
          <AsaasBadge theme="negative" />
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
