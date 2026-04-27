import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  GripVertical, Sparkles, Download, Save, AlertCircle,
  CheckCircle2, Music, MusicIcon, Settings2, RefreshCw,
  Loader2, FileArchive, Users, ChevronDown, ChevronUp, Info
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  arrayMove, SortableContext, verticalListSortingStrategy, useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// ---------- types ----------
interface Dancer {
  cpf?: string;
  name?: string;
  full_name?: string;
}

interface Registration {
  id: string;
  nome_coreografia: string;
  estudio: string;
  status: string;
  status_trilha?: string;
  trilha_url?: string;
  ordem_apresentacao?: number;
  elenco?: Dancer[];
  formacao?: string;
  estilo_danca?: string;
  categoria?: string;
  classificacao_final?: string;
}

// ---------- conflict detection ----------
function buildConflictMap(
  registrations: Registration[],
  minInterval: number
): Record<string, { dancerName: string; otherIndex: number }[]> {
  const conflictMap: Record<string, { dancerName: string; otherIndex: number }[]> = {};
  const dancerPositions: Record<string, number[]> = {};

  registrations.forEach((reg, index) => {
    (reg.elenco || []).forEach((dancer) => {
      const id = dancer.cpf || dancer.full_name || dancer.name;
      if (!id) return;
      if (!dancerPositions[id]) dancerPositions[id] = [];
      dancerPositions[id].push(index);
    });
  });

  Object.entries(dancerPositions).forEach(([dancerId, positions]) => {
    if (positions.length < 2) return;
    for (let i = 0; i < positions.length - 1; i++) {
      const cur = positions[i];
      const nxt = positions[i + 1];
      if (nxt - cur < minInterval) {
        const r1 = registrations[cur];
        const r2 = registrations[nxt];
        const dancerName =
          r1.elenco?.find((d) => (d.cpf || d.full_name || d.name) === dancerId)?.full_name ||
          r1.elenco?.find((d) => (d.cpf || d.full_name || d.name) === dancerId)?.name ||
          dancerId;

        if (!conflictMap[r1.id]) conflictMap[r1.id] = [];
        conflictMap[r1.id].push({ dancerName, otherIndex: nxt + 1 });

        if (!conflictMap[r2.id]) conflictMap[r2.id] = [];
        conflictMap[r2.id].push({ dancerName, otherIndex: cur + 1 });
      }
    }
  });

  return conflictMap;
}

// ---------- smart scheduler ----------
function generateSmartOrder(registrations: Registration[], minInterval: number): Registration[] {
  const result: Registration[] = [];
  const remaining = [...registrations];
  const lastSeenPosition: Record<string, number> = {};

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestConflicts = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const reg = remaining[i];
      const position = result.length;
      let conflicts = 0;

      (reg.elenco || []).forEach((dancer) => {
        const id = dancer.cpf || dancer.full_name || dancer.name;
        if (!id) return;
        const last = lastSeenPosition[id];
        if (last !== undefined && position - last < minInterval) {
          conflicts++;
        }
      });

      if (conflicts < bestConflicts) {
        bestConflicts = conflicts;
        bestIdx = i;
        if (conflicts === 0) break;
      }
    }

    const chosen = remaining.splice(bestIdx, 0)[bestIdx];
    remaining.splice(bestIdx, 1);

    (chosen.elenco || []).forEach((dancer) => {
      const id = dancer.cpf || dancer.full_name || dancer.name;
      if (id) lastSeenPosition[id] = result.length;
    });

    result.push(chosen);
  }

  return result;
}

// ---------- sortable row ----------
interface SortableRowProps {
  reg: Registration;
  index: number;
  conflicts: { dancerName: string; otherIndex: number }[];
}

const SortableRow: React.FC<SortableRowProps> = ({ reg, index, conflicts }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: reg.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  const hasTrack = !!reg.trilha_url;
  const hasConflict = conflicts.length > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-2xl border transition-all select-none
        ${isDragging ? 'shadow-2xl ring-2 ring-[#ff0068]/40' : ''}
        ${hasConflict
          ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/40'
          : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/8'}
      `}
    >
      {/* drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-300 dark:text-white/20 hover:text-slate-500 dark:hover:text-white/50 transition-colors p-1 shrink-0"
      >
        <GripVertical size={16} />
      </div>

      {/* position number */}
      <div className="w-8 shrink-0 text-center">
        <span className="text-[10px] font-black tabular-nums text-slate-400 dark:text-white/30">
          {String(index + 1).padStart(3, '0')}
        </span>
      </div>

      {/* main info */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-[11px] font-black uppercase tracking-tight truncate text-slate-900 dark:text-white">
            {reg.nome_coreografia}
          </h4>
          {hasConflict && (
            <div className="relative group/tip shrink-0">
              <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-rose-500 text-white rounded-full cursor-help">
                <AlertCircle size={9} />
                <span className="text-[8px] font-black uppercase">Conflito</span>
              </div>
              <div className="absolute left-0 bottom-full mb-2 w-52 p-2.5 bg-slate-900 text-white text-[9px] rounded-xl shadow-2xl opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity z-50 border border-white/10">
                <p className="font-black uppercase text-rose-400 mb-1 tracking-widest">Troca de Figurino</p>
                {conflicts.map((c, i) => (
                  <p key={i} className="text-slate-300">
                    <span className="text-white font-bold">{c.dancerName}</span> também está na #{String(c.otherIndex).padStart(3, '0')}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-widest truncate">
            {reg.estudio}
          </span>
          {reg.formacao && (
            <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/50 rounded-full text-[8px] font-black uppercase tracking-wider">
              {reg.formacao}
            </span>
          )}
          {reg.categoria && (
            <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 rounded-full text-[8px] font-black uppercase tracking-wider">
              {reg.categoria}
            </span>
          )}
        </div>
      </div>

      {/* elenco count */}
      {reg.elenco && reg.elenco.length > 0 && (
        <div className="flex items-center gap-1 shrink-0 text-slate-400 dark:text-white/30">
          <Users size={10} />
          <span className="text-[9px] font-bold">{reg.elenco.length}</span>
        </div>
      )}

      {/* track status */}
      <div className="shrink-0">
        {hasTrack ? (
          <div className="flex items-center gap-1 px-2 py-1 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-xl">
            <Music size={10} />
            <span className="text-[8px] font-black uppercase tracking-widest">Trilha OK</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 dark:bg-amber-500/10 text-amber-500 rounded-xl">
            <MusicIcon size={10} />
            <span className="text-[8px] font-black uppercase tracking-widest">Sem Trilha</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------- main component ----------
const Schedule = () => {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [minInterval, setMinInterval] = useState(10);
  const [tempoEntrada, setTempoEntrada] = useState(15);
  const [intervaloSeguranca, setIntervaloSeguranca] = useState(3);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [orderChanged, setOrderChanged] = useState(false);

  /* Edition selector */
  const [allEvents, setAllEvents] = useState<{ id: string; name: string; edition_year?: number }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    supabase
      .from('events')
      .select('id,name,edition_year,start_date')
      .order('start_date', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setAllEvents(data);
          setSelectedEventId(prev => prev ?? data[0].id);
        } else {
          fetchData(null);
        }
      });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (selectedEventId !== undefined) fetchData(selectedEventId);
  }, [selectedEventId]); // eslint-disable-line

  const fetchData = async (eventId: string | null) => {
    setIsLoading(true);
    try {
      let regsQuery = supabase
        .from('registrations')
        .select('*')
        .eq('status', 'APROVADA')
        .order('ordem_apresentacao', { ascending: true });

      if (eventId) regsQuery = regsQuery.eq('event_id', eventId);

      const { data: regs } = await regsQuery;

      const { data: cfg } = await supabase
        .from('configuracoes')
        .select('*')
        .eq('id', 1)
        .single();

      if (cfg?.intervalo_seguranca) { setMinInterval(cfg.intervalo_seguranca); setIntervaloSeguranca(cfg.intervalo_seguranca); }
      if (cfg?.tempo_entrada) setTempoEntrada(cfg.tempo_entrada);
      setRegistrations(regs || []);
      setOrderChanged(false);
    } catch (err) {
      console.error('Erro ao buscar cronograma:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const conflicts = useMemo(
    () => buildConflictMap(registrations, minInterval),
    [registrations, minInterval]
  );

  const stats = useMemo(() => {
    const withTrack = registrations.filter((r) => !!r.trilha_url).length;
    const conflictCount = Object.keys(conflicts).length;
    return {
      total: registrations.length,
      withTrack,
      withoutTrack: registrations.length - withTrack,
      conflicts: conflictCount,
    };
  }, [registrations, conflicts]);

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setRegistrations((prev) => {
        const oldIndex = prev.findIndex((r) => r.id === active.id);
        const newIndex = prev.findIndex((r) => r.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
      setOrderChanged(true);
    }
  };

  const handleGenerateSmart = async () => {
    setIsGenerating(true);
    await new Promise((r) => setTimeout(r, 600));
    const sorted = generateSmartOrder([...registrations], minInterval);
    setRegistrations(sorted);
    setOrderChanged(true);
    setIsGenerating(false);
  };

  const handleSaveOrder = async () => {
    setIsSaving(true);
    try {
      const updates = registrations.map((reg, i) => ({
        id: reg.id,
        ordem_apresentacao: i + 1,
      }));

      for (const u of updates) {
        await supabase
          .from('registrations')
          .update({ ordem_apresentacao: u.ordem_apresentacao })
          .eq('id', u.id);
      }

      setOrderChanged(false);
      setSavedMsg('Ordem salva com sucesso!');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (err) {
      console.error('Erro ao salvar ordem:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadZip = async () => {
    const tracksWithAudio = registrations.filter((r) => !!r.trilha_url);
    if (tracksWithAudio.length === 0) {
      alert('Nenhuma trilha sonora disponível para download.');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      const zip = new JSZip();
      const folder = zip.folder('Trilhas_Sonoras')!;

      for (let i = 0; i < registrations.length; i++) {
        const reg = registrations[i];
        if (!reg.trilha_url) continue;

        const num = String(i + 1).padStart(3, '0');
        const modality = sanitize(reg.formacao || reg.estilo_danca || 'Coreografia');
        const category = sanitize(reg.categoria || 'Geral');
        const studio = sanitize(reg.estudio || 'Estudio');
        const ext = reg.trilha_url.split('?')[0].split('.').pop() || 'mp3';
        const filename = `${num}_${modality}_${category}_${studio}.${ext}`;

        try {
          const response = await fetch(reg.trilha_url);
          const blob = await response.blob();
          folder.file(filename, blob);
        } catch {
          // skip files that fail to download
        }

        setDownloadProgress(Math.round(((i + 1) / registrations.length) * 100));
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, 'Trilhas_Sonoras_CoreoHub.zip');
    } catch (err) {
      console.error('Erro ao gerar ZIP:', err);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      await supabase.from('configuracoes').update({
        tempo_entrada:       tempoEntrada,
        intervalo_seguranca: intervaloSeguranca,
      }).eq('id', 1);
      setMinInterval(intervaloSeguranca);
      setShowSettings(false);
    } catch (err) {
      console.error('Erro ao salvar configurações:', err);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const sanitize = (str: string) =>
    str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_');

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 animate-in fade-in duration-500">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase italic tracking-tight text-slate-900 dark:text-white">
            Sonoplastia & <span className="text-[#ff0068]">Cronograma</span>
          </h1>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-white/40 mt-0.5">
            Cronograma inteligente & trilhas sonoras
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Edition selector */}
          {allEvents.length > 0 && (
            <div className="relative">
              <select
                value={selectedEventId ?? ''}
                onChange={e => setSelectedEventId(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-700 dark:text-white outline-none focus:border-[#ff0068]/50 transition-all cursor-pointer"
              >
                {allEvents.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.edition_year ? `${ev.edition_year} — ` : ''}{ev.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          )}

          <button
            onClick={() => fetchData(selectedEventId)}
            disabled={isLoading}
            className="p-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 rounded-xl hover:text-[#ff0068] transition-all disabled:opacity-50"
            title="Atualizar"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-[9px] font-black uppercase tracking-widest transition-all
              ${showSettings
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent'
                : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400'}`}
          >
            <Settings2 size={12} />
            Configurações
            {showSettings ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>

          <button
            onClick={handleGenerateSmart}
            disabled={isGenerating || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-60"
          >
            {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {isGenerating ? 'Gerando...' : 'Gerar Ordem Inteligente'}
          </button>

          {orderChanged && (
            <button
              onClick={handleSaveOrder}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-60"
            >
              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {isSaving ? 'Salvando...' : 'Salvar Ordem'}
            </button>
          )}

          <button
            onClick={handleDownloadZip}
            disabled={isDownloading || stats.withTrack === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-60"
          >
            {isDownloading
              ? <><Loader2 size={12} className="animate-spin" />{downloadProgress}%</>
              : <><FileArchive size={12} />Baixar Trilhas ZIP</>}
          </button>
        </div>
      </div>

      {/* ── Saved feedback ── */}
      {savedMsg && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 rounded-2xl text-[10px] font-black uppercase tracking-widest">
          <CheckCircle2 size={14} />
          {savedMsg}
        </div>
      )}

      {/* ── Settings panel ── */}
      {showSettings && (
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-5">
          <div className="flex items-center gap-2 text-slate-700 dark:text-white/80">
            <Settings2 size={14} />
            <span className="text-[10px] font-black uppercase tracking-widest">Palco & Tempos</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Tempo de entrada no palco */}
            <div className="space-y-1.5">
              <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
                Tempo de Entrada no Palco (segundos)
              </label>
              <input
                type="number" min={5} max={120}
                value={tempoEntrada}
                onChange={e => setTempoEntrada(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-slate-900 dark:text-white font-bold text-sm focus:outline-none focus:border-[#ff0068]/50"
              />
              <p className="text-[8px] text-slate-400 dark:text-white/30 flex items-center gap-1">
                <Info size={9} />
                Tempo para a coreografia entrar e se posicionar no palco
              </p>
            </div>

            {/* Intervalo de segurança */}
            <div className="space-y-1.5">
              <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
                Intervalo de Segurança entre Apresentações (s)
              </label>
              <input
                type="number" min={0} max={60}
                value={intervaloSeguranca}
                onChange={e => setIntervaloSeguranca(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-slate-900 dark:text-white font-bold text-sm focus:outline-none focus:border-[#ff0068]/50"
              />
              <p className="text-[8px] text-slate-400 dark:text-white/30 flex items-center gap-1">
                <Info size={9} />
                Tempo mínimo de descanso entre duas apresentações consecutivas
              </p>
            </div>
          </div>

          {/* Intervalo de bailarinos (slider existente) */}
          <div className="border-t border-slate-100 dark:border-white/10 pt-4 space-y-1.5">
            <label className="block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              Intervalo Mínimo de Segurança de Bailarinos
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range" min={1} max={20}
                value={intervaloSeguranca}
                onChange={(e) => setIntervaloSeguranca(Number(e.target.value))}
                className="w-40 accent-[#ff0068]"
              />
              <span className="text-xl font-black text-[#ff0068] w-16">
                {intervaloSeguranca} <span className="text-[9px] text-slate-400 font-bold">apres.</span>
              </span>
            </div>
            <p className="text-[8px] text-slate-400 dark:text-white/30 flex items-center gap-1">
              <Info size={9} />
              O mesmo bailarino não pode aparecer em duas coreografias dentro desse intervalo
            </p>
          </div>

          <button
            onClick={handleSaveSettings}
            disabled={isSavingSettings}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#ff0068] hover:bg-[#d4005a] disabled:opacity-50 text-white rounded-xl font-black text-[9px] uppercase tracking-widest transition-all"
          >
            {isSavingSettings ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Salvar Configurações
          </button>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-slate-900 dark:text-white', bg: 'bg-white dark:bg-white/5', border: 'border-slate-200 dark:border-white/10' },
          { label: 'Com Trilha', value: stats.withTrack, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20' },
          { label: 'Sem Trilha', value: stats.withoutTrack, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20' },
          { label: 'Conflitos', value: stats.conflicts, color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-500/10', border: 'border-rose-200 dark:border-rose-500/20' },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-2xl p-4 space-y-1`}>
            <p className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-white/40">{s.label}</p>
            <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Download progress bar ── */}
      {isDownloading && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-400">
            <span className="flex items-center gap-1.5"><Download size={10} /> Preparando arquivos...</span>
            <span>{downloadProgress}%</span>
          </div>
          <div className="h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#ff0068] rounded-full transition-all"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Conflict summary ── */}
      {stats.conflicts > 0 && (
        <div className="flex items-start gap-3 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-2xl">
          <AlertCircle size={16} className="text-rose-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400">
              {stats.conflicts} {stats.conflicts === 1 ? 'coreografia com conflito' : 'coreografias com conflito'} de troca de figurino
            </p>
            <p className="text-[9px] text-rose-500/80 dark:text-rose-400/60 mt-0.5">
              Clique em "Gerar Ordem Inteligente" para resolver automaticamente.
            </p>
          </div>
        </div>
      )}

      {/* ── List header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-400 dark:text-white/30">
          <span className="text-[9px] font-black uppercase tracking-widest"># Ordem</span>
        </div>
        <div className="flex items-center gap-4 text-[8px] font-black uppercase tracking-widest text-slate-400">
          <span className="flex items-center gap-1"><GripVertical size={10} />Arraste para reordenar</span>
        </div>
      </div>

      {/* ── Schedule list ── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 text-[#ff0068] animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Carregando cronograma...</p>
        </div>
      ) : registrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl">
          <div className="w-16 h-16 bg-slate-100 dark:bg-white/5 rounded-2xl flex items-center justify-center">
            <Music size={28} className="text-slate-300 dark:text-white/20" />
          </div>
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-tight text-slate-400 dark:text-white/40">
              Nenhuma coreografia aprovada
            </p>
            <p className="text-[9px] font-bold text-slate-300 dark:text-white/20 mt-1">
              Aprove inscrições em "Inscrições" para que apareçam aqui
            </p>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={registrations.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {registrations.map((reg, index) => (
                <SortableRow
                  key={reg.id}
                  reg={reg}
                  index={index}
                  conflicts={conflicts[reg.id] || []}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* ── ZIP info footer ── */}
      {stats.withTrack > 0 && !isLoading && (
        <div className="flex items-start gap-3 p-4 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-2xl">
          <FileArchive size={16} className="text-indigo-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
              ZIP com {stats.withTrack} trilha{stats.withTrack !== 1 ? 's' : ''} pronto para download
            </p>
            <p className="text-[9px] text-indigo-500/70 dark:text-indigo-400/50 mt-0.5">
              Os arquivos serão renomeados no padrão: 001_Formação_Categoria_Estudio.mp3 — na ordem atual do cronograma.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Schedule;
