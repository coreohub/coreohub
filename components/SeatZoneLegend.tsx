import type { SeatZone } from '../supabase/functions/_shared/seat-zone-pricing';

const formatBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type ZoneLegendType = { idx: number; nome: string; priceByZone: Record<string, number> };

interface Props {
  zones: SeatZone[];
  /** Ingressos do carrinho: o preço de cada um em cada zona. */
  types: ZoneLegendType[];
  /** Quantos lugares de cada zona ainda estão livres (opcional). */
  freeByZone?: Record<string, number>;
  variant?: 'dark' | 'auto';
}

/** Legenda do mapa por zona: cor, nome e preço de cada ingresso na zona. */
export default function SeatZoneLegend({ zones, types, freeByZone, variant = 'dark' }: Props) {
  if (zones.length === 0) return null;
  const muted = variant === 'dark' ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400';
  const strong = variant === 'dark' ? 'text-white' : 'text-slate-900 dark:text-white';
  return (
    <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2" aria-label="Zonas do mapa e preços">
      {zones.map(z => (
        <li key={z.key} className="flex items-start gap-2 rounded-xl border px-3 py-2" style={{ borderColor: `${z.cor}66`, backgroundColor: `${z.cor}14` }}>
          <span className="mt-0.5 w-3 h-3 rounded shrink-0" style={{ backgroundColor: z.cor }} aria-hidden="true" />
          <div className="min-w-0">
            <p className={`text-[11px] font-black uppercase tracking-wide ${strong}`}>
              {z.nome}
              {freeByZone && <span className={`ml-1.5 normal-case tracking-normal font-bold ${muted}`}>{freeByZone[z.key] ?? 0} livres</span>}
            </p>
            <p className={`text-[11px] ${muted}`}>
              {types.map(t => `${t.nome} ${formatBRL(t.priceByZone[z.key] ?? 0)}`).join(' · ')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
