import React, { useCallback, useEffect, useState } from 'react';
import { Receipt, Loader2, ExternalLink, ChevronDown, AlertTriangle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { edgeErrorMessage } from '../utils/edgeError';

/**
 * Débitos do produtor com a CoreoHub (Termo do Produtor v1.7, cláusulas 4-quater e 4-quinquies):
 * valores que a CoreoHub devolveu a compradores por causa de um evento seu e que já tinham sido
 * repassados. Mostra o extrato por ingresso, os prazos (contestar em 5 dias, repor em 10 dias) e o
 * link de pagamento. Sempre renderiza (empty state visível). Leitura direta com RLS (só os próprios
 * débitos já notificados); a contestação passa pela edge function manage-producer-debt.
 */
interface DebtItem { id: string; description: string; paid_amount: number; producer_amount: number }
interface Debt {
  id: string;
  reason: string;
  status: 'notificada' | 'contestada' | 'paga' | 'cancelada' | 'rascunho';
  processing_cost: number;
  amount_due: number;
  notice_sent_at: string | null;
  contest_until: string | null;
  due_at: string | null;
  paid_at: string | null;
  invoice_url: string | null;
  contest_text: string | null;
  producer_debt_items: DebtItem[];
}

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  notificada: { label: 'A repor', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  contestada: { label: 'Em análise', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  paga: { label: 'Paga', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  cancelada: { label: 'Cancelada', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
};

const ProducerDebtsCard: React.FC = () => {
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [contesting, setContesting] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: qErr } = await supabase
      .from('producer_debts')
      .select('id, reason, status, processing_cost, amount_due, notice_sent_at, contest_until, due_at, paid_at, invoice_url, contest_text, producer_debt_items(id, description, paid_amount, producer_amount)')
      .order('created_at', { ascending: false });
    if (qErr) { console.error('[ProducerDebtsCard] producer_debts:', qErr.message); setError('Não foi possível carregar seus débitos agora.'); setDebts([]); return; }
    setError(null);
    setDebts((data ?? []) as unknown as Debt[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const contest = async (debtId: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke('manage-producer-debt', { body: { action: 'contest', debt_id: debtId, text } });
      if (invErr) throw new Error(await edgeErrorMessage(invErr, 'Não foi possível registrar a contestação.'));
      if (data?.error) throw new Error(data.error);
      setContesting(null);
      setText('');
      setMsg('Contestação registrada. Enquanto analisamos, o valor contestado não é cobrado e as vendas não são suspensas por ele.');
      await load();
    } catch (e: any) {
      setMsg(e?.message ?? 'Não foi possível registrar a contestação.');
    } finally {
      setBusy(false);
    }
  };

  const open = (debts ?? []).filter(d => d.status === 'notificada' || d.status === 'contestada');
  const overdue = open.filter(d => d.status === 'notificada' && d.due_at && new Date(d.due_at).getTime() < Date.now());

  return (
    <div className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/8">
        <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Receipt size={16} /></div>
        <div className="min-w-0">
          <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Valores a repor à CoreoHub</p>
          <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Devoluções a compradores por causa do seu evento</p>
        </div>
      </div>

      <div className="p-6 space-y-3">
        {debts === null && <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando...</p>}
        {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}

        {overdue.length > 0 && (
          <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-300/60 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <p>Há valor com o prazo de reposição vencido: as <strong>novas vendas dos seus eventos estão suspensas</strong> até a regularização. Pague pelo link abaixo ou, se discordar, fale com a CoreoHub.</p>
          </div>
        )}

        {debts !== null && debts.length === 0 && !error && (
          <p className="text-xs text-slate-500 leading-relaxed">
            Nenhum valor a repor. Se a CoreoHub precisar devolver dinheiro a compradores por causa de um evento seu cancelado, adiado ou alterado e o saldo da sua conta não cobrir, o extrato aparece aqui, com prazo para contestar (5 dias) e para repor (10 dias).
          </p>
        )}

        {msg && <p role="status" className="text-xs font-bold text-slate-700 dark:text-slate-200">{msg}</p>}

        {(debts ?? []).map(d => {
          const st = STATUS_LABEL[d.status] ?? STATUS_LABEL.notificada;
          const canContest = d.status === 'notificada' && d.contest_until && new Date(d.contest_until).getTime() >= Date.now();
          return (
            <div key={d.id} className="rounded-2xl border border-slate-200 dark:border-white/10">
              <button type="button" onClick={() => setOpenId(openId === d.id ? null : d.id)} aria-expanded={openId === d.id}
                className="cursor-pointer w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 dark:text-white tabular-nums">{brl(d.amount_due)}</p>
                  <p className="text-[11px] text-slate-500 truncate">{d.reason}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${st.cls}`}>{st.label}</span>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform ${openId === d.id ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {openId === d.id && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-white/5 pt-3">
                  <dl className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><dt className="text-slate-500 uppercase tracking-widest text-[9px] font-black">Aviso enviado</dt><dd className="text-slate-800 dark:text-slate-200">{fmt(d.notice_sent_at)}</dd></div>
                    <div><dt className="text-slate-500 uppercase tracking-widest text-[9px] font-black">Contestar até</dt><dd className="text-slate-800 dark:text-slate-200">{fmt(d.contest_until)}</dd></div>
                    <div><dt className="text-slate-500 uppercase tracking-widest text-[9px] font-black">Repor até</dt><dd className="text-slate-800 dark:text-slate-200">{fmt(d.due_at)}</dd></div>
                    {d.paid_at && <div><dt className="text-slate-500 uppercase tracking-widest text-[9px] font-black">Pago em</dt><dd className="text-slate-800 dark:text-slate-200">{fmt(d.paid_at)}</dd></div>}
                  </dl>

                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Extrato por ingresso devolvido</p>
                    <ul className="divide-y divide-slate-100 dark:divide-white/5 text-[11px]">
                      {d.producer_debt_items.map(i => (
                        <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="text-slate-700 dark:text-slate-300 min-w-0 truncate">{i.description}</span>
                          <span className="tabular-nums text-slate-500 shrink-0">{brl(i.paid_amount)}</span>
                        </li>
                      ))}
                      {Number(d.processing_cost) > 0 && (
                        <li className="flex items-center justify-between gap-2 py-1.5">
                          <span className="text-slate-700 dark:text-slate-300">Custo de processamento não devolvido</span>
                          <span className="tabular-nums text-slate-500 shrink-0">{brl(d.processing_cost)}</span>
                        </li>
                      )}
                    </ul>
                    <p className="text-[10px] text-slate-500 mt-1">O total a repor considera o que já foi repassado a você, mais o custo de processamento, e pode ser menor que a soma dos valores pagos pelos compradores.</p>
                  </div>

                  {d.status === 'contestada' && d.contest_text && (
                    <p className="text-[11px] rounded-xl bg-sky-500/10 p-2 text-sky-800 dark:text-sky-200"><strong>Sua contestação:</strong> {d.contest_text}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {d.status === 'notificada' && d.invoice_url && (
                      <a href={d.invoice_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff0068] hover:bg-[#e0005c] text-white text-[10px] font-black uppercase tracking-widest">
                        Pagar (PIX ou boleto) <ExternalLink size={12} />
                      </a>
                    )}
                    {canContest && contesting !== d.id && (
                      <button type="button" onClick={() => { setContesting(d.id); setMsg(null); }}
                        className="cursor-pointer px-4 py-2 rounded-xl border border-slate-300 dark:border-white/15 text-slate-700 dark:text-slate-200 text-[10px] font-black uppercase tracking-widest">
                        Contestar
                      </button>
                    )}
                  </div>

                  {contesting === d.id && (
                    <div className="space-y-2">
                      <label htmlFor={`contest-${d.id}`} className="block text-[9px] font-black uppercase tracking-widest text-slate-500">Por que você discorda?</label>
                      <textarea id={`contest-${d.id}`} value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000}
                        className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40" />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => setContesting(null)}
                          className="cursor-pointer px-4 py-2 rounded-xl border border-slate-300 dark:border-white/15 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 disabled:opacity-50">Voltar</button>
                        <button type="button" disabled={busy || text.trim().length < 5} onClick={() => void contest(d.id)}
                          className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff0068] text-white text-[10px] font-black uppercase tracking-widest disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-white/10 dark:disabled:text-slate-500">
                          {busy && <Loader2 size={12} className="animate-spin" />} Enviar contestação
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProducerDebtsCard;
