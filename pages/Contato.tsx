import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const TITLE = 'Contato — fale com a CoreoHub';
const DESCRIPTION =
  'Fale com a CoreoHub por WhatsApp ou e-mail: dúvidas sobre planos, cadastro de evento, pagamentos e suporte para produtores de dança.';

const Contato: React.FC = () => {
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
    canonical.href = 'https://coreohub.com/contato';

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
        <section className="relative pt-32 pb-16 px-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
            style={{ background: 'radial-gradient(60% 60% at 50% 0%, rgba(255,0,104,0.18) 0%, rgba(2,6,23,0) 70%)' }}
          />
          <div className="relative max-w-3xl mx-auto">
            <span className="inline-block text-[10px] font-black tracking-widest uppercase text-[#FF0068] px-3 py-1.5 bg-[#FF0068]/10 border border-[#FF0068]/30 rounded-lg mb-5">
              Contato
            </span>
            <h1 className="font-black text-4xl md:text-6xl uppercase tracking-tighter italic leading-[0.95] mb-6">
              Fale com a <span className="text-[#FF0068]">CoreoHub</span>
            </h1>
            <p className="text-base md:text-lg text-slate-300 leading-relaxed">
              Atendimento em todo o Brasil para produtores de festivais, mostras e espetáculos de dança,
              estúdios e órgãos públicos. Sem ticket e sem central: a conversa é direta com a equipe.
            </p>
          </div>
        </section>

        <section className="px-6 pb-20">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <article className={card}>
                <h2 className={eyebrow}>WhatsApp</h2>
                <p className={body}>
                  O canal mais rápido, inclusive na semana do seu evento.
                  <br />
                  <a href="https://wa.me/5517997936169" target="_blank" rel="noopener noreferrer" className={ext}>(17) 99793-6169</a>
                </p>
              </article>
              <article className={card}>
                <h2 className={eyebrow}>E-mail</h2>
                <p className={body}>
                  Para assuntos que pedem texto, documento ou anexo.
                  <br />
                  <a href="mailto:contato@coreohub.com" className={ext}>contato@coreohub.com</a>
                </p>
              </article>
            </div>

            <article className={card}>
              <h2 className={eyebrow}>O que informar na primeira mensagem</h2>
              <p className={body}>
                O tipo de evento (festival, mostra, espetáculo de estúdio, curso de férias ou edital público),
                a data, a cidade e o número aproximado de inscritos ou de público. Com isso a equipe responde
                com o plano certo e os próximos passos. Quem prefere cadastrar sozinho pode{' '}
                <Link to="/criar-evento" className={ext}>criar o evento agora</Link>.
              </p>
            </article>

            <div className="grid md:grid-cols-2 gap-6">
              <article className={card}>
                <h2 className={eyebrow}>Dados da empresa</h2>
                <p className={body}>
                  CoreoHub, uma empresa do Cultural Estúdio
                  <br />
                  CNPJ 13.484.650/0001-00 · Votuporanga/SP
                </p>
              </article>
              <article className={card}>
                <h2 className={eyebrow}>Redes</h2>
                <p className={body}>
                  <a href="https://www.instagram.com/coreohub/" target="_blank" rel="noopener noreferrer" className={ext}>Instagram @coreohub</a>
                  <br />
                  <a href="https://www.youtube.com/@CoreoHub" target="_blank" rel="noopener noreferrer" className={ext}>YouTube CoreoHub</a>
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="px-6 py-10 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="text-[10px] text-slate-500 leading-relaxed">
            <p className="font-bold text-slate-400 uppercase tracking-widest text-[9px] mb-1">CoreoHub · uma empresa do Cultural Estúdio</p>
            <p>CNPJ 13.484.650/0001-00 · Votuporanga/SP</p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <Link to="/sobre" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Sobre</Link>
            <Link to="/termos" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Termos de Uso</Link>
            <Link to="/privacidade" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Privacidade</Link>
            <p className="text-[10px] text-slate-600">© {new Date().getFullYear()} CoreoHub. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Contato;
