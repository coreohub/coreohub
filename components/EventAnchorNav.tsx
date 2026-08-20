/**
 * EventAnchorNav — anchor menu fixo da vitrine pública (Etapa 1.5, refeito 2026-08-18).
 *
 * Padrão de landing page de conferência/festival (não de checkout de ingresso
 * tipo Sympla, que não tem esse menu) — 2 comportamentos diferentes por
 * dispositivo, cada um correto no seu contexto:
 *
 * - MOBILE: régua horizontal rolável com fade nas bordas (padrão
 *   Instagram/YouTube chips) — arrastar com o dedo é um gesto natural em
 *   touchscreen, então "esconder" o resto rolando é descoberta óbvia.
 * - DESKTOP: mouse não tem esse affordance de arrastar uma barra de menu.
 *   Pesquisa de mercado (conference/festival landing pages) confirmou: nav
 *   fixa nunca deve passar de ~5 itens visíveis, o resto entra num dropdown
 *   "Mais" de CLIQUE (nunca uma faixa rolável — isso lê como "escondido").
 *   Mede em runtime quantos itens cabem (ResizeObserver + linha de medição
 *   invisível) — não trava num número fixo, já que cada evento liga/desliga
 *   seções diferentes. CTA fica sempre isolado, nunca dividindo espaço com
 *   a navegação.
 *
 * Comuns aos dois: sempre visível no topo (position: fixed), semi-transparente
 * sobre o hero e opaco depois de rolar; smooth scroll com offset; seção ativa
 * destacada via IntersectionObserver.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import BrandIcon from './BrandIcon';

export interface AnchorSection {
  id: string;     // id do <section> alvo
  label: string;  // exibido no menu
  /** Maior = fica visível por mais tempo quando o espaço aperta (removido
   *  por último). Default 0. Seções que geram receita (Ingressos, Inscrições,
   *  Workshops) usam 1 — nunca somem pro dropdown "Mais" antes de seções só
   *  informativas (Sobre, Local, Jurados...), mesmo vindo depois na ordem
   *  visual. */
  priority?: number;
}

interface EventAnchorNavProps {
  sections: AnchorSection[];
  /** CTA opcional no canto direito (ex: botão "Inscreva-se") */
  cta?: React.ReactNode;
}

export const HEADER_HEIGHT = 64; // px — usado pra offset do scroll (exportado pra CTAs externos reusarem o mesmo offset)
const GAP = 4; // px — mesmo valor do gap-1 usado nas pílulas
const DESKTOP_QUERY = '(min-width: 640px)'; // breakpoint sm do Tailwind

const PILL_CLASS = 'inline-flex items-center px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-colors';

/** Hook: retorna o id da seção atualmente mais visível no viewport */
function useActiveSection(sectionIds: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (sectionIds.length === 0) return;

    const observers = sectionIds
      .map(id => {
        const el = document.getElementById(id);
        if (!el) return null;
        const obs = new IntersectionObserver(
          ([entry]) => {
            if (entry.isIntersecting) setActive(id);
          },
          {
            // rootMargin define a "viewport efetiva":
            // - top -64px: desconta a altura do nav fixo (não conta o que está atrás dele)
            // - bottom -50%: section vira ativa quando entra na metade superior do viewport
            rootMargin: `-${HEADER_HEIGHT}px 0px -50% 0px`,
            threshold: [0, 0.25, 0.5, 1],
          }
        );
        obs.observe(el);
        return obs;
      })
      .filter(Boolean) as IntersectionObserver[];

    return () => observers.forEach(o => o.disconnect());
  }, [sectionIds.join(',')]);

  return active;
}

/** Hook: detecta se rolou um pouco da página (pra dar fundo opaco vs transparente) */
function useScrolled(threshold = 80): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return scrolled;
}

/** Hook: true quando o viewport bate o breakpoint desktop (mouse, não touch-scroll) */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

/**
 * Hook: quantos itens cabem na largura disponível antes de precisar do
 * botão "Mais". Mede uma linha invisível idêntica (mesmas classes, logo
 * mesma largura real) e recalcula em resize — nunca corta palavra no meio.
 * Só relevante no ramo desktop (refs ficam null e o hook não faz nada no
 * ramo mobile, que usa scroll horizontal em vez de overflow calculado).
 */
function useOverflowSections(sections: AnchorSection[], active: boolean) {
  const outerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());
  const sectionsKey = sections.map(s => `${s.id}:${s.priority ?? 0}`).join(',');

  const recalc = useCallback(() => {
    const outer = outerRef.current;
    const measure = measureRef.current;
    if (!outer || !measure) return;

    const available = outer.clientWidth;
    const itemEls = Array.from(measure.querySelectorAll<HTMLElement>('[data-item]'));
    const moreEl = measure.querySelector<HTMLElement>('[data-more]');
    const moreWidth = moreEl ? moreEl.offsetWidth + GAP : 0;

    if (itemEls.length === 0 || itemEls.length !== sections.length) {
      setOverflowIds(new Set());
      return;
    }

    const widths = itemEls.map(el => el.offsetWidth + GAP);
    const totalWidth = widths.reduce((sum, w) => sum + w, 0);
    if (totalWidth <= available) {
      setOverflowIds(new Set());
      return;
    }

    // Ordem de remoção: menor prioridade primeiro; empate desempata pelo item
    // mais à direita na ordem visual (mantém o início da régua estável).
    // Continua removendo, do menos importante pro mais importante, até o que
    // sobrar (+ o botão "Mais") caber — nunca corta palavra no meio, e itens
    // de alta prioridade (receita) só saem se não houver mais nada de baixa
    // prioridade pra tirar antes.
    const removalOrder = sections
      .map((s, i) => ({ id: s.id, i, priority: s.priority ?? 0 }))
      .sort((a, b) => (a.priority - b.priority) || (b.i - a.i));

    let remaining = totalWidth;
    const removed = new Set<string>();
    for (const cand of removalOrder) {
      if (remaining + moreWidth <= available) break;
      remaining -= widths[cand.i];
      removed.add(cand.id);
    }
    setOverflowIds(removed);
  }, [sectionsKey]);

  useEffect(() => {
    if (!active) return;
    recalc();
    const ro = new ResizeObserver(() => recalc());
    if (outerRef.current) ro.observe(outerRef.current);
    window.addEventListener('resize', recalc);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalc);
    };
  }, [recalc, active]);

  return { outerRef, measureRef, overflowIds };
}

export const EventAnchorNav: React.FC<EventAnchorNavProps> = ({
  sections,
  cta,
}) => {
  const activeId = useActiveSection(sections.map(s => s.id));
  const scrolled = useScrolled(80);
  const isDesktop = useIsDesktop();
  const { outerRef, measureRef, overflowIds } = useOverflowSections(sections, isDesktop);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  const visible = isDesktop ? sections.filter(s => !overflowIds.has(s.id)) : sections;
  const overflow = isDesktop ? sections.filter(s => overflowIds.has(s.id)) : [];
  const activeInOverflow = overflow.some(s => s.id === activeId);

  // Smooth scroll com offset
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT - 8;
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', `#${id}`);
    setMoreOpen(false);
  };

  // Fecha o dropdown "Mais" ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  // Mobile: auto-scroll do nav horizontal pra manter item ativo visível
  useEffect(() => {
    if (isDesktop || !mobileNavRef.current || !activeId) return;
    const activeEl = mobileNavRef.current.querySelector<HTMLAnchorElement>(`a[href="#${activeId}"]`);
    if (activeEl) {
      const navRect = mobileNavRef.current.getBoundingClientRect();
      const elRect = activeEl.getBoundingClientRect();
      if (elRect.left < navRect.left || elRect.right > navRect.right) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeId, isDesktop]);

  if (sections.length === 0) return null;

  return (
    <nav
      aria-label="Navegação do evento"
      className="fixed top-0 left-0 right-0 z-40 transition-all duration-300"
      style={{ height: HEADER_HEIGHT }}
    >
      <div className={`h-full backdrop-blur-xl border-b flex items-center transition-colors duration-300 ${
        scrolled
          ? 'bg-[#0b0b0f]/90 border-white/10'
          : 'bg-[#0b0b0f]/40 border-white/5'
      }`}>
        <div className="max-w-5xl mx-auto w-full px-4 flex items-center gap-3">
          {/* Marca no canto superior esquerdo — padrão de mercado (toda nav
              fixa de landing de evento/conferência tem a marca à esquerda;
              essa barra não tinha nenhuma, só os itens de menu + CTA).
              Link externo pro site institucional, mesmo destino já usado
              pelo "CoreoHub" do breadcrumb logo acima nesta mesma página. */}
          <a
            href="https://coreohub.com"
            className="shrink-0 flex items-center gap-1.5"
            aria-label="CoreoHub"
          >
            <BrandIcon size={22} />
            <span className="hidden sm:block text-[10px] font-black uppercase tracking-tighter text-white">
              Coreo<span className="text-[#ff0068]">Hub</span>
            </span>
          </a>

          {isDesktop ? (
            <>
              {/* Desktop: itens visíveis nunca rolam, nunca cortam no meio.
                  O que não couber vai pro dropdown "Mais". */}
              <div ref={outerRef} className="flex-1 min-w-0 overflow-hidden">
                <ul className="flex items-center gap-1">
                  {visible.map(s => {
                    const isActive = activeId === s.id;
                    return (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          onClick={e => handleClick(e, s.id)}
                          className={`relative ${PILL_CLASS} ${
                            isActive ? 'text-[#ff0068]' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {s.label}
                          {isActive && (
                            <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-[#ff0068] rounded-full" />
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {overflow.length > 0 && (
                <div ref={moreRef} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setMoreOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                    className={`${PILL_CLASS} gap-1 ${
                      activeInOverflow ? 'text-[#ff0068]' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Mais
                    <ChevronDown size={12} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {moreOpen && (
                    <div
                      role="menu"
                      className="absolute top-full right-0 mt-2 min-w-[10rem] py-1.5 rounded-xl border border-white/10 bg-[#0b0b0f]/95 backdrop-blur-xl shadow-2xl z-50"
                    >
                      {overflow.map(s => {
                        const isActive = activeId === s.id;
                        return (
                          <a
                            key={s.id}
                            href={`#${s.id}`}
                            role="menuitem"
                            onClick={e => handleClick(e, s.id)}
                            className={`block px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                              isActive ? 'text-[#ff0068]' : 'text-slate-300 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            {s.label}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Mobile: régua horizontal rolável, fade nas bordas sinaliza
               overflow (padrão Instagram/YouTube chips — arrastar é um
               gesto natural em touchscreen). */
            <div
              ref={mobileNavRef}
              className="flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] -mx-4 px-4"
              style={{
                maskImage: 'linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)',
              }}
            >
              <ul className="flex items-center gap-1 min-w-max">
                {visible.map(s => {
                  const isActive = activeId === s.id;
                  return (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        onClick={e => handleClick(e, s.id)}
                        className={`relative ${PILL_CLASS} ${
                          isActive ? 'text-[#ff0068]' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {s.label}
                        {isActive && (
                          <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-[#ff0068] rounded-full" />
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* CTA — sempre isolado, nunca divide espaço com a navegação */}
          {cta && <div className="shrink-0 flex items-center gap-2">{cta}</div>}
        </div>
      </div>

      {/* Linha de medição invisível (só usada no ramo desktop) — mesmas
          classes dos itens reais, então offsetWidth bate exato com o que
          vai renderizar de verdade. Deslocada pra ESQUERDA (não pra cima)
          — técnica canônica de "fora da tela mas medível": um offset
          vertical não impede a linha de alargar o scrollWidth horizontal
          da página quando ela é mais larga que a viewport (exatamente o
          cenário em que "Mais" precisa entrar em ação). */}
      {isDesktop && (
        <div
          ref={measureRef}
          aria-hidden="true"
          className="absolute top-0 -left-[9999px] flex items-center pointer-events-none"
          style={{ gap: GAP }}
        >
          {sections.map(s => (
            <span key={s.id} data-item className={PILL_CLASS}>{s.label}</span>
          ))}
          <span data-more className={`${PILL_CLASS} gap-1`}>
            Mais
            <ChevronDown size={12} />
          </span>
        </div>
      )}
    </nav>
  );
};
