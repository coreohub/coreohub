import { describe, it, expect } from 'vitest';
import { readableOnLight, contrastRatio, zoneDisplayColor } from '../utils/zoneColor';

const toRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

describe('readableOnLight', () => {
  it.each(['#1DE7F2', '#E3FF0A', '#FF0068', '#22C55E', '#FACC15', '#A855F7'])(
    '%s fica com contraste >= 4,5:1 sobre o fundo translúcido',
    (hex) => {
      const out = readableOnLight(hex, 0.2);
      const rgb = toRgb(hex);
      const bg = [0, 1, 2].map(i => Math.round(rgb[i] * 0.2 + 255 * 0.8)) as [number, number, number];
      expect(contrastRatio(toRgb(out), bg)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it('mantém a matiz (não vira cinza) e cor inválida devolve cinza escuro', () => {
    expect(readableOnLight('#1DE7F2')).not.toBe('#1de7f2');
    expect(readableOnLight('azul')).toBe('#334155');
  });

  it('cor que já passa não muda', () => {
    expect(readableOnLight('#0F172A')).toBe('#0f172a');
  });
});


describe('zoneDisplayColor', () => {
  const rgb = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  it('rosa, magenta e vermelho viram azul (nao colidem com o selecionado)', () => {
    for (const c of ['#ff0068', '#e11d48', '#ff3366', '#dc2626']) expect(zoneDisplayColor(c), c).toBe('#0072B2');
  });
  it('ciano vivo e outras cores claras ficam com 4,5:1 sobre branco', () => {
    for (const c of ['#1DE7F2', '#E3FF0A', '#22c55e', '#f59e0b']) {
      expect(contrastRatio(rgb(zoneDisplayColor(c)), [255, 255, 255]), c).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('cor invalida devolve cinza escuro', () => {
    expect(zoneDisplayColor('xyz')).toBe('#475569');
  });
});
