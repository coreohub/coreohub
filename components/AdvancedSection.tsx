import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface AdvancedSectionProps {
  title?: string;
  description?: string;
  /** Quantos campos/blocos dentro já têm valor salvo. Mostra o selo e abre sozinho. */
  filledCount?: number;
  /** Recebe o elemento onde o conteúdo é montado (via portal). */
  hostRef: (el: HTMLDivElement | null) => void;
}

/**
 * Bloco "Avançado" sempre visível e expansível. Começa recolhido, mas abre sozinho
 * (uma vez) quando há algo preenchido dentro, pra nada que o produtor já escreveu
 * ficar escondido sem aviso. O conteúdo é montado via portal no `hostRef`.
 */
const AdvancedSection: React.FC<AdvancedSectionProps> = ({
  title = 'Avançado',
  description = 'Opcional. Os padrões já funcionam; abra só se precisar.',
  filledCount = 0,
  hostRef,
}) => {
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && filledCount > 0) setOpen(true);
  }, [filledCount, touched]);

  return (
    <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { setTouched(true); setOpen(o => !o); }}
        className="w-full flex items-center justify-between gap-3 px-6 py-5 text-left"
      >
        <div className="min-w-0">
          <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {filledCount > 0 && (
            <span className="px-2 py-1 rounded-md bg-[#ff0068]/10 text-[#ff0068] text-[9px] font-black uppercase tracking-widest">
              {filledCount} {filledCount === 1 ? 'configurado' : 'configurados'}
            </span>
          )}
          <ChevronDown size={18} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {/* hidden (não unmount) pra manter o estado dos campos montados via portal */}
      <div ref={hostRef} className={`px-6 pb-6 space-y-6 ${open ? '' : 'hidden'}`} />
    </div>
  );
};

export default AdvancedSection;
