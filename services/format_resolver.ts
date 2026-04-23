import { EventFormat } from '../types';
import { supabase } from './supabase';

export interface FormatResolutionInput {
  style_id?: string;
  category_id?: string;
  formacao_id?: string;
  level_id?: string;
}

export interface ResolvedFormat {
  format: EventFormat;
  source: 'rule' | 'event_default' | 'system_default';
}

/**
 * Resolve o formato de avaliação de uma inscrição consultando as regras
 * cadastradas em `event_format_rules`, com fallback para o formato padrão do evento.
 */
export const resolveFormat = async (
  eventId: string,
  input: FormatResolutionInput
): Promise<ResolvedFormat> => {
  const { data: rules, error } = await supabase
    .from('event_format_rules')
    .select('*')
    .eq('event_id', eventId);

  if (error) {
    console.warn('format_resolver: tabela event_format_rules não encontrada, usando padrão.', error.message);
    return { format: EventFormat.RANKING, source: 'system_default' };
  }

  if (rules && rules.length > 0) {
    // Prioridade: combinação mais específica primeiro
    const scored = rules.map((rule: any) => {
      let score = 0;
      if (rule.style_id && rule.style_id === input.style_id) score += 8;
      if (rule.category_id && rule.category_id === input.category_id) score += 4;
      if (rule.formacao_id && rule.formacao_id === input.formacao_id) score += 2;
      if (rule.level_id && rule.level_id === input.level_id) score += 1;
      return { rule, score };
    });

    const best = scored.sort((a: any, b: any) => b.score - a.score)[0];
    if (best && best.score > 0) {
      return { format: best.rule.target_format as EventFormat, source: 'rule' };
    }
  }

  // Fallback: formato padrão da configuração do evento
  const { data: config } = await supabase
    .from('configuracoes')
    .select('default_format')
    .eq('id', 1)
    .single();

  if (config?.default_format) {
    return { format: config.default_format as EventFormat, source: 'event_default' };
  }

  return { format: EventFormat.RANKING, source: 'system_default' };
};

/**
 * Retorna o rótulo legível do formato.
 */
export const formatLabel = (format: EventFormat): string => {
  const labels: Record<EventFormat, string> = {
    [EventFormat.RANKING]: 'Mostra Competitiva',
    [EventFormat.PEDAGOGICAL]: 'Mostra Avaliada',
    [EventFormat.GRADUATED]: 'Mostra por Médias',
    [EventFormat.BATTLE]: 'Batalha'
  };
  return labels[format] ?? format;
};

/**
 * Verifica se o formato usa notas numéricas (vs. voto simples de batalha).
 */
export const formatUsesNumericScore = (format: EventFormat): boolean => {
  return format !== EventFormat.BATTLE;
};

/**
 * Retorna a cor de destaque do formato para uso em UI.
 */
export const formatColor = (format: EventFormat): string => {
  const colors: Record<EventFormat, string> = {
    [EventFormat.RANKING]: '#ff0068',
    [EventFormat.PEDAGOGICAL]: '#06b6d4',
    [EventFormat.GRADUATED]: '#e3ff0a',
    [EventFormat.BATTLE]: '#8b5cf6'
  };
  return colors[format] ?? '#ff0068';
};
