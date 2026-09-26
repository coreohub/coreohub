import React, { useState } from 'react';
import { Zap, Info, X } from 'lucide-react';

/**
 * Bloco legal compacto do checkout — política de reembolso (CDC art. 49) +
 * checkbox de aceite + recomendação PIX.
 *
 * Por que: mitigação de risco de chargeback sem retenção de dinheiro.
 *  - Política clara obriga o produtor a ressarcir (Termo de Adesão cobre)
 *  - Aceite expresso do comprador serve como prova em contestação
 *  - PIX tem janela de chargeback (MED) menor: 80 dias vs 540 dias do cartão
 *
 * UX: 1 linha visível (checkbox + texto enxuto + link "ver política") +
 * modal com texto completo quando o user clica em "ver política".
 * Replica padrão Sympla/Eventbrite — compliance sem poluir o checkout.
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
  /** 'ingresso' inclui as regras do Decreto 13.108/2026 (cancelamento/adiamento, transferência). */
  variant?: 'geral' | 'ingresso';
}

const CheckoutLegalNotice: React.FC<CheckoutLegalNoticeProps> = ({
  accepted,
  onAcceptedChange,
  theme = 'light',
  hidePixRecommendation = false,
  variant = 'geral',
}) => {
  const isDark = theme === 'dark';
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        className={`p-3 rounded-2xl border ${
          isDark
            ? 'bg-white/5 border-white/10'
            : 'bg-slate-50 border-slate-200'
        }`}
      >
        {/* Linha única: checkbox + texto enxuto + link */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={accepted}
            onChange={e => onAcceptedChange(e.target.checked)}
            // color-scheme:dark força o navegador a renderizar o checkbox vazio
            // com fundo escuro. Sem isso, no checkout dark (fundo escuro fixo
            // independente do tema da app), o checkbox aparece como quadrado
            // branco brilhante destoante. Aplicado via style pra funcionar
            // independente da classe `dark` do <html>.
            style={isDark ? { colorScheme: 'dark' } : undefined}
            className="mt-0.5 w-4 h-4 accent-[#ff0068] cursor-pointer shrink-0"
          />
          <span className={`text-[11px] leading-relaxed flex-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            Li e concordo com a{' '}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); setModalOpen(true); }}
              className={`underline font-bold ${isDark ? 'text-emerald-400 hover:text-emerald-300' : 'text-[#ff0068] hover:text-[#e0005c]'}`}
            >
              política de reembolso
            </button>
            {' '}(7 dias).
          </span>
        </label>

        {/* PIX recomendado — bem discreto, na linha de baixo */}
        {!hidePixRecommendation && (
          <div className={`mt-1.5 ml-7 flex items-center gap-1 ${isDark ? 'text-emerald-400/70' : 'text-emerald-600/80'}`}>
            <Zap size={9} className="shrink-0" />
            <p className="text-[9px] font-bold uppercase tracking-widest">PIX recomendado</p>
          </div>
        )}
      </div>

      {/* Modal com texto completo da política */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]">
                  <Info size={16} />
                </div>
                <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  Política de Reembolso
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-all"
              >
                <X size={16} />
              </button>
            </div>
            <div className="text-[12px] leading-relaxed text-slate-700 dark:text-slate-300 space-y-3">
              <p>
                <strong>Arrependimento:</strong> você tem direito a reembolso integral em até{' '}
                <strong>7 dias corridos</strong> a contar da data desta compra, conforme art. 49 do
                Código de Defesa do Consumidor (compras online){variant === 'ingresso' && ' e art. 16 do Decreto nº 13.108/2026'}.
                A devolução inclui <strong>todas as taxas</strong> cobradas na compra, inclusive a taxa de serviço.
                {variant === 'ingresso' && <> Você desiste pela própria página do ingresso, no botão <strong>Desistir da compra</strong>, sem precisar falar com ninguém.</>}
              </p>
              {variant === 'ingresso' && (
                <p>
                  <strong>Cancelamento, adiamento ou alteração relevante do evento:</strong> se o evento
                  for cancelado, adiado ou sofrer alteração relevante (data, horário ou local), você escolhe
                  entre <strong>nova data</strong>, <strong>crédito</strong> ou <strong>restituição integral
                  do valor pago, incluídas as taxas</strong>, sem multa nem retenção (arts. 20 a 22 do Decreto nº 13.108/2026).
                </p>
              )}
              <p>
                Nos demais casos, pedidos feitos após o prazo de arrependimento seguem a política
                divulgada pelo <strong>produtor do evento</strong>, sem prejuízo dos seus direitos
                legais.
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-white/10">
                Para solicitar reembolso, escreva para{' '}
                <a href="mailto:contato@coreohub.com" className="underline">contato@coreohub.com</a> ou
                use os canais informados na confirmação da compra.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="w-full py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default CheckoutLegalNotice;
