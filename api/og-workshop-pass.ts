/**
 * Mesma estratégia de api/og-workshop.ts, mas pra Workshop Pass — Combo/Day
 * Pass/Single Class não tem página de vitrine própria (só existe o checkout,
 * /checkout-workshop-pass/:slug), então esse é o ÚNICO preview de bot desse
 * recurso. Achado 2026-09-14: não existia rewrite nenhum pra esse path em
 * vercel.json — WhatsApp/Telegram mostravam a home genérica pra quem
 * compartilhava o link de compra do Pass.
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
<meta property="og:title" content="CoreoHub — Workshop Pass">
<meta property="og:description" content="Plataforma completa para produtores de festivais de dança.">
<meta property="og:image" content="${DEFAULT_IMAGE}">
<meta property="og:url" content="${SITE_URL}/checkout-workshop-pass/${esc(slug)}">
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
      console.error('[api/og-workshop-pass] SUPABASE_ANON_KEY not configured');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    const filterCol = UUID_REGEX.test(slug) ? 'id' : 'slug';
    const restUrl = `${SUPABASE_URL}/rest/v1/workshop_passes?select=id,name,slug,description,event_id&${filterCol}=eq.${encodeURIComponent(slug)}&is_published=eq.true&limit=1`;

    const fetchRes = await fetch(restUrl, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!fetchRes.ok) {
      console.error('[api/og-workshop-pass] supabase fetch failed:', fetchRes.status);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    const passes = (await fetchRes.json()) as Array<{
      id: string;
      name: string;
      slug: string | null;
      description: string | null;
      event_id: string;
    }>;

    const pass = passes?.[0];
    if (!pass) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    // Pass não tem capa própria — puxa a do evento (sempre URL de Storage,
    // nunca base64 — diferente de workshop.cover_url) pra não ficar sem
    // imagem nenhuma no preview.
    let image = DEFAULT_IMAGE;
    let eventName = 'CoreoHub';
    try {
      const evRes = await fetch(
        `${SUPABASE_URL}/rest/v1/events?select=name,cover_url&id=eq.${encodeURIComponent(pass.event_id)}&limit=1`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
      );
      if (evRes.ok) {
        const evs = (await evRes.json()) as Array<{ name: string; cover_url: string | null }>;
        if (evs?.[0]?.cover_url) image = evs[0].cover_url;
        if (evs?.[0]?.name) eventName = evs[0].name;
      }
    } catch (evErr) {
      console.error('[api/og-workshop-pass] event fetch failed:', (evErr as Error).message);
    }

    const title = `${pass.name} — ${eventName} | CoreoHub`;
    const description =
      (pass.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) ||
      `${pass.name} — pacote de aulas do ${eventName}, inscrições abertas no CoreoHub.`;
    const canonicalSlug = pass.slug ?? pass.id;
    const url = `${SITE_URL}/checkout-workshop-pass/${canonicalSlug}`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">

<!-- Open Graph (WhatsApp, Telegram, Facebook, Instagram, LinkedIn) -->
<meta property="og:title" content="${esc(pass.name)} — ${esc(eventName)}">
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
<meta name="twitter:title" content="${esc(pass.name)} — ${esc(eventName)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">

<link rel="canonical" href="${esc(url)}">
</head>
<body>
<h1>${esc(pass.name)}</h1>
<p>${esc(description)}</p>
<p><a href="${esc(url)}">Acesse a página completa</a></p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).send(html);
  } catch (err) {
    console.error('[api/og-workshop-pass] error:', (err as Error).message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(fallbackHtml(slug));
  }
}
