import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { validateCoupon } from '../services/couponService';
import type { RegistrationLot } from '../types';
import {
  CreditCard, Loader2, AlertCircle, CheckCircle, ArrowLeft, ExternalLink,
  Music2, Users, Tag, Ticket, X, Calendar, Shield,
} from 'lucide-react';
import AsaasBadge from '../components/AsaasBadge';

const SUPABASE_URL = 'https://ghpltzzijlvykiytwslu.supabase.co';

/**
 * Lotes vivem em `formacoes_config[].lotes`, não em uma coluna global de events.
 * Formato: `{ preco, data_virada }` (data_virada=null = lote final, sem deadline).
 */
type FormacaoLote = { preco: number; data_virada: string | null };

interface ActiveLot {
  preco: number;
  data_virada: string | null;
  /** Índice 1-based pra mostrar "Lote 1", "Lote 2" etc */
  index: number;
}

function getActiveLotFromFormacao(lotes: FormacaoLote[] | null | undefined): {
  lot: ActiveLot | null;
  allExpired: boolean;
} {
  if (!lotes || lotes.length === 0) return { lot: null, allExpired: false };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < lotes.length; i++) {
    const lot = lotes[i];
    if (!lot.data_virada) return { lot: { ...lot, index: i + 1 }, allExpired: false };
    const deadline = new Date(lot.data_virada + 'T23:59:59');
    if (deadline.getTime() >= today.getTime()) return { lot: { ...lot, index: i + 1 }, allExpired: false };
  }
  return { lot: null, allExpired: true };
}

const Checkout = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registration_id');
  const navigate = useNavigate();

  const [event, setEvent]             = useState<any>(null);
  const [registration, setRegistration] = useState<any>(null);
  const [loading, setLoading]         = useState(true);
  const [paying, setPaying]           = useState(false);
  const [confirming, setConfirming]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [baseFee, setBaseFee]         = useState<number>(0);
  const [activeLot, setActiveLot]     = useState<ActiveLot | null>(null);
  const [allLotsExpired, setAllLotsExpired] = useState(false);

  /* ── Cupom ── */
  const [couponCode, setCouponCode]           = useState('');
  const [applyingCoupon, setApplyingCoupon]   = useState(false);
  const [couponError, setCouponError]         = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon]     = useState<{ id: string; code: string; discount: number } | null>(null);

  const isGovernment = event?.event_type === 'government';
  const finalValue   = Math.max(0, baseFee - (appliedCoupon?.discount ?? 0));

  useEffect(() => {
    const load = async () => {
      if (!registrationId || !eventId) {
        setError('Inscrição não encontrada. Volte e tente novamente.');
        setLoading(false);
        return;
      }

      const [{ data: reg }, { data: ev }] = await Promise.all([
        supabase
          .from('registrations')
          .select('id, choreography_name, formacao, category, dance_style, status_pagamento, payment_url, profiles(full_name, email)')
          .eq('id', registrationId)
          .single(),
        supabase
          .from('events')
          .select('id, name, cover_url, formacoes_config, created_by, event_type')
          .eq('id', eventId)
          .single(),
      ]);

      if (!reg || !ev) { setError('Dados não encontrados.'); setLoading(false); return; }

      if (reg.status_pagamento === 'CONFIRMADO' || reg.status_pagamento === 'APROVADO') {
        navigate(`/pagamento/sucesso?registration_id=${registrationId}`);
        return;
      }

      setRegistration(reg);
      setEvent(ev);

      const formacoes: any[] = ev.formacoes_config ?? [];
      const mod = formacoes.find((m: any) => m.name === reg.formacao);
      const feeFromFormacao = mod?.fee ?? mod?.base_fee ?? 0;

      // Lotes vêm da própria formação (cada formação tem seus lotes).
      const { lot, allExpired } = getActiveLotFromFormacao(mod?.lotes);
      setActiveLot(lot);
      setAllLotsExpired(allExpired);

      // Preço do lote ativo substitui o preço base da formação
      setBaseFee(lot?.preco ?? feeFromFormacao);

      setLoading(false);
    };
    load();
  }, [registrationId, eventId, navigate]);

  const handleApplyCoupon = async () => {
    setCouponError(null);
    if (!couponCode.trim()) return;
    if (!eventId) return;
    setApplyingCoupon(true);
    try {
      const { coupon, discount } = await validateCoupon(eventId, couponCode, baseFee);
      setAppliedCoupon({ id: coupon.id, code: coupon.code, discount });
    } catch (err: any) {
      setCouponError(err.message);
    } finally {
      setApplyingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponError(null);
  };

  const handlePay = async () => {
    setPaying(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/create-payment-asaas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          registration_id: registrationId,
          event_id:        eventId,
          coupon_id:       appliedCoupon?.id ?? null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Erro ao gerar o pagamento. Tente novamente.');
      const paymentUrl = data.invoice_url;
      if (!paymentUrl) throw new Error('URL de pagamento não retornada.');
      window.location.href = paymentUrl;
    } catch (err: any) {
      setError(err.message);
      setPaying(false);
    }
  };

  const handleConfirmFree = async () => {
    setConfirming(true);
    setError(null);
    try {
      await supabase
        .from('registrations')
        .update({ status_pagamento: 'CONFIRMADO', valor_pago: 0 })
        .eq('id', registrationId);
      await supabase
        .from('coreografias')
        .update({ status_pagamento: 'APROVADO' })
        .eq('id', registrationId);
      navigate(`/pagamento/sucesso?registration_id=${registrationId}`);
    } catch (err: any) {
      setError(err.message ?? 'Erro ao confirmar inscrição.');
      setConfirming(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-[#ff0068]" />
    </div>
  );

  if (error && !registration) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center space-y-3 max-w-sm">
        <AlertCircle size={40} className="text-red-400 mx-auto" />
        <p className="font-black text-xl text-slate-900 dark:text-white">Ops!</p>
        <p className="text-slate-500 text-sm">{error}</p>
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-[#ff0068] text-sm font-bold mx-auto">
          <ArrowLeft size={14} /> Voltar
        </button>
      </div>
    </div>
  );

  /* ── Inscrições encerradas (todos os lotes expirados) ── */
  if (allLotsExpired && !isGovernment) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-sm">
          <AlertCircle size={40} className="text-amber-400 mx-auto" />
          <p className="font-black text-xl text-slate-900 dark:text-white uppercase italic">Inscrições Encerradas</p>
          <p className="text-slate-500 text-sm">O prazo de todos os lotes de inscrição já venceu para este evento.</p>
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-[#ff0068] text-sm font-bold mx-auto">
            <ArrowLeft size={14} /> Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-20">
      <div className="max-w-lg mx-auto px-4 pt-10 space-y-6">
        {/* Header */}
        <div>
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs font-bold mb-4 transition-all">
            <ArrowLeft size={14} /> Voltar
          </button>
          <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">
            {isGovernment ? 'Confirmar Inscrição' : 'Finalizar Inscrição'}
          </p>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white mt-1 italic">
            {event?.name}
          </h1>
        </div>

        {/* Resumo da inscrição */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 shadow-sm space-y-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Resumo da Inscrição</p>

          <div className="space-y-3">
            <LineItem icon={Music2} label="Coreografia" value={registration?.choreography_name} />
            <LineItem icon={Users}  label="Formação"    value={registration?.formacao} />
            <LineItem icon={Tag}    label="Categoria"   value={registration?.category} />
          </div>

          {/* Lote ativo */}
          {activeLot && !isGovernment && (
            <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl">
              <Calendar size={14} className="text-emerald-500 shrink-0" />
              <div className="flex-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                <p className="font-black uppercase tracking-widest">Lote {activeLot.index}</p>
                {activeLot.data_virada && (
                  <p className="opacity-80">
                    Até {new Date(activeLot.data_virada + 'T12:00').toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Total */}
          {isGovernment ? (
            <div className="border-t border-slate-100 dark:border-white/8 pt-4 flex items-center justify-between">
              <p className="text-sm text-slate-500 font-bold">Valor</p>
              <p className="text-2xl font-black text-emerald-500 italic">GRATUITO</p>
            </div>
          ) : (
            <div className="border-t border-slate-100 dark:border-white/8 pt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Subtotal</span>
                <span className="font-bold">R$ {baseFee.toFixed(2)}</span>
              </div>
              {appliedCoupon && (
                <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
                  <span>Cupom {appliedCoupon.code}</span>
                  <span className="font-bold">− R$ {appliedCoupon.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-white/8">
                <p className="text-sm text-slate-500 font-bold">Total</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white">
                  R$ <span className="text-[#ff0068]">{finalValue.toFixed(2)}</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Cupom — somente eventos pagos */}
        {!isGovernment && (
          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Ticket size={14} className="text-[#ff0068]" />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cupom de desconto</p>
            </div>
            {appliedCoupon ? (
              <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl">
                <CheckCircle size={16} className="text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono font-black text-sm text-emerald-700 dark:text-emerald-400">{appliedCoupon.code}</p>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Desconto de R$ {appliedCoupon.discount.toFixed(2)} aplicado</p>
                </div>
                <button onClick={handleRemoveCoupon} className="p-1 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-lg">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="CÓDIGO DO CUPOM"
                    className="flex-1 font-mono bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50 uppercase"
                  />
                  <button
                    onClick={handleApplyCoupon}
                    disabled={applyingCoupon || !couponCode.trim()}
                    className="px-5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    {applyingCoupon ? <Loader2 size={14} className="animate-spin" /> : 'Aplicar'}
                  </button>
                </div>
                {couponError && (
                  <p className="text-[10px] text-red-500 flex items-center gap-1.5">
                    <AlertCircle size={11} /> {couponError}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Aviso de pagamento / governo */}
        {isGovernment ? (
          <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl">
            <Shield size={16} className="text-emerald-500 shrink-0 mt-0.5" />
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400 space-y-0.5">
              <p className="font-black uppercase tracking-wider">Evento Gratuito</p>
              <p>Este é um evento público. Sua inscrição será confirmada automaticamente e você receberá um e-mail de confirmação.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-2xl">
            <CheckCircle size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <div className="text-[10px] text-blue-700 dark:text-blue-400 space-y-0.5">
              <p className="font-black uppercase tracking-wider">Pagamento seguro via Asaas</p>
              <p>Você será redirecionado para o ambiente seguro de pagamento. Aceitamos Pix, cartão de crédito e boleto bancário.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Botão principal */}
        {isGovernment ? (
          <button
            onClick={handleConfirmFree}
            disabled={confirming}
            className="w-full flex items-center justify-center gap-3 py-5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
          >
            {confirming
              ? <><Loader2 size={18} className="animate-spin" /> Confirmando...</>
              : <><CheckCircle size={18} /> Confirmar Inscrição Gratuita</>
            }
          </button>
        ) : (
          <button
            onClick={handlePay}
            disabled={paying || finalValue <= 0}
            className="w-full flex items-center justify-center gap-3 py-5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
          >
            {paying
              ? <><Loader2 size={18} className="animate-spin" /> Gerando pagamento...</>
              : <><CreditCard size={18} /> Pagar R$ {finalValue.toFixed(2)} <ExternalLink size={14} /></>
            }
          </button>
        )}

        {!isGovernment && (
          <>
            <p className="text-center text-[10px] text-slate-400 px-4">
              Ao clicar em "Pagar", você será redirecionado para o checkout seguro do Asaas. Sua inscrição será confirmada automaticamente após a aprovação do pagamento.
            </p>
            <div className="flex justify-center pt-2">
              <AsaasBadge variant="compact" />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const LineItem: React.FC<{ icon: any; label: string; value: string }> = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-xl bg-[#ff0068]/10 flex items-center justify-center text-[#ff0068] shrink-0">
      <Icon size={14} />
    </div>
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-widest">{label}</p>
      <p className="font-black text-sm text-slate-900 dark:text-white">{value}</p>
    </div>
  </div>
);

export default Checkout;
