/**
 * PaymentMethodPicker — bloco "Como você quer pagar?" dos checkouts com a linha "Taxa de pagamento"
 * (ingresso, workshop, passe e inscrição). Mostra o total de cada forma (Pix, cartão) pro comprador comparar.
 * O seletor de parcelas só aparece se PROCESSING_FEE_CONFIG.maxInstallments > 1 (hoje fixado em 1x:
 * o cartão aparece "à vista"). Os valores vêm do servidor/núcleo puro; este componente só exibe.
 *
 * theme 'dark' (padrão): checkouts públicos, fundo sempre escuro.
 * theme 'adaptive': telas internas com modo claro/escuro (Minhas Inscrições).
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
  theme?: 'dark' | 'adaptive';
  /** Esconde o texto explicativo (quando o card já o mostra). */
  hideNote?: boolean;
}

const PaymentMethodPicker: React.FC<Props> = ({
  options, method, installments, onMethodChange, onInstallmentsChange, refundTarget, formatBRL,
  theme = 'dark', hideNote = false,
}) => {
  const max = PROCESSING_FEE_CONFIG.maxInstallments;
  const adaptive = theme === 'adaptive';
  const box = adaptive
    ? 'space-y-3'
    : 'bg-white/5 border border-white/10 rounded-2xl p-5 mb-4 space-y-3';
  const muted = adaptive ? 'text-slate-500' : 'text-slate-400';
  const title = adaptive ? 'text-slate-900 dark:text-white' : '';
  const optionCls = (active: boolean) => {
    const base = 'px-3 py-3 rounded-xl border text-left transition-colors';
    if (active) return `${base} border-[#ff0068] bg-[#ff0068]/10`;
    return adaptive
      ? `${base} border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10`
      : `${base} border-white/10 bg-white/5 hover:bg-white/10`;
  };

  return (
    <div className={box}>
      <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Como você quer pagar?</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { onMethodChange('pix'); onInstallmentsChange(1); }}
          aria-pressed={method === 'pix'} className={optionCls(method === 'pix')}>
          <p className={`text-sm font-black ${title}`}>Pix</p>
          <p className={`text-[11px] tabular-nums ${muted}`}>{formatBRL(options.pix)}</p>
        </button>
        <button type="button" onClick={() => onMethodChange('card')}
          aria-pressed={method === 'card'} className={optionCls(method === 'card')}>
          <p className={`text-sm font-black ${title}`}>Cartão de crédito</p>
          <p className={`text-[11px] tabular-nums ${muted}`}>
            {max > 1 ? 'a partir de ' : 'à vista '}{formatBRL(options.cardTotals[1])}
          </p>
        </button>
      </div>
      {method === 'card' && max > 1 && (
        <label className="block" htmlFor="installments">
          <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${muted}`}>Parcelas</p>
          <select id="installments" value={installments} onChange={e => onInstallmentsChange(Number(e.target.value))}
            className={adaptive
              ? 'w-full px-3 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white outline-none focus:border-[#ff0068]/50'
              : 'w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-[#ff0068]/50'}>
            {Array.from({ length: max }, (_, i) => i + 1).map(n => (
              <option key={n} value={n} className={adaptive ? '' : 'bg-[#0b0b0f]'}>
                {n === 1 ? `À vista, ${formatBRL(options.cardTotals[1])}` : `${n}x de ${formatBRL(options.cardTotals[n] / n)} (total ${formatBRL(options.cardTotals[n])})`}
              </option>
            ))}
          </select>
        </label>
      )}
      {!hideNote && (
        <p className={`text-[10px] leading-relaxed ${adaptive ? 'text-slate-500' : 'text-slate-500'}`}>
          A taxa de pagamento cobre o processamento do pagamento e varia conforme a forma escolhida. Em caso de reembolso, ela é devolvida junto com {refundTarget}.
        </p>
      )}
    </div>
  );
};

export default PaymentMethodPicker;
