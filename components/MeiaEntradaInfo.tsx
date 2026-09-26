import React, { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { supabase } from '../services/supabase';
import { FISCALIZACAO_MEIA, LEI_12933_ART1, summarizeMeia, type StockLike, type TicketTypeLike } from '../utils/meiaEntrada';

/**
 * Informações de meia-entrada exigidas em TODO ponto de venda virtual (Decreto
 * 8.537/2015 art. 11): total de ingressos, quantos são de meia, aviso de
 * esgotamento (texto, legível por leitor de tela) e a transcrição do art. 1º da
 * Lei 12.933/2013 com os órgãos de fiscalização.
 *
 * Busca o estoque sozinho (get_audience_stock, RPC pública) pra funcionar igual
 * na vitrine e no checkout. Sempre renderiza — nunca esconde (empty state visível).
 */
interface Props {
  eventId: string;
  /** Evento com mapa de assentos: sem estoque por tipo, a capacidade é o total de lugares do mapa. */
  seatMapEnabled?: boolean;
  ingressos: TicketTypeLike[];
}

const MeiaEntradaInfo: React.FC<Props> = ({ eventId, ingressos, seatMapEnabled = false }) => {
  const [stock, setStock] = useState<Record<string, StockLike>>({});
  const [seatCount, setSeatCount] = useState<{ total: number; livres: number } | null>(null);

  useEffect(() => {
    if (!eventId || !seatMapEnabled) { setSeatCount(null); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_event_seats_public_v2', { p_event_id: eventId, p_hold_token: null });
      if (error) { console.warn('[MeiaEntradaInfo] get_event_seats_public_v2:', error.message); return; }
      if (cancelled || !Array.isArray(data)) return;
      const rows = data as Array<{ status: string }>;
      setSeatCount({ total: rows.length, livres: rows.filter(r => r.status === 'livre').length });
    })();
    return () => { cancelled = true; };
  }, [eventId, seatMapEnabled]);

  useEffect(() => {
    const types = (Array.isArray(ingressos) ? ingressos : [])
      .map((t, idx) => ({ id: String(idx), total: t?.quantidade_total != null && Number(t.quantidade_total) > 0 ? Number(t.quantidade_total) : null }))
      .filter(t => t.total != null);
    if (!eventId || types.length === 0) { setStock({}); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_audience_stock', { p_event_id: eventId, p_types: types });
      if (error) { console.warn('[MeiaEntradaInfo] get_audience_stock:', error.message); return; }
      if (cancelled || !Array.isArray(data)) return;
      const map: Record<string, StockLike> = {};
      for (const r of data as Array<{ ticket_type_id: string; remaining: number | null; sold_out: boolean }>) {
        map[String(r.ticket_type_id)] = { remaining: r.remaining, sold_out: r.sold_out };
      }
      setStock(map);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, JSON.stringify((ingressos ?? []).map(t => t?.quantidade_total ?? null))]);

  const s = useMemo(() => summarizeMeia(ingressos, stock), [ingressos, stock]);

  return (
    <section aria-label="Informações sobre meia-entrada" className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3 text-slate-300">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
        <Info size={12} aria-hidden="true" /> Ingressos e meia-entrada
      </p>

      <div className="text-xs space-y-1">
        {seatCount && !s.totalKnown && (
          <p>
            <strong className="text-white">{seatCount.total}</strong> lugares no mapa,{' '}
            <strong className="text-white">{seatCount.livres}</strong> ainda disponíve{seatCount.livres === 1 ? 'l' : 'is'}.
          </p>
        )}
        {s.totalKnown ? (
          <p>
            <strong className="text-white">{s.total}</strong> ingressos no total ·{' '}
            <strong className="text-white">{s.meiaTotal}</strong> de meia-entrada
            {s.hasMeia && <> (<strong className="text-white">{s.meiaRemaining}</strong> ainda disponíve{s.meiaRemaining === 1 ? 'l' : 'is'})</>}
          </p>
        ) : (
          <p>
            Este evento tem tipos de ingresso sem limite de quantidade definido. Meia-entrada:{' '}
            {s.hasMeia ? 'há tipo de meia-entrada à venda.' : 'nenhum tipo de meia-entrada à venda no momento.'}
          </p>
        )}
        {s.rows.length > 0 && (
          <ul className="text-[11px] text-slate-400 space-y-0.5 pt-1">
            {s.rows.map(r => (
              <li key={r.idx}>
                {r.nome}
                {r.category === 'meia' && ' (meia-entrada)'}
                {r.category === 'promocional' && ' (promocional, não conta na cota de meia)'}
                {' — '}
                {r.total == null ? 'sem limite de quantidade' : r.esgotado ? 'esgotado' : `${r.remaining} de ${r.total} disponíveis`}
              </li>
            ))}
          </ul>
        )}
        {s.meiaExhausted && (
          <p role="status" className="text-[11px] font-black text-amber-300 pt-1">
            Aviso: os ingressos de meia-entrada estão esgotados.
          </p>
        )}
      </div>

      <details className="text-[11px] leading-relaxed">
        <summary className="cursor-pointer font-bold text-slate-200 hover:text-white">
          Condições da meia-entrada (Lei nº 12.933/2013, art. 1º) e órgãos de fiscalização
        </summary>
        <div className="mt-2 space-y-2 text-slate-400">
          {LEI_12933_ART1.map((p, i) => <p key={i}>{p}</p>)}
          <p className="pt-2 border-t border-white/10">
            <strong className="text-slate-200">Órgãos de fiscalização:</strong> {FISCALIZACAO_MEIA.texto}{' '}
            <a href={FISCALIZACAO_MEIA.linkHref} target="_blank" rel="noopener noreferrer" className="underline text-emerald-400">
              {FISCALIZACAO_MEIA.linkLabel}
            </a>
          </p>
        </div>
      </details>
    </section>
  );
};

export default MeiaEntradaInfo;
