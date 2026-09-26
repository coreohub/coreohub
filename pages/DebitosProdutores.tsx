import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, Loader2, Plus, ExternalLink, AlertCircle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { edgeErrorMessage } from '../utils/edgeError';
import PageHeader from '../components/PageHeader';
import SuperAdminMfaGate from '../components/SuperAdminMfaGate';

/**
 * Livro de débitos de produtores (Termo do Produtor v1.7, cláusulas 7 e 8).
 * Só super admin (protegido por SuperAdminMfaGate + checagem na edge function manage-producer-debt).
 * Fluxo: criar rascunho a partir dos ingressos estornados de um evento -> conferir/ajustar o valor
 * -> notificar (gera a cobrança PIX/boleto e envia o extrato) -> acompanhar contestação (5 dias) e
 * reposição (10 dias). A baixa do pagamento é automática (webhook da Asaas).
 */
interface Debt {
  id: string;
  producer_id: string;
  event_id: string | null;
  reason: string;
  status: 'rascunho' | 'notificada' | 'contestada' | 'paga' | 'cancelada';
  suggested_amount: number;
  processing_cost: number;
  amount_due: number;
  admin_note: string | null;
  notice_sent_at: string | null;
  contest_until: string | null;
  due_at: string | null;
  contest_text: string | null;
  paid_at: string | null;
  invoice_url: string | null;
  created_at: string;
}
interface Candidate {
  id: string; description: string; paid_amount: number; producer_amount: number;
  refunded_at: string | null; refund_reason: string | null; already_in_debt: boolean;
}
interface EventRow { id: string; name: string; created_by: string }

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
const STATUS_CLS: Record<string, string> = {
  rascunho: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  notificada: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  contestada: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  paga: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  cancelada: 'bg-slate-500/15 text-slate-500',
};

const inputCls = 'w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40';
const labelCls = 'block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1';
const btnPrimary = 'cursor-pointer inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff0068] hover:bg-[#e0005c] text-white text-[10px] font-black uppercase tracking-widest disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-white/10 dark:disabled:text-slate-500';
const btnGhost = 'cursor-pointer inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 dark:border-white/15 text-slate-700 dark:text-slate-200 text-[10px] font-black uppercase tracking-widest disabled:opacity-50';

const Inner: React.FC = () => {
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [producers, setProducers] = useState<Record<string, { full_name: string | null; email: string | null }>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // novo débito
  const [eventId, setEventId] = useState('');
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [procCost, setProcCost] = useState('0');
  const [note, setNote] = useState('');
  const [loadingCands, setLoadingCands] = useState(false);

  // edição por débito
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [resolveNote, setResolveNote] = useState<Record<string, string>>({});

  const call = useCallback(async (body: Record<string, unknown>, fallback: string) => {
    const { data, error } = await supabase.functions.invoke('manage-producer-debt', { body });
    if (error) throw new Error(await edgeErrorMessage(error, fallback));
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('producer_debts').select('*').order('created_at', { ascending: false });
    if (error) { console.error('[DebitosProdutores] producer_debts:', error.message); setMsg({ kind: 'err', text: 'Não foi possível carregar os débitos.' }); setDebts([]); return; }
    const list = (data ?? []) as Debt[];
    setDebts(list);
    const pids = Array.from(new Set(list.map(d => d.producer_id)));
    if (pids.length) {
      const { data: ps } = await supabase.from('profiles').select('id, full_name, email').in('id', pids);
      setProducers(Object.fromEntries((ps ?? []).map((p: any) => [p.id, { full_name: p.full_name, email: p.email }])));
    }
  }, []);

  useEffect(() => {
    void load();
    void supabase.from('events').select('id, name, created_by').eq('is_demo', false).order('created_at', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) console.error('[DebitosProdutores] events:', error.message); setEvents((data ?? []) as EventRow[]); });
  }, [load]);

  const eventName = useMemo(() => Object.fromEntries(events.map(e => [e.id, e.name])), [events]);

  const searchCandidates = async () => {
    if (!eventId) return;
    setLoadingCands(true); setMsg(null); setCands(null); setPicked(new Set());
    try {
      const data = await call({ action: 'list_candidates', event_id: eventId }, 'Não foi possível buscar os ingressos.');
      setCands(data.candidates as Candidate[]);
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setLoadingCands(false); }
  };

  const pickedTotals = useMemo(() => {
    const list = (cands ?? []).filter(c => picked.has(c.id));
    return { paid: list.reduce((s, c) => s + c.paid_amount, 0), producer: list.reduce((s, c) => s + c.producer_amount, 0) };
  }, [cands, picked]);

  const createDebt = async () => {
    setBusy('create'); setMsg(null);
    try {
      await call({ action: 'create', event_id: eventId, ticket_ids: Array.from(picked), reason, processing_cost: Number(procCost.replace(',', '.')) || 0, admin_note: note || null }, 'Não foi possível criar o débito.');
      setMsg({ kind: 'ok', text: 'Rascunho criado. Confira o valor e notifique o produtor.' });
      setCands(null); setPicked(new Set()); setReason(''); setProcCost('0'); setNote('');
      await load();
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(null); }
  };

  const act = async (debt: Debt, body: Record<string, unknown>, okText: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(debt.id); setMsg(null);
    try {
      await call({ debt_id: debt.id, ...body }, 'Não foi possível concluir a ação.');
      setMsg({ kind: 'ok', text: okText });
      await load();
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<div className="p-2.5 bg-[#ff0068]/10 rounded-2xl text-[#ff0068]"><Receipt size={22} /></div>}
        title={<>Débitos de <span className="text-[#ff0068]">produtores</span></>}
        subtitle="Valores devolvidos a compradores que o produtor reembolsa (Termo v1.7)"
      />

      {msg && (
        <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-xs font-bold rounded-xl px-3 py-2 ${msg.kind === 'err' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}>{msg.text}</p>
      )}

      {/* ── Novo débito ── */}
      <section className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-4">
        <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2"><Plus size={14} className="text-[#ff0068]" /> Novo débito</p>
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label htmlFor="deb-event" className={labelCls}>Evento (sessão)</label>
            <select id="deb-event" className={inputCls} value={eventId} onChange={e => { setEventId(e.target.value); setCands(null); }}>
              <option value="">Escolha o evento...</option>
              {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <button type="button" className={btnGhost} disabled={!eventId || loadingCands} onClick={() => void searchCandidates()}>
            {loadingCands && <Loader2 size={12} className="animate-spin" />} Buscar ingressos devolvidos
          </button>
        </div>

        {cands !== null && cands.length === 0 && <p className="text-xs text-slate-500">Nenhum ingresso estornado neste evento.</p>}
        {cands !== null && cands.length > 0 && (
          <div className="space-y-3">
            <ul className="max-h-64 overflow-auto divide-y divide-slate-100 dark:divide-white/5 text-xs border border-slate-200 dark:border-white/10 rounded-2xl">
              {cands.map(c => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <input type="checkbox" id={`cand-${c.id}`} disabled={c.already_in_debt} checked={picked.has(c.id)}
                    onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                  <label htmlFor={`cand-${c.id}`} className={`flex-1 min-w-0 ${c.already_in_debt ? 'opacity-50' : ''}`}>
                    <span className="block truncate text-slate-800 dark:text-slate-200">{c.description}</span>
                    <span className="block text-[10px] text-slate-500 truncate">{c.refund_reason ?? '—'} · estornado em {fmt(c.refunded_at)}{c.already_in_debt ? ' · já em outro débito' : ''}</span>
                  </label>
                  <span className="tabular-nums text-slate-500 shrink-0 text-right">
                    <span className="block">{brl(c.paid_amount)} pago</span>
                    <span className="block text-[10px]">{brl(c.producer_amount)} repassado</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500">Selecionados: {picked.size} · pago pelos compradores {brl(pickedTotals.paid)} · parte do produtor (valor sugerido) {brl(pickedTotals.producer)}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="deb-reason" className={labelCls}>Motivo (aparece no e-mail)</label>
                <input id="deb-reason" className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: sessão cancelada pelo organizador em 20/12" />
              </div>
              <div>
                <label htmlFor="deb-cost" className={labelCls}>Custo de processamento não devolvido (R$)</label>
                <input id="deb-cost" inputMode="decimal" className={inputCls} value={procCost} onChange={e => setProcCost(e.target.value)} />
              </div>
              <div>
                <label htmlFor="deb-note" className={labelCls}>Observação interna</label>
                <input id="deb-note" className={inputCls} value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>
            <button type="button" className={btnPrimary} disabled={picked.size === 0 || reason.trim().length < 5 || busy === 'create'} onClick={() => void createDebt()}>
              {busy === 'create' && <Loader2 size={12} className="animate-spin" />} Criar rascunho
            </button>
          </div>
        )}
      </section>

      {/* ── Lista ── */}
      <section className="space-y-3">
        {debts === null && <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando...</p>}
        {debts !== null && debts.length === 0 && <p className="text-xs text-slate-500">Nenhum débito registrado. Quando uma sessão de um produtor for cancelada e houver ingressos estornados já repassados, crie o débito acima.</p>}
        {(debts ?? []).map(d => {
          const p = producers[d.producer_id];
          const overdue = d.status === 'notificada' && d.due_at && new Date(d.due_at).getTime() < Date.now();
          const working = busy === d.id;
          return (
            <article key={d.id} className="bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-black text-slate-900 dark:text-white tabular-nums">{brl(d.amount_due)}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{d.reason}</p>
                  <p className="text-[10px] text-slate-500 truncate">{eventName[d.event_id ?? ''] ?? 'Evento'} · {p?.full_name ?? 'Produtor'} ({p?.email ?? '—'})</p>
                </div>
                <div className="flex items-center gap-2">
                  {overdue && <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-rose-500/15 text-rose-700 dark:text-rose-300">Vencido: vendas suspensas</span>}
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${STATUS_CLS[d.status]}`}>{d.status}</span>
                </div>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div><dt className={labelCls}>Sugerido</dt><dd className="text-slate-800 dark:text-slate-200">{brl(d.suggested_amount)}</dd></div>
                <div><dt className={labelCls}>Aviso</dt><dd className="text-slate-800 dark:text-slate-200">{fmt(d.notice_sent_at)}</dd></div>
                <div><dt className={labelCls}>Contestar até</dt><dd className="text-slate-800 dark:text-slate-200">{fmt(d.contest_until)}</dd></div>
                <div><dt className={labelCls}>Repor até</dt><dd className="text-slate-800 dark:text-slate-200">{fmt(d.due_at)}</dd></div>
              </dl>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Repassado ao produtor <strong>{brl(Number(d.suggested_amount) - Number(d.processing_cost))}</strong>
                {' + '}custo de processamento <strong>{brl(d.processing_cost)}</strong>
                {' = '}sugerido <strong>{brl(d.suggested_amount)}</strong>
                {Number(d.amount_due) !== Number(d.suggested_amount) && <> · a cobrar <strong>{brl(d.amount_due)}</strong> (ajustado)</>}
              </p>
              {d.admin_note && <p className="text-[11px] text-slate-500">Obs.: {d.admin_note}</p>}
              {d.invoice_url && (
                <a href={d.invoice_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#ff0068]/40 bg-[#ff0068]/5 text-[#ff0068] hover:bg-[#ff0068]/10 text-[10px] font-black uppercase tracking-widest">
                  Abrir cobrança na Asaas <ExternalLink size={12} />
                </a>
              )}

              {d.status === 'rascunho' && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-40">
                    <label htmlFor={`amt-${d.id}`} className={labelCls}>Valor a cobrar (R$)</label>
                    <input id={`amt-${d.id}`} inputMode="decimal" className={inputCls} value={amounts[d.id] ?? String(d.amount_due)} onChange={e => setAmounts(a => ({ ...a, [d.id]: e.target.value }))} />
                  </div>
                  <button type="button" className={btnGhost} disabled={working} onClick={() => void act(d, { action: 'update', amount_due: Number((amounts[d.id] ?? String(d.amount_due)).replace(',', '.')) }, 'Valor salvo.')}>Salvar valor</button>
                  <button type="button" className={btnPrimary} disabled={working} onClick={() => void act(d, { action: 'notify' }, 'Produtor notificado e cobrança gerada.', 'Notificar o produtor por e-mail e gerar a cobrança PIX/boleto? Os prazos (5 e 10 dias) começam agora.')}>
                    {working && <Loader2 size={12} className="animate-spin" />} Notificar produtor
                  </button>
                  <button type="button" className={btnGhost} disabled={working} onClick={() => void act(d, { action: 'cancel' }, 'Débito cancelado.', 'Cancelar este débito?')}>Cancelar</button>
                </div>
              )}

              {d.status === 'notificada' && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} disabled={working} onClick={() => void act(d, { action: 'mark_paid', note: 'Pago fora da plataforma' }, 'Débito marcado como pago (cobrança apagada).', 'Marcar como pago por fora? A cobrança na Asaas será apagada.')}>Marcar como pago (por fora)</button>
                  <button type="button" className={btnGhost} disabled={working} onClick={() => void act(d, { action: 'cancel' }, 'Débito cancelado.', 'Cancelar este débito? A cobrança na Asaas será apagada.')}>Cancelar débito</button>
                </div>
              )}

              {d.status === 'contestada' && (
                <div className="space-y-2 rounded-2xl bg-sky-500/10 p-3">
                  <p className="text-[11px] text-sky-900 dark:text-sky-100 flex items-start gap-1.5"><AlertCircle size={12} className="mt-0.5 shrink-0" /> <span><strong>Contestação do produtor:</strong> {d.contest_text}</span></p>
                  <div className="grid sm:grid-cols-[1fr_140px] gap-2">
                    <div>
                      <label htmlFor={`rn-${d.id}`} className={labelCls}>Resposta ao produtor</label>
                      <input id={`rn-${d.id}`} className={inputCls} value={resolveNote[d.id] ?? ''} onChange={e => setResolveNote(n => ({ ...n, [d.id]: e.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor={`rv-${d.id}`} className={labelCls}>Novo valor (ajustar)</label>
                      <input id={`rv-${d.id}`} inputMode="decimal" className={inputCls} value={amounts[d.id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [d.id]: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={btnGhost} disabled={working} onClick={() => void act(d, { action: 'resolve_contest', outcome: 'manter', note: resolveNote[d.id] ?? '' }, 'Valor mantido e produtor avisado.')}>Manter valor</button>
                    <button type="button" className={btnPrimary} disabled={working || !(Number((amounts[d.id] ?? '').replace(',', '.')) >= 5)} onClick={() => void act(d, { action: 'resolve_contest', outcome: 'ajustar', new_amount: Number((amounts[d.id] ?? '').replace(',', '.')), note: resolveNote[d.id] ?? '' }, 'Valor ajustado, nova cobrança gerada e produtor avisado.')}>Ajustar valor</button>
                    <button type="button" className={btnGhost} disabled={working} onClick={() => void act(d, { action: 'resolve_contest', outcome: 'cancelar', note: resolveNote[d.id] ?? '' }, 'Débito cancelado.', 'Cancelar o débito por causa da contestação?')}>Cancelar débito</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
};

const DebitosProdutores: React.FC = () => (
  <SuperAdminMfaGate>
    <Inner />
  </SuperAdminMfaGate>
);

export default DebitosProdutores;
