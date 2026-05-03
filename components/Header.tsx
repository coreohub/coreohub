import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Moon, Sun, ChevronDown, Check, User, Sparkles, LogOut } from 'lucide-react';
import { UserRole, Profile as UserProfile } from '../types';
import { getInitials } from '../utils/formatters';
import BrandIcon from './BrandIcon';
import { supabase } from '../services/supabase';

interface HeaderProps {
  toggleSidebar: () => void;
  profile: UserProfile;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeRole: UserRole | null;
  setActiveRole: (role: UserRole) => void;
}

const ROLE_OPTIONS: { role: UserRole; label: string; color: string }[] = [
  { role: UserRole.COREOHUB_ADMIN, label: 'Super Admin', color: '#ff0068' },
  { role: UserRole.ORGANIZER,        label: 'Produtor',    color: '#8b5cf6' },
  { role: UserRole.STAFF,            label: 'Equipe',      color: '#0ea5e9' },
  { role: UserRole.JUDGE,            label: 'Jurado',      color: '#f59e0b' },
  { role: UserRole.USER,             label: 'Inscrito',    color: '#10b981' },
  { role: UserRole.SPECTATOR,        label: 'Espectador',  color: '#64748b' },
];

const Header = ({ toggleSidebar, profile, theme, toggleTheme, activeRole, setActiveRole }: HeaderProps) => {
  const navigate = useNavigate();
  const isSuperAdmin = profile?.role === UserRole.COREOHUB_ADMIN;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const activeOption = ROLE_OPTIONS.find(o => o.role === activeRole) ?? ROLE_OPTIONS[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <header className="h-16 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 sticky top-0 z-50 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <button onClick={toggleSidebar} className="lg:hidden p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl border border-slate-200 dark:border-white/5 transition-all">
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <BrandIcon size={32} />
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

        {/* User menu — dropdown com perfil/demo/logout. Avatar mostra foto se
            profile.avatar_url existir; senao iniciais (fallback). */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(v => !v)}
            className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl pl-2 pr-1 py-1 transition-colors"
            aria-label="Menu do usuário"
          >
            <div className="hidden sm:flex flex-col items-end mr-1">
              <span className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-tight max-w-[140px] truncate">
                {profile?.full_name || 'Usuário'}
              </span>
              <span
                className="text-[8px] font-black uppercase tracking-widest"
                style={{ color: activeOption.color }}
              >
                {activeOption.label}
              </span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-0.5 shadow-lg overflow-hidden">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.full_name ?? 'Avatar'}
                  className="w-full h-full object-cover rounded-[10px]"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#ff0068] bg-[#ff0068]/10 rounded-[10px] font-black text-xs border border-[#ff0068]/20">
                  {getInitials(profile?.full_name || 'U')}
                </div>
              )}
            </div>
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5">
                <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight truncate">
                  {profile?.full_name || 'Usuário'}
                </p>
                <p className="text-[9px] text-slate-400 truncate mt-0.5">
                  {profile?.email ?? ''}
                </p>
              </div>
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left"
              >
                <User size={14} className="text-slate-500" />
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">Meu Perfil</span>
              </button>
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/account-settings?tab=Demo'); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left"
                title="Recriar ou remover o evento de demonstração"
              >
                <Sparkles size={14} className="text-amber-500" />
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">Modo Demo</span>
              </button>
              <div className="border-t border-slate-100 dark:border-white/5">
                <button
                  onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 transition-colors text-left text-slate-600 dark:text-slate-300"
                >
                  <LogOut size={14} />
                  <span className="text-[11px] font-bold">Sair</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
