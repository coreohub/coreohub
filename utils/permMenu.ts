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

/** Mapeamento permissão → item de menu, compartilhado entre Sidebar (monta o
 *  menu da Equipe) e Auth (calcula pra onde mandar o membro após o login).
 *  Ordem reflete prioridade de fluxo de trabalho (Cronograma/Credenciamento
 *  primeiro, Financeiro por último) — usada como desempate quando o membro
 *  tem mais de uma permissão. */
export type PermKey = keyof PermissoesCustom;

export const PERM_MENU: { perm: PermKey; path: string; label: string; icon: React.ElementType }[] = [
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

/** Primeira rota permitida pra um membro de equipe com `permissoes_custom`.
 *  Retorna null se nenhuma permissão estiver ligada (perfil zerado). */
export function resolveFirstEquipeRoute(perms: PermissoesCustom | null | undefined): string | null {
  if (!perms) return null;
  const match = PERM_MENU.find(item => perms[item.perm]);
  return match?.path ?? null;
}
