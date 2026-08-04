import React, { useState, useRef, useEffect } from 'react';

/** Combobox com busca pra lista de cidades de um UF. Lista de municípios de
 *  estados grandes (SP tem 645) é inviável num <select> nativo — digitar
 *  filtra as opções, clique/Enter seleciona. Sem dependência externa. */
interface CitySearchSelectProps {
  id?: string;
  value: string;
  onChange: (city: string) => void;
  options: string[];
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  className: string;
  'aria-label'?: string;
}

export default function CitySearchSelect({
  id, value, onChange, options, disabled, loading, placeholder, className, ...aria
}: CitySearchSelectProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Mantém o texto exibido em sincronia quando o value muda por fora
  // (ex: troca de UF zera a cidade, ou hidratação inicial do banco).
  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const onClickOutside = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onClickOutside);
    return () => document.removeEventListener('pointerdown', onClickOutside);
  }, []);

  const filtered = query.trim()
    ? options.filter(o => o.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 50)
    : options.slice(0, 50);

  const select = (city: string) => {
    onChange(city);
    setQuery(city);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        {...aria}
        value={query}
        disabled={disabled}
        placeholder={loading ? 'Carregando cidades...' : placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) select(filtered[highlight]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        className={className}
      />
      {open && !disabled && !loading && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-lg py-1">
          {filtered.map((city, i) => (
            <li key={city}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => select(city)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  i === highlight
                    ? 'bg-[#ff0068]/10 text-[#ff0068]'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                {city}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && query.trim() && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-lg px-3 py-2 text-[11px] text-slate-400">
          Nenhuma cidade encontrada
        </div>
      )}
    </div>
  );
}
