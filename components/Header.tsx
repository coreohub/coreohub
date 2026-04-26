import React, { useState, useRef, useEffect } from 'react';
import { Menu, Music, Moon, Sun, ChevronDown, Check } from 'lucide-react';
import { UserRole, Profile as UserProfile } from '../types';
import { getInitials } from '../utils/formatters';

interface HeaderProps {
  toggleSidebar: () => void;
  profile: UserProfile;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeRole: UserRole | null;
  setActiveRole: (role: UserRole) => void;
}

const ROLE_OPTIONS: { role: UserRole; label: string; color: string }[] = [
  { role: UserRole.USUALDANCE_ADMIN, label: 'Super Admin', color: '#ff0068' },
  { role: UserRole.ORGANIZER,        label: 'Produtor',    color: '#8b5cf6' },
  { role: UserRole.STAFF,            label: 'Equipe',      color: '#0ea5e9' },
  { role: UserRole.JUDGE,            label: 'Jurado',      color: '#f59e0b' },
  { role: UserRole.USER,             label: 'Inscrito',    color: '#10b981' },
  { role: UserRole.SPECTATOR,        label: 'Espectador',  color: '#64748b' },
];

const Header = ({ toggleSidebar, profile, theme, toggleTheme, activeRole, setActiveRole }: HeaderProps) => {
  const isSuperAdmin = profile?.role === UserRole.USUALDANCE_ADMIN;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeOption = ROLE_OPTIONS.find(o => o.role === activeRole) ?? ROLE_OPTIONS[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <header className="h-16 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 sticky top-0 z-50 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <button onClick={toggleSidebar} className="lg:hidden p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl border border-slate-200 dark:border-white/5 transition-all">
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#ff0068] rounded-lg flex items-center justify-center text-white shadow-md shadow-[#ff0068]/20">
            <Music size={16} />
          </div>
          <span className="text-xs font-black uppercase tracking-tighter text-slate-900 dark:text-white hidden sm:block">
            Coreo<span className="text-[#ff0068]">Hub</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isSuperAdmin && (
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-white/5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10">
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 hidden md:block">Visão</span>

            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(v => !v)}
                className="flex items-center gap-1.5 focus:outline-none"
              >
                <span
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: activeOption.color }}
                >
                  {activeOption.label}
                </span>
                <ChevronDown size={12} className="text-slate-400" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl overflow-hidden z-50">
                  {ROLE_OPTIONS.map(option => {
                    const isSelected = activeRole === option.role;
                    return (
                      <button
                        key={option.role}
                        onClick={() => { setActiveRole(option.role); setDropdownOpen(false); }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 transition-all text-left ${
                          isSelected
                            ? 'bg-slate-100 dark:bg-white/10'
                            : 'hover:bg-slate-50 dark:hover:bg-white/5'
                        }`}
                      >
                        <span
                          className="text-[10px] font-black uppercase tracking-widest"
                          style={{ color: isSelected ? option.color : undefined }}
                        >
                          {option.label}
                        </span>
                        {isSelected && <Check size={12} style={{ color: option.color }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <button onClick={toggleTheme} className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl border border-slate-200 dark:border-white/5 transition-all">
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <div className="flex flex-col items-end mr-1">
          <span className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-tight">{profile?.full_name || 'Usuário'}</span>
          <span
            className="text-[8px] font-black uppercase tracking-widest"
            style={{ color: activeOption.color }}
          >
            {activeOption.label}
          </span>
        </div>
        <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-0.5 shadow-lg">
          <div className="w-full h-full flex items-center justify-center text-[#ff0068] bg-[#ff0068]/10 rounded-[10px] font-black text-xs border border-[#ff0068]/20">
            {getInitials(profile?.full_name || 'U')}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
