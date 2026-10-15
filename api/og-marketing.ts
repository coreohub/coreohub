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

type Faq = { q: string; a: string };

// Links internos no HTML estático pra bots: sem eles, um rastreador que não executa JS (Bing Site Scan,
// crawlers de IA) não tem por onde navegar além da própria página (achado 2026-10-15: 2 scans, 1 página cada).
const NAV_LINKS: { path: string; label: string }[] = [
  { path: '/', label: 'Início' },
  { path: '/festivais', label: 'Festivais e mostras de dança' },
  { path: '/planos', label: 'Planos e preços' },
  { path: '/espetaculo', label: 'Bilheteria para espetáculo de dança' },
  { path: '/governo', label: 'Gestão para o setor público' },
  { path: '/sobre', label: 'Sobre a CoreoHub' },
  { path: '/termos', label: 'Termos de Uso' },
  { path: '/privacidade', label: 'Política de Privacidade' },
];

// FAQs espelhadas de pages/LandingEspetaculo.tsx (FAQ_ITEMS) e pages/Planos.tsx (PLANOS_FAQ_ITEMS): bots
// só leem este HTML. tests/marketing-faq-parity.test.ts quebra se o texto divergir das páginas.
const ESPETACULO_FAQ: Faq[] = [
  {
    q: 'Quanto custa vender ingresso pro espetáculo de fim de ano?',
    a: 'A CoreoHub cobra 7,9% sobre o valor vendido, sem mínimo, sem mensalidade e sem taxa de adesão. Além disso há a taxa de pagamento (Pix ou cartão), que aparece como linha separada no checkout e, por padrão, é paga pelo comprador. Se preferir, você assume essa taxa e o ingresso sai com preço fechado. O percentual de 7,9% é público e igual para qualquer estúdio.',
  },
  {
    q: 'E se a plateia não lotar e sobrar ingresso?',
    a: 'Não tem risco pra você. Você não paga nada adiantado, não se compromete com estoque mínimo e não perde dinheiro se não vender tudo — a taxa de 7,9% incide só sobre o que for vendido de verdade. Ingresso que não sai não custa nada.',
  },
  {
    q: 'Dá pra ativar a bilheteria perto da data do espetáculo? Ainda dá tempo?',
    a: 'Sim. O cadastro leva minutos e o link já sai vendendo na hora. Muitos estúdios ativam a bilheteria poucos dias antes do espetáculo e ainda conseguem vender pra maior parte da plateia — mas quanto antes você compartilhar o link, mais tempo a família tem pra organizar a ida.',
  },
  {
    q: 'Preciso ter assento numerado pra usar?',
    a: 'Não. Assento numerado é opcional — quem tem local com poltronas numeradas de verdade (teatro, auditório, centro de convenções) pode ativar o mapa; quem aluga um salão sem cadeiras fixas (tatame, plateia em pé, cadeiras soltas de escola) vende por setor/quantidade normalmente, sem precisar configurar mapa nenhum.',
  },
  {
    q: 'Tem júri, apuração ou cronograma competitivo?',
    a: 'Não. Essa bilheteria é feita pra espetáculo de fim de ano sem competição — só ingresso de plateia, cupom de desconto, cortesia e credenciamento por QR Code no dia. Se seu evento tem júri e premiação, o produto certo é o plano de Festival (veja em coreohub.com/planos).',
  },
  {
    q: 'Como recebo o dinheiro das vendas?',
    a: 'Cada ingresso vendido já sai com o split automático — a comissão de 7,9% fica com a CoreoHub e o resto vai para a sua subconta. O Pix fica retido por até 7 dias (janela de segurança para estornos, a mesma ideia de Stripe e Sympla) e depois é transferido via Pix direto pra você, sem precisar fazer nada. O cartão entra na subconta no prazo do Asaas, hoje cerca de 32 dias depois da confirmação, e então segue o mesmo caminho. Quer o dinheiro antes? O botão "Transferir agora" antecipa o saldo que já está na subconta, sem taxa extra.',
  },
  {
    q: 'Quem já compra ingresso paga alguma taxa a mais?',
    a: 'Sim, por padrão o comprador paga duas coisas além do preço do ingresso: a taxa de serviço (a comissão de 7,9% repassada) e a taxa de pagamento, que depende de ele escolher Pix ou cartão. Tudo aparece separado, com o total, antes de pagar. O estúdio pode assumir essas taxas em vez de repassar, e o ingresso sai com preço fechado.',
  },
  {
    q: 'O que é a taxa de pagamento e quem paga?',
    a: 'É uma linha separada no checkout que cobre o custo de processar o Pix ou o cartão. É proporcional ao valor da compra, com teto no Pix, e não entra no seu repasse: o que você recebe é o preço do ingresso menos a comissão. Por padrão quem paga é o comprador. Se você escolher pagar, o valor sai do seu repasse e o comprador vê o preço fechado. Em caso de estorno, a taxa de pagamento é devolvida ao comprador junto com o ingresso.',
  },
];

const PLANOS_FAQ: Faq[] = [
  {
    q: 'O que é a taxa de pagamento e quem paga?',
    a: 'É uma linha separada no checkout que cobre o custo de processar o Pix ou o cartão. Aparece com o total antes de pagar, não entra no repasse do produtor e é devolvida ao comprador em caso de estorno. Em ingressos, workshops e passes o comprador paga por padrão e o produtor pode assumir. Nas inscrições dos planos Essencial e Escala o produtor escolhe o modo; no Começo o preço é fechado.',
  },
];

const faqPage = (faq: Faq[]) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
});

type PageMeta = {
  path: string;
  title: string;
  description: string;
  /** Texto curto só pro cartão de compartilhamento (WhatsApp/Instagram/X); <title> e meta description seguem os campos acima (SEO). */
  ogTitle?: string;
  ogDescription?: string;
  /** Imagem própria pra essa página. Sem isso, cai no DEFAULT_IMAGE (foto do Hero da home). */
  image?: string;
  /** JSON-LD (schema.org) injetado no <head>; bots de IA e Google não rodam o React. */
  jsonLd?: Record<string, unknown>;
  /** Perguntas e respostas também no corpo do HTML (AEO). */
  faq?: Faq[];
  /** Meta description curta (snippet ~158 car.), quando `description` é o texto longo do corpo. */
  metaDescription?: string;
  /** Fatos em lista no corpo do HTML (bots sem JS não veem o React). */
  bullets?: string[];
};

const PAGES: Record<string, PageMeta> = {
  // Home: sem esta entrada, bots sem JS (GPTBot, ClaudeBot, PerplexityBot) recebiam o shell do
  // index.html (78 caracteres de texto, nenhum <h1>). Texto espelha index.html (meta + featureList).
  home: {
    path: '/',
    title: 'CoreoHub — Gestão inteligente para festivais e mostras de dança',
    description:
      'CoreoHub é a plataforma de gestão para festivais e mostras de dança no Brasil: inscrições, pagamentos, júri digital, cronograma, bilheteria, check-in e certificados. Sem mensalidade. Fundada em 2026 por Ticko Bboy, é uma empresa do Cultural Estúdio, de Votuporanga/SP.',
    metaDescription:
      'Plataforma de gestão para festivais e mostras de dança: inscrições, júri digital, cronograma com IA e certificados automáticos. Sem mensalidade.',
    bullets: [
      'Inscrições online por modalidade',
      'Pagamento via Pix, cartão e boleto com split automático',
      'Júri digital por tablet (funciona sem Wi-Fi)',
      'Cronograma inteligente com detecção de conflito de bailarino',
      'Seletiva de vídeo pré-festival',
      'Bilheteria e workshops integrados',
      'Check-in por QR code',
      'Certificados automáticos com QR de validação',
      'Narração por IA',
      'Configuração automática de evento por regulamento em PDF',
    ],
  },
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
    // Espelha PLANOS_DESCRIPTION em pages/Planos.tsx — 2 fontes de verdade
    // desconectadas (SPA client-side vs. este HTML estático pra bot), já
    // ficaram fora de sincronia uma vez (achado 2026-09-13, sessão da
    // Lorrayne). Bots que NÃO executam JS (GPTBot/ClaudeBot/PerplexityBot/
    // etc, todos no matcher de vercel.json) só veem esta versão — Googlebot
    // renderiza JS e vê a versão real da SPA, mas os crawlers de IA (GEO/AEO)
    // dependem inteiramente deste texto estar correto.
    description:
      'Começo (10% sobre inscrições, ingressos e workshops, sem taxa fixa), Essencial (R$250 + 5%) ou Escala (R$1.490 + R$2/participante, teto de 4,5%). Sem mensalidade — você paga proporcional ao que o festival fatura. A taxa de pagamento (Pix ou cartão) aparece separada no checkout, paga pelo comprador ou por você, conforme o evento. Só a seletiva por vídeo tem taxa própria, configurável à parte.',
    // Imagem própria (cartões Começo/Essencial/Escala) — sem isso, compartilhar
    // o link de Planos mostrava a mesma foto do Hero da home, sem relação
    // nenhuma com preço/comercial. Achado 2026-09-13.
    image: `${SITE_URL}/og-planos.jpg`,
    metaDescription:
      'Começo (10%), Essencial (R$250 + 5%) ou Escala (R$1.490 + R$2/participante). Sem mensalidade: você paga proporcional ao que o festival fatura.',
    faq: PLANOS_FAQ,
    jsonLd: { '@context': 'https://schema.org', ...faqPage(PLANOS_FAQ) },
  },
  sobre: {
    path: '/sobre',
    title: 'Sobre a CoreoHub — quem está por trás e o que a plataforma faz',
    description:
      'A CoreoHub é a plataforma de gestão para festivais e mostras de dança. Fundada em 2026 por Ticko Bboy, é uma empresa do Cultural Estúdio, de Votuporanga/SP.',
    faq: [
      { q: 'O que é a CoreoHub?', a: 'Plataforma online de gestão de festivais e mostras de dança: inscrições, pagamentos com split automático, júri digital por tablet, cronograma, bilheteria, check-in por QR Code e certificados.' },
      { q: 'Para quem é?', a: 'Para produtores de festivais, mostras e competições de dança, estúdios e escolas com espetáculo de fim de ano, e para os inscritos, jurados e público desses eventos.' },
      { q: 'Quem está por trás?', a: 'A CoreoHub foi fundada em 2026 por Ticko Bboy, artista e empreendedor há mais de 25 anos, de Votuporanga (SP), com atuação nas danças urbanas, MBA em Dança: Gestão e Produção Cultural e apresentações no Brasil, Portugal, Equador, França e Argentina. Ele também fundou a Usualdance e é fundador do Cultural Estúdio (CNPJ 13.484.650/0001-00), empresa da qual a CoreoHub faz parte.' },
      { q: 'Quanto custa?', a: 'Sem mensalidade: a CoreoHub ganha uma comissão sobre o que o evento vende. Os planos estão em coreohub.com/planos.' },
    ],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: 'Sobre a CoreoHub',
      url: `${SITE_URL}/sobre`,
      mainEntity: { '@id': 'https://coreohub.com/#organization' },
    },
  },
  espetaculo: {
    path: '/espetaculo',
    title: 'Bilheteria para espetáculo de fim de ano de dança — Plano Espetáculo | CoreoHub',
    description:
      'Venda ingresso do espetáculo de dança do estúdio: 7,9% sobre o vendido, sem mensalidade, mais taxa de pagamento (comprador ou você). Cupom, cortesia e QR Code.',
    ogTitle: 'Venda os ingressos do seu espetáculo de dança online',
    ogDescription: 'Ingresso por Pix, cortesias e entrada por QR Code. Você paga 7,9% só sobre o que vender, sem mensalidade.',
    // Mesma foto da hero da página (antes caía na foto genérica da home).
    image: `${SITE_URL}/og-espetaculo.jpg`,
    faq: ESPETACULO_FAQ,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Service',
          name: 'Plano Espetáculo — CoreoHub',
          description: 'Venda ingresso do espetáculo de dança do estúdio: 7,9% sobre o vendido, sem mensalidade, mais taxa de pagamento (comprador ou você). Cupom, cortesia e QR Code.',
          provider: { '@type': 'Organization', name: 'CoreoHub', url: SITE_URL },
          areaServed: 'BR',
          serviceType: 'Bilheteria online para espetáculo de dança',
          offers: {
            '@type': 'Offer',
            description: '7,9% sobre o valor vendido, sem mínimo e sem mensalidade, mais taxa de pagamento (Pix ou cartão) paga pelo comprador ou assumida pelo produtor',
            priceCurrency: 'BRL',
          },
        },
        faqPage(ESPETACULO_FAQ),
      ],
    },
  },
};

const html = (meta: PageMeta): string => {
  const url = `${SITE_URL}${meta.path}`;
  const image = meta.image ?? DEFAULT_IMAGE;
  const ogTitle = meta.ogTitle ?? meta.title;
  const ogDescription = meta.ogDescription ?? meta.description;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.metaDescription ?? meta.description)}">

<!-- Open Graph (WhatsApp, Telegram, Facebook, Instagram, LinkedIn) -->
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDescription)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ogTitle)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoreoHub">
<meta property="og:locale" content="pt_BR">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDescription)}">
<meta name="twitter:image" content="${esc(image)}">

<link rel="canonical" href="${esc(url)}">
${meta.jsonLd ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<h1>${esc(meta.title)}</h1>
<p>${esc(meta.description)}</p>
${meta.bullets ? `<ul>\n${meta.bullets.map((b) => `<li>${esc(b)}</li>`).join('\n')}\n</ul>` : ''}
${meta.faq ? meta.faq.map((i) => `<h2>${esc(i.q)}</h2>\n<p>${esc(i.a)}</p>`).join('\n') : ''}
<p><a href="${esc(url)}">Acesse a página completa</a></p>
<nav aria-label="Páginas da CoreoHub">
<ul>
${NAV_LINKS.map((l) => `<li><a href="${SITE_URL}${l.path}">${esc(l.label)}</a></li>`).join('\n')}
</ul>
</nav>
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
