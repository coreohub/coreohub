// Rotas públicas de venda/consulta (vitrine, checkout, ingresso, workshop) ficam
// SEMPRE no modo claro, ignorando `localStorage.theme`. Decisão do produtor em
// 2026-11-16: nenhuma plataforma de ingresso brasileira testada (Sympla,
// Ticket360, Uhuu, Bilheteria Express/Digital, Even3) tem botão de tema ou segue
// o aparelho. Plano em docs/plano-modo-claro-paginas-publicas.md.
//
// O tema salvo continua valendo pro painel: aqui só se decide se a classe `.dark`
// vai (ou não) pro <html> enquanto a rota pública está aberta.

const PUBLIC_LIGHT_PREFIXES = [
  '/evento/',
  '/festivais',
  '/produtor/',
  '/checkout-ingresso/',
  '/meu-ingresso/',
  '/workshop/',
  '/checkout-workshop/',
  '/checkout-workshop-pass/',
  '/meu-workshop/',
  '/validar-certificado',
  '/termos',
  '/privacidade',
  '/entrar-juri',
];

const LEADERBOARD = /^\/festival\/[^/]+\/leaderboard\/?$/;

export const isPublicLightPath = (pathname: string, customDomain = false): boolean => {
  // Domínio próprio de evento: a raiz "/" é a vitrine, então tudo é público.
  if (customDomain) return true;
  if (LEADERBOARD.test(pathname)) return true;
  return PUBLIC_LIGHT_PREFIXES.some((p) => pathname.startsWith(p));
};

export const applyThemeClass = (theme: 'light' | 'dark', pathname: string, customDomain = false): void => {
  const dark = theme === 'dark' && !isPublicLightPath(pathname, customDomain);
  document.documentElement.classList.toggle('dark', dark);
  // Controles nativos (input, barra de rolagem) acompanham o tema efetivo.
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
};
