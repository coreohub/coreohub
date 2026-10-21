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
// Páginas institucionais têm canonical em coreohub.com (index.html, api/og-marketing.ts).
// Listar em app.* no sitemap gerava "página alternativa com tag canônica" no Search Console (2026-10-14).
const MARKETING_URL = 'https://coreohub.com';
// Data da última revisão das páginas institucionais (checklist SEO: sem lastmod o Google tem menos motivo pra re-rastrear). Atualizar quando o conteúdo mudar.
const STATIC_LASTMOD = '2026-10-20';

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('slug, id, created_at, custom_domain, session_group_id, start_date, event_time')
      .eq('is_public', true)
      .eq('payment_sandbox', false)   // evento de teste (sandbox) fora do sitemap
      .eq('is_demo', false)           // evento demo fora do sitemap (Google já tinha achado coreohub-open-demo-ticko)
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
      .select('slug, id, created_at, events!inner(is_public, is_demo, payment_sandbox)')
      .eq('is_published', true)
      // Achado 2026-10-14 (Search Console): workshop publicado de evento NÃO
      // público/demo/sandbox (ex.: teste-producao-workshop-p4) vazava no
      // sitemap. Workshop só entra se o evento dele também está no sitemap.
      .eq('events.is_public', true)
      .eq('events.is_demo', false)
      .eq('events.payment_sandbox', false);

    if (workshopsError) {
      console.error('[sitemap-xml] workshops query failed:', workshopsError.message);
    }

    const staticPages = [
      { loc: MARKETING_URL, lastmod: STATIC_LASTMOD, priority: 1.0, changefreq: 'daily' },
      { loc: `${MARKETING_URL}/festivais`, lastmod: STATIC_LASTMOD, priority: 0.9, changefreq: 'daily' },
      // Faltava — achado 2026-09-13 durante a verificação de SEO/GEO/AEO
      // pós-mudanças no simulador. Página real com meta/canonical/rewrite
      // de bot (api/og-marketing.ts) próprios, mas nunca listada aqui —
      // sem sitemap, discovery depende só de link interno/backlink.
      { loc: `${MARKETING_URL}/planos`, lastmod: STATIC_LASTMOD, priority: 0.7, changefreq: 'monthly' },
      // Landing do Plano Espetáculo (docs/mostra-pricing-spec.md) — mesmo
      // motivo do /planos acima: página real com meta/canonical/JSON-LD
      // próprios, sem entrada aqui a descoberta dependeria só de link interno.
      { loc: `${MARKETING_URL}/espetaculo`, lastmod: STATIC_LASTMOD, priority: 0.7, changefreq: 'monthly' },
      // Página institucional (quem está por trás, o que faz, para quem) — sinal de entidade pra IA/Google.
      { loc: `${MARKETING_URL}/sobre`, lastmod: STATIC_LASTMOD, priority: 0.5, changefreq: 'yearly' },
      // Vertical de edital público: página real com meta/canonical de bot próprios (api/og-marketing.ts) e citada no llms.txt.
      { loc: `${MARKETING_URL}/governo`, lastmod: STATIC_LASTMOD, priority: 0.6, changefreq: 'monthly' },
      // Documentos legais: canonical em coreohub.com (cliente e api/og-marketing.ts) e HTML estático pra bots.
      { loc: `${MARKETING_URL}/termos`, lastmod: STATIC_LASTMOD, priority: 0.3, changefreq: 'yearly' },
      { loc: `${MARKETING_URL}/privacidade`, lastmod: STATIC_LASTMOD, priority: 0.3, changefreq: 'yearly' },
    ];

    // Espetáculo com sessões: o link público é o do evento principal (âncora do grupo: id = session_group_id)
    // e cada sessão futura tem a sua URL própria `?sessao=AAAA-MM-DD-HHMM` (um Event por URL, regra do
    // Google). O slug de uma sessão irmã não entra: ele só redireciona pro link do principal.
    const anchorSlugById = new Map((events ?? []).map((e) => [e.id, e.slug ?? e.id]));
    const todayBR = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const sessionCodeOf = (e: { start_date: string | null; event_time: string | null }): string | null => {
      const t = /^(\d{1,2}):(\d{2})/.exec(e.event_time ?? '');
      return e.start_date && t ? `${e.start_date.slice(0, 10)}-${t[1].padStart(2, '0')}${t[2]}` : null;
    };

    const eventEntries = (events ?? []).flatMap((ev) => {
      const isSibling = !!ev.session_group_id && ev.session_group_id !== ev.id;
      const anchorSlug = isSibling ? anchorSlugById.get(ev.session_group_id as string) : undefined;
      const code = isSibling ? sessionCodeOf(ev) : null;
      // Irmã com âncora pública e código válido: entra como ?sessao= (só sessões que ainda vão acontecer).
      if (isSibling && anchorSlug && code && !ev.custom_domain) {
        if ((ev.start_date ?? '') < todayBR) return [];
      }
      const slugOrId = encodeURIComponent(ev.slug ?? ev.id);
      const lastmod = ev.created_at ? new Date(ev.created_at).toISOString().split('T')[0] : '';
      // Evento com domínio próprio: a URL canônica é o domínio custom, não
      // app.coreohub.com/evento/:slug — evita conteúdo duplicado no Google.
      const loc = ev.custom_domain
        ? `https://${ev.custom_domain}/`
        : isSibling && anchorSlug && code
          ? `${SITE_URL}/evento/${encodeURIComponent(anchorSlug)}?sessao=${code}`
          : `${SITE_URL}/evento/${slugOrId}`;
      return [`  <url>
    <loc>${loc}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`];
    });

    const staticEntries = staticPages.map((p) => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`);

    // Slug fora do padrão (maiúscula, espaço, parênteses, acento) é dado legado: a URL não é a canônica e o
    // Search Console reclama. Fica de fora do sitemap até o slug ser corrigido (sem mexer em dado aqui).
    const SLUG_OK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const workshopEntries = (workshops ?? []).filter((w) => !w.slug || SLUG_OK.test(w.slug)).map((w) => {
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
