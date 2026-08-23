import React from 'react';
import {
  Calendar, QrCode, PersonStanding, Headphones, MonitorPlay, Megaphone,
  ClipboardList, Filter, Video, GraduationCap, Ticket, Tag, BarChart2,
  Award, CreditCard,
} from 'lucide-react';
import { PermissoesCustom, UserRole } from '../types';

/** Cargos operacionais puros — equipe convidada via /minha-equipe, nunca
 *  produtor/admin (esses têm menu e landing próprios). Fonte única
 *  compartilhada por Sidebar (menu "Meu Acesso") e Dashboard (empty state)
 *  pra não divergir feito ALL_EQUIPE vs. INSCRITO_ROLES divergiam antes. */
export const EQUIPE_OPERACIONAL_ROLES: UserRole[] = [
  UserRole.COORDENADOR, UserRole.MESARIO, UserRole.SONOPLASTA,
  UserRole.RECEPCAO, UserRole.PALCO, UserRole.APOIO_WORKSHOP, UserRole.STAFF,
];

export function isEquipeOperacional(role: UserRole | null | undefined): boolean {
  return !!role && EQUIPE_OPERACIONAL_ROLES.includes(role);
}

/** Rótulo humano por cargo operacional — fonte única (antes duplicado e
 *  incompleto em TeamInvite.tsx, faltando APOIO_WORKSHOP/STAFF). Usado no
 *  convite (ROLE_LABEL) e no fallback do badge do Header. */
export const CARGO_LABEL: Partial<Record<UserRole, string>> = {
  [UserRole.COORDENADOR]:    'Coordenador',
  [UserRole.MESARIO]:        'Coordenador do Júri',
  [UserRole.SONOPLASTA]:     'Sonoplasta',
  [UserRole.RECEPCAO]:       'Recepção / Palco',
  [UserRole.PALCO]:          'Marcador de Palco',
  [UserRole.APOIO_WORKSHOP]: 'Apoio de Workshop',
  [UserRole.STAFF]:          'Equipe',
};

/** "Ser equipe" e "ser inscrito" não são exclusivos (Sidebar já assume isso
 *  desde ALL_USER_OR_EQUIPE) — mas antes da home adaptativa, nada no
 *  Dashboard sabia detectar o caso híbrido: cargo operacional cobre quem foi
 *  convidado via /minha-equipe, e o segundo braço cobre o caso legado/teste
 *  onde `permissoes_custom` está populado mas o role ainda é de inscrito
 *  (ex: conta promovida na mão via SQL, sem passar pelo convite). */
export function isEquipeAtiva(role: UserRole | null | undefined, perms: PermissoesCustom | null | undefined): boolean {
  if (isEquipeOperacional(role)) return true;
  return !!perms && Object.values(perms).some(v => v === true);
}

/** Mapeamento permissão → item de menu, compartilhado entre Sidebar (monta o
 *  menu da Equipe) e Auth (calcula pra onde mandar o membro após o login).
 *  Ordem reflete prioridade de fluxo de trabalho (Cronograma/Credenciamento
 *  primeiro, Financeiro por último) — usada como desempate quando o membro
 *  tem mais de uma permissão. */
export type PermKey = keyof PermissoesCustom;

export const PERM_MENU: { perm: PermKey; path: string; label: string; icon: React.ElementType }[] = [
  { perm: 'cronograma_leitura', path: '/cronograma', label: 'Cronograma',          icon: Calendar        },
  // Qualquer escopo de checkin_* já libera o menu — CheckIn.tsx restringe
  // por dentro pra só oferecer os tipos de QR que o membro de fato tem.
  { perm: 'checkin_inscritos',  path: '/credenciamento',        label: 'Credenciamento',      icon: QrCode          },
  { perm: 'checkin_ingressos',  path: '/credenciamento',        label: 'Credenciamento',      icon: QrCode          },
  { perm: 'checkin_workshops',  path: '/credenciamento',        label: 'Credenciamento',      icon: QrCode          },
  { perm: 'checkin_equipe',     path: '/credenciamento',        label: 'Credenciamento',      icon: QrCode          },
  { perm: 'checkin_jurados',    path: '/credenciamento',        label: 'Credenciamento',      icon: QrCode          },
  // Credenciais.tsx não filtra por tipo — imprime todo o roster do evento.
  // Só quem tem checkin_inscritos (escopo amplo) ganha esse item de menu.
  { perm: 'checkin_inscritos',  path: '/credenciais',     label: 'Credenciais',         icon: QrCode          },
  { perm: 'marcacao_palco',     path: '/marcacao-palco',  label: 'Marcação de Palco',   icon: PersonStanding  },
  { perm: 'suporte_juri',       path: '/suporte-juri',    label: 'Coordenador do Júri', icon: Headphones      },
  { perm: 'controle_telao',     path: '/telao-palco',     label: 'Telão de Palco',      icon: MonitorPlay     },
  { perm: 'gerenciar_avisos',   path: '/avisos',          label: 'Avisos',              icon: Megaphone       },
  { perm: 'inscricoes_leitura', path: '/inscricoes',   label: 'Inscrições',          icon: ClipboardList   },
  { perm: 'triagem',            path: '/inscricoes',   label: 'Triagem',             icon: Filter          },
  { perm: 'seletiva_video',     path: '/seletiva-video',  label: 'Seletiva de Vídeo',   icon: Video           },
  { perm: 'gerenciar_workshops', path: '/workshops-do-evento', label: 'Workshops',       icon: GraduationCap   },
  { perm: 'vendas_ingressos',   path: '/vendas-ingressos', label: 'Vendas de Ingressos', icon: Ticket          },
  { perm: 'gerenciar_cupons',   path: '/cupons',          label: 'Cupons',              icon: Tag             },
  { perm: 'resultados_leitura', path: '/apuracao',        label: 'Apuração',            icon: BarChart2       },
  { perm: 'emitir_certificados', path: '/certificados',   label: 'Certificados',        icon: Award           },
  { perm: 'financeiro',         path: '/qg-organizador',  label: 'Financeiro',          icon: CreditCard      },
];

/** Primeira rota permitida pra um membro de equipe com `permissoes_custom`.
 *  Retorna null se nenhuma permissão estiver ligada (perfil zerado). */
export function resolveFirstEquipeRoute(perms: PermissoesCustom | null | undefined): string | null {
  if (!perms) return null;
  const match = PERM_MENU.find(item => perms[item.perm]);
  return match?.path ?? null;
}

/** Itens de menu (dedupe por rota) pras permissões ativas — usado no card de
 *  resumo de equipe da home adaptativa (Dashboard) e reaproveitável em
 *  qualquer outro lugar que precise listar "o que essa pessoa pode fazer"
 *  sem duplicar Cronograma/Credenciamento pra cada checkin_* ligado. */
export function resolveEquipeMenuItems(
  perms: PermissoesCustom | null | undefined
): { path: string; label: string; icon: React.ElementType }[] {
  if (!perms) return [];
  const seen = new Set<string>();
  const items: { path: string; label: string; icon: React.ElementType }[] = [];
  for (const item of PERM_MENU) {
    if (!perms[item.perm] || seen.has(item.path)) continue;
    seen.add(item.path);
    items.push({ path: item.path, label: item.label, icon: item.icon });
  }
  return items;
}
