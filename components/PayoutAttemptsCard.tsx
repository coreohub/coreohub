import React, { useCallback, useEffect, useState } from 'react';
import { Banknote, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { edgeErrorMessage } from '../utils/edgeError';

/**
 * Repasses PIX em aberto (Lote 2 da auditoria, B-N1/B-N2). Quando o saque dá timeout/5xx a tentativa
 * fica "incerta" e o produtor fica bloqueado até alguém conferir no extrato da Asaas se o dinheiro saiu.
 * Duas decisões (só super admin, via edge function reconcile-payout-attempt):
 *   - "A Asaas pagou": informa o id da transferência; o próximo repasse só marca as linhas como pagas.
 *   - "A Asaas NÃO pagou": as linhas voltam a ser pagáveis.
 * Sempre renderiza (empty state visível). Desenho: docs/auditoria/DESENHO-repasse.md.
 */
interface Attempt {
  id: string;
  producer_id: string;
  kind: string;
  amount: number;
  item_ids: string[];
  status: 'iniciada' | 'enviada' | 'incerta';
  transfer_id: string | null;
  last_error: string | null;
  created_at: string;
}

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

const STATUS: Record<string, { label: string; cls: string; help: string }> = {
  incerta: { label: 'Incerta', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', help: 'Não sabemos se a Asaas pagou. Confira o extrato da subconta antes de decidir.' },
  iniciada: { label: 'Sem desfecho', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', help: 'A função parou antes de saber o resultado. Confira o extrato da subconta.' },
  enviada: { label: 'Pago, falta marcar', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', help: 'O dinheiro saiu. O próximo repasse do produtor só marca as linhas como pagas.' },
};

const PayoutAttemptsCard: React.FC = () => {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [transferId, setTransferId] = useState('');
  const [confirmUnpaid, setConfirmUnpaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke('reconcile-payout-attempt', { body: { action: 'list' } });
    if (fnErr) {
      setError(await edgeErrorMessage(fnErr, 'Não foi possível carregar os repasses em aberto.'));
      setAttempts([]);
      return;
    }
    const list = ((data as { attempts?: Attempt[] } | null)?.attempts ?? []).map(a => ({ ...a, amount: Number(a.amount) }));
    setAttempts(list);
    const ids = Array.from(new Set(list.map(a => a.producer_id)));
    if (ids.length > 0) {
      const { data: profs, error: pErr } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      if (pErr) console.error('[PayoutAttemptsCard] profiles:', pErr.message);
      setNames(Object.fromEntries((profs ?? []).map(p => [p.id as string, (p.full_name as string) ?? ''])));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (a: Attempt, decision: 'paid' | 'unpaid') => {
    setBusy(true);
    setMsg(null);
    const body = decision === 'paid'
      ? { action: 'mark_paid', attempt_id: a.id, transfer_id: transferId.trim() }
      : { action: 'mark_unpaid', attempt_id: a.id, note: 'decidido no painel' };
    const { data, error: fnErr } = await supabase.functions.invoke('reconcile-payout-attempt', { body });
    setBusy(false);
    if (fnErr) { setMsg(await edgeErrorMessage(fnErr, 'Não foi possível registrar a decisão.')); return; }
    setMsg((data as { note?: string } | null)?.note ?? 'Decisão registrada.');
    setOpenId(null); setTransferId(''); setConfirmUnpaid(false);
    await load();
  };

  const needsDecision = (attempts ?? []).filter(a => a.status !== 'enviada').length;

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 bg-[#ff0068]/10 text-[#ff0068] rounded-xl border border-[#ff0068]/20"><Banknote size={14} /></div>
        <div className="flex-1">
          <h2 className="text-sm font-black uppercase text-slate-900 dark:text-white tracking-tight italic">Repasses em aberto</h2>
          <p className="text-[10px] text-slate-500">Saques PIX com resultado incerto ou ainda sem marcação. Confira o extrato da Asaas antes de decidir.</p>
        </div>
        <button onClick={() => void load()} aria-label="Atualizar repasses em aberto" className="p-2 rounded-xl text-slate-500 hover:text-[#ff0068] hover:bg-slate-100 dark:hover:bg-white/5">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="p-6 space-y-3">
        {attempts === null && <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando…</p>}
        {error && <p className="text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2"><AlertTriangle size={14} /> {error}</p>}
        {attempts !== null && !error && attempts.length === 0 && (
          <p className="text-xs text-slate-500">Nenhum repasse em aberto. Todos os saques recentes foram concluídos.</p>
        )}
        {needsDecision > 0 && (
          <p className="text-xs font-bold text-rose-600 dark:text-rose-300 flex items-center gap-2"><AlertTriangle size={14} /> {needsDecision} repasse(s) esperando sua decisão. O produtor não recebe até resolver.</p>
        )}
        {msg && <p className="text-xs text-emerald-600 dark:text-emerald-300">{msg}</p>}

        {(attempts ?? []).map(a => {
          const st = STATUS[a.status] ?? STATUS.incerta;
          const decidable = a.status !== 'enviada';
          const open = openId === a.id;
          return (
            <div key={a.id} className="rounded-2xl border border-slate-200 dark:border-white/10 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-black text-slate-900 dark:text-white">{names[a.producer_id] || a.producer_id.slice(0, 8)}</span>
                <span className="text-sm font-black text-slate-900 dark:text-white">{brl(a.amount)}</span>
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                <span className="text-[10px] text-slate-500 ml-auto">{fmt(a.created_at)} · {a.item_ids.length} linha(s)</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{st.help}</p>
              {a.last_error && <p className="text-[10px] text-slate-400 mt-1 break-words">Erro: {a.last_error}</p>}
              {a.transfer_id && <p className="text-[10px] text-slate-400 mt-1">Transferência: {a.transfer_id}</p>}

              {decidable && !open && (
                <button onClick={() => { setOpenId(a.id); setTransferId(''); setConfirmUnpaid(false); setMsg(null); }}
                  className="mt-3 text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:underline">Decidir</button>
              )}
              {decidable && open && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">A Asaas pagou</p>
                    <input value={transferId} onChange={e => setTransferId(e.target.value)} placeholder="id da transferência (tra_...)"
                      aria-label="Id da transferência na Asaas"
                      className="mt-2 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 px-3 py-2 text-xs text-slate-900 dark:text-white" />
                    <button disabled={busy || !transferId.trim()} onClick={() => void decide(a, 'paid')}
                      className="mt-2 w-full rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest py-2 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-white/10 dark:disabled:text-slate-500">
                      Confirmar que pagou
                    </button>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">A Asaas NÃO pagou</p>
                    <p className="text-[11px] text-slate-500 mt-2">As linhas voltam a ser pagáveis no próximo repasse. Só faça se o extrato não mostra o saque.</p>
                    {!confirmUnpaid ? (
                      <button disabled={busy} onClick={() => setConfirmUnpaid(true)}
                        className="mt-2 w-full rounded-xl border border-rose-500/40 text-rose-600 dark:text-rose-300 text-[10px] font-black uppercase tracking-widest py-2">
                        Não pagou
                      </button>
                    ) : (
                      <button disabled={busy} onClick={() => void decide(a, 'unpaid')}
                        className="mt-2 w-full rounded-xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest py-2 disabled:bg-slate-300 disabled:text-slate-500">
                        Tenho certeza: confirmar
                      </button>
                    )}
                  </div>
                  <button onClick={() => setOpenId(null)} className="text-[10px] font-black uppercase tracking-widest text-slate-500 sm:col-span-2 text-left">Cancelar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PayoutAttemptsCard;
