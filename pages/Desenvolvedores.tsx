import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const TITLE = 'CoreoHub API — documentação para desenvolvedores';
const DESCRIPTION =
  'CoreoHub API v1: leitura pública e gratuita dos eventos de dança da vitrine, em JSON, com OpenAPI, versionamento e política de depreciação.';

const Code: React.FC<{ children: string }> = ({ children }) => (
  <pre className="bg-black/60 border border-white/10 rounded-2xl p-4 text-xs md:text-sm text-slate-200 overflow-x-auto"><code>{children}</code></pre>
);

const Desenvolvedores: React.FC = () => {
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
    canonical.href = 'https://coreohub.com/desenvolvedores';

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
            <Link to="/contato" className="px-4 py-2 bg-[#ff0068] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform">
              Falar com a equipe →
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
              API v1
            </span>
            <h1 className="font-black text-4xl md:text-6xl uppercase tracking-tighter italic leading-[0.95] mb-6">
              <span className="text-[#FF0068]">CoreoHub</span> API
            </h1>
            <p className="text-base md:text-lg text-slate-300 leading-relaxed">
              Leitura pública e gratuita dos eventos de dança que aparecem na vitrine da CoreoHub, em JSON, sem chave
              e sem cadastro. Especificação OpenAPI em{' '}
              <a href="/openapi.json" className={ext}>coreohub.com/openapi.json</a>.
            </p>
          </div>
        </section>

        <section className="px-6 pb-20">
          <div className="max-w-3xl mx-auto space-y-6">
            <article className={card}>
              <h2 className={eyebrow}>Endpoints</h2>
              <p className={body}>
                Base: <code>https://coreohub.com/api/v1</code>. Só aceita <code>GET</code>.
              </p>
              <ul className={`${body} list-disc pl-5 mt-3 space-y-1`}>
                <li><code>GET /eventos</code>: lista os eventos públicos. Parâmetros: <code>limit</code> (1 a 100, padrão 50) e <code>offset</code> (padrão 0).</li>
                <li><code>GET /eventos/{'{slug}'}</code>: um evento público pelo slug.</li>
              </ul>
              <div className="mt-4">
                <Code>{`curl -s "https://coreohub.com/api/v1/eventos?limit=2"`}</Code>
              </div>
            </article>

            <article className={card}>
              <h2 className={eyebrow}>Autenticação e dados expostos</h2>
              <p className={body}>
                Não há autenticação: a API só devolve o que já é público na vitrine (nome, descrição, capa, datas, local e
                link do evento). Inscrições, pagamentos, notas do júri e dados de inscritos não são acessíveis por esta
                API. Não existe, por enquanto, API com chave ou OAuth de terceiros. Para integrar algo além da leitura
                pública, fale com a equipe em <a href="mailto:contato@coreohub.com" className={ext}>contato@coreohub.com</a>.
              </p>
            </article>

            <article className={card}>
              <h2 className={eyebrow}>Erros em JSON</h2>
              <p className={body}>Todo erro devolve o status HTTP correspondente e um corpo JSON com código, mensagem e dica de solução.</p>
              <div className="mt-4">
                <Code>{`{
  "error": "invalid_parameter",
  "message": "O parâmetro \\"limit\\" deve ser um número inteiro entre 1 e 100.",
  "hint": "Use limit de 1 a 100 (padrão 50).",
  "status": 400
}`}</Code>
              </div>
              <p className={`${body} mt-3`}>Códigos: <code>invalid_parameter</code> (400), <code>not_found</code> (404), <code>method_not_allowed</code> (405), <code>upstream_error</code> (502) e <code>service_unavailable</code> (503).</p>
            </article>

            <article className={card}>
              <h2 className={eyebrow}>Versionamento e depreciação</h2>
              <ul className={`${body} list-disc pl-5 space-y-1`}>
                <li>A versão vai no caminho (<code>/api/v1</code>) e em toda resposta, no cabeçalho <code>X-API-Version</code>.</li>
                <li>Mudanças que não quebram (campo novo, endpoint novo) entram na mesma versão. Mudança que quebra vira <code>/api/v2</code>.</li>
                <li>Uma versão antiga continua no ar por pelo menos 90 dias depois do aviso de depreciação.</li>
                <li>Quando uma versão for depreciada, as respostas dela passam a trazer os cabeçalhos <code>Deprecation</code> e <code>Sunset</code> (com a data de desligamento), e o aviso também aparece nesta página e no <a href="/llms.txt" className={ext}>llms.txt</a>.</li>
              </ul>
            </article>

            <article className={card}>
              <h2 className={eyebrow}>Para agentes de IA</h2>
              <p className={body}>
                Todas as páginas públicas respondem em Markdown na mesma URL com <code>Accept: text/markdown</code>.
                O guia de uso está em <a href="/llms.txt" className={ext}>llms.txt</a> e o mapa do site em{' '}
                <a href="/sitemap.xml" className={ext}>sitemap.xml</a>.
              </p>
            </article>
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
            <Link to="/contato" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Contato</Link>
            <Link to="/termos" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Termos de Uso</Link>
            <Link to="/privacidade" className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Privacidade</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Desenvolvedores;
