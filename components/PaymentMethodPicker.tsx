/**
 * PaymentMethodPicker — bloco "Como você quer pagar?" dos checkouts com a linha "Taxa de pagamento"
 * (ingresso, workshop e passe). Mostra o total de cada forma (Pix, cartão) pro comprador comparar.
 * O seletor de parcelas só aparece se PROCESSING_FEE_CONFIG.maxInstallments > 1 (hoje fixado em 1x:
 * o cartão aparece "à vista"). Os valores vêm do servidor/núcleo puro; este componente só exibe.
 */

import React from 'react';
import { PROCESSING_FEE_CONFIG } from '../supabase/functions/_shared/processing-fee';

export type PayMethod = 'pix' | 'card';

export interface PaymentOptionTotals {
  pix: number;
  /** Total do cartão por número de parcelas (chave 1 = à vista). */
  cardTotals: Record<number, number>;
}

interface Props {
  options: PaymentOptionTotals;
  method: PayMethod;
  installments: number;
  onMethodChange: (m: PayMethod) => void;
  onInstallmentsChange: (n: number) => void;
  /** Texto de reembolso: "o valor do ingresso" / "o valor da inscrição". */
  refundTarget: string;
  formatBRL: (n: number) => string;
}

const PaymentMethodPicker: React.FC<Props> = ({
  options, method, installments, onMethodChange, onInstallmentsChange, refundTarget, formatBRL,
}) => {
  const max = PROCESSING_FEE_CONFIG.maxInstallments;
  const optionCls = (active: boolean) =>
    `px-3 py-3 rounded-xl border text-left transition-colors ${active ? 'border-[#ff0068] bg-[#ff0068]/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`;

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 space-y-3">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Como você quer pagar?</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { onMethodChange('pix'); onInstallmentsChange(1); }}
          aria-pressed={method === 'pix'} className={optionCls(method === 'pix')}>
          <p className="text-sm font-black">Pix</p>
          <p className="text-[11px] text-slate-400 tabular-nums">{formatBRL(options.pix)}</p>
        </button>
        <button type="button" onClick={() => onMethodChange('card')}
          aria-pressed={method === 'card'} className={optionCls(method === 'card')}>
          <p className="text-sm font-black">Cartão de crédito</p>
          <p className="text-[11px] text-slate-400 tabular-nums">
            {max > 1 ? 'a partir de ' : 'à vista '}{formatBRL(options.cardTotals[1])}
          </p>
        </button>
      </div>
      {method === 'card' && max > 1 && (
        <label className="block" htmlFor="installments">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Parcelas</p>
          <select id="installments" value={installments} onChange={e => onInstallmentsChange(Number(e.target.value))}
            className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-[#ff0068]/50">
            {Array.from({ length: max }, (_, i) => i + 1).map(n => (
              <option key={n} value={n} className="bg-[#0b0b0f]">
                {n === 1 ? `À vista, ${formatBRL(options.cardTotals[1])}` : `${n}x de ${formatBRL(options.cardTotals[n] / n)} (total ${formatBRL(options.cardTotals[n])})`}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[10px] text-slate-500 leading-relaxed">
        A taxa de pagamento cobre o processamento do pagamento e varia conforme a forma escolhida. Em caso de reembolso, ela é devolvida junto com {refundTarget}.
      </p>
    </div>
  );
};

export default PaymentMethodPicker;
