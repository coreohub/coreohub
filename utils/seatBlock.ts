// Logica pura do painel de bloqueio de lugares (docs/plano-bloqueio-assentos.md).
// O servidor (block_event_seats / unblock_event_seats) e a autoridade; aqui so
// monta a selecao e evita mandar o que sera recusado.
import type { SeatRow, SeatStatus } from '../hooks/useSeatMap';
import { tipoFromRow, type SeatTipo } from './seatSelection';

export interface RangeResult {
  ids: string[];
  error: string | null;
}

/** "M-8" -> { row: "M", n: 8 }; null se o formato nao bate. */
export function parseSeatId(id: string): { row: string; n: number } | null {
  const cut = id.lastIndexOf('-');
  if (cut <= 0) return null;
  const n = Number(id.slice(cut + 1));
  if (!Number.isInteger(n) || n < 1) return null;
  return { row: id.slice(0, cut), n };
}

/** Todos os ids de uma fileira ("M-1".."M-34"). */
export function expandRow(rows: SeatRow[] | null, codigo: string): string[] {
  const row = rows?.find(r => r.codigo === codigo);
  if (!row) return [];
  return Array.from({ length: row.assentos }, (_, i) => `${row.codigo}-${i + 1}`);
}

/**
 * Faixa dentro de UMA fileira: "A-5" ate "A-12" (aceita invertida, "A-12" a "A-5").
 * Aceita tambem so o numero final: ("A-5", "12") => A-5..A-12.
 */
export function expandRange(rows: SeatRow[] | null, fromRaw: string, toRaw: string): RangeResult {
  const from = parseSeatId(fromRaw.trim().toUpperCase());
  if (!from) return { ids: [], error: 'Informe o primeiro lugar no formato A-5.' };
  const toTrim = toRaw.trim().toUpperCase();
  const to = /^\d+$/.test(toTrim) ? { row: from.row, n: Number(toTrim) } : parseSeatId(toTrim);
  if (!to || !Number.isInteger(to.n) || to.n < 1) return { ids: [], error: 'Informe o ultimo lugar no formato A-12 (ou so o numero 12).' };
  if (from.row !== to.row) return { ids: [], error: 'A faixa precisa estar numa mesma fileira.' };
  const row = rows?.find(r => r.codigo === from.row);
  if (!row) return { ids: [], error: `A fileira ${from.row} nao existe neste mapa.` };
  const lo = Math.min(from.n, to.n);
  const hi = Math.max(from.n, to.n);
  if (hi > row.assentos) return { ids: [], error: `A fileira ${row.codigo} vai ate o lugar ${row.assentos}.` };
  return { ids: Array.from({ length: hi - lo + 1 }, (_, i) => `${row.codigo}-${lo + i}`), error: null };
}

/** Pode entrar na selecao de bloqueio? Livre e comum bloqueia; bloqueado desbloqueia. */
export function selectableForBlock(status: SeatStatus['status'] | undefined, tipo: SeatTipo): 'block' | 'unblock' | null {
  if (status === 'bloqueado') return 'unblock';
  if ((status ?? 'livre') === 'livre' && tipo === 'comum') return 'block';
  return null;
}

/** Tipo do assento: do status ao vivo, senao do layout da fileira. */
export function seatTipoOf(rows: SeatRow[] | null, statuses: Record<string, SeatStatus>, seatId: string): SeatTipo {
  const st = statuses[seatId]?.seat_tipo as SeatTipo | undefined;
  if (st) return st;
  const p = parseSeatId(seatId);
  const row = p ? rows?.find(r => r.codigo === p.row) : undefined;
  return row && p ? tipoFromRow(row, p.n) : 'comum';
}

/** Divide a selecao: o que vai ser bloqueado, o que vai ser desbloqueado e o que sera ignorado. */
export function partitionSelection(
  rows: SeatRow[] | null,
  statuses: Record<string, SeatStatus>,
  selected: string[],
): { toBlock: string[]; toUnblock: string[]; ignored: string[] } {
  const toBlock: string[] = [];
  const toUnblock: string[] = [];
  const ignored: string[] = [];
  for (const id of selected) {
    const kind = selectableForBlock(statuses[id]?.status, seatTipoOf(rows, statuses, id));
    if (kind === 'block') toBlock.push(id);
    else if (kind === 'unblock') toUnblock.push(id);
    else ignored.push(id);
  }
  return { toBlock, toUnblock, ignored };
}

/** Alterna uma lista de ids: se todos ja estao selecionados, remove; senao, adiciona os que faltam. */
export function toggleMany(selected: string[], ids: string[]): string[] {
  if (ids.length === 0) return selected;
  const set = new Set(selected);
  const allIn = ids.every(id => set.has(id));
  if (allIn) return selected.filter(id => !ids.includes(id));
  return [...selected, ...ids.filter(id => !set.has(id))];
}

/** Capacidade vendavel e ocupacao de um mapa (bloqueado fica fora da capacidade). */
export function seatCapacity(statuses: Record<string, SeatStatus>): {
  total: number; bloqueado: number; vendavel: number; vendido: number; reservado: number; livre: number;
} {
  const all = Object.values(statuses);
  const bloqueado = all.filter(s => s.status === 'bloqueado').length;
  return {
    total: all.length,
    bloqueado,
    vendavel: all.length - bloqueado,
    vendido: all.filter(s => s.status === 'vendido' || s.status === 'cortesia').length,
    reservado: all.filter(s => s.status === 'reservado').length,
    livre: all.filter(s => s.status === 'livre').length,
  };
}

/** Motivos mais comuns, para preencher o campo com um toque (o produtor ainda pode digitar o que quiser). */
export const BLOCK_REASON_SUGGESTIONS = [
  'Direção',
  'Convidados',
  'Câmera',
  'Produção',
  'Visibilidade ruim',
] as const;

/** Mapa seat_id -> motivo (so os bloqueados com motivo preenchido), para mostrar ao passar o mouse. */
export function reasonsBySeat(list: Array<{ seat_id: string; block_reason: string | null }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of list) {
    const r = (b.block_reason ?? '').trim();
    if (r) out[b.seat_id] = r;
  }
  return out;
}
