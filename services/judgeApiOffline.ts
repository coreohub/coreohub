/**
 * Phase 5 — Offline-first wrapper sobre judgeApi.
 *
 * O JudgeTerminal e telas de jurado chamam essa camada em vez de bater direto
 * na edge function. Aqui:
 *  - Submissões viram itens de outbox (sync em background pelo drainer)
 *  - Leitura usa SWR contra IndexedDB cache
 *  - UI avança imediatamente (optimistic) — sem esperar rede
 *
 * Mantém judgeApi.ts intocado pra ser o "SDK direto" usado pelo drainer.
 */

import {
  enqueue,
  listOutbox,
  newUuid,
  putAudioBlob,
  removeAudioBlob,
  removeOutboxItem,
  saveTerminalCache,
  readTerminalCache,
  upsertPreviousEvaluations,
  readPreviousEvaluations,
  type OutboxItem,
} from './offlineStore';

import {
  fetchTerminalData,
  fetchPreviousEvaluations,
  type SubmitEvaluationPayload,
  type DeliberationAttribution,
  type TerminalData,
} from './judgeApi';

import { drainOutbox } from './outboxDrainer';

import { readJudgeSession } from '../pages/JudgeLogin';

const judgeIdOrThrow = (): string => {
  const s = readJudgeSession();
  if (!s) throw new Error('judge_session_required');
  return s.judge_id;
};

/* ─── submit evaluation (com áudio opcional) ──────────────────────────────── */

export interface EnqueueEvaluationInput {
  /** Payload já no formato da edge function — SEM client_uuid (gerado aqui). */
  evalPayload: Omit<SubmitEvaluationPayload, 'client_uuid' | 'audio_url'>;
  /** Blob de áudio opcional. Se presente, sobe primeiro e a eval espera. */
  audioBlob?: Blob | null;
}

export const enqueueEvaluation = async ({
  evalPayload,
  audioBlob,
}: EnqueueEvaluationInput): Promise<{ client_uuid: string }> => {
  const judge_id = judgeIdOrThrow();
  const evalUuid = newUuid();

  let audioUuid: string | null = null;
  let audioDropped = false;

  if (audioBlob && audioBlob.size > 0) {
    const tentativeUuid = newUuid();
    try {
      // Quota IndexedDB pode estourar (Safari standalone ~50MB). Se falhar,
      // a nota NÃO pode ficar bloqueada — degrada silenciosamente sem áudio.
      await putAudioBlob({
        client_uuid: tentativeUuid,
        judge_id,
        registration_id: evalPayload.registration_id,
        blob: audioBlob,
        created_at: Date.now(),
      });
      audioUuid = tentativeUuid;
      await enqueue({
        client_uuid: audioUuid,
        judge_id,
        op: 'upload-audio',
        payload: { registration_id: evalPayload.registration_id },
        evaluation_uuid: evalUuid,
      });
    } catch (err) {
      console.warn('[Phase5] não foi possível salvar blob de áudio (provavelmente quota cheia):', err);
      audioDropped = true;
    }
  }

  const auditLog = (evalPayload.audit_log as Record<string, unknown>) ?? {};
  await enqueue({
    client_uuid: evalUuid,
    judge_id,
    op: 'submit-evaluation',
    payload: {
      ...evalPayload,
      client_uuid: evalUuid,
      audio_url: null, // patchado pelo drainer quando upload completa
      audit_log: audioDropped ? { ...auditLog, audio_dropped: true } : auditLog,
      ...(audioUuid ? { pending_audio_uuid: audioUuid } : {}),
    },
  });

  // Optimistic: já registra como "submetida" no cache local
  await upsertPreviousEvaluations(judge_id, [
    {
      registration_id: evalPayload.registration_id,
      final_weighted_average: evalPayload.final_weighted_average,
      submitted_at: evalPayload.submitted_at,
    },
  ]);

  // Tenta drenar imediatamente — se online, vai sincronizar antes do drainer timer
  void drainOutbox();

  return { client_uuid: evalUuid };
};

/* ─── star toggle (com colapso) ───────────────────────────────────────────── */

/**
 * Lógica: toggle é par/ímpar. Se já existe um toggle pendente pro mesmo
 * registration, removê-lo equivale a "cancelar" o toggle (par = volta ao estado
 * original). Se não existe, enfileira um novo.
 *
 * Retorna o estado optimisticamente esperado (true = vai marcar, false = vai desmarcar).
 * O caller passa `currentlyStarred` (estado UI atual) pra calcular.
 */
export const enqueueStarToggle = async (
  registration_id: string,
  currentlyStarred: boolean,
): Promise<{ optimistic_starred: boolean }> => {
  const judge_id = judgeIdOrThrow();
  const items = await listOutbox(judge_id);
  const pending = items.find(
    (i) => i.op === 'submit-star' && (i.payload as any).registration_id === registration_id,
  );

  if (pending) {
    // Colapsa: remove o pending → estado volta ao que era ANTES do primeiro click
    await removeOutboxItem(pending.client_uuid);
    return { optimistic_starred: !currentlyStarred };
  }

  await enqueue({
    client_uuid: newUuid(),
    judge_id,
    op: 'submit-star',
    payload: { registration_id },
  });
  void drainOutbox();
  return { optimistic_starred: !currentlyStarred };
};

/* ─── deliberation (replace pattern) ──────────────────────────────────────── */

export const enqueueDeliberation = async (
  attributions: DeliberationAttribution[],
): Promise<void> => {
  const judge_id = judgeIdOrThrow();
  // Remove submits pendentes do mesmo jurado — só o último vale (replace)
  const items = await listOutbox(judge_id);
  const stale = items.filter((i: OutboxItem) => i.op === 'submit-deliberation');
  await Promise.all(stale.map((i) => removeOutboxItem(i.client_uuid)));

  await enqueue({
    client_uuid: newUuid(),
    judge_id,
    op: 'submit-deliberation',
    payload: { attributions },
  });
  void drainOutbox();
};

/* ─── reads SWR ───────────────────────────────────────────────────────────── */

export interface CachedTerminalData {
  data: TerminalData;
  fromCache: boolean;
  cached_at: number | null;
}

/**
 * Stale-while-revalidate: retorna cache imediatamente se existe; em paralelo
 * tenta refresh da rede. Caller recebe via callback quando network resolver.
 *
 * Se offline E sem cache → throw 'no_cache_offline'.
 */
export const fetchTerminalDataSWR = async (
  onFresh?: (fresh: CachedTerminalData) => void,
): Promise<CachedTerminalData> => {
  const judge_id = judgeIdOrThrow();
  const cached = await readTerminalCache(judge_id);

  // Dispara network em paralelo (não await aqui se cache existe)
  const networkPromise = (async () => {
    try {
      const fresh = await fetchTerminalData();
      await saveTerminalCache(judge_id, fresh);
      const result: CachedTerminalData = {
        data: fresh,
        fromCache: false,
        cached_at: Date.now(),
      };
      onFresh?.(result);
      return result;
    } catch (err) {
      // Falha de rede — só relevante se não tinha cache
      if (!cached) throw err;
      return null;
    }
  })();

  if (cached) {
    // Garante que network roda em background mas não bloqueia
    void networkPromise;
    return {
      data: cached.data as TerminalData,
      fromCache: true,
      cached_at: cached.cached_at,
    };
  }

  const fresh = await networkPromise;
  if (!fresh) throw new Error('no_cache_offline');
  return fresh;
};

export const fetchPreviousEvaluationsSWR = async (
  registration_ids?: string[],
): Promise<Array<{ registration_id: string; final_weighted_average: number | null; submitted_at: string }>> => {
  const judge_id = judgeIdOrThrow();
  const cached = await readPreviousEvaluations(judge_id);
  const filteredCached = registration_ids
    ? cached.filter((r) => registration_ids.includes(r.registration_id))
    : cached;

  try {
    const fresh = await fetchPreviousEvaluations(registration_ids);
    if (fresh.length > 0) {
      await upsertPreviousEvaluations(judge_id, fresh);
    }
    // Merge: fresh é canônico mas pode estar atrás do optimistic local
    type Row = { registration_id: string; final_weighted_average: number | null; submitted_at: string };
    const merged = new Map<string, Row>();
    filteredCached.forEach((r) => {
      merged.set(r.registration_id, {
        registration_id: r.registration_id,
        final_weighted_average: r.final_weighted_average,
        submitted_at: r.submitted_at,
      });
    });
    fresh.forEach((r) => merged.set(r.registration_id, r));
    return Array.from(merged.values());
  } catch {
    return filteredCached;
  }
};
