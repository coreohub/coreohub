import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Calendar,
  Music, Gavel, QrCode,
  LogOut, Award, UserCircle,
  Ticket, Trophy,
  BarChart2, UserCheck,
  ClipboardList, ShieldCheck, Mic2, Settings,
  Clapperboard, Music2,
  PersonStanding, Headphones, Filter, CreditCard,
  Video, FileSearch, Tag, GraduationCap, MonitorPlay, Megaphone,
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

type SectionTone = 'slate' | 'pink' | 'orange' | 'emerald' | 'gray' | 'violet';

type MenuSection = {
  section: string;
  roles?: UserRole[];
  items: MenuItem[];
  /** Cor da barra vertical à esquerda do grupo (research-backed: ajuda escaneamento periférico). */
  tone?: SectionTone;
};

// Mapeamento de tone → classes Tailwind.
// Mantido como objeto literal pra Tailwind não dropar as classes na build (purge).
const TONE_BAR: Record<SectionTone, string> = {
  slate:   'bg-slate-300 dark:bg-slate-700',
  pink:    'bg-[#ff0068]',
  orange:  'bg-orange-400 dark:bg-orange-500',
  emerald: 'bg-emerald-500',
  gray:    'bg-slate-200 dark:bg-slate-800',
  violet:  'bg-violet-400 dark:bg-violet-500',
};

const ALL_ORGANIZER = [UserRole.ORGANIZER, UserRole.COREOHUB_ADMIN];
const ALL_JUDGE     = [UserRole.JUDGE, UserRole.COREOHUB_ADMIN];
const ALL_USER      = [UserRole.USER, UserRole.STUDIO_DIRECTOR, UserRole.CHOREOGRAPHER, UserRole.INDEPENDENT, UserRole.TEAM, UserRole.SPECTATOR, UserRole.COREOHUB_ADMIN];

// Equipe operacional — todos os sub-roles + organizer + admin
const ALL_EQUIPE = [
  UserRole.COORDENADOR, UserRole.MESARIO, UserRole.SONOPLASTA,
  UserRole.RECEPCAO, UserRole.PALCO, UserRole.APOIO_WORKSHOP,
  UserRole.STAFF, UserRole.ORGANIZER, UserRole.COREOHUB_ADMIN,
];

// "Ser equipe" e "ser inscrito/coreógrafo" não são exclusivos (padrão
// Eventbrite/Meetup: staff também pode ter as próprias inscrições). Sem
// isso, quem é convidado como equipe nunca via o menu "Minhas Inscrições"
// pra se inscrever numa outra mostra, mesmo podendo fazer isso normalmente
// (o Wizard de inscrição não checa role nenhuma).
const ALL_USER_OR_EQUIPE = [...ALL_USER, ...ALL_EQUIPE];

// Mapeamento permissão → item de menu (usado para membros com permissoes_custom)
type PermKey = keyof PermissoesCustom;
const PERM_MENU: { perm: PermKey; path: string; label: string; icon: React.ElementType }[] = [
  { perm: 'cronograma_leitura', path: '/manage-schedule', label: 'Cronograma',          icon: Calendar        },
  // Qualquer escopo de checkin_* já libera o menu — CheckIn.tsx restringe
  // por dentro pra só oferecer os tipos de QR que o membro de fato tem.
  { perm: 'checkin_inscritos',  path: '/check-in',        label: 'Credenciamento',      icon: QrCode          },
  { perm: 'checkin_ingressos',  path: '/check-in',        label: 'Credenciamento',      icon: QrCode          },
  { perm: 'checkin_workshops',  path: '/check-in',        label: 'Credenciamento',      icon: QrCode          },
  { perm: 'checkin_equipe',     path: '/check-in',        label: 'Credenciamento',      icon: QrCode          },
  { perm: 'checkin_jurados',    path: '/check-in',        label: 'Credenciamento',      icon: QrCode          },
  // Credenciais.tsx não filtra por tipo — imprime todo o roster do evento.
  // Só quem tem checkin_inscritos (escopo amplo) ganha esse item de menu.
  { perm: 'checkin_inscritos',  path: '/credenciais',     label: 'Credenciais',         icon: QrCode          },
  { perm: 'marcacao_palco',     path: '/marcacao-palco',  label: 'Marcação de Palco',   icon: PersonStanding  },
  { perm: 'suporte_juri',       path: '/suporte-juri',    label: 'Coordenador do Júri', icon: Headphones      },
  { perm: 'controle_telao',     path: '/telao-palco',     label: 'Telão de Palco',      icon: MonitorPlay     },
  { perm: 'gerenciar_avisos',   path: '/avisos',          label: 'Avisos',              icon: Megaphone       },
  { perm: 'inscricoes_leitura', path: '/registrations',   label: 'Inscrições',          icon: ClipboardList   },
  { perm: 'triagem',            path: '/registrations',   label: 'Triagem',             icon: Filter          },
  { perm: 'seletiva_video',     path: '/seletiva-video',  label: 'Seletiva de Vídeo',   icon: Video           },
  { perm: 'gerenciar_workshops', path: '/workshops-do-evento', label: 'Workshops',       icon: GraduationCap   },
  { perm: 'vendas_ingressos',   path: '/vendas-ingressos', label: 'Vendas de Ingressos', icon: Ticket          },
  { perm: 'gerenciar_cupons',   path: '/cupons',          label: 'Cupons',              icon: Tag             },
  { perm: 'resultados_leitura', path: '/apuracao',        label: 'Apuração',            icon: BarChart2       },
  { perm: 'emitir_certificados', path: '/certificados',   label: 'Certificados',        icon: Award           },
  { perm: 'financeiro',         path: '/qg-organizador',  label: 'Financeiro',          icon: CreditCard      },
];

// Menu do produtor agrupado por fase do ciclo de vida do evento (Setup →
// Operação → Bilheteria → Resultados → Sistema). Padrão research-backed
// (Cvent/Bizzabo/Linear/Stripe) — agrupa por *quando* o produtor usa, não por
// quem é. Cores das barras ajudam escaneamento periférico (Fitts + F-pattern).
const menuSections: MenuSection[] = [
  // ─── SETUP ── pré-evento, baixa frequência após config inicial ──
  {
    section: 'Setup',
    roles: ALL_ORGANIZER,
    tone: 'slate',
    items: [
      { path: '/qg-organizador',       label: 'Painel',           icon: Gavel       },
      { path: '/importar-regulamento', label: 'Regulamento',      icon: FileSearch  },
      { path: '/equipe-jurados',       label: 'Jurados',          icon: UserCheck   },
      { path: '/minha-equipe',         label: 'Equipe',           icon: Users       },
    ],
  },
  // ─── OPERAÇÃO ── alta frequência, dia-a-dia do evento ──
  {
    section: 'Operação',
    roles: ALL_ORGANIZER,
    tone: 'pink',
    items: [
      { path: '/registrations',   label: 'Inscrições',        icon: ClipboardList },
      { path: '/seletiva-video',  label: 'Seletiva de Vídeo', icon: Video         },
      { path: '/manage-schedule', label: 'Cronograma',        icon: Calendar      },
      { path: '/narracao-ia', label: 'Narração IA', icon: Mic2 },
      { path: '/marcacao-palco',  label: 'Marcação de Palco', icon: PersonStanding },
      { path: '/telao-palco',     label: 'Telão de Palco',    icon: MonitorPlay   },
      { path: '/credenciais',     label: 'Credenciais',       icon: QrCode        },
      { path: '/avisos',          label: 'Avisos',            icon: Megaphone     },
    ],
  },
  // ─── VENDAS ── tudo que gera receita/comissão (hub único, ver VendasTabs).
  // Inscrições e Seletiva também aparecem em "Operação" (curadoria) — dual-list
  // de propósito, igual Cronograma; mesma rota, contextos diferentes. ──
  {
    section: 'Vendas',
    roles: ALL_ORGANIZER,
    tone: 'orange',
    items: [
      { path: '/vendas',              label: 'Visão Geral', icon: LayoutDashboard },
      { path: '/registrations',       label: 'Inscrições', icon: ClipboardList },
      { path: '/vendas-ingressos',    label: 'Ingressos',  icon: Ticket        },
      { path: '/workshops-do-evento', label: 'Workshops',  icon: GraduationCap },
      { path: '/seletiva-video',      label: 'Seletiva',   icon: Video         },
      { path: '/cupons',              label: 'Cupons',     icon: Tag           },
    ],
  },
  // ─── RESULTADOS ── pós-apresentação ──
  {
    section: 'Resultados',
    roles: ALL_ORGANIZER,
    tone: 'emerald',
    items: [
      { path: '/apuracao',     label: 'Apuração',     icon: BarChart2 },
      { path: '/deliberacoes', label: 'Premiação',    icon: Trophy    },
      { path: '/certificados', label: 'Certificados', icon: Award     },
    ],
  },
  // ─── SISTEMA ── utility + config ──
  {
    section: 'Sistema',
    roles: ALL_ORGANIZER,
    tone: 'gray',
    items: [
      { path: '/suporte-juri',     label: 'Coordenador do Júri', icon: Headphones },
      { path: '/account-settings', label: 'Configurações',       icon: Settings   },
    ],
  },
  {
    section: 'Inscrito',
    roles: ALL_USER_OR_EQUIPE,
    items: [
      { path: '/dashboard',           label: 'Início',                icon: LayoutDashboard },
      { path: '/bailarinos',          label: 'Meu Elenco',            icon: Users           },
      { path: '/minhas-coreografias', label: 'Minhas Inscrições',     icon: Clapperboard    },
      { path: '/central-de-midia',    label: 'Trilha Sonora',         icon: Music2          },
      { path: '/meus-resultados',     label: 'Feedbacks / Resultados', icon: Trophy         },
      { path: '/meus-certificados',   label: 'Meus Certificados',     icon: Award           },
      { path: '/ingressos',           label: 'Ingressos',             icon: Ticket          },
    ],
  },
  {
    section: 'Júri',
    roles: ALL_JUDGE,
    items: [
      { path: '/judge-terminal', label: 'Terminal de Júri', icon: Award },
    ],
  },
  {
    section: 'Equipe',
    roles: ALL_EQUIPE,
    items: [
      // Coordenador — acesso amplo
      { path: '/check-in',        label: 'Credenciamento',          icon: QrCode,          roles: [UserRole.COORDENADOR, UserRole.STAFF, UserRole.ORGANIZER, UserRole.COREOHUB_ADMIN] },
      // Cronograma: ORGANIZER ja ve em "Sonoplastia e Cronograma" na secao Produtor — evita duplicar
      { path: '/manage-schedule', label: 'Cronograma',              icon: Calendar,        roles: [UserRole.COORDENADOR, UserRole.MESARIO, UserRole.SONOPLASTA, UserRole.RECEPCAO, UserRole.PALCO, UserRole.STAFF, UserRole.COREOHUB_ADMIN] },
      // Credenciamento
      { path: '/check-in',        label: 'Credenciamento',          icon: QrCode,          roles: [UserRole.RECEPCAO] },
      // Marcacao de Palco — ORGANIZER ja ve em "Operação"; COREOHUB_ADMIN tem acesso via outras vias
      { path: '/marcacao-palco',  label: 'Marcação de Palco',       icon: PersonStanding,  roles: [UserRole.PALCO, UserRole.COORDENADOR, UserRole.STAFF] },
      // Coordenador do Juri — ORGANIZER ja ve em "Sistema"; evita duplicar
      { path: '/suporte-juri',    label: 'Coordenador do Júri',     icon: Headphones,      roles: [UserRole.MESARIO, UserRole.COORDENADOR, UserRole.STAFF] },
      // Deliberacao: ORGANIZER ja ve na secao Produtor — evita duplicar
      { path: '/deliberacoes',    label: 'Premiação',               icon: Trophy,          roles: [UserRole.MESARIO, UserRole.COORDENADOR, UserRole.STAFF, UserRole.COREOHUB_ADMIN] },
    ],
  },
  {
    section: 'Admin',
    roles: [UserRole.COREOHUB_ADMIN],
    items: [
      { path: '/super-admin',        label: 'Painel Admin',  icon: ShieldCheck },
      { path: '/trilhas',            label: 'Trilhas Sonoras', icon: Music      },
      { path: '/certificados',       label: 'Certificados',  icon: Mic2        },
    ],
  },
];

const Sidebar = ({ isOpen, toggle, onLogout, activeRole, profile, videoSelectionEnabled }: SidebarProps) => {
  const location = useLocation();

  // Build equipe section dynamically when the member has permissoes_custom
  const isEquipeMember = activeRole !== null && ALL_EQUIPE.includes(activeRole)
    && !ALL_ORGANIZER.includes(activeRole);

  const customPerms = isEquipeMember ? profile?.permissoes_custom : undefined;

  // Super admin é por flag (profiles.is_super_admin), não por role — flag pode
  // existir num user cujo role ativo é ORGANIZER ou outro. Painel /super-admin
  // já aceita ambos os caminhos; o filtro de sidebar tem que aceitar também
  // ou super admin com role != COREOHUB_ADMIN não vê o link, mesmo tendo acesso.
  const isSuperAdmin = profile?.is_super_admin === true;

  const visibleSections = (() => {
    const base = menuSections
      .filter(sec => {
        if (!sec.roles) return true;
        if (sec.section === 'Admin' && isSuperAdmin) return true;
        return activeRole && sec.roles.includes(activeRole);
      })
      .map(sec => ({
        ...sec,
        items: sec.items.filter(item => {
          if (!item.roles) return true;
          if (sec.section === 'Admin' && isSuperAdmin) return true;
          return activeRole && item.roles.includes(activeRole);
        }),
      }))
      .filter(sec => sec.items.length > 0)
      .map(sec => ({
        ...sec,
        items: sec.items.filter((item, idx, arr) => arr.findIndex(x => x.path === item.path) === idx),
      }));
      // Seletiva de Vídeo NÃO ganha item próprio no sidebar — coreografias em
      // fluxo de seletiva ficam dentro de "Minhas Inscrições" com badge/aba
      // dedicada (padrão Sympla/Eventbrite). Remove poluição de menu.

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
          {/* Branding removido — Header.tsx já mostra avatar+nome CoreoHub.
              Sidebar começa direto na navegação pra evitar duplicação visual.
              pt-20 mobile: Header sticky h-16 cobre o topo do drawer, sem
              esse padding o primeiro item (Painel) fica escondido atrás dele. */}
          <nav className="flex-1 px-3 pt-20 lg:pt-4 overflow-y-auto space-y-4 pb-4">
            {visibleSections.map((sec) => {
              const tone = (sec as MenuSection).tone;
              return (
                <div key={sec.section} className="relative">
                  {/* Barra vertical colorida à esquerda quando o grupo tem tone (Setup/Operação/etc).
                      Ajuda escaneamento periférico — research-backed F-pattern. */}
                  {tone && (
                    <div className={`absolute left-0 top-2 bottom-1 w-[3px] rounded-full ${TONE_BAR[tone]}`} aria-hidden />
                  )}
                  <p className={`mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-500 ${tone ? 'pl-4 pr-3' : 'px-3'}`}>
                    {sec.section}
                  </p>
                  <div className={`space-y-0.5 ${tone ? 'pl-2' : ''}`}>
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
                          <span className="text-[11px] font-black uppercase tracking-widest leading-tight">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Perfil — sempre visivel */}
            <div>
              <p className="px-3 mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-500">
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
                  <span className="text-[11px] font-black uppercase tracking-widest">Perfil</span>
                </Link>
              </div>
            </div>
          </nav>

          <div className="p-3 pb-20 sm:pb-3 border-t border-slate-200 dark:border-white/10">
            <button
              onClick={onLogout}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-slate-600 dark:text-slate-400 hover:text-rose-500 transition-all rounded-xl hover:bg-rose-500/10"
            >
              <LogOut size={16} />
              <span className="text-[11px] font-black uppercase tracking-widest">Sair da Conta</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
