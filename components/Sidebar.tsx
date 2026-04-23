import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Calendar,
  Music, Gavel, QrCode,
  LogOut, Award, UserCircle,
  Ticket, Tv, Trophy,
  BarChart2, UserCheck,
  ClipboardList, ShieldCheck, Mic2, Settings,
  Clapperboard, UserRound, Music2,
  PersonStanding, Headphones, Filter, CreditCard,
  Video, FileSearch,
} from 'lucide-react';
import { UserRole, Profile as UserProfile, PermissoesCustom } from '../types';

interface SidebarProps {
  isOpen: boolean;
  toggle: () => void;
  onLogout: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeRole: UserRole | null;
  profile: UserProfile | null;
  videoSelectionEnabled: boolean;
}

type MenuItem = {
  path: string;
  label: string;
  icon: React.ElementType;
  roles?: UserRole[];
};

type MenuSection = {
  section: string;
  roles?: UserRole[];
  items: MenuItem[];
};

const ALL_ORGANIZER = [UserRole.ORGANIZER, UserRole.USUALDANCE_ADMIN];
const ALL_JUDGE     = [UserRole.JUDGE, UserRole.USUALDANCE_ADMIN];
const ALL_USER      = [UserRole.USER, UserRole.STUDIO_DIRECTOR, UserRole.CHOREOGRAPHER, UserRole.INDEPENDENT, UserRole.TEAM, UserRole.SPECTATOR, UserRole.USUALDANCE_ADMIN];

// Equipe operacional — todos os sub-roles + organizer + admin
const ALL_EQUIPE = [
  UserRole.COORDENADOR, UserRole.MESARIO, UserRole.SONOPLASTA,
  UserRole.RECEPCAO, UserRole.PALCO,
  UserRole.STAFF, UserRole.ORGANIZER, UserRole.USUALDANCE_ADMIN,
];

// Mapeamento permissão → item de menu (usado para membros com permissoes_custom)
type PermKey = keyof PermissoesCustom;
const PERM_MENU: { perm: PermKey; path: string; label: string; icon: React.ElementType }[] = [
  { perm: 'cronograma_leitura', path: '/manage-schedule', label: 'Cronograma',        icon: Calendar        },
  { perm: 'credenciamento',     path: '/check-in',        label: 'Credenciamento',    icon: QrCode          },
  { perm: 'marcacao_palco',     path: '/marcacao-palco',  label: 'Marcação de Palco', icon: PersonStanding  },
  { perm: 'suporte_juri',       path: '/suporte-juri',    label: 'Suporte ao Júri',   icon: Headphones      },
  { perm: 'inscricoes_leitura', path: '/registrations',   label: 'Inscrições',        icon: ClipboardList   },
  { perm: 'triagem',            path: '/registrations',   label: 'Triagem',           icon: Filter          },
  { perm: 'financeiro',         path: '/qg-organizador',  label: 'Financeiro',        icon: CreditCard      },
];

const menuSections: MenuSection[] = [
  {
    section: 'Produtor',
    roles: ALL_ORGANIZER,
    items: [
      { path: '/qg-organizador',       label: 'OG do Produtor',           icon: Gavel          },
      { path: '/registrations',        label: 'Inscricoes',               icon: ClipboardList  },
      { path: '/seletiva-video',       label: 'Seletiva de Video',        icon: Video          },
      { path: '/importar-regulamento', label: 'Importar Regulamento',     icon: FileSearch     },
      { path: '/apuracao',             label: 'Resultados',               icon: BarChart2      },
      { path: '/manage-schedule',      label: 'Sonoplastia e Cronograma', icon: Calendar       },
      { path: '/equipe-jurados',       label: 'Jurados',                  icon: UserCheck      },
      { path: '/minha-equipe',         label: 'Minha Equipe',             icon: Users          },
      { path: '/account-settings',     label: 'Configuracoes',            icon: Settings       },
    ],
  },
  {
    section: 'Inscrito',
    roles: ALL_USER,
    items: [
      { path: '/dashboard',           label: 'Inicio',                icon: LayoutDashboard },
      { path: '/profile',             label: 'Meu Perfil',            icon: UserRound       },
      { path: '/bailarinos',          label: 'Meu Elenco',            icon: Users           },
      { path: '/minhas-coreografias', label: 'Minhas Coreografias',   icon: Clapperboard    },
      { path: '/central-de-midia',    label: 'Central de Midia',      icon: Music2          },
      { path: '/meus-resultados',     label: 'Feedbacks / Resultados', icon: Trophy         },
      { path: '/ingressos',           label: 'Comprar Ingressos',     icon: Ticket          },
    ],
  },
  {
    section: 'Juri',
    roles: ALL_JUDGE,
    items: [
      { path: '/judge-terminal', label: 'Terminal de Juri', icon: Award },
    ],
  },
  {
    section: 'Equipe',
    roles: ALL_EQUIPE,
    items: [
      // Coordenador — acesso amplo
      { path: '/check-in',        label: 'Credenciamento',          icon: QrCode,          roles: [UserRole.COORDENADOR, UserRole.STAFF, UserRole.ORGANIZER, UserRole.USUALDANCE_ADMIN] },
      { path: '/manage-schedule', label: 'Cronograma',              icon: Calendar,        roles: [UserRole.COORDENADOR, UserRole.MESARIO, UserRole.SONOPLASTA, UserRole.RECEPCAO, UserRole.PALCO, UserRole.STAFF, UserRole.ORGANIZER, UserRole.USUALDANCE_ADMIN] },
      // Credenciamento
      { path: '/check-in',        label: 'Credenciamento',          icon: QrCode,          roles: [UserRole.RECEPCAO] },
      // Marcacao de Palco
      { path: '/marcacao-palco',  label: 'Marcacao de Palco',       icon: PersonStanding,  roles: [UserRole.PALCO, UserRole.COORDENADOR, UserRole.STAFF, UserRole.ORGANIZER, UserRole.USUALDANCE_ADMIN] },
      // Mesario — suporte ao juri
      { path: '/suporte-juri',    label: 'Suporte ao Juri',         icon: Headphones,      roles: [UserRole.MESARIO, UserRole.COORDENADOR, UserRole.STAFF, UserRole.ORGANIZER, UserRole.USUALDANCE_ADMIN] },
    ],
  },
  {
    section: 'Admin',
    roles: [UserRole.USUALDANCE_ADMIN],
    items: [
      { path: '/super-admin',        label: 'Painel Admin',  icon: ShieldCheck },
      { path: '/trilhas',            label: 'Trilhas Sonoras', icon: Music      },
      { path: '/certificados',       label: 'Certificados',  icon: Mic2        },
      { path: '/generate-narration', label: 'Narracao IA',   icon: Tv          },
    ],
  },
];

const Sidebar = ({ isOpen, toggle, onLogout, activeRole, profile, videoSelectionEnabled }: SidebarProps) => {
  const location = useLocation();

  // Build equipe section dynamically when the member has permissoes_custom
  const isEquipeMember = activeRole !== null && ALL_EQUIPE.includes(activeRole)
    && !ALL_ORGANIZER.includes(activeRole);

  const customPerms = isEquipeMember ? profile?.permissoes_custom : undefined;

  const visibleSections = (() => {
    const base = menuSections
      .filter(sec => !sec.roles || (activeRole && sec.roles.includes(activeRole)))
      .map(sec => ({
        ...sec,
        items: sec.items.filter(item => !item.roles || (activeRole && item.roles.includes(activeRole))),
      }))
      .filter(sec => sec.items.length > 0)
      .map(sec => ({
        ...sec,
        items: sec.items.filter((item, idx, arr) => arr.findIndex(x => x.path === item.path) === idx),
      }))
      // Injeta "Seletiva de Vídeo" na seção do Inscrito somente quando ativa
      .map(sec => {
        if (sec.section !== 'Inscrito') return sec;
        const seletivaItem = { path: '/minha-seletiva', label: 'Seletiva de Video', icon: Video };
        if (!videoSelectionEnabled) return sec;
        // Insere após "Central de Midia"
        const insertAfter = '/central-de-midia';
        const idx = sec.items.findIndex(i => i.path === insertAfter);
        if (idx === -1) return { ...sec, items: [...sec.items, seletivaItem] };
        const items = [...sec.items];
        items.splice(idx + 1, 0, seletivaItem);
        return { ...sec, items };
      });

    // If member has permissoes_custom, replace the Equipe section with a dynamic one
    if (customPerms) {
      const customItems = PERM_MENU
        .filter(pm => customPerms[pm.perm])
        // deduplicate by path
        .filter((pm, idx, arr) => arr.findIndex(x => x.path === pm.path) === idx)
        .map(pm => ({ path: pm.path, label: pm.label, icon: pm.icon }));

      return base
        .filter(s => s.section !== 'Equipe')
        .concat(customItems.length > 0 ? [{ section: 'Meu Acesso', items: customItems }] : []);
    }

    return base;
  })();

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden" onClick={toggle} />}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-950 transform transition-transform duration-300 lg:relative lg:translate-x-0 border-r border-slate-200 dark:border-white/10 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-5 flex items-center gap-3">
            <div className="bg-[#ff0068] p-1.5 rounded-lg text-white shadow-[0_0_15px_rgba(255,0,104,0.3)]">
              <Music size={16} />
            </div>
            <span className="tracking-tighter uppercase font-black text-base text-slate-900 dark:text-white">Coreo<span className="text-[#ff0068]">Hub</span></span>
          </div>

          <nav className="flex-1 px-3 overflow-y-auto space-y-4 pb-4">
            {visibleSections.map((sec) => (
              <div key={sec.section}>
                <p className="px-3 mb-1 text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-600">
                  {sec.section}
                </p>
                <div className="space-y-0.5">
                  {sec.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                      <Link
                        key={item.path + item.label}
                        to={item.path}
                        onClick={() => { if (window.innerWidth < 1024) toggle(); }}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
                          isActive
                            ? 'bg-[#ff0068] text-white shadow-md'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'
                        }`}
                      >
                        <Icon size={15} />
                        <span className="text-[9px] font-black uppercase tracking-widest leading-tight">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Perfil — sempre visivel */}
            <div>
              <p className="px-3 mb-1 text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-600">
                Conta
              </p>
              <div className="space-y-0.5">
                <Link
                  to="/profile"
                  onClick={() => { if (window.innerWidth < 1024) toggle(); }}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
                    location.pathname === '/profile'
                      ? 'bg-[#ff0068] text-white shadow-md'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  <UserCircle size={15} />
                  <span className="text-[9px] font-black uppercase tracking-widest">Perfil</span>
                </Link>
              </div>
            </div>
          </nav>

          <div className="p-3 border-t border-slate-200 dark:border-white/10">
            <button
              onClick={onLogout}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-slate-600 dark:text-slate-400 hover:text-rose-500 transition-all rounded-xl hover:bg-rose-500/10"
            >
              <LogOut size={16} />
              <span className="text-[9px] font-black uppercase tracking-widest">Sair da Conta</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
