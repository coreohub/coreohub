import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { supabaseUrl } from '@/services/supabase';
import { maskTelefoneBR, unmaskTelefoneBR } from '@/utils/masks';

const WHATSAPP_NUMBER = '5517981264290';
const WHATSAPP_DISPLAY = '+55 17 98126-4290';

const waLink = (text: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

type FaixaPlano = 'comeco' | 'essencial' | 'escala';

interface Plan {
  id: FaixaPlano;
  nome: string;
  precoLinha: React.ReactNode;
  precoDetalhe: string;
  compensa: string;
  paraQuem: string;
  frase: string;
  ctaLabel: string;
  ctaHref: string;
  ctaExternal?: boolean; // true = WhatsApp (nova aba); false/undefined = leva pro cadastro (mesma aba)
}

const PLANOS: Plan[] = [
  {
    id: 'comeco',
    nome: 'Começo',
    precoLinha: <><span className="text-4xl font-black text-[#ff0068]">10%</span><span className="text-lg font-bold text-slate-500">sobre venda</span></>,
    precoDetalhe: 'Sem taxa fixa por evento.',
    compensa: 'R$ 0,00 mínimo · só paga se vender',
    paraQuem: 'Mostras e festivais iniciantes — eventos pequenos que ainda não sabem quanto vão vender.',
    frase: '"Tire o seu festival do papel sem gastar nada. A CoreoHub cresce junto com você."',
    ctaLabel: 'Quero este plano',
    ctaHref: 'https://app.coreohub.com/criar-evento?plano=comeco',
  },
  {
    id: 'essencial',
    nome: 'Essencial',
    precoLinha: <><span className="text-3xl md:text-4xl font-black text-white">R$ 250</span><span className="text-lg font-bold text-slate-500">+</span><span className="text-4xl font-black text-[#ff0068]">5%</span></>,
    precoDetalhe: 'Taxa fixa por evento + sobre venda.',
    compensa: 'Compensa a partir de R$ 5.000 em vendas',
    paraQuem: 'Festivais regionais, mostras de dança e eventos de porte médio — de 50 participantes até milhares.',
    frase: '"Seu evento cresceu? Sua taxa efetiva diminui. Um custo fixo que cabe no bolso."',
    ctaLabel: 'Quero este plano',
    ctaHref: 'https://app.coreohub.com/criar-evento?plano=essencial',
  },
  {
    id: 'escala',
    nome: 'Escala',
    precoLinha: <><span className="text-3xl md:text-4xl font-black text-white">R$ 1.490</span><span className="text-lg font-bold text-slate-500">+</span><span className="text-2xl font-black text-[#ff0068]">R$ 2</span><span className="text-xs font-bold text-slate-500 self-end mb-1">por participante</span></>,
    precoDetalhe: 'Teto de 4,5% do faturamento — nunca paga mais que isso.',
    compensa: 'Compensa a partir de R$ 124 mil em vendas',
    paraQuem: 'Festivais de grande porte, convenções nacionais e competições com milhares de bailarinos inscritos.',
    frase: '"A estrutura premium completa da CoreoHub, com teto de taxa garantido. Previsibilidade total pra sua gestão."',
    ctaLabel: 'Quero este plano',
    ctaHref: waLink('Olá! Quero falar sobre o plano Escala da CoreoHub.'),
    ctaExternal: true,
  },
];

const PLANOS_TITLE = 'Planos e preços — CoreoHub';
const PLANOS_DESCRIPTION =
  'Começo (10% sobre venda, sem taxa fixa), Essencial (R$250 + 5%) ou Escala (R$1.490 + R$2/participante, teto de 4,5%). Sem mensalidade — você paga proporcional ao que o festival fatura.';

const fmtBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

const Planos: React.FC = () => {
  // SEO próprio da página (SPA não muda o head estático sozinha — mesmo
  // padrão de Festivais.tsx). Cobre Googlebot (renderiza JS); bots que não
  // rodam JS (preview social, crawlers de IA) já ganham a versão correta
  // via rewrite pro api/og-marketing?page=planos (vercel.json).
  useEffect(() => {
    const prevTitle = document.title;
    document.title = PLANOS_TITLE;

    const setMeta = (name: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      const prev = el?.getAttribute('content') ?? null;
      if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
      el.setAttribute('content', content);
      return prev;
    };
    const prevDesc = setMeta('description', PLANOS_DESCRIPTION);

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
    const prevCanonical = canonical.href;
    canonical.href = 'https://coreohub.com/planos';

    return () => {
      document.title = prevTitle;
      if (prevDesc !== null) setMeta('description', prevDesc);
      canonical!.href = prevCanonical;
    };
  }, []);

  // ─── Simulação (docs/pricing-model-spec.md, seção "Calculadora pública") ──
  const [calcCoreografias, setCalcCoreografias] = useState(40);
  const [calcMediaBailarinos, setCalcMediaBailarinos] = useState(5);
  const [calcTicket, setCalcTicket] = useState(50); // por participante — mesma base usada pra calibrar as faixas dos planos

  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadNome, setLeadNome] = useState('');
  const [leadWhatsapp, setLeadWhatsapp] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);

  const calcParticipantes = Math.round(calcCoreografias * calcMediaBailarinos);
  const calcFaturamento = calcParticipantes * calcTicket;

  const valorComeco = calcFaturamento * 0.10;
  const valorEssencial = 250 + calcFaturamento * 0.05;
  const valorEscala = 1490 + Math.min(calcParticipantes * 2, calcFaturamento * 0.045);
  const valoresPorFaixa: Record<FaixaPlano, number> = { comeco: valorComeco, essencial: valorEssencial, escala: valorEscala };

  // O cliente escolhe o plano — isso só recomenda pelo porte estimado
  // (docs/pricing-model-spec.md, seção "Mecanismo de cobrança").
  const faixaRecomendada: FaixaPlano =
    calcParticipantes <= 100 ? 'comeco' : calcParticipantes <= 2500 ? 'essencial' : 'escala';
  const nomeRecomendado = PLANOS.find((p) => p.id === faixaRecomendada)?.nome ?? '';

  const submitCalculatorLead = async () => {
    setLeadError(null);
    const nome = leadNome.trim();
    const whatsappDigits = unmaskTelefoneBR(leadWhatsapp);
    const emailTrimmed = leadEmail.trim();
    if (!nome) { setLeadError('Digite o nome do festival.'); return; }
    if (whatsappDigits.length < 10) { setLeadError('Digite um WhatsApp válido com DDD.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setLeadError('Digite um e-mail válido.'); return; }

    setLeadSubmitting(true);
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/submit-calculator-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_festival: nome,
          whatsapp: whatsappDigits,
          email: emailTrimmed,
          numero_coreografias: calcCoreografias,
          media_bailarinos_coreografia: calcMediaBailarinos,
          ticket_medio: calcTicket,
          participantes_estimados: calcParticipantes,
          faturamento_estimado: calcFaturamento,
          faixa_recomendada: faixaRecomendada,
          valor_estimado: valoresPorFaixa[faixaRecomendada],
          origem: document.referrer || 'direct',
        }),
      });
      if (!resp.ok) throw new Error('request_failed');
      setLeadSubmitted(true);
    } catch {
      setLeadError('Não conseguimos salvar agora. Tente de novo ou chama no WhatsApp direto.');
    } finally {
      setLeadSubmitting(false);
    }
  };

  const leadWhatsappMessage = encodeURIComponent(
    `Olá! Simulei meu festival na CoreoHub: ${calcCoreografias} coreografias, ~${calcParticipantes} participantes, faturamento estimado ${fmtBRL(calcFaturamento)}. Plano recomendado: ${nomeRecomendado}. Nome do festival: ${leadNome || '(não informado)'}.`
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">

      {/* ─── HEADER ──────────────────────────────────────────────── */}
      <header className="px-6 py-4 border-b border-white/10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/coreohub-avatar.webp" alt="CoreoHub" width={32} height={32} className="w-8 h-8" />
            <span className="text-sm font-black uppercase tracking-tight text-white">CoreoHub</span>
          </Link>
          <a
            href="https://app.coreohub.com/login"
            className="text-xs font-bold text-slate-300 hover:text-white transition-colors"
          >
            Entrar
          </a>
        </div>
      </header>

      {/* ─── HERO ──────────────────────────────────────────────── */}
      <section className="px-6 pt-20 pb-8 lg:pt-28 lg:pb-12">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#ff0068] mb-4">Planos</p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-4xl md:text-6xl font-black tracking-tighter uppercase italic leading-[0.98]"
          >
            Preço que cresce <span className="text-[#ff0068]">junto</span> com seu festival
          </motion.h1>
          <p className="mt-6 text-slate-300 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
            Sem mensalidade. Você paga uma taxa proporcional ao que o seu evento realmente fatura.
          </p>
        </div>
      </section>

      {/* ─── SIMULAÇÃO ──────────────────────────────────────────────── */}
      <section className="px-6 pb-16">
        <div className="max-w-4xl mx-auto bg-gradient-to-br from-[#ff0068]/10 via-white/5 to-purple-700/10 border border-white/10 rounded-3xl p-6 md:p-10 backdrop-blur-xl">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-6 text-center md:text-left">Simule seu festival</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
            <div className="text-left">
              <label htmlFor="calc-coreografias" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Nº de coreografias: <span className="text-[#ff0068] font-mono">{calcCoreografias}</span>
              </label>
              <input
                id="calc-coreografias"
                type="range" min={5} max={500} step={5}
                value={calcCoreografias}
                onChange={(e) => setCalcCoreografias(Number(e.target.value))}
                aria-label="Número de coreografias inscritas"
                aria-valuetext={`${calcCoreografias} coreografias`}
                className="w-full mt-2 accent-[#ff0068]"
              />
              <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                <span>5</span><span>500</span>
              </div>
            </div>
            <div className="text-left">
              <label htmlFor="calc-bailarinos" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Média de bailarinos/coreografia: <span className="text-[#ff0068] font-mono">{calcMediaBailarinos}</span>
              </label>
              <input
                id="calc-bailarinos"
                type="range" min={1} max={15} step={1}
                value={calcMediaBailarinos}
                onChange={(e) => setCalcMediaBailarinos(Number(e.target.value))}
                aria-label="Média de bailarinos por coreografia"
                aria-valuetext={`${calcMediaBailarinos} bailarinos em média`}
                className="w-full mt-2 accent-[#ff0068]"
              />
              <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                <span>1 (solo)</span><span>15 (grupão)</span>
              </div>
            </div>
            <div className="text-left">
              <label htmlFor="calc-ticket" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Ticket médio por bailarino: <span className="text-[#ff0068] font-mono">{fmtBRL(calcTicket)}</span>
              </label>
              <input
                id="calc-ticket"
                type="range" min={20} max={150} step={5}
                value={calcTicket}
                onChange={(e) => setCalcTicket(Number(e.target.value))}
                aria-label="Ticket médio por bailarino inscrito"
                aria-valuetext={fmtBRL(calcTicket)}
                className="w-full mt-2 accent-[#ff0068]"
              />
              <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                <span>R$ 20</span><span>R$ 150</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-400 text-center md:text-left" aria-live="polite">
            ≈ <span className="text-white font-bold tabular-nums">{calcParticipantes}</span> participantes estimados ·
            faturamento estimado <span className="text-white font-bold tabular-nums">{fmtBRL(calcFaturamento)}</span> ·
            plano recomendado <span className="text-[#ff0068] font-black uppercase">{nomeRecomendado}</span> (destacado abaixo)
          </p>

          {!leadSubmitted ? (
            !showLeadForm ? (
              <div className="text-center md:text-left">
                <button
                  type="button"
                  onClick={() => setShowLeadForm(true)}
                  className="mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#ff0068] text-white rounded-xl text-sm font-black uppercase tracking-widest hover:bg-[#ff1a7d] transition-colors"
                >
                  Receber essa simulação <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="mt-6 text-left bg-white/5 border border-white/10 rounded-2xl p-5">
                <p className="text-white text-sm font-bold mb-4">
                  Deixa seu contato que a gente te chama com a proposta certinha pro plano {nomeRecomendado}.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="lead-nome" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nome do festival</label>
                    <input
                      id="lead-nome"
                      type="text"
                      value={leadNome}
                      onChange={(e) => setLeadNome(e.target.value)}
                      placeholder="Ex: Festival de Dança de..."
                      className="w-full mt-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#ff0068]"
                    />
                  </div>
                  <div>
                    <label htmlFor="lead-whatsapp" className="text-[10px] font-black uppercase tracking-widest text-slate-400">WhatsApp</label>
                    <input
                      id="lead-whatsapp"
                      type="tel"
                      inputMode="numeric"
                      value={leadWhatsapp}
                      onChange={(e) => setLeadWhatsapp(maskTelefoneBR(e.target.value))}
                      placeholder="(17) 98126-4290"
                      className="w-full mt-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#ff0068]"
                    />
                  </div>
                  <div>
                    <label htmlFor="lead-email" className="text-[10px] font-black uppercase tracking-widest text-slate-400">E-mail</label>
                    <input
                      id="lead-email"
                      type="email"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      placeholder="voce@email.com"
                      className="w-full mt-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#ff0068]"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-3">Mandamos essa simulação em detalhes pro seu e-mail também.</p>
                {leadError && <p className="text-rose-400 text-xs mt-3">{leadError}</p>}
                <button
                  type="button"
                  onClick={submitCalculatorLead}
                  disabled={leadSubmitting}
                  className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 bg-[#ff0068] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#ff1a7d] transition-colors disabled:opacity-50"
                >
                  {leadSubmitting ? 'Enviando...' : 'Enviar simulação'}
                </button>
              </div>
            )
          ) : (
            <div className="mt-6 text-left bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5" aria-live="polite">
              <p className="text-emerald-400 text-sm font-bold">Recebemos sua simulação! 🎉</p>
              <p className="text-slate-300 text-sm mt-1">
                Mandamos o resumo em detalhes pro seu e-mail. Nosso time também entra em contato no WhatsApp pra fechar os detalhes da sua proposta.
              </p>
              <a
                href={`https://wa.me/5517981264290?text=${leadWhatsappMessage}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 px-5 py-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-colors"
              >
                Falar agora no WhatsApp <ArrowRight size={14} />
              </a>
            </div>
          )}
        </div>
      </section>

      {/* ─── CARDS ──────────────────────────────────────────────── */}
      <section className="px-6 pb-24">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {PLANOS.map((p) => {
            const isRecomendado = p.id === faixaRecomendada;
            return (
              <div
                key={p.nome}
                className={`relative flex flex-col rounded-3xl border p-7 transition-all ${
                  isRecomendado
                    ? 'border-[#ff0068]/60 bg-gradient-to-b from-[#ff0068]/10 via-white/5 to-transparent shadow-[0_24px_60px_-30px_rgba(255,0,104,0.55)] md:-translate-y-2'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                {isRecomendado && (
                  <span className="absolute -top-3 left-7 bg-[#ff0068] text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full">
                    Recomendado pro seu evento
                  </span>
                )}
                <h2 className={`text-2xl font-black uppercase italic tracking-tight mb-6 ${isRecomendado ? 'text-[#ff1a7d]' : 'text-white'}`}>
                  {p.nome}
                </h2>

                <div className="flex items-baseline gap-2 flex-wrap mb-1">{p.precoLinha}</div>
                <p className="text-xs text-slate-400 mb-4">{p.precoDetalhe}</p>

                <span className="inline-flex self-start items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#E3FF0A] bg-[#E3FF0A]/10 border border-[#E3FF0A]/25 rounded-full px-3 py-1.5 mb-3">
                  {p.compensa}
                </span>

                <p className="text-xs text-slate-400 mb-6">
                  Pro seu festival simulado: <span className={`font-bold tabular-nums ${isRecomendado ? 'text-white' : 'text-slate-300'}`}>{fmtBRL(valoresPorFaixa[p.id])}</span>
                </p>

                <hr className="border-white/10 mb-5" />

                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Para quem é</p>
                <p className="text-sm text-slate-300 leading-relaxed mb-5 min-h-[76px]">{p.paraQuem}</p>

                <p className="text-xs italic text-slate-400 leading-relaxed border-l-2 border-white/15 pl-3 mb-6">{p.frase}</p>

                <a
                  href={p.ctaHref}
                  {...(p.ctaExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className={`mt-auto flex items-center justify-center gap-2 text-center rounded-2xl px-5 py-4 text-xs font-black uppercase tracking-widest transition-transform hover:scale-[1.02] active:scale-[0.98] ${
                    isRecomendado
                      ? 'bg-[#ff0068] text-white shadow-[0_16px_40px_rgba(255,0,104,0.35)]'
                      : 'bg-white/5 border border-white/15 text-white hover:bg-white/10'
                  }`}
                >
                  {p.ctaExternal ? <MessageCircle size={16} /> : <ArrowRight size={16} />} {p.ctaLabel}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <footer className="px-6 py-12 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/coreohub-avatar.webp" alt="CoreoHub" className="w-10 h-10" />
              <div>
                <p className="text-base font-black uppercase tracking-tighter text-white">CoreoHub</p>
                <p className="text-[10px] text-slate-500">Gestão Inteligente para Festivais e Mostras de Dança</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <Link to="/" className="hover:text-[#ff0068]">Início</Link>
              <a href="mailto:contato@coreohub.com" className="hover:text-[#ff0068]">contato@coreohub.com</a>
              <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#ff0068]">
                {WHATSAPP_DISPLAY}
              </a>
            </div>
          </div>
          <p className="text-[10px] text-slate-600 text-center mt-8">
            © {new Date().getFullYear()} CoreoHub. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Planos;
