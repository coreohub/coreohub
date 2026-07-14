/**
 * Serverless function que retorna HTML com meta tags injetadas pros bots de
 * preview (WhatsApp, Telegram, Facebook, Instagram, LinkedIn, Twitter, etc).
 *
 * Subfase 3.2 — Preview rico no compartilhamento. React 19 nativo (Fase 3.1)
 * já cobre Googlebot que executa JS, mas bots de social link preview NÃO
 * executam JS — precisam das meta tags presentes no HTML inicial.
 *
 * Fluxo:
 * 1. vercel.json detecta user-agent de bot conhecido e rewrite pra cá
 * 2. Esta função pega ?slug=, faz fetch REST do Supabase pegando evento
 * 3. Retorna HTML completo com og:title, og:description, og:image dinâmicos
 * 4. Bot vê o preview do festival específico (não o genérico do CoreoHub)
 *
 * Roda no Vercel Node runtime (não Edge — precisa de fetch + JSON parsing
 * relaxado; Edge é mais restrito). Latência ~50-200ms na request do bot;
 * usuário humano normal NÃO passa por aqui (rewrite condicional).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isEventOver } from '../utils/eventStatus';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://ghpltzzijlvykiytwslu.supabase.co';

// Anon key é pública por design — projetada pra ser exposta em client-side.
// RLS na tabela events restringe SELECT a is_public=true pra anon.
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const SITE_URL = 'https://app.coreohub.com';
const DEFAULT_IMAGE = `${SITE_URL}/coreohub-avatar.png`;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Escapa caracteres especiais HTML pra prevenir injection nos meta tags.
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
<meta property="og:title" content="CoreoHub — Festival de dança">
<meta property="og:description" content="Plataforma completa para produtores de festivais de dança.">
<meta property="og:image" content="${DEFAULT_IMAGE}">
<meta property="og:url" content="${SITE_URL}/evento/${esc(slug)}">
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
      console.error('[api/og] SUPABASE_ANON_KEY not configured');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    // UUID vs slug — bota filter correto. PublicEventPage usa mesma lógica.
    const filterCol = UUID_REGEX.test(slug) ? 'id' : 'slug';
    const restUrl = `${SUPABASE_URL}/rest/v1/events?select=id,name,slug,description,cover_url,start_date,end_date,city,state,location&${filterCol}=eq.${encodeURIComponent(slug)}&limit=1`;

    const fetchRes = await fetch(restUrl, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!fetchRes.ok) {
      console.error('[api/og] supabase fetch failed:', fetchRes.status);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    const events = (await fetchRes.json()) as Array<{
      id: string;
      name: string;
      slug: string | null;
      description: string | null;
      cover_url: string | null;
      start_date: string | null;
      end_date: string | null;
      city: string | null;
      state: string | null;
      location: string | null;
    }>;

    const ev = events?.[0];
    if (!ev) {
      // Slug não achado — pode ser que mudou (event_slug_history). Bot não
      // segue redirect 301 de JS, mas devolvemos página genérica em vez de 404.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    // Mesma fonte de prazo que PublicEventPage.tsx: configuracoes.id = event_id,
    // com fallback pra row legada id='1' quando o evento não tem config própria.
    let prazoInscricao: string | null = null;
    try {
      const cfgUrl = `${SUPABASE_URL}/rest/v1/configuracoes?select=prazo_inscricao&id=eq.${encodeURIComponent(ev.id)}&limit=1`;
      const cfgRes = await fetch(cfgUrl, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      });
      const cfgRows = cfgRes.ok ? ((await cfgRes.json()) as Array<{ prazo_inscricao: string | null }>) : [];
      prazoInscricao = cfgRows[0]?.prazo_inscricao ?? null;
    } catch (cfgErr) {
      console.error('[api/og] configuracoes fetch failed:', cfgErr);
    }

    const eventOver = isEventOver(ev);
    const isRegistrationOpen = eventOver
      ? false
      : !prazoInscricao ||
        Date.now() <= new Date(prazoInscricao.includes('T') ? prazoInscricao : `${prazoInscricao}T23:59:59`).getTime();
    const statusLabel = isRegistrationOpen
      ? 'Inscrições abertas'
      : eventOver
        ? 'Confira o resultado'
        : 'Inscrições encerradas';

    const title = `${ev.name} — ${statusLabel} | CoreoHub`;
    const description =
      (ev.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) ||
      `${statusLabel} — ${ev.name}, festival de dança no CoreoHub.`;
    const image = ev.cover_url || DEFAULT_IMAGE;
    const canonicalSlug = ev.slug ?? ev.id;
    const url = `${SITE_URL}/evento/${canonicalSlug}`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">

<!-- Open Graph (WhatsApp, Telegram, Facebook, Instagram, LinkedIn) -->
<meta property="og:title" content="${esc(ev.name)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(url)}">
<meta property="og:type" content="event">
<meta property="og:site_name" content="CoreoHub">
<meta property="og:locale" content="pt_BR">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ev.name)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">

<link rel="canonical" href="${esc(url)}">
</head>
<body>
<h1>${esc(ev.name)}</h1>
<p>${esc(description)}</p>
<p><a href="${esc(url)}">Acesse a página completa do festival</a></p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).send(html);
  } catch (err) {
    console.error('[api/og] error:', (err as Error).message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(fallbackHtml(slug));
  }
}
