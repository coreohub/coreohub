import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clapperboard, Music2, UserRound,
  Gavel, ClipboardList, Calendar, Settings, Video,
  MoreHorizontal, X, Mic2, PersonStanding, Ticket,
  GraduationCap, Tag, Trophy, Award, Star, Shield, FileText,
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
  { path: '/minhas-coreografias', label: 'Inscrições', icon: Clapperboard },
  { path: '/central-de-midia',    label: 'Trilha',  icon: Music2          },
  { path: '/profile',             label: 'Perfil',  icon: UserRound       },
];

// ─── Produtor ─────────────────────────────────────────────────────────────────

const PRODUTOR_ROLES = new Set([
  UserRole.ORGANIZER,
  UserRole.COREOHUB_ADMIN,
]);

// Label "Painel" alinhado com padrão BR de SaaS (Stripe BR, Sympla Painel
// do Produtor, Mercado Pago). 'QG' era jargão interno, fora do mercado e
// inconsistente com o título "DASHBOARD ADMINISTRATIVO" na tela. Pesquisa
// 2026-05-25.
const buildProdutorNav = () => [
  { path: '/qg-organizador',   label: 'Painel',    icon: LayoutDashboard },
  { path: '/registrations',    label: 'Inscrições', icon: ClipboardList },
  { path: '/manage-schedule',  label: 'Crono',     icon: Calendar      },
  { path: '__more__',          label: 'Mais',      icon: MoreHorizontal },
  { path: '/account-settings', label: 'Config',    icon: Settings      },
];

// Features secundárias agrupadas — espelha grupos do sidebar pra consistência.
// Padrão Instagram/LinkedIn/App Store: bottom nav com 5 atalhos top + Mais
// que abre sheet com restante.
interface MoreItem { path: string; label: string; icon: React.ElementType; }
interface MoreGroup { label: string; tone: string; items: MoreItem[]; }

const MORE_GROUPS: MoreGroup[] = [
  {
    label: 'Setup', tone: 'text-blue-500',
    items: [
      { path: '/regulation-ai',  label: 'Regulamento',  icon: FileText  },
      { path: '/judges',         label: 'Jurados',      icon: Gavel     },
      { path: '/minha-equipe',   label: 'Equipe',       icon: Users     },
    ],
  },
  {
    label: 'Operação', tone: 'text-[#ff0068]',
    items: [
      { path: '/seletiva-video',                       label: 'Seletiva',         icon: Video          },
      { path: '/account-settings?tab=Fluxo do Evento', label: 'Narração IA',      icon: Mic2           },
      { path: '/marcacao-palco',                       label: 'Marcação Palco',   icon: PersonStanding },
    ],
  },
  {
    label: 'Bilheteria', tone: 'text-orange-500',
    items: [
      { path: '/vendas-ingressos',    label: 'Vendas',     icon: Ticket        },
      { path: '/workshops-do-evento', label: 'Workshops',  icon: GraduationCap },
      { path: '/cupons',              label: 'Cupons',     icon: Tag           },
    ],
  },
  {
    label: 'Resultados', tone: 'text-emerald-500',
    items: [
      { path: '/results',                 label: 'Apuração',         icon: Trophy },
      { path: '/deliberacoes',            label: 'Premiação',        icon: Star   },
      { path: '/certificados',            label: 'Certificados',     icon: Award  },
    ],
  },
  {
    label: 'Sistema', tone: 'text-slate-400',
    items: [
      { path: '/suporte-juri', label: 'Coordenador do Júri', icon: Shield },
    ],
  },
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
  /** @deprecated mantido só por compat — Seletiva agora vive no Mais sheet */
  videoSelectionEnabled?: boolean;
}

const BottomNavBar: React.FC<Props> = ({ activeRole }) => {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!activeRole) return null;

  const isProdutor = PRODUTOR_ROLES.has(activeRole);
  const isInscrito = INSCRITO_ROLES.has(activeRole);

  if (!isProdutor && !isInscrito) return null;

  const items = isProdutor
    ? buildProdutorNav()
    : INSCRITO_NAV;

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-white/10"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-stretch h-16">
          {items.map(item =>
            item.path === '__more__' ? (
              <button
                key="more"
                type="button"
                onClick={() => setMoreOpen(true)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors active:scale-95 ${
                  moreOpen ? 'text-[#ff0068]' : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                <div className={`p-1 rounded-xl transition-all ${moreOpen ? 'bg-[#ff0068]/10' : ''}`}>
                  <item.icon size={20} strokeWidth={moreOpen ? 2.5 : 1.8} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-tight leading-none">{item.label}</span>
              </button>
            ) : (
              <NavItem
                key={item.path}
                path={item.path}
                label={item.label}
                icon={item.icon}
                isActive={location.pathname === item.path}
              />
            ),
          )}
        </div>
      </nav>

      {/* Mais sheet — só pra produtor (inscrito não tem features extras) */}
      {moreOpen && isProdutor && (
        <div
          className="fixed inset-0 z-50 sm:hidden bg-black/50 backdrop-blur-sm flex items-end animate-in fade-in duration-200"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="w-full bg-white dark:bg-slate-950 rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-white/10 px-5 py-4 flex items-center justify-between">
              <h3 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">Mais opções</h3>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-5">
              {MORE_GROUPS.map(group => (
                <div key={group.label}>
                  <p className={`text-[9px] font-black uppercase tracking-widest mb-2.5 ${group.tone}`}>
                    {group.label}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {group.items.map(it => (
                      <Link
                        key={it.path}
                        to={it.path}
                        onClick={() => setMoreOpen(false)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-[#ff0068]/40 active:scale-95 transition-all"
                      >
                        <it.icon size={18} className="text-slate-700 dark:text-slate-300" />
                        <span className="text-[9px] font-black uppercase tracking-tight text-slate-700 dark:text-slate-300 text-center leading-tight">
                          {it.label}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BottomNavBar;
