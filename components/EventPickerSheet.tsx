import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Check, ChevronDown, Search } from 'lucide-react';

/**
 * Substitui o `<select>` nativo do Android (que vira bottom sheet feio sem
 * controle) por um picker próprio com:
 * - Bottom sheet em mobile (handle visual + backdrop blur)
 * - Dropdown ancorado em desktop (>= md)
 * - Search quando há 6+ eventos
 *
 * Padrão UX research-backed (sessão D+7 2026-05-20): Uber/Google Maps/Stripe
 * usam bottom sheet pra listas de N items em mobile. Quando lista é grande,
 * search é praticamente obrigatória (Baymard Institute).
 */

export interface EventPickerOption {
  id: string;
  name: string;
  edition_year?: number | null;
  is_demo?: boolean | null;
  start_date?: string | null;
}

interface Props {
  events: EventPickerOption[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  className?: string;
  /** Texto do trigger quando nenhum evento está selecionado. */
  emptyLabel?: string;
}

const formatLabel = (ev: EventPickerOption) =>
  `${ev.edition_year ? `${ev.edition_year} — ` : ''}${ev.name}`;

const EventPickerSheet: React.FC<Props> = ({
  events,
  selectedEventId,
  onSelect,
  className = '',
  emptyLabel = 'Selecionar evento',
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = events.find(e => e.id === selectedEventId) ?? null;
  const showSearch = events.length >= 6;

  // Fecha com Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset search quando fecha
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const filtered = search
    ? events.filter(e => formatLabel(e).toLowerCase().includes(search.toLowerCase()))
    : events;

  const handlePick = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full sm:w-auto inline-flex items-center gap-2 pl-4 pr-3 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-white hover:border-[#ff0068]/40 transition-all"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Calendar size={12} className="text-slate-400 shrink-0" />
        <span className="truncate max-w-[200px] sm:max-w-[280px]">
          {selected ? formatLabel(selected) : emptyLabel}
        </span>
        {selected?.is_demo && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-700 dark:text-amber-300 text-[8px] font-black uppercase tracking-widest">
            DEMO
          </span>
        )}
        <ChevronDown size={12} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop — mobile only (desktop usa click-outside pelo overlay invisível) */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
              onClick={() => setOpen(false)}
            />

            {/* Sheet mobile (bottom) — desktop usa dropdown ancorado */}
            <motion.div
              key="sheet"
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 rounded-t-3xl shadow-2xl flex flex-col md:hidden"
              role="listbox"
            >
              {/* Handle visual (arrastável visualmente — sem lógica drag) */}
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 bg-slate-300 dark:bg-white/20 rounded-full" />
              </div>
              <div className="px-5 pt-2 pb-3 border-b border-slate-100 dark:border-white/5 shrink-0">
                <h3 className="text-sm font-black uppercase tracking-tight italic text-slate-900 dark:text-white">
                  Selecionar evento
                </h3>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {events.length} evento{events.length !== 1 ? 's' : ''} disponíve{events.length !== 1 ? 'is' : 'l'}
                </p>
              </div>
              {showSearch && (
                <div className="px-5 py-3 border-b border-slate-100 dark:border-white/5 shrink-0">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Buscar evento..."
                      autoFocus
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                    />
                  </div>
                </div>
              )}
              <ul className="flex-1 overflow-y-auto py-2">
                {filtered.length === 0 ? (
                  <li className="px-5 py-8 text-center text-[11px] text-slate-500">
                    Nenhum evento encontrado.
                  </li>
                ) : (
                  filtered.map(ev => {
                    const isSelected = ev.id === selectedEventId;
                    return (
                      <li key={ev.id}>
                        <button
                          type="button"
                          onClick={() => handlePick(ev.id)}
                          className={`w-full flex items-center justify-between gap-3 px-5 py-3 text-left transition-colors ${
                            isSelected
                              ? 'bg-[#ff0068]/5'
                              : 'hover:bg-slate-50 dark:hover:bg-white/5'
                          }`}
                        >
                          <span className={`text-sm font-bold truncate flex items-center gap-2 min-w-0 ${
                            isSelected ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'
                          }`}>
                            <span className="truncate">{formatLabel(ev)}</span>
                            {ev.is_demo && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-700 dark:text-amber-300 text-[8px] font-black uppercase tracking-widest">DEMO</span>
                            )}
                          </span>
                          {isSelected && <Check size={16} className="text-[#ff0068] shrink-0" />}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </motion.div>

            {/* Dropdown desktop (md+) — ancorado abaixo do trigger */}
            <motion.div
              key="dropdown"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="hidden md:flex absolute z-50 right-0 top-full mt-2 w-72 max-h-[70vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex-col overflow-hidden"
              role="listbox"
            >
              {showSearch && (
                <div className="px-3 py-2.5 border-b border-slate-100 dark:border-white/5 shrink-0">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Buscar..."
                      autoFocus
                      className="w-full pl-7 pr-2 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                    />
                  </div>
                </div>
              )}
              <ul className="flex-1 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3 py-4 text-center text-[10px] text-slate-500">
                    Nenhum evento encontrado.
                  </li>
                ) : (
                  filtered.map(ev => {
                    const isSelected = ev.id === selectedEventId;
                    return (
                      <li key={ev.id}>
                        <button
                          type="button"
                          onClick={() => handlePick(ev.id)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? 'bg-[#ff0068]/10 text-[#ff0068]'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
                          }`}
                        >
                          <span className="text-[11px] font-black uppercase tracking-widest truncate flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{formatLabel(ev)}</span>
                            {ev.is_demo && (
                              <span className="shrink-0 px-1 py-0.5 rounded bg-amber-400/20 text-amber-700 dark:text-amber-300 text-[7px] font-black tracking-wider">DEMO</span>
                            )}
                          </span>
                          {isSelected && <Check size={11} className="shrink-0" />}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </motion.div>

            {/* Overlay invisível pra click-outside no desktop */}
            <div
              className="hidden md:block fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EventPickerSheet;
