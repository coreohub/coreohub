import type { SeatStatus } from '../hooks/useSeatMap';

export interface ZoneDef { key: string; nome: string; cor?: string }
export interface ZoneSaleTicket { seat_id?: string | null; preco: number | null; status_pagamento: string; refunded_at?: string | null }

export interface ZoneSalesLine {
  key: string;
  nome: string;
  cor?: string;
  /** Ingressos pagos (não estornados) com lugar nesta zona. */
  vendidos: number;
  /** Soma do preço base dos ingressos pagos (sem taxas), em reais. */
  receita: number;
  /** Lugares livres agora. */
  livres: number;
  /** Lugares à venda (total da zona menos os bloqueados). */
  vendaveis: number;
}

export const SEM_ZONA_KEY = '__sem_zona__';

/**
 * Vendas por zona do mapa. A zona de cada ingresso vem do lugar (seat_id → zona);
 * ingresso sem lugar ou lugar sem zona cai em "Sem zona". Só conta venda paga e não estornada.
 */
export function salesByZone(
  zones: ZoneDef[],
  zoneBySeat: Record<string, string>,
  seatStatuses: Record<string, SeatStatus>,
  tickets: ZoneSaleTicket[],
): ZoneSalesLine[] {
  const lines = new Map<string, ZoneSalesLine>();
  for (const z of zones) lines.set(z.key, { key: z.key, nome: z.nome, cor: z.cor, vendidos: 0, receita: 0, livres: 0, vendaveis: 0 });
  const semZona = (): ZoneSalesLine => {
    let l = lines.get(SEM_ZONA_KEY);
    if (!l) { l = { key: SEM_ZONA_KEY, nome: 'Sem zona', vendidos: 0, receita: 0, livres: 0, vendaveis: 0 }; lines.set(SEM_ZONA_KEY, l); }
    return l;
  };
  const lineFor = (seatId?: string | null): ZoneSalesLine => {
    const k = seatId ? zoneBySeat[seatId] : undefined;
    return (k && lines.get(k)) || semZona();
  };
  for (const [seatId, st] of Object.entries(seatStatuses)) {
    if (st.status === 'bloqueado') continue;
    const l = lineFor(seatId);
    l.vendaveis += 1;
    if (st.status === 'livre') l.livres += 1;
  }
  for (const t of tickets) {
    if (t.status_pagamento !== 'APROVADO' || t.refunded_at) continue;
    const l = lineFor(t.seat_id);
    l.vendidos += 1;
    l.receita += Number(t.preco ?? 0);
  }
  const out = [...lines.values()];
  // "Sem zona" só aparece se tiver algo dentro.
  return out.filter(l => l.key !== SEM_ZONA_KEY || l.vendidos > 0 || l.vendaveis > 0);
}
