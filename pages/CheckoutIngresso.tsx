/**
 * CheckoutIngresso — Tier 1 paid tickets, guest checkout (sem login).
 *
 * Fluxo:
 *   /evento/<slug> → click "Comprar" no tipo de ingresso
 *   /checkout-ingresso/<idOrSlug>/<ticketTypeIdx> ← AQUI
 *   form (nome+email+CPF+fone) + escolha de quantidade (respeita audience_max_per_purchase)
 *   → POST create-audience-ticket → redirect Asaas → webhook confirma e libera ingresso
 *   → comprador recebe email com link /meu-ingresso/<token>
 *
 * Uma página, sem wizard (Baymard +35% conversão).
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, supabaseUrl } from '../services/supabase';
import {
  Ticket, Loader2, AlertCircle, ArrowLeft, ShieldCheck, User as UserIcon, Mail, Phone, FileText, Minus, Plus,
} from 'lucide-react';
import AsaasBadge from '../components/AsaasBadge';

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0);

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

export default function CheckoutIngresso() {
  const { idOrSlug, ticketTypeIdx } = useParams<{ idOrSlug: string; ticketTypeIdx: string }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<any>(null);
  const [ticketType, setTicketType] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf]     = useState('');
  const [phone, setPhone] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [paying, setPaying] = useState(false);

  // ─── Hidrata evento ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!idOrSlug || ticketTypeIdx === undefined) return;
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
        if (evErr || !ev) {
          setError('Evento não encontrado.');
          return;
        }
        if (!ev.audience_sales_enabled || ev.politica_ingressos !== 'INTERNO') {
          setError('Venda de ingressos não está disponível para este evento.');
          return;
        }
        const ingressos: any[] = Array.isArray(ev.ingressos_config) ? ev.ingressos_config : [];
        const idx = parseInt(ticketTypeIdx, 10);
        const t = ingressos[idx];
        if (!t?.nome || Number(t.preco) <= 0) {
          setError('Tipo de ingresso inválido.');
          return;
        }
        setEvent(ev);
        setTicketType({ ...t, _idx: idx });
      } finally {
        setLoading(false);
      }
    })();
  }, [idOrSlug, ticketTypeIdx]);

  // ─── Tipo (kind) e regras especiais ───────────────────────────────────────
  const kind = useMemo<string>(() => {
    if (!ticketType) return 'inteira';
    const n = String(ticketType.nome ?? '').toLowerCase();
    if (n.includes('meia')) return 'meia';
    if (n.includes('solidári') || n.includes('solidari')) return 'solidaria';
    if (n.includes('cortes')) return 'cortesia';
    return 'inteira';
  }, [ticketType]);

  const isMeia = kind === 'meia';
  const maxPurchase = Math.max(1, Math.min(
    Number(event?.audience_max_per_purchase ?? 6),
    Number(event?.audience_max_per_cpf ?? 6),
  ));
  // Lei 12.933: meia tem hard limit 1
  const effectiveMax = isMeia ? 1 : maxPurchase;

  useEffect(() => {
    if (quantity > effectiveMax) setQuantity(effectiveMax);
  }, [effectiveMax, quantity]);

  // ─── Cálculo de preço com fee_mode ────────────────────────────────────────
  const breakdown = useMemo(() => {
    if (!event || !ticketType) return null;
    const baseUnit = Number(ticketType.preco ?? 0);
    const commPct = Number(event.audience_commission_percent ?? 10);
    const commUnit = Number((baseUnit * (commPct / 100)).toFixed(2));
    const feeMode = event.audience_fee_mode ?? 'repassar';
    const chargedUnit = feeMode === 'repassar' ? Number((baseUnit + commUnit).toFixed(2)) : baseUnit;
    const totalCharged = Number((chargedUnit * quantity).toFixed(2));
    const totalBase    = Number((baseUnit * quantity).toFixed(2));
    const totalFee     = Number((commUnit * quantity).toFixed(2));
    return {
      baseUnit, commUnit, chargedUnit, feeMode,
      totalBase, totalFee, totalCharged,
    };
  }, [event, ticketType, quantity]);

  // ─── Submit ────────────────────────────────────────────────────────────────
  const canSubmit = !!name.trim() && !!email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && isValidCpf(cpf) && quantity >= 1 && quantity <= effectiveMax && !paying;

  const handlePay = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit || !event || !ticketType) return;
    setPaying(true);
    setError(null);
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/create-audience-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event.id,
          ticket_type_idx: ticketType._idx,
          buyer: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            cpf: cpf.replace(/\D/g, ''),
            phone: phone.replace(/\D/g, '') || undefined,
          },
          quantity,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? 'Erro ao gerar pagamento. Tente novamente.');
      if (!data.invoice_url) throw new Error('URL de pagamento não retornada.');
      // Redireciona pro Asaas
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
          Comprar ingresso
        </h1>
        <p className="text-sm text-slate-400 mb-6">{event.name}</p>

        {/* Tipo de ingresso + quantidade */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest">{ticketType.nome}</p>
              {ticketType.obs && <p className="text-xs text-slate-400 mt-0.5">{ticketType.obs}</p>}
            </div>
            <p className="text-xl font-black text-white">{formatBRL(ticketType.preco)}</p>
          </div>

          {isMeia && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 mb-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-200">
                <strong>Lei 12.933:</strong> meia-entrada é nominativa e limitada a 1 por CPF. No portão, apresente documento que comprove o benefício (ID estudantil, ID jovem, idoso, PCD).
              </p>
            </div>
          )}

          {/* Quantidade */}
          <div className="flex items-center justify-between border-t border-white/10 pt-3">
            <p className="text-xs uppercase font-black tracking-widest text-slate-400">Quantidade</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"
              >
                <Minus size={14} />
              </button>
              <span className="text-lg font-black tabular-nums w-6 text-center">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity(q => Math.min(effectiveMax, q + 1))}
                disabled={quantity >= effectiveMax}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
          {effectiveMax < maxPurchase && (
            <p className="text-[10px] text-slate-500 text-right mt-1">
              Limite legal de {effectiveMax} para meia-entrada.
            </p>
          )}
          {effectiveMax === maxPurchase && (
            <p className="text-[10px] text-slate-500 text-right mt-1">
              Máx. {maxPurchase} por compra.
            </p>
          )}
        </div>

        {/* Form do comprador */}
        <form onSubmit={handlePay} noValidate>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 space-y-3">
          <p className="text-xs font-black text-slate-300 uppercase tracking-widest mb-2">Dados do comprador</p>

          <Field label="Nome completo" icon={<UserIcon size={14} />} htmlFor="buyer-name">
            <input
              id="buyer-name"
              name="name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Seu nome"
              autoComplete="name"
              required
              className="bg-transparent w-full text-sm outline-none placeholder:text-slate-600"
            />
          </Field>

          <Field label="Email" icon={<Mail size={14} />} htmlFor="buyer-email">
            <input
              id="buyer-email"
              name="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              required
              className="bg-transparent w-full text-sm outline-none placeholder:text-slate-600"
            />
          </Field>

          <Field label="CPF" icon={<FileText size={14} />} hint="Obrigatório por lei" htmlFor="buyer-cpf">
            <input
              id="buyer-cpf"
              name="cpf"
              value={cpf}
              onChange={e => setCpf(formatCpf(e.target.value))}
              inputMode="numeric"
              placeholder="000.000.000-00"
              autoComplete="off"
              required
              className="bg-transparent w-full text-sm outline-none placeholder:text-slate-600 font-mono tracking-wide"
            />
          </Field>

          <Field label="Telefone (opcional)" icon={<Phone size={14} />} htmlFor="buyer-phone">
            <input
              id="buyer-phone"
              name="phone"
              value={phone}
              onChange={e => setPhone(formatPhone(e.target.value))}
              inputMode="tel"
              type="tel"
              placeholder="(00) 00000-0000"
              autoComplete="tel"
              className="bg-transparent w-full text-sm outline-none placeholder:text-slate-600 font-mono tracking-wide"
            />
          </Field>
        </div>

        {/* Resumo */}
        {breakdown && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 space-y-2">
            <Row label={`${quantity}× ${ticketType.nome}`} value={formatBRL(breakdown.totalBase)} />
            {breakdown.feeMode === 'repassar' && (
              <Row
                label="Taxa de serviço"
                value={formatBRL(breakdown.totalFee)}
                hint="Cobrada pela plataforma."
              />
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

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-4 bg-[#ff0068] hover:bg-[#ff0068]/90 disabled:bg-white/10 disabled:text-slate-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
        >
          {paying ? <Loader2 className="animate-spin" size={16} /> : <Ticket size={16} />}
          {paying ? 'Gerando pagamento...' : 'Continuar pro pagamento'}
        </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-500">
          <ShieldCheck size={12} className="text-emerald-400" />
          Pagamento seguro processado por
          <AsaasBadge />
        </div>

        <p className="text-[10px] text-slate-500 text-center mt-3 leading-relaxed">
          Após confirmar o pagamento (PIX/cartão/boleto), você recebe seu ingresso digital com QR no email.
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
