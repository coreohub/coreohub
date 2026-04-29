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

export interface TerminalData {
  event: { id: string; name: string; slug: string | null; status: string | null } | null;
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

export const submitEvaluation = async (payload: {
  registration_id: string;
  scores: Record<string, number>;
  criteria_weights: any[];
  final_weighted_average: number | null;
  audio_url: string | null;
  submitted_at: string;
  created_at: string;
  audit_log: any;
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
