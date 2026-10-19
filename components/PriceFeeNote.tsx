import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, X } from 'lucide-react';
import type { PriceDisclosure } from '../utils/priceDisclosure';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  disclosure: PriceDisclosure | null;
  /** Classe de texto do "+ taxas" (a vitrine é escura; o card muda de tamanho). */
  className?: string;
}

/**
 * "+ taxas" ao lado do preço, com "?" que explica cada taxa e mostra o total desde o primeiro contato
 * (Decreto 13.108/2026, art. 4º VI e 7º). Padrão do mercado (Sympla, Guichê Web, Uhuu): preço + taxas no
 * card, detalhe a um toque. Sem taxa nenhuma para o comprador, não renderiza nada (o preço já é o total).
 */
const PriceFeeNote: React.FC<Props> = ({ disclosure, className }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!disclosure) return null;
  const { serviceFee, hasPaymentFee, pixTotal, cardTotal, installments } = disclosure;

  // Os cards da vitrine são botões: o clique no "?" não pode navegar para o checkout.
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); };

  return (
    <>
      <span
        className={className ?? 'text-[11px] font-bold text-slate-400'}
        onClick={stop}
      >
        + taxas
        {/* span com role=button: os cards da vitrine (passe, workshop) já são <button>, e <button> dentro de
            <button> é HTML inválido (erro de hidratação do React). */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { stop(e); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { stop(e); setOpen(true); } }}
          aria-label="Entenda as taxas"
          className="ml-1 inline-flex cursor-pointer align-middle text-slate-400 hover:text-white"
        >
          <CircleHelp size={13} />
        </span>
        {installments && (
          <span className="ml-2 inline-block rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-300 align-middle">
            em até {installments.n}x de {brl(installments.perInstallment)}
          </span>
        )}
      </span>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Entenda as taxas"
            className="relative w-full max-w-md rounded-3xl border border-white/10 bg-slate-950 p-6 text-left text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X size={18} />
            </button>
            <h3 className="mb-4 text-lg font-black uppercase italic tracking-tighter">Entenda as taxas</h3>

            <div className="space-y-3 text-sm">
              {serviceFee > 0 && (
                <div>
                  <p className="font-black">Taxa de serviço: {brl(serviceFee)}</p>
                  <p className="text-xs text-slate-400">Valor pela utilização da plataforma CoreoHub para realizar a compra online.</p>
                </div>
              )}
              {hasPaymentFee && (
                <div>
                  <p className="font-black">Taxa de pagamento</p>
                  <p className="text-xs text-slate-400">Custo do processamento do pagamento. O valor muda conforme a forma escolhida (Pix ou cartão).</p>
                </div>
              )}
              {installments && (
                <div>
                  <p className="font-black">Taxa de parcelamento</p>
                  <p className="text-xs text-slate-400">Só no cartão parcelado. Varia com o número de parcelas, e o checkout mostra juros ao mês e CET antes de você confirmar.</p>
                </div>
              )}
            </div>

            <div className="mt-5 space-y-1 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total a partir de</p>
              <p className="flex justify-between"><span>No Pix</span><strong>{brl(pixTotal)}</strong></p>
              <p className="flex justify-between"><span>No cartão à vista</span><strong>{brl(cardTotal)}</strong></p>
              {installments && (
                <p className="flex justify-between">
                  <span>No cartão em {installments.n}x</span>
                  <strong>{installments.n}x de {brl(installments.perInstallment)}</strong>
                </p>
              )}
            </div>
            <p className="mt-4 text-[11px] text-slate-400">O valor final aparece no checkout, antes da confirmação do pagamento.</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default PriceFeeNote;
