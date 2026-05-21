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
