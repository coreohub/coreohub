import { supabase } from './supabase';
import type { Coupon } from '../types';

export async function listCouponsByEvent(eventId: string): Promise<Coupon[]> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createCoupon(input: {
  event_id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_uses?: number | null;
  expires_at?: string | null;
  // Tier 2/3: workshop e video_selection adicionados em 2026-05-19/2026-05-20.
  scope?: 'inscription' | 'audience' | 'workshop' | 'video_selection' | 'both' | 'all';
}): Promise<Coupon> {
  const { data, error } = await supabase
    .from('coupons')
    .insert({
      ...input,
      code: input.code.trim().toUpperCase(),
      scope: input.scope ?? 'inscription',
    })
    .select()
    .single();
  if (error) throw error;
  return data as Coupon;
}

export async function updateCoupon(id: string, patch: Partial<Coupon>): Promise<void> {
  const { error } = await supabase.from('coupons').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCoupon(id: string): Promise<void> {
  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Valida um cupom para um evento e retorna o desconto calculado sobre o valor base.
 * Lança erro com mensagem amigável se inválido.
 *
 * Passe `userId` pra ativar checagem de `max_uses_per_user` (boa prática
 * Sympla/MP — limita re-uso do mesmo cupom pelo mesmo inscrito). Sem userId,
 * só valida limites globais. Server (edge function) re-valida com userId
 * mesmo se cliente omitir.
 */
export async function validateCoupon(
  eventId: string,
  code: string,
  baseValue: number,
  userId?: string,
): Promise<{ coupon: Coupon; discount: number; finalValue: number }> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) throw new Error('Informe o código do cupom.');

  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('event_id', eventId)
    .eq('code', normalizedCode)
    .eq('is_active', true)
    .in('scope', ['inscription', 'both'])
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Cupom inválido ou inativo.');

  const coupon = data as Coupon;

  if (coupon.expires_at) {
    const expiresAt = new Date(coupon.expires_at + 'T23:59:59');
    if (expiresAt.getTime() < Date.now()) throw new Error('Cupom expirado.');
  }

  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
    throw new Error('Cupom esgotado.');
  }

  // Limite por inscrito (20260605). Conta payments do mesmo user+coupon que
  // já foram pagos OU redimidos (coupon_redeemed_at). Inclui faturas legacy
  // pré-2026-06-04 via status=APROVADO.
  const maxPerUser = (coupon as any).max_uses_per_user as number | null | undefined;
  if (maxPerUser != null && userId) {
    const { count, error: cntErr } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', coupon.id)
      .eq('user_id', userId)
      .in('status', ['APROVADO', 'PENDENTE']);
    if (cntErr) {
      console.warn('[validateCoupon] erro contar usos por user:', cntErr.message);
      // Não bloqueia — falha graciosa. Server re-valida.
    } else if ((count ?? 0) >= maxPerUser) {
      throw new Error(`Você já usou este cupom o limite permitido (${maxPerUser}x).`);
    }
  }

  const discount = coupon.discount_type === 'percent'
    ? parseFloat((baseValue * (coupon.discount_value / 100)).toFixed(2))
    : Math.min(coupon.discount_value, baseValue);

  const finalValue = parseFloat(Math.max(0, baseValue - discount).toFixed(2));

  return { coupon, discount, finalValue };
}
