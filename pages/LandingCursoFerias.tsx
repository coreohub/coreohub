/**
 * Landing dedicada a quem vende curso de férias / curso de verão de dança
 * (workshops em formato de camp: passes, aulas avulsas, lotes, hospedagem).
 * Copy aprovada em docs/copy-curso-de-ferias.md (2026-10-31).
 *
 * Preço: quem manda é o plano do evento (events.billing_plan), não o Plano
 * Espetáculo. Workshop NÃO faz parte do Espetáculo (Sidebar esconde
 * /workshops-do-evento nesse plano), então a página fala de Começo/Essencial/
 * Escala e aponta pra /planos. Nada de 7,9% aqui.
 *
 * Só afirma o que existe no código. Fora de propósito: desconto automático por
 * quantidade de cursos (em construção em outra sessão — entra aqui quando for
 * publicado e conferido), preço por duração, desconto de grupo/recorrente,
 * ouvinte, lista de espera e parcelado "sem juros".
 *
 * Segue o molde de LandingEspetaculo.tsx: meta tags nativas React 19, canonical
 * bare coreohub.com, JSON-LD Service+FAQPage, seções alternando claro/escuro.
 * O HTML que bots leem vem de api/og-marketing.ts (page=cursoferias);
 * tests/marketing-faq-parity.test.ts quebra se as FAQs divergirem.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight, Check, X, ChevronDown, ArrowRight, Menu, Layers, TrendingUp,
  CalendarDays, BedDouble, CreditCard, QrCode, HeartHandshake, MessageCircle,
} from 'lucide-react';

const SITE_URL = 'https://coreohub.com';
const CANONICAL_URL = `${SITE_URL}/curso-de-ferias`;
const CREATE_URL = 'https://app.coreohub.com/criar-evento';
const WHATSAPP_URL = 'https://wa.me/5517981264290?text=Ol%C3%A1%2C%20quero%20vender%20meu%20curso%20de%20f%C3%A9rias%20de%20dan%C3%A7a%20pela%20CoreoHub';

const PAGE_TITLE = 'Curso de Férias e de Verão de Dança | CoreoHub';
const PAGE_DESCRIPTION = 'Venda passes, aulas, hospedagem e lotes do seu curso de férias de dança com Pix e cartão, vagas controladas e painel do produtor. Sem mensalidade.';
const OG_TITLE = 'Venda o seu curso de férias de dança com pagamento na hora';
const OG_DESCRIPTION = 'O aluno escolhe as aulas, vê o total e paga na hora. Você acompanha vagas, hospedagem e dinheiro num lugar só. Sem mensalidade.';

export const CURSO_FAQ_ITEMS = [
  {
    q: 'Posso continuar usando meu site, meu Canva ou minha página?',
    a: 'Sim. O link do seu curso na CoreoHub pode ser o botão Garantir vaga da página que você já tem. O aluno compra no checkout da CoreoHub e você não perde a sua vitrine.',
  },
  {
    q: 'Dá para vender passe de semana e aula avulsa no mesmo curso?',
    a: 'Dá. Você cria passes fechados e passes em que o aluno escolhe as aulas que quer, dentro do mínimo e do máximo que você define, e o valor soma. Cada aula mantém a sua própria vaga, presença e certificado.',
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
    a: 'Não há mensalidade. Você escolhe o plano do evento: Começo (10% sobre o vendido, sem taxa fixa), Essencial (R$250 mais 5% sobre o vendido) ou Escala, para eventos grandes (detalhes em coreohub.com/planos). A taxa do plano vale para inscrições, ingressos e workshops do evento. Além dela há a taxa de pagamento (Pix ou cartão), em linha separada no checkout e paga pelo comprador por padrão. A Asaas cobra R$12,90 uma única vez pela abertura da sua conta digital, debitados no primeiro recebimento.',
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

export default function LandingCursoFerias() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        name: 'Venda de curso de férias de dança — CoreoHub',
        description: PAGE_DESCRIPTION,
        provider: { '@type': 'Organization', name: 'CoreoHub', url: SITE_URL },
        areaServed: 'BR',
        serviceType: 'Plataforma de vendas e inscrições para curso de férias e curso de verão de dança',
        offers: {
          '@type': 'Offer',
          description: 'Sem mensalidade. Plano Começo: 10% sobre o valor vendido. Plano Essencial: R$250 mais 5%. Plano Escala para eventos grandes. Mais taxa de pagamento (Pix ou cartão) paga pelo comprador ou assumida pelo produtor',
          priceCurrency: 'BRL',
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: CURSO_FAQ_ITEMS.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };

  const ctaPrimary = 'inline-flex items-center justify-center gap-2 px-8 py-5 bg-[#ff0068] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_20px_60px_rgba(255,0,104,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-transform';
  const ctaSecondary = 'inline-flex items-center justify-center gap-2 px-8 py-5 border border-white/20 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-white/5 transition-colors';

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">
      <title>{PAGE_TITLE}</title>
      <meta name="description" content={PAGE_DESCRIPTION} />
      <meta property="og:title" content={OG_TITLE} />
      <meta property="og:description" content={OG_DESCRIPTION} />
      <meta property="og:image" content={`${SITE_URL}/og-curso-ferias.jpg`} />
      <meta property="og:url" content={CANONICAL_URL} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="CoreoHub" />
      <meta property="og:locale" content="pt_BR" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={OG_TITLE} />
      <meta name="twitter:description" content={OG_DESCRIPTION} />
      <meta name="twitter:image" content={`${SITE_URL}/og-curso-ferias.jpg`} />
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
            <a
              href={CREATE_URL}
              className="px-4 py-2 bg-[#ff0068] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform"
            >
              Criar meu curso →
            </a>
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
              <a
                href={CREATE_URL}
                onClick={() => setMenuOpen(false)}
                className="block w-full text-center px-4 py-3 bg-[#ff0068] text-white rounded-xl text-sm font-black uppercase tracking-widest"
              >
                Criar meu curso →
              </a>
            </div>
          </div>
        )}
      </header>

      {/* ─── 1. HERO (escuro) ──────────────────────────────────────────────── */}
      <section className="relative min-h-[80vh] flex flex-col overflow-hidden bg-black">
        <img
          src="/hero-curso-ferias.webp"
          srcSet="/hero-curso-ferias-mobile.webp 960w, /hero-curso-ferias.webp 1376w"
          sizes="100vw"
          alt=""
          aria-hidden="true"
          width={1376}
          height={768}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover object-[50%_30%]"
        />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.35)_45%,transparent_70%)]" />
        <div className="absolute inset-0 hidden sm:block bg-[linear-gradient(to_right,rgba(0,0,0,0.6)_0%,transparent_65%)]" />
        <div className="relative z-10 flex-1 flex flex-col justify-end px-4 pb-10 pt-28 text-center sm:px-6 sm:text-left lg:px-8">
          <div className="mx-auto max-w-5xl">
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white">Para cursos de férias e cursos de verão de dança</p>
            <h1 className="mt-3 text-[2.1rem] sm:text-[3.4rem] font-black tracking-normal uppercase leading-[1.06] max-w-3xl">
              Seu curso de férias lotado, sem montar pedido no WhatsApp.
            </h1>
            <p className="mt-4 sm:mt-5 text-slate-200 text-base sm:text-lg font-medium leading-snug max-w-2xl">
              O aluno escolhe as aulas, vê o total e paga na hora. Você acompanha vagas, hospedagem e dinheiro num lugar só.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 sm:justify-start">
              <a href={CREATE_URL} className={ctaPrimary}>
                Criar meu curso <ChevronRight size={18} />
              </a>
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={ctaSecondary}>
                <MessageCircle size={18} aria-hidden="true" /> Falar com a gente
              </a>
            </div>
            <p className="mt-5 text-xs text-slate-400">Sem mensalidade. Você paga só quando vende.</p>
          </div>
        </div>
        <div className="relative z-10 max-w-4xl mx-auto w-full grid grid-cols-3 gap-4 border-t border-white/10 px-6 pt-6 pb-8">
          {[
            { val: 'R$ 0', label: 'de mensalidade', icon: Layers },
            { val: 'Pix + cartão', label: 'no checkout', icon: CreditCard },
            { val: 'QR Code', label: 'no check-in do aluno', icon: QrCode },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="text-center flex flex-col items-center">
                <Icon size={26} className="text-[#ff0068] mb-2" aria-hidden="true" />
                <p className="text-xl md:text-3xl font-black text-white tracking-tighter">{s.val}</p>
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
            A <strong className="text-slate-950">CoreoHub</strong> é a plataforma para vender curso de férias e curso de verão de dança:
            passes, aulas avulsas, lotes, vagas por dia e hospedagem num <strong className="text-slate-950">checkout com Pix e cartão</strong>,
            com painel do produtor para acompanhar vendas e vagas. Sem mensalidade: você paga uma taxa sobre o que vender.
          </p>
        </div>
      </section>

      {/* ─── 3. COMO VOCÊ VENDE HOJE (escuro) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="max-w-3xl mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-400 mb-3">Como você vende hoje?</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Reconhece alguma<br />
              <span className="text-rose-400">dessas cenas?</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: 'Formulário e planilha',
                hoje: 'O aluno preenche várias páginas, a vaga só vale depois da confirmação do pagamento e ele não sabe como pagar.',
                com: 'Ele escolhe a aula, paga e a vaga é dele no mesmo momento, numa tela só.',
              },
              {
                title: 'Página bonita e link de pagamento mandado à mão',
                hoje: 'A vitrine vende, mas o pagamento depende de a equipe responder e mandar o link.',
                com: 'O botão Garantir vaga do seu site ou do Canva leva direto ao checkout. Você mantém a sua vitrine.',
              },
              {
                title: 'WhatsApp',
                hoje: 'A equipe monta o pedido, soma o valor, confere o Pix e anota a vaga.',
                com: 'O pedido, o pagamento e a vaga se registram sozinhos, e o painel mostra quem comprou o quê.',
              },
            ].map((c, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-3xl p-6">
                <h3 className="text-lg font-black uppercase tracking-tight text-white">{c.title}</h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mt-5 mb-1">Hoje</p>
                <p className="text-sm text-slate-300 leading-relaxed">{c.hoje}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mt-5 mb-1">Com a CoreoHub</p>
                <p className="text-sm text-white leading-relaxed">{c.com}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 4. O QUE A COREOHUB RESOLVE (claro) ──────────────────────────────────────────────── */}
      <section className="relative bg-white text-slate-900 px-6 py-24 lg:py-32 border-t border-slate-200 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.05),transparent_70%)]" />
        <div className="relative max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">O que a CoreoHub resolve</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-950">
              Feito para o jeito que<br />
              <span className="text-[#ff0068]">curso de férias realmente vende.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Layers,
                title: 'Passes e aulas escolhidas pelo aluno',
                body: 'Pass fechado (semana completa, curso inteiro) ou aulas à la carte: o aluno marca as que quer, dentro do mínimo e do máximo que você define, e o valor soma.',
              },
              {
                icon: TrendingUp,
                title: 'Lotes que viram sozinhos',
                body: 'O preço sobe na data marcada ou quando a cota do lote acaba. A vitrine sempre mostra o preço vigente.',
              },
              {
                icon: CalendarDays,
                title: 'Vagas por turma e por dia',
                body: 'Limite de vagas por aula, teto diário compartilhado entre todos os passes e Day Pass com escolha do dia.',
              },
              {
                icon: BedDouble,
                title: 'Hospedagem e chegada antecipada',
                body: 'Vagas de hospedagem por noite, preferência de colega de quarto e lista de hóspedes em CSV para você fechar com o hotel.',
              },
              {
                icon: CreditCard,
                title: 'Pix e cartão',
                body: 'Parcelado no cartão, liberado por evento. A taxa de pagamento aparece separada antes de o aluno pagar. O split é automático: a sua parte cai na sua conta.',
              },
              {
                icon: QrCode,
                title: 'Do check-in ao certificado',
                body: 'Check-in por QR Code, certificado de participação, cortesias e cupons de desconto.',
              },
            ].map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-3xl p-6 hover:border-[#ff0068]/30 transition-all">
                  <Icon size={24} className="text-[#ff0068] mb-3" aria-hidden="true" />
                  <h3 className="text-base font-black uppercase tracking-tight text-slate-950">{f.title}</h3>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 5. COMO FUNCIONA (escuro) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Como funciona</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">Três passos.</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { num: '01', title: 'Crie o curso', body: 'Cadastre o evento, as aulas, os professores e os passes.' },
              { num: '02', title: 'Divulgue o link', body: 'Ele serve de página de vendas, ou vira o botão Garantir vaga do seu site e do seu Instagram.' },
              { num: '03', title: 'Acompanhe e receba', body: 'Vagas, hospedagem e vendas no painel. O dinheiro vai para a sua conta digital por split automático.' },
            ].map((s, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-3xl p-6">
                <p className="text-5xl font-black tracking-tighter text-[#ff0068]/40 mb-3">{s.num}</p>
                <h3 className="text-xl font-black uppercase tracking-tight">{s.title}</h3>
                <p className="text-sm text-slate-300 mt-2 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 bg-[#ff0068]/10 border border-[#ff0068]/30 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div>
              <p className="text-lg font-black uppercase tracking-tight text-white">Quer ajuda para montar o primeiro curso?</p>
              <p className="text-sm text-slate-300 mt-1 leading-relaxed">A gente configura o primeiro curso com você: passes, lotes, vagas e hospedagem.</p>
            </div>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center justify-center gap-2 px-6 py-4 bg-[#ff0068] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#ff1a7d] transition-colors">
              <MessageCircle size={16} aria-hidden="true" /> Falar com a gente
            </a>
          </div>
        </div>
      </section>

      {/* ─── 6. QUANTO CUSTA (claro) ──────────────────────────────────────────────── */}
      <section className="bg-white text-slate-900 px-6 py-24 lg:py-32 border-t border-slate-200">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Sem letra miúda</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-950">
              Sem mensalidade.<br />Você paga conforme vende.
            </h2>
            <p className="text-slate-600 text-base mt-5 max-w-2xl mx-auto leading-relaxed">
              A taxa do plano vale para inscrições, ingressos e workshops do evento. Você escolhe o plano ao criar o curso.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { nome: 'Começo', val: '10%', det: 'sobre o vendido, sem taxa fixa' },
              { nome: 'Essencial', val: 'R$250 + 5%', det: 'sobre o vendido' },
              { nome: 'Escala', val: 'Eventos grandes', det: 'veja os detalhes na página de planos' },
            ].map((p, i) => (
              <div key={i} className="bg-slate-50 border border-slate-200 rounded-3xl p-6 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{p.nome}</p>
                <p className="text-3xl font-black tracking-tighter text-slate-950 mt-2">{p.val}</p>
                <p className="text-xs text-slate-600 mt-1">{p.det}</p>
              </div>
            ))}
          </div>
          <ul className="mt-8 max-w-2xl mx-auto space-y-2">
            {[
              'Não vendeu, não pagou: sem estoque mínimo e sem risco.',
              'A taxa de pagamento (Pix ou cartão) aparece em linha separada no checkout. Por padrão quem paga é o aluno, e você pode escolher assumir. Em caso de estorno ela é devolvida.',
              'Repasse automático para a sua conta digital, sem fechamento de caixa manual.',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-slate-700">
                <Check size={16} className="text-[#ff0068] shrink-0 mt-1" aria-hidden="true" />
                <span className="text-sm leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 text-center">
            <Link to="/planos" className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest text-[#ff0068] hover:text-[#ff1a7d] transition-colors">
              Ver os planos em detalhe <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── 7. FAQ (escuro) ──────────────────────────────────────────────── */}
      <section className="px-6 py-24 lg:py-32 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-3">Dúvidas frequentes</p>
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase">
              Tudo o que você quer<br />perguntar.
            </h2>
          </div>
          <div className="space-y-2">
            {CURSO_FAQ_ITEMS.map((item, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`curso-faq-panel-${i}`}
                  id={`curso-faq-trigger-${i}`}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-white/5 transition-colors"
                >
                  <span className="text-base font-black uppercase tracking-tight text-white">{item.q}</span>
                  <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div
                    id={`curso-faq-panel-${i}`}
                    role="region"
                    aria-labelledby={`curso-faq-trigger-${i}`}
                    className="px-5 pb-5 -mt-1 text-sm text-slate-300 leading-relaxed"
                  >
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 8. CTA FINAL (escuro) ──────────────────────────────────────────────── */}
      <section className="relative px-6 py-24 lg:py-32 overflow-hidden border-t border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,0,104,0.18),transparent_70%)]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <HeartHandshake size={36} className="text-[#ff0068] mx-auto mb-6" aria-hidden="true" />
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter uppercase leading-[0.95] mb-6">
            Seu próximo curso de férias<br />
            <span className="text-[#ff0068]">pode vender sozinho.</span>
          </h2>
          <p className="text-slate-300 text-xl md:text-2xl max-w-2xl mx-auto leading-relaxed mb-10">
            Crie o curso em minutos e divulgue o link. Se preferir, fale com a gente antes.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4">
            <a href={CREATE_URL} className={ctaPrimary}>
              Criar meu curso <ArrowRight size={18} />
            </a>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={ctaSecondary}>
              <MessageCircle size={18} aria-hidden="true" /> Falar no WhatsApp
            </a>
          </div>
          <p className="text-xs text-slate-500 mt-5">Sem mensalidade · Você só paga quando vende</p>
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
                Venda de curso de férias e curso de verão de dança. Passes, aulas, lotes, hospedagem
                e pagamento num único link.
              </p>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-4">Produto</p>
              <ul className="space-y-2 text-[11px] text-slate-400">
                <li><Link to="/" className="hover:text-[#ff0068]">Plataforma para festivais</Link></li>
                <li><Link to="/planos" className="hover:text-[#ff0068]">Planos e preços</Link></li>
                <li><a href={CREATE_URL} className="hover:text-[#ff0068]">Criar meu curso</a></li>
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
              <p className="font-bold text-slate-400 uppercase tracking-widest text-[9px] mb-1">CoreoHub · uma empresa do Cultural Estúdio</p>
              <p>CNPJ 13.484.650/0001-00 · Votuporanga/SP</p>
              <p className="mt-1">Pagamentos processados pela Asaas IP S.A. (CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central.</p>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <Link to="/sobre" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Sobre</Link>
              <Link to="/termos" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Termos de Uso</Link>
              <Link to="/privacidade" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Privacidade</Link>
              <p className="text-[10px] text-slate-600">© {new Date().getFullYear()} CoreoHub. Todos os direitos reservados.</p>
            </div>
          </div>
        </div>
      </footer>

      {/* ─── BOTÃO FLUTUANTE WHATSAPP ──────────────────────────────────────────────── */}
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[#25D366] flex items-center justify-center shadow-[0_8px_24px_rgba(37,211,102,0.45)] hover:scale-105 active:scale-95 transition-transform"
      >
        <MessageCircle size={26} className="text-[#052e16]" aria-hidden="true" />
      </a>
    </div>
  );
}
