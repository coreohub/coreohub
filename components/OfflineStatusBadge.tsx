/**
 * Phase 5 — Bolinha de status do outbox.
 *
 *   🟢 (synced)   — sem itens pendentes, online
 *   🟡 (syncing)  — N pendentes, drainer ativo
 *   🔴 (offline)  — navigator.onLine === false (com ou sem fila)
 *   ⚠️  (failed)  — pelo menos 1 item travou em status='failed'
 *
 * Long-press abre bottom sheet com lista detalhada + ações de recovery.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Wifi, WifiOff, AlertTriangle, Loader2, Check, X, RefreshCw, Trash2 } from 'lucide-react';
import {
  listOutbox,
  removeOutboxItem,
  removeAudioBlob,
  purgeJudgeOutbox,
  readTerminalCache,
  type OutboxItem,
} from '../services/offlineStore';
import { drainOutbox, subscribeDrainer } from '../services/outboxDrainer';
import { readJudgeSession } from '../pages/JudgeLogin';

type Status = 'synced' | 'syncing' | 'offline' | 'failed';

const computeStatus = (online: boolean, items: OutboxItem[]): Status => {
  if (items.some((i) => i.status === 'failed')) return 'failed';
  if (!online) return 'offline';
  if (items.length > 0) return 'syncing';
  return 'synced';
};

const opLabel = (op: OutboxItem['op']): string => {
  switch (op) {
    case 'submit-evaluation': return 'Avaliação';
    case 'upload-audio':      return 'Áudio';
    case 'submit-star':       return 'Destaque ⭐';
    case 'submit-deliberation': return 'Deliberação';
  }
};

const ageLabel = (createdAt: number): string => {
  const sec = Math.floor((Date.now() - createdAt) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  return `há ${h}h`;
};

export const OfflineStatusBadge: React.FC<{ judgeId?: string }> = ({ judgeId: judgeIdProp }) => {
  const judgeId = judgeIdProp ?? readJudgeSession()?.judge_id ?? null;

  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!judgeId) { setItems([]); return; }
    const [list, cache] = await Promise.all([
      listOutbox(judgeId),
      readTerminalCache(judgeId),
    ]);
    setItems(list);
    setCachedAt(cache?.cached_at ?? null);
  }, [judgeId]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = subscribeDrainer(() => { void refresh(); });
    const t = setInterval(refresh, 3000);
    return () => { unsub(); clearInterval(t); };
  }, [refresh]);

  if (!judgeId) return null;

  const status = computeStatus(online, items);
  const pendingCount = items.length;

  const dotClass = ({
    synced: 'bg-emerald-500',
    syncing: 'bg-amber-400 animate-pulse',
    offline: 'bg-rose-500',
    failed: 'bg-rose-600 ring-2 ring-rose-300',
  } as const)[status];

  const handlePressStart = () => {
    longPressTimer.current = setTimeout(() => setSheetOpen(true), 500);
  };
  const handlePressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const handleClick = () => {
    // Click curto também abre — long-press só pra teclado/mouse não suportar
    setSheetOpen(true);
  };

  const retryAll = () => { void drainOutbox(); };

  const removeItem = async (uuid: string) => {
    await removeOutboxItem(uuid);
    await removeAudioBlob(uuid);
    await refresh();
  };

  const purgeAll = async () => {
    const ok = window.confirm(
      `Apagar ${pendingCount} item(ns) da fila local? Notas não enviadas serão perdidas.`,
    );
    if (!ok) return;
    const sure = window.confirm('Isso é definitivo. Confirmar?');
    if (!sure) return;
    await purgeJudgeOutbox(judgeId);
    await refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onMouseLeave={handlePressEnd}
        title={
          status === 'synced' ? 'Sincronizado' :
          status === 'syncing' ? `${pendingCount} sincronizando…` :
          status === 'offline' ? `Offline${pendingCount > 0 ? ` · ${pendingCount} aguardando` : ''}` :
          `${items.filter(i => i.status === 'failed').length} falhas — toque pra resolver`
        }
        className="relative inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-slate-300 dark:border-white/15 bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300"
        aria-label="Status de sincronização"
      >
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        {pendingCount > 0 && (
          <span className="text-[9px] font-black tabular-nums">{pendingCount}</span>
        )}
        {status === 'offline' ? (
          <WifiOff size={12} />
        ) : status === 'failed' ? (
          <AlertTriangle size={12} className="text-rose-600" />
        ) : status === 'syncing' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Wifi size={12} />
        )}
      </button>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 p-5 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                Sincronização
              </h3>
              <button
                onClick={() => setSheetOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-center gap-2 mb-1 text-xs text-slate-600 dark:text-slate-400">
              <span className={`w-2 h-2 rounded-full ${dotClass}`} />
              <span className="font-semibold">
                {status === 'synced' && 'Tudo sincronizado'}
                {status === 'syncing' && `${pendingCount} item(ns) na fila`}
                {status === 'offline' && (pendingCount > 0
                  ? `Offline · ${pendingCount} aguardando rede`
                  : 'Offline (sem pendências)')}
                {status === 'failed' && `${items.filter(i => i.status === 'failed').length} falha(s)`}
              </span>
            </div>
            {cachedAt && (
              <div className="mb-4 text-[10px] text-slate-500 dark:text-slate-500">
                Dados do evento: atualizado {ageLabel(cachedAt)}
              </div>
            )}

            {pendingCount === 0 ? (
              <div className="text-center py-6 text-slate-500 dark:text-slate-400 text-sm">
                <Check size={32} className="mx-auto mb-2 text-emerald-500" />
                Nenhuma pendência local.
              </div>
            ) : (
              <ul className="space-y-2 mb-4">
                {items.map((i) => (
                  <li
                    key={i.client_uuid}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-white/10"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        {opLabel(i.op)}
                        {i.status === 'failed' && (
                          <span className="ml-2 text-[9px] uppercase tracking-widest text-rose-500">falhou</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {ageLabel(i.created_at)} · {i.attempts} tentativa(s)
                        {i.last_error ? ` · ${i.last_error.slice(0, 40)}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => void removeItem(i.client_uuid)}
                      title="Descartar este item"
                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={retryAll}
                disabled={!online || pendingCount === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw size={14} />
                Tentar agora
              </button>
              {pendingCount > 0 && (
                <button
                  onClick={() => void purgeAll()}
                  className="w-full px-4 py-2 rounded-lg text-rose-600 dark:text-rose-400 text-xs font-bold uppercase tracking-wider hover:bg-rose-50 dark:hover:bg-rose-500/10"
                >
                  Limpar fila (descarta tudo)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OfflineStatusBadge;
