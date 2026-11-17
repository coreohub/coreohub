/**
 * SwapSeatModal — troca o lugar de um ingresso JA PAGO (painel do produtor / super admin).
 *
 * Mapa com o lugar atual realcado; só lugares livres, comuns e da MESMA zona (mesmo preço)
 * podem ser escolhidos. Nao mexe em dinheiro. Duas opcoes na confirmacao (ligadas por
 * padrao): liberar o lugar antigo para venda e avisar a cliente por e-mail. A troca em si
 * e feita pela edge function swap-ticket-seat (RPC tudo-ou-nada, com auditoria).
 */

import { remapZonesForPublic } from '../utils/zoneColor';
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, Armchair, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import SeatGrid from './SeatGrid';
import SeatLegend from './SeatLegend';
import { supabase } from '../services/supabase';
import { edgeErrorMessage } from '../utils/edgeError';
import type { SeatRow, SeatStatus } from '../hooks/useSeatMap';
import type { SeatZone } from '../supabase/functions/_shared/seat-zone-pricing';
import { SWAP_REASON_MAX } from '../supabase/functions/_shared/seat-swap';
import { groupSplitWarning, orderSplitWarning, seatLabel, sortSeats, swapLockedSeats } from '../utils/seatSwap';

export interface SwapSeatTicket {
  id: string;
  event_id: string;
  buyer_name: string;
  ticket_type_nome: string;
  seat_id: string;
}

export interface SwapSeatResult {
  old_seat_id: string;
  new_seat_id: string;
  /** Um item por ingresso trocado (1 no modo simples, N no pedido inteiro). */
  changes: { old_seat_id: string; new_seat_id: string }[];
  released_old: boolean;
  email: 'enviado' | 'falhou' | 'nao_solicitado';
}

interface Props {
  ticket: SwapSeatTicket;
  rowsConfig: SeatRow[] | null;
  seatStatuses: Record<string, SeatStatus>;
  zoneBySeat: Record<string, string>;
  seatZones: SeatZone[];
  /** Lugares atuais dos OUTROS ingressos aprovados do mesmo pedido (group_id). */
  groupOtherSeats: string[];
  /** Demais ingressos aprovados e com lugar do mesmo pedido: habilita "trocar o pedido inteiro". */
  orderMates?: { id: string; seat_id: string; ticket_type_nome: string }[];
  onClose: () => void;
  /** Chamado apos a troca: o pai recarrega a lista e o mapa. */
  onDone: (r: SwapSeatResult) => void;
}

const SwapSeatModal: React.FC<Props> = ({ ticket, rowsConfig, seatStatuses, zoneBySeat, seatZones: seatZonesRaw, groupOtherSeats, orderMates = [], onClose, onDone }) => {
  const seatZones = useMemo(() => remapZonesForPublic(seatZonesRaw), [seatZonesRaw]);
  const [newSeat, setNewSeat] = useState<string | null>(null);
  const [wholeOrder, setWholeOrder] = useState(false);
  const [newSeats, setNewSeats] = useState<string[]>([]);
  const [confirmSplit, setConfirmSplit] = useState(false);
  const [releaseOld, setReleaseOld] = useState(true);
  const [notifyBuyer, setNotifyBuyer] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SwapSeatResult | null>(null);

  const currentZone = zoneBySeat[ticket.seat_id] ?? null;
  const zoneName = currentZone ? (seatZones.find(z => z.key === currentZone)?.nome ?? currentZone) : null;
  const lockedSeats = useMemo(() => swapLockedSeats(seatStatuses, zoneBySeat, currentZone), [seatStatuses, zoneBySeat, currentZone]);
  const zoneColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, k] of Object.entries(zoneBySeat)) {
      const c = seatZones.find(z => z.key === k)?.cor;
      if (c) out[id] = c;
    }
    return out;
  }, [zoneBySeat, seatZones]);
  const groupWarning = !wholeOrder && newSeat ? groupSplitWarning(groupOtherSeats, newSeat) : null;

  // Pedido inteiro: ingressos ordenados pelo lugar atual recebem os novos lugares ordenados.
  const orderTickets = useMemo(() => {
    const all = [{ id: ticket.id, seat_id: ticket.seat_id, ticket_type_nome: ticket.ticket_type_nome }, ...orderMates];
    const order = sortSeats(all.map(t => t.seat_id));
    return order.map(sid => all.find(t => t.seat_id === sid)!);
  }, [ticket, orderMates]);
  const need = orderTickets.length;
  const pairs = useMemo(() => {
    if (!wholeOrder || newSeats.length !== need) return [];
    const news = sortSeats(newSeats);
    return orderTickets.map((t, i) => ({ ticket_id: t.id, old_seat_id: t.seat_id, new_seat_id: news[i] }));
  }, [wholeOrder, newSeats, need, orderTickets]);
  const orderWarning = wholeOrder && newSeats.length === need ? orderSplitWarning(newSeats) : null;
  const ready = wholeOrder ? pairs.length === need && (!orderWarning || confirmSplit) : !!newSeat;
  const toggleSeat = (id: string) => {
    setError(null);
    if (!wholeOrder) { setNewSeat(prev => (prev === id ? null : id)); return; }
    setConfirmSplit(false);
    setNewSeats(prev => (prev.includes(id) ? prev.filter(x => x !== id) : prev.length < need ? [...prev, id] : prev));
  };

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke('swap-ticket-seat', {
        body: {
          event_id: ticket.event_id,
          ...(wholeOrder
            ? { swaps: pairs.map(p => ({ ticket_id: p.ticket_id, new_seat_id: p.new_seat_id })) }
            : { ticket_id: ticket.id, new_seat_id: newSeat }),
          release_old: releaseOld,
          notify_buyer: notifyBuyer,
          reason: reason.trim() || undefined,
        },
      });
      if (invErr) throw new Error(await edgeErrorMessage(invErr, 'Não foi possível trocar o lugar. Tente de novo.'));
      if (data?.error) throw new Error(data.error);
      const r: SwapSeatResult = {
        old_seat_id: data.old_seat_id,
        new_seat_id: data.new_seat_id,
        changes: (data.changes ?? []).map((c: any) => ({ old_seat_id: c.old_seat_id, new_seat_id: c.new_seat_id })),
        released_old: data.released_old,
        email: data.email,
      };
      setResult(r);
      onDone(r);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Trocar lugar do ingresso"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Trocar lugar</p>
            <h3 className="text-base font-black tracking-tight text-slate-900 dark:text-white truncate">{ticket.buyer_name}</h3>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Fechar" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 shrink-0 disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        {result ? (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-sm text-slate-800 dark:text-slate-100">
                <p className="font-black">{result.changes.length > 1 ? 'Lugares trocados.' : 'Lugar trocado.'}</p>
                {result.changes.map(c => (
                  <p key={c.old_seat_id} className="mt-1">{seatLabel(c.old_seat_id)} <ArrowRight size={12} className="inline mx-1" /> <strong>{seatLabel(c.new_seat_id)}</strong></p>
                ))}
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  {result.released_old ? (result.changes.length > 1 ? 'Os lugares antigos voltaram para a venda.' : 'O lugar antigo voltou para a venda.') : (result.changes.length > 1 ? 'Os lugares antigos ficaram bloqueados, fora da venda.' : 'O lugar antigo ficou bloqueado, fora da venda.')}{' '}
                  {result.email === 'enviado' && 'A cliente foi avisada por e-mail.'}
                  {result.email === 'falhou' && 'O e-mail para a cliente não saiu. Avise por outro canal. A troca está feita.'}
                  {result.email === 'nao_solicitado' && 'A cliente não foi avisada (você desligou o aviso).'}
                  {' '}O link e o QR do ingresso continuam os mesmos.
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="w-full px-4 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] font-black uppercase tracking-widest">
              Fechar
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 text-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Lugar atual</p>
              <p className="mt-1 font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Armchair size={16} className="text-brand-primary" /> {seatLabel(ticket.seat_id)}
                {zoneName && <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">· zona {zoneName}</span>}
              </p>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                Escolha no mapa um lugar livre{zoneName ? ` da zona ${zoneName}` : ''}. A troca não cobra nem devolve nada: o preço é o mesmo.
              </p>
            </div>

            {orderMates.length > 0 && (
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 dark:bg-white/5 p-1" role="group" aria-label="O que trocar">
                {[{ v: false, t: 'Só este ingresso' }, { v: true, t: `Pedido inteiro (${need})` }].map(o => (
                  <button
                    key={String(o.v)}
                    type="button"
                    aria-pressed={wholeOrder === o.v}
                    onClick={() => { setWholeOrder(o.v); setNewSeat(null); setNewSeats([]); setConfirmSplit(false); setError(null); }}
                    className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest ${wholeOrder === o.v ? 'bg-white dark:bg-slate-800 text-brand-primary shadow-sm' : 'text-slate-500'}`}
                  >
                    {o.t}
                  </button>
                ))}
              </div>
            )}
            {wholeOrder && (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Escolha {need} lugares no mapa ({newSeats.length}/{need}). Eles são distribuídos na ordem: o menor lugar atual recebe o menor lugar novo.
              </p>
            )}

            <div className="border border-slate-200 dark:border-white/10 rounded-xl p-2">
              <SeatGrid
                rowsConfig={rowsConfig}
                seatStatuses={seatStatuses}
                selectedSeats={wholeOrder ? newSeats : (newSeat ? [newSeat] : [])}
                onToggle={toggleSeat}
                size="sm"
                variant="auto"
                pcdQty={0}
                obesoQty={0}
                compQty={0}
                comumQty={wholeOrder ? need : 1}
                lockedSeats={lockedSeats}
                markedSeats={wholeOrder ? orderTickets.map(t => t.seat_id) : [ticket.seat_id]}
                seatZoneColors={Object.keys(zoneColors).length > 0 ? zoneColors : undefined}
                zoomable
              />
              <SeatLegend rowsConfig={rowsConfig} variant="auto" />
              <p className="mt-2 text-[10px] text-slate-500">{wholeOrder ? 'Os lugares com contorno amarelo são os atuais do pedido.' : 'O lugar com contorno amarelo é o atual do ingresso.'}</p>
            </div>

            {wholeOrder && pairs.length > 0 && (
              <div className="rounded-2xl border border-brand-primary/30 bg-brand-primary/5 p-4 text-sm text-slate-800 dark:text-slate-100 space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Novos lugares</p>
                {pairs.map(p => (
                  <p key={p.ticket_id} className="font-black flex items-center gap-2 flex-wrap">
                    {seatLabel(p.old_seat_id)} <ArrowRight size={14} /> {seatLabel(p.new_seat_id)}
                  </p>
                ))}
              </div>
            )}
            {orderWarning && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <p>{orderWarning} Você pode continuar, mas confirme abaixo.</p>
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={confirmSplit} onChange={e => setConfirmSplit(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#FF0068]" />
                  <span><strong>Entendi que os lugares ficarão separados.</strong></span>
                </label>
              </div>
            )}

            {!wholeOrder && newSeat && (
              <div className="rounded-2xl border border-brand-primary/30 bg-brand-primary/5 p-4 text-sm text-slate-800 dark:text-slate-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Novo lugar</p>
                <p className="mt-1 font-black flex items-center gap-2 flex-wrap">
                  {seatLabel(ticket.seat_id)} <ArrowRight size={14} /> {seatLabel(newSeat)}
                </p>
              </div>
            )}

            {groupWarning && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <p>{groupWarning} Você pode continuar, a troca vale só para este ingresso.</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="flex items-start gap-3 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" checked={releaseOld} onChange={e => setReleaseOld(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#FF0068]" />
                <span><strong>Liberar o lugar antigo para venda.</strong> Se desmarcar, o lugar antigo fica bloqueado.</span>
              </label>
              <label className="flex items-start gap-3 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" checked={notifyBuyer} onChange={e => setNotifyBuyer(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#FF0068]" />
                <span><strong>Avisar a cliente por e-mail.</strong> O e-mail lista os lugares atuais do pedido e vale sobre qualquer e-mail anterior.</span>
              </label>
            </div>

            <div>
              <label htmlFor="swap-reason" className="text-[10px] font-black uppercase tracking-widest text-slate-500">Motivo (opcional, fica no registro)</label>
              <input
                id="swap-reason"
                type="text"
                value={reason}
                maxLength={SWAP_REASON_MAX}
                onChange={e => setReason(e.target.value)}
                placeholder="Ex.: cliente escolheu lugar errado"
                className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-primary"
              />
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
              <button type="button" onClick={onClose} disabled={busy} className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!ready || busy}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-primary hover:bg-[#FF1A7D] text-white text-[11px] font-black uppercase tracking-widest disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-white/10 dark:disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                {busy ? <><Loader2 size={14} className="animate-spin" /> Trocando...</> : 'Confirmar troca'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default SwapSeatModal;
