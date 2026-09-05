/**
 * Serverless function que retorna HTML com meta tags injetadas pros bots de
 * preview (WhatsApp, Telegram, Facebook, Instagram, LinkedIn, Twitter, etc)
 * nas páginas ESTÁTICAS de marketing (/festivais, /governo).
 *
 * Mesmo problema que api/og.ts resolve pros eventos: essas rotas setam
 * title/description/canonical via useEffect no cliente (SPA), mas bots de
 * social preview não executam JS — só leem o HTML inicial, que hoje é
 * sempre o index.html da home (title/og genéricos). Sem isso, compartilhar
 * um link de /festivais ou /governo mostra o preview da home.
 *
 * Ao contrário de api/og.ts, aqui não tem fetch em banco — o conteúdo é
 * fixo, só espelha o que LandingGoverno.tsx/Festivais.tsx já setam via
 * document.title/meta description.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SITE_URL = 'https://coreohub.com';
const DEFAULT_IMAGE = `${SITE_URL}/og-image.jpg`;

const esc = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type PageMeta = {
  path: string;
  title: string;
  description: string;
};

const PAGES: Record<string, PageMeta> = {
  festivais: {
    path: '/festivais',
    title: 'Festivais e mostras de dança abertos — CoreoHub',
    description:
      'Descubra festivais e mostras de dança com inscrições abertas em todo o Brasil. Filtre por estado e mês e inscreva sua coreografia.',
  },
  governo: {
    path: '/governo',
    title: 'Gestão de festivais e mostras de dança para o setor público — CoreoHub',
    description:
      'Gestão de festivais e mostras de dança para secretarias, institutos e editais públicos: LGPD, Lei 14.133/2021, operação offline.',
  },
  planos: {
    path: '/planos',
    title: 'Planos e preços — CoreoHub',
    description:
      'Começo (10% sobre venda, sem taxa fixa), Essencial (R$250 + 5%) ou Escala (R$1.490 + R$2/participante, teto de 4,5%). Sem mensalidade — você paga proporcional ao que o festival fatura.',
  },
};

const html = (meta: PageMeta): string => {
  const url = `${SITE_URL}${meta.path}`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">

<!-- Open Graph (WhatsApp, Telegram, Facebook, Instagram, LinkedIn) -->
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:image" content="${esc(DEFAULT_IMAGE)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoreoHub">
<meta property="og:locale" content="pt_BR">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${esc(DEFAULT_IMAGE)}">

<link rel="canonical" href="${esc(url)}">
</head>
<body>
<h1>${esc(meta.title)}</h1>
<p>${esc(meta.description)}</p>
<p><a href="${esc(url)}">Acesse a página completa</a></p>
</body>
</html>`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const page = String(req.query.page ?? '').trim();
  const meta = PAGES[page];

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!meta) {
    res.status(400).send('unknown page');
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(html(meta));
}
