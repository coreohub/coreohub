/**
 * 404 de verdade em HTML para caminhos inexistentes em coreohub.com.
 * Antes, qualquer URL inválida devolvia 200 com o shell do SPA e um redirect em JavaScript
 * (soft-404). O middleware.ts reescreve para cá quando o 1º segmento não é rota do App.tsx.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { notFoundHtml } from './_agent-content';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(404).send(notFoundHtml());
}
