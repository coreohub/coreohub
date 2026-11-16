import { describe, it, expect } from 'vitest';
import { describeSeatDepth, rowDepth, seatRowCode } from '../utils/seatPosition';

const codes = 'MLKJIHGFEDCBA'.split('');
const rows = codes.map((c, i) => ({ codigo: c, palco_apos: i === codes.length - 1 || undefined }));

describe('seatPosition', () => {
  it('extrai a fileira do assento', () => {
    expect(seatRowCode('M-12')).toBe('M');
  });

  it('divide a sala em terços a partir do palco', () => {
    expect([1, 5, 6, 10, 11, 15].map(r => rowDepth(r, 15))).toEqual(['frente', 'frente', 'meio', 'meio', 'fundo', 'fundo']);
  });

  it('fileira A (junto do palco) é a 1ª; a do topo é a última', () => {
    const s = describeSeatDepth(rows, ['A-1', 'M-3'])!;
    expect(s.rows.map(r => [r.codigo, r.rank, r.depth])).toEqual([['A', 1, 'frente'], ['M', 13, 'fundo']]);
    expect(s.allFundo).toBe(false);
  });

  it('só fundo => allFundo', () => {
    expect(describeSeatDepth(rows, ['M-10', 'L-6', 'K-4'])!.allFundo).toBe(true);
  });

  it('sem palco na última fileira, não diz nada', () => {
    expect(describeSeatDepth(rows.map(r => ({ codigo: r.codigo })), ['M-1'])).toBeNull();
  });

  it('sem seleção ou sem mapa, não diz nada', () => {
    expect(describeSeatDepth(rows, [])).toBeNull();
    expect(describeSeatDepth(null, ['A-1'])).toBeNull();
  });
});
