/**
 * "Competitiva"/"Avaliada" continuam sendo os valores internos gravados em
 * `tipos_apresentacao`/`tipo_apresentacao` (banco, comparações de lógica).
 * O texto EXIBIDO pro "Avaliada" é escolhido pelo produtor — mercado usa
 * "Não Competitiva", "Avaliada" e "Comentada" como sinônimos do mesmo
 * mecanismo (feedback do júri, sem nota, sem ranking/prêmio) em regulamentos
 * diferentes. Ver CLAUDE.md 2026-09-22.
 */

export type FormatoAvaliadaLabelMode = 'nao_competitiva' | 'avaliada' | 'comentada' | 'custom' | null | undefined;

export interface FormatoLabelConfig {
  formato_avaliada_label_mode?: FormatoAvaliadaLabelMode;
  formato_avaliada_label_custom?: string | null;
}

const AVALIADA_LABEL_BY_MODE: Record<'nao_competitiva' | 'avaliada' | 'comentada', string> = {
  nao_competitiva: 'Não Competitiva',
  avaliada:        'Avaliada',
  comentada:       'Comentada',
};

/** Texto do formato "Avaliada" a exibir, conforme escolha do produtor. Default: "Não Competitiva". */
export const resolveAvaliadaLabel = (config?: FormatoLabelConfig | null): string => {
  const mode = config?.formato_avaliada_label_mode;
  if (mode === 'custom') return config?.formato_avaliada_label_custom?.trim() || 'Não Competitiva';
  if (mode === 'avaliada' || mode === 'comentada' || mode === 'nao_competitiva') return AVALIADA_LABEL_BY_MODE[mode];
  return 'Não Competitiva';
};

/** Texto do tipo de apresentação (valor interno 'Competitiva'|'Avaliada') a exibir. */
export const resolveTipoApresentacaoLabel = (
  tipo: string | null | undefined,
  config?: FormatoLabelConfig | null
): string => {
  if (tipo === 'Competitiva') return 'Competitiva';
  if (tipo === 'Avaliada') return resolveAvaliadaLabel(config);
  return tipo ?? '';
};
