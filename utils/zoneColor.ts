// Cores de zona de preço do mapa de assentos são escolhidas pelo produtor (hex
// vivo, pensado pro fundo escuro). No tema claro o número do assento precisa de
// uma versão mais escura da mesma cor pra manter contraste (WCAG 1.4.3, 4,5:1).

const parseHex = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

export const contrastRatio = (a: [number, number, number], b: [number, number, number]): number => {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Mistura a cor com branco na proporção `alpha` (0..1), como um fundo translúcido sobre branco. */
const tintOnWhite = (rgb: [number, number, number], alpha: number): [number, number, number] =>
  [0, 1, 2].map(i => Math.round(rgb[i] * alpha + 255 * (1 - alpha))) as [number, number, number];

/**
 * Escurece `hex` até ter contraste >= 4,5:1 sobre o próprio fundo translúcido
 * (`bgAlpha`) em cima de branco. Cor inválida devolve um cinza escuro.
 */
export const readableOnLight = (hex: string, bgAlpha = 0.2): string => {
  const rgb = parseHex(hex);
  if (!rgb) return '#334155';
  const bg = tintOnWhite(rgb, bgAlpha);
  let cur = rgb;
  for (let i = 0; i < 40 && contrastRatio(cur, bg) < 4.5; i++) {
    cur = cur.map(c => Math.round(c * 0.92)) as [number, number, number];
  }
  return '#' + cur.map(c => c.toString(16).padStart(2, '0')).join('');
};
