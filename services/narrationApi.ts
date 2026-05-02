/**
 * Cliente HTTP pra Edge Function generate-narration.
 *
 * Chamadas autenticadas via session do produtor (JWT no Authorization header).
 * Usado pela Mesa de Som pra:
 *   - Gerar 1 audio por coreografia (entrada ou saida)
 *   - Gerar lote (todas de uma vez ao fechar setlist)
 *   - Deletar audio (regerar ou remover)
 *
 * Narração tem 2 tipos:
 *   - 'entrada' (default): longa, ficha tecnica completa
 *   - 'saida'           : curta, agradecimento/transicao (opt-in por evento)
 */

import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';

const NARR_FN_URL = `${supabaseUrl}/functions/v1/generate-narration`;

export type NarrationKind = 'entrada' | 'saida';

const callFn = async (body: Record<string, unknown>) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('not_authenticated');

  const res = await fetch(NARR_FN_URL, {
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

export interface GeneratedAudio {
  ok: boolean;
  audio_url?: string;
  duration_seconds?: number;
  kind?: NarrationKind;
  error?: string;
}

export interface BatchItem {
  registration_id: string;
  text: string;
  kind?: NarrationKind;
}

export interface BatchResult {
  ok: boolean;
  total: number;
  success: number;
  failed: number;
  results: Array<{
    registration_id: string;
    ok: boolean;
    audio_url?: string;
    duration_seconds?: number;
    kind?: NarrationKind;
    error?: string;
  }>;
}

/** Gera 1 audio. Retorna URL pública do WAV + duração estimada. */
export const generateNarration = async (
  event_id: string,
  registration_id: string,
  text: string,
  voice_id?: string,
  kind: NarrationKind = 'entrada',
): Promise<GeneratedAudio> => {
  const { status, data } = await callFn({
    action: 'generate',
    event_id,
    registration_id,
    text,
    voice_id,
    kind,
  });
  if (status !== 200 || !data?.ok) {
    return { ok: false, error: data?.error ?? `http_${status}` };
  }
  return data as GeneratedAudio;
};

/** Gera N audios em batch. Pool de 3 paralelos no servidor. */
export const generateNarrationBatch = async (
  event_id: string,
  items: BatchItem[],
  voice_id?: string,
): Promise<BatchResult> => {
  const { status, data } = await callFn({
    action: 'generate-batch',
    event_id,
    items,
    voice_id,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.error ?? `http_${status}`);
  }
  return data as BatchResult;
};

/** Remove audio do Storage + row da tabela. Se kind omitido, remove ambos. */
export const deleteNarration = async (
  event_id: string,
  registration_id: string,
  kind?: NarrationKind,
): Promise<void> => {
  const { status, data } = await callFn({
    action: 'delete',
    event_id,
    registration_id,
    kind,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.error ?? `http_${status}`);
  }
};

/** Busca todos os audios pre-renderizados do evento (entrada + saida). */
export const fetchNarrationAudios = async (event_id: string) => {
  const { data, error } = await supabase
    .from('narration_audios')
    .select('registration_id, kind, audio_url, duration_seconds, voice_id, created_at')
    .eq('event_id', event_id);
  if (error) throw error;
  return data ?? [];
};
