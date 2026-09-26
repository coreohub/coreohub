import React, { useState } from 'react';
import { Loader2, Undo2, ChevronDown } from 'lucide-react';
import { supabase } from '../services/supabase';
import { edgeErrorMessage } from '../utils/edgeError';

/**
 * Arrependimento do comprador (CDC art. 49 + Decreto 13.108/2026, art. 16): desistir da compra
 * com devolução integral, incluindo a taxa de serviço. Prazo: 7 dias corridos do pagamento e até
 * o início do evento (espelha a edge function request-withdrawal, que é quem decide de verdade).
 * Vale para o pedido inteiro. Fica sobre o cartão branco da página do ingresso (tema claro).
 */
interface Props {
  token: string;
  paidAt: string;
  eventStartDate: string | null;
  eventTime: string | null;
  /** Chamado depois do estorno: a página recarrega e mostra o ingresso como estornado. */
  onDone: () => void;
}

const DAY_MS = 86_400_000;
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const fmtDay = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });

const WithdrawalPanel: React.FC<Props> = ({ token, paidAt, eventStartDate, eventTime, onDone }) => {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refunded, setRefunded] = useState<number | null>(null);

  const deadline = new Date(new Date(paidAt).getTime() + 7 * DAY_MS);
  const start = eventStartDate ? new Date(`${eventStartDate}T${(eventTime ?? '00:00').slice(0, 5)}:00-03:00`) : null;
  const now = Date.now();
  const eventStarted = start ? now >= start.getTime() : false;
  const expired = now > deadline.getTime();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('request-withdrawal', { body: { access_token: token } });
      if (invokeErr) throw new Error(await edgeErrorMessage(invokeErr, 'Não foi possível desfazer a compra agora.'));
      if (data?.error) throw new Error(data.error);
      setRefunded(Number(data?.refund_amount ?? 0));
      onDone();
    } catch (e: any) {
      setError(e?.message ?? 'Não foi possível desfazer a compra agora.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (refunded !== null) {
    return (
      <div className="border-t border-slate-100 px-6 py-3 print:hidden">
        <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 p-3 text-xs leading-snug">
          <strong>Compra desfeita.</strong> A devolução integral de {brl(refunded)}, com as taxas, foi pedida. O prazo para aparecer no seu meio de pagamento depende dele.
        </p>
      </div>
    );
  }

  if (expired || eventStarted) {
    return (
      <div className="border-t border-slate-100 px-6 py-3 print:hidden">
        <p className="text-[10px] text-slate-500 leading-snug">
          {eventStarted && !expired
            ? 'O evento já começou: o prazo de arrependimento terminou.'
            : `O prazo de arrependimento (7 dias) terminou em ${fmtDay(deadline)}. Depois disso, vale a política do organizador.`}
        </p>
      </div>
    );
  }

  const limite = start && start.getTime() < deadline.getTime() ? start : deadline;

  return (
    <div className="border-t border-slate-100 px-6 py-3 print:hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="cursor-pointer w-full flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-600"
      >
        <span className="inline-flex items-center gap-1.5"><Undo2 size={12} className="text-[#ff0068]" /> Desistir da compra</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Direito de arrependimento (art. 49 do CDC e art. 16 do Decreto nº 13.108/2026): você pode desistir em até 7 dias corridos do pagamento e recebe o valor pago de volta <strong>integralmente, incluindo a taxa de serviço</strong>. Vale até <strong>{fmtDay(limite)}</strong>.
          </p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            A desistência vale para <strong>todos os ingressos desta compra</strong> e eles deixam de valer. Não dá para desfazer.
          </p>
          {error && <p role="alert" className="text-[11px] font-bold text-rose-600">{error}</p>}
          {!confirming ? (
            <button
              type="button"
              onClick={() => { setError(null); setConfirming(true); }}
              className="cursor-pointer w-full rounded-xl border border-rose-300 py-2.5 text-[11px] font-black uppercase tracking-widest text-rose-700 hover:bg-rose-50"
            >
              Desistir e pedir devolução
            </button>
          ) : (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
              <p className="text-[11px] text-rose-800 leading-snug">Confirma a desistência de toda a compra? Os ingressos serão cancelados e o valor devolvido.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                  className="cursor-pointer flex-1 rounded-xl bg-white border border-slate-200 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 disabled:bg-slate-100 disabled:text-slate-400">
                  Voltar
                </button>
                <button type="button" onClick={() => void submit()} disabled={busy}
                  className="cursor-pointer flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#ff0068] py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-[#ff1a7d] disabled:bg-slate-300 disabled:text-slate-500">
                  {busy && <Loader2 size={12} className="animate-spin" />} Confirmar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WithdrawalPanel;
