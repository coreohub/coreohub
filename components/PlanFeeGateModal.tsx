import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wallet, Receipt, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../services/supabase';

interface PendingPlanFeeEvent {
  id: string;
  name: string;
  billing_plan: 'essencial' | 'escala';
  billing_plan_asaas_payment_id: string | null;
}

const PLAN_FIXED_FEE: Record<string, number> = { essencial: 250, escala: 1490 };
const PLAN_LABEL: Record<string, string> = { essencial: 'Essencial', escala: 'Escala' };

function seenKey(eventId: string) {
  return `coreohub_plan_fee_modal_seen_${eventId}`;
}

interface Props {
  producerId: string;
  /** Suprime a checagem inteira — usado durante impersonation (super admin
   *  "visualizando como Produtor" não deve disparar ação financeira real
   *  em nome de outro produtor sem ele estar na sessão). */
  suppressed?: boolean;
}

/**
 * Gate obrigatório (sem X, sem "lembrar depois") pra taxa fixa de plano
 * (Essencial R$250 / Escala R$1.490) não paga — decisão de produto fechada
 * 2026-09-20. Aparece 1x por sessão de login (sessionStorage por evento)
 * quando o produtor tem evento real com billing_plan essencial/escala,
 * billing_plan_fixed_fee_paid_at ainda NULL, e o plano foi setado há mais
 * de 1h (billing_plan_set_at — exclui quem está no meio do fluxo normal de
 * pagamento na criação do evento, que ainda não teve tempo de confirmar via
 * webhook).
 *
 * 2 caminhos, sem 3ª opção: "Pagar agora" abre a fatura Asaas existente
 * (billing_plan_asaas_payment_id); "Descontar do meu saldo" desconta na
 * hora do saldo já disponível na subconta via transferência interna
 * (deduct-plan-fee-now) — sem esperar D+7.
 *
 * createPortal pra escapar do stacking context de <main z-10> do
 * PrivateLayout (lição já documentada no projeto — z-index direto não
 * basta, fica preso atrás de outros elementos).
 */
const PlanFeeGateModal: React.FC<Props> = ({ producerId, suppressed }) => {
  const [pendingEvents, setPendingEvents] = useState<PendingPlanFeeEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ kind: 'ok' | 'pending' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (suppressed || !producerId) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('events')
        .select('id, name, billing_plan, billing_plan_asaas_payment_id')
        .eq('created_by', producerId)
        .eq('is_demo', false)
        .in('billing_plan', ['essencial', 'escala'])
        .is('billing_plan_fixed_fee_paid_at', null)
        .lt('billing_plan_set_at', oneHourAgo)
        // Sem ordenação explícita, Postgres não garante ordem estável —
        // produtor com 2+ eventos pendentes pode ver primeiro o que ainda
        // nem tem fatura gerada (achado real 2026-09-20). Prioriza quem já
        // tem fatura (billing_plan_asaas_payment_id preenchido) — é o único
        // caminho acionável com os 2 botões de imediato.
        .order('billing_plan_asaas_payment_id', { ascending: true, nullsFirst: false })
        .order('billing_plan_set_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error('[PlanFeeGateModal] erro ao consultar eventos pendentes:', error);
        setLoaded(true);
        return;
      }
      const unseen = (data ?? []).filter((ev: any) => {
        try { return sessionStorage.getItem(seenKey(ev.id)) !== '1'; } catch { return true; }
      }) as PendingPlanFeeEvent[];
      setPendingEvents(unseen);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [producerId, suppressed]);

  const markSeenAndAdvance = useCallback((eventId: string) => {
    try { sessionStorage.setItem(seenKey(eventId), '1'); } catch { /* storage bloqueado/privado — segue sem persistir */ }
    setPendingEvents(prev => prev.filter(ev => ev.id !== eventId));
    setResultMsg(null);
  }, []);

  const current = pendingEvents[0];

  const handlePayInvoice = () => {
    if (!current?.billing_plan_asaas_payment_id) return;
    // Mesmo padrão de construção de link já usado em pages/Registrations.tsx
    // — invoice do Asaas é sempre https://www.asaas.com/i/<id sem prefixo pay_>.
    const url = `https://www.asaas.com/i/${current.billing_plan_asaas_payment_id.replace(/^pay_/, '')}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    markSeenAndAdvance(current.id);
  };

  const handleDeductFromBalance = async () => {
    if (!current) return;
    setActionLoading(true);
    setResultMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('deduct-plan-fee-now', {
        body: { event_id: current.id },
      });
      if (error || data?.status === 'error') {
        setResultMsg({ kind: 'err', text: data?.message ?? error?.message ?? 'Não foi possível descontar agora.' });
        return;
      }
      const eventId = current.id;
      if (data?.confirmed) {
        setResultMsg({ kind: 'ok', text: data?.message ?? 'Taxa descontada com sucesso.' });
      } else if (data?.pending) {
        setResultMsg({ kind: 'pending', text: data?.message ?? 'Transferência criada — aguardando aprovação no app da Asaas.' });
      } else {
        setResultMsg({ kind: 'ok', text: data?.message ?? 'Tudo certo.' });
      }
      setTimeout(() => markSeenAndAdvance(eventId), 2200);
    } catch (e: any) {
      setResultMsg({ kind: 'err', text: e?.message ?? 'Erro inesperado ao processar o desconto.' });
    } finally {
      setActionLoading(false);
    }
  };

  if (!loaded || suppressed || !current) return null;

  const valor = PLAN_FIXED_FEE[current.billing_plan];
  const planoLabel = PLAN_LABEL[current.billing_plan];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#ff0068]/10 flex items-center justify-center flex-shrink-0">
            <Receipt size={20} className="text-[#ff0068]" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ativação de plano pendente</p>
            <h3 className="text-lg font-black uppercase tracking-tight italic text-slate-900 dark:text-white leading-tight">
              Taxa do plano {planoLabel}
            </h3>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          O evento <strong className="text-slate-900 dark:text-white">{current.name}</strong> está no plano{' '}
          <strong>{planoLabel}</strong>, mas a taxa única de ativação (<strong>R$ {valor.toFixed(2)}</strong>) ainda
          não foi confirmada. Escolha como quitar agora:
        </p>

        {resultMsg && (
          <div
            className={`flex items-start gap-2 p-3 rounded-xl text-sm ${
              resultMsg.kind === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : resultMsg.kind === 'pending'
                ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300'
            }`}
            role="status"
          >
            {resultMsg.kind === 'err' ? (
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
            )}
            <span>{resultMsg.text}</span>
          </div>
        )}

        <div className="space-y-2.5">
          <button
            onClick={handlePayInvoice}
            disabled={actionLoading || !current.billing_plan_asaas_payment_id}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-400 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-colors"
          >
            <Receipt size={16} />
            Pagar agora (fatura)
          </button>
          <button
            onClick={handleDeductFromBalance}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-slate-900 hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/15 disabled:opacity-60 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-colors"
          >
            {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
            Descontar do meu saldo
          </button>
        </div>

        {!current.billing_plan_asaas_payment_id && (
          <p className="text-xs text-slate-400">
            Fatura ainda não gerada pra este evento — use "Descontar do meu saldo" ou fale com o suporte.
          </p>
        )}
      </div>
    </div>,
    document.body
  );
};

export default PlanFeeGateModal;
