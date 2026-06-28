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
 */
import { rewrite, next } from '@vercel/functions';

const BOT_UA_REGEX =
  /WhatsApp|Telegram|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|bingbot|Pinterest|SkypeUriPreview|vkShare|W3C_Validator|redditbot|Applebot/i;

const CUSTOM_DOMAIN_SLUGS: Record<string, string> = {
  'festival.usualdance.com': 'usualdance-festival-2026',
};

export const config = {
  matcher: '/',
};

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const slug = CUSTOM_DOMAIN_SLUGS[url.hostname];
  const userAgent = request.headers.get('user-agent') ?? '';

  if (slug && BOT_UA_REGEX.test(userAgent)) {
    return rewrite(new URL(`/api/og?slug=${slug}`, request.url));
  }

  return next();
}
