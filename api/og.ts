/**
 * Serverless function que retorna HTML com meta tags injetadas pros bots de
 * preview (WhatsApp, Telegram, Facebook, Instagram, LinkedIn, Twitter, etc).
 *
 * Subfase 3.2 — Preview rico no compartilhamento. Subfase 3.3 (2026-09-13,
 * auditoria SEO/AEO/GEO) — CORREÇÃO DE PREMISSA: o comentário original dizia
 * "Googlebot executa JS, cobre por conta própria" — mas `vercel.json` lista
 * "Googlebot" literalmente no regex de bot que é redirecionado PRA CÁ. Ou
 * seja, Googlebot NUNCA chega a rodar o React de verdade em /evento/:slug —
 * ele recebe exatamente este HTML estático. O mesmo vale pros crawlers de IA
 * (GPTBot/ChatGPT-User/ClaudeBot/PerplexityBot/Google-Extended/Amazonbot/
 * CCBot, todos no mesmo regex) — o texto que alimenta resposta de busca e de
 * IA (AEO/GEO) É este aqui, não a página React completa. Por isso a função
 * ganhou JSON-LD (schema.org Event) + descrição completa (não mais cortada
 * em 160 char) + fatos-chave (datas/local/prazo) + lista de workshops/passes
 * com preço — antes disso só um h1+p genérico chegava em QUALQUER bot,
 * inclusive o próprio Google.
 *
 * Fluxo:
 * 1. vercel.json detecta user-agent de bot conhecido e rewrite pra cá
 * 2. Esta função pega ?slug=, faz fetch REST do Supabase pegando evento
 * 3. Retorna HTML completo com og:title, og:description, og:image dinâmicos
 *    + JSON-LD Event + conteúdo textual rico no <body>
 * 4. Bot vê o preview E o conteúdo indexável do festival específico (não o
 *    genérico do CoreoHub, e não mais um resumo raso)
 *
 * Roda no Vercel Node runtime (não Edge — precisa de fetch + JSON parsing
 * relaxado; Edge é mais restrito). Latência ~50-200ms na request do bot;
 * usuário humano normal NÃO passa por aqui (rewrite condicional).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// Duplicado de utils/eventStatus.ts em vez de importado: funções serverless
// da Vercel em /api são empacotadas isoladamente e um import relativo pra
// fora de /api quebrou o bundle em produção (FUNCTION_INVOCATION_FAILED).
const isEventOver = (event: { start_date?: string | null; end_date?: string | null } | null | undefined): boolean => {
  const dateStr = event?.end_date ?? event?.start_date ?? null;
  if (!dateStr) return false;
  const deadline = new Date(dateStr + 'T23:59:59');
  return deadline.getTime() < Date.now();
};

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
    const restUrl = `${SUPABASE_URL}/rest/v1/events?select=id,name,slug,description,cover_url,start_date,end_date,city,state,location,formacoes_config&${filterCol}=eq.${encodeURIComponent(slug)}&limit=1`;

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
      formacoes_config: Array<{ name: string; is_active?: boolean }> | null;
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

    // Workshops/passes publicados — mesma query de PublicEventPage.tsx (só
    // os campos usados aqui). É o conteúdo que faltava pra bot/IA saberem
    // preço e nome de cada pass (ex: Vicenza Experience, Week Pass...).
    let workshops: Array<{ name: string; preco_padrao: number | null; gratis_para_inscritos: boolean | null }> = [];
    try {
      const wsUrl = `${SUPABASE_URL}/rest/v1/workshops?select=name,preco_padrao,gratis_para_inscritos&event_id=eq.${encodeURIComponent(ev.id)}&is_published=eq.true&order=display_order.asc.nullslast`;
      const wsRes = await fetch(wsUrl, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      });
      workshops = wsRes.ok ? await wsRes.json() : [];
    } catch (wsErr) {
      console.error('[api/og] workshops fetch failed:', wsErr);
    }

    const fullDescription = (ev.description ?? '').replace(/\s+/g, ' ').trim();
    const title = `${ev.name} — ${statusLabel} | CoreoHub`;
    // Meta description convencionalmente curta (~160 char, o que os buscadores
    // de fato exibem no snippet); o <body> abaixo carrega o texto INTEIRO —
    // é o que os crawlers de IA/Google realmente indexam como conteúdo.
    const shortDescription =
      fullDescription.slice(0, 160) || `${statusLabel} — ${ev.name}, festival de dança no CoreoHub.`;
    const image = ev.cover_url || DEFAULT_IMAGE;
    const canonicalSlug = ev.slug ?? ev.id;
    const url = `${SITE_URL}/evento/${canonicalSlug}`;
    const locationParts = [ev.location, [ev.city, ev.state].filter(Boolean).join('/')].filter(Boolean);
    const dateRange = ev.start_date
      ? (ev.end_date && ev.end_date !== ev.start_date ? `${ev.start_date} a ${ev.end_date}` : ev.start_date)
      : null;

    // JSON-LD Event — mesmo shape de PublicEventPage.tsx. Sem isso, NENHUM
    // bot (Googlebot incluso — ver comentário no topo do arquivo) recebia
    // dado estruturado pra este evento, já que todos são redirecionados
    // pra esta função em vez de rodar o React de verdade.
    const eventJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: ev.name,
      description: fullDescription || shortDescription,
      image,
      startDate: ev.start_date ?? undefined,
      endDate: ev.end_date ?? ev.start_date ?? undefined,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        name: ev.location || locationParts.join(', ') || 'Brasil',
        address: {
          '@type': 'PostalAddress',
          addressLocality: ev.city ?? undefined,
          addressRegion: ev.state ?? undefined,
          addressCountry: 'BR',
        },
      },
      organizer: { '@type': 'Organization', name: 'CoreoHub', url: 'https://coreohub.com' },
      url,
      ...(workshops.length > 0
        ? {
            offers: workshops
              .filter((w) => w.preco_padrao != null || w.gratis_para_inscritos)
              .map((w) => ({
                '@type': 'Offer',
                name: w.name,
                price: w.gratis_para_inscritos ? '0' : String(w.preco_padrao ?? '0'),
                priceCurrency: 'BRL',
                availability: 'https://schema.org/InStock',
                url,
              })),
          }
        : {}),
    };

    const formacoesAtivas = (ev.formacoes_config ?? [])
      .filter((f) => f?.is_active !== false && f?.name)
      .map((f) => f.name);

    // Fatos-chave em texto puro — corpo visível/indexável, não só meta tag.
    const factsLines = [
      dateRange ? `Data: ${dateRange}` : null,
      locationParts.length > 0 ? `Local: ${locationParts.join(' — ')}` : null,
      prazoInscricao ? `Inscrições até: ${prazoInscricao}` : null,
      formacoesAtivas.length > 0 ? `Formações: ${formacoesAtivas.join(', ')}` : null,
      `Status: ${statusLabel}`,
    ].filter(Boolean) as string[];

    const workshopsListHtml = workshops.length > 0
      ? `<h2>Workshops e passes</h2>
<ul>
${workshops.map((w) => {
  const priceLabel = w.gratis_para_inscritos ? 'Grátis para inscritos' : (w.preco_padrao != null ? `R$ ${Number(w.preco_padrao).toFixed(2).replace('.', ',')}` : 'Consulte valores');
  return `  <li>${esc(w.name)} — ${esc(priceLabel)}</li>`;
}).join('\n')}
</ul>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(shortDescription)}">
<meta name="robots" content="index, follow">

<!-- Open Graph (WhatsApp, Telegram, Facebook, Instagram, LinkedIn) -->
<meta property="og:title" content="${esc(ev.name)}">
<meta property="og:description" content="${esc(shortDescription)}">
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
<meta name="twitter:description" content="${esc(shortDescription)}">
<meta name="twitter:image" content="${esc(image)}">

<link rel="canonical" href="${esc(url)}">
<script type="application/ld+json">${JSON.stringify(eventJsonLd)}</script>
</head>
<body>
<h1>${esc(ev.name)}</h1>
<ul>
${factsLines.map((f) => `  <li>${esc(f)}</li>`).join('\n')}
</ul>
${fullDescription ? `<p>${esc(fullDescription)}</p>` : ''}
${workshopsListHtml}
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
