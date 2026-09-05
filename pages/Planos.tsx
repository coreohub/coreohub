import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { motion } from 'motion/react';

const WHATSAPP_NUMBER = '5517981264290';
const WHATSAPP_DISPLAY = '+55 17 98126-4290';

const waLink = (text: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

interface Plan {
  nome: string;
  tag?: string;
  featured?: boolean;
  precoLinha: React.ReactNode;
  precoDetalhe: string;
  compensa: string;
  paraQuem: string;
  frase: string;
  ctaLabel: string;
  ctaHref: string;
}

const PLANOS: Plan[] = [
  {
    nome: 'Começo',
    precoLinha: <><span className="text-4xl font-black text-[#ff0068]">10%</span><span className="text-lg font-bold text-slate-500">sobre venda</span></>,
    precoDetalhe: 'Sem taxa fixa por evento.',
    compensa: 'R$ 0,00 mínimo · só paga se vender',
    paraQuem: 'Mostras e festivais iniciantes — eventos pequenos que ainda não sabem quanto vão vender.',
    frase: '"Tire o seu festival do papel sem gastar nada. A CoreoHub cresce junto com você."',
    ctaLabel: 'Quero este plano',
    ctaHref: waLink('Olá! Quero o plano Começo da CoreoHub.'),
  },
  {
    nome: 'Essencial',
    tag: 'Mais escolhido',
    featured: true,
    precoLinha: <><span className="text-3xl md:text-4xl font-black text-white">R$ 250</span><span className="text-lg font-bold text-slate-500">+</span><span className="text-4xl font-black text-[#ff0068]">5%</span></>,
    precoDetalhe: 'Taxa fixa por evento + sobre venda.',
    compensa: 'Compensa a partir de R$ 5.000 em vendas',
    paraQuem: 'Festivais regionais, mostras de dança e eventos de porte médio — de 50 participantes até milhares.',
    frase: '"Seu evento cresceu? Sua taxa efetiva diminui. Um custo fixo que cabe no bolso."',
    ctaLabel: 'Quero este plano',
    ctaHref: waLink('Olá! Quero o plano Essencial da CoreoHub.'),
  },
  {
    nome: 'Escala',
    precoLinha: <><span className="text-3xl md:text-4xl font-black text-white">R$ 1.490</span><span className="text-lg font-bold text-slate-500">+</span><span className="text-2xl font-black text-[#ff0068]">R$ 2</span><span className="text-xs font-bold text-slate-500 self-end mb-1">por participante</span></>,
    precoDetalhe: 'Teto de 4,5% do faturamento — nunca paga mais que isso.',
    compensa: 'Compensa a partir de R$ 124 mil em vendas',
    paraQuem: 'Festivais de grande porte, convenções nacionais e competições com milhares de bailarinos inscritos — referência: porte Joinville, o maior festival de dança do mundo.',
    frase: '"A estrutura premium completa da CoreoHub, com teto de taxa garantido. Previsibilidade total pra sua gestão."',
    ctaLabel: 'Quero este plano',
    ctaHref: waLink('Olá! Quero falar sobre o plano Escala da CoreoHub.'),
  },
];

const Planos: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Planos — CoreoHub';
    return () => { document.title = prevTitle; };
  }, []);

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

      {/* ─── CARDS ──────────────────────────────────────────────── */}
      <section className="px-6 pb-24">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {PLANOS.map((p) => (
            <div
              key={p.nome}
              className={`relative flex flex-col rounded-3xl border p-7 ${
                p.featured
                  ? 'border-[#ff0068]/60 bg-gradient-to-b from-[#ff0068]/10 via-white/5 to-transparent shadow-[0_24px_60px_-30px_rgba(255,0,104,0.55)] md:-translate-y-2'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              {p.tag && (
                <span className="absolute -top-3 left-7 bg-[#ff0068] text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full">
                  {p.tag}
                </span>
              )}
              <h2 className={`text-2xl font-black uppercase italic tracking-tight mb-6 ${p.featured ? 'text-[#ff1a7d]' : 'text-white'}`}>
                {p.nome}
              </h2>

              <div className="flex items-baseline gap-2 flex-wrap mb-1">{p.precoLinha}</div>
              <p className="text-xs text-slate-400 mb-4">{p.precoDetalhe}</p>

              <span className="inline-flex self-start items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#E3FF0A] bg-[#E3FF0A]/10 border border-[#E3FF0A]/25 rounded-full px-3 py-1.5 mb-6">
                {p.compensa}
              </span>

              <hr className="border-white/10 mb-5" />

              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Para quem é</p>
              <p className="text-sm text-slate-300 leading-relaxed mb-5 min-h-[76px]">{p.paraQuem}</p>

              <p className="text-xs italic text-slate-400 leading-relaxed border-l-2 border-white/15 pl-3 mb-6">{p.frase}</p>

              <a
                href={p.ctaHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-auto flex items-center justify-center gap-2 text-center rounded-2xl px-5 py-4 text-xs font-black uppercase tracking-widest transition-transform hover:scale-[1.02] active:scale-[0.98] ${
                  p.featured
                    ? 'bg-[#ff0068] text-white shadow-[0_16px_40px_rgba(255,0,104,0.35)]'
                    : 'bg-white/5 border border-white/15 text-white hover:bg-white/10'
                }`}
              >
                <MessageCircle size={16} /> {p.ctaLabel}
              </a>
            </div>
          ))}
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
