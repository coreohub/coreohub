import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clapperboard, Music2, UserRound,
  Gavel, ClipboardList, Calendar, Settings, Video,
} from 'lucide-react';
import { UserRole } from '../types';

// ─── Inscrito ─────────────────────────────────────────────────────────────────

const INSCRITO_ROLES = new Set([
  UserRole.STUDIO_DIRECTOR,
  UserRole.CHOREOGRAPHER,
  UserRole.INDEPENDENT,
  UserRole.USER,
  UserRole.SPECTATOR,
]);

const INSCRITO_NAV = [
  { path: '/dashboard',           label: 'Início',  icon: LayoutDashboard },
  { path: '/bailarinos',          label: 'Elenco',  icon: Users           },
  { path: '/minhas-coreografias', label: 'Coreos',  icon: Clapperboard    },
  { path: '/central-de-midia',    label: 'Mídias',  icon: Music2          },
  { path: '/profile',             label: 'Perfil',  icon: UserRound       },
];

// ─── Produtor ─────────────────────────────────────────────────────────────────

const PRODUTOR_ROLES = new Set([
  UserRole.ORGANIZER,
  UserRole.COREOHUB_ADMIN,
]);

const buildProdutorNav = (videoSelectionEnabled: boolean) => [
  { path: '/qg-organizador',   label: 'QG',        icon: Gavel         },
  { path: '/registrations',    label: 'Inscrições', icon: ClipboardList },
  ...(videoSelectionEnabled
    ? [{ path: '/seletiva-video', label: 'Seletiva', icon: Video }]
    : []
  ),
  { path: '/manage-schedule',  label: 'Agenda',    icon: Calendar      },
  { path: '/account-settings', label: 'Config',    icon: Settings      },
];

// ─── Shared nav item ──────────────────────────────────────────────────────────

const NavItem: React.FC<{ path: string; label: string; icon: React.ElementType; isActive: boolean }> = ({
  path, label, icon: Icon, isActive,
}) => (
  <Link
    to={path}
    className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors active:scale-95 ${
      isActive ? 'text-[#ff0068]' : 'text-slate-400 dark:text-slate-500'
    }`}
  >
    <div className={`p-1 rounded-xl transition-all ${isActive ? 'bg-[#ff0068]/10' : ''}`}>
      <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
    </div>
    <span className="text-[10px] font-black uppercase tracking-tight leading-none">{label}</span>
  </Link>
);

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  activeRole: UserRole | null;
  videoSelectionEnabled?: boolean;
}

const BottomNavBar: React.FC<Props> = ({ activeRole, videoSelectionEnabled = false }) => {
  const location = useLocation();

  if (!activeRole) return null;

  const isProdutor = PRODUTOR_ROLES.has(activeRole);
  const isInscrito = INSCRITO_ROLES.has(activeRole);

  if (!isProdutor && !isInscrito) return null;

  const items = isProdutor
    ? buildProdutorNav(videoSelectionEnabled)
    : INSCRITO_NAV;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-white/10"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch h-16">
        {items.map(item => (
          <NavItem
            key={item.path}
            path={item.path}
            label={item.label}
            icon={item.icon}
            isActive={location.pathname === item.path}
          />
        ))}
      </div>
    </nav>
  );
};

export default BottomNavBar;
