import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Loader2 } from 'lucide-react';
import { openPlanFeeInvoice, PLAN_FIXED_FEE, PLAN_LABEL, PendingPlanFeeEvent } from '../hooks/usePlanFeePending';

interface Props {
  /** Eventos com a taxa do plano vencida e não paga (já filtrados por `locked`). */
  overdue: PendingPlanFeeEvent[];
}

/**
 * Tela exibida no lugar do assistente de criação de evento quando o produtor
 * tem taxa fixa de plano (Essencial/Escala) vencida em outro evento. A mesma
 * regra vale no banco (trigger block_new_event_overdue_plan_fee_trigger) — esta
 * tela só evita que ele preencha o formulário inteiro pra descobrir no fim.
 * Libera sozinha quando o webhook confirma o pagamento (usePlanFeePending
 * reconsulta a cada poucos segundos).
 */
const NewEventBlockedNotice: React.FC<Props> = ({ overdue }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const ev = overdue[0];
  const valor = PLAN_FIXED_FEE[ev.billing_plan];
  const planoLabel = PLAN_LABEL[ev.billing_plan];
  const venceu = new Date(ev.lockAt).toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
  });

  const handlePay = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await openPlanFeeInvoice(ev.id, ev.billing_plan);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Não foi possível abrir a fatura agora.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-4" role="alert">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <Receipt size={18} className="text-amber-700 dark:text-amber-300" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
              Taxa do plano {planoLabel} em aberto
            </p>
            <h1 className="text-lg font-black uppercase tracking-tighter italic text-slate-900 dark:text-white leading-tight">
              Criar novo evento pausado
            </h1>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          A taxa de ativação (<strong>R$ {valor.toFixed(2)}</strong>) do evento <strong>{ev.name}</strong> venceu em{' '}
          <strong>{venceu}</strong>. Assim que o pagamento for confirmado, você pode criar novos eventos.
        </p>

        {errorMsg && (
          <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">{errorMsg}</p>
        )}

        <button
          onClick={handlePay}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff0068] hover:bg-[#e0005c] disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-400 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-colors"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
          Pagar agora
        </button>
        <button
          onClick={() => navigate('/qg-organizador')}
          className="w-full py-3 border border-slate-300 dark:border-white/15 text-slate-700 dark:text-slate-200 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
        >
          Voltar ao painel
        </button>
      </div>
    </div>
  );
};

export default NewEventBlockedNotice;
