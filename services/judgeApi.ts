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

/** Garante que a sessão de jurado existe e retorna { token, judge_id, event_id }. */
const requireJudgeSession = () => {
  const s = readJudgeSession();
  if (!s) throw new Error('judge_session_required');
  return { token: s.producer_token, judge_id: s.judge_id, event_id: s.event_id };
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
  // Phase 4: âncora central de apresentação ao vivo (Mesa de Som controla)
  live_registration_id?: string | null;
  live_started_at?: string | null;
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
  const { token, judge_id, event_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({ action: 'get-terminal-data', token, judge_id, event_id });
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

export interface SubmitEvaluationPayload {
  registration_id: string;
  scores: Record<string, number>;
  criteria_weights: any[];
  final_weighted_average: number | null;
  audio_url: string | null;
  submitted_at: string;
  created_at: string;
  audit_log: any;
  highlights?: JudgeHighlight[];
  /** Comentário escrito opcional do jurado (complementa o áudio). */
  feedback_text?: string | null;
  /** Phase 5: idempotência. Outbox mantém o mesmo UUID v4 em todos os retries. */
  client_uuid?: string;
}

export const submitEvaluation = async (
  payload: SubmitEvaluationPayload,
): Promise<{ deduplicated: boolean }> => {
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
  return { deduplicated: Boolean(data.deduplicated) };
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

/** Apaga uma marcação órfã (registration já deletada) — diferente de toggleStar,
 *  não exige que a inscrição ainda exista. */
export const removeMarcacao = async (registration_id: string): Promise<void> => {
  const { token, judge_id, event_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({
    action: 'remove-marcacao',
    token,
    judge_id,
    registration_id,
    event_id,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_remove_marcacao');
  }
};

/** Lista marcações + deliberações já feitas pelo jurado (pra tela /deliberacao). */
export const fetchStarred = async (): Promise<StarredData> => {
  const { token, judge_id, event_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({ action: 'get-starred', token, judge_id, event_id });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_load');
  }
  return data as StarredData;
};

/** Submete o conjunto completo de atribuições jurado→prêmio (substitui anterior). */
export const submitDeliberation = async (attributions: DeliberationAttribution[]) => {
  const { token, judge_id, event_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({
    action: 'submit-deliberation',
    token,
    judge_id,
    event_id,
    attributions,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_submit_deliberation');
  }
  return data.count as number;
};

/** Atribuições do jurado + agregado anônimo do evento (pra tela /conferencia). */
export const fetchConferencia = async (): Promise<ConferenciaData> => {
  const { token, judge_id, event_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({ action: 'get-conferencia', token, judge_id, event_id });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_load');
  }
  return data as ConferenciaData;
};

/* ─── Multi-jurado seletiva de vídeo v1.1 (modo blind) ──────────────────────── */

export type VideoDecision = 'approve' | 'reject' | 'conditional';

export interface VideoQueueItem {
  id: string;
  numero: number;
  video_url: string;
  estilo: string | null;
  categoria: string | null;
  formacao: string | null;
  tipo: string | null;
}

export interface VideoMyVote {
  registration_id: string;
  decision: VideoDecision;
  feedback: string | null;
  score: number | null;
}

export interface VideoQueueData {
  event: { id: string; name: string; slug: string | null } | null;
  evaluators_count: number;
  rule: 'majority' | 'unanimous';
  queue: VideoQueueItem[];
  my_votes: VideoMyVote[];
  remaining: number;
  total_voted: number;
}

/** Fila de seletiva de vídeo do jurado (modo blind, só vídeos não votados). */
export const fetchVideoQueue = async (): Promise<VideoQueueData> => {
  const { token, judge_id, event_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({ action: 'get-video-queue', token, judge_id, event_id });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_load');
  }
  return data as VideoQueueData;
};

/** Vota num vídeo da seletiva. score opcional (0-10). Trigger SQL agrega. */
export const submitVideoEvaluation = async (
  registration_id: string,
  decision: VideoDecision,
  opts?: { feedback?: string; score?: number | null },
): Promise<void> => {
  const { token, judge_id } = requireJudgeSession();
  const { data, status } = await callJudgeFn({
    action: 'submit-video-evaluation',
    token,
    judge_id,
    registration_id,
    decision,
    feedback: opts?.feedback,
    score: opts?.score,
  });
  if (status !== 200 || !data?.ok) {
    throw new Error(data?.detail ?? data?.reason ?? 'failed_to_submit_video_evaluation');
  }
};
