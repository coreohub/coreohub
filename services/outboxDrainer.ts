/**
 * Phase 5 — Outbox drainer.
 *
 * Pega itens da fila local e tenta empurrar pra edge function. Backoff
 * exponencial por item, ordem FIFO via created_at, concorrência 1 pra
 * preservar ordem dentro do mesmo jurado.
 *
 * Trigger sources:
 *   - window 'online' event
 *   - document 'visibilitychange' (volta da background)
 *   - timer interno 10s (failsafe — eventos podem perder)
 *   - chamada explícita do UI (botão "Tentar agora")
 *
 * Política de áudio (best-effort, não bloqueia nota):
 *   - upload-audio: 5 tentativas. Se falhar todas, marca eval dependente com
 *     audio_url=null + audit_log.audio_dropped=true e segue.
 *
 * Política de submit-evaluation:
 *   - 8 tentativas. Após esgotar, marca status='failed' (recovery manual).
 *
 * Política de stars/deliberation:
 *   - 8 tentativas. Já são idempotentes do lado servidor (sem client_uuid).
 */

import {
  computeBackoff,
  getAudioBlob,
  getOutboxItem,
  listDrainable,
  removeAudioBlob,
  removeOutboxItem,
  updateOutboxItem,
  type OutboxItem,
} from './offlineStore';

import {
  submitEvaluation,
  toggleStar,
  submitDeliberation,
  uploadAudio,
} from './judgeApi';

import { readJudgeSession } from '../pages/JudgeLogin';

const MAX_AUDIO_ATTEMPTS = 5;
const MAX_DEFAULT_ATTEMPTS = 8;
const TIMER_INTERVAL_MS = 10_000;

/** Eventos disparados pelo drainer pra UI escutar. */
type DrainerEvent =
  | { type: 'drain-start' }
  | { type: 'drain-end'; processed: number; failed: number }
  | { type: 'item-success'; client_uuid: string; op: string }
  | { type: 'item-failed'; client_uuid: string; op: string; permanent: boolean };

type Listener = (e: DrainerEvent) => void;

const listeners = new Set<Listener>();

export const subscribeDrainer = (l: Listener): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const emit = (e: DrainerEvent) => {
  listeners.forEach((l) => {
    try { l(e); } catch { /* listener error é problema do listener */ }
  });
};

let draining = false;
let timer: ReturnType<typeof setInterval> | null = null;
let bootstrapped = false;

const isOnline = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine !== false;

const maxAttempts = (op: OutboxItem['op']) =>
  op === 'upload-audio' ? MAX_AUDIO_ATTEMPTS : MAX_DEFAULT_ATTEMPTS;

/** Quando áudio falha permanentemente, atualiza eval dependente pra seguir sem áudio. */
const handleAudioPermanentFailure = async (audio: OutboxItem) => {
  const evalUuid = audio.evaluation_uuid;
  await removeAudioBlob(audio.client_uuid);
  await removeOutboxItem(audio.client_uuid);
  if (!evalUuid) return;
  const drainable = await listDrainable(Date.now() + 1); // pega tudo
  const dependent = drainable.find((i) => i.client_uuid === evalUuid);
  if (!dependent) return;
  const payload = dependent.payload as Record<string, unknown>;
  const auditLog = (payload.audit_log as Record<string, unknown>) ?? {};
  await updateOutboxItem(evalUuid, {
    payload: {
      ...payload,
      audio_url: null,
      audit_log: { ...auditLog, audio_dropped: true },
      pending_audio_uuid: undefined,
    },
    next_retry_at: Date.now(), // libera imediatamente
  });
};

/** Tenta uma operação. Retorna true se sucesso, false se transient, throws se 4xx. */
const dispatch = async (item: OutboxItem): Promise<{ ok: true; result?: unknown }> => {
  switch (item.op) {
    case 'upload-audio': {
      const blob = await getAudioBlob(item.client_uuid);
      if (!blob) {
        // Sem blob local — não tem o que subir. Marca como sucesso pra liberar a eval.
        return { ok: true, result: null };
      }
      const audioUrl = await uploadAudio(blob.registration_id, blob.blob);
      return { ok: true, result: audioUrl };
    }
    case 'submit-evaluation': {
      const payload = item.payload as Record<string, unknown>;
      // Se ainda tem dependência de áudio pendente, pula esta rodada.
      if (payload.pending_audio_uuid) {
        const audio = await getAudioBlob(payload.pending_audio_uuid as string);
        if (audio) {
          throw new Error('waiting_for_audio');
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await submitEvaluation(payload as any);
      return { ok: true };
    }
    case 'submit-star': {
      const { registration_id } = item.payload as { registration_id: string };
      await toggleStar(registration_id);
      return { ok: true };
    }
    case 'submit-deliberation': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attributions = (item.payload as any).attributions ?? [];
      await submitDeliberation(attributions);
      return { ok: true };
    }
  }
};

const processItem = async (rawItem: OutboxItem) => {
  // Relê do IndexedDB antes de processar — `rawItem` pode ser uma cópia
  // capturada no início do drain, já obsoleta se um upload-audio anterior
  // (processado antes, na MESMA rodada) já tiver patchado o audio_url deste
  // item. Sem isso, a nota subia sempre com audio_url:null mesmo quando o
  // áudio já tinha sido enviado com sucesso segundos antes.
  const item = (await getOutboxItem(rawItem.client_uuid)) ?? rawItem;

  // Pré-check: eval esperando upload de áudio. Se blob ainda existe, pula
  // sem incrementar attempts (senão a eval esgota MAX_ATTEMPTS só esperando
  // o áudio que tem ladder de retry própria).
  if (item.op === 'submit-evaluation') {
    const payload = item.payload as Record<string, unknown>;
    const pendingAudioUuid = payload.pending_audio_uuid as string | undefined;
    if (pendingAudioUuid) {
      const audio = await getAudioBlob(pendingAudioUuid);
      if (audio) {
        // Reagenda pra ~3s no futuro pra dar tempo do upload completar
        await updateOutboxItem(item.client_uuid, { next_retry_at: Date.now() + 3_000 });
        return { success: false, permanent: false };
      }
    }
  }

  await updateOutboxItem(item.client_uuid, { status: 'syncing' });
  try {
    const result = await dispatch(item);

    if (item.op === 'upload-audio' && item.evaluation_uuid && result.result) {
      // Patcha eval dependente com audio_url real
      const audioUrl = result.result as string;
      const drainable = await listDrainable(Date.now() + 1);
      const dependent = drainable.find((i) => i.client_uuid === item.evaluation_uuid);
      if (dependent) {
        const payload = dependent.payload as Record<string, unknown>;
        await updateOutboxItem(item.evaluation_uuid, {
          payload: { ...payload, audio_url: audioUrl, pending_audio_uuid: undefined },
          next_retry_at: Date.now(),
        });
      }
      await removeAudioBlob(item.client_uuid);
    }

    await removeOutboxItem(item.client_uuid);
    emit({ type: 'item-success', client_uuid: item.client_uuid, op: item.op });
    return { success: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[outboxDrainer] falha em ${item.op} (tentativa ${item.attempts + 1}):`, errMsg);
    const nextAttempts = item.attempts + 1;
    const cap = maxAttempts(item.op);

    if (nextAttempts >= cap) {
      // Falha permanente
      if (item.op === 'upload-audio') {
        await handleAudioPermanentFailure(item);
        emit({ type: 'item-failed', client_uuid: item.client_uuid, op: item.op, permanent: true });
        return { success: false, permanent: true };
      }
      await updateOutboxItem(item.client_uuid, {
        status: 'failed',
        attempts: nextAttempts,
        last_error: errMsg,
      });
      emit({ type: 'item-failed', client_uuid: item.client_uuid, op: item.op, permanent: true });
      return { success: false, permanent: true };
    }

    await updateOutboxItem(item.client_uuid, {
      status: 'pending',
      attempts: nextAttempts,
      next_retry_at: Date.now() + computeBackoff(nextAttempts),
      last_error: errMsg,
    });
    emit({ type: 'item-failed', client_uuid: item.client_uuid, op: item.op, permanent: false });
    return { success: false, permanent: false };
  }
};

/** Drena a outbox uma vez. No-op se offline, já drenando ou sem sessão de jurado. */
export const drainOutbox = async () => {
  if (draining) return;
  if (!isOnline()) return;
  // Phase 5: só drena fila do jurado atualmente logado. Em tablet compartilhado,
  // se jurado A submeteu e jurado B logou antes da rede voltar, a fila de A
  // ficaria submetida com credenciais de B (judge_id é override no servidor).
  // Itens órfãos esperam o jurado original voltar a logar.
  const session = readJudgeSession();
  if (!session) return;

  draining = true;
  emit({ type: 'drain-start' });

  let processed = 0;
  let failed = 0;
  try {
    const all = await listDrainable();
    const items = all.filter((i) => i.judge_id === session.judge_id);
    // FIFO por created_at, com upload-audio tendo prioridade sutil
    items.sort((a, b) => {
      if (a.op === 'upload-audio' && b.op !== 'upload-audio') return -1;
      if (a.op !== 'upload-audio' && b.op === 'upload-audio') return 1;
      return a.created_at - b.created_at;
    });

    for (const item of items) {
      const r = await processItem(item);
      if (r.success) processed++;
      else failed++;
      // Se ficou offline no meio, para
      if (!isOnline()) break;
    }
  } finally {
    draining = false;
    emit({ type: 'drain-end', processed, failed });
  }
};

/** Bootstrapa listeners globais (online, visibility, timer). Chamar 1x no app. */
export const startDrainer = () => {
  if (bootstrapped || typeof window === 'undefined') return;
  bootstrapped = true;

  const trigger = () => { void drainOutbox(); };

  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trigger();
  });
  timer = setInterval(trigger, TIMER_INTERVAL_MS);

  // Drain inicial assim que app sobe
  trigger();
};

export const stopDrainer = () => {
  if (timer) clearInterval(timer);
  timer = null;
  bootstrapped = false;
};
