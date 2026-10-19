import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, ArrowDownToLine, ArrowRight, Loader2, AlertTriangle, CheckCircle2,
  Clock, ShieldCheck, X, Info, RefreshCw, ChevronDown,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { groupReleaseByDay } from '../utils/releaseSchedule';

interface PendingCommission {
  id:            string;
  net_amount:    number;
  refund_amount: number | null;
  release_at:    string | null;
  /** Data em que o Asaas credita o cartão na subconta (null = não é cartão). */
  card_credit_at: string | null;
}

/** Repasse interno da CoreoHub (eventos com absorção de taxa de baixo valor): o
 *  dinheiro está na conta principal e a CoreoHub transfere pro produtor depois
 *  da janela de segurança. Não gera linha em platform_commissions. */
interface LowValueTransfer {
  id:                string;
  value:             number;
  status:            string;
  safety_release_at: string | null;
}

/** Comissão já enviada ao PIX (uma linha por comissão; o lote repete o total). */
interface SentCommission {
  net_amount:          number;
  released_at:         string;
  released_amount:     number | null;
  released_manually:   boolean | null;
  release_transfer_id: string | null;
}

/** Repasse de baixo valor já enviado ao PIX. */
interface SentLowValue {
  value:           number;
  pix_sent_at:     string;
  pix_transfer_id: string | null;
}

/** Uma transferência pro PIX do produtor (já agrupada por id de transferência). */
interface SentTransfer {
  key:    string;
  at:     string;
  amount: number;
  kind:   'auto' | 'manual' | 'baixo_valor';
}

/** Teto de linhas que o PostgREST devolve por consulta; acima disso o total
 *  "Transferido" fica parcial e o card avisa. */
const SENT_QUERY_LIMIT = 1000;

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

function clearAsaasCache(producerId: string) {
  try { sessionStorage.removeItem(`${ASAAS_CACHE_KEY}:${producerId}`); } catch { /* ignora */ }
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

/** "hoje" / "amanhã" / "dd/mm" pra um dia de liberação. */
function fmtReleaseDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'hoje';
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (sameDay(d, tomorrow)) return 'amanhã';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Card "Seus repasses" do /qg-organizador.
 * Fluxo lido da esquerda pra direita: A LIBERAR → DISPONÍVEL → TRANSFERIDO.
 *  - A liberar:   dentro da janela de segurança (D+7) ou repasse interno da
 *                 CoreoHub ainda a caminho.
 *  - Disponível:  passou da janela; sai no PIX na transferência automática da
 *                 madrugada ou na hora, pelo botão.
 *  - Transferido: o que já foi enviado ao PIX do produtor.
 * O botão principal manda só o disponível (sem risco de estorno); antecipar o
 * que ainda está a liberar é uma ação secundária, com o aviso de risco.
 */
const ProducerBalanceCard: React.FC<Props> = ({ producerId }) => {
  const [loading, setLoading]     = useState(true);
  const [pending, setPending]     = useState<PendingCommission[]>([]);
  const [lowValue, setLowValue]   = useState<LowValueTransfer[]>([]);
  const [sentComm, setSentComm]   = useState<SentCommission[]>([]);
  const [sentLow, setSentLow]     = useState<SentLowValue[]>([]);
  const [modalScope, setModalScope] = useState<'available' | 'all' | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [detailsOpen, setDetailsOpen]   = useState(false);
  const [feedback, setFeedback]   = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [asaasBalance, setAsaasBalance] = useState<{ value: number; fetchedAt: number } | null>(null);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Carrega comissões do DB local. `withAsaas`:
  //   - 'force': sempre chama a API Asaas (botão refresh manual)
  //   - 'cached': usa cache da session se fresco (<5min); senão chama API
  //   - 'skip': só DB local (evita N chamadas Asaas)
  const load = useCallback(async (withAsaas: 'force' | 'cached' | 'skip' = 'skip') => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const targetId = user?.id ?? producerId;

    const localPromise = supabase
      .from('platform_commissions')
      .select('id, net_amount, refund_amount, release_at, card_credit_at')
      .eq('producer_id', targetId)
      .is('released_at', null)
      .is('refunded_at', null)
      .eq('is_sandbox', false)   // comissão de teste (sandbox) nunca entra no saldo
      .gt('net_amount', 0);

    // Repasses internos de baixo valor ainda a caminho (nunca entram no saque
    // manual nem na comparação com o saldo real Asaas: o dinheiro está na master).
    const lowValuePromise = supabase
      .from('low_value_transfers')
      .select('id, value, status, safety_release_at')
      .eq('producer_id', targetId)
      .in('status', ['aguardando_janela', 'pronto', 'transferencia_pedida']);

    // Já enviado ao PIX (histórico + total "Transferido").
    const sentCommPromise = supabase
      .from('platform_commissions')
      .select('net_amount, released_at, released_amount, released_manually, release_transfer_id')
      .eq('producer_id', targetId)
      .not('released_at', 'is', null)
      .eq('is_sandbox', false)
      .order('released_at', { ascending: false })
      .limit(SENT_QUERY_LIMIT);

    const sentLowPromise = supabase
      .from('low_value_transfers')
      .select('value, pix_sent_at, pix_transfer_id')
      .eq('producer_id', targetId)
      .not('pix_sent_at', 'is', null)
      .order('pix_sent_at', { ascending: false })
      .limit(SENT_QUERY_LIMIT);

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

    const [localRes, asaasRes, lowValueRes, sentCommRes, sentLowRes] = await Promise.all([
      localPromise, asaasPromise, lowValuePromise, sentCommPromise, sentLowPromise,
    ]);

    if (lowValueRes.error) {
      console.error('[ProducerBalanceCard] erro query low_value_transfers:', lowValueRes.error);
    } else {
      setLowValue((lowValueRes.data ?? []) as LowValueTransfer[]);
    }

    if (sentCommRes.error) {
      console.error('[ProducerBalanceCard] erro query transferidos (comissões):', sentCommRes.error);
    } else {
      setSentComm((sentCommRes.data ?? []) as SentCommission[]);
    }

    if (sentLowRes.error) {
      // Coluna ausente (migration 20261015 não aplicada) também cai aqui — logar sempre.
      console.error('[ProducerBalanceCard] erro query transferidos (baixo valor):', sentLowRes.error);
    } else {
      setSentLow((sentLowRes.data ?? []) as SentLowValue[]);
    }

    if (localRes.error) {
      // Coluna ausente (migration não aplicada) também cai aqui — logar sempre.
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
          // Em non-2xx o supabase-js devolve data=null e uma mensagem genérica;
          // o motivo real está no corpo da Response em error.context.
          let body: any = null;
          try { body = await asaasErr?.context?.json?.(); } catch { /* corpo não-JSON */ }
          const reason = asaasData?.message ?? body?.message
            ?? (body?.reason === 'asaas_fetch_failed' ? `Asaas respondeu HTTP ${body.http_status ?? '?'}` : body?.reason)
            ?? asaasData?.reason ?? asaasErr?.message ?? 'erro_desconhecido';
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
  // produtor ouvir nada. Quando a tabela muda, o saldo real Asaas em cache fica
  // velho (era o "+R$ 1.980,75" fantasma depois de uma transferência): limpa o
  // cache e recarrega tudo, com debounce pra rajadas de webhook.
  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active || !user?.id) return;
      const uid = user.id;
      channel = supabase
        .channel(`balance-${uid}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'platform_commissions',
          filter: `producer_id=eq.${uid}`,
        }, () => {
          if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
          realtimeTimer.current = setTimeout(() => {
            clearAsaasCache(uid);
            load('cached');
          }, 1500);
        })
        .subscribe();
    })();
    return () => {
      active = false;
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  const { retido, disponivel, cartao, nextCardAt } = useMemo(() => {
    const now = Date.now();
    let r = 0, d = 0, cc = 0;
    let nextCard: number | null = null;
    for (const c of pending) {
      const releaseTs = c.release_at ? new Date(c.release_at).getTime() : 0;
      // Refund parcial: comissão segue válida pela diferença. Refund total
      // já é filtrado na query (refunded_at IS NULL), então aqui é só
      // descontar o parcial.
      const amt = Number(c.net_amount ?? 0) - Number(c.refund_amount ?? 0);
      if (amt <= 0) continue;
      // Cartão que o Asaas ainda não creditou: o dinheiro NÃO está na
      // subconta, então não entra em retido/disponível (nem na comparação
      // com o saldo real Asaas, que acusaria dívida falsa).
      const cardTs = c.card_credit_at ? new Date(c.card_credit_at).getTime() : 0;
      if (cardTs > now) {
        cc += amt;
        if (nextCard === null || cardTs < nextCard) nextCard = cardTs;
        continue;
      }
      if (releaseTs > now) {
        r += amt;
      } else {
        d += amt;
      }
    }
    return {
      retido:        parseFloat(r.toFixed(2)),
      disponivel:    parseFloat(d.toFixed(2)),
      cartao:        parseFloat(cc.toFixed(2)),
      nextCardAt:    nextCard,
    };
  }, [pending]);

  // Tudo o que a subconta tem por causa de split (retido + disponível). É o que
  // o "Transferir agora" antecipado manda e o que se compara com o saldo Asaas.
  const total = retido + disponivel;

  // A caminho por transferência interna da CoreoHub (baixo valor). Mostrado à
  // parte: não entra no saque manual (total) nem na checagem do saldo Asaas.
  const aCaminho = useMemo(() => {
    let v = 0;
    for (const t of lowValue) {
      const amt = Number(t.value ?? 0);
      if (amt <= 0) continue;
      v += amt;
    }
    return parseFloat(v.toFixed(2));
  }, [lowValue]);

  // Transferido: agrupa por id de transferência. Cada comissão de um lote grava
  // o total do lote em released_amount, então somar por linha duplica — conta
  // uma vez por release_transfer_id. Sem id (legado), cai no líquido da linha.
  const { sentTotal, sentList, sentTruncated } = useMemo(() => {
    const byKey = new Map<string, SentTransfer>();
    sentComm.forEach((c, i) => {
      const key = c.release_transfer_id ? `c:${c.release_transfer_id}` : `c:row:${i}`;
      const amount = c.release_transfer_id
        ? Number(c.released_amount ?? c.net_amount ?? 0)
        : Number(c.net_amount ?? 0);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { key, at: c.released_at, amount, kind: c.released_manually ? 'manual' : 'auto' });
      } else if (c.release_transfer_id) {
        prev.amount = Math.max(prev.amount, amount);
        if (c.released_at > prev.at) prev.at = c.released_at;
      } else {
        prev.amount += amount;
      }
    });
    // Baixo valor: o saque de um ciclo cobre vários repasses, então soma o valor
    // de cada repasse por pix_transfer_id.
    const lowByKey = new Map<string, SentTransfer>();
    sentLow.forEach((l, i) => {
      const key = l.pix_transfer_id ? `l:${l.pix_transfer_id}` : `l:row:${i}`;
      const prev = lowByKey.get(key);
      const amt = Number(l.value ?? 0);
      if (!prev) lowByKey.set(key, { key, at: l.pix_sent_at, amount: amt, kind: 'baixo_valor' });
      else prev.amount += amt;
    });
    const list = [...byKey.values(), ...lowByKey.values()]
      .filter(t => t.amount > 0)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const sum = list.reduce((s, t) => s + t.amount, 0);
    return {
      sentTotal:     parseFloat(sum.toFixed(2)),
      sentList:      list,
      sentTruncated: sentComm.length >= SENT_QUERY_LIMIT || sentLow.length >= SENT_QUERY_LIMIT,
    };
  }, [sentComm, sentLow]);

  // A liberar agrupado por DIA de liberação (comissões retidas + repasses internos
  // da CoreoHub), pra o produtor ver quanto libera em cada data. Conta em
  // utils/releaseSchedule.ts (pura, com teste).
  const releaseByDay = useMemo(() => groupReleaseByDay(pending, lowValue), [pending, lowValue]);

  const aLiberar        = parseFloat((retido + aCaminho).toFixed(2));
  const totalAReceber   = parseFloat((retido + disponivel + aCaminho).toFixed(2));

  const handleTransfer = async () => {
    const scope = modalScope ?? 'available';
    setTransferring(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke('manual-transfer-now', {
        body: { scope },
      });
      if (error) throw error;
      if ((data as any)?.status !== 'ok') {
        throw new Error((data as any)?.message ?? (data as any)?.reason ?? 'Falha na transferência');
      }
      const released = Number((data as any)?.released ?? 0);
      const heldBack = Number((data as any)?.held_back ?? 0);
      setFeedback({
        kind: 'ok',
        msg:  `Transferência disparada: ${fmtBRL(released)} a caminho do seu PIX.`
          + (heldBack > 0 ? ` ${fmtBRL(heldBack)} seguem nos 7 dias de segurança.` : ''),
      });
      setModalScope(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) clearAsaasCache(user.id);
      await load('force');
    } catch (e: any) {
      setFeedback({ kind: 'err', msg: e?.message ?? 'Erro ao processar transferência.' });
    } finally {
      setTransferring(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl p-6 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  // Mostra sempre, mesmo vazio — empty state é melhor que sumir silencioso.

  const modalAmount = modalScope === 'all' ? total : disponivel;
  const stepBox = 'flex-1 min-w-0 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4';
  const stepLabel = 'text-[10px] font-black uppercase tracking-widest text-slate-500';
  const stepValue = 'text-2xl font-black tracking-tighter text-slate-900 dark:text-white tabular-nums mt-1';
  const stepNote = 'text-[11px] text-slate-500 leading-snug';

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl p-6"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-500/20">
            <Wallet size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">
              Seus repasses
            </h2>
          </div>
          <button
            onClick={() => load('force')}
            disabled={loading}
            title="Atualizar"
            className="p-2 rounded-xl text-slate-400 hover:text-[#ff0068] hover:bg-slate-100 dark:hover:bg-white/5 transition-all disabled:opacity-50"
            aria-label="Atualizar repasses"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Total a receber */}
        <div className="mb-5">
          <p className={stepLabel}>Total a receber</p>
          <div className="text-4xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tighter mt-1">
            {fmtBRL(totalAReceber)}
          </div>
        </div>

        {/* Fluxo: A LIBERAR → DISPONÍVEL → TRANSFERIDO */}
        <div className="flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-2 mb-5">
          <div className={stepBox}>
            <div className="flex items-center gap-1.5">
              <Clock size={11} className="text-amber-500" />
              <p className={stepLabel}>A liberar</p>
            </div>
            <p className={stepValue}>{fmtBRL(aLiberar)}</p>
            <div className="mt-2 space-y-1">
              {releaseByDay.slice(0, 4).map(d => (
                <p key={d.key} className={stepNote}>
                  <strong className="font-black text-slate-700 dark:text-slate-300">{fmtBRL(d.amount)}</strong>
                  {d.ts === 0 ? ' · em processamento' : ` · libera ${fmtReleaseDay(d.ts)}`}
                </p>
              ))}
              {releaseByDay.length > 4 && (
                <p className={stepNote}>e mais {releaseByDay.length - 4} data{releaseByDay.length - 4 > 1 ? 's' : ''}.</p>
              )}
              {aLiberar <= 0 && <p className={stepNote}>Nada aguardando liberação.</p>}
            </div>
          </div>

          <div className="hidden sm:flex items-center text-slate-300 dark:text-slate-600" aria-hidden="true">
            <ArrowRight size={16} />
          </div>

          <div className={stepBox}>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-emerald-500" />
              <p className={stepLabel}>Disponível</p>
            </div>
            <p className={stepValue}>{fmtBRL(disponivel)}</p>
            <p className={`${stepNote} mt-2`}>
              {disponivel > 0
                ? 'Já passou dos 7 dias de segurança. Sai no seu PIX sozinho na madrugada (00h), ou agora pelo botão abaixo.'
                : 'Nada disponível agora.'}
            </p>
          </div>

          <div className="hidden sm:flex items-center text-slate-300 dark:text-slate-600" aria-hidden="true">
            <ArrowRight size={16} />
          </div>

          <div className={stepBox}>
            <div className="flex items-center gap-1.5">
              <ArrowDownToLine size={11} className="text-sky-500" />
              <p className={stepLabel}>Transferido</p>
            </div>
            <p className={stepValue}>{fmtBRL(sentTotal)}</p>
            <p className={`${stepNote} mt-2`}>
              {sentList.length > 0
                ? `Já enviado ao seu PIX${sentTruncated ? ' (últimos registros)' : ''}.`
                : 'Nada transferido ainda.'}
            </p>
            {sentList.length > 0 && (
              <button
                type="button"
                onClick={() => setHistoryOpen(o => !o)}
                aria-expanded={historyOpen}
                className="mt-2 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline"
              >
                {historyOpen ? 'Ocultar histórico' : 'Ver histórico'}
                <ChevronDown size={11} className={historyOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
            )}
          </div>
        </div>

        {historyOpen && sentList.length > 0 && (
          <div className="mb-5 rounded-2xl border border-slate-200 dark:border-white/10 divide-y divide-slate-200 dark:divide-white/10">
            {sentList.slice(0, 8).map(t => (
              <div key={t.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12px]">
                <span className="text-slate-500 tabular-nums">{fmtDateTime(t.at)}</span>
                <span className="flex-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {t.kind === 'manual' ? 'Pedido por você' : t.kind === 'baixo_valor' ? 'Repasse de baixo valor' : 'Automático'}
                </span>
                <strong className="text-slate-900 dark:text-white tabular-nums">{fmtBRL(t.amount)}</strong>
              </div>
            ))}
            {sentList.length > 8 && (
              <p className="px-4 py-2 text-[10px] text-slate-500">Mostrando as 8 mais recentes de {sentList.length}.</p>
            )}
          </div>
        )}

        {cartao > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <Clock size={11} className="text-sky-500" />
            <strong className="font-black text-slate-700 dark:text-slate-300">{fmtBRL(cartao)}</strong>
            a receber no cartão
            {nextCardAt && (
              <span>(previsão de crédito do Asaas: {new Date(nextCardAt).toLocaleDateString('pt-BR')})</span>
            )}
          </div>
        )}

        {/* CTA principal: só o disponível */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            onClick={() => setModalScope('available')}
            disabled={disponivel <= 0}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
          >
            <ArrowDownToLine size={13} />
            {disponivel > 0 ? `Transferir ${fmtBRL(disponivel)} agora` : 'Nada disponível pra transferir'}
          </button>
          {retido > 0 && (
            <button
              type="button"
              onClick={() => setModalScope('all')}
              className="text-left sm:text-center text-[11px] font-bold text-slate-500 hover:text-[#ff0068] underline underline-offset-4 decoration-slate-300 dark:decoration-white/20 transition-colors"
            >
              Antecipar também o que está a liberar ({fmtBRL(retido)})
            </button>
          )}
        </div>

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

        {/* Conferência com o saldo real Asaas. Divergência negativa (dívida de
            estorno) fica sempre visível; o resto só em "Ver detalhes". */}
        {asaasBalance && (() => {
          const diff = asaasBalance.value - total;
          const hasDivergence = Math.abs(diff) > 0.01;
          const isDebt = diff < -0.01;
          return (
            <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-white/5 space-y-2">
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
              <button
                type="button"
                onClick={() => setDetailsOpen(o => !o)}
                aria-expanded={detailsOpen}
                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Ver detalhes
                <ChevronDown size={11} className={detailsOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {detailsOpen && (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                  <ShieldCheck size={11} className="text-slate-400" />
                  <span className="text-slate-500">Saldo na conta de pagamentos (Asaas):</span>
                  <strong className="font-black text-slate-700 dark:text-slate-300">
                    {fmtBRL(asaasBalance.value)}
                  </strong>
                  {hasDivergence && (
                    <span className={`text-[10px] font-black ${isDebt ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
                      • {isDebt ? '−' : '+'}{fmtBRL(Math.abs(diff))} em relação ao painel
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </motion.div>

      {/* Modal de confirmação */}
      <AnimatePresence>
        {modalScope && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !transferring && setModalScope(null)}
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
                    {modalScope === 'all' ? 'Antecipar repasse' : 'Confirmar transferência'}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Você vai receber {fmtBRL(modalAmount)} no seu PIX cadastrado.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-4 space-y-2 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Disponível (sem risco)</span>
                  <strong className="text-emerald-600 dark:text-emerald-400">{fmtBRL(disponivel)}</strong>
                </div>
                {modalScope === 'all' && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Antecipado (sob risco)</span>
                    <strong className="text-amber-600 dark:text-amber-400">{fmtBRL(retido)}</strong>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-white/10">
                  <span className="font-black text-slate-900 dark:text-white">Total</span>
                  <strong className="text-slate-900 dark:text-white">{fmtBRL(modalAmount)}</strong>
                </div>
              </div>

              {modalScope === 'all' ? (
                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 flex items-start gap-3">
                  <Info size={16} className="text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-sky-800 dark:text-sky-200 leading-relaxed">
                    <strong className="block mb-1">Antecipação imediata.</strong>
                    Esse valor ainda está nos 7 dias de segurança, que existem para cobrir
                    estornos. Se uma venda dele for estornada antes do fim do prazo, o
                    estorno pode não ser possível ou o valor ser descontado dos seus
                    próximos recebimentos. Sem estornos, nada muda.
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-start gap-3">
                  <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-emerald-800 dark:text-emerald-200 leading-relaxed">
                    Esse valor já passou da janela de 7 dias — transferência sem risco de reembolso.
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setModalScope(null)}
                  disabled={transferring}
                  className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-[10px] font-black uppercase tracking-widest hover:border-slate-300 dark:hover:border-white/20 transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={transferring || modalAmount <= 0}
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
