import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt, Loader2, AlertTriangle, FileText } from 'lucide-react';
import { usePlanFeePending, openPlanFeeInvoice, PLAN_FIXED_FEE, PLAN_LABEL } from '../hooks/usePlanFeePending';

interface Props {
  producerId: string;
}

/**
 * Aviso dentro da tolerância de 7 dias da taxa fixa do plano (Essencial/Escala)
 * — decisão de produto 2026-09-25. Antes do prazo o painel funciona normal e
 * este cartão lembra o que falta; depois do prazo entra em cena o
 * PlanFeeGateModal (trava). Some sozinho quando o webhook confirma o pagamento.
 *
 * Inline (não fixed) pra não sobrepor DemoBanner/EmailVerifyBanner. Cartão
 * visível, nunca escondido: se há taxa pendente dentro do prazo, aparece.
 */
const PlanFeeReminderBanner: React.FC<Props> = ({ producerId }) => {
  const { pending, termsPending } = usePlanFeePending(producerId);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const soon = pending.filter(ev => !ev.locked);
  if (soon.length === 0) return null;

  const handlePay = async (eventId: string, plano: string) => {
    setLoadingId(eventId);
    setErrorMsg(null);
    try {
      await openPlanFeeInvoice(eventId, plano);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Não foi possível abrir a fatura agora.');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="px-3 lg:px-4 pt-3 lg:pt-4 space-y-2">
      {soon.map(ev => {
        const valor = PLAN_FIXED_FEE[ev.billing_plan];
        const planoLabel = PLAN_LABEL[ev.billing_plan];
        const ate = new Date(ev.lockAt).toLocaleDateString('pt-BR', {
          weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
        });
        return (
          <div
            key={ev.id}
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
            role="status"
          >
            <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Receipt size={18} className="text-amber-700 dark:text-amber-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Taxa do plano {planoLabel} pendente
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
                <strong>{ev.name}</strong>: pague os <strong>R$ {valor.toFixed(2)}</strong> até <strong>{ate}</strong>.{' '}
                {ev.salesClosed
                  ? 'Enquanto a taxa não for paga, as vendas e inscrições do evento ficam fechadas.'
                  : 'Depois dessa data as vendas fecham e o painel trava até o pagamento.'}
              </p>
            </div>
            <button
              onClick={() => handlePay(ev.id, ev.billing_plan)}
              disabled={loadingId !== null}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-400 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-colors flex-shrink-0"
            >
              {loadingId === ev.id ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
              Pagar agora
            </button>
          </div>
        );
      })}
      {termsPending && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60" role="status">
          <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-slate-600 dark:text-slate-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Termo do Produtor atualizado</p>
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
              A versão vigente traz as regras da taxa do plano (prazo, bloqueio, multa e reembolso). Leia e aceite para ficar em dia.
            </p>
          </div>
          <Link
            to="/termo-produtor"
            className="flex items-center justify-center gap-2 px-5 py-3 border-2 border-slate-300 dark:border-white/20 hover:border-[#ff0068] text-slate-700 dark:text-slate-200 rounded-xl font-black text-xs uppercase tracking-widest transition-colors flex-shrink-0"
          >
            Ler e aceitar
          </Link>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300" role="alert">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};

export default PlanFeeReminderBanner;
