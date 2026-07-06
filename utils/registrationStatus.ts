/**
 * Helpers de status de pagamento de registration.
 *
 * Enum em `registrations.status_pagamento`:
 *   PENDENTE, APROVADO, VENCIDO, ESTORNADO, AGUARDANDO_VIDEO, CONFIRMADO (legacy).
 *
 * Bug histórico (descoberto 2026-05-20): várias telas filtravam só por
 * 'CONFIRMADO' e zeravam métricas porque o valor real é 'APROVADO'.
 * 'CONFIRMADO' ainda aparece em rows legacy + no fluxo de cupom 100% gratuito
 * (Checkout.tsx força CONFIRMADO ao zerar valor).
 *
 * Use `isRegistrationPaid()` em vez de comparar strings direto.
 */

export type RegistrationStatus =
  | 'PENDENTE'
  | 'APROVADO'
  | 'CONFIRMADO'    // legacy
  | 'VENCIDO'
  | 'ESTORNADO'
  | 'AGUARDANDO_VIDEO'
  | string;

/** True se a inscrição já está paga (atual ou legacy). */
export const isRegistrationPaid = (status: string | null | undefined): boolean =>
  status === 'APROVADO' || status === 'CONFIRMADO';

/** True se está pendente de pagamento (não inclui AGUARDANDO_VIDEO). */
export const isRegistrationPending = (status: string | null | undefined): boolean =>
  status === 'PENDENTE';

/** True se foi rejeitada/cancelada. */
export const isRegistrationCancelled = (status: string | null | undefined): boolean =>
  status === 'VENCIDO' || status === 'ESTORNADO';

/**
 * Chave de exibição derivada do `status_pagamento` (fonte única da verdade).
 *
 * A coluna `registrations.status` foi aposentada em 2026-06-30: ela era setada
 * uma vez no Wizard ('AGUARDANDO_PAGAMENTO') e nunca mais atualizada por
 * ninguém, ficando perpetuamente dessincronizada do pagamento real. Vários
 * leitores ainda comparavam contra um vocabulário antigo ('PAGO', 'RASCUNHO')
 * que sequer existia no banco — sempre falso. Use esta função pra derivar o
 * rótulo de qualquer badge/contagem a partir do `status_pagamento`.
 */
export type RegistrationDisplayKey =
  | 'PAGO' | 'PENDENTE' | 'VENCIDO' | 'ESTORNADO' | 'AGUARDANDO_VIDEO';

export const registrationDisplayKey = (
  statusPagamento: string | null | undefined,
): RegistrationDisplayKey => {
  if (isRegistrationPaid(statusPagamento)) return 'PAGO';
  if (statusPagamento === 'VENCIDO') return 'VENCIDO';
  if (statusPagamento === 'ESTORNADO') return 'ESTORNADO';
  if (statusPagamento === 'AGUARDANDO_VIDEO') return 'AGUARDANDO_VIDEO';
  return 'PENDENTE';
};

/**
 * Filtro `.or()` do Supabase pro que conta como "inscrição agendável" —
 * paga (status_pagamento) OU aprovada manualmente pelo `status` legacy.
 * `status` foi aposentado em 2026-06-30 (deixou de ser escrito), mas rows
 * antigas ainda têm 'APROVADA' gravado e continuam valendo.
 *
 * Usado por Schedule.tsx (Cronograma, fonte da verdade) e replicado em
 * AccountSettings.tsx (Narração IA, pra mostrar as mesmas inscrições que
 * vão aparecer no Cronograma). Se essa regra mudar, mude só aqui.
 */
export const SCHEDULABLE_REGISTRATIONS_OR_FILTER =
  'status.eq.APROVADA,status_pagamento.eq.APROVADO,status_pagamento.eq.CONFIRMADO';
