import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Paintbrush, Eraser } from 'lucide-react';
import { supabase } from '../services/supabase';
import SeatGrid from './SeatGrid';
import { useSeatMap, type SeatStatus } from '../hooks/useSeatMap';
import { expandRow, toggleMany } from '../utils/seatBlock';
import {
  MAX_SEAT_ZONES, validateZonePricing, zoneKeyFromName, type SeatZone,
} from '../supabase/functions/_shared/seat-zone-pricing';

const PALETTE = ['#ff0068', '#1de7f2', '#e3ff0a', '#a78bfa', '#34d399', '#fb923c', '#60a5fa', '#f472b6'];
const EDITABLE = new Set(['livre', 'bloqueado']);

type SeatZoneRow = { seat_id: string; zone_key: string | null; status: SeatStatus['status'] };
type Sibling = { id: string; label: string };

interface Props {
  eventId: string;
  /** Zonas já salvas no evento (events.seat_zones). */
  zones: SeatZone[];
  /** Chamado depois que as zonas são salvas, pro resto da tela (tabela de preços) acompanhar. */
  onZonesSaved: (zones: SeatZone[]) => void;
}

const sameZones = (a: SeatZone[], b: SeatZone[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Zonas do mapa de assentos (Etapa 3 do preço por zona): o produtor cria até 8
 * zonas (nome + cor) e pinta os assentos — clique, fileira inteira ou "todos sem
 * zona". Cada assento tem exatamente uma zona; sem zona vale o preço-base.
 * Assento já reservado/vendido não muda de zona (o servidor também barra).
 */
export default function SeatZonesEditor({ eventId, zones, onZonesSaved }: Props) {
  const [draft, setDraft] = useState<SeatZone[]>(zones);
  const [zoneRows, setZoneRows] = useState<Record<string, SeatZoneRow>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [siblings, setSiblings] = useState<Sibling[]>([]);
  const [applyToSiblings, setApplyToSiblings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { setDraft(zones); }, [zones]);

  const { rowsConfig, seatStatuses: liveStatuses } = useSeatMap({ eventId, enabled: true, pollMs: 30_000 });

  const loadZoneRows = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_event_seat_zones', { p_event_id: eventId });
    if (error) { setMsg({ kind: 'err', text: 'Não foi possível ler as zonas dos assentos.' }); console.error('[SeatZonesEditor]', error.message); return; }
    const map: Record<string, SeatZoneRow> = {};
    for (const r of (data ?? []) as SeatZoneRow[]) map[r.seat_id] = r;
    setZoneRows(map);
  }, [eventId]);
  useEffect(() => { void loadZoneRows(); }, [loadZoneRows]);

  // Sessões irmãs (mesmo espetáculo, mesmo local e dono): a divisão do mapa se repete nelas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: me } = await supabase.from('events').select('session_group_id, venue_id, created_by').eq('id', eventId).maybeSingle();
      if (!me?.session_group_id) { if (!cancelled) setSiblings([]); return; }
      const { data, error } = await supabase.from('events')
        .select('id, start_date, event_time, venue_id, seat_map_enabled, created_by')
        .eq('session_group_id', me.session_group_id).neq('id', eventId);
      if (error) { console.error('[SeatZonesEditor] irmãs:', error.message); return; }
      const list = (data ?? [])
        .filter((x: any) => x.seat_map_enabled && x.venue_id === me.venue_id && x.created_by === me.created_by)
        .map((x: any) => ({
          id: x.id as string,
          label: `${x.start_date ? String(x.start_date).split('-').reverse().slice(0, 2).join('/') : 'sessão'}${x.event_time ? ` ${String(x.event_time).slice(0, 5)}` : ''}`,
        }));
      if (!cancelled) setSiblings(list);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const dirty = !sameZones(draft, zones);
  const draftErrors = useMemo(() => validateZonePricing(draft, []), [draft]);
  const colorByKey = useMemo(() => Object.fromEntries(zones.map(z => [z.key, z.cor])), [zones]);

  const gridStatuses = useMemo(() => {
    const out: Record<string, SeatStatus> = {};
    for (const r of Object.values(zoneRows)) {
      out[r.seat_id] = { seat_id: r.seat_id, status: r.status, is_pcd: false, seat_tipo: liveStatuses[r.seat_id]?.seat_tipo };
    }
    return out;
  }, [zoneRows, liveStatuses]);

  const seatColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of Object.values(zoneRows)) if (r.zone_key && colorByKey[r.zone_key]) out[r.seat_id] = colorByKey[r.zone_key];
    return out;
  }, [zoneRows, colorByKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { _sem: 0 };
    for (const r of Object.values(zoneRows)) {
      const k = r.zone_key && colorByKey[r.zone_key] ? r.zone_key : '_sem';
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [zoneRows, colorByKey]);

  const targetIds = (): string[] => [eventId, ...(applyToSiblings ? siblings.map(s => s.id) : [])];

  const addZone = () => {
    if (draft.length >= MAX_SEAT_ZONES) return;
    const cor = PALETTE.find(c => !draft.some(z => z.cor === c)) ?? PALETTE[draft.length % PALETTE.length];
    let n = draft.length + 1; let nome = `Zona ${n}`;
    while (draft.some(z => z.nome === nome)) { n += 1; nome = `Zona ${n}`; }
    setDraft([...draft, { key: zoneKeyFromName(nome), nome, cor }]);
  };
  const renameZone = (i: number, nome: string) =>
    setDraft(draft.map((z, k) => (k === i ? { ...z, nome } : z)));
  const recolorZone = (i: number, cor: string) =>
    setDraft(draft.map((z, k) => (k === i ? { ...z, cor } : z)));
  const removeZone = (i: number) => setDraft(draft.filter((_, k) => k !== i));

  const saveZones = async () => {
    setMsg(null);
    // Chave estável: zona já salva mantém a chave (os preços dependem dela); nova nasce do nome.
    const savedByIndexKey = new Set(zones.map(z => z.key));
    const used = new Set<string>();
    const next = draft.map(z => {
      let key = savedByIndexKey.has(z.key) ? z.key : (zoneKeyFromName(z.nome) || 'zona');
      let base = key; let n = 2;
      while (used.has(key)) { key = `${base.slice(0, 20)}-${n++}`; }
      used.add(key);
      return { ...z, key, nome: z.nome.trim() };
    });
    const errs = validateZonePricing(next, []);
    if (errs.length > 0) { setMsg({ kind: 'err', text: errs[0] }); return; }

    // Zona removida: só dá se nenhum assento reservado/vendido ainda estiver nela.
    const removed = zones.filter(z => !next.some(n => n.key === z.key));
    for (const z of removed) {
      const inUse = Object.values(zoneRows).filter(r => r.zone_key === z.key);
      if (inUse.some(r => !EDITABLE.has(r.status))) {
        setMsg({ kind: 'err', text: `A zona "${z.nome}" tem assento já reservado ou vendido e não pode ser removida.` });
        return;
      }
    }

    setBusy(true);
    try {
      for (const z of removed) {
        const ids = Object.values(zoneRows).filter(r => r.zone_key === z.key).map(r => r.seat_id);
        if (ids.length === 0) continue;
        for (const ev of targetIds()) {
          const { error } = await supabase.rpc('set_event_seat_zones', { p_event_id: ev, p_zone_key: null, p_seat_ids: ids });
          if (error) throw new Error(error.message);
        }
      }
      for (const ev of targetIds()) {
        const { error } = await supabase.from('events').update({ seat_zones: next }).eq('id', ev);
        if (error) throw new Error(error.message);
      }
      onZonesSaved(next);
      setDraft(next);
      await loadZoneRows();
      setMsg({ kind: 'ok', text: 'Zonas salvas.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: `Não foi possível salvar as zonas: ${e?.message ?? e}` });
    } finally {
      setBusy(false);
    }
  };

  const paint = async (zoneKey: string | null) => {
    if (selected.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const parts: string[] = [];
      for (const ev of targetIds()) {
        const { data, error } = await supabase.rpc('set_event_seat_zones', { p_event_id: ev, p_zone_key: zoneKey, p_seat_ids: selected });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        const skipped = (row?.skipped ?? []) as string[];
        const label = ev === eventId ? 'Esta sessão' : (siblings.find(s => s.id === ev)?.label ?? 'Outra sessão');
        parts.push(`${label}: ${row?.updated ?? 0} lugar(es)${skipped.length ? `, ${skipped.length} ocupado(s) mantido(s)` : ''}`);
      }
      setSelected([]);
      await loadZoneRows();
      setMsg({ kind: 'ok', text: parts.join(' · ') });
    } catch (e: any) {
      setMsg({ kind: 'err', text: `Não foi possível pintar: ${e?.message ?? e}` });
    } finally {
      setBusy(false);
    }
  };

  const toggleSeat = (id: string) => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const toggleRowSel = (code: string) => {
    const ids = expandRow(rowsConfig, code).filter(id => EDITABLE.has(zoneRows[id]?.status ?? 'livre'));
    setSelected(prev => toggleMany(prev, ids));
  };
  const selectUnzoned = () =>
    setSelected(Object.values(zoneRows).filter(r => !r.zone_key && EDITABLE.has(r.status)).map(r => r.seat_id));

  const inputCls = 'bg-transparent border border-slate-300 dark:border-white/10 rounded-lg py-1.5 px-3 text-slate-900 dark:text-white text-xs font-bold focus:outline-none focus:border-[#ff0068]/50';
  const btnCls = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Divida o mapa em zonas (ex.: Frente, Centro, Laterais, Fundo) e dê um preço a cada uma na tabela abaixo.
        Lugar sem zona usa o preço-base do ingresso. Zona de lugar já reservado ou vendido não muda.
      </p>

      {/* ── Zonas ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {draft.map((z, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="color" value={z.cor} onChange={e => recolorZone(i, e.target.value)}
              aria-label={`Cor da zona ${z.nome}`} className="w-9 h-9 rounded-lg border border-slate-300 dark:border-white/10 bg-transparent cursor-pointer p-0.5"
            />
            <input
              type="text" value={z.nome} maxLength={40} onChange={e => renameZone(i, e.target.value)}
              aria-label={`Nome da zona ${i + 1}`} placeholder="Nome da zona" className={`${inputCls} flex-1 min-w-0`}
            />
            <button type="button" onClick={() => removeZone(i)} aria-label={`Remover a zona ${z.nome}`} className="p-2 text-slate-400 hover:text-rose-500">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={addZone} disabled={draft.length >= MAX_SEAT_ZONES || busy} className={`${btnCls} bg-[#ff0068]/10 text-[#ff0068] hover:bg-[#ff0068]/20`}>
            <Plus size={12} /> Adicionar zona
          </button>
          <button type="button" onClick={saveZones} disabled={!dirty || busy || draftErrors.length > 0} className={`${btnCls} bg-[#ff0068] text-white hover:bg-[#e0005c]`}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null} Salvar zonas
          </button>
          <span className="text-[10px] text-slate-500">{draft.length}/{MAX_SEAT_ZONES} zonas</span>
          {dirty && draftErrors[0] && <span className="text-[10px] text-rose-500">{draftErrors[0]}</span>}
        </div>
      </div>

      {/* ── Pintar o mapa ─────────────────────────────────────────────────── */}
      {zones.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">Crie e salve ao menos uma zona para pintar o mapa.</p>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-3 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pintar o mapa</p>
          <div className="flex flex-wrap gap-2">
            {zones.map(z => (
              <button
                key={z.key} type="button" disabled={busy || selected.length === 0 || dirty}
                onClick={() => paint(z.key)}
                title={dirty ? 'Salve as zonas antes de pintar' : `Aplicar "${z.nome}" aos ${selected.length} lugar(es) selecionado(s)`}
                className={`${btnCls} border`} style={{ borderColor: `${z.cor}99`, color: z.cor, backgroundColor: `${z.cor}1a` }}
              >
                <Paintbrush size={11} /> {z.nome} <span className="opacity-70 normal-case tracking-normal font-bold">({counts[z.key] ?? 0})</span>
              </button>
            ))}
            <button type="button" disabled={busy || selected.length === 0 || dirty} onClick={() => paint(null)} className={`${btnCls} border border-slate-300 dark:border-white/10 text-slate-500`}>
              <Eraser size={11} /> Tirar zona <span className="opacity-70 normal-case tracking-normal font-bold">({counts._sem ?? 0} sem)</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
            <span><b>{selected.length}</b> selecionado(s) — clique nos lugares ou no nome da fileira</span>
            <button type="button" onClick={selectUnzoned} className="font-black uppercase tracking-widest text-[#ff0068] hover:underline">Selecionar todos sem zona</button>
            {selected.length > 0 && <button type="button" onClick={() => setSelected([])} className="font-black uppercase tracking-widest hover:underline">Limpar seleção</button>}
          </div>
          {siblings.length > 0 && (
            <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={applyToSiblings} onChange={e => setApplyToSiblings(e.target.checked)} className="w-4 h-4 accent-[#ff0068]" />
              Repetir nas outras sessões ({siblings.map(s => s.label).join(', ')})
            </label>
          )}
          <SeatGrid
            rowsConfig={rowsConfig}
            seatStatuses={gridStatuses}
            selectedSeats={selected}
            onToggle={toggleSeat}
            onToggleRow={toggleRowSel}
            mode="zone"
            variant="auto"
            size="sm"
            zoomable
            seatZoneColors={seatColors}
          />
        </div>
      )}

      {msg && (
        <p role="status" className={`text-[11px] font-bold ${msg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>{msg.text}</p>
      )}
    </div>
  );
}
