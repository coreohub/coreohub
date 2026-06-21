/**
 * Comparação de nome de estilo/gênero (case/espaço-insensitive).
 *
 * Estilos são guardados como string livre (judges.competencias_generos,
 * judges.competencias_artisticas, registrations.estilo_danca) — sem FK pra
 * event_styles.id. Esse helper centraliza a normalização pra não divergir
 * entre os lugares que comparam essas strings (JudgeTerminal, ResultsPanel).
 */
export const normalizeStyleName = (s?: string | null): string =>
  (s ?? '').toLowerCase().trim();

/** true se `styleName` está na lista `styles` (comparação normalizada). */
export const isStyleInList = (styleName: string | undefined | null, styles?: string[] | null): boolean => {
  if (!styles || styles.length === 0) return false;
  const target = normalizeStyleName(styleName);
  return styles.some(s => normalizeStyleName(s) === target);
};
