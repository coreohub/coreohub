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
import { NAV_LINKS, companyBlockHtml } from './_agent-content.js';

export const SITE_URL = 'https://coreohub.com';
const APP_URL = 'https://app.coreohub.com';
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ghpltzzijlvykiytwslu.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

// Lista de eventos futuros para o HTML do bot em /festivais (quem não roda JavaScript não vê a lista React).
// Mesmos filtros da vitrine: público, não sandbox, com capa e descrição. Sessões extras viram ?sessao=<chave>.
type EvRow = { id: string; slug: string | null; name: string; start_date: string | null; event_time: string | null; city: string | null; state: string | null; session_group_id: string | null; sessao_status: string | null };
const fetchUpcomingEventLinks = async (): Promise<Array<{ href: string; label: string }> | null> => {
  if (!SUPABASE_ANON_KEY) return null;
  try {
    const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const q = `${SUPABASE_URL}/rest/v1/events?select=id,slug,name,start_date,event_time,city,state,session_group_id,sessao_status&is_public=eq.true&payment_sandbox=eq.false&cover_url=not.is.null&description=not.is.null&start_date=gte.${today}&order=start_date.asc&limit=100`;
    const hdrs = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
    const r = await fetch(q, { headers: hdrs, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const rows = ((await r.json()) as EvRow[]).filter((e) => e.slug && e.sessao_status !== 'cancelada');
    const principalSlugById = new Map(rows.filter((e) => e.session_group_id === e.id).map((e) => [e.id, e.slug as string]));
    // Sessão futura cujo principal já passou (ou não veio): busca o slug do principal à parte.
    const faltando = [...new Set(rows.map((e) => e.session_group_id).filter((g): g is string => !!g && !principalSlugById.has(g)))];
    if (faltando.length > 0) {
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/events?select=id,slug&id=in.(${faltando.join(',')})`, { headers: hdrs, signal: AbortSignal.timeout(3000) });
      if (pr.ok) for (const p of (await pr.json()) as Array<{ id: string; slug: string | null }>) if (p.slug) principalSlugById.set(p.id, p.slug);
    }
    return rows.map((e) => {
      const principal = e.session_group_id && e.session_group_id !== e.id ? principalSlugById.get(e.session_group_id) : undefined;
      const slug = e.slug as string;
      const href = principal
        ? `${APP_URL}/evento/${principal}?sessao=${slug.startsWith(`${principal}-`) ? slug.slice(principal.length + 1) : slug}`
        : `${APP_URL}/evento/${slug}`;
      const [y, m, d] = (e.start_date ?? '').split('-');
      const hora = e.event_time && /^\d{1,2}:\d{2}/.test(e.event_time) ? ` ${e.event_time.slice(0, 5)}` : '';
      const where = [e.city, e.state].filter(Boolean).join('/');
      return { href, label: `${e.name} — ${d}/${m}/${y}${hora}${where ? ` — ${where}` : ''}` };
    });
  } catch (err) {
    console.error('[api/og-marketing] eventos futuros falhou:', err);
    return null;
  }
};
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

// FAQs espelhadas de pages/LandingEspetaculo.tsx (FAQ_ITEMS) e pages/Planos.tsx (PLANOS_FAQ_ITEMS): bots
// só leem este HTML. tests/marketing-faq-parity.test.ts quebra se o texto divergir das páginas.
// FAQ espelhada de pages/LandingCursoFerias.tsx (CURSO_FAQ_ITEMS); o teste de paridade quebra se divergir.
const CURSO_FERIAS_FAQ: Faq[] = [
  {
    q: 'Posso continuar usando meu site, meu Canva ou minha página?',
    a: 'Sim. O link do seu curso na CoreoHub pode ser o botão Garantir vaga da página que você já tem. O aluno compra no checkout da CoreoHub e você não perde a sua vitrine.',
  },
  {
    q: 'Dá para vender passe de semana e aula avulsa no mesmo curso?',
    a: 'Dá. Você cria passes fechados e passes em que o aluno escolhe as aulas que quer, dentro do mínimo e do máximo que você define, e o valor soma. Cada aula mantém a sua própria vaga, presença e certificado.',
  },
  {
    q: 'Posso dar desconto para quem fizer mais de um curso?',
    a: 'Pode. Nos passes em que o aluno escolhe as aulas, você cadastra faixas de desconto por quantidade de aulas (por exemplo 2, 3, 4 ou mais). O desconto é aplicado sozinho no carrinho e o aluno vê quanto falta para a próxima faixa. Desconto de faixa e cupom não se somam: vale o maior dos dois.',
  },
  {
    q: 'E se o lote esgotar ou a data do lote chegar?',
    a: 'O lote seguinte entra sozinho, por data ou quando a cota do lote acaba. O aluno sempre vê o preço vigente.',
  },
  {
    q: 'Consigo vender hospedagem junto com o curso?',
    a: 'Sim. A hospedagem é um adicional com vagas por noite, e você pode permitir chegada antecipada ou saída estendida. O aluno informa a preferência de colega de quarto e a lista de hóspedes sai em CSV para você fechar com o hotel.',
  },
  {
    q: 'O aluno pode parcelar no cartão?',
    a: 'Sim, em até 6x conforme o valor da compra, liberado por evento pela CoreoHub (fale com a gente para ativar). O custo do parcelamento é do comprador e aparece antes de pagar, com a taxa efetiva. Não é parcelado sem juros.',
  },
  {
    q: 'Quanto custa para começar?',
    a: 'Não há mensalidade. Você escolhe o plano do evento: Começo (10% sobre o vendido, sem taxa fixa), Essencial (R$250 mais 5% sobre o vendido) ou Escala, para eventos grandes (detalhes em coreohub.com/planos). A taxa do plano vale para inscrições, ingressos e workshops do evento. Além dela há a taxa de pagamento (Pix ou cartão), em linha separada no checkout e paga pelo comprador por padrão. A Asaas cobra R$12,90 uma única vez pela abertura da sua conta digital, descontados do seu primeiro repasse.',
  },
  {
    q: 'Preciso ter CNPJ para vender pela CoreoHub?',
    a: 'Não é obrigatório. A conta digital de recebimento pode ser aberta com CPF ou com CNPJ e passa pela verificação de identidade da Asaas.',
  },
  {
    q: 'Quando eu recebo?',
    a: 'Cada venda já sai com split automático: a comissão fica com a CoreoHub e o resto vai para a sua conta digital. O Pix fica retido por até 7 dias, como janela de segurança para estornos, e depois é transferido para você. O cartão cai no prazo da Asaas, cerca de 32 dias depois da confirmação, e no parcelado conforme as parcelas.',
  },
  {
    q: 'O que acontece se alguém pedir estorno?',
    a: 'Você faz o estorno pelo painel e o valor volta ao comprador, incluindo a taxa de pagamento. As regras de estorno e de arrependimento estão no Termo do Produtor.',
  },
];

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
    a: 'Cada ingresso vendido já sai com o split automático — a comissão de 7,9% fica com a CoreoHub e o resto vai para a sua subconta. O Pix fica retido por até 7 dias (janela de segurança para estornos, a mesma ideia de Stripe e Sympla) e depois é transferido via Pix direto pra você, sem precisar fazer nada. O cartão entra na subconta no prazo do Asaas, hoje cerca de 32 dias depois da confirmação, e então segue o mesmo caminho. Quer o dinheiro assim que liberar? O botão "Transferir agora" envia na hora, sem taxa extra, o saldo que já passou dos 7 dias.',
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

export type PageMeta = {
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

// JSON-LD da home (Organization, Person, WebSite, SoftwareApplication, VideoObject, FAQPage). Cópia EXATA do bloco
// do index.html: bots de IA recebem este HTML e não o index.html. tests/marketing-faq-parity.test.ts garante que
// as duas cópias não divergem; ao mudar um, mude o outro.
const HOME_JSONLD: Record<string, any> = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://coreohub.com/#organization",
      "name": "CoreoHub",
      "url": "https://coreohub.com/",
      "logo": "https://coreohub.com/coreohub-avatar.png",
      "foundingDate": "2026",
      "founder": {
        "@id": "https://coreohub.com/sobre#ticko-bboy"
      },
      "parentOrganization": {
        "@type": "Organization",
        "name": "Cultural Estúdio",
        "url": "https://culturalestudio.com.br/",
        "taxID": "13.484.650/0001-00"
      },
      "description": "CoreoHub é a plataforma completa de gestão para produtores de festivais e mostras de dança, oferecendo inscrições, pagamentos, júri digital, cronograma inteligente, bilheteria, check-in e certificados automáticos. Fundada em 2026 por Ticko Bboy, artista com mais de 25 anos nas danças urbanas, é uma empresa do Cultural Estúdio (Votuporanga/SP).",
      "sameAs": [
        "https://www.instagram.com/coreohub/",
        "https://www.youtube.com/@CoreoHub"
      ],
      "areaServed": "Brasil",
      "knowsAbout": [
        "gestão de festivais de dança",
        "mostras de dança",
        "júri digital",
        "inscrições online para dança",
        "cronograma de festival",
        "certificados digitais"
      ],
      "email": "contato@coreohub.com",
      "telephone": "+55-17-99793-6169",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "R. Amazonas, 2814, Sala 24, Patrimônio Novo",
        "addressLocality": "Votuporanga",
        "addressRegion": "SP",
        "postalCode": "15505-208",
        "addressCountry": "BR"
      },
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer support",
        "telephone": "+55-17-99793-6169",
        "email": "contato@coreohub.com",
        "availableLanguage": [
          "Portuguese"
        ],
        "areaServed": "BR",
        "url": "https://wa.me/5517997936169"
      }
    },
    {
      "@type": "Person",
      "@id": "https://coreohub.com/sobre#ticko-bboy",
      "name": "Ticko Bboy",
      "jobTitle": "Fundador da CoreoHub",
      "url": "https://ticko.com.br/",
      "sameAs": [
        "https://ticko.com.br/",
        "https://usualdance.com/"
      ],
      "worksFor": {
        "@id": "https://coreohub.com/#organization"
      }
    },
    {
      "@type": "WebSite",
      "@id": "https://coreohub.com/#website",
      "name": "CoreoHub",
      "url": "https://coreohub.com/",
      "inLanguage": "pt-BR",
      "publisher": {
        "@id": "https://coreohub.com/#organization"
      }
    },
    {
      "@type": "SoftwareApplication",
      "name": "CoreoHub",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "url": "https://coreohub.com/",
      "description": "Plataforma de gestão de festivais e mostras de dança: inscrições online, pagamentos via split automático (Asaas), júri digital por tablet (funciona offline), cronograma inteligente, bilheteria, check-in por QR code e emissão automática de certificados.",
      "featureList": [
        "Inscrições online por modalidade",
        "Pagamento via Pix e cartão, e boleto nos eventos que o oferecem, com split automático",
        "Júri digital por tablet (funciona sem Wi-Fi)",
        "Feedback em áudio dos jurados, direto para o coreógrafo",
        "Telão de palco com resultado revelado ao vivo",
        "Cronograma inteligente com detecção de conflito de bailarino",
        "Seletiva de vídeo pré-festival",
        "Bilheteria e workshops integrados",
        "Cartão de crédito parcelado em até 3x nos eventos que oferecem",
        "Check-in por QR code",
        "Certificados automáticos com QR de validação",
        "Narração por IA",
        "Configuração automática de evento por regulamento em PDF"
      ],
      "publisher": {
        "@id": "https://coreohub.com/#organization"
      },
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "BRL",
        "description": "Sem mensalidade e sem fidelidade. Plano Começo: 10% de comissão sobre as vendas, sem taxa fixa. Essencial e Escala: taxa de ativação por evento mais comissão menor. A taxa de pagamento (Pix ou cartão) aparece em linha separada no checkout, paga pelo comprador ou pelo produtor."
      }
    },
    {
      "@type": "VideoObject",
      "name": "CoreoHub em 3 minutos",
      "description": "Do regulamento em PDF ao certificado com QR Code — veja o festival inteiro rodando dentro da plataforma, sem planilha e sem apagar incêndio.",
      "thumbnailUrl": "https://img.youtube.com/vi/bLqI7Icm_eI/hqdefault.jpg",
      "uploadDate": "2026-08-19",
      "embedUrl": "https://www.youtube.com/embed/bLqI7Icm_eI",
      "publisher": {
        "@id": "https://coreohub.com/#organization"
      }
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Quando eu recebo o dinheiro das inscrições?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "O Pix fica retido por até 7 dias, como janela de segurança para estornos, e depois a CoreoHub transfere para você. O botão \"Transferir agora\" envia na hora, sem taxa, o saldo que já passou dos 7 dias. O cartão cai no prazo da Asaas, hoje cerca de 32 dias depois da confirmação, e só então segue o mesmo caminho. Cada pagamento sai com split automático: a comissão do seu plano fica com a CoreoHub e o resto vai para a sua conta digital."
          }
        },
        {
          "@type": "Question",
          "name": "Quanto custa para começar?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Não há mensalidade. Você escolhe um plano por evento: Começo (10% sobre o vendido), Essencial (R$250 por evento mais 5%) ou Escala, para eventos grandes. A Asaas cobra R$12,90 uma única vez pela abertura da sua conta digital, descontados do seu primeiro repasse. A taxa de pagamento (Pix ou cartão) aparece separada no checkout e, por padrão, quem paga é o comprador."
          }
        },
        {
          "@type": "Question",
          "name": "Funciona mesmo offline?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Sim. Avaliação de jurados, cronograma, check-in por QR Code e narração funcionam mesmo sem internet no local — o app sincroniza automaticamente quando a conexão volta. Você só precisa de internet pra publicar o evento e receber pagamentos."
          }
        },
        {
          "@type": "Question",
          "name": "Os jurados podem gravar comentário em áudio?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Sim. O jurado grava o comentário direto no tablet, durante a avaliação. O coreógrafo ouve, baixa e compartilha pelo celular em Meus Resultados, e você exporta todos os áudios de uma vez, em um arquivo .zip com os nomes organizados por apresentação. Os áudios ficam disponíveis por 90 dias depois do evento."
          }
        },
        {
          "@type": "Question",
          "name": "Posso vender ingressos da plateia?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Sim. Você cria tipos de ingresso e lotes, com meia-entrada, cupons, cortesias e mapa de assentos numerados quando o local tem. O comprador paga com Pix ou cartão e recebe o ingresso com QR Code, que você confere na porta."
          }
        },
        {
          "@type": "Question",
          "name": "E se eu quiser sair? Tem fidelidade?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Não. Não existe contrato de permanência nem multa de cancelamento — você usa enquanto fizer sentido pro seu festival. Se decidir sair, seu histórico de eventos, inscrições e certificados continua acessível e exportável, sem prazo de expiração."
          }
        },
        {
          "@type": "Question",
          "name": "Tem suporte técnico?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Sim, direto por WhatsApp com nossa equipe — sem ticket, sem fila de atendimento genérico. Na semana do seu festival, o suporte é prioritário: se algo travar no dia, você fala com a gente na hora, não espera resposta de central."
          }
        },
        {
          "@type": "Question",
          "name": "Quantos festivais por mês posso criar?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Quantos quiser. Não há limite de festivais, edições ou mostras — você paga só a comissão do seu plano sobre o que vender (nos planos Essencial e Escala, mais a taxa de ativação por evento), então pode rodar um evento por mês ou dez, sem mensalidade te travando."
          }
        },
        {
          "@type": "Question",
          "name": "Funciona pra evento gratuito ou edital público?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Sim — temos modelo específico para eventos gratuitos, mostras municipais e editais públicos. Como cada caso tem particularidades (tipo de evento, instituição, verba), fale com a gente pelo WhatsApp e montamos a proposta certa pro seu caso."
          }
        }
      ]
    }
  ]
};

const HOME_FAQ: Faq[] = (HOME_JSONLD['@graph'].find((n: any) => n['@type'] === 'FAQPage').mainEntity as any[]).map(
  (x) => ({ q: x.name, a: x.acceptedAnswer.text }),
);

export const PAGES: Record<string, PageMeta> = {
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
      'Pagamento via Pix e cartão, e boleto nos eventos que o oferecem, com split automático',
      'Júri digital por tablet (funciona sem Wi-Fi)',
      'Cronograma inteligente com detecção de conflito de bailarino',
      'Seletiva de vídeo pré-festival',
      'Bilheteria e workshops integrados',
      'Cartão de crédito parcelado em até 3x nos eventos que oferecem',
      'Check-in por QR code',
      'Certificados automáticos com QR de validação',
      'Feedback em áudio dos jurados, direto para o coreógrafo',
      'Telão de palco com resultado revelado ao vivo',
      'Narração por IA',
      'Configuração automática de evento por regulamento em PDF',
    ],
    faq: HOME_FAQ,
    jsonLd: HOME_JSONLD,
  },
  festivais: {
    path: '/festivais',
    title: 'Festivais e mostras de dança abertos — CoreoHub',
    description:
      'Descubra festivais e mostras de dança com inscrições abertas em todo o Brasil. Filtre por estado e mês e inscreva sua coreografia.',
  },
  termos: {
    path: '/termos',
    title: 'Termos de Uso — CoreoHub',
    description:
      'Termos de Uso da CoreoHub: regras de uso da plataforma de gestão de festivais e mostras de dança, responsabilidades e condições de pagamento.',
    bullets: ["1. Aceitação dos termos", "2. Descrição do serviço", "3. Cadastro e conta", "4. Modelo de cobrança", "5. Responsabilidades do produtor", "6. Pagamentos e reembolsos", "7. Compra de ingressos", "8. Propriedade intelectual", "9. Limitação de responsabilidade", "10. Privacidade", "11. Modificações", "12. Cancelamento", "13. Lei aplicável e foro", "14. Contato"],
  },
  privacidade: {
    path: '/privacidade',
    title: 'Política de Privacidade — CoreoHub',
    description:
      'Política de Privacidade da CoreoHub: como coletamos, usamos e protegemos os dados de produtores, jurados e bailarinos, em conformidade com a LGPD.',
    bullets: ["1. Quem somos", "2. Dados que coletamos", "3. Como usamos seus dados", "4. Compartilhamento de dados", "5. Cookies", "6. Seus direitos (LGPD)", "7. Retenção de dados", "8. Segurança", "9. Transferência internacional", "10. Alterações nesta política", "11. Contato"],
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
    bullets: [
      'Plataforma online para festivais, mostras e competições de dança, e para espetáculos de fim de ano de estúdios e escolas',
      'Reúne inscrições, pagamentos com repasse automático, júri digital por tablet, cronograma, bilheteria, check-in e certificados',
      'Sem mensalidade: a CoreoHub ganha uma comissão sobre o que o evento vende',
      'Fundada em 2026 por Ticko Bboy, empresa do Cultural Estúdio, de Votuporanga/SP',
    ],
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
  contato: {
    path: '/contato',
    title: 'Contato — fale com a CoreoHub',
    description:
      'Fale com a CoreoHub por WhatsApp ou e-mail. Atendimento em todo o Brasil para produtores de festivais, mostras e espetáculos de dança, estúdios e órgãos públicos. Sem ticket e sem central: a conversa é direta com a equipe.',
    metaDescription:
      'Fale com a CoreoHub por WhatsApp ou e-mail: dúvidas sobre planos, cadastro de evento, pagamentos e suporte para produtores de dança.',
    bullets: [
      'WhatsApp: (17) 99793-6169, o canal mais rápido, inclusive na semana do seu evento',
      'E-mail: contato@coreohub.com',
      'Instagram: @coreohub',
      'Sede: R. Amazonas, 2814, Sala 24, Patrimônio Novo, Votuporanga/SP, CEP 15505-208, com atendimento em todo o Brasil',
      'Para cadastrar um evento sem falar com ninguém: coreohub.com/criar-evento',
    ],
    faq: [
      { q: 'Qual é o melhor jeito de falar com a CoreoHub?', a: 'Pelo WhatsApp (17) 99793-6169. Informe o tipo de evento (festival, mostra, espetáculo de estúdio, curso de férias ou edital público), a data, a cidade e o número aproximado de inscritos ou de público, e a equipe responde com o plano e os próximos passos.' },
      { q: 'Quando devo escrever?', a: 'Antes de abrir as inscrições ou a venda de ingressos, para escolher o plano certo, e a qualquer momento se algo travar. Na semana do evento o suporte é prioritário.' },
      { q: 'Onde fica a CoreoHub?', a: 'A sede fica na R. Amazonas, 2814, Sala 24, Patrimônio Novo, Votuporanga/SP (CEP 15505-208), mesmo endereço do Cultural Estúdio. O atendimento é online, em todo o Brasil. Para visitas e reuniões, combine antes pelo WhatsApp ou por e-mail.' },
    ],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ContactPage',
      name: 'Contato — CoreoHub',
      url: `${SITE_URL}/contato`,
      mainEntity: { '@id': 'https://coreohub.com/#organization' },
    },
  },
  desenvolvedores: {
    path: '/desenvolvedores',
    title: 'CoreoHub API — documentação para desenvolvedores',
    description:
      'CoreoHub API v1: leitura pública e gratuita dos eventos de dança da vitrine da CoreoHub, em JSON, sem chave e sem cadastro. Especificação OpenAPI em coreohub.com/openapi.json, erros em JSON, versionamento no caminho (/api/v1) e política de depreciação com aviso de pelo menos 90 dias.',
    metaDescription:
      'CoreoHub API v1: leitura pública e gratuita dos eventos de dança da vitrine, em JSON, com OpenAPI, versionamento e política de depreciação.',
    bullets: [
      'Base: https://coreohub.com/api/v1, somente GET, sem autenticação',
      'GET /api/v1/eventos: lista os eventos públicos (limit de 1 a 100, offset para paginar)',
      'GET /api/v1/eventos/{slug}: um evento público pelo slug',
      'Especificação OpenAPI 3.1 em https://coreohub.com/openapi.json',
      'Erros sempre em JSON: error, message, hint e status (400, 404, 405, 502, 503)',
      'Versão no caminho (/api/v1) e no cabeçalho X-API-Version; mudança que quebra vira /api/v2',
      'Versão antiga fica no ar por pelo menos 90 dias após o aviso, com cabeçalhos Deprecation e Sunset',
      'Não há API com chave ou OAuth de terceiros: inscrições, pagamentos e notas do júri não são expostos',
    ],
    faq: [
      { q: 'A CoreoHub tem API pública?', a: 'Sim, a CoreoHub API v1: leitura somente de eventos públicos, em JSON, sem chave. Base https://coreohub.com/api/v1, com os endpoints /eventos e /eventos/{slug}.' },
      { q: 'Preciso de chave ou cadastro para usar a API?', a: 'Não. A API devolve só o que já é público na vitrine (nome, descrição, capa, datas, local e link do evento). Não existe API com chave ou OAuth de terceiros por enquanto; para integrar algo além da leitura pública, escreva para contato@coreohub.com.' },
      { q: 'Como a API é versionada e descontinuada?', a: 'A versão vai no caminho (/api/v1) e no cabeçalho X-API-Version. Mudança que não quebra entra na mesma versão; mudança que quebra vira /api/v2. Uma versão antiga continua no ar por pelo menos 90 dias após o aviso, e suas respostas passam a trazer os cabeçalhos Deprecation e Sunset.' },
      { q: 'Como são os erros?', a: 'Sempre JSON com error, message, hint e status, junto do status HTTP correspondente: 400 parâmetro inválido, 404 recurso inexistente, 405 método não aceito, 502 falha ao ler os eventos e 503 serviço indisponível.' },
    ],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      name: 'CoreoHub API — documentação para desenvolvedores',
      url: `${SITE_URL}/desenvolvedores`,
      about: { '@id': 'https://coreohub.com/#organization' },
    },
  },
  cursoferias: {
    path: '/curso-de-ferias',
    title: 'Curso de Férias e de Verão de Dança | CoreoHub',
    description:
      'Venda passes, aulas, hospedagem e lotes do seu curso de férias de dança com Pix e cartão, vagas controladas e painel do produtor. Sem mensalidade.',
    ogTitle: 'Venda o seu curso de férias de dança com pagamento na hora',
    ogDescription: 'O aluno escolhe as aulas, vê o total e paga na hora. Você acompanha vagas, hospedagem e dinheiro num lugar só. Sem mensalidade.',
    image: `${SITE_URL}/og-curso-ferias.jpg`,
    faq: CURSO_FERIAS_FAQ,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Service',
          name: 'Venda de curso de férias de dança — CoreoHub',
          description: 'Venda passes, aulas, hospedagem e lotes do seu curso de férias de dança com Pix e cartão, vagas controladas e painel do produtor. Sem mensalidade.',
          provider: { '@type': 'Organization', name: 'CoreoHub', url: SITE_URL },
          areaServed: 'BR',
          serviceType: 'Plataforma de vendas e inscrições para curso de férias e curso de verão de dança',
          offers: {
            '@type': 'Offer',
            description: 'Sem mensalidade. Plano Começo: 10% sobre o valor vendido. Plano Essencial: R$250 mais 5%. Plano Escala para eventos grandes. Mais taxa de pagamento (Pix ou cartão) paga pelo comprador ou assumida pelo produtor',
            priceCurrency: 'BRL',
          },
        },
        faqPage(CURSO_FERIAS_FAQ),
      ],
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

const html = (meta: PageMeta, eventLinks: Array<{ href: string; label: string }> = []): string => {
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
${eventLinks.length > 0 ? `<h2>Próximos eventos</h2>
<ul>
${eventLinks.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join('\n')}
</ul>` : ''}
<p><a href="${esc(url)}">Acesse a página completa</a></p>
${companyBlockHtml()}
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

  const fetched = page === 'festivais' ? await fetchUpcomingEventLinks() : [];
  // Falha ao buscar a lista: cache curto, pra não congelar uma página sem eventos por 1 hora.
  res.setHeader('Cache-Control', fetched === null ? 'public, max-age=0, s-maxage=60' : 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(html(meta, fetched ?? []));
}
