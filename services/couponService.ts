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
}): Promise<Coupon> {
  const { data, error } = await supabase
    .from('coupons')
    .insert({
      ...input,
      code: input.code.trim().toUpperCase(),
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
 */
export async function validateCoupon(
  eventId: string,
  code: string,
  baseValue: number,
): Promise<{ coupon: Coupon; discount: number; finalValue: number }> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) throw new Error('Informe o código do cupom.');

  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('event_id', eventId)
    .eq('code', normalizedCode)
    .eq('is_active', true)
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

  const discount = coupon.discount_type === 'percent'
    ? parseFloat((baseValue * (coupon.discount_value / 100)).toFixed(2))
    : Math.min(coupon.discount_value, baseValue);

  const finalValue = parseFloat(Math.max(0, baseValue - discount).toFixed(2));

  return { coupon, discount, finalValue };
}
