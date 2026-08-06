/**
 * Classificação de prêmio especial por nome/descrição — fonte única usada por
 * Telão de Palco, PDF de Apuração e Premiação (Deliberacoes.tsx), que antes
 * tinham 3 cópias manuais dessa regex. Mantém as 3 telas consistentes sobre
 * o que é "Ouro/Prata/Bronze" (faixa festival-wide), "Maior nota", prêmio por
 * deliberação dos jurados ou escolha manual (ex: Voto Popular).
 */
export type AwardReveal =
  | { tipo: 'faixa'; faixa: 'ouro' | 'prata' | 'bronze' }
  | { tipo: 'maior_nota' }
  | { tipo: 'premio' }
  | { tipo: 'manual' };

// Eventos que renomeiam a faixa pra "1º/2º/3º Lugar" (em vez de Ouro/Prata/
// Bronze, ex: 19° Festival Ecodança) continuam batendo aqui — exige o ordinal
// junto de "lugar"/"colocado" pra não confundir com outro uso do número
// (ex: "1º Aniversário do Festival" não deve virar faixa Ouro).
export const classifyAward = (nome: string, description?: string): AwardReveal => {
  const t = `${nome ?? ''} ${description ?? ''}`.toLowerCase();
  if (/\bouro\b|gold|\b1[ºo°]\s*(lugar|colocad)|primeiro\s+lugar/.test(t))  return { tipo: 'faixa', faixa: 'ouro' };
  if (/\bprata\b|silver|\b2[ºo°]\s*(lugar|colocad)|segundo\s+lugar/.test(t)) return { tipo: 'faixa', faixa: 'prata' };
  if (/\bbronze\b|\b3[ºo°]\s*(lugar|colocad)|terceiro\s+lugar/.test(t))      return { tipo: 'faixa', faixa: 'bronze' };
  if (/maior nota|grand.?prix/.test(t)) return { tipo: 'maior_nota' };
  if (/voto popular|vote\./.test(t))    return { tipo: 'manual' };
  return { tipo: 'premio' };
};

/**
 * Nome exibido de cada faixa de premiação — configurável por evento
 * (`configuracoes.medal_labels`). Default "Ouro/Prata/Bronze/Participação"
 * quando o produtor não customizou (a maioria dos eventos). Usado por
 * Apuração, PDF de Apuração e Certificados pra ficarem consistentes sobre o
 * rótulo de cada faixa — o MECANISMO de classificação (score → faixa) não
 * muda, só o texto.
 */
export interface MedalLabels {
  gold?: string | null;
  silver?: string | null;
  bronze?: string | null;
  participation?: string | null;
}

export const DEFAULT_MEDAL_LABELS = {
  gold: 'Ouro',
  silver: 'Prata',
  bronze: 'Bronze',
  participation: '—',
} as const;

export const resolveMedalLabel = (
  band: 'gold' | 'silver' | 'bronze' | 'participation',
  labels?: MedalLabels | null
): string => {
  const custom = labels?.[band];
  return custom && custom.trim() ? custom.trim() : DEFAULT_MEDAL_LABELS[band];
};
