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

// Fuso do Brasil por UF (sem horário de verão desde 2019). Padrão -03:00.
const ufUtcOffset = (uf?: string | null): string => {
  const u = (uf ?? '').toUpperCase();
  if (u === 'AC') return '-05:00';
  if (['AM', 'RO', 'RR', 'MT', 'MS'].includes(u)) return '-04:00';
  return '-03:00';
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = String(req.query.slug ?? '').trim();
  // dest=checkout: rota de compra (/checkout-ingresso/...). O preview do
  // WhatsApp mostra o evento, mas a página não deve ser indexada.
  const isCheckout = String(req.query.dest ?? '') === 'checkout';
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
    const evCols = 'id,name,slug,description,cover_url,start_date,end_date,event_time,city,state,location,formacoes_config,ingressos_config,audience_sales_enabled,payment_sandbox,sessao_status,sessao_motivo,sessao_data_original,session_group_id';
    const restUrl = `${SUPABASE_URL}/rest/v1/events?select=${evCols}&${filterCol}=eq.${encodeURIComponent(slug)}&limit=1`;

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
      event_time: string | null;
      city: string | null;
      state: string | null;
      location: string | null;
      formacoes_config: Array<{ name: string; is_active?: boolean }> | null;
      ingressos_config: Array<{ nome?: string; preco?: number | string; lotes?: Array<{ preco?: number | string; data_inicio?: string | null; data_virada?: string | null }> }> | null;
      audience_sales_enabled: boolean | null;
      payment_sandbox: boolean | null;
      sessao_status: string | null;
      sessao_motivo: string | null;
      sessao_data_original: string | null;
      session_group_id: string | null;
    }>;

    // `let` porque ?sessao= troca pelo evento da sessão; o `as` mantém o tipo sem undefined dentro dos callbacks.
    let ev = events?.[0] as NonNullable<typeof events>[number];
    if (!ev && filterCol === 'slug') {
      // Slug renomeado: o slug antigo fica em event_slug_history. O redirect do React não roda pra bot
      // (WhatsApp, Googlebot), então resolvemos aqui e servimos o evento já com o canonical do slug atual.
      const authHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
      const histRes = await fetch(
        `${SUPABASE_URL}/rest/v1/event_slug_history?select=events(slug)&old_slug=eq.${encodeURIComponent(slug)}&order=created_at.desc&limit=1`,
        { headers: authHeaders },
      );
      const hist = histRes.ok ? ((await histRes.json()) as Array<{ events: { slug: string | null } | null }>) : [];
      const currentSlug = hist?.[0]?.events?.slug;
      if (currentSlug) {
        const curRes = await fetch(
          `${SUPABASE_URL}/rest/v1/events?select=${evCols}&slug=eq.${encodeURIComponent(currentSlug)}&limit=1`,
          { headers: authHeaders },
        );
        const cur = curRes.ok ? ((await curRes.json()) as typeof events) : [];
        if (cur?.[0]) ev = cur[0];
      }
    }
    if (!ev) {
      // Slug não achado nem no histórico: página genérica em vez de 404.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(fallbackHtml(slug));
      return;
    }

    // Espetáculo com sessões (cada sessão é um evento; o link público é o do evento principal, a âncora
    // do grupo: id = session_group_id). ?sessao=<chave> escolhe a sessão (chave = slug da sessão sem o prefixo
    // do principal, ex. sessao-2; o código AAAA-MM-DD-HHMM também é aceito) e entrar pelo slug de uma irmã
    // vira canonical do link principal + ?sessao=. Cada URL tem um único Event (regra do Google).
    // Duplicado de utils/sessionCode.ts pelo mesmo motivo do isEventOver acima (bundle isolado).
    const sessionKeyOf = (e: { slug: string | null; id: string }, principalSlug: string | null): string => {
      const sl = e.slug ?? '';
      return sl && principalSlug && sl.startsWith(`${principalSlug}-`) && sl.length > principalSlug.length + 1
        ? sl.slice(principalSlug.length + 1)
        : (sl || e.id);
    };
    const restGet = async <T,>(path: string): Promise<T[]> => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      });
      return r.ok ? ((await r.json()) as T[]) : [];
    };
    let pageUrl = `${SITE_URL}/evento/${ev.slug ?? ev.id}`;
    let sessionLabel: string | null = null;
    if (ev.session_group_id) {
      const rawKey = String(req.query.sessao ?? '').trim();
      const wantedKey = /^[a-zA-Z0-9-]{1,120}$/.test(rawKey) ? rawKey : '';
      const wantedCode = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/.exec(wantedKey);
      if (ev.id === ev.session_group_id) {
        if (wantedKey) {
          const principalSlug = ev.slug ?? ev.id;
          const filter = wantedCode
            ? `start_date=eq.${wantedCode[1]}&event_time=eq.${wantedCode[2]}:${wantedCode[3]}`
            : `slug=in.(${wantedKey},${principalSlug}-${wantedKey})`;
          const sib = (await restGet<typeof ev>(
            `events?select=${evCols}&session_group_id=eq.${ev.session_group_id}&${filter}&is_public=eq.true&limit=1`,
          ))[0];
          if (sib) {
            pageUrl = `${SITE_URL}/evento/${principalSlug}?sessao=${encodeURIComponent(sessionKeyOf(sib, principalSlug))}`;
            ev = sib;
          }
        }
      } else {
        const anchor = (await restGet<{ slug: string | null }>(
          `events?select=slug&id=eq.${ev.session_group_id}&is_public=eq.true&limit=1`,
        ))[0];
        if (anchor?.slug) pageUrl = `${SITE_URL}/evento/${anchor.slug}?sessao=${encodeURIComponent(sessionKeyOf(ev, anchor.slug))}`;
      }
      const hhmm = /^(\d{1,2}):(\d{2})/.exec(ev.event_time ?? '');
      if (ev.start_date && hhmm) {
        sessionLabel = `${ev.start_date.slice(8, 10)}/${ev.start_date.slice(5, 7)}/${ev.start_date.slice(0, 4)} às ${hhmm[1].padStart(2, '0')}:${hhmm[2]}`;
      }
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
    // Sessão cancelada/adiada (Decreto 13.108, arts. 20-22): o status do evento vem primeiro,
    // igual ao JSON-LD da página React (PublicEventPage.tsx) — bots não podem ver "agendado".
    const sessaoCancelada = ev.sessao_status === 'cancelada';
    const sessaoAdiada = ev.sessao_status === 'adiada';
    const statusLabel = sessaoCancelada
      ? 'Sessão cancelada'
      : sessaoAdiada
        ? 'Sessão adiada'
        : isRegistrationOpen
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
    const title = `${ev.name}${sessionLabel ? ` — ${sessionLabel}` : ''} — ${statusLabel} | CoreoHub`;
    // Preview do WhatsApp e snippet: a sessão (dia e horário) aparece no título e na descrição.
    const ogTitle = sessionLabel ? `${ev.name} — ${sessionLabel}` : ev.name;
    // Meta description convencionalmente curta (~160 char, o que os buscadores
    // de fato exibem no snippet); o <body> abaixo carrega o texto INTEIRO —
    // é o que os crawlers de IA/Google realmente indexam como conteúdo.
    const shortDescription =
      (fullDescription.length <= 158
        ? fullDescription
        : `${fullDescription.slice(0, 157).replace(/s+S*$/, '')}…`) ||
      `${statusLabel} — ${ev.name}, festival de dança no CoreoHub.`;
    const metaDescription = sessionLabel ? `Sessão de ${sessionLabel}. ${shortDescription}` : shortDescription;
    const image = ev.cover_url || DEFAULT_IMAGE;
    const canonicalSlug = ev.slug ?? ev.id;
    // Canonical/og:url: o link do evento principal (com ?sessao= nas sessões que não são a principal).
    // canonicalSlug segue sendo o slug do evento da sessão, usado nas URLs de checkout dos ingressos.
    const url = pageUrl;
    const locationParts = [ev.location, [ev.city, ev.state].filter(Boolean).join('/')].filter(Boolean);
    const dateRange = ev.start_date
      ? (ev.end_date && ev.end_date !== ev.start_date ? `${ev.start_date} a ${ev.end_date}` : ev.start_date)
      : null;

    // JSON-LD Event — mesmo shape de PublicEventPage.tsx. Sem isso, NENHUM
    // bot (Googlebot incluso — ver comentário no topo do arquivo) recebia
    // dado estruturado pra este evento, já que todos são redirecionados
    // pra esta função em vez de rodar o React de verdade.
    // Ingressos de plateia (só com venda pelo CoreoHub ligada): preço vigente
    // do lote de hoje, com URL do checkout — Google exige offers.url crawleável.
    const todayIso = new Date().toISOString().slice(0, 10);
    // Sessão cancelada: ingressos e workshops deixam de ser ofertáveis para o Google.
    const offerAvailability = sessaoCancelada ? 'https://schema.org/Discontinued' : 'https://schema.org/InStock';
    const ticketOffers = (ev.audience_sales_enabled && Array.isArray(ev.ingressos_config) ? ev.ingressos_config : [])
      .map((t, idx) => {
        const lotes = Array.isArray(t.lotes) ? t.lotes : [];
        const vigente = lotes.find((l) => (!l.data_inicio || l.data_inicio <= todayIso) && (!l.data_virada || l.data_virada >= todayIso));
        const price = Number(vigente?.preco ?? t.preco ?? 0);
        return { nome: t.nome, price, idx };
      })
      .filter((t) => t.nome && t.price > 0)
      .map((t) => ({
        '@type': 'Offer',
        name: t.nome,
        price: t.price.toFixed(2),
        priceCurrency: 'BRL',
        availability: offerAvailability,
        url: `${SITE_URL}/checkout-ingresso/${canonicalSlug}/${t.idx}`,
      }));
    const workshopOffers = workshops
      .filter((w) => w.preco_padrao != null || w.gratis_para_inscritos)
      .map((w) => ({
        '@type': 'Offer',
        name: w.name,
        price: w.gratis_para_inscritos ? '0' : String(w.preco_padrao ?? '0'),
        priceCurrency: 'BRL',
        availability: offerAvailability,
        url,
      }));
    const allOffers = [...ticketOffers, ...workshopOffers];

    const eventJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: ev.name,
      description: fullDescription || shortDescription,
      image: [image],
      // startDate com hora e fuso (Google Events); sem hora cai só na data.
      startDate: ev.start_date && ev.event_time && /^\d{1,2}:\d{2}/.test(ev.event_time)
        ? `${ev.start_date}T${ev.event_time.slice(0, 5).padStart(5, '0')}:00${ufUtcOffset(ev.state)}`
        : (ev.start_date ?? undefined),
      endDate: ev.end_date ?? ev.start_date ?? undefined,
      eventStatus: sessaoCancelada
        ? 'https://schema.org/EventCancelled'
        : sessaoAdiada ? 'https://schema.org/EventRescheduled' : 'https://schema.org/EventScheduled',
      ...(sessaoAdiada && ev.sessao_data_original ? { previousStartDate: ev.sessao_data_original } : {}),
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        name: ev.location || locationParts.join(', ') || 'Brasil',
        address: {
          '@type': 'PostalAddress',
          streetAddress: ev.location ?? undefined,
          addressLocality: ev.city ?? undefined,
          addressRegion: ev.state ?? undefined,
          addressCountry: 'BR',
        },
      },
      organizer: { '@type': 'Organization', name: 'CoreoHub', url: 'https://coreohub.com' },
      url,
      ...(allOffers.length > 0 ? { offers: allOffers } : {}),
    };

    const formacoesAtivas = (ev.formacoes_config ?? [])
      .filter((f) => f?.is_active !== false && f?.name)
      .map((f) => f.name);

    // Fatos-chave em texto puro — corpo visível/indexável, não só meta tag.
    const factsLines = [
      dateRange ? `Data: ${dateRange}` : null,
      sessionLabel ? `Sessão: ${sessionLabel}` : null,
      locationParts.length > 0 ? `Local: ${locationParts.join(' — ')}` : null,
      prazoInscricao ? `Inscrições até: ${prazoInscricao}` : null,
      formacoesAtivas.length > 0 ? `Formações: ${formacoesAtivas.join(', ')}` : null,
      `Status: ${statusLabel}`,
      sessaoAdiada && ev.sessao_data_original ? `Data anterior: ${ev.sessao_data_original}` : null,
      (sessaoAdiada || sessaoCancelada) && ev.sessao_motivo ? `Motivo informado pelo organizador: ${ev.sessao_motivo}` : null,
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
<meta name="description" content="${esc(metaDescription)}">
<meta name="robots" content="${isCheckout || ev.payment_sandbox ? 'noindex, nofollow' : 'index, follow'}">

<!-- Open Graph (WhatsApp, Telegram, Facebook, Instagram, LinkedIn) -->
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(metaDescription)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:type" content="event">
<meta property="og:site_name" content="CoreoHub">
<meta property="og:locale" content="pt_BR">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(metaDescription)}">
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
