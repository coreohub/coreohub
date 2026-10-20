import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const TITLE = 'Sobre a CoreoHub — quem está por trás e o que a plataforma faz';
const DESCRIPTION =
  'A CoreoHub é a plataforma de gestão para festivais e mostras de dança. Fundada em 2026 por Ticko Bboy, é uma empresa do Cultural Estúdio, de Votuporanga/SP.';

const Sobre: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = TITLE;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.getAttribute('content') ?? null;
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    meta.setAttribute('content', DESCRIPTION);

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
    const prevCanonical = canonical.href;
    canonical.href = 'https://coreohub.com/sobre';

    return () => {
      document.title = prevTitle;
      if (prevDesc !== null) meta!.setAttribute('content', prevDesc);
      canonical!.href = prevCanonical || 'https://coreohub.com/';
    };
  }, []);

  const card = 'bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8';
  const eyebrow = 'text-[10px] font-black uppercase tracking-widest text-[#FF0068] mb-3';
  const body = 'text-sm md:text-base text-slate-300 leading-relaxed';
  const ext = 'text-white font-bold underline underline-offset-4 decoration-[#FF0068] hover:text-[#FF0068] transition-colors';

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-[#ff0068]/30 overflow-x-hidden">
      {/* ─── NAV (mesmo padrão da home) ─────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 bg-slate-950/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/coreohub-avatar.webp" alt="CoreoHub" width={32} height={32} className="w-8 h-8" />
            <span className="text-sm font-black uppercase tracking-tight text-white">CoreoHub</span>
          </Link>
          <nav className="flex items-center gap-4 sm:gap-6">
            <Link to="/festivais" className="hidden sm:inline text-xs font-bold text-slate-300 hover:text-white transition-colors">Festivais</Link>
            <Link to="/planos" className="hidden sm:inline text-xs font-bold text-slate-300 hover:text-white transition-colors">Planos</Link>
            <Link
              to="/planos"
              className="px-4 py-2 bg-[#ff0068] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform"
            >
              Ver planos →
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ─── HERO ─────────────────────────────────────────── */}
        <section className="relative pt-32 pb-16 px-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
            style={{ background: 'radial-gradient(60% 60% at 50% 0%, rgba(255,0,104,0.18) 0%, rgba(2,6,23,0) 70%)' }}
          />
          <div className="relative max-w-3xl mx-auto">
            <span className="inline-block text-[10px] font-black tracking-widest uppercase text-[#FF0068] px-3 py-1.5 bg-[#FF0068]/10 border border-[#FF0068]/30 rounded-lg mb-5">
              Sobre a CoreoHub
            </span>
            <h1 className="font-black text-4xl md:text-6xl uppercase tracking-tighter italic leading-[0.95] mb-6">
              Gestão inteligente para <span className="text-[#FF0068]">festivais de dança</span>
            </h1>
            <p className="text-base md:text-lg text-slate-300 leading-relaxed">
              A CoreoHub é uma plataforma online que reúne, num único lugar, tudo o que um festival ou mostra
              de dança precisa: inscrições, pagamentos, júri digital, cronograma, bilheteria, check-in e
              certificados.
            </p>
          </div>
        </section>

        {/* ─── CONTEÚDO ─────────────────────────────────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <article className={card}>
                <h2 className={eyebrow}>O que faz</h2>
                <p className={body}>
                  O produtor cadastra o evento, recebe as inscrições com pagamento por Pix, cartão ou boleto (nos eventos que o oferecem)
                  (com repasse automático), conduz a avaliação com jurados por tablet, mesmo sem internet no
                  local, monta o cronograma com detecção de conflito de bailarino, vende ingressos e emite
                  os certificados com QR Code de validação.
                </p>
              </article>
              <article className={card}>
                <h2 className={eyebrow}>Para quem</h2>
                <p className={body}>
                  Para produtores de festivais, mostras e competições de dança, e para estúdios e escolas que
                  fazem espetáculo de fim de ano e querem vender ingresso. Do lado de quem participa:
                  inscritos, jurados e público.
                </p>
              </article>
            </div>

            {/* Quem está por trás — com foto */}
            <article className={`${card} overflow-hidden`}>
              <div className="grid md:grid-cols-5 gap-8 items-center">
                <div className="md:col-span-2">
                  <img
                    src="/ticko-bboy.webp"
                    alt="Ticko Bboy, fundador da CoreoHub, com microfone e boné vermelho em palco"
                    width={800}
                    height={1000}
                    loading="lazy"
                    className="w-full max-w-xs mx-auto md:max-w-none rounded-2xl object-cover aspect-[4/5] border border-white/10"
                  />
                </div>
                <div className="md:col-span-3">
                  <h2 className={eyebrow}>Quem está por trás</h2>
                  <h3 className="font-black text-2xl uppercase tracking-tighter italic mb-3">Ticko Bboy</h3>
                  <p className={body}>
                    A CoreoHub foi fundada em 2026 por{' '}
                    <a href="https://ticko.com.br/" target="_blank" rel="noopener noreferrer" className={ext}>Ticko Bboy</a>,
                    artista e empreendedor há mais de 25 anos, de Votuporanga (SP), com atuação nas danças
                    urbanas, MBA em Dança: Gestão e Produção Cultural e apresentações no Brasil, Portugal,
                    Equador, França e Argentina.
                  </p>
                  <p className={`${body} mt-3`}>
                    Ele também fundou a{' '}
                    <a href="https://usualdance.com/" target="_blank" rel="noopener noreferrer" className={ext}>Usualdance</a>,
                    marca de dança de Votuporanga, e é fundador do{' '}
                    <a href="https://culturalestudio.com.br/" target="_blank" rel="noopener noreferrer" className={ext}>Cultural Estúdio</a>,
                    empresa da qual a CoreoHub faz parte.
                  </p>
                </div>
              </div>
            </article>

            <div className="grid md:grid-cols-2 gap-6">
              <article className={card}>
                <h2 className={eyebrow}>Como funciona o preço</h2>
                <p className={body}>
                  Sem mensalidade. A CoreoHub ganha uma comissão sobre o que o evento vende. Os planos e as
                  taxas estão em{' '}
                  <Link to="/planos" className={ext}>Planos</Link>.
                </p>
              </article>
              <article className={card}>
                <h2 className={eyebrow}>Dados da empresa</h2>
                <p className={body}>
                  CoreoHub, uma empresa do Cultural Estúdio
                  <br />
                  CNPJ 13.484.650/0001-00 · Votuporanga/SP
                  <br />
                  <a href="https://wa.me/5517997936169" target="_blank" rel="noopener noreferrer" className={ext}>Fale pelo WhatsApp</a>
                </p>
                {/* Endereço completo e telefone fixo entram aqui quando forem definidos. */}
              </article>
            </div>

            {/* CTA */}
            <div className="text-center pt-6">
              <Link
                to="/criar-evento"
                className="inline-block px-8 py-4 bg-[#ff0068] text-white rounded-2xl text-sm font-black uppercase tracking-widest hover:scale-105 transition-transform"
              >
                Cadastrar meu evento →
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ─── FOOTER (mesmo texto da home) ───────────────────── */}
      <footer className="px-6 py-10 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="text-[10px] text-slate-500 leading-relaxed">
            <p className="font-bold text-slate-400 uppercase tracking-widest text-[9px] mb-1">CoreoHub · uma empresa do Cultural Estúdio</p>
            <p>CNPJ 13.484.650/0001-00 · Votuporanga/SP</p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <Link to="/termos" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Termos de Uso</Link>
            <Link to="/privacidade" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Privacidade</Link>
            <p className="text-[10px] text-slate-600">© {new Date().getFullYear()} CoreoHub. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Sobre;
