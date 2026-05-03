/**
 * EventAnchorNav — sticky anchor menu da vitrine pública (Etapa 1.5).
 *
 * Padrão validado em RD Summit, Web Summit, Lollapalooza:
 * - Aparece só após rolar 80vh (não polui o hero)
 * - Background backdrop-blur com transparência
 * - Smooth scroll com offset (compensa altura do header sticky)
 * - IntersectionObserver pra highlight da seção ativa
 * - Mobile: chips horizontais com scroll lateral
 *
 * Recebe lista filtrada de seções visíveis (caller decide quais existem).
 */

import React, { useEffect, useRef, useState } from 'react';

export interface AnchorSection {
  id: string;     // id do <section> alvo
  label: string;  // exibido no menu
}

interface EventAnchorNavProps {
  sections: AnchorSection[];
  /** ID da section que dispara o sticky quando sai do viewport. Default: 'hero' */
  triggerSectionId?: string;
  /** CTA opcional no canto direito (ex: botão "Comprar ingresso") */
  cta?: React.ReactNode;
}

const HEADER_HEIGHT = 64; // px — usado pra offset do scroll

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
            // Considera "ativa" a section que tem >50% visível na metade superior
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

/** Hook: detecta se passou da section trigger (pra mostrar/esconder o nav) */
function useScrolledPast(triggerId: string): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = document.getElementById(triggerId);
    if (!el) {
      // Se não tem trigger, ativa imediatamente
      setScrolled(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [triggerId]);

  return scrolled;
}

export const EventAnchorNav: React.FC<EventAnchorNavProps> = ({
  sections,
  triggerSectionId = 'hero',
  cta,
}) => {
  const activeId = useActiveSection(sections.map(s => s.id));
  const isVisible = useScrolledPast(triggerSectionId);
  const navRef = useRef<HTMLElement>(null);

  // Smooth scroll com offset
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT - 8;
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', `#${id}`);
  };

  // Auto-scroll do nav horizontal pra manter item ativo visível
  useEffect(() => {
    if (!navRef.current || !activeId) return;
    const activeEl = navRef.current.querySelector<HTMLAnchorElement>(`a[href="#${activeId}"]`);
    if (activeEl) {
      const navRect = navRef.current.getBoundingClientRect();
      const elRect = activeEl.getBoundingClientRect();
      if (elRect.left < navRect.left || elRect.right > navRect.right) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeId]);

  if (sections.length === 0) return null;

  return (
    <nav
      ref={navRef}
      aria-label="Navegação do evento"
      className={`sticky top-0 z-40 transition-all duration-300 ${
        isVisible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 -translate-y-full pointer-events-none'
      }`}
      style={{ height: HEADER_HEIGHT }}
    >
      <div className="h-full bg-[#0b0b0f]/85 backdrop-blur-xl border-b border-white/10 flex items-center">
        <div className="max-w-5xl mx-auto w-full px-4 flex items-center gap-4">
          {/* Lista horizontal de itens (scroll lateral em mobile) */}
          <div className="flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] -mx-4 px-4">
            <ul className="flex items-center gap-1 min-w-max">
              {sections.map(s => {
                const isActive = activeId === s.id;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      onClick={e => handleClick(e, s.id)}
                      className={`relative inline-flex items-center px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors whitespace-nowrap ${
                        isActive
                          ? 'text-[#ff0068]'
                          : 'text-slate-400 hover:text-white'
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
          {cta && <div className="shrink-0">{cta}</div>}
        </div>
      </div>
    </nav>
  );
};
