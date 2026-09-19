import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export type SeatRow = { codigo: string; assentos: number; pcd?: number[]; corredor_apos?: number };
export type SeatStatus = { seat_id: string; status: 'livre' | 'reservado' | 'vendido' | 'cortesia'; is_pcd: boolean };

interface UseSeatMapOptions {
  eventId: string | null | undefined;
  enabled: boolean;
  /** Intervalo do polling de status (ms). Checkout usa 15s fixo, PDV varia 10s/30s conforme o modal está aberto. */
  pollMs?: number;
  onLayoutError?: (message: string) => void;
  /** Chamado a cada tick com o mapa atualizado — útil pra descartar seleção que ficou obsoleta (assento pego por outro comprador). */
  onStatusUpdate?: (map: Record<string, SeatStatus>) => void;
}

/**
 * Layout (1x por evento) + status ao vivo (polling) de um mapa de assentos
 * (Fase 2 — assento numerado). Compartilhado entre checkout público
 * (CheckoutIngresso.tsx) e PDV do produtor (VendasIngressos.tsx).
 */
export function useSeatMap({ eventId, enabled, pollMs = 15_000, onLayoutError, onStatusUpdate }: UseSeatMapOptions) {
  const [rowsConfig, setRowsConfig] = useState<SeatRow[] | null>(null);
  const [seatStatuses, setSeatStatuses] = useState<Record<string, SeatStatus>>({});

  // Evento mudou (navegação sem reload completo) — nunca mistura mapa/status
  // de um evento com o de outro enquanto o fetch abaixo não termina.
  useEffect(() => {
    setRowsConfig(null);
    setSeatStatuses({});
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !enabled) return;
    (async () => {
      const { data, error } = await supabase.rpc('get_venue_layout_public', { p_event_id: eventId });
      if (error) {
        console.error('[useSeatMap] erro get_venue_layout_public:', error.message);
        onLayoutError?.('Não foi possível carregar o mapa de assentos. Recarregue a página.');
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const cfg = row?.rows_config;
      setRowsConfig(Array.isArray(cfg) ? cfg : []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, enabled]);

  useEffect(() => {
    if (!eventId || !enabled) return;
    let cancelled = false;
    const tick = async () => {
      const { data, error } = await supabase.rpc('get_event_seats_public', { p_event_id: eventId });
      if (cancelled) return;
      if (error) {
        console.error('[useSeatMap] erro get_event_seats_public:', error.message);
        return;
      }
      if (!Array.isArray(data)) return;
      const map: Record<string, SeatStatus> = {};
      for (const s of data as SeatStatus[]) map[s.seat_id] = s;
      setSeatStatuses(map);
      onStatusUpdate?.(map);
    };
    void tick();
    const interval = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, enabled, pollMs]);

  // Atualização otimista local (ex: RPC de reserva devolveu "esses assentos
  // já foram pegos" — marca na hora, sem esperar o próximo tick do polling).
  const markSeatsOccupied = (seatIds: string[]) => {
    setSeatStatuses(prev => {
      const next = { ...prev };
      for (const id of seatIds) {
        next[id] = { ...(next[id] ?? { seat_id: id, is_pcd: false }), status: 'reservado' };
      }
      return next;
    });
  };

  return { rowsConfig, seatStatuses, markSeatsOccupied };
}
