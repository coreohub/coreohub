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

export const classifyAward = (nome: string, description?: string): AwardReveal => {
  const t = `${nome ?? ''} ${description ?? ''}`.toLowerCase();
  if (/\bouro\b|gold/.test(t))          return { tipo: 'faixa', faixa: 'ouro' };
  if (/\bprata\b|silver/.test(t))       return { tipo: 'faixa', faixa: 'prata' };
  if (/\bbronze\b/.test(t))             return { tipo: 'faixa', faixa: 'bronze' };
  if (/maior nota|grand.?prix/.test(t)) return { tipo: 'maior_nota' };
  if (/voto popular|vote\./.test(t))    return { tipo: 'manual' };
  return { tipo: 'premio' };
};
