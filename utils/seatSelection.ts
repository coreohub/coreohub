// Regras de seleção de assento no mapa (espelho da validação do servidor —
// RPC validate_seat_cart, migrations 20260927/27c). O servidor é a autoridade;
// aqui só evita o comprador clicar em algo que será recusado.
import type { SeatRow } from '../hooks/useSeatMap';

export type SeatTipo = 'comum' | 'cadeirante' | 'pcd_largo' | 'acompanhante';

export const isSpecialTipo = (t: SeatTipo) => t === 'cadeirante' || t === 'pcd_largo';

/** Tipo do assento a partir do layout da fileira (fallback quando o status ao vivo ainda não chegou). */
export function tipoFromRow(row: SeatRow, n: number): SeatTipo {
  const t = row.tipos?.[String(n)];
  if (t === 'cadeirante' || t === 'pcd_largo') return t;
  if (row.pcd?.includes(n)) return 'cadeirante';
  if (row.acompanhante && String(n) in row.acompanhante) return 'acompanhante';
  return 'comum';
}

/** "M-8" -> "M-7": assento de acompanhante de cada assento especial. */
export function companionBySpecial(rows: SeatRow[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows ?? []) {
    for (const [viz, esp] of Object.entries(r.acompanhante ?? {})) out[`${r.codigo}-${esp}`] = `${r.codigo}-${viz}`;
  }
  return out;
}

export interface SeatSelectionCtx {
  tipo: SeatTipo;
  /** Este assento já foi liberado para venda geral (prazo de 24 h E sala esgotada). */
  liberado: boolean;
  /** A liberação geral já abriu na sala (qualquer ingresso pode ocupar qualquer lugar). */
  generalOpen: boolean;
  pcdQty: number;
  compQty: number;
  /** Ingressos comuns no carrinho (total - pcd - acompanhante). */
  comumQty: number;
  /** Seleção atual, SEM o assento em questão. */
  selectedSpecial: number;
  selectedComp: number;
  selectedComum: number;
  /** O assento especial que este acompanha está selecionado ou já vendido. */
  companionOk: boolean;
}

/** Motivo pelo qual o assento não pode ser escolhido agora (null = pode). */
export function seatBlockReason(c: SeatSelectionCtx): string | null {
  if (c.generalOpen) return null;
  if (isSpecialTipo(c.tipo)) {
    if (c.liberado) return null;
    if (c.pcdQty <= 0) return 'Reservado para pessoas com deficiência. Escolha o ingresso PCD para usar este lugar.';
    if (c.selectedSpecial >= c.pcdQty) return 'Você já escolheu os lugares PCD do seu pedido.';
    return null;
  }
  if (c.tipo === 'acompanhante') {
    if (c.liberado) return null;
    if (c.compQty <= 0) return 'Reservado ao acompanhante de uma pessoa com deficiência.';
    if (c.selectedComp >= c.compQty) return 'Você já escolheu o lugar do acompanhante.';
    if (!c.companionOk) return 'Escolha primeiro o lugar PCD ao lado deste.';
    return null;
  }
  if (c.comumQty <= 0) return 'Este pedido é de ingresso PCD ou de acompanhante. Escolha um lugar marcado em azul no mapa.';
  if (c.selectedComum >= c.comumQty) return 'Você já escolheu os lugares dos ingressos comuns. Ajuste a quantidade ou remova um lugar.';
  return null;
}

/** O pedido tem os assentos que o servidor exige (PCD e acompanhante)? */
export function seatsSatisfyRules(specialSelected: number, compSelected: number, pcdQty: number, compQty: number): boolean {
  return specialSelected >= pcdQty && compSelected >= compQty;
}
