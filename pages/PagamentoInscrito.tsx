import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  CreditCard, Loader2, AlertCircle, CheckCircle2,
  Music2, ArrowRight, Clapperboard, ExternalLink,
  RefreshCw, ShieldCheck, Receipt,
} from 'lucide-react';
import AsaasBadge from '../components/AsaasBadge';

const SUPABASE_URL  = 'https://ghpltzzijlvykiytwslu.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdocGx0enppamx2eWtpeXR3c2x1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDAyNjEsImV4cCI6MjA4NTg3NjI2MX0.AshAXh_5Dn2S3E74XbnDtxnb92kER8tAxEdZmKnywG8';

interface Coreografia {
  id: string;
  nome: string;
  event_id?: string;
  event_nome?: string;
  formacao?: string;
  tipo_apresentacao?: string;
  categoria_nome?: string;
  estilo_nome?: string;
  status: string;
  status_pagamento?: string;
  trilha_url?: string;
  mod_fee?: number;
}

interface EventFormacao {
  name?: string;
  fee?: number;
  base_fee?: number;
  is_active?: boolean;
}

const fmtCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Calcula o valor de uma coreografia tentando várias fontes em ordem:
 * 1. coreo.mod_fee (explícito)
 * 2. events.formacoes_config casando pelo nome da formação
 * 3. Primeira formação ativa do evento (fallback)
 */
const calcularValor = (
  coreo: Coreografia,
  modalidades: EventFormacao[]
): number => {
  if (coreo.mod_fee && coreo.mod_fee > 0) return coreo.mod_fee;

  const nome = (coreo.tipo_apresentacao ?? coreo.formacao ?? '').toLowerCase();
  if (nome) {
    const m = modalidades.find(x => x.name?.toLowerCase() === nome);
    const v = m?.fee ?? m?.base_fee;
    if (v && v > 0) return Number(v);
  }

  const primeira = modalidades.find(x => x.is_active !== false);
  const v = primeira?.fee ?? primeira?.base_fee;
  return v && v > 0 ? Number(v) : 0;
};

const PagamentoInscrito = () => {
  const navigate = useNavigate();
  const [coreografias, setCoreografias]   = useState<Coreografia[]>([]);
  const [modalidades, setModalidades]     = useState<EventFormacao[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [paying, setPaying]               = useState<string | null>(null); // id da coreo clicada
  const [payError, setPayError]           = useState<{ id: string; message: string } | null>(null);
  const [justApproved, setJustApproved]   = useState<string | null>(null); // para animação quando webhook aprovar

  // Status que exigem pagamento (coreografia aguardando checkout)
  const PAYMENT_STATUSES = useMemo(
    () => new Set(['RASCUNHO', 'PRONTA', 'PRONTO', 'AGUARDANDO_PAGAMENTO']),
    []
  );

  const fetchCoreografias = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }

      const [coreoRes, eventRes] = await Promise.all([
        supabase.from('coreografias').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('events').select('id, formacoes_config').order('created_at').limit(1).single(),
      ]);

      if (coreoRes.error) throw coreoRes.error;

      const firstEventId = eventRes.data?.id ?? null;
      const eventFormacoes: EventFormacao[] = (eventRes.data as any)?.formacoes_config ?? [];
      setModalidades(eventFormacoes);

      const enriched = (coreoRes.data || []).map(c => ({
        ...c,
        event_id: c.event_id ?? firstEventId,
      }));

      setCoreografias(
        enriched.filter(c =>
          // Ainda não pagou (status_pagamento != APROVADO) E está em status de pagamento
          c.status_pagamento !== 'APROVADO' &&
          PAYMENT_STATUSES.has(c.status) &&
          c.status !== 'PAGO'
        )
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [navigate, PAYMENT_STATUSES]);

  useEffect(() => { fetchCoreografias(); }, [fetchCoreografias]);

  // Realtime: escuta mudanças na tabela coreografias para o usuário atual
  // Quando o webhook aprovar um pagamento, a linha é atualizada e aqui refletimos.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupRealtime = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      channel = supabase
        .channel('pagamento-inscrito-' + user.id)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'coreografias',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const novo = payload.new as Coreografia;
            // Se virou APROVADO, anima e depois remove da lista
            if (novo.status_pagamento === 'APROVADO') {
              setJustApproved(novo.id);
              setTimeout(() => {
                setCoreografias(prev => prev.filter(c => c.id !== novo.id));
                setJustApproved(null);
              }, 2500);
            } else {
              // Outras mudanças: atualiza a linha in-place
              setCoreografias(prev => prev.map(c => c.id === novo.id ? { ...c, ...novo } : c));
            }
          }
        )
        .subscribe();
    };

    setupRealtime();
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const handlePay = async (coreo: Coreografia) => {
    if (!coreo.event_id) {
      setPayError({ id: coreo.id, message: 'Esta coreografia não está vinculada a um evento. Edite-a em Minhas Coreografias.' });
      return;
    }
    setPaying(coreo.id);
    setPayError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`${SUPABASE_URL}/functions/v1/create-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': SUPABASE_ANON,
        },
        body: JSON.stringify({ registration_id: coreo.id, event_id: coreo.event_id }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? result.message ?? `Erro ${response.status} ao gerar o pagamento.`);
      }

      const paymentUrl = result.sandbox_init_point ?? result.init_point;
      window.location.href = paymentUrl;

    } catch (err: any) {
      setPayError({ id: coreo.id, message: err.message || 'Erro ao processar pagamento.' });
      setPaying(null);
    }
  };

  // Total e contagem para exibir no header
  const totalPendente = useMemo(
    () => coreografias.reduce((sum, c) => sum + calcularValor(c, modalidades), 0),
    [coreografias, modalidades]
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Efetue o <span className="text-[#ff0068]">Pagamento</span>
          </h1>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
            Confirme sua vaga — pague suas inscrições pendentes
          </p>
        </div>
        {!loading && coreografias.length > 0 && (
          <div className="text-right bg-[#ff0068]/10 border border-[#ff0068]/20 rounded-2xl px-4 py-2.5 shrink-0">
            <p className="text-[8px] font-black uppercase tracking-widest text-[#ff0068]/80">Total</p>
            <p className="text-lg font-black tracking-tighter text-[#ff0068]">{fmtCurrency(totalPendente)}</p>
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              {coreografias.length} {coreografias.length === 1 ? 'pendente' : 'pendentes'}
            </p>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-2xl">
        <ShieldCheck size={16} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-blue-700 dark:text-blue-400 font-bold leading-relaxed">
          Pagamento seguro via <strong>Mercado Pago</strong>. Aceitamos Pix e cartão de crédito/débito.
          Sua inscrição é confirmada automaticamente após aprovação.
        </p>
      </div>

      {/* Error global */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
          <button onClick={fetchCoreografias} className="ml-auto">
            <RefreshCw size={13} />
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[#ff0068]" />
        </div>
      ) : coreografias.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 size={28} className="text-emerald-500" />
          </div>
          <div>
            <p className="font-black uppercase tracking-tight text-slate-700 dark:text-slate-300">
              Tudo em dia!
            </p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Nenhuma inscrição aguardando pagamento
            </p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#ff0068] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md shadow-[#ff0068]/20 hover:scale-105 transition-all"
          >
            Voltar ao Início <ArrowRight size={13} />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {coreografias.map(coreo => {
            const fee = calcularValor(coreo, modalidades);
            const isPaying   = paying === coreo.id;
            const isApproved = justApproved === coreo.id;
            const rowError   = payError?.id === coreo.id ? payError.message : null;

            return (
              <div
                key={coreo.id}
                className={`p-5 bg-white dark:bg-white/[0.03] border rounded-2xl space-y-4 transition-all duration-500 ${
                  isApproved
                    ? 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-500/10 shadow-lg shadow-emerald-500/20 scale-[1.01]'
                    : isPaying
                      ? 'border-[#ff0068]/40 shadow-lg shadow-[#ff0068]/10'
                      : 'border-slate-200 dark:border-white/8'
                }`}
              >
                {/* Badge de status no topo, se APROVADO recente */}
                {isApproved && (
                  <div className="flex items-center justify-center gap-2 py-2 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest animate-pulse">
                    <CheckCircle2 size={14} /> Pagamento Aprovado!
                  </div>
                )}

                {/* Info da coreografia */}
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isApproved ? 'bg-emerald-500/20' : 'bg-[#ff0068]/10'
                  }`}>
                    <Clapperboard size={16} className={isApproved ? 'text-emerald-500' : 'text-[#ff0068]'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                      {coreo.nome}
                    </p>
                    <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                      {[coreo.event_nome, coreo.tipo_apresentacao || coreo.formacao, coreo.categoria_nome, coreo.estilo_nome]
                        .filter(Boolean).join(' · ')}
                    </p>
                    {/* Badges */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {/* Trilha */}
                      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest
                        ${coreo.trilha_url
                          ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${coreo.trilha_url ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                        {coreo.trilha_url ? 'Trilha enviada' : 'Trilha pendente'}
                      </div>
                      {/* Status pagamento */}
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Aguardando pagamento
                      </div>
                    </div>
                  </div>

                  {/* Valor */}
                  <div className="text-right shrink-0">
                    <p className="text-[9px] font-bold text-slate-400 uppercase">Valor</p>
                    {fee > 0
                      ? <p className="text-xl font-black tracking-tighter text-slate-900 dark:text-white">{fmtCurrency(fee)}</p>
                      : <p className="text-[9px] font-bold text-amber-500">A definir pelo evento</p>
                    }
                  </div>
                </div>

                {/* Erro específico desta linha */}
                {rowError && (
                  <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl">
                    <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] font-bold text-rose-700 dark:text-rose-400 leading-relaxed">{rowError}</p>
                  </div>
                )}

                {/* Aviso sem trilha */}
                {!coreo.trilha_url && (
                  <div className="flex items-center justify-between gap-3 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                    <p className="text-[9px] font-bold text-amber-700 dark:text-amber-400">
                      Você ainda não enviou a trilha sonora desta coreografia.
                    </p>
                    <button
                      onClick={() => navigate('/central-de-midia')}
                      className="shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-black text-[8px] uppercase tracking-widest transition-all"
                    >
                      Enviar agora
                    </button>
                  </div>
                )}

                {/* Botão pagar — só a linha clicada mostra loading; as outras continuam disponíveis */}
                <button
                  onClick={() => handlePay(coreo)}
                  disabled={isPaying || isApproved}
                  className={`w-full flex items-center justify-center gap-2 py-4 text-white rounded-xl font-black text-[11px] uppercase tracking-widest shadow-lg active:scale-[0.99] transition-all ${
                    isApproved
                      ? 'bg-emerald-500 shadow-emerald-500/20 cursor-default'
                      : 'bg-[#ff0068] hover:bg-[#d4005a] shadow-[#ff0068]/20 disabled:opacity-70 disabled:cursor-wait'
                  }`}
                >
                  {isApproved ? (
                    <><CheckCircle2 size={15} /> Pagamento Aprovado</>
                  ) : isPaying ? (
                    <><Loader2 size={15} className="animate-spin" /> Gerando pagamento...</>
                  ) : (
                    <><CreditCard size={15} /> Efetuar Pagamento {fee > 0 ? `— ${fmtCurrency(fee)}` : ''} <ExternalLink size={13} /></>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer info */}
      {!loading && coreografias.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-center gap-2">
            <Receipt size={12} className="text-slate-400" />
            <p className="text-center text-[9px] text-slate-400 leading-relaxed">
              Cada coreografia é paga individualmente. Pagamento seguro via Asaas.
            </p>
          </div>
          <div className="flex justify-center">
            <AsaasBadge variant="compact" />
          </div>
        </div>
      )}

      {/* Trilha pendente link */}
      {!loading && coreografias.some(c => !c.trilha_url) && (
        <button
          onClick={() => navigate('/central-de-midia')}
          className="w-full flex items-center justify-center gap-2 py-3 border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 dark:text-slate-400 font-black text-[10px] uppercase tracking-widest hover:border-[#ff0068]/40 hover:text-[#ff0068] transition-all"
        >
          <Music2 size={13} /> Ir para Central de Mídia
        </button>
      )}
    </div>
  );
};

export default PagamentoInscrito;
