/**
 * Lote pricing helpers — usado por inscrições (formacoes_config[].lotes) e
 * ingressos de plateia (ingressos_config[].lotes). Mesma estrutura, mesma regra.
 *
 * Lote vigente = primeiro lote cuja data_virada >= hoje (ou null = sem virada).
 * Se todas as datas já passaram, usa o último lote (fallback defensivo).
 *
 * Convenção semântica de data_virada:
 *   - Lote válido ATÉ a data_virada (inclusive). No dia data_virada, o lote
 *     ainda é vigente. No dia seguinte, o próximo entra em vigor.
 *   - data_virada = null → último lote, sem expiração.
 */

export type Lote = { data_virada: string | null; preco: number };

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Retorna { lote vigente, idx, próximo lote } ou null se não houver lotes. */
export function resolveLote<T extends Lote>(
  lotes: T[] | null | undefined,
  today: string = todayISO(),
): { lote: T; idx: number; proximo: T | null } | null {
  if (!Array.isArray(lotes) || lotes.length === 0) return null;
  const idx = lotes.findIndex(l => !l.data_virada || l.data_virada >= today);
  const realIdx = idx >= 0 ? idx : lotes.length - 1;
  const lote = lotes[realIdx];
  const proximo =
    idx >= 0 && idx < lotes.length - 1 ? lotes[idx + 1] : null;
  return { lote, idx: realIdx, proximo };
}

/**
 * Retorna o preço vigente de um item com lotes (ingresso/formacao).
 * Fallback `legacyFee` (preco/fee) usado quando não há lotes.
 */
export function precoVigente(
  item: { preco?: number | null; fee?: number | null; lotes?: Lote[] | null },
  today: string = todayISO(),
): number {
  const r = resolveLote(item.lotes ?? null, today);
  if (r) return Number(r.lote.preco ?? 0);
  if (item.preco != null) return Number(item.preco);
  if (item.fee != null) return Number(item.fee);
  return 0;
}

/** Diferença em dias entre duas datas YYYY-MM-DD (b - a). */
export function diffDias(aISO: string, bISO: string): number {
  const [ya, ma, da] = aISO.split('-').map(Number);
  const [yb, mb, db] = bISO.split('-').map(Number);
  return Math.round(
    (Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000,
  );
}

/** "2026-06-30" → "30/06" */
export function formatDataBR(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/** "2026-06-30" → "Sáb, 30/jun" — prefixa weekday curto + mês abreviado.
 *  Padrão usado em datas públicas (vitrine, ingresso, virada de lote). */
export function formatDataBRComDia(iso: string): string {
  // Guard: ISO inválido (vazio, formato errado) retorna '' em vez de "undefined, NaN/undefined".
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  // T12:00:00 evita shift de timezone (UTC midnight vira dia anterior em BRT).
  const date = new Date(y, m - 1, d, 12, 0, 0);
  if (isNaN(date.getTime())) return '';
  const weekdayMap = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const monthMap   = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${weekdayMap[date.getDay()]}, ${String(d).padStart(2, '0')}/${monthMap[m - 1]}`;
}
