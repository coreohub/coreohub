import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { formatTempo } from '../utils/masks';

/** Selo ✓/⚠ comparando a duração real de uma trilha com o max_time da
 *  modalidade. Nunca bloqueia — tempo acima do limite em festival de dança
 *  é penalização de nota (aplicada na apuração), não motivo pra travar o
 *  envio. Compartilhado entre InscricaoWizard.tsx e CentralDeMidia.tsx
 *  (antes cada um tinha sua própria checagem, 2026-07-17). */
const TrackDurationBadge: React.FC<{
  durationSeconds?: number | null;
  maxSeconds?: number;
}> = ({ durationSeconds, maxSeconds }) => {
  const dur = durationSeconds && durationSeconds > 0 ? durationSeconds : 0;
  if (dur <= 0) return null;
  const hasMax = !!maxSeconds && maxSeconds > 0;
  const over = hasMax && dur > (maxSeconds as number);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-bold text-slate-400 tabular-nums">{formatTempo(dur)}</span>
      {hasMax && !over && <Check size={11} className="text-emerald-500 shrink-0" />}
      {over && (
        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-amber-600 dark:text-amber-400">
          <AlertTriangle size={10} /> Acima do limite (máx {formatTempo(maxSeconds as number)}) — sujeita à penalização do regulamento
        </span>
      )}
    </div>
  );
};

export default TrackDurationBadge;
