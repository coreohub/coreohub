/**
 * Phase 5 — Offline-first store (IndexedDB).
 *
 * Stores:
 *  - terminal_cache: snapshot do fetchTerminalData (1 row, key='current').
 *    Permite cold-start offline e SWR no hot path.
 *  - previous_evaluations: notas já submetidas, indexadas por registration_id.
 *    Sobrevive a reload — evita re-submissão no histórico do jurado.
 *  - outbox: fila de operações pendentes (submit-evaluation, upload-audio,
 *    submit-star, submit-deliberation). Cada item tem um client_uuid estável.
 *  - audio_blobs: Blobs de áudio aguardando upload, separados pra não inflar
 *    keys da outbox (Blob não é cloneable em alguns browsers).
 *
 * Particionado por judge_id (prefixo das keys) pra permitir múltiplos jurados
 * compartilharem o mesmo tablet sem vazar fila.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'coreohub-judge';
const DB_VERSION = 1;

export type OutboxOp =
  | 'submit-evaluation'
  | 'upload-audio'
  | 'submit-star'
  | 'submit-deliberation';

export type OutboxStatus = 'pending' | 'syncing' | 'failed';

export interface OutboxItem {
  /** UUID v4 estável — usado também como evaluations.client_uuid quando aplicável. */
  client_uuid: string;
  judge_id: string;
  op: OutboxOp;
  /** Payload já no formato esperado pela edge function. */
  payload: Record<string, unknown>;
  attempts: number;
  /** ms epoch — drainer só tenta quando Date.now() >= next_retry_at */
  next_retry_at: number;
  created_at: number;
  status: OutboxStatus;
  last_error?: string;
  /** Para upload-audio: client_uuid da evaluation que vai consumir esse audio_url. */
  evaluation_uuid?: string;
}

export interface AudioBlob {
  client_uuid: string;
  judge_id: string;
  registration_id: string;
  blob: Blob;
  created_at: number;
}

export interface TerminalCacheRow {
  key: 'current';
  judge_id: string;
  data: unknown;
  cached_at: number;
}

export interface PreviousEvaluation {
  registration_id: string;
  judge_id: string;
  final_weighted_average: number | null;
  submitted_at: string;
}

interface CoreoHubJudgeDB extends DBSchema {
  terminal_cache: {
    key: 'current';
    value: TerminalCacheRow;
  };
  previous_evaluations: {
    key: string; // composite `${judge_id}::${registration_id}`
    value: PreviousEvaluation;
    indexes: { 'by-judge': string };
  };
  outbox: {
    key: string; // client_uuid
    value: OutboxItem;
    indexes: { 'by-judge-status': [string, OutboxStatus]; 'by-status': OutboxStatus };
  };
  audio_blobs: {
    key: string; // client_uuid
    value: AudioBlob;
    indexes: { 'by-judge': string };
  };
}

let dbPromise: Promise<IDBPDatabase<CoreoHubJudgeDB>> | null = null;

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<CoreoHubJudgeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('terminal_cache')) {
          db.createObjectStore('terminal_cache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('previous_evaluations')) {
          const s = db.createObjectStore('previous_evaluations', {
            // key composite via fn manual
          });
          s.createIndex('by-judge', 'judge_id');
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const s = db.createObjectStore('outbox', { keyPath: 'client_uuid' });
          s.createIndex('by-judge-status', ['judge_id', 'status']);
          s.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('audio_blobs')) {
          const s = db.createObjectStore('audio_blobs', { keyPath: 'client_uuid' });
          s.createIndex('by-judge', 'judge_id');
        }
      },
    });
  }
  return dbPromise;
};

/* ─── terminal_cache ──────────────────────────────────────────────────────── */

export const saveTerminalCache = async (judge_id: string, data: unknown) => {
  const db = await getDB();
  await db.put('terminal_cache', {
    key: 'current',
    judge_id,
    data,
    cached_at: Date.now(),
  });
};

export const readTerminalCache = async (
  judge_id: string,
): Promise<{ data: unknown; cached_at: number } | null> => {
  const db = await getDB();
  const row = await db.get('terminal_cache', 'current');
  if (!row || row.judge_id !== judge_id) return null;
  return { data: row.data, cached_at: row.cached_at };
};

/* ─── previous_evaluations ────────────────────────────────────────────────── */

const prevKey = (judge_id: string, registration_id: string) =>
  `${judge_id}::${registration_id}`;

export const upsertPreviousEvaluations = async (
  judge_id: string,
  rows: Omit<PreviousEvaluation, 'judge_id'>[],
) => {
  const db = await getDB();
  const tx = db.transaction('previous_evaluations', 'readwrite');
  await Promise.all(
    rows.map((r) =>
      tx.store.put({ ...r, judge_id }, prevKey(judge_id, r.registration_id)),
    ),
  );
  await tx.done;
};

export const readPreviousEvaluations = async (
  judge_id: string,
): Promise<PreviousEvaluation[]> => {
  const db = await getDB();
  return await db.getAllFromIndex('previous_evaluations', 'by-judge', judge_id);
};

/* ─── outbox ──────────────────────────────────────────────────────────────── */

export const enqueue = async (item: Omit<OutboxItem, 'attempts' | 'next_retry_at' | 'created_at' | 'status'>) => {
  const db = await getDB();
  await db.put('outbox', {
    ...item,
    attempts: 0,
    next_retry_at: Date.now(),
    created_at: Date.now(),
    status: 'pending',
  });
};

export const updateOutboxItem = async (
  client_uuid: string,
  patch: Partial<OutboxItem>,
) => {
  const db = await getDB();
  const existing = await db.get('outbox', client_uuid);
  if (!existing) return;
  await db.put('outbox', { ...existing, ...patch });
};

export const removeOutboxItem = async (client_uuid: string) => {
  const db = await getDB();
  await db.delete('outbox', client_uuid);
};

export const listOutbox = async (judge_id: string): Promise<OutboxItem[]> => {
  const db = await getDB();
  const all = await db.getAll('outbox');
  return all.filter((i) => i.judge_id === judge_id);
};

export const listDrainable = async (now = Date.now()): Promise<OutboxItem[]> => {
  const db = await getDB();
  const all = await db.getAll('outbox');
  return all
    .filter((i) => i.status !== 'failed' && i.next_retry_at <= now)
    .sort((a, b) => a.created_at - b.created_at);
};

/* ─── audio_blobs ─────────────────────────────────────────────────────────── */

export const putAudioBlob = async (item: AudioBlob) => {
  const db = await getDB();
  await db.put('audio_blobs', item);
};

export const getAudioBlob = async (client_uuid: string): Promise<AudioBlob | undefined> => {
  const db = await getDB();
  return await db.get('audio_blobs', client_uuid);
};

export const removeAudioBlob = async (client_uuid: string) => {
  const db = await getDB();
  await db.delete('audio_blobs', client_uuid);
};

/* ─── helpers ─────────────────────────────────────────────────────────────── */

/** Gera UUID v4 — usado como client_uuid e id de outbox item. */
export const newUuid = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback legacy (não roda em browsers que não suportam — só pra TS happy)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/** Backoff exponencial em ms: 1s → 5s → 15s → 60s → 300s (cap). */
export const computeBackoff = (attempts: number): number => {
  const ladder = [1_000, 5_000, 15_000, 60_000, 300_000];
  return ladder[Math.min(attempts, ladder.length - 1)];
};

/** Limpa toda a fila do jurado (recovery manual com confirmação dupla). */
export const purgeJudgeOutbox = async (judge_id: string) => {
  const db = await getDB();
  const items = await listOutbox(judge_id);
  const tx = db.transaction(['outbox', 'audio_blobs'], 'readwrite');
  await Promise.all([
    ...items.map((i) => tx.objectStore('outbox').delete(i.client_uuid)),
    ...items.map((i) => tx.objectStore('audio_blobs').delete(i.client_uuid)),
  ]);
  await tx.done;
};
