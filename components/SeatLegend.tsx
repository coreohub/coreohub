import { Accessibility, ArrowLeftRight, Users, Lock } from 'lucide-react';
import type { SeatRow } from '../hooks/useSeatMap';

interface SeatLegendProps {
  rowsConfig: SeatRow[] | null;
  variant?: 'dark' | 'auto';
}

/**
 * Legenda do mapa de assentos. Só mostra os tipos que o local realmente tem
 * (Fase 3): a planta do teatro não traz legenda, então a explicamos aqui —
 * o Decreto 9.404/2018 (art. 23-B) exige identificar esses lugares no mapa.
 */
export default function SeatLegend({ rowsConfig, variant = 'dark' }: SeatLegendProps) {
  const rows = rowsConfig ?? [];
  const has = (pred: (r: SeatRow) => boolean) => rows.some(pred);
  const hasCadeirante = has(r => !!r.pcd?.length || Object.values(r.tipos ?? {}).includes('cadeirante'));
  const hasLargo = has(r => Object.values(r.tipos ?? {}).includes('pcd_largo'));
  const hasComp = has(r => Object.keys(r.acompanhante ?? {}).length > 0);

  const box = variant === 'dark' ? 'bg-white/10' : 'bg-slate-200 dark:bg-white/10';
  const boxTaken = variant === 'dark' ? 'bg-white/5' : 'bg-slate-100 dark:bg-white/5';
  const sky = variant === 'dark' ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/50' : 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 ring-1 ring-sky-400/60';
  const chip = `w-4 h-4 rounded inline-flex items-center justify-center shrink-0`;

  return (
    <div className="mt-3 space-y-2 text-[10px] text-slate-500">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex items-center gap-1"><span className={`${chip} ${box}`} /> Disponível</span>
        <span className="flex items-center gap-1"><span className={`${chip} bg-[#ff0068]`} /> Selecionado</span>
        <span className="flex items-center gap-1"><span className={`${chip} ${boxTaken}`} /> Ocupado</span>
        {hasCadeirante && <span className="flex items-center gap-1"><span className={`${chip} ${sky}`}><Accessibility size={11} /></span> Espaço de cadeirante</span>}
        {hasLargo && <span className="flex items-center gap-1"><span className={`${chip} ${sky}`}><ArrowLeftRight size={11} /></span> Assento PCD (largo)</span>}
        {hasComp && <span className="flex items-center gap-1"><span className={`${chip} ${sky}`}><Users size={11} /></span> Acompanhante de PCD</span>}
        {(hasCadeirante || hasLargo || hasComp) && (
          <span className="flex items-center gap-1"><Lock size={11} aria-hidden="true" /> Reservado (ainda não liberado)</span>
        )}
      </div>
      {(hasCadeirante || hasLargo) && (
        <p className="leading-relaxed">
          Espaços de cadeirante e assentos PCD são reservados a pessoas com deficiência, com um acompanhante ao lado.
          A comprovação é feita na portaria.
        </p>
      )}
    </div>
  );
}
