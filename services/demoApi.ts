/**
 * Cliente HTTP pra Edge Function seed-demo-event.
 *
 * Permite produtor:
 *   - Verificar se já tem demo (status)
 *   - Criar/regerar evento demo (create)
 *   - Remover evento demo (delete)
 *
 * Auth via JWT do produtor (Authorization Bearer).
 */

import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';

const FN_URL = `${supabaseUrl}/functions/v1/seed-demo-event`;

const callFn = async (body: Record<string, unknown>) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('not_authenticated');

  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

export interface DemoStatus {
  has_demo: boolean;
  demo: { id: string; name: string; created_at: string } | null;
}

export const demoStatus = async (): Promise<DemoStatus> => {
  const { status, data } = await callFn({ action: 'status' });
  if (status !== 200 || !data?.ok) throw new Error(data?.error ?? 'failed');
  return { has_demo: data.has_demo, demo: data.demo };
};

export interface DemoCreateResult {
  event_id: string;
  stats: {
    coreografias: number;
    jurados: number;
    prêmios: number;
    estilos: number;
  };
}

export const demoCreate = async (): Promise<DemoCreateResult> => {
  const { status, data } = await callFn({ action: 'create' });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.error ?? 'failed');
  }
  return { event_id: data.event_id, stats: data.stats };
};

export const demoDelete = async (): Promise<void> => {
  const { status, data } = await callFn({ action: 'delete' });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.error ?? 'failed');
  }
};
