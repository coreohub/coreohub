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

    // Workshops publicados — cada um tem página própria com meta/canonical/
    // JSON-LD (achado 2026-09-14 durante auditoria SEO pós-mudanças de URL).
    // Sem entrada aqui, descoberta dependia só de link interno na vitrine do
    // evento. `slug` pode ser NULL em workshop antigo — cai pro id (mesmo
    // fallback que PublicWorkshopPage/api/og-workshop já usam).
    const { data: workshops, error: workshopsError } = await supabase
      .from('workshops')
      .select('slug, id, created_at')
      .eq('is_published', true);

    if (workshopsError) {
      console.error('[sitemap-xml] workshops query failed:', workshopsError.message);
    }

    const staticPages = [
      { loc: SITE_URL, priority: 1.0, changefreq: 'daily' },
      { loc: `${SITE_URL}/festivais`, priority: 0.9, changefreq: 'daily' },
      { loc: `${SITE_URL}/criar-evento`, priority: 0.5, changefreq: 'monthly' },
      // Faltava — achado 2026-09-13 durante a verificação de SEO/GEO/AEO
      // pós-mudanças no simulador. Página real com meta/canonical/rewrite
      // de bot (api/og-marketing.ts) próprios, mas nunca listada aqui —
      // sem sitemap, discovery depende só de link interno/backlink.
      { loc: `${SITE_URL}/planos`, priority: 0.7, changefreq: 'monthly' },
    ];

    const eventEntries = (events ?? []).map((ev) => {
      const slugOrId = encodeURIComponent(ev.slug ?? ev.id);
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

    const workshopEntries = (workshops ?? []).map((w) => {
      // encodeURIComponent — achado 2026-09-14: nem todo workshop.slug em
      // prod passou pelo slugify() do frontend (dado legado/seed), alguns
      // têm espaço/parênteses/acento (ex.: "jazz-com-lucas-maia (Aula
      // Avulsa)"). Sem encode, o XML do sitemap sai tecnicamente inválido.
      const slugOrId = encodeURIComponent(w.slug ?? w.id);
      const lastmod = w.created_at ? new Date(w.created_at).toISOString().split('T')[0] : '';
      return `  <url>
    <loc>${SITE_URL}/workshop/${slugOrId}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticEntries, ...eventEntries, ...workshopEntries].join('\n')}
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
