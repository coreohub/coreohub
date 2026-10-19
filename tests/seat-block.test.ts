import { describe, expect, it } from 'vitest';
import {
  normalizeSeatIds, sanitizeReason, summarizeOutcomes, countOutcomes, SEAT_BLOCK_REASON_MAX,
} from '../supabase/functions/_shared/seat-block';
import {
  expandRow, expandRange, parseSeatId, selectableForBlock, partitionSelection, toggleMany, seatCapacity,
  BLOCK_REASON_SUGGESTIONS, reasonsBySeat,
} from '../utils/seatBlock';
import type { SeatRow, SeatStatus } from '../hooks/useSeatMap';

const rows: SeatRow[] = [
  { codigo: 'A', assentos: 10 },
  { codigo: 'M', assentos: 16, tipos: { '8': 'cadeirante' }, acompanhante: { '7': 8 } },
];

const st = (seat_id: string, status: SeatStatus['status'], seat_tipo?: SeatStatus['seat_tipo']): SeatStatus =>
  ({ seat_id, status, is_pcd: false, seat_tipo });

describe('normalizeSeatIds', () => {
  it('remove duplicados e espacos', () => {
    expect(normalizeSeatIds([' A-1 ', 'A-1', 'A-2'])).toEqual({ ids: ['A-1', 'A-2'], invalid: [] });
  });
  it('descarta formato invalido e nao-string', () => {
    const r = normalizeSeatIds(['A1', 'A-', '', 7, 'A-2', '--', 'A-12345']);
    expect(r.ids).toEqual(['A-2']);
    expect(r.invalid.length).toBe(6);
  });
  it('entrada que nao e lista vira vazio', () => {
    expect(normalizeSeatIds('A-1')).toEqual({ ids: [], invalid: [] });
    expect(normalizeSeatIds(null)).toEqual({ ids: [], invalid: [] });
  });
});

describe('sanitizeReason', () => {
  it('apara, compacta espacos e limita', () => {
    expect(sanitizeReason('  reserva   da direcao ')).toBe('reserva da direcao');
    expect(sanitizeReason('x'.repeat(500))?.length).toBe(SEAT_BLOCK_REASON_MAX);
  });
  it('vazio ou nao-string vira null', () => {
    expect(sanitizeReason('   ')).toBeNull();
    expect(sanitizeReason(undefined)).toBeNull();
    expect(sanitizeReason(42)).toBeNull();
  });
});

describe('summarizeOutcomes', () => {
  it('conta e descreve por resultado', () => {
    const res = [
      { seat_id: 'A-1', outcome: 'blocked' as const },
      { seat_id: 'A-2', outcome: 'blocked' as const },
      { seat_id: 'A-3', outcome: 'skipped_sold' as const },
    ];
    expect(countOutcomes(res).blocked).toBe(2);
    expect(summarizeOutcomes(res)).toContain('2 bloqueados');
    expect(summarizeOutcomes(res)).toContain('1 vendidos ou cortesia');
  });
  it('lista vazia', () => {
    expect(summarizeOutcomes([])).toBe('Nenhum lugar alterado.');
  });
});

describe('parseSeatId', () => {
  it('le fileira e numero', () => {
    expect(parseSeatId('M-8')).toEqual({ row: 'M', n: 8 });
  });
  it('rejeita formato ruim', () => {
    expect(parseSeatId('M8')).toBeNull();
    expect(parseSeatId('M-0')).toBeNull();
    expect(parseSeatId('M-x')).toBeNull();
  });
});

describe('expandRow / expandRange', () => {
  it('fileira inteira', () => {
    expect(expandRow(rows, 'A')).toHaveLength(10);
    expect(expandRow(rows, 'A')[0]).toBe('A-1');
    expect(expandRow(rows, 'Z')).toEqual([]);
    expect(expandRow(null, 'A')).toEqual([]);
  });
  it('faixa crescente e invertida', () => {
    expect(expandRange(rows, 'A-3', 'A-5').ids).toEqual(['A-3', 'A-4', 'A-5']);
    expect(expandRange(rows, 'A-5', 'A-3').ids).toEqual(['A-3', 'A-4', 'A-5']);
  });
  it('aceita so o numero final e caixa baixa', () => {
    expect(expandRange(rows, 'a-3', '5').ids).toEqual(['A-3', 'A-4', 'A-5']);
  });
  it('erros: fileiras diferentes, fora da fileira, formato', () => {
    expect(expandRange(rows, 'A-1', 'M-3').error).toMatch(/mesma fileira/);
    expect(expandRange(rows, 'A-1', 'A-11').error).toMatch(/vai ate o lugar 10/);
    expect(expandRange(rows, 'A1', 'A-3').error).toMatch(/primeiro lugar/);
    expect(expandRange(rows, 'A-1', 'xx').error).toMatch(/ultimo lugar/);
    expect(expandRange(rows, 'Z-1', 'Z-3').error).toMatch(/nao existe/);
  });
});

describe('selectableForBlock', () => {
  it('livre comum bloqueia; bloqueado desbloqueia', () => {
    expect(selectableForBlock('livre', 'comum')).toBe('block');
    expect(selectableForBlock(undefined, 'comum')).toBe('block');
    expect(selectableForBlock('bloqueado', 'comum')).toBe('unblock');
  });
  it('especiais, reservado, vendido e cortesia ficam de fora', () => {
    expect(selectableForBlock('livre', 'cadeirante')).toBeNull();
    expect(selectableForBlock('livre', 'pcd_largo')).toBeNull();
    expect(selectableForBlock('livre', 'acompanhante')).toBeNull();
    expect(selectableForBlock('reservado', 'comum')).toBeNull();
    expect(selectableForBlock('vendido', 'comum')).toBeNull();
    expect(selectableForBlock('cortesia', 'comum')).toBeNull();
  });
});

describe('partitionSelection', () => {
  const statuses: Record<string, SeatStatus> = {
    'A-1': st('A-1', 'livre', 'comum'),
    'A-2': st('A-2', 'bloqueado', 'comum'),
    'A-3': st('A-3', 'vendido', 'comum'),
    'M-8': st('M-8', 'livre', 'cadeirante'),
  };
  it('separa bloquear, desbloquear e ignorar', () => {
    const p = partitionSelection(rows, statuses, ['A-1', 'A-2', 'A-3', 'M-8', 'A-4']);
    expect(p.toBlock).toEqual(['A-1', 'A-4']); // A-4 sem status ao vivo = livre comum pelo layout
    expect(p.toUnblock).toEqual(['A-2']);
    expect(p.ignored).toEqual(['A-3', 'M-8']);
  });
  it('sem status ao vivo usa o tipo do layout', () => {
    expect(partitionSelection(rows, {}, ['M-8']).ignored).toEqual(['M-8']);
    expect(partitionSelection(rows, {}, ['M-7']).ignored).toEqual(['M-7']);
  });
});

describe('toggleMany', () => {
  it('adiciona os que faltam', () => {
    expect(toggleMany(['A-1'], ['A-1', 'A-2'])).toEqual(['A-1', 'A-2']);
  });
  it('remove quando todos ja estao', () => {
    expect(toggleMany(['A-1', 'A-2', 'A-3'], ['A-1', 'A-2'])).toEqual(['A-3']);
  });
  it('lista vazia nao muda', () => {
    expect(toggleMany(['A-1'], [])).toEqual(['A-1']);
  });
});

describe('seatCapacity', () => {
  it('bloqueado sai da capacidade vendavel e nao conta como vendido', () => {
    const c = seatCapacity({
      a: st('a', 'livre'), b: st('b', 'bloqueado'), c: st('c', 'vendido'), d: st('d', 'cortesia'), e: st('e', 'reservado'),
    });
    expect(c).toEqual({ total: 5, bloqueado: 1, vendavel: 4, vendido: 2, reservado: 1, livre: 1 });
  });
});

describe('reasonsBySeat / BLOCK_REASON_SUGGESTIONS', () => {
  it('mapeia so lugares com motivo preenchido e apara espacos', () => {
    expect(reasonsBySeat([
      { seat_id: 'A-1', block_reason: ' Direção ' },
      { seat_id: 'A-2', block_reason: null },
      { seat_id: 'A-3', block_reason: '   ' },
    ])).toEqual({ 'A-1': 'Direção' });
  });
  it('sugestoes cabem no limite do motivo', () => {
    for (const r of BLOCK_REASON_SUGGESTIONS) expect(r.length).toBeLessThanOrEqual(SEAT_BLOCK_REASON_MAX);
  });
});
