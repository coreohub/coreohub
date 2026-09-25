import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Receipt, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { usePlanFeePending, openPlanFeeInvoice, PLAN_FIXED_FEE, PLAN_LABEL } from '../hooks/usePlanFeePending';

interface Props {
  producerId: string;
  /** true quando o super admin está "Ver como" esse produtor. O gate
   *  continua aparecendo (pedido explícito 2026-09-20, pra inspeção/teste),
   *  mas ganha um caminho — "Fechar" — que só existe nesse contexto:
   *  admin não deveria ser forçado a tomar (ou fingir que tomou) uma decisão
   *  financeira em nome de outra pessoa só pra conseguir sair da tela. */
  isImpersonating?: boolean;
}

/**
 * Cartão em tela cheia da taxa fixa do plano (Essencial R$250 / Escala R$1.490)
 * — decisão de produto 2026-09-25.
 *
 * O evento nasce já no plano escolhido, com a taxa pendente
 * (billing_plan_fixed_fee_paid_at NULL) e 7 dias pra configurar tudo
 * (billing_plan_fee_due_at). Dois modos, mesmo cartão:
 *   - DENTRO do prazo ("suave"): aparece 1x por login (sessionStorage por
 *     evento) com "Pagar agora" e "Continuar configurando" — ela ainda tem os 7
 *     dias pra configurar; o PlanFeeReminderBanner segue como lembrete fixo.
 *   - DEPOIS do prazo ("trava"): sem X, sem "continuar", sem marcar como visto —
 *     trava o painel até o webhook confirmar o pagamento.
 *
 * "Pagar agora" chama create-plan-fixed-fee-payment, que é idempotente: se a
 * fatura ainda está em aberto devolve a mesma; se venceu (boleto cancelado no
 * vencimento) apaga e gera outra na hora — o link nunca fica morto. A opção
 * "Descontar do meu saldo" (deduct-plan-fee-now) saiu da UI: dependia de
 * aprovação manual no app da Asaas e não era confiável.
 *
 * createPortal pra escapar do stacking context de <main z-10> do
 * PrivateLayout (lição já documentada no projeto — z-index direto não
 * basta, fica preso atrás de outros elementos).
 */
const PlanFeeGateModal: React.FC<Props> = ({ producerId, isImpersonating }) => {
  const { pending, loaded, termsPending } = usePlanFeePending(producerId);
  const { pathname } = useLocation();
  const [actionLoading, setActionLoading] = useState(false);
  const [waitingPayment, setWaitingPayment] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Eventos que o admin fechou via "Ver como" — a reconsulta periódica não
  // pode trazê-los de volta na mesma sessão.
  const adminDismissedRef = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);

  // Fecha SEM resolver nada — só existe durante impersonate (ver Props).
  // Reabre normalmente ao recarregar, porque não persiste nada.
  const handleAdminDismiss = useCallback(() => {
    const first = pending.find(ev => ev.locked && !adminDismissedRef.current.has(ev.id));
    if (first) adminDismissedRef.current.add(first.id);
    setErrorMsg(null);
    setWaitingPayment(false);
    forceRender(n => n + 1);
  }, [pending]);

  // "Suave" (dentro do prazo): 1x por login por evento. sessionStorage pode
  // estar bloqueado (aba privada) — nesse caso mostra de novo, sem quebrar.
  const softKey = (id: string) => `coreohub_plan_fee_soft_seen_${id}`;
  const softSeen = (id: string) => { try { return sessionStorage.getItem(softKey(id)) === '1'; } catch { return false; } };
  const handleSoftDismiss = (id: string) => {
    try { sessionStorage.setItem(softKey(id), '1'); } catch { /* storage bloqueado — segue sem persistir */ }
    setErrorMsg(null);
    setWaitingPayment(false);
    forceRender(n => n + 1);
  };

  // A trava (prazo vencido) tem prioridade sobre o cartão suave.
  const locked = pending.find(ev => ev.locked && !adminDismissedRef.current.has(ev.id));
  const soft = locked ? undefined : pending.find(ev => !ev.locked && !softSeen(ev.id));
  const current = locked ?? soft;
  const isSoft = !!current && !current.locked;

  const handlePayNow = async () => {
    if (!current) return;
    setActionLoading(true);
    setErrorMsg(null);
    try {
      await openPlanFeeInvoice(current.id, current.billing_plan);
      setWaitingPayment(true);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Não foi possível abrir a fatura agora.');
    } finally {
      setActionLoading(false);
    }
  };

  // Página do Termo fica livre da trava: o produtor precisa conseguir ler e
  // aceitar o Termo mesmo com o painel bloqueado (o link abre em outra aba).
  if (!loaded || !current || pathname === '/termo-produtor') return null;

  const valor = PLAN_FIXED_FEE[current.billing_plan];
  const planoLabel = PLAN_LABEL[current.billing_plan];
  const venceuEm = new Date(current.lockAt).toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
  });

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

        {isSoft ? (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Falta pagar a taxa única de ativação (<strong>R$ {valor.toFixed(2)}</strong>) do evento{' '}
            <strong className="text-slate-900 dark:text-white">{current.name}</strong> no plano{' '}
            <strong>{planoLabel}</strong>. O prazo vai até <strong>{venceuEm}</strong>: até lá você pode continuar
            configurando o evento.{' '}
            {current.salesClosed
              ? 'As vendas e inscrições só abrem depois do pagamento, e depois dessa data o painel trava até a taxa ser paga.'
              : 'Depois dessa data as vendas fecham e o painel trava até a taxa ser paga.'}
          </p>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            O prazo pra pagar a taxa única de ativação (<strong>R$ {valor.toFixed(2)}</strong>) do evento{' '}
            <strong className="text-slate-900 dark:text-white">{current.name}</strong> no plano{' '}
            <strong>{planoLabel}</strong> venceu em <strong>{venceuEm}</strong>. O painel volta ao normal
            assim que o pagamento for confirmado.
          </p>
        )}

        {errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-xl text-sm bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300" role="alert">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {waitingPayment && !errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-xl text-sm bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300" role="status">
            <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              Fatura aberta em outra aba. Depois de pagar, esta tela libera sozinha em alguns instantes
              (Pix é quase imediato; boleto pode levar até 3 dias úteis).
            </span>
          </div>
        )}

        <button
          onClick={handlePayNow}
          disabled={actionLoading}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-400 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-colors"
        >
          {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
          Pagar agora
        </button>

        {isSoft && (
          <button
            onClick={() => handleSoftDismiss(current.id)}
            disabled={actionLoading}
            className="w-full py-3 border-2 border-slate-200 dark:border-white/15 hover:border-slate-300 dark:hover:border-white/30 text-slate-600 dark:text-slate-300 rounded-xl font-black text-xs uppercase tracking-widest transition-colors"
          >
            Continuar configurando
          </button>
        )}

        {termsPending && (
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
            O Termo do Produtor foi atualizado.{' '}
            <a href="/termo-produtor" target="_blank" rel="noopener noreferrer" className="font-bold text-[#ff0068] hover:underline">
              Ler e aceitar
            </a>
          </p>
        )}

        <p className="text-xs text-slate-400 text-center">
          Dúvida sobre a cobrança? Fale com o suporte da CoreoHub.
        </p>

        {isImpersonating && !isSoft && (
          <button
            onClick={handleAdminDismiss}
            disabled={actionLoading}
            className="w-full text-center text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline pt-1"
          >
            Fechar (só inspeção via "Ver como" — não resolve nada pro produtor)
          </button>
        )}
      </div>
    </div>,
    document.body
  );
};

export default PlanFeeGateModal;
