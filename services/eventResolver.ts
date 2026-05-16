/**
 * Helpers pra resolver eventos por UUID OU slug nas rotas /festival/:idOrSlug.
 *
 * Antes da Fase 1 (Padronização de URLs), cada componente fazia seu próprio
 * regex de UUID e .eq() condicional. Centralizar evita drift e bug sutil quando
 * regex de UUID diverge.
 *
 * UUID v4 tem 36 chars com hifens — qualquer outro formato é tratado como slug.
 */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: string | undefined | null): boolean =>
  !!v && UUID_V4_REGEX.test(v);

/** Coluna do banco apropriada pra filtrar — 'id' se for UUID, 'slug' caso contrário. */
export const eventFilterColumn = (idOrSlug: string | undefined | null): 'id' | 'slug' =>
  isUuid(idOrSlug) ? 'id' : 'slug';
