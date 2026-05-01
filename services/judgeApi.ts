/**
 * Cliente HTTP pra Edge Function judge-login (Phase 2A).
 *
 * Centraliza chamadas autenticadas via producer_token + judge_id (lidos do
 * localStorage da sessão de jurado salva pelo /judge-login).
 */

import { supabaseUrl, supabaseAnonKey } from './supabase';
import { readJudgeSession } from '../pages/JudgeLogin';

const JUDGE_FN_URL = `${supabaseUrl}/functions/v1/judge-login`;

const callJudgeFn = async (body: Record<string, unknown>) => {
  const res = await fetch(JUDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

/** Garante que a sessão de jurado existe e retorna { token, judge_id }. */
const requireJudgeSession = () => {
  const s = readJudgeSession();
  if (!s) throw new Error('judge_session_required');
  return { token: s.producer_token, judge_id: s.judge_id };
};

export type DeliberationStatus = 'COLETANDO' | 'DELIBERACAO' | 'CONFERENCIA' | 'LIBERADO';

export interface TerminalEvent {
  id: string;
  name: string;
  slug: string | null;
  status: string | null;
  deliberation_status?: DeliberationStatus;
  conferencia_started_at?: string | null;
  conferencia_duration_seconds?: number;
}

export interface TerminalData {
  event: TerminalEvent | null;
  judge: {
    id: string;
    name: string;
    language: string;
    competencias_generos: string[];
    competencias_formatos: string[];
  };
  judges: any[];
  config: {
    regras_avaliacao?: any;
    escala_notas?: string;
    premios_especiais?: any;
    pin_inactivity_minutes?: number;
  } | null;
  registrations: any[];
  event_styles: { id: string; name: string }[];
  marcacoes: { registration_id: string }[];
}

export const fetchTerminalData = async (): Promise<TerminalData> => {
  const { token, judge_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({ action: 'get-terminal-data', token, judge_id });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_load');
  }
  return data as TerminalData;
};

export const fetchPreviousEvaluations = async (registration_ids?: string[]) => {
  const { token, judge_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({
    action: 'get-previous-evaluations',
    token,
    judge_id,
    registration_ids,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_load');
  }
  return data.evaluations as Array<{
    registration_id: string;
    final_weighted_average: number | null;
    submitted_at: string;
  }>;
};

export interface JudgeHighlight {
  tipo_destaque: string;
  award_name?: string | null;
}

export const submitEvaluation = async (payload: {
  registration_id: string;
  scores: Record<string, number>;
  criteria_weights: any[];
  final_weighted_average: number | null;
  audio_url: string | null;
  submitted_at: string;
  created_at: string;
  audit_log: any;
  highlights?: JudgeHighlight[];
}) => {
  const { token, judge_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({
    action: 'submit-evaluation',
    token,
    judge_id,
    payload,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_submit');
  }
};

/**
 * Faz upload do áudio de feedback via Edge Function (multipart/form-data).
 * Retorna a URL pública pra ser usada em audio_url da evaluation.
 *
 * Phase 2B: jurado sem produtor logado não pode usar Storage direto, então
 * a Edge Function valida sessão e faz upload com service-role.
 */
export const uploadAudio = async (registrationId: string, blob: Blob): Promise<string> => {
  const { token, judge_id } = requireJudgeSession();
  const form = new FormData();
  form.append('token', token);
  form.append('judge_id', judge_id);
  form.append('registration_id', registrationId);
  form.append('audio', blob, 'feedback.webm');

  const res = await fetch(JUDGE_FN_URL, {
    method: 'POST',
    headers: {
      // NÃO setar Content-Type — browser cuida do boundary do multipart
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || !data?.ok || !data?.audio_url) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_upload_audio');
  }
  return data.audio_url as string;
};

/* ─── Phase 3 — Deliberação de prêmios especiais ────────────────────────── */

export interface StarredAward {
  id: string;
  name: string;
  enabled: boolean;
  isTemplate?: boolean;
  formation?: string;
  description?: string;
}

export interface StarredRegistration {
  id: string;
  nome_coreografia: string;
  estudio: string;
  estilo_danca: string;
  categoria: string;
  tipo_apresentacao?: string;
  formacao?: string;
}

export interface StarredData {
  event: TerminalEvent | null;
  marcacoes: { registration_id: string; created_at: string }[];
  deliberations: { registration_id: string; award_id: string; award_name: string }[];
  registrations: StarredRegistration[];
  awards: StarredAward[];
}

export interface DeliberationAttribution {
  registration_id: string;
  award_id: string;
  award_name: string;
}

export interface ConferenciaData {
  event: TerminalEvent | null;
  mine: { registration_id: string; award_id: string; award_name: string }[];
  aggregate: {
    registration_id: string;
    award_id: string;
    award_name: string;
    judge_count: number;
  }[];
  registrations: {
    id: string;
    nome_coreografia: string;
    estudio: string;
    estilo_danca: string;
    categoria: string;
  }[];
}

/** Toggle estrela na apresentação atual. Retorna estado novo (starred). */
export const toggleStar = async (registration_id: string): Promise<boolean> => {
  const { token, judge_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({
    action: 'submit-star',
    token,
    judge_id,
    registration_id,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_star');
  }
  return Boolean(data.starred);
};

/** Lista marcações + deliberações já feitas pelo jurado (pra tela /deliberacao). */
export const fetchStarred = async (): Promise<StarredData> => {
  const { token, judge_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({ action: 'get-starred', token, judge_id });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_load');
  }
  return data as StarredData;
};

/** Submete o conjunto completo de atribuições jurado→prêmio (substitui anterior). */
export const submitDeliberation = async (attributions: DeliberationAttribution[]) => {
  const { token, judge_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({
    action: 'submit-deliberation',
    token,
    judge_id,
    attributions,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_submit_deliberation');
  }
  return data.count as number;
};

/** Atribuições do jurado + agregado anônimo do evento (pra tela /conferencia). */
export const fetchConferencia = async (): Promise<ConferenciaData> => {
  const { token, judge_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({ action: 'get-conferencia', token, judge_id });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_load');
  }
  return data as ConferenciaData;
};
