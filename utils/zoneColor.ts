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

const AZUL_SEGURO = '#0072B2';

const hueSat = ([r, g, b]: [number, number, number]): { h: number; s: number } => {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s };
};

/**
 * Cor da zona como aparece no mapa CLARO (checkout público). Duas regras:
 * 1. Rosa, magenta e vermelho viram azul: essas cores são a do lugar SELECIONADO
 *    (magenta da marca) e, no mapa, "vermelho" lê como reservado. Só na tela, o dado do evento não muda.
 * 2. As demais escurecem até 4,5:1 sobre branco, pra o número branco do lugar ter contraste
 *    e o lugar passar de 3:1 (WCAG 1.4.11). O ciano vivo `#1DE7F2` (1,5:1) deixava de ser legível.
 */
export const zoneDisplayColor = (hex: string): string => {
  const rgb = parseHex(hex);
  if (!rgb) return '#475569';
  const { h, s } = hueSat(rgb);
  if (s > 0.35 && (h >= 320 || h <= 25)) return AZUL_SEGURO;
  let cur = rgb;
  for (let i = 0; i < 40 && contrastRatio(cur, [255, 255, 255]) < 4.5; i++) {
    cur = cur.map(c => Math.round(c * 0.93)) as [number, number, number];
  }
  return '#' + cur.map(c => c.toString(16).padStart(2, '0')).join('');
};

/** true quando a tela está no tema claro (sem a classe .dark no html). */
export const isLightNow = (): boolean =>
  typeof document !== 'undefined' && !document.documentElement.classList.contains('dark');

// Paleta fixa do mapa público: azul, verde e âmbar (contraste >= 4,5:1 sobre branco e
// distinguíveis entre si em deuteranopia e protanopia; medido em 16/11/2026).
const PALETA_PUBLICA = ['#0072B2', '#00875A', '#B35900'];

/**
 * Zonas como o comprador as vê no mapa claro: da 1ª à 3ª zona, uma cor da paleta fixa, na ordem
 * em que o produtor as cadastrou; da 4ª em diante, a própria cor escurecida (o formato do lugar
 * e o nome na legenda seguem diferenciando). A cor cadastrada no evento não muda.
 */
export const remapZonesForPublic = <T extends { cor: string }>(zones: T[]): T[] =>
  zones.map((z, i) => ({ ...z, cor: i < PALETA_PUBLICA.length ? PALETA_PUBLICA[i] : zoneDisplayColor(z.cor) }));
