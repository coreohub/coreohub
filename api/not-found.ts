/**
 * 404 de verdade para caminhos inexistentes em coreohub.com.
 * Antes, qualquer URL inválida devolvia 200 com o shell do SPA e um redirect em JavaScript
 * (soft-404). O middleware.ts reescreve para cá quando o 1º segmento não é rota do App.tsx.
 * Quem pede application/json recebe erro em JSON; os demais, HTML.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { notFoundHtml, notFoundJson, wantsJson } from './_agent-content.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Vary', 'Accept');
  if (wantsJson(req.headers.accept)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(404).send(JSON.stringify(notFoundJson(String(req.url ?? '').split('?')[0].slice(0, 200))));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(404).send(notFoundHtml());
}
