/**
 * Sitemap dinâmico pra crawlers (Google, Bing, etc).
 *
 * Lista todos os eventos com is_public=true + páginas estáticas core.
 * Servido em https://app.coreohub.com/sitemap.xml via Vercel rewrite.
 *
 * Atualização: a cada request — não tem cache, então evento novo criado
 * já aparece em alguns segundos. Custo de query é baixo (SELECT slug,
 * updated_at FROM events WHERE is_public).
 *
 * Bots respeitosos (Google) chamam ~1x por dia. Bots agressivos podem
 * chamar mais — se virar problema, adicionar cache header Cache-Control:
 * public, max-age=3600.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SITE_URL = 'https://app.coreohub.com';

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('slug, id, created_at, custom_domain')
      .eq('is_public', true)
      .order('start_date', { ascending: false });

    if (eventsError) {
      console.error('[sitemap-xml] events query failed:', eventsError.message);
    }

    const staticPages = [
      { loc: SITE_URL, priority: 1.0, changefreq: 'daily' },
      { loc: `${SITE_URL}/festivais`, priority: 0.9, changefreq: 'daily' },
      { loc: `${SITE_URL}/estudios`, priority: 0.6, changefreq: 'monthly' },
      { loc: `${SITE_URL}/criar-evento`, priority: 0.5, changefreq: 'monthly' },
    ];

    const eventEntries = (events ?? []).map((ev) => {
      const slugOrId = ev.slug ?? ev.id;
      const lastmod = ev.created_at ? new Date(ev.created_at).toISOString().split('T')[0] : '';
      // Evento com domínio próprio: a URL canônica é o domínio custom, não
      // app.coreohub.com/evento/:slug — evita conteúdo duplicado no Google.
      const loc = ev.custom_domain ? `https://${ev.custom_domain}/` : `${SITE_URL}/evento/${slugOrId}`;
      return `  <url>
    <loc>${loc}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
    });

    const staticEntries = staticPages.map((p) => `  <url>
    <loc>${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticEntries, ...eventEntries].join('\n')}
</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('[sitemap-xml] error:', (err as Error).message);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  }
});
