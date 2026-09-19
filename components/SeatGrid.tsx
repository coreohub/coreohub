import { Loader2, Accessibility } from 'lucide-react';
import type { SeatRow, SeatStatus } from '../hooks/useSeatMap';

interface SeatGridProps {
  rowsConfig: SeatRow[] | null;
  seatStatuses: Record<string, SeatStatus>;
  selectedSeats: string[];
  onToggle: (seatId: string) => void;
  /** md = checkout público (assento maior). sm = PDV/painel do produtor (mais compacto). */
  size?: 'md' | 'sm';
  /** dark = sempre escuro (checkout público, que não segue o toggle de tema). auto = acompanha light/dark (painel do produtor). */
  variant?: 'dark' | 'auto';
}

const SIZES = {
  md: { btn: 'w-6 h-6', rounded: 'rounded-md', text: 'text-[8px]', icon: 11, codeText: 'text-[10px]', codeWidth: 'w-5', rowGap: 'gap-2', spacer: 'w-3', spinnerBox: 'py-8', spinner: 20 },
  sm: { btn: 'w-5 h-5', rounded: 'rounded', text: 'text-[7px]', icon: 9, codeText: 'text-[9px]', codeWidth: 'w-4', rowGap: 'gap-1.5', spacer: 'w-2', spinnerBox: 'py-4', spinner: 16 },
};

/**
 * Grade de assento (Fase 2 — assento numerado). Renderiza só a grade
 * (fileiras + botões + estado de loading) — header, legenda e container
 * ficam a cargo de quem usa (cada tela tem seu próprio wrapper visual).
 */
export default function SeatGrid({ rowsConfig, seatStatuses, selectedSeats, onToggle, size = 'md', variant = 'dark' }: SeatGridProps) {
  const s = SIZES[size];

  if (rowsConfig === null) {
    return (
      <div className={`flex items-center justify-center ${s.spinnerBox}`}>
        <Loader2 className="animate-spin text-slate-400 dark:text-slate-500" size={s.spinner} />
      </div>
    );
  }

  const selectedClass = 'bg-[#ff0068] text-white';
  const takenClass = variant === 'dark'
    ? 'bg-white/5 text-slate-700 cursor-not-allowed'
    : 'bg-slate-200 dark:bg-white/5 text-slate-400 dark:text-slate-700 cursor-not-allowed';
  const freeClass = variant === 'dark'
    ? 'bg-white/10 text-slate-400 hover:bg-white/20'
    : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/20';

  return (
    <div className="space-y-1.5 overflow-x-auto pb-1">
      {rowsConfig.map(row => (
        <div key={row.codigo} className={`flex items-center ${s.rowGap} min-w-max`}>
          <span className={`font-black ${s.codeText} ${s.codeWidth} shrink-0 text-slate-500`}>{row.codigo}</span>
          <div className="flex items-center gap-1">
            {Array.from({ length: row.assentos }, (_, i) => i + 1).map(n => {
              const seatId = `${row.codigo}-${n}`;
              const st = seatStatuses[seatId]?.status ?? 'livre';
              const isPcd = row.pcd?.includes(n) ?? false;
              const isSelected = selectedSeats.includes(seatId);
              const isTaken = st !== 'livre';
              return (
                <span key={seatId} className="flex items-center">
                  {row.corredor_apos === n - 1 && <span className={`${s.spacer} shrink-0`} />}
                  <button
                    type="button"
                    onClick={() => onToggle(seatId)}
                    disabled={isTaken && !isSelected}
                    title={`${seatId}${isPcd ? ' · PCD' : ''}${isTaken ? ' · ocupado' : ''}`}
                    aria-label={`Assento ${seatId}${isPcd ? ', PCD' : ''}${isTaken ? ', ocupado' : ', disponível'}`}
                    aria-pressed={isSelected}
                    className={`${s.btn} shrink-0 ${s.rounded} ${s.text} font-black flex items-center justify-center transition-colors
                      ${isSelected ? selectedClass : isTaken ? takenClass : freeClass}`}
                  >
                    {isPcd ? <Accessibility size={s.icon} /> : n}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
