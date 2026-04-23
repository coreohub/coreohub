import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { CreditCard, Loader2, AlertCircle, CheckCircle, ArrowLeft, ExternalLink, Music2, Users, Tag } from 'lucide-react';

const Checkout = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registration_id');
  const navigate = useNavigate();

  const [event, setEvent]             = useState<any>(null);
  const [registration, setRegistration] = useState<any>(null);
  const [loading, setLoading]         = useState(true);
  const [paying, setPaying]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [fee, setFee]                 = useState<number>(0);

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
          .select('id, name, cover_url, formacoes_config, created_by')
          .eq('id', eventId)
          .single(),
      ]);

      if (!reg || !ev) { setError('Dados não encontrados.'); setLoading(false); return; }

      // Se já foi pago, redireciona para sucesso
      if (reg.status_pagamento === 'CONFIRMADO') {
        navigate(`/pagamento/sucesso?registration_id=${registrationId}`);
        return;
      }

      setRegistration(reg);
      setEvent(ev);

      const formacoes: any[] = ev.formacoes_config ?? [];
      const mod = formacoes.find((m: any) => m.name === reg.formacao);
      setFee(mod?.fee ?? mod?.base_fee ?? 0);

      setLoading(false);
    };
    load();
  }, [registrationId, eventId, navigate]);

  const handlePay = async () => {
    setPaying(true);
    setError(null);
    try {
      const SUPABASE_URL = 'https://ghpltzzijlvykiytwslu.supabase.co';
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`${SUPABASE_URL}/functions/v1/create-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ registration_id: registrationId, event_id: eventId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'Erro ao gerar o pagamento. Tente novamente.');
      }

      // Em ambiente de teste usa sandbox_init_point, em produção usa init_point
      const paymentUrl = data.sandbox_init_point ?? data.init_point;
      window.location.href = paymentUrl;

    } catch (err: any) {
      setError(err.message);
      setPaying(false);
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-20">
      <div className="max-w-lg mx-auto px-4 pt-10 space-y-6">

        {/* Header */}
        <div>
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs font-bold mb-4 transition-all">
            <ArrowLeft size={14} /> Voltar
          </button>
          <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Finalizar Inscrição</p>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white mt-1 italic">
            {event?.name}
          </h1>
        </div>

        {/* Resumo da inscrição */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 shadow-sm space-y-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Resumo da Inscrição</p>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#ff0068]/10 flex items-center justify-center text-[#ff0068] shrink-0">
                <Music2 size={14} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">Coreografia</p>
                <p className="font-black text-sm text-slate-900 dark:text-white">{registration?.choreography_name}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#ff0068]/10 flex items-center justify-center text-[#ff0068] shrink-0">
                <Users size={14} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">Formação</p>
                <p className="font-black text-sm text-slate-900 dark:text-white">{registration?.formacao}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#ff0068]/10 flex items-center justify-center text-[#ff0068] shrink-0">
                <Tag size={14} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">Categoria</p>
                <p className="font-black text-sm text-slate-900 dark:text-white">{registration?.category}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-white/8 pt-4 flex items-center justify-between">
            <p className="text-sm text-slate-500 font-bold">Total</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white">
              R$ <span className="text-[#ff0068]">{fee.toFixed(2)}</span>
            </p>
          </div>
        </div>

        {/* Mercado Pago info */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-2xl">
          <CheckCircle size={16} className="text-blue-500 shrink-0 mt-0.5" />
          <div className="text-[10px] text-blue-700 dark:text-blue-400 space-y-0.5">
            <p className="font-black uppercase tracking-wider">Pagamento seguro via Mercado Pago</p>
            <p>Você será redirecionado para o ambiente seguro do Mercado Pago. Aceitamos cartão de crédito, débito, Pix e boleto.</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Botão pagar */}
        <button
          onClick={handlePay}
          disabled={paying || fee <= 0}
          className="w-full flex items-center justify-center gap-3 py-5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
        >
          {paying
            ? <><Loader2 size={18} className="animate-spin" /> Gerando pagamento...</>
            : <><CreditCard size={18} /> Pagar R$ {fee.toFixed(2)} com Mercado Pago <ExternalLink size={14} /></>
          }
        </button>

        <p className="text-center text-[10px] text-slate-400 px-4">
          Ao clicar em "Pagar", você será redirecionado para o Mercado Pago. Sua inscrição será confirmada automaticamente após a aprovação do pagamento.
        </p>
      </div>
    </div>
  );
};

export default Checkout;
