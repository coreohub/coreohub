import type { SeatZone } from '../supabase/functions/_shared/seat-zone-pricing';

const formatBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type SelectedSeatRow = { seatId: string; zoneKey: string | null; typeIdx: number | null; price: number | null };
export type SelectableType = { idx: number; nome: string };

interface Props {
  rows: SelectedSeatRow[];
  zones: SeatZone[];
  /** Tipos comuns do carrinho que o comprador pode trocar entre os lugares (só aparece se houver 2+). */
  swappable: SelectableType[];
  typeNameByIdx: Record<number, string>;
  onChangeType: (seatId: string, typeIdx: number) => void;
  variant?: 'dark' | 'auto';
}

/** Lugares escolhidos: zona, preço e (com 2+ tipos no carrinho) qual ingresso vai em cada lugar. */
export default function SeatZoneSelection({ rows, zones, swappable, typeNameByIdx, onChangeType, variant = 'dark' }: Props) {
  if (rows.length === 0) return null;
  const box = variant === 'dark' ? 'bg-white/5 border-white/10' : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10';
  const strong = variant === 'dark' ? 'text-white' : 'text-slate-900 dark:text-white';
  const muted = variant === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const zoneOf = (k: string | null) => zones.find(z => z.key === k) ?? null;
  const total = rows.reduce((s, r) => s + (r.price ?? 0), 0);
  const allPriced = rows.every(r => r.price != null);
  return (
    <div className={`mt-3 rounded-xl border p-3 ${box}`}>
      <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${muted}`}>Seus lugares</p>
      <ul className="space-y-1.5">
        {rows.map(r => {
          const z = zoneOf(r.zoneKey);
          const canSwap = swappable.length > 1 && r.typeIdx != null && swappable.some(t => t.idx === r.typeIdx);
          return (
            <li key={r.seatId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className={`font-black tabular-nums w-14 ${strong}`}>{r.seatId}</span>
              <span className="inline-flex items-center gap-1.5 min-w-[5.5rem]">
                <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: z?.cor ?? '#64748b' }} aria-hidden="true" />
                <span className={muted}>{z?.nome ?? 'Sem zona'}</span>
              </span>
              {canSwap ? (
                <select
                  value={r.typeIdx as number}
                  onChange={e => onChangeType(r.seatId, Number(e.target.value))}
                  aria-label={`Ingresso do lugar ${r.seatId}`}
                  className="bg-transparent border border-white/20 rounded-lg py-1 px-2 text-xs font-bold text-inherit"
                >
                  {swappable.map(t => <option key={t.idx} value={t.idx} className="text-black">{t.nome}</option>)}
                </select>
              ) : (
                <span className={muted}>{r.typeIdx != null ? typeNameByIdx[r.typeIdx] : ''}</span>
              )}
              <span className={`ml-auto font-black tabular-nums ${strong}`}>{r.price != null ? formatBRL(r.price) : '—'}</span>
            </li>
          );
        })}
      </ul>
      {allPriced && rows.length > 1 && (
        <p className={`mt-2 pt-2 border-t border-white/10 text-right text-xs ${muted}`}>
          Subtotal dos ingressos <span className={`font-black ${strong}`}>{formatBRL(total)}</span>
        </p>
      )}
    </div>
  );
}
