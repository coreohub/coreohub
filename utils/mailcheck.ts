/**
 * Sugestão de correção de typo em e-mail. Implementação local (sem lib externa)
 * baseada em distância de Levenshtein contra domínios populares no BR.
 *
 * Padrão consagrado por Mailcheck.js (Kicksend) — reduz ~80% dos e-mails errados
 * sem fricção. Usado por Stripe, Linear, GitHub no signup.
 */

const POPULAR_DOMAINS = [
  // BR
  'gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com.br',
  'yahoo.com', 'icloud.com', 'me.com', 'uol.com.br', 'bol.com.br',
  'terra.com.br', 'globo.com', 'globomail.com', 'ig.com.br',
  'msn.com', 'protonmail.com', 'proton.me',
];

const POPULAR_TLDS = ['com', 'com.br', 'net', 'org', 'edu', 'gov.br', 'me'];

/** Distância de Levenshtein (Wagner-Fischer DP). O(n·m) com n,m ≤ ~20 — irrelevante. */
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) dp[i] = [i];
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
};

/** Encontra o item mais próximo dentro de uma lista, com threshold de distância. */
const findClosest = (input: string, candidates: string[], maxDistance: number): string | null => {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (c === input) return null; // já correto
    const d = levenshtein(input, c);
    if (d < bestDist && d <= maxDistance) {
      bestDist = d;
      best = c;
    }
  }
  return best;
};

/**
 * Recebe um e-mail e retorna sugestão se identificar typo provável no domínio.
 * Retorna null se o e-mail está OK ou não há sugestão confiável.
 *
 * Exemplos:
 *  - "joao@gmial.com" → "joao@gmail.com"
 *  - "ana@hotmial.com" → "ana@hotmail.com"
 *  - "valid@gmail.com" → null
 *  - "novo@empresacustom.com" → null (não é domínio popular, não sugere)
 */
export const suggestEmail = (email: string): string | null => {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 1 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  // Domínio já popular: nada a sugerir.
  if (POPULAR_DOMAINS.includes(domain)) return null;

  // Tenta sugestão direta de domínio inteiro (gmial.com → gmail.com).
  const closestDomain = findClosest(domain, POPULAR_DOMAINS, 2);
  if (closestDomain) return `${local}@${closestDomain}`;

  // Tenta sugerir só o TLD (gmail.con → gmail.com).
  const lastDot = domain.lastIndexOf('.');
  if (lastDot > 0) {
    const sld = domain.slice(0, lastDot);
    const tld = domain.slice(lastDot + 1);
    const closestTld = findClosest(tld, POPULAR_TLDS, 1);
    if (closestTld) {
      const candidate = `${sld}.${closestTld}`;
      if (POPULAR_DOMAINS.includes(candidate)) {
        return `${local}@${candidate}`;
      }
    }
  }

  return null;
};
