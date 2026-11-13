/**
 * Markdown para agentes de IA (negociação de conteúdo, acceptmarkdown.com).
 *
 * O middleware.ts reescreve para cá quando o pedido traz `Accept: text/markdown`:
 *   /api/md?page=<chave>  → 200, text/markdown, o texto da página (fonte: PAGES em og-marketing.ts)
 *   /api/md?page=404&path → 404, text/markdown, com links para llms.txt, sitemap e contato
 * A URL que o agente pediu não muda (é um rewrite), então `/` e `/planos` respondem Markdown na MESMA URL.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PAGES } from './og-marketing';
import { notFoundMarkdown, pageMarkdown } from './_agent-content';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const page = String(req.query.page ?? '').trim();
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  // Mesma URL serve HTML e Markdown: o cache precisa saber que a resposta varia pelo Accept.
  res.setHeader('Vary', 'Accept');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (page === '404') {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
    res.status(404).send(notFoundMarkdown(String(req.query.path ?? '')));
    return;
  }

  const meta = PAGES[page];
  if (!meta) {
    res.status(404).send(notFoundMarkdown(''));
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.status(200).send(pageMarkdown(meta));
}
