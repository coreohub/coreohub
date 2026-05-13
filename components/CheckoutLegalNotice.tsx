import React from 'react';
import { Zap, Info } from 'lucide-react';

/**
 * Bloco legal padrão do checkout — política de reembolso (CDC art. 49) +
 * checkbox de aceite + recomendação de PIX.
 *
 * Por que: mitigação de risco de chargeback sem retenção de dinheiro.
 *  - Política clara obriga o produtor a ressarcir (Termo de Adesão cobre)
 *  - Aceite expresso do comprador serve como prova em contestação
 *  - PIX tem janela de chargeback (MED) menor: 80 dias vs 540 dias do cartão
 *
 * Tema:
 *  - 'light' — fundo claro (Checkout inscrição)
 *  - 'dark'  — fundo escuro (CheckoutIngresso, CheckoutWorkshop)
 */

interface CheckoutLegalNoticeProps {
  /** Aceitou a política. Use como gate pra liberar o botão de pagamento. */
  accepted: boolean;
  onAcceptedChange: (v: boolean) => void;
  theme?: 'light' | 'dark';
  /** Esconde o badge PIX (ex: quando o checkout já força PIX). */
  hidePixRecommendation?: boolean;
}

const CheckoutLegalNotice: React.FC<CheckoutLegalNoticeProps> = ({
  accepted,
  onAcceptedChange,
  theme = 'light',
  hidePixRecommendation = false,
}) => {
  const isDark = theme === 'dark';

  return (
    <div className="space-y-3">
      {/* Política de reembolso — CDC art. 49 */}
      <div className={`p-4 rounded-2xl border ${
        isDark
          ? 'bg-white/5 border-white/10'
          : 'bg-slate-50 border-slate-200'
      }`}>
        <div className="flex items-start gap-2.5 mb-3">
          <Info size={14} className={`shrink-0 mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
          <div>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${
              isDark ? 'text-slate-300' : 'text-slate-700'
            }`}>
              Política de reembolso
            </p>
            <p className={`text-[11px] leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Você tem direito a reembolso integral em até <strong>7 dias corridos</strong> a
              contar da data desta compra (art. 49 do CDC — direito de arrependimento).
              Após esse prazo, eventuais reembolsos ficam a critério do produtor do evento,
              conforme política divulgada por ele.
            </p>
          </div>
        </div>

        <label className={`flex items-start gap-2.5 cursor-pointer p-2.5 rounded-xl transition-all ${
          isDark
            ? 'hover:bg-white/5'
            : 'hover:bg-white border border-transparent hover:border-slate-200'
        }`}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={e => onAcceptedChange(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#ff0068] cursor-pointer shrink-0"
          />
          <span className={`text-[11px] leading-relaxed ${
            isDark ? 'text-slate-300' : 'text-slate-700'
          }`}>
            Li e concordo com a política de reembolso acima.
          </span>
        </label>

        {/* Recomendação PIX — discreto, abaixo do checkbox (mitigation #1) */}
        {!hidePixRecommendation && (
          <div className={`mt-2 flex items-center gap-1.5 px-2 ${
            isDark ? 'text-emerald-400/80' : 'text-emerald-600/80'
          }`}>
            <Zap size={10} className="shrink-0" />
            <p className="text-[9px] font-bold uppercase tracking-widest">
              PIX recomendado
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckoutLegalNotice;
