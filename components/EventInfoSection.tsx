import { INFO_SECTIONS, hasInfoContent, type InfoConfig } from '../utils/eventInfo';

/**
 * Seção pública "Informações e regras" (fim da vitrine): seções fixas do
 * produtor + perguntas frequentes em <details> nativo (acessível e sem JS).
 * Só é montada pela página quando há conteúdo (o menu de âncoras também).
 */
export default function EventInfoSection({ info }: { info: InfoConfig }) {
  if (!hasInfoContent(info)) return null;
  const secoes = INFO_SECTIONS.filter(s => (info.secoes[s.key] ?? '').trim());

  return (
    <div id="informacoes" className="space-y-6 scroll-mt-20">
      <h2 className="text-2xl font-black uppercase tracking-tighter">Informações e regras</h2>

      {secoes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {secoes.map(s => (
            <div key={s.key} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-2">{s.titulo}</h3>
              <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-line">{info.secoes[s.key]}</p>
            </div>
          ))}
        </div>
      )}

      {info.faq.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-300">Perguntas frequentes</h3>
          {info.faq.map((f, i) => (
            <details key={i} className="group bg-white/5 border border-white/10 rounded-2xl">
              <summary className="cursor-pointer list-none px-5 py-4 text-sm font-bold text-white flex items-center justify-between gap-3">
                <span>{f.pergunta}</span>
                <span aria-hidden="true" className="text-slate-500 text-lg leading-none transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="px-5 pb-4 text-sm text-slate-400 leading-relaxed whitespace-pre-line">{f.resposta}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
