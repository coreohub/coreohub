import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const TITLE = 'Sobre a CoreoHub — quem está por trás e o que a plataforma faz';
const DESCRIPTION =
  'A CoreoHub é a plataforma de gestão para festivais e mostras de dança no Brasil. Fundada em 2026 por Ticko Bboy, artista com mais de 25 anos nas danças urbanas, é uma empresa do Cultural Estúdio, de Votuporanga/SP.';

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
  const h2 = 'text-[10px] font-black uppercase tracking-widest text-[#FF0068] mb-3';

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      <header className="sticky top-0 z-50 bg-black/90 backdrop-blur border-b border-white/10 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-black text-xl uppercase tracking-wide">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF0068] shrink-0" />
            CoreoHub
          </Link>
          <Link to="/" className="text-sm font-semibold text-white/70 hover:text-white transition-colors">
            ← Voltar ao site
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-24">
        <div className="py-16 border-b border-white/10">
          <span className="inline-block text-[10px] font-bold tracking-[0.18em] uppercase text-[#FF0068] px-3 py-1.5 bg-[#FF0068]/10 border border-[#FF0068]/30 rounded mb-4">
            Sobre
          </span>
          <h1 className="font-black text-4xl md:text-5xl uppercase tracking-tighter italic mb-4">
            Gestão inteligente para festivais de dança
          </h1>
          <p className="text-base text-white/70 leading-relaxed">
            A CoreoHub é uma plataforma online que reúne, num único lugar, tudo o que um festival ou mostra
            de dança precisa: inscrições, pagamentos, júri digital, cronograma, bilheteria, check-in e
            certificados.
          </p>
        </div>

        <div className="space-y-6 pt-10">
          <section className={card}>
            <h2 className={h2}>O que faz</h2>
            <p className="text-sm text-white/70 leading-relaxed">
              O produtor cadastra o evento, recebe as inscrições com pagamento por Pix, cartão ou boleto
              (com repasse automático), conduz a avaliação com jurados por tablet, mesmo sem internet no
              local, monta o cronograma com detecção de conflito de bailarino, vende ingressos e emite
              os certificados com QR Code de validação.
            </p>
          </section>

          <section className={card}>
            <h2 className={h2}>Para quem</h2>
            <p className="text-sm text-white/70 leading-relaxed">
              Para produtores de festivais, mostras e competições de dança, e para estúdios e escolas que
              fazem espetáculo de fim de ano e querem vender ingresso. Do lado de quem participa: inscritos,
              jurados e público.
            </p>
          </section>

          <section className={card}>
            <h2 className={h2}>Quem está por trás</h2>
            <p className="text-sm text-white/70 leading-relaxed">
              A CoreoHub foi fundada em 2026 por{' '}
              <a href="https://ticko.com.br/" target="_blank" rel="noopener noreferrer" className="text-white font-bold underline underline-offset-4">Ticko Bboy</a>,
              artista e empreendedor há mais de 25 anos, de Votuporanga (SP), com atuação nas danças urbanas,
              MBA em Dança: Gestão e Produção Cultural e apresentações no Brasil, Portugal, Equador, França e
              Argentina.
            </p>
            <p className="text-sm text-white/70 leading-relaxed mt-3">
              Ele também fundou a{' '}
              <a href="https://usualdance.com/" target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-4">Usualdance</a>,
              marca de dança de Votuporanga, e é fundador do{' '}
              <a href="https://culturalestudio.com.br/" target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-4">Cultural Estúdio</a>,
              empresa da qual a CoreoHub faz parte.
            </p>
          </section>

          <section className={card}>
            <h2 className={h2}>Como funciona o preço</h2>
            <p className="text-sm text-white/70 leading-relaxed">
              Sem mensalidade. A CoreoHub ganha uma comissão sobre o que o evento vende. Os planos e as taxas
              estão em <Link to="/planos" className="text-white underline underline-offset-4">Planos</Link>.
            </p>
          </section>

          <section className={card}>
            <h2 className={h2}>Dados da empresa</h2>
            <p className="text-sm text-white/70 leading-relaxed">
              CoreoHub, uma empresa do Cultural Estúdio · CNPJ 13.484.650/0001-00 · Votuporanga/SP ·{' '}
              <a href="https://wa.me/5517997936169" target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-4">Fale pelo WhatsApp</a>
            </p>
            {/* Endereço completo e telefone fixo entram aqui quando forem definidos. */}
          </section>
        </div>
      </main>
    </div>
  );
};

export default Sobre;
