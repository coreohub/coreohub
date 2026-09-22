/**
 * Landing dedicada ao Plano Espetáculo (docs/mostra-pricing-spec.md) — bilheteria
 * de plateia pra espetáculo de fim de ano de estúdio/escola de dança, sem
 * competição (sem júri/apuração/cronograma competitivo/telão/seletiva/certificado/
 * workshops). Irmã comercial do Festival, fora de /planos por decisão de produto
 * (funil dedicado, não confunde estúdio com linguagem de festival competitivo).
 *
 * Copy reescrita 2026-09-22 com ângulo emocional (pesquisa de mercado: o medo
 * real do dono de estúdio não é "quanto custa a taxa", é "plateia vazia" e
 * "pais não rematricularem" — convite de WhatsApp que ninguém lê e fila
 * bagunçada na porta são dores reais confirmadas em pesquisa BR e global).
 * Sessões alternam fundo claro/escuro — diferencia visualmente da
 * LandingPage.tsx/LandingGoverno.tsx, que são 100% escuras.
 *
 * SEO/AEO/GEO seguindo o checklist salvo em
 * D:\Documentos\CoreoHub Site\blog-seo-standard\site-seo-checklist.md +
 * brands\coreohub-seo-rules.md — meta tags nativas React 19 (mesmo padrão de
 * PublicEventPage.tsx), canonical bare coreohub.com, JSON-LD Service+FAQPage,
 * resposta extraível na dobra (seção 7 AEO/GEO).
 */

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ChevronRight, Ticket, QrCode, Tag, Check, X, ChevronDown,
  ArrowRight, Menu, Users, ShieldCheck, HeartHandshake,
} from 'lucide-react';

const SITE_URL = 'https://coreohub.com';
const CANONICAL_URL = `${SITE_URL}/espetaculo`;

const PAGE_TITLE = 'Bilheteria para espetáculo de fim de ano de dança — Plano Espetáculo | CoreoHub';
const PAGE_DESCRIPTION = 'Venda ingresso do espetáculo de fim de ano do seu estúdio de dança sem grupo de WhatsApp nem planilha: 7,9% sobre o vendido, sem mensalidade, taxa pública. Cupom, cortesia e credenciamento por QR Code incluídos.';

const FAQ_ITEMS = [
  {
    q: 'Quanto custa vender ingresso pro espetáculo de fim de ano?',
    a: 'A CoreoHub cobra 7,9% sobre o valor total vendido (GMV), sem mínimo e com tudo incluso — a CoreoHub absorve 100% da taxa de processamento de PIX, cartão e boleto. Não tem mensalidade, não tem taxa de adesão, não tem contrato. Esse número é público e fixo: não muda por negociação caso a caso, é o mesmo pra qualquer estúdio.',
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
    a: 'Não. O Plano Espetáculo é feito pra mostra/espetáculo de fim de ano sem competição — só bilheteria de plateia, cupom de desconto, cortesia e credenciamento por QR Code no dia. Se seu evento tem júri e premiação, o produto certo é o plano de Festival (veja em coreohub.com/planos).',
  },
  {
    q: 'Como recebo o dinheiro das vendas?',
    a: 'Cada ingresso vendido já sai com o split automático — a comissão de 7,9% fica com a CoreoHub, o resto fica retido na sua conta por até 7 dias (mesma janela de segurança usada por Stripe e Sympla) e depois é transferido via Pix direto pra você, sem precisar fazer nada. Quer o dinheiro antes? O botão "Transferir agora" antecipa a qualquer momento, sem taxa extra.',
  },
  {
    q: 'Quem já compra ingresso paga alguma taxa a mais?',
    a: 'Por padrão, sim — o valor da taxa fica embutido no preço final mostrado, sem linha "+taxa" separada no checkout. O produtor pode configurar pra absorver a taxa em vez de repassar, se preferir.',
  },
];

export default function LandingEspetaculo() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        name: 'Plano Espetáculo — CoreoHub',
        description: PAGE_DESCRIPTION,
        provider: { '@type': 'Organization', name: 'CoreoHub', url: SITE_URL },
        areaServed: 'BR',
        serviceType: 'Bilheteria online para espetáculo de dança',
        offers: {
          '@type': 'Offer',
          description: '7,9% sobre o GMV vendido, sem mínimo, tudo incluso',
          priceCurrency: 'BRL',
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ_ITEMS.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">
      <title>{PAGE_TITLE}</title>
      <meta name="description" content={PAGE_DESCRIPTION} />
      <meta property="og:title" content={PAGE_TITLE} />
      <meta property="og:description" content={PAGE_DESCRIPTION} />
      <meta property="og:image" content={`${SITE_URL}/og-image.jpg`} />
      <meta property="og:url" content={CANONICAL_URL} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="CoreoHub" />
      <meta property="og:locale" content="pt_BR" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={PAGE_TITLE} />
      <meta name="twitter:description" content={PAGE_DESCRIPTION} />
      <meta name="twitter:image" content={`${SITE_URL}/og-image.jpg`} />
      <link rel="canonical" href={CANONICAL_URL} />
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>

      {/* ─── NAV ──────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 bg-slate-950/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/coreohub-avatar.webp" alt="CoreoHub" width={32} height={32} className="w-8 h-8" />
            <span className="text-sm font-black uppercase tracking-tight text-white">CoreoHub</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-6">
            <a href="https://app.coreohub.com/login" className="text-xs font-bold text-slate-300 hover:text-white transition-colors">
              Entrar
            </a>
            <button
              onClick={() => navigate('/criar-espetaculo')}
              className="px-4 py-2 bg-[#ff0068] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform"
            >
              Criar meu espetáculo →
            </button>
          </nav>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="sm:hidden p-2 text-white"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {menuOpen && (
          <div className="sm:hidden bg-slate-950/95 backdrop-blur-md border-t border-white/10 px-6 py-4 space-y-1">
            <a href="https://app.coreohub.com/login" className="block text-sm font-bold text-slate-300 hover:text-white transition-colors py-3 border-b border-white/5">
              Entrar
            </a>
            <div className="pt-3">
              <button
                onClick={() => { navigate('/criar-espetaculo'); setMenuOpen(false); }}
                className="w-full px-4 py-3 bg-[#ff0068] text-white rounded-xl text-sm font-black uppercase tracking-widest"
              >
                Criar meu espetáculo →
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ─── 1. HERO (escuro, foto) ──────────────────────────────────────────────── */}
      <section className="relative min-h-[80vh] flex flex-col overflow-hidden bg-black">
        <img
          src="/hero-festival.webp"
          srcSet="/hero-festival-mobile.webp 960w, /hero-festival.webp 1920w"
          sizes="100vw"
          alt=""
          aria-hidden="true"
          width={1920}
          height={1072}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover object-[50%_35%]"
        />
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.25)_40%,transparent_65%)]" />

        <div className="relative z-10 flex-1 flex flex-col justify-end px-4 pb-10 pt-28 text-center sm:px-6 sm:text-left lg:px-8">
          <div className="mx-auto max-w-xl px-5 sm:mx-0 sm:px-0">
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white">Pra estúdio e escola de dança</p>
            <h1 className="mt-2 sm:mt-3 text-[2.1rem] sm:text-[3.1rem] font-black tracking-normal uppercase leading-[1.06]">
              A plateia lotada que seu espetáculo merece.
            </h1>
            <p className="mt-3 sm:mt-4 text-slate-200 text-sm sm:text-base font-medium leading-snug">
              Convite de papel e grupo de WhatsApp que ninguém lê viram ingresso digital que os pais realmente compram.
              7,9% sobre o vendido, sem mensalidade.
            </p>
            <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 sm:justify-start">
              <button
                onClick={() => navigate('/criar-espetaculo')}
                className="group relative px-8 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(255,0,104,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Criar meu espetáculo <ChevronRight size={18} />
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-4xl mx-auto w-full grid grid-cols-3 gap-4 border-t border-white/10 px-6 pt-6 pb-8">
          {[
            { val: '7,9%', label: 'sobre o vendido, sem mínimo', icon: Tag },
            { val: 'R$ 0', label: 'de mensalidade', icon: Ticket },
            { val: 'QR Code', label: 'no credenciamento do dia', icon: QrCode },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="text-center flex flex-col items-center">
                <Icon size={26} className="text-[#ff0068] mb-2" aria-hidden="true" />
                <p className="text-2xl md:text-4xl font-black text-white tracking-tighter">{s.val}</p>
                <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mt-1">{s.label}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── 2. RESPOSTA DIRETA (AEO/GEO, claro) ──────────────────────────────────────────────── */}
      <section className="bg-white text-slate-900 px-6 py-16 border-t border-slate-200">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-slate-700 text-base leading-relaxed">
            O <strong className="text-slate-950">Plano Espetáculo</strong> é a bilheteria da CoreoHub pra
            espetáculo de fim de ano de estúdio de dança: substitui o convite de papel e o grupo de WhatsApp
            por <strong className="text-slate-950">ingresso digital que os pais compram e usam de verdade</strong>,
            com credenciamento por QR Code na porta — cobrando 7,9% sobre cada venda, sem mensalidade.
          </p>
        </div>
      </section>

      {/* ─── 3. PROBLEMA (escuro) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-400 mb-3">Reconhece a semana antes do espetáculo?</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-8">
            Você passou o ano montando a coreografia.<br />
            <span className="text-rose-400">Agora passa a semana implorando presença.</span>
          </h2>
          <div className="space-y-4 text-slate-300 text-lg leading-relaxed">
            <p>Convite espalhado no grupo de WhatsApp que ninguém lê — no dia, metade da plateia nem sabia que tinha espetáculo.</p>
            <p>Convite de papel controlado numa planilha, comprovante de Pix conferido um por um.</p>
            <p>Fila na porta do teatro porque ninguém sabe direito quem já confirmou.</p>
            <p className="text-white font-bold pt-2">
              Seu trabalho do ano inteiro merece uma plateia cheia — não uma torcida pra dar certo.
            </p>
          </div>
        </div>
      </section>

      {/* ─── 4. AGITAÇÃO (escuro) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-400 mb-3">E o que está em jogo é maior que 1 noite</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-8">
            O espetáculo é a prova<br />
            <span className="text-amber-400">que os pais esperam o ano inteiro.</span>
          </h2>
          <div className="space-y-5 text-slate-300 text-lg leading-relaxed">
            <p>
              Pra família, é ali que se vê se a mensalidade valeu a pena — é o momento que confirma que o filho
              evoluiu, que o estúdio é sério, que vale continuar no ano que vem.
            </p>
            <p>
              Plateia vazia ou fila bagunçada na entrada não é só um detalhe incômodo: é a diferença entre
              "ano que vem eu matriculo de novo" e "vamos procurar outro lugar".
            </p>
            <p className="text-white font-bold">
              Quanto mais alunos você tem, maior o risco — e menos tempo sobra pra cuidar de convite na mão.
            </p>
          </div>
        </div>
      </section>

      {/* ─── 5. SOLUÇÃO (claro) ──────────────────────────────────────────────── */}
      <section className="relative bg-white text-slate-900 px-6 py-24 lg:py-32 border-t border-slate-200 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.05),transparent_70%)]" />
        <div className="relative max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">A solução</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6 text-slate-950">
              Você já fez a parte difícil.<br />
              <span className="text-[#ff0068]">A CoreoHub cuida do resto.</span>
            </h2>
            <p className="text-slate-600 text-lg md:text-xl max-w-3xl mx-auto leading-relaxed">
              Sem júri, sem apuração, sem cronograma competitivo — só o que um espetáculo de fim de ano
              precisa pra ter a plateia que o seu trabalho merece.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                num: '01',
                icon: Ticket,
                title: 'Cadastre seu espetáculo',
                body: 'Nome, data, local e tipos de ingresso (inteira, meia, solidária) — com ou sem assento numerado. Pronto pra vender em minutos.',
              },
              {
                num: '02',
                icon: Tag,
                title: 'Compartilhe o link e venda',
                body: 'Cupom de desconto, cortesia direta pro elenco e checkout com PIX, cartão e boleto — nada de comprovante conferido na mão.',
              },
              {
                num: '03',
                icon: QrCode,
                title: 'Credenciamento por QR no dia',
                body: 'Cada comprador entra com QR Code escaneado na porta — sem fila de conferência manual, sem "quem já confirmou mesmo?".',
              },
            ].map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-3xl p-6 hover:border-[#ff0068]/30 transition-all">
                  <p className="text-5xl font-black tracking-tighter text-[#ff0068]/20 mb-4">{step.num}</p>
                  <Icon size={24} className="text-[#ff0068] mb-3" />
                  <h3 className="text-xl font-black uppercase tracking-tight text-slate-950">{step.title}</h3>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">{step.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 6. TAXA / TRANSPARÊNCIA (escuro) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Sem letra miúda</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6">
            Quanto custa vender ingresso<br />
            pro seu espetáculo?
          </h2>
          <div className="max-w-2xl mx-auto bg-gradient-to-br from-[#ff0068]/10 via-white/5 to-purple-700/10 border border-white/10 rounded-3xl p-8 md:p-10 backdrop-blur-xl">
            <p className="text-5xl font-black tracking-tighter text-white">7,9%</p>
            <p className="text-slate-300 text-sm mt-2">sobre o total vendido — sem mínimo, sem taxa fixa, tudo incluso</p>
            <ul className="mt-6 space-y-2 text-left max-w-sm mx-auto">
              {[
                'Não vendeu, não pagou — sem estoque mínimo, sem risco',
                'CoreoHub absorve 100% do processamento (PIX, cartão, boleto)',
                'Repasse automático via Pix, sem fechamento de caixa manual',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-slate-300">
                  <Check size={16} className="text-[#ff0068] shrink-0 mt-1" />
                  <span className="text-sm leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => navigate('/criar-espetaculo')}
              className="mt-8 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#ff0068] text-white rounded-xl text-sm font-black uppercase tracking-widest hover:bg-[#ff1a7d] transition-colors"
            >
              Criar meu espetáculo <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* ─── 7. FEATURES INCLUÍDAS (claro) ──────────────────────────────────────────────── */}
      <section className="bg-white text-slate-900 px-6 py-24 lg:py-32 border-t border-slate-200">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">O que já vem incluído</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-950">
              Tudo isso, na mesma taxa.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: Users, title: 'Ingresso multi-tipo', body: 'Inteira, meia e solidária no mesmo carrinho — o comprador escolhe a combinação certa numa compra só.' },
              { icon: Ticket, title: 'Múltiplas sessões/elencos', body: 'Cada elenco ou sessão vira um tipo de ingresso ou um evento próprio, sem misturar plateia.' },
              { icon: Tag, title: 'Cupom e cortesia', body: 'Desconto pra quem indicar, convite gratuito direto pro elenco — sem precisar de planilha à parte.' },
              { icon: ShieldCheck, title: 'Assento numerado opcional', body: 'Local com poltronas fixas ativa o mapa de assento; sem local fixo, vende por setor/quantidade normalmente.' },
            ].map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex gap-4">
                  <Icon size={22} className="text-[#ff0068] shrink-0 mt-1" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-tight text-slate-950">{f.title}</h3>
                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{f.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 8. PROVA SOCIAL (escuro, placeholder) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Depoimentos</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Quem já usou,<br />
              <span className="text-[#ff0068]">aprova.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-4 min-h-[180px]">
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-slate-500 text-xs uppercase tracking-widest font-bold text-center">Depoimento em breve</p>
                </div>
                <div className="flex items-center gap-3 border-t border-white/10 pt-4">
                  <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
                  <div>
                    <p className="text-slate-500 text-sm font-black">Estúdio parceiro</p>
                    <p className="text-slate-600 text-[10px] font-bold uppercase tracking-widest">Em validação</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 9. FAQ (claro) ──────────────────────────────────────────────── */}
      <section className="bg-white text-slate-900 px-6 py-24 lg:py-32 border-t border-slate-200">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Dúvidas frequentes</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-950">
              Tudo o que você quer<br />perguntar.
            </h2>
          </div>
          <div className="space-y-2">
            {FAQ_ITEMS.map((item, i) => (
              <div key={i} className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`espetaculo-faq-panel-${i}`}
                  id={`espetaculo-faq-trigger-${i}`}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-slate-100 transition-colors"
                >
                  <span className="text-base font-black uppercase tracking-tight text-slate-950">{item.q}</span>
                  <ChevronDown size={18} className={`shrink-0 text-slate-500 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div
                    id={`espetaculo-faq-panel-${i}`}
                    role="region"
                    aria-labelledby={`espetaculo-faq-trigger-${i}`}
                    className="px-5 pb-5 -mt-1 text-sm text-slate-600 leading-relaxed"
                  >
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 10. CTA FINAL (escuro) ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 overflow-hidden border-t border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.18),transparent_70%)]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <HeartHandshake size={36} className="text-[#ff0068] mx-auto mb-6" aria-hidden="true" />
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter uppercase leading-[0.95] mb-6">
            Chega de plateia incerta<br />
            <span className="text-[#ff0068]">no espetáculo mais importante do ano.</span>
          </h2>
          <p className="text-slate-300 text-xl md:text-2xl max-w-2xl mx-auto leading-relaxed mb-10">
            Cadastre o espetáculo agora. Compartilhe o link hoje à noite. Receba a primeira venda amanhã.
          </p>
          <button
            onClick={() => navigate('/criar-espetaculo')}
            className="inline-flex items-center gap-2 px-10 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(255,0,104,0.4)] hover:scale-[1.02] active:scale-[0.98] transition-transform"
          >
            Criar meu espetáculo <ArrowRight size={18} />
          </button>
          <p className="text-xs text-slate-500 mt-5">
            Sem mensalidade · Você só paga quando vende · Sem contrato de fidelidade
          </p>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <footer className="px-6 py-16 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <img src="/coreohub-avatar.webp" alt="CoreoHub" width={40} height={40} className="w-10 h-10" />
                <div>
                  <p className="text-base font-black uppercase tracking-tighter text-white">CoreoHub</p>
                  <p className="text-[10px] text-slate-500">Gestão Inteligente para Festivais e Mostras de Dança</p>
                </div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
                Bilheteria pra espetáculo de fim de ano de estúdio de dança. Ingresso, cupom, cortesia
                e credenciamento por QR Code num único link.
              </p>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-4">Produto</p>
              <ul className="space-y-2 text-[11px] text-slate-400">
                <li><Link to="/" className="hover:text-[#ff0068]">Plataforma para festivais</Link></li>
                <li><a href="https://app.coreohub.com/criar-espetaculo" className="hover:text-[#ff0068]">Criar meu espetáculo</a></li>
                <li><a href="https://app.coreohub.com/login" className="hover:text-[#ff0068]">Entrar</a></li>
              </ul>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-4">Contato</p>
              <ul className="space-y-2 text-[11px] text-slate-400">
                <li><a href="mailto:contato@coreohub.com" className="hover:text-[#ff0068]">contato@coreohub.com</a></li>
                <li>
                  <a href="https://wa.me/5517981264290" target="_blank" rel="noopener noreferrer" className="hover:text-[#ff0068]">
                    +55 17 98126-4290
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="text-[10px] text-slate-500 leading-relaxed">
              <p className="font-bold text-slate-400 uppercase tracking-widest text-[9px] mb-1">CoreoHub Tecnologia LTDA</p>
              <p>Votuporanga/SP</p>
              <p className="mt-1">Pagamentos processados pela Asaas IP S.A. (CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central.</p>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <Link to="/termos" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Termos de Uso</Link>
              <Link to="/privacidade" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Privacidade</Link>
              <p className="text-[10px] text-slate-600">© {new Date().getFullYear()} CoreoHub. Todos os direitos reservados.</p>
            </div>
          </div>
        </div>
      </footer>

      {/* ─── BOTÃO FLUTUANTE WHATSAPP ──────────────────────────────────────────────── */}
      <a
        href="https://wa.me/5517981264290?text=Ol%C3%A1%2C%20quero%20vender%20ingresso%20do%20espet%C3%A1culo%20de%20fim%20de%20ano%20do%20meu%20est%C3%BAdio"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[#25D366] flex items-center justify-center shadow-[0_8px_24px_rgba(37,211,102,0.45)] hover:scale-105 active:scale-95 transition-transform"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-[#052e16]" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.768.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
        </svg>
      </a>
    </div>
  );
}
