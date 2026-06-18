/**
 * Mesma estratégia de api/og.ts, mas pra /workshop/:slug — bots de preview social
 * (WhatsApp/Telegram/etc) não executam JS, então precisam das meta tags no HTML
 * inicial. Ver api/og.ts pro fluxo completo (vercel.json detecta UA de bot e
 * rewrite pra cá).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://ghpltzzijlvykiytwslu.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const SITE_URL = 'https://app.coreohub.com';
const DEFAULT_IMAGE = `${SITE_URL}/coreohub-avatar.png`;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fallbackHtml = (slug: string): string => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>CoreoHub — Gestão inteligente para festivais de dança</title>
<meta property="og:title" content="CoreoHub — Workshop">
<meta property="og:description" content="Plataforma completa para produtores de festivais de dança.">
<meta property="og:image" content="${DEFAULT_IMAGE}">
<meta property="og:url" content="${SITE_URL}/workshop/${esc(slug)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoreoHub">
</head>
<body><p>Carregando…</p></body>
</html>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = String(req.query.slug ?? '').trim();
  if (!slug) {
    res.status(400).send('slug missing');
    return;
  }

  try {
    if (!SUPABASE_ANON_KEY) {
      console.error('[api/og-workshop] SUPABASE_ANON_KEY not configured');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    const filterCol = UUID_REGEX.test(slug) ? 'id' : 'slug';
    const restUrl = `${SUPABASE_URL}/rest/v1/workshops?select=id,name,slug,description,cover_url,professor_name,professor_photo_url&${filterCol}=eq.${encodeURIComponent(slug)}&is_published=eq.true&limit=1`;

    const fetchRes = await fetch(restUrl, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!fetchRes.ok) {
      console.error('[api/og-workshop] supabase fetch failed:', fetchRes.status);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    const workshops = (await fetchRes.json()) as Array<{
      id: string;
      name: string;
      slug: string | null;
      description: string | null;
      cover_url: string | null;
      professor_name: string;
      professor_photo_url: string | null;
    }>;

    const ws = workshops?.[0];
    if (!ws) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    const title = `${ws.name} com ${ws.professor_name} | CoreoHub`;
    const description =
      (ws.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) ||
      `Workshop de ${ws.name} com ${ws.professor_name} — inscrições abertas no CoreoHub.`;
    const image = ws.cover_url || ws.professor_photo_url || DEFAULT_IMAGE;
    const canonicalSlug = ws.slug ?? ws.id;
    const url = `${SITE_URL}/workshop/${canonicalSlug}`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">

<!-- Open Graph (WhatsApp, Telegram, Facebook, Instagram, LinkedIn) -->
<meta property="og:title" content="${esc(ws.name)} com ${esc(ws.professor_name)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoreoHub">
<meta property="og:locale" content="pt_BR">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ws.name)} com ${esc(ws.professor_name)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">

<link rel="canonical" href="${esc(url)}">
</head>
<body>
<h1>${esc(ws.name)}</h1>
<p>${esc(description)}</p>
<p><a href="${esc(url)}">Acesse a página completa do workshop</a></p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).send(html);
  } catch (err) {
    console.error('[api/og-workshop] error:', (err as Error).message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(fallbackHtml(slug));
  }
}
