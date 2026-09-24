import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabase';
import PageHeader from '../components/PageHeader';
import EventPickerSheet, { EventPickerOption } from '../components/EventPickerSheet';
import {
  MapPin, Plus, Loader2, X, AlertCircle, CheckCircle2, Trash2, Pencil,
  Armchair, LayoutGrid, Link2, Link2Off, Accessibility, ArrowLeftRight, Users,
} from 'lucide-react';
import { countTipos, normalizeRow, paintSeat, serializeRow, type RowConfig, type VenuePaintTool } from '../utils/venueRows';

/**
 * Biblioteca de locais + gerador de grade (Fase 2 — assento numerado,
 * docs/mostra-pricing-spec.md, "Plano técnico detalhado"). Feature de
 * PRODUTO compartilhada — qualquer evento (Começo/Essencial/Escala/
 * Espetáculo) pode vincular um local e ligar o mapa de assento, não é
 * exclusiva do Plano Espetáculo.
 *
 * Fluxo: produtor cadastra o local UMA VEZ (gerador de grade, formulário
 * estruturado — não editor livre, cobre o padrão real de teatro/auditório/
 * centro de convenções: fileiras em sequência, corredor central opcional,
 * assentos PCD marcados clicando na prévia). Depois vincula esse mesmo
 * local a quantos eventos quiser — "Usar neste evento" liga
 * events.venue_id + seat_map_enabled=true e materializa event_seats via
 * RPC generate_event_seats (idempotente).
 */

interface Venue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  rows_config: RowConfig[];
  total_seats: number;
  is_shared: boolean;
  created_at: string;
}

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const buildRows = (numFileiras: number, nomenclatura: 'letras' | 'numeros', assentosPadrao: number, corredorApos: number | null): RowConfig[] => {
  const rows: RowConfig[] = [];
  for (let i = 0; i < numFileiras; i++) {
    const codigo = nomenclatura === 'letras'
      ? String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '')
      : String(i + 1);
    rows.push({
      codigo,
      assentos: assentosPadrao,
      pcd: [],
      corredor_apos: corredorApos ?? undefined,
    });
  }
  return rows;
};

const inputCls = 'w-full p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white font-bold text-sm outline-none focus:ring-2 focus:ring-[#ff0068]';
const labelCls = 'text-[10px] font-black text-slate-500 uppercase tracking-widest px-1';

// ── Prévia da grade — a ferramenta escolhida pinta o assento clicado ──────
const TOOLS: { id: VenuePaintTool; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'comum', label: 'Comum', icon: <Armchair size={13} />, hint: 'Assento comum (apaga o tipo)' },
  { id: 'cadeirante', label: 'Cadeirante', icon: <Accessibility size={13} />, hint: 'Espaço de cadeirante' },
  { id: 'pcd_largo', label: 'PCD largo', icon: <ArrowLeftRight size={13} />, hint: 'Assento PCD largo (pessoa obesa/mobilidade reduzida)' },
  { id: 'acompanhante', label: 'Acompanhante', icon: <Users size={13} />, hint: 'Assento ao lado de um lugar PCD, reservado ao acompanhante' },
];

const SeatGridPreview: React.FC<{
  rows: RowConfig[];
  onPaint: (rowIdx: number, seatNum: number) => void;
  onChangeAssentos: (rowIdx: number, value: number) => void;
  onToggleBloco: (rowIdx: number) => void;
}> = ({ rows, onPaint, onChangeAssentos, onToggleBloco }) => (
  <div className="space-y-2 max-h-80 overflow-y-auto p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-white/10">
    {rows.map((row, rowIdx) => (
      <div key={row.codigo} className={`flex items-center gap-2 ${row.espaco_antes ? 'mt-5' : ''}`}>
        <span className="w-8 shrink-0 text-[10px] font-black text-slate-500 text-center">{row.codigo}</span>
        <input
          type="number"
          min={0}
          value={row.assentos}
          onChange={e => onChangeAssentos(rowIdx, Math.max(0, Number(e.target.value) || 0))}
          className="w-14 shrink-0 p-1 text-[10px] text-center bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-white/10 font-bold"
          aria-label={`Assentos na fileira ${row.codigo}`}
        />
        {rowIdx > 0 ? (
          <button
            type="button"
            onClick={() => onToggleBloco(rowIdx)}
            aria-pressed={!!row.espaco_antes}
            title="Iniciar um novo bloco (espaço visual) a partir desta fileira"
            className={`shrink-0 px-1.5 py-1 rounded-lg text-[9px] font-black uppercase ${row.espaco_antes ? 'bg-[#ff0068] text-white' : 'bg-white dark:bg-slate-900 text-slate-400 border border-slate-200 dark:border-white/10'}`}
          >
            Bloco
          </button>
        ) : <span className="w-[46px] shrink-0" aria-hidden="true" />}
        <div className="flex flex-wrap gap-1 flex-1 justify-center">
          {Array.from({ length: row.assentos }, (_, i) => i + 1).map(n => {
            const tipo = row.tipos?.[String(n)];
            const isComp = row.acompanhante?.[String(n)] != null;
            const isAisle = row.corredor_apos === n;
            const label = tipo === 'cadeirante'
              ? 'espaço de cadeirante'
              : tipo === 'pcd_largo'
                ? 'assento PCD largo'
                : isComp ? `acompanhante de ${row.codigo}-${row.acompanhante![String(n)]}` : '';
            return (
              <React.Fragment key={n}>
                <button
                  type="button"
                  onClick={() => onPaint(rowIdx, n)}
                  title={`${row.codigo}-${n}${label ? ` (${label})` : ''}`}
                  aria-label={`Assento ${row.codigo}-${n}${label ? `, ${label}` : ', comum'}`}
                  className={`w-6 h-6 rounded text-[8px] font-black flex items-center justify-center transition-colors ${
                    tipo
                      ? 'bg-sky-500 text-white'
                      : isComp
                        ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 ring-1 ring-sky-400/60'
                        : 'bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-white/10 hover:border-[#ff0068]/50'
                  }`}
                >
                  {tipo === 'cadeirante' ? <Accessibility size={11} /> : tipo === 'pcd_largo' ? <ArrowLeftRight size={11} /> : isComp ? <Users size={11} /> : n}
                </button>
                {isAisle && <span className="w-3" aria-hidden="true" />}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    ))}
  </div>
);

// ── Modal: criar/editar local (gerador de grade) ──────────────────────────
const VenueFormModal: React.FC<{
  editing: Venue | null;
  onClose: () => void;
  onSaved: (note?: string) => void;
}> = ({ editing, onClose, onSaved }) => {
  const [name, setName] = useState(editing?.name ?? '');
  const [city, setCity] = useState(editing?.city ?? '');
  const [state, setState] = useState(editing?.state ?? '');
  const [numFileiras, setNumFileiras] = useState(editing?.rows_config.length || 10);
  const [nomenclatura, setNomenclatura] = useState<'letras' | 'numeros'>('letras');
  const [assentosPadrao, setAssentosPadrao] = useState(20);
  const [corredorApos, setCorredorApos] = useState<number | ''>('');
  const [rows, setRows] = useState<RowConfig[]>((editing?.rows_config ?? []).map(normalizeRow));
  const [tool, setTool] = useState<VenuePaintTool>('cadeirante');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGerar = () => {
    const marcados = countTipos(rows);
    if (marcados.cadeirante + marcados.pcd_largo + marcados.acompanhante > 0
      && !window.confirm('Gerar uma nova grade apaga os lugares PCD, largos e de acompanhante já marcados. Continuar?')) return;
    setRows(buildRows(numFileiras, nomenclatura, assentosPadrao, corredorApos === '' ? null : corredorApos));
  };

  const handlePaint = (rowIdx: number, seatNum: number) => {
    const res = paintSeat(rows[rowIdx], seatNum, tool);
    if (res.error) { setError(res.error); return; }
    setError(null);
    setRows(prev => prev.map((r, i) => (i === rowIdx ? res.row : r)));
  };

  const handleChangeAssentos = (rowIdx: number, value: number) => {
    setRows(prev => prev.map((r, i) => (i === rowIdx ? { ...r, assentos: value } : r)));
  };

  const handleToggleBloco = (rowIdx: number) => {
    setRows(prev => prev.map((r, i) => (i === rowIdx ? { ...r, espaco_antes: r.espaco_antes ? undefined : true } : r)));
  };

  const temPalco = rows.length > 0 && !!rows[rows.length - 1].palco_apos;
  const handleTogglePalco = () => {
    setRows(prev => prev.map((r, i) => (i === prev.length - 1 ? { ...r, palco_apos: r.palco_apos ? undefined : true } : r)));
  };

  const totalSeats = rows.reduce((sum, r) => sum + r.assentos, 0);

  const handleSave = async () => {
    if (!name.trim()) { setError('Informe o nome do local.'); return; }
    if (rows.length === 0) { setError('Gere a prévia da grade antes de salvar.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessão expirada.');

      const payload = { name: name.trim(), city: city.trim() || null, state: state || null, rows_config: rows.map(serializeRow) };

      if (editing) {
        const { error: err } = await supabase.from('venues').update(payload).eq('id', editing.id).select('id');
        if (err) throw err;
        // Sincroniza os tipos nos eventos do produtor que já usam este local (idempotente).
        const { data: linked } = await supabase.from('events').select('id').eq('venue_id', editing.id).eq('seat_map_enabled', true).eq('created_by', user.id);
        let synced = 0;
        for (const ev of linked ?? []) {
          const { error: genErr } = await supabase.rpc('generate_event_seats', { p_event_id: ev.id });
          if (genErr) throw new Error(`Local salvo, mas não foi possível atualizar um evento: ${genErr.message}`);
          synced++;
        }
        onSaved(synced > 0 ? `Local salvo e aplicado em ${synced} evento${synced === 1 ? '' : 's'} vinculado${synced === 1 ? '' : 's'}.` : undefined);
        return;
      } else {
        const { error: err } = await supabase.from('venues').insert({ ...payload, created_by: user.id });
        if (err) throw err;
      }
      onSaved();
    } catch (e: any) {
      setError(e.message ?? 'Erro ao salvar o local.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="venue-modal-title">
      <div className="w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-white/10 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 id="venue-modal-title" className="text-lg font-black uppercase tracking-tight italic text-slate-900 dark:text-white">
            {editing ? 'Editar local' : 'Novo local'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-[11px] font-bold flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        <div className="space-y-2">
          <label className={labelCls}>Nome do local</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Ex: Centro de Convenções Jornalista Nelson Camargo" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-2">
            <label className={labelCls}>Cidade</label>
            <input value={city} onChange={e => setCity(e.target.value)} className={inputCls} placeholder="Ex: Votuporanga" />
          </div>
          <div className="space-y-2">
            <label className={labelCls}>UF</label>
            <select value={state} onChange={e => setState(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-white/5">
          <p className={`${labelCls} mb-3`}>Gerador de grade</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="space-y-1">
              <label className={labelCls}>Fileiras</label>
              <input type="number" min={1} value={numFileiras} onChange={e => setNumFileiras(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Nomenclatura</label>
              <select value={nomenclatura} onChange={e => setNomenclatura(e.target.value as 'letras' | 'numeros')} className={inputCls}>
                <option value="letras">A, B, C...</option>
                <option value="numeros">1, 2, 3...</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Assentos/fileira</label>
              <input type="number" min={1} value={assentosPadrao} onChange={e => setAssentosPadrao(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Corredor após nº</label>
              <input type="number" min={0} value={corredorApos} onChange={e => setCorredorApos(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} placeholder="opcional" />
            </div>
          </div>
          <button
            type="button"
            onClick={handleGerar}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-slate-700 dark:text-white rounded-xl font-black text-[11px] uppercase tracking-widest"
          >
            <LayoutGrid size={14} /> Gerar prévia
          </button>
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className={labelCls}>Prévia — escolha uma ferramenta e clique nos assentos</p>
              <span className="text-[10px] font-black text-slate-500">{totalSeats} assentos</span>
            </div>
            <div role="radiogroup" aria-label="Ferramenta de marcação" className="flex flex-wrap gap-1.5">
              {TOOLS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tool === t.id}
                  title={t.hint}
                  onClick={() => setTool(t.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide cursor-pointer transition-colors ${
                    tool === t.id ? 'bg-sky-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-white/10 hover:border-sky-400/60'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            <SeatGridPreview rows={rows} onPaint={handlePaint} onChangeAssentos={handleChangeAssentos} onToggleBloco={handleToggleBloco} />
            <p className="px-1 text-[10px] text-slate-500">
              {(() => { const c = countTipos(rows); return `${c.cadeirante} cadeirante · ${c.pcd_largo} PCD largo · ${c.acompanhante} acompanhante`; })()}
              {' — '}ao marcar um lugar PCD, o vizinho comum mais próximo (mesmo lado do corredor) vira o assento de acompanhante; ajuste com a ferramenta Acompanhante.
            </p>
            <label className="flex items-center gap-2 px-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={temPalco} onChange={handleTogglePalco} className="accent-[#ff0068]" />
              Desenhar o palco abaixo da última fileira
            </label>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-60 text-white rounded-xl font-black text-sm uppercase tracking-widest"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <><CheckCircle2 size={16} /> Salvar local</>}
        </button>
      </div>
    </div>,
    document.body,
  );
};

// ── Modal: vincular local a um evento ──────────────────────────────────────
const LinkEventModal: React.FC<{
  venue: Venue;
  events: (EventPickerOption & { venue_id: string | null; seat_map_enabled: boolean })[];
  onClose: () => void;
  onLinked: () => void;
}> = ({ venue, events, onClose, onLinked }) => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const selectedEvent = events.find(e => e.id === selectedEventId) ?? null;
  const alreadyLinked = !!selectedEvent && selectedEvent.venue_id === venue.id && selectedEvent.seat_map_enabled;

  const handleActivate = async () => {
    if (!selectedEventId) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const { error: updErr } = await supabase
        .from('events')
        .update({ venue_id: venue.id, seat_map_enabled: true })
        .eq('id', selectedEventId)
        .select('id');
      if (updErr) throw updErr;

      const { data: total, error: rpcErr } = await supabase.rpc('generate_event_seats', { p_event_id: selectedEventId });
      if (rpcErr) throw rpcErr;

      setResult(`Mapa ativado — ${total} assentos gerados neste evento.`);
      onLinked();
    } catch (e: any) {
      setError(e.message ?? 'Erro ao vincular o local.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!selectedEventId) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const { error: updErr } = await supabase
        .from('events')
        .update({ seat_map_enabled: false })
        .eq('id', selectedEventId)
        .select('id');
      if (updErr) throw updErr;
      setResult('Mapa de assento desativado — o evento volta a vender por setor/quantidade.');
      onLinked();
    } catch (e: any) {
      setError(e.message ?? 'Erro ao desativar o mapa.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="link-event-title">
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-white/10 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 id="link-event-title" className="text-lg font-black uppercase tracking-tight italic text-slate-900 dark:text-white">Vincular local</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Escolha o evento que vai usar <strong className="text-slate-700 dark:text-slate-300">{venue.name}</strong> ({venue.total_seats} assentos).
        </p>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-[11px] font-bold flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}
        {result && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400 text-[11px] font-bold flex items-center gap-2">
            <CheckCircle2 size={14} className="shrink-0" /> {result}
          </div>
        )}

        <EventPickerSheet events={events} selectedEventId={selectedEventId} onSelect={setSelectedEventId} emptyLabel="Selecionar evento" />

        {selectedEvent && selectedEvent.venue_id && selectedEvent.venue_id !== venue.id && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1.5">
            <AlertCircle size={12} /> Este evento já usa outro local — vincular aqui troca o mapa.
          </p>
        )}

        <button
          onClick={alreadyLinked ? handleDeactivate : handleActivate}
          disabled={saving || !selectedEventId}
          className={`w-full flex items-center justify-center gap-2 py-3.5 disabled:opacity-50 text-white rounded-xl font-black text-sm uppercase tracking-widest ${
            alreadyLinked ? 'bg-slate-500 hover:bg-slate-600' : 'bg-[#ff0068] hover:bg-[#e0005c]'
          }`}
        >
          {saving
            ? <Loader2 size={16} className="animate-spin" />
            : alreadyLinked
              ? <><Link2Off size={16} /> Desativar mapa neste evento</>
              : <><Link2 size={16} /> Ativar mapa neste evento</>}
        </button>
      </div>
    </div>,
    document.body,
  );
};

// ── Página principal ────────────────────────────────────────────────────────
const Venues: React.FC = () => {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [events, setEvents] = useState<(EventPickerOption & { venue_id: string | null; seat_map_enabled: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [linkingVenue, setLinkingVenue] = useState<Venue | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: v }, { data: e }] = await Promise.all([
        supabase.from('venues').select('*').eq('created_by', user.id).order('created_at', { ascending: false }),
        supabase.from('events').select('id,name,edition_year,is_demo,start_date,venue_id,seat_map_enabled').eq('created_by', user.id).eq('is_demo', false).order('created_at', { ascending: false }),
      ]);
      setVenues((v ?? []) as Venue[]);
      setEvents((e ?? []) as any);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Apagar este local? Eventos vinculados voltam a vender por setor/quantidade (o mapa de assento deles some).')) return;
    setDeletingId(id);
    try {
      const { error } = await supabase.from('venues').delete().eq('id', id);
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      window.alert(e.message ?? 'Erro ao apagar o local.');
    } finally {
      setDeletingId(null);
    }
  };

  const linkedEventName = (venueId: string) => events.find(e => e.venue_id === venueId && e.seat_map_enabled)?.name ?? null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        icon={<MapPin size={26} className="text-[#ff0068]" />}
        title="Locais"
        subtitle="Biblioteca de locais com assento numerado"
        actions={
          <button
            onClick={() => { setEditingVenue(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-xs uppercase tracking-widest"
          >
            <Plus size={16} /> Novo local
          </button>
        }
      />

      <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
        Cadastre um local com poltronas numeradas de verdade (teatro, auditório, centro de convenções) UMA VEZ e reaproveite em quantos eventos precisar — o mapa fica salvo aqui, não por evento. Locais sem assento fixo (salão, tatame, plateia em pé) não precisam de nada disso: continuam vendendo por setor/quantidade normalmente.
      </p>

      {notice && (
        <div role="status" className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400 text-[11px] font-bold flex items-center gap-2">
          <CheckCircle2 size={14} className="shrink-0" /> <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso" className="cursor-pointer"><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
      ) : venues.length === 0 ? (
        <div className="text-center py-16 px-6 bg-slate-50 dark:bg-white/5 border border-dashed border-slate-300 dark:border-white/10 rounded-3xl">
          <MapPin size={36} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
          <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhum local cadastrado</p>
          <p className="text-[11px] text-slate-400 mt-1">Crie o primeiro local pra habilitar assento numerado num evento.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {venues.map(v => {
            const linkedTo = linkedEventName(v.id);
            return (
              <div key={v.id} className="p-5 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-2xl space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-black text-sm text-slate-900 dark:text-white truncate">{v.name}</h3>
                    {(v.city || v.state) && (
                      <p className="text-[11px] text-slate-500">{[v.city, v.state].filter(Boolean).join(', ')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setEditingVenue(v); setShowForm(true); }} className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10" aria-label="Editar local">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(v.id)} disabled={deletingId === v.id} className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10" aria-label="Apagar local">
                      {deletingId === v.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  <Armchair size={14} className="text-slate-400" /> {v.total_seats} assentos · {v.rows_config.length} fileiras
                </div>

                {linkedTo ? (
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                    <Link2 size={12} /> Ativo em: {linkedTo}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <Link2Off size={12} /> Não vinculado a nenhum evento
                  </div>
                )}

                <button
                  onClick={() => setLinkingVenue(v)}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-slate-700 dark:text-white rounded-lg font-black text-[10px] uppercase tracking-widest"
                >
                  <Link2 size={12} /> Vincular a um evento
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <VenueFormModal
          editing={editingVenue}
          onClose={() => setShowForm(false)}
          onSaved={note => { setShowForm(false); setNotice(note ?? null); void refresh(); }}
        />
      )}
      {linkingVenue && (
        <LinkEventModal
          venue={linkingVenue}
          events={events}
          onClose={() => setLinkingVenue(null)}
          onLinked={() => void refresh()}
        />
      )}
    </div>
  );
};

export default Venues;
