import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, ArrowDownToLine, Loader2, AlertTriangle, CheckCircle2,
  Clock, ShieldCheck, X, Info, RefreshCw,
} from 'lucide-react';
import { supabase } from '../services/supabase';

interface PendingCommission {
  id:            string;
  net_amount:    number;
  refund_amount: number | null;
  release_at:    string | null;
}

interface Props {
  producerId: string;
}

// Cache do saldo Asaas em sessionStorage: 5min de TTL evita martelar a API
// a cada navegação entre rotas internas (Stripe/MP fazem o mesmo padrão).
const ASAAS_CACHE_KEY = 'coreohub:asaas-balance';
const ASAAS_CACHE_TTL_MS = 5 * 60 * 1000;

function readAsaasCache(producerId: string): { value: number; fetchedAt: number } | null {
  try {
    const raw = sessionStorage.getItem(`${ASAAS_CACHE_KEY}:${producerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value: number; fetchedAt: number };
    if (Date.now() - parsed.fetchedAt > ASAAS_CACHE_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeAsaasCache(producerId: string, value: number) {
  try {
    sessionStorage.setItem(
      `${ASAAS_CACHE_KEY}:${producerId}`,
      JSON.stringify({ value, fetchedAt: Date.now() }),
    );
  } catch { /* sessionStorage cheio/bloqueado — ignora silenciosamente */ }
}

/**
 * Card "Saldo" do /qg-organizador — settlement period D+7.
 * Mostra 2 buckets (retido vs disponível) + botão "Transferir agora" que
 * antecipa o retido sob risco (modal de confirmação reforça o aviso).
 */
const ProducerBalanceCard: React.FC<Props> = ({ producerId }) => {
  const [loading, setLoading]     = useState(true);
  const [pending, setPending]     = useState<PendingCommission[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [feedback, setFeedback]   = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [asaasBalance, setAsaasBalance] = useState<{ value: number; fetchedAt: number } | null>(null);

  // Carrega comissões do DB local. `withAsaas`:
  //   - 'force': sempre chama a API Asaas (botão refresh manual)
  //   - 'cached': usa cache da session se fresco (<5min); senão chama API
  //   - 'skip': só DB local (realtime triggers, evita N chamadas Asaas)
  const load = useCallback(async (withAsaas: 'force' | 'cached' | 'skip' = 'skip') => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const targetId = user?.id ?? producerId;

    const localPromise = supabase
      .from('platform_commissions')
      .select('id, net_amount, refund_amount, release_at')
      .eq('producer_id', targetId)
      .is('released_at', null)
      .is('refunded_at', null)
      .gt('net_amount', 0);

    // Decide se chama a API Asaas: força (refresh manual) ou cache miss.
    let asaasNeedsFetch = false;
    if (withAsaas === 'force') {
      asaasNeedsFetch = true;
    } else if (withAsaas === 'cached') {
      const cached = readAsaasCache(targetId);
      if (cached) {
        setAsaasBalance(cached);
      } else {
        asaasNeedsFetch = true;
      }
    }

    const asaasPromise = asaasNeedsFetch
      ? supabase.functions.invoke('get-producer-asaas-balance', { body: {} })
      : Promise.resolve(null);

    const [localRes, asaasRes] = await Promise.all([localPromise, asaasPromise]);

    if (localRes.error) {
      console.error('[ProducerBalanceCard] erro query commissions:', localRes.error);
    } else {
      setPending((localRes.data ?? []) as PendingCommission[]);
    }

    if (asaasNeedsFetch && asaasRes) {
      const { data: asaasData, error: asaasErr } = asaasRes as { data: any; error: any };
      if (asaasErr || asaasData?.status !== 'ok') {
        // Cache miss inicial é silencioso (produtor pode não ter Asaas conectado).
        // Refresh manual sinaliza o erro.
        if (withAsaas === 'force') {
          const reason = asaasData?.message ?? asaasData?.reason ?? asaasErr?.message ?? 'erro_desconhecido';
          setFeedback({ kind: 'err', msg: `Não foi possível consultar o Asaas: ${reason}` });
        }
      } else {
        const value = Number(asaasData.balance ?? 0);
        setAsaasBalance({ value, fetchedAt: Date.now() });
        writeAsaasCache(targetId, value);
      }
    }

    setLoading(false);
  }, [producerId]);

  // Mount inicial: usa cache se fresco. Fora do cache TTL, dispara fetch
  // em background — saldo Asaas aparece sem o user precisar clicar.
  useEffect(() => { load('cached'); }, [load]);

  // Realtime: cron daily-release-funds marca released_at em commissions sem o
  // produtor ouvir nada. Sem subscribe, card mostra retido velho até refresh.
  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active || !user?.id) return;
      channel = supabase
        .channel(`balance-${user.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'platform_commissions',
          filter: `producer_id=eq.${user.id}`,
        }, () => { load('skip'); })
        .subscribe();
    })();
    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  const { retido, disponivel, nextReleaseAt } = useMemo(() => {
    const now = Date.now();
    let r = 0, d = 0;
    let next: number | null = null;
    for (const c of pending) {
      const releaseTs = c.release_at ? new Date(c.release_at).getTime() : 0;
      // Refund parcial: comissão segue válida pela diferença. Refund total
      // já é filtrado na query (refunded_at IS NULL), então aqui é só
      // descontar o parcial.
      const amt = Number(c.net_amount ?? 0) - Number(c.refund_amount ?? 0);
      if (amt <= 0) continue;
      if (releaseTs > now) {
        r += amt;
        if (next === null || releaseTs < next) next = releaseTs;
      } else {
        d += amt;
      }
    }
    return {
      retido:        parseFloat(r.toFixed(2)),
      disponivel:    parseFloat(d.toFixed(2)),
      nextReleaseAt: next,
    };
  }, [pending]);

  const total = retido + disponivel;

  const handleTransfer = async () => {
    setTransferring(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke('manual-transfer-now', {
        body: {},
      });
      if (error) throw error;
      if ((data as any)?.status !== 'ok') {
        throw new Error((data as any)?.message ?? (data as any)?.reason ?? 'Falha na transferência');
      }
      const released = Number((data as any)?.released ?? 0);
      setFeedback({
        kind: 'ok',
        msg:  `Transferência disparada: R$ ${released.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a caminho do seu PIX.`,
      });
      setModalOpen(false);
      await load('force');
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e?.message ?? 'Erro ao processar transferência.' });
    } finally {
      setTransferring(false);
    }
  };

  const fmtBRL = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const fmtNextRelease = () => {
    if (!nextReleaseAt) return null;
    const diffH = Math.max(1, Math.round((nextReleaseAt - Date.now()) / (1000 * 60 * 60)));
    if (diffH < 24) return `em ${diffH}h`;
    const days = Math.ceil(diffH / 24);
    return `em ${days} dia${days > 1 ? 's' : ''}`;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl p-6 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  // Mostra sempre, mesmo vazio — empty state é melhor que sumir silencioso.

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl p-6"
      >
        {/* Header: ícone + título compacto */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-500/20">
            <Wallet size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">
              Saldo
            </h2>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Repasse automático em até 7 dias
            </p>
          </div>
          <button
            onClick={() => load('force')}
            disabled={loading}
            title="Atualizar saldo"
            className="p-2 rounded-xl text-slate-400 hover:text-[#ff0068] hover:bg-slate-100 dark:hover:bg-white/5 transition-all disabled:opacity-50"
            aria-label="Atualizar saldo"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Número grande do total + breakdown secundário */}
        <div className="mb-5">
          <div className="text-4xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tighter mb-2">
            {fmtBRL(total)}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-emerald-500" />
              <strong className="font-black text-slate-700 dark:text-slate-300">{fmtBRL(disponivel)}</strong>
              já liberado
            </span>
            <span className="text-slate-300 dark:text-slate-600">•</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={11} className="text-amber-500" />
              <strong className="font-black text-slate-700 dark:text-slate-300">{fmtBRL(retido)}</strong>
              retido {nextReleaseAt ? '· libera ' + fmtNextRelease() : ''}
            </span>
          </div>
        </div>

        {/* CTA principal */}
        <button
          onClick={() => setModalOpen(true)}
          disabled={total <= 0}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
        >
          <ArrowDownToLine size={13} />
          Transferir agora — {fmtBRL(total)}
        </button>

        <AnimatePresence>
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mt-4 flex items-start gap-2 p-3 rounded-2xl border text-[11px] ${
                feedback.kind === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
              }`}
            >
              {feedback.kind === 'ok'
                ? <CheckCircle2 size={14} className="shrink-0 mt-px" />
                : <AlertTriangle size={14} className="shrink-0 mt-px" />}
              <span className="leading-relaxed">{feedback.msg}</span>
              <button
                onClick={() => setFeedback(null)}
                className="ml-auto opacity-60 hover:opacity-100"
                aria-label="Fechar"
              >
                <X size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex items-start gap-2 text-[10px] text-slate-500">
          <Info size={11} className="shrink-0 mt-0.5" />
          <span>
            Saldo retido é repassado automático após 7 dias. Você pode antecipar
            quando quiser — sem taxa.
          </span>
        </div>

        {/* Saldo real Asaas — fetcha em background no mount (cache 5min).
            Diferencia 2 cenários de divergência:
            - Asaas < CoreoHub: dívida pendente (refund parcial pós-sweep)
            - Asaas > CoreoHub: crédito não rastreado (ajuste manual Asaas) */}
        {asaasBalance && (() => {
          const diff = asaasBalance.value - total;
          const hasDivergence = Math.abs(diff) > 0.01;
          const isDebt = diff < -0.01;
          return (
            <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-white/5 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                <ShieldCheck size={11} className="text-slate-400" />
                <span className="text-slate-500">Saldo real Asaas:</span>
                <strong className="font-black text-slate-700 dark:text-slate-300">
                  {fmtBRL(asaasBalance.value)}
                </strong>
                {hasDivergence && (
                  <span className={`text-[10px] font-black ${isDebt ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    • {isDebt ? '−' : '+'}{fmtBRL(Math.abs(diff))}
                  </span>
                )}
              </div>
              {hasDivergence && isDebt && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  <span>
                    Saldo Asaas menor que o esperado — geralmente é débito recente
                    de reembolso ainda sendo recuperado por pagamentos futuros.
                    Sem ação necessária da sua parte.
                  </span>
                </div>
              )}
            </div>
          );
        })()}
      </motion.div>

      {/* Modal de confirmação */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !transferring && setModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-6 max-w-md w-full space-y-5"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-[#ff0068]/10 text-[#ff0068] rounded-xl border border-[#ff0068]/20 shrink-0">
                  <ArrowDownToLine size={16} />
                </div>
                <div>
                  <h3 className="text-lg font-black uppercase tracking-tight italic text-slate-900 dark:text-white">
                    Confirmar transferência
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Você vai receber {fmtBRL(total)} no seu PIX cadastrado.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-4 space-y-2 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Disponível (sem risco)</span>
                  <strong className="text-emerald-600 dark:text-emerald-400">{fmtBRL(disponivel)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Antecipado (sob risco)</span>
                  <strong className="text-amber-600 dark:text-amber-400">{fmtBRL(retido)}</strong>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-white/10">
                  <span className="font-black text-slate-900 dark:text-white">Total</span>
                  <strong className="text-slate-900 dark:text-white">{fmtBRL(total)}</strong>
                </div>
              </div>

              {retido > 0 && (
                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 flex items-start gap-3">
                  <Info size={16} className="text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-sky-800 dark:text-sky-200 leading-relaxed">
                    <strong className="block mb-1">Antecipação imediata.</strong>
                    O saldo retido seria liberado automaticamente em até 7 dias —
                    antecipando agora você recebe na hora. Reembolsos nos próximos
                    7 dias são absorvidos pela CoreoHub e recuperados nos
                    próximos pagamentos recebidos (sem PIX manual).
                  </div>
                </div>
              )}

              {retido === 0 && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-start gap-3">
                  <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-emerald-800 dark:text-emerald-200 leading-relaxed">
                    Todo o saldo já passou da janela de 7 dias — transferência sem risco de reembolso.
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setModalOpen(false)}
                  disabled={transferring}
                  className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-[10px] font-black uppercase tracking-widest hover:border-slate-300 dark:hover:border-white/20 transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={transferring}
                  className="flex-1 px-4 py-3 rounded-2xl bg-[#ff0068] hover:bg-[#e0005c] text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {transferring
                    ? <><Loader2 size={13} className="animate-spin" /> Processando…</>
                    : <>Confirmar transferência</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ProducerBalanceCard;
