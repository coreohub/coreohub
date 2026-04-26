import { supabase } from './supabase';

const SUPABASE_URL = 'https://ghpltzzijlvykiytwslu.supabase.co';

export interface RefundResult {
  success: boolean;
  refund_id: string;
  refund_amount: number;
  refund_status: string;
}

export async function refundRegistration(input: {
  registration_id: string;
  amount?: number;        // omitido = reembolso total
  reason?: string;
}): Promise<RefundResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada. Faça login novamente.');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/refund-asaas-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Erro ao processar reembolso.');
  return data;
}
