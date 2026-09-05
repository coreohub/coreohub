/**
 * Routing Middleware (Vercel) — roda ANTES da resolução de arquivo estático.
 *
 * Resolve bug: vercel.json tinha um rewrite condicional (host=festival.usualdance.com
 * + user-agent de bot) pra raiz "/", mas Vercel dá precedência ao filesystem sobre
 * rewrites quando o path bate com um arquivo literal — "/" sempre resolve pro
 * index.html do build, então o rewrite nunca era avaliado e bots (WhatsApp,
 * Telegram, etc) recebiam o preview genérico do CoreoHub em vez do evento.
 * Middleware roda antes desse estágio, então intercepta a tempo.
 *
 * Mapeamento domínio→slug espelha o que estava (sem efeito) em vercel.json.
 * Novo domínio custom precisa ser adicionado aqui también.
 *
 * 2026-08-23: ganhou 2ª responsabilidade — app.coreohub.com é o subdomínio
 * do painel logado (produtor/inscrito/admin), a vitrine pública se mudou pra
 * coreohub.com raiz. Toda rota de app.coreohub.com que NÃO está na allowlist
 * pública abaixo ganha X-Robots-Tag: noindex, pra área logada nunca competir
 * por ranking nem vazar em busca — mesmo já protegida por login, é higiene
 * de SEO recomendada ter o header explícito. Allowlist construída a partir
 * de toda rota NÃO envolta em <PrivateRoute> no App.tsx (ler lá antes de
 * mexer aqui, senão a allowlist diverge do roteamento real).
 */
import { rewrite, next } from '@vercel/functions';

const BOT_UA_REGEX =
  /WhatsApp|Telegram|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|bingbot|Pinterest|SkypeUriPreview|vkShare|W3C_Validator|redditbot|Applebot|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Amazonbot|Bytespider|CCBot/i;

const CUSTOM_DOMAIN_SLUGS: Record<string, string> = {
  'festival.usualdance.com': 'usualdance-festival-2026',
};

// Prefixos de rota pública em app.coreohub.com (espelha App.tsx — tudo que
// NÃO está dentro de <PrivateRoute>). Qualquer coisa fora dessa lista nesse
// hostname é área logada e ganha noindex.
const PUBLIC_PATH_PREFIXES = [
  '/lp', '/termos', '/privacidade', '/governo',
  '/login', '/register', '/judge-login', '/entrar-juri', '/telao',
  '/convite', '/equipe-convite', '/festivais', '/evento', '/produtor',
  '/u', '/checkout-ingresso', '/meu-ingresso', '/workshop',
  '/checkout-workshop', '/checkout-workshop-pass', '/meu-workshop',
  '/validar-certificado', '/criar-evento', '/festival', '/sitemap.xml',
];

function isPublicAppPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

export const config = {
  // Exclui assets do build (têm extensão de arquivo) e /api/* — só intercepta
  // navegação de documento, onde o header de indexação realmente importa.
  // Padrão de exclusão bem estabelecido (mesmo usado em projetos Next.js).
  matcher: ['/((?!api/|.*\\..*).*)'],
};

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const slug = CUSTOM_DOMAIN_SLUGS[url.hostname];
  const userAgent = request.headers.get('user-agent') ?? '';

  if (slug && BOT_UA_REGEX.test(userAgent)) {
    return rewrite(new URL(`/api/og?slug=${slug}`, request.url));
  }

  const response = next();
  if (url.hostname === 'app.coreohub.com' && !isPublicAppPath(url.pathname)) {
    response.headers.set('X-Robots-Tag', 'noindex');
  }
  return response;
}
