import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export type SeatRow = {
  codigo: string;
  assentos: number;
  pcd?: number[];
  /** Tipo por número do assento: "8": "cadeirante" | "pcd_largo" (Fase 3). */
  tipos?: Record<string, 'cadeirante' | 'pcd_largo'>;
  /** Vizinho de acompanhante -> assento especial que ele acompanha: {"7": 8}. */
  acompanhante?: Record<string, number>;
  corredor_apos?: number;
  /** Marca o início de um novo bloco (só afeta o espaçamento visual, nunca a geração de assentos). */
  espaco_antes?: boolean;
  /** Na última fileira: desenha a barra "Palco" logo abaixo da grade. */
  palco_apos?: boolean;
};
export type SeatStatus = {
  seat_id: string;
  status: 'livre' | 'reservado' | 'vendido' | 'cortesia';
  is_pcd: boolean;
  /** Fase 3 (get_event_seats_public_v2): tipo do assento e se já está liberado para venda geral. */
  seat_tipo?: 'comum' | 'cadeirante' | 'pcd_largo' | 'acompanhante';
  companion_of?: string | null;
  liberado?: boolean;
};

interface UseSeatMapOptions {
  eventId: string | null | undefined;
  enabled: boolean;
  /** Intervalo do polling de status (ms). Checkout usa 15s fixo, PDV varia 10s/30s conforme o modal está aberto. */
  pollMs?: number;
  onLayoutError?: (message: string) => void;
  /** Chamado a cada tick com o mapa atualizado — útil pra descartar seleção que ficou obsoleta (assento pego por outro comprador). */
  onStatusUpdate?: (map: Record<string, SeatStatus>) => void;
  /**
   * Token de hold do comprador (checkout público). Com ele o status vem da v2:
   * assentos que o próprio comprador está segurando chegam como 'livre'
   * (nunca aparecem como ocupados pra ele). Sem token = v1 (PDV do produtor).
   */
  holdToken?: string | null;
}

/**
 * Layout (1x por evento) + status ao vivo (polling) de um mapa de assentos
 * (Fase 2 — assento numerado). Compartilhado entre checkout público
 * (CheckoutIngresso.tsx) e PDV do produtor (VendasIngressos.tsx).
 */
export function useSeatMap({ eventId, enabled, pollMs = 15_000, onLayoutError, onStatusUpdate, holdToken }: UseSeatMapOptions) {
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
      // v2 sempre: devolve tipo/liberado (Fase 3). Sem token, nada aparece como "meu".
      const { data, error } = await supabase.rpc('get_event_seats_public_v2', { p_event_id: eventId, p_hold_token: holdToken ?? null });
      if (cancelled) return;
      if (error) {
        console.error('[useSeatMap] erro ao ler status dos assentos:', error.message);
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
  }, [eventId, enabled, pollMs, holdToken]);

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
