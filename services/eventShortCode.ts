/**
 * Fase 5 — Vanity URLs / Short Codes.
 *
 * Produtor reserva um code curto (ex: "usualdance") → ganha link super curto
 *   https://app.coreohub.com/u/usualdance
 * Redireciona pra /evento/<slug> do evento associado.
 *
 * Diferente do slug do evento (que muda quando produtor edita o nome do festival),
 * o code é uma identidade independente — ideal pra cartão de visita, bio Insta,
 * material impresso.
 *
 * Reusa RESERVED_SLUGS do eventSlug.ts pra não permitir code que colida com rota
 * existente (admin, login, evento, etc).
 */

import { supabase } from './supabase';
import { RESERVED_SLUGS } from './eventSlug';

/**
 * Valida formato e palavras reservadas. Retorna mensagem de erro ou null.
 */
export const validateShortCodeInput = (code: string): string | null => {
  if (!code || code.length < 2) return 'Mínimo 2 caracteres.';
  if (code.length > 30) return 'Máximo 30 caracteres.';
  if (!/^[a-z0-9-]+$/.test(code)) return 'Use apenas letras minúsculas, números e hífen.';
  if (code.startsWith('-') || code.endsWith('-')) return 'Não pode começar nem terminar com hífen.';
  if (code.includes('--')) return 'Não pode ter dois hífens seguidos.';
  if (RESERVED_SLUGS.has(code)) return 'Esse nome é reservado pelo sistema. Escolha outro.';
  return null;
};

/**
 * Disponibilidade: code não pode estar em uso em event_short_codes nem em
 * events.slug (pra não conflitar com /evento/:slug). ignoreShortCodeId quando
 * editando o próprio code.
 */
export const isShortCodeAvailable = async (code: string, ignoreShortCodeId?: string): Promise<boolean> => {
  // 1) já existe outro short code com esse mesmo valor?
  let codeQuery = supabase.from('event_short_codes').select('id').eq('code', code);
  if (ignoreShortCodeId) codeQuery = codeQuery.neq('id', ignoreShortCodeId);
  const codeRes = await codeQuery.maybeSingle();
  if (codeRes.data) return false;

  // 2) algum evento usa esse valor como slug? evitamos colisão com /evento/:slug
  const slugRes = await supabase.from('events').select('id').eq('slug', code).maybeSingle();
  if (slugRes.data) return false;

  return true;
};

/**
 * Resolve um short code → event_id + slug atual. Usado pela rota /u/:code.
 */
export const resolveShortCode = async (code: string): Promise<{ event_id: string; slug: string | null } | null> => {
  const { data } = await supabase
    .from('event_short_codes')
    .select('event_id, events(slug)')
    .eq('code', code)
    .maybeSingle();
  if (!data) return null;
  const slug = (data as any).events?.slug ?? null;
  return { event_id: (data as any).event_id, slug };
};
