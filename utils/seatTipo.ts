// Tipo do assento de um ingresso (Fase 3), derivado do layout do local.
// O layout é público (RPC get_venue_layout_public) — não precisa de permissão
// na tabela event_seats. Cache por evento: várias telas perguntam pelo mesmo mapa.
import { supabase } from '../services/supabase';
import type { SeatRow } from '../hooks/useSeatMap';
import { tipoFromRow, type SeatTipo } from './seatSelection';

export const SEAT_TIPO_LABEL: Record<SeatTipo, string | null> = {
  comum: null,
  cadeirante: 'Espaço de cadeirante',
  pcd_largo: 'Assento PCD (largo)',
  acompanhante: 'Acompanhante de PCD',
};

const layoutCache = new Map<string, Promise<SeatRow[]>>();

function fetchLayout(eventId: string): Promise<SeatRow[]> {
  let p = layoutCache.get(eventId);
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase.rpc('get_venue_layout_public', { p_event_id: eventId });
      if (error) {
        console.error('[seatTipo] erro get_venue_layout_public:', error.message);
        layoutCache.delete(eventId); // tenta de novo na próxima vez
        return [];
      }
      const row = Array.isArray(data) ? data[0] : data;
      return Array.isArray(row?.rows_config) ? (row.rows_config as SeatRow[]) : [];
    })();
    layoutCache.set(eventId, p);
  }
  return p;
}

/** Tipo de um assento ("M-8") a partir do layout já carregado. */
export function seatTipoFromLayout(rows: SeatRow[] | null | undefined, seatId: string | null | undefined): SeatTipo {
  if (!rows || !seatId) return 'comum';
  const cut = seatId.lastIndexOf('-');
  if (cut < 0) return 'comum';
  const row = rows.find(r => r.codigo === seatId.slice(0, cut));
  return row ? tipoFromRow(row, Number(seatId.slice(cut + 1))) : 'comum';
}

export async function fetchSeatTipo(eventId: string, seatId: string | null | undefined): Promise<SeatTipo> {
  if (!seatId) return 'comum';
  return seatTipoFromLayout(await fetchLayout(eventId), seatId);
}
