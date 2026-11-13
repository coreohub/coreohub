/**
 * Conteúdo e regras compartilhadas de "agent readiness" (is-agentic.com / AEO / GEO).
 *
 * Fonte única usada por:
 *  - middleware.ts            → Markdown por `Accept: text/markdown`, 404 real, mapa de rotas conhecidas;
 *  - api/md.ts                → corpo Markdown (200 nas páginas de marketing, 404 nas desconhecidas);
 *  - api/not-found.ts         → 404 em HTML leve;
 *  - api/og-marketing.ts      → bloco de empresa no HTML dos bots;
 *  - vite.config.ts           → pré-render do texto no #root (HTML bruto com conteúdo, sem JS).
 *
 * Arquivo com prefixo `_`: a Vercel não o trata como função serverless.
 * Sem imports de runtime (só tipos), pra rodar no Edge, no Node e no Vite.
 */

export const SITE_URL = 'https://coreohub.com';

/** Dados reais da empresa (mesmos do rodapé, da página /sobre e do JSON-LD). Sem endereço de rua: não definido. */
export const COMPANY = {
  name: 'CoreoHub',
  legal: 'CoreoHub, uma empresa do Cultural Estúdio',
  cnpj: '13.484.650/0001-00',
  city: 'Votuporanga/SP',
  whatsappUrl: 'https://wa.me/5517997936169',
  whatsappLabel: '(17) 99793-6169',
  email: 'contato@coreohub.com',
  instagram: 'https://www.instagram.com/coreohub/',
  youtube: 'https://www.youtube.com/@CoreoHub',
} as const;

/** Caminho público → chave em PAGES (api/og-marketing.ts). Só as páginas com texto estático. */
export const MARKDOWN_PATHS: Record<string, string> = {
  '/': 'home',
  '/festivais': 'festivais',
  '/planos': 'planos',
  '/espetaculo': 'espetaculo',
  '/curso-de-ferias': 'cursoferias',
  '/governo': 'governo',
  '/sobre': 'sobre',
  '/contato': 'contato',
  '/termos': 'termos',
  '/privacidade': 'privacidade',
};

/**
 * Primeiro segmento de toda rota existente no App.tsx (públicas e logadas). Qualquer outro
 * caminho em coreohub.com é inexistente e recebe 404 de verdade (antes: 200 com o shell e um
 * <Navigate to="/"> em JavaScript, o "soft-404"). Ao criar rota nova no App.tsx, incluir aqui;
 * tests/agent-readiness.test.ts compara as duas listas.
 */
export const KNOWN_TOP_SEGMENTS: readonly string[] = [
  'account-settings', 'ai-analysis', 'apuracao', 'avisos', 'bailarinos', 'battle-arena', 'battle-config',
  'central-de-midia', 'certificados', 'check-in', 'checkout-ingresso', 'checkout-workshop',
  'checkout-workshop-pass', 'conferencia', 'contato', 'convite', 'cotacoes-terminal-juri', 'credenciais',
  'credencial', 'credenciamento', 'criar-espetaculo', 'criar-evento', 'cronograma', 'cupons',
  'curso-de-ferias', 'curso-de-verao', 'dashboard', 'debitos-produtores', 'deliberacao', 'deliberacoes',
  'entrar-juri', 'equipe-convite', 'equipe-jurados', 'equipe-jurados-config', 'espetaculo', 'event-config',
  'evento', 'festivais', 'festival', 'governo', 'importar-regulamento', 'ingressos', 'inicio', 'inscricoes',
  'judge-login', 'judge-practice', 'judge-terminal', 'jurado-seletiva', 'live', 'locais', 'login', 'lp',
  'manage-schedule', 'marcacao-palco', 'meu-ingresso', 'meu-workshop', 'meus-certificados', 'meus-resultados',
  'minha-equipe', 'minha-seletiva', 'minhas-coreografias', 'narracao-ia', 'pagamento', 'planos', 'premiacao',
  'privacidade', 'produtor', 'profile', 'qg-organizador', 'register', 'registrations', 'seletiva-video',
  'sobre', 'super-admin', 'suporte-juri', 'telao', 'telao-palco', 'termo-produtor', 'termos', 'trilhas', 'u',
  'validar-certificado', 'vendas', 'vendas-ingressos', 'workshop', 'workshops-do-evento',
];

const KNOWN = new Set(KNOWN_TOP_SEGMENTS);

/** `/` e qualquer caminho cujo 1º segmento é uma rota real do app. */
export function isKnownRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return KNOWN.has(first.toLowerCase());
}

/** O cliente aceita Markdown? (navegador manda text/html primeiro e nunca text/markdown). */
export function wantsMarkdown(accept: string | null | undefined): boolean {
  return /(^|[\s,;])text\/markdown(\s*[;,]|$)/i.test(accept ?? '');
}

/** Páginas de confiança em inglês → página canônica em português (redirect 308 no vercel.json). */
export const TRUST_REDIRECTS: Record<string, string> = {
  '/about': '/sobre',
  '/contact': '/contato',
  '/privacy': '/privacidade',
};

export type Faq = { q: string; a: string };

/** Subconjunto de PageMeta (api/og-marketing.ts) que os renderizadores precisam. */
export type PageContent = {
  path: string;
  title: string;
  description: string;
  metaDescription?: string;
  bullets?: string[];
  faq?: Faq[];
};

export const NAV_LINKS: { path: string; label: string }[] = [
  { path: '/', label: 'Início' },
  { path: '/festivais', label: 'Festivais e mostras de dança' },
  { path: '/planos', label: 'Planos e preços' },
  { path: '/espetaculo', label: 'Bilheteria para espetáculo de dança' },
  { path: '/curso-de-ferias', label: 'Venda de curso de férias e de verão de dança' },
  { path: '/governo', label: 'Gestão para o setor público' },
  { path: '/sobre', label: 'Sobre a CoreoHub' },
  { path: '/contato', label: 'Contato' },
  { path: '/termos', label: 'Termos de Uso' },
  { path: '/privacidade', label: 'Política de Privacidade' },
];

export const escHtml = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Bloco "Dados da empresa" em HTML (NAP igual ao rodapé e ao schema). */
export function companyBlockHtml(): string {
  return `<h2>Dados da empresa</h2>
<p>${escHtml(COMPANY.legal)}. CNPJ ${COMPANY.cnpj}. Sede em ${COMPANY.city}. Atendimento em todo o Brasil.</p>
<p>Contato: WhatsApp <a href="${COMPANY.whatsappUrl}">${COMPANY.whatsappLabel}</a> e e-mail <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>.</p>`;
}

export function navHtml(): string {
  return `<nav aria-label="Páginas da CoreoHub">
<ul>
${NAV_LINKS.map((l) => `<li><a href="${SITE_URL}${l.path}">${escHtml(l.label)}</a></li>`).join('\n')}
</ul>
</nav>`;
}

/** Corpo HTML estático da página (h1, texto, lista, FAQ, empresa, navegação). Usado nos bots e no pré-render. */
export function pageBodyHtml(meta: PageContent): string {
  const url = `${SITE_URL}${meta.path}`;
  return `<h1>${escHtml(meta.title)}</h1>
<p>${escHtml(meta.description)}</p>
${meta.bullets ? `<ul>\n${meta.bullets.map((b) => `<li>${escHtml(b)}</li>`).join('\n')}\n</ul>` : ''}
${meta.faq ? meta.faq.map((i) => `<h2>${escHtml(i.q)}</h2>\n<p>${escHtml(i.a)}</p>`).join('\n') : ''}
<p><a href="${escHtml(url)}">Acesse a página completa</a></p>
${companyBlockHtml()}
${navHtml()}`;
}

/** Markdown da página, com links para llms.txt, sitemap e contato. */
export function pageMarkdown(meta: PageContent): string {
  const lines: string[] = [];
  lines.push(`# ${meta.title}`, '', meta.description, '');
  if (meta.bullets?.length) {
    lines.push('## Em resumo', '', ...meta.bullets.map((b) => `- ${b}`), '');
  }
  if (meta.faq?.length) {
    lines.push('## Perguntas frequentes', '');
    for (const i of meta.faq) lines.push(`### ${i.q}`, '', i.a, '');
  }
  lines.push(...companyMarkdown(), ...linksMarkdown());
  return lines.join('\n');
}

function companyMarkdown(): string[] {
  return [
    '## Dados da empresa',
    '',
    `${COMPANY.legal}. CNPJ ${COMPANY.cnpj}. Sede em ${COMPANY.city}. Atendimento em todo o Brasil.`,
    '',
    `- WhatsApp: [${COMPANY.whatsappLabel}](${COMPANY.whatsappUrl})`,
    `- E-mail: ${COMPANY.email}`,
    '',
  ];
}

function linksMarkdown(): string[] {
  return [
    '## Links úteis',
    '',
    `- [llms.txt](${SITE_URL}/llms.txt): quando usar a CoreoHub, quando não usar e como acionar`,
    `- [Sitemap](${SITE_URL}/sitemap.xml)`,
    ...NAV_LINKS.filter((l) => l.path !== '/').map((l) => `- [${l.label}](${SITE_URL}${l.path})`),
    '',
  ];
}

/** Markdown do 404 (status 404 + Content-Type text/markdown). */
export function notFoundMarkdown(pathname: string): string {
  return [
    '# Página não encontrada (404)',
    '',
    `O endereço \`${pathname.replace(/[`\n\r]/g, '')}\` não existe na CoreoHub. Use os links abaixo para encontrar o que procura.`,
    '',
    ...linksMarkdown(),
    '## Contato',
    '',
    `- WhatsApp: [${COMPANY.whatsappLabel}](${COMPANY.whatsappUrl})`,
    `- E-mail: ${COMPANY.email}`,
    '',
  ].join('\n');
}

/** 404 em HTML leve (rota inexistente em coreohub.com). */
export function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Página não encontrada — CoreoHub</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#000;color:#fff;max-width:640px;margin:0 auto;padding:48px 24px;line-height:1.6}a{color:#ff0068}h1{font-style:italic;text-transform:uppercase;letter-spacing:-.03em}</style>
</head>
<body>
<h1>Página não encontrada</h1>
<p>O endereço que você abriu não existe na CoreoHub. Veja o que a plataforma oferece nos links abaixo.</p>
${navHtml()}
<p>Dúvidas? WhatsApp <a href="${COMPANY.whatsappUrl}">${COMPANY.whatsappLabel}</a> ou <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>. Resumo para agentes de IA em <a href="${SITE_URL}/llms.txt">llms.txt</a>.</p>
</body>
</html>`;
}

/** Texto "bruto" mínimo que o scanner exige nas páginas de confiança (verificado nos testes). */
export const MIN_TRUST_CHARS = 500;
