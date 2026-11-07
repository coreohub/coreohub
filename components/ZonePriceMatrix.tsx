import React from 'react';
import { AlertTriangle, Wand2 } from 'lucide-react';
import {
  isInteira, isMeia, meiaCeiling, missingZonePrices, validateZonePricing,
  type SeatZone, type ZoneLote, type ZonePrices, type ZonePricedType,
} from '../supabase/functions/_shared/seat-zone-pricing';

type TicketLike = ZonePricedType & { nome?: string };

interface Props<T extends TicketLike> {
  zones: SeatZone[];
  ingressos: T[];
  onChange: (next: T[]) => void;
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parse = (raw: string): number | null => {
  const t = raw.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (t.trim() === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 100) / 100, 99999.99) : null;
};

/** Célula de preço: vazia = usa o preço-base (mostrado como placeholder). */
function Cell({ value, base, onCommit }: { value: number | undefined; base: number; onCommit: (n: number | null) => void }) {
  const [draft, setDraft] = React.useState(value != null ? fmt(value) : '');
  React.useEffect(() => { setDraft(value != null ? fmt(value) : ''); }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      maxLength={10}
      value={draft}
      placeholder={base > 0 ? fmt(base) : '0,00'}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const n = parse(draft);
        onCommit(n === 0 ? null : n);
        setDraft(n != null && n !== 0 ? fmt(n) : '');
      }}
      aria-label="Preço nesta zona"
      className="w-full min-w-[5.5rem] bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-1.5 px-2 text-right text-slate-900 dark:text-white text-xs font-bold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-[#ff0068]/50"
    />
  );
}

/**
 * Tabela de preço por zona (Etapa 3 do preço por zona). Edita `precos_por_zona`
 * de cada tipo (sem lotes) ou de cada lote. Célula vazia = preço-base do lote.
 * Meia nunca passa de 50% da Inteira da mesma zona e lote (Lei 12.933).
 */
export default function ZonePriceMatrix<T extends TicketLike>({ zones, ingressos, onChange }: Props<T>) {
  if (zones.length === 0) return null;

  const errors = validateZonePricing(zones, ingressos);
  const inteira = ingressos.find(isInteira);

  const setType = (i: number, patch: Partial<TicketLike>) =>
    onChange(ingressos.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  const setCell = (i: number, loteIdx: number | null, zoneKey: string, value: number | null) => {
    const t = ingressos[i];
    const apply = (map: ZonePrices | null | undefined): ZonePrices | undefined => {
      const next = { ...(map ?? {}) };
      if (value == null) delete next[zoneKey]; else next[zoneKey] = value;
      return Object.keys(next).length > 0 ? next : undefined;
    };
    if (loteIdx == null) {
      setType(i, { precos_por_zona: apply(t.precos_por_zona) });
    } else {
      const lotes = (t.lotes ?? []).map((l, j) => (j === loteIdx ? { ...l, precos_por_zona: apply(l.precos_por_zona) } : l));
      setType(i, { lotes: lotes as ZoneLote[] });
    }
  };

  /** Meia = metade da Inteira, zona por zona e lote por lote (arredonda pro centavo de baixo, sempre dentro do teto). */
  const fillMeia = (i: number) => {
    if (!inteira) return;
    const t = ingressos[i];
    const half = (n: number) => Math.floor(Math.round(n * 100) / 2) / 100;
    const inteiraLotes = inteira.lotes ?? [];
    const priceAt = (loteIdx: number | null, zoneKey: string): number => {
      const src = loteIdx == null || inteiraLotes.length === 0 ? inteira : inteiraLotes[Math.min(loteIdx, inteiraLotes.length - 1)];
      return Number(src.precos_por_zona?.[zoneKey] ?? src.preco ?? 0);
    };
    const build = (loteIdx: number | null): ZonePrices => {
      const out: ZonePrices = {};
      for (const z of zones) {
        const p = priceAt(loteIdx, z.key);
        if (p > 0) out[z.key] = half(p);
      }
      return out;
    };
    if ((t.lotes ?? []).length > 0) {
      setType(i, { lotes: (t.lotes ?? []).map((l, j) => ({ ...l, precos_por_zona: build(j) })) as ZoneLote[] });
    } else {
      setType(i, { precos_por_zona: build(null) });
    }
  };

  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 space-y-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-500 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Corrija antes de salvar
          </p>
          <ul className="text-xs text-rose-600 dark:text-rose-300 list-disc pl-4 space-y-0.5">
            {errors.map((e, k) => <li key={k}>{e}</li>)}
          </ul>
        </div>
      )}

      {ingressos.map((t, i) => {
        if (!t?.nome) return null;
        const lotes = (t.lotes ?? []) as ZoneLote[];
        const hasLotes = lotes.length >= 2;
        const missing = missingZonePrices(t, zones);
        const rows: Array<{ label: string; loteIdx: number | null; src: { preco?: number | null; precos_por_zona?: ZonePrices | null } }> = hasLotes
          ? lotes.map((l, j) => ({ label: j === lotes.length - 1 ? 'Final' : `Lote ${j + 1}${l.data_virada ? ` (até ${l.data_virada.split('-').reverse().slice(0, 2).join('/')})` : ''}`, loteIdx: j, src: l }))
          : [{ label: 'Preço', loteIdx: null, src: t }];
        const meia = isMeia(t);
        return (
          <div key={i} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">{t.nome}</p>
              {meia && inteira && (
                <button
                  type="button"
                  onClick={() => fillMeia(i)}
                  className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ff0068]/10 text-[#ff0068] text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068]/20"
                >
                  <Wand2 size={11} /> Meia = 50% da inteira
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <th className="text-left py-1 pr-2 font-black">{hasLotes ? 'Lote' : ''}</th>
                    {zones.map(z => (
                      <th key={z.key} className="px-1 py-1 text-right font-black whitespace-nowrap">
                        <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: z.cor }} />
                        {z.nome}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const base = Number(r.src.preco ?? 0);
                    return (
                      <tr key={r.label}>
                        <td className="py-1 pr-2 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                          {r.label}
                          <span className="block normal-case font-medium tracking-normal text-slate-400">base R$ {fmt(base)}</span>
                        </td>
                        {zones.map(z => (
                          <td key={z.key} className="px-1 py-1">
                            <Cell
                              value={r.src.precos_por_zona?.[z.key]}
                              base={base}
                              onCommit={n => setCell(i, r.loteIdx, z.key, n)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {missing.length > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                {missing.length === zones.length * Math.max(rows.length, 1)
                  ? 'Nenhuma zona com preço próprio: todas usam o preço-base.'
                  : `${missing.length} célula(s) vazia(s) usam o preço-base (mostrado cinza na célula).`}
              </p>
            )}
            {meia && inteira && (
              <p className="text-[10px] text-slate-500">
                Teto da meia: 50% da inteira na mesma zona e lote (ex.: inteira R$ 100,00 → meia até R$ {fmt(meiaCeiling(100))}).
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
