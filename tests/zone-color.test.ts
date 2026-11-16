import { describe, it, expect } from 'vitest';
import { readableOnLight, contrastRatio } from '../utils/zoneColor';

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
