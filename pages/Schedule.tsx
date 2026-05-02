import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  GripVertical, Sparkles, Download, Save, AlertCircle,
  CheckCircle2, Music, MusicIcon, Settings2, RefreshCw,
  Loader2, FileArchive, Users, ChevronDown, ChevronUp, Info,
  Volume2, Play, Pause, Radio, StopCircle, AlertTriangle,
  Layers, X, Plus, Trash2, ArrowUp, ArrowDown, Edit3,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  arrayMove, SortableContext, verticalListSortingStrategy, useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  generateNarrationBatch, generateNarration, fetchNarrationAudios,
  type BatchItem, type NarrationKind,
} from '../services/narrationApi';

type AudioSlot = { audio_url: string; duration_seconds: number; voice_id?: string };
type AudioMap = Record<string, { entrada?: AudioSlot; saida?: AudioSlot }>;

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
  bloco_id?: string | null;
}

interface Bloco {
  id: string;
  event_id: string;
  name: string;
  ordem: number;
  cor?: string | null;
}

// ---------- conflict detection ----------
function buildConflictMap(
  registrations: Registration[],
  minInterval: number
): Record<string, { dancerName: string; otherIndex: number }[]> {
  const conflictMap: Record<string, { dancerName: string; otherIndex: number }[]> = {};
  const dancerPositions: Record<string, number[]> = {};

  // Helper local: fallback elenco -> bailarinos_detalhes
  const elencoOf = (reg: any): any[] =>
    (reg.elenco && reg.elenco.length > 0) ? reg.elenco : (reg.bailarinos_detalhes || []);

  registrations.forEach((reg, index) => {
    elencoOf(reg).forEach((dancer: any) => {
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
        const r1Elenco = elencoOf(r1);
        const dancerName =
          r1Elenco.find((d: any) => (d.cpf || d.full_name || d.name) === dancerId)?.full_name ||
          r1Elenco.find((d: any) => (d.cpf || d.full_name || d.name) === dancerId)?.name ||
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
// Fallback: algumas registrations usam `elenco`, outras `bailarinos_detalhes`
// (depende de quando foi cadastrada). Sempre tentar os 2.
const getElenco = (reg: any): any[] => {
  return (reg.elenco && reg.elenco.length > 0)
    ? reg.elenco
    : (reg.bailarinos_detalhes || []);
};

function generateSmartOrder(registrations: Registration[], minInterval: number): Registration[] {
  const result: Registration[] = [];
  const remaining = [...registrations];
  const lastSeenPosition: Record<string, number> = {};

  while (remaining.length > 0) {
    let bestIdx = 0; // default 0 — se ninguem tem conflito, pega primeiro
    let bestConflicts = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const reg = remaining[i];
      const position = result.length;
      let conflicts = 0;

      getElenco(reg).forEach((dancer: any) => {
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

    // BUG fix: splice(idx, 0) retorna []; correto eh splice(idx, 1)[0]
    const chosen = remaining.splice(bestIdx, 1)[0];

    getElenco(chosen).forEach((dancer: any) => {
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
  audioSet?: { entrada?: AudioSlot; saida?: AudioSlot };
  saidaAtiva: boolean;
  isLive: boolean;
  isGenerating: boolean;
  batchInProgress: boolean;
  updatingLive: boolean;
  currentVoice: string;
  blocos: Bloco[];
  onAssignBloco: (regId: string, blocoId: string | null) => void;
  onGenerateOne: (reg: Registration) => void;
  onAnnounce: (reg: Registration) => void;
  onPrepare: (reg: Registration) => void;
}

const SortableRow: React.FC<SortableRowProps> = ({
  reg, index, conflicts,
  audioSet, saidaAtiva, isLive, isGenerating, batchInProgress, updatingLive, currentVoice,
  blocos, onAssignBloco,
  onGenerateOne, onAnnounce, onPrepare,
}) => {
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
  const hasEntrada = !!audioSet?.entrada;
  const hasSaida = !!audioSet?.saida;
  const fullyReady = hasEntrada && (!saidaAtiva || hasSaida);
  // Voz "antiga" = audio gerado com voice_id diferente da voz atual nas Configurações.
  // voice_id ausente (audios antigos pré-tracking) = nao da pra saber, nao avisa.
  const entradaOutdated = hasEntrada && !!audioSet!.entrada!.voice_id && audioSet!.entrada!.voice_id !== currentVoice;
  const saidaOutdated = hasSaida && !!audioSet!.saida!.voice_id && audioSet!.saida!.voice_id !== currentVoice;
  const anyOutdated = entradaOutdated || saidaOutdated;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-2xl border transition-all select-none
        ${isDragging ? 'shadow-2xl ring-2 ring-[#ff0068]/40' : ''}
        ${isLive
          ? 'bg-[#ff0068]/5 border-[#ff0068]/40'
          : hasConflict
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
          <h4 className={`text-[11px] font-black uppercase tracking-tight truncate ${isLive ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
            {reg.nome_coreografia}
          </h4>
          {hasEntrada && (
            <div
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full shrink-0 border ${
                entradaOutdated
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-violet-500/10 border-violet-500/20'
              }`}
              title={entradaOutdated
                ? `Entrada gerada com voz ${audioSet!.entrada!.voice_id}. Voz atual: ${currentVoice}. Clique no botão IA pra regerar.`
                : `Entrada IA pronta (${Math.round(audioSet!.entrada!.duration_seconds)}s)`}
            >
              {entradaOutdated
                ? <AlertTriangle size={9} className="text-amber-500" />
                : <CheckCircle2 size={9} className="text-violet-500" />}
              <span className={`text-[8px] font-black uppercase ${entradaOutdated ? 'text-amber-600 dark:text-amber-400' : 'text-violet-600 dark:text-violet-400'}`}>E</span>
            </div>
          )}
          {saidaAtiva && hasSaida && (
            <div
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full shrink-0 border ${
                saidaOutdated
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-emerald-500/10 border-emerald-500/20'
              }`}
              title={saidaOutdated
                ? `Saída gerada com voz ${audioSet!.saida!.voice_id}. Voz atual: ${currentVoice}. Clique no botão IA pra regerar.`
                : `Saída IA pronta (${Math.round(audioSet!.saida!.duration_seconds)}s)`}
            >
              {saidaOutdated
                ? <AlertTriangle size={9} className="text-amber-500" />
                : <CheckCircle2 size={9} className="text-emerald-500" />}
              <span className={`text-[8px] font-black uppercase ${saidaOutdated ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>S</span>
            </div>
          )}
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

      {/* elenco count — fallback bailarinos_detalhes (registrations criadas pela seed/vitrine) */}
      {(() => {
        const elencoLen = (reg.elenco && reg.elenco.length) || ((reg as any).bailarinos_detalhes?.length ?? 0);
        if (elencoLen === 0) return null;
        return (
          <div className="flex items-center gap-1 shrink-0 text-slate-400 dark:text-white/30">
            <Users size={10} />
            <span className="text-[9px] font-bold">{elencoLen}</span>
          </div>
        );
      })()}

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

      {/* Bloco selector (Etapa 2) */}
      {blocos.length > 0 && (
        <select
          value={reg.bloco_id ?? ''}
          onChange={e => onAssignBloco(reg.id, e.target.value || null)}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-slate-700 dark:text-white outline-none focus:border-[#ff0068]/50 max-w-[120px] truncate"
          title="Mover pra outro bloco"
        >
          <option value="">— Sem bloco</option>
          {blocos.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}

      {/* IA Narração / announce / Iniciar */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onGenerateOne(reg)}
          disabled={isGenerating || batchInProgress}
          className="p-2 text-slate-400 hover:text-violet-500 hover:bg-violet-500/10 rounded-xl transition-all disabled:opacity-50"
          title={anyOutdated
            ? `Regerar com voz atual (${currentVoice})`
            : fullyReady ? 'Regerar narração IA' : (saidaAtiva ? 'Gerar narrações IA (entrada + saída)' : 'Gerar narração IA')}
        >
          {isGenerating
            ? <Loader2 size={14} className="animate-spin text-violet-500" />
            : anyOutdated ? <RefreshCw size={14} className="text-amber-500" />
            : fullyReady ? <RefreshCw size={14} /> : <Sparkles size={14} />}
        </button>
        <button
          onClick={() => onAnnounce(reg)}
          className="p-2 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-xl transition-all"
          title="Anunciar com Narração IA"
        >
          <Volume2 size={14} />
        </button>
        <button
          onClick={() => onPrepare(reg)}
          disabled={updatingLive}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
            isLive
              ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/20'
              : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400 hover:bg-[#ff0068]/10 hover:text-[#ff0068]'
          }`}
          title={isLive ? 'Apresentação ao vivo pra jurados' : 'Marcar como ao vivo (jurados verão essa apresentação como ativa)'}
        >
          {isLive ? <Radio size={11} /> : null}
          {isLive ? 'Ao Vivo' : 'Iniciar'}
        </button>
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

  /* Blocos (Etapa 2 da fusão) */
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [showBlocosManager, setShowBlocosManager] = useState(false);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const eventPickerRef = useRef<HTMLDivElement | null>(null);

  // Fecha dropdown ao clicar fora (substitui <select> nativo que ignora tema escuro no Chrome/Win)
  useEffect(() => {
    if (!eventPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (eventPickerRef.current && !eventPickerRef.current.contains(e.target as Node)) {
        setEventPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [eventPickerOpen]);

  /* Narração + player (absorvido da Mesa de Som — Etapa 1) */
  const [config, setConfig] = useState<any>(null);
  const [currentTrack, setCurrentTrack] = useState<Registration | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [updatingLive, setUpdatingLive] = useState(false);
  const [audios, setAudios] = useState<AudioMap>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const saidaAtiva = !!config?.narracao_saida_ativa;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    supabase
      .from('events')
      .select('id,name,edition_year,start_date,created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setAllEvents(data);
          // Default = mais recente criado (consistente com MesaDeSom).
          // Evita pegar evento futuro vazio em vez do demo recem-criado
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
      if (cfg) setConfig(cfg);
      const list = regs || [];
      setRegistrations(list);
      setOrderChanged(false);

      // Etapa 2: blocos do cronograma
      if (eventId) {
        const { data: blocosData } = await supabase
          .from('cronograma_blocos')
          .select('*')
          .eq('event_id', eventId)
          .order('ordem', { ascending: true });
        setBlocos(blocosData || []);
      } else {
        setBlocos([]);
      }

      // Hidrata live + áudios pré-renderizados do evento
      if (eventId) {
        const { data: ev } = await supabase
          .from('events')
          .select('live_registration_id')
          .eq('id', eventId)
          .maybeSingle();
        if (ev?.live_registration_id) {
          const live = list.find((r: Registration) => r.id === ev.live_registration_id);
          setCurrentTrack(live || null);
        } else {
          setCurrentTrack(null);
        }
        try {
          const audioRows = await fetchNarrationAudios(eventId);
          const map: AudioMap = {};
          audioRows.forEach((a: any) => {
            const kind: NarrationKind = a.kind === 'saida' ? 'saida' : 'entrada';
            if (!map[a.registration_id]) map[a.registration_id] = {};
            map[a.registration_id][kind] = { audio_url: a.audio_url, duration_seconds: a.duration_seconds, voice_id: a.voice_id };
          });
          setAudios(map);
        } catch (e) {
          console.warn('Falha ao carregar narrações pré-renderizadas:', e);
        }
      } else {
        setAudios({});
        setCurrentTrack(null);
      }
    } catch (err) {
      console.error('Erro ao buscar cronograma:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ---------- narração helpers (espelhando MesaDeSom) ----------
  const buildNarrationText = (reg: Registration, kind: NarrationKind = 'entrada'): string => {
    const fallback = kind === 'saida'
      ? 'Uma salva de palmas para [ESTUDIO]!'
      : 'Com a coreografia [COREOGRAFIA], recebam no palco: [ESTUDIO]';
    const tplKey = kind === 'saida' ? 'texto_ia_saida' : 'texto_ia';
    const template = (config?.[tplKey] ?? '').trim() || fallback;
    let texto = template
      .replaceAll('[COREOGRAFIA]', reg.nome_coreografia ?? '')
      .replaceAll('[ESTUDIO]', reg.estudio ?? '');
    const pronuncias: { termo: string; pronuncia: string }[] = Array.isArray(config?.pronuncia_personalizada)
      ? config.pronuncia_personalizada
      : [];
    pronuncias.forEach(({ termo, pronuncia }) => {
      if (termo && pronuncia) texto = texto.replaceAll(termo, pronuncia);
    });
    return texto;
  };

  // Para qualquer audio rolando: <Audio> ref + Web Speech.
  // Indispensavel chamar antes de iniciar uma nova faixa pra nao misturar
  // (rows sem audio pre-renderizado caem no Web Speech, que continua falando
  // mesmo quando outra row pre-renderizada comeca a tocar).
  const stopAnyAudio = () => {
    if (narrationAudioRef.current) {
      narrationAudioRef.current.pause();
      narrationAudioRef.current.src = '';
      narrationAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
  };

  // Ao desmontar a pagina, garantir que nada continua tocando no background
  useEffect(() => () => stopAnyAudio(), []);

  const playNarration = (audio_url: string) => {
    stopAnyAudio();
    const audio = new Audio(audio_url);
    narrationAudioRef.current = audio;
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    audio.addEventListener('ended', () => setIsPlaying(false));
    audio.play().catch(e => console.warn('Falha ao tocar narração:', e));
  };

  const handleAnnounce = (reg: Registration, kind: NarrationKind = 'entrada') => {
    const pre = audios[reg.id]?.[kind];
    if (pre?.audio_url) {
      playNarration(pre.audio_url);
      return;
    }
    if (!window.speechSynthesis) {
      alert('Seu navegador não suporta a funcionalidade de narração.');
      return;
    }
    stopAnyAudio();
    const text = buildNarrationText(reg, kind);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const togglePlayPause = () => {
    const a = narrationAudioRef.current;
    if (a && a.src) {
      if (a.paused) {
        a.play().catch(e => console.warn('Falha ao retomar narração:', e));
      } else {
        a.pause();
      }
      return;
    }
    if (currentTrack) handleAnnounce(currentTrack);
  };

  const handlePrepare = async (reg: Registration) => {
    setCurrentTrack(reg);
    setIsPlaying(false);
    handleAnnounce(reg);
    if (!selectedEventId) return;
    setUpdatingLive(true);
    try {
      const { error } = await supabase
        .from('events')
        .update({
          live_registration_id: reg.id,
          live_started_at: new Date().toISOString(),
        })
        .eq('id', selectedEventId);
      if (error) console.warn('Falha ao marcar live no banco:', error.message);
    } finally {
      setUpdatingLive(false);
    }
  };

  const handleEndLive = async () => {
    const ending = currentTrack;
    if (saidaAtiva && ending && audios[ending.id]?.saida) {
      handleAnnounce(ending, 'saida');
    } else {
      stopAnyAudio();
    }
    setCurrentTrack(null);
    setIsPlaying(false);
    if (!selectedEventId) return;
    setUpdatingLive(true);
    try {
      const { error } = await supabase
        .from('events')
        .update({ live_registration_id: null, live_started_at: null })
        .eq('id', selectedEventId);
      if (error) console.warn('Falha ao encerrar live:', error.message);
    } finally {
      setUpdatingLive(false);
    }
  };

  const handleGenerateAll = async () => {
    if (!selectedEventId) { alert('Nenhum evento selecionado.'); return; }
    if (registrations.length === 0) return;

    // Pula audios que ja existem com a voz atual — economiza quota Gemini
    // e tempo do produtor (regerar 90 quando 14 ja estao prontas era desperdicio).
    const usedVoice = config?.voice_id || 'Charon';
    const items: BatchItem[] = [];
    let entradasNovas = 0, saidasNovas = 0, entradasPuladas = 0, saidasPuladas = 0;
    registrations.forEach(reg => {
      const set = audios[reg.id];
      const entradaOk = !!set?.entrada && set.entrada.voice_id === usedVoice;
      if (!entradaOk) {
        items.push({ registration_id: reg.id, text: buildNarrationText(reg, 'entrada'), kind: 'entrada' });
        entradasNovas++;
      } else entradasPuladas++;
      if (saidaAtiva) {
        const saidaOk = !!set?.saida && set.saida.voice_id === usedVoice;
        if (!saidaOk) {
          items.push({ registration_id: reg.id, text: buildNarrationText(reg, 'saida'), kind: 'saida' });
          saidasNovas++;
        } else saidasPuladas++;
      }
    });

    if (items.length === 0) {
      alert('Todas as narrações já estão prontas com a voz atual.');
      return;
    }

    const partes: string[] = [];
    if (entradasNovas > 0) partes.push(`${entradasNovas} ${entradasNovas === 1 ? 'entrada' : 'entradas'}`);
    if (saidasNovas > 0) partes.push(`${saidasNovas} ${saidasNovas === 1 ? 'saída' : 'saídas'}`);
    const tipoMsg = partes.join(' + ');
    const puladas = entradasPuladas + saidasPuladas;
    const linhaPuladas = puladas > 0 ? `\n${puladas} já ${puladas === 1 ? 'pronta' : 'prontas'} — pulando.` : '';
    if (!confirm(`Gerar ${tipoMsg}?\n\nVoz: ${usedVoice}${linhaPuladas}`)) {
      return;
    }

    setBatchProgress({ done: 0, total: items.length });
    try {
      const result = await generateNarrationBatch(selectedEventId, items, config?.voice_id);
      const usedVoice = config?.voice_id || 'Charon';
      const newMap: AudioMap = { ...audios };
      result.results.forEach(r => {
        if (r.ok && r.audio_url) {
          const k: NarrationKind = r.kind === 'saida' ? 'saida' : 'entrada';
          if (!newMap[r.registration_id]) newMap[r.registration_id] = {};
          newMap[r.registration_id][k] = { audio_url: r.audio_url, duration_seconds: r.duration_seconds ?? 10, voice_id: usedVoice };
        }
      });
      setAudios(newMap);
      alert(`✓ ${result.success}/${result.total} narrações geradas. ${result.failed > 0 ? `${result.failed} falharam — verifique no console.` : ''}`);
      if (result.failed > 0) console.warn('Falhas:', result.results.filter(r => !r.ok));
    } catch (e: any) {
      alert('Erro ao gerar narrações: ' + (e?.message ?? 'desconhecido'));
    } finally {
      setBatchProgress(null);
    }
  };

  const handleGenerateOne = async (reg: Registration) => {
    if (!selectedEventId) return;
    setGeneratingId(reg.id);
    try {
      const kinds: NarrationKind[] = saidaAtiva ? ['entrada', 'saida'] : ['entrada'];
      let lastError: string | null = null;
      const updates: { kind: NarrationKind; url: string; dur: number }[] = [];
      for (const kind of kinds) {
        const text = buildNarrationText(reg, kind);
        const result = await generateNarration(selectedEventId, reg.id, text, config?.voice_id, kind);
        if (result.ok && result.audio_url) {
          updates.push({ kind, url: result.audio_url, dur: result.duration_seconds ?? 10 });
        } else {
          lastError = result.error ?? 'desconhecido';
        }
      }
      if (updates.length) {
        const usedVoice = config?.voice_id || 'Charon';
        setAudios(prev => {
          const next = { ...prev };
          if (!next[reg.id]) next[reg.id] = {};
          updates.forEach(u => { next[reg.id][u.kind] = { audio_url: u.url, duration_seconds: u.dur, voice_id: usedVoice }; });
          return next;
        });
      }
      if (lastError) alert('Falha ao gerar: ' + lastError);
    } finally {
      setGeneratingId(null);
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

  // ---------- Blocos: CRUD ----------
  const handleAddBloco = async () => {
    if (!selectedEventId) return;
    const name = prompt('Nome do bloco (ex: "Bloco 1 — Manhã"):')?.trim();
    if (!name) return;
    const nextOrdem = blocos.length === 0 ? 0 : Math.max(...blocos.map(b => b.ordem)) + 1;
    const { data, error } = await supabase
      .from('cronograma_blocos')
      .insert({ event_id: selectedEventId, name, ordem: nextOrdem })
      .select()
      .single();
    if (error) { alert('Erro ao criar bloco: ' + error.message); return; }
    if (data) setBlocos(prev => [...prev, data].sort((a, b) => a.ordem - b.ordem));
  };

  const handleRenameBloco = async (bloco: Bloco) => {
    const novo = prompt('Renomear bloco:', bloco.name)?.trim();
    if (!novo || novo === bloco.name) return;
    const { error } = await supabase
      .from('cronograma_blocos')
      .update({ name: novo, updated_at: new Date().toISOString() })
      .eq('id', bloco.id);
    if (error) { alert('Erro ao renomear: ' + error.message); return; }
    setBlocos(prev => prev.map(b => b.id === bloco.id ? { ...b, name: novo } : b));
  };

  const handleDeleteBloco = async (bloco: Bloco) => {
    const regsNoBloco = registrations.filter(r => r.bloco_id === bloco.id).length;
    const msg = regsNoBloco > 0
      ? `Deletar "${bloco.name}"? ${regsNoBloco} ${regsNoBloco === 1 ? 'coreografia ficará' : 'coreografias ficarão'} sem bloco.`
      : `Deletar "${bloco.name}"?`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from('cronograma_blocos').delete().eq('id', bloco.id);
    if (error) { alert('Erro ao deletar: ' + error.message); return; }
    setBlocos(prev => prev.filter(b => b.id !== bloco.id));
    // Atualiza estado local — a FK ON DELETE SET NULL já cuidou do banco
    setRegistrations(prev => prev.map(r => r.bloco_id === bloco.id ? { ...r, bloco_id: null } : r));
  };

  const handleMoveBloco = async (bloco: Bloco, direction: 'up' | 'down') => {
    const sorted = [...blocos].sort((a, b) => a.ordem - b.ordem);
    const idx = sorted.findIndex(b => b.id === bloco.id);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const target = sorted[targetIdx];
    // Swap ordem
    const [a, b] = [bloco.ordem, target.ordem];
    await supabase.from('cronograma_blocos').update({ ordem: b }).eq('id', bloco.id);
    await supabase.from('cronograma_blocos').update({ ordem: a }).eq('id', target.id);
    setBlocos(prev => prev.map(x => {
      if (x.id === bloco.id) return { ...x, ordem: b };
      if (x.id === target.id) return { ...x, ordem: a };
      return x;
    }).sort((a, b) => a.ordem - b.ordem));
  };

  const handleAssignBloco = (regId: string, blocoId: string | null) => {
    setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, bloco_id: blocoId } : r));
    setOrderChanged(true);
  };

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
    // Smart order respeita blocos: roda o algoritmo dentro de cada bloco
    // separadamente (incluindo o "sem bloco" como grupo). Coreografias
    // nunca cruzam fronteira de bloco — produtor faz isso manualmente
    // via dropdown na linha.
    const sortedBlocos = [...blocos].sort((a, b) => a.ordem - b.ordem);
    const result: Registration[] = [];
    for (const bloco of sortedBlocos) {
      const regsDoBloco = registrations.filter(r => r.bloco_id === bloco.id);
      const ordered = generateSmartOrder([...regsDoBloco], minInterval);
      result.push(...ordered);
    }
    const semBloco = registrations.filter(r => !r.bloco_id);
    const orderedSemBloco = generateSmartOrder([...semBloco], minInterval);
    result.push(...orderedSemBloco);
    setRegistrations(result);
    setOrderChanged(true);
    setIsGenerating(false);
  };

  const handleSaveOrder = async () => {
    setIsSaving(true);
    try {
      // Calcula ordem global respeitando blocos: blocos em ordem (bloco.ordem),
      // dentro de cada bloco a ordem visual atual (registrations array).
      // Coreografias sem bloco vão pro final como residuo.
      const sortedBlocos = [...blocos].sort((a, b) => a.ordem - b.ordem);
      const updates: { id: string; ordem_apresentacao: number; bloco_id: string | null }[] = [];
      let globalIdx = 1;
      for (const bloco of sortedBlocos) {
        registrations
          .filter(r => r.bloco_id === bloco.id)
          .forEach(r => {
            updates.push({ id: r.id, ordem_apresentacao: globalIdx++, bloco_id: bloco.id });
          });
      }
      registrations
        .filter(r => !r.bloco_id)
        .forEach(r => {
          updates.push({ id: r.id, ordem_apresentacao: globalIdx++, bloco_id: null });
        });

      for (const u of updates) {
        await supabase
          .from('registrations')
          .update({ ordem_apresentacao: u.ordem_apresentacao, bloco_id: u.bloco_id })
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
          {/* Edition selector — dropdown custom (select nativo ignorava tema escuro no Chrome/Win) */}
          {allEvents.length > 0 && (() => {
            const selectedEv = allEvents.find(ev => ev.id === selectedEventId);
            return (
              <div className="relative" ref={eventPickerRef}>
                <button
                  type="button"
                  onClick={() => setEventPickerOpen(o => !o)}
                  className="appearance-none pl-3 pr-8 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-700 dark:text-white outline-none focus:border-[#ff0068]/50 transition-all cursor-pointer min-w-[200px] text-left"
                >
                  {selectedEv
                    ? `${selectedEv.edition_year ? selectedEv.edition_year + ' — ' : ''}${selectedEv.name}`
                    : 'Selecione...'}
                </button>
                <ChevronDown size={10} className={`absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none transition-transform ${eventPickerOpen ? 'rotate-180' : ''}`} />
                {eventPickerOpen && (
                  <div className="absolute top-full mt-1 left-0 right-0 min-w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl z-30 overflow-hidden max-h-64 overflow-y-auto">
                    {allEvents.map(ev => {
                      const isSelected = ev.id === selectedEventId;
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => { setSelectedEventId(ev.id); setEventPickerOpen(false); }}
                          className={`block w-full text-left px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-colors ${
                            isSelected
                              ? 'bg-[#ff0068]/10 text-[#ff0068]'
                              : 'text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/5'
                          }`}
                        >
                          {ev.edition_year ? `${ev.edition_year} — ` : ''}{ev.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

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

          {/* Blocos — gerenciador (Etapa 2) */}
          <button
            onClick={() => setShowBlocosManager(true)}
            className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
            title="Criar e gerenciar blocos do cronograma (Bloco 1 - Manhã, etc)"
          >
            <Layers size={12} />
            Blocos {blocos.length > 0 ? `(${blocos.length})` : ''}
          </button>

          <button
            onClick={handleGenerateSmart}
            disabled={isGenerating || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-60"
          >
            {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {isGenerating ? 'Gerando...' : 'Gerar Ordem Inteligente'}
          </button>

          {/* IA de Narração — gerar todas em batch */}
          <button
            onClick={handleGenerateAll}
            disabled={!!batchProgress || registrations.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-600 dark:text-violet-400 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
            title="Gerar narrações IA pré-renderizadas pra todas as coreografias"
          >
            {batchProgress
              ? <><Loader2 size={12} className="animate-spin" /> Gerando {batchProgress.done}/{batchProgress.total}...</>
              : <><Sparkles size={12} /> Gerar narrações IA</>
            }
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

      {/* ── Stage / Player ao vivo ── */}
      <div className="bg-slate-900 rounded-[2rem] p-6 border border-white/10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#ff0068]/10 blur-[80px] rounded-full -mr-32 -mt-32" />

        <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
          <div className="w-24 h-24 bg-[#ff0068]/20 rounded-3xl flex items-center justify-center text-[#ff0068] shadow-inner">
            <Music size={40} className={isPlaying ? 'animate-bounce' : ''} />
          </div>

          <div className="flex-1 text-center md:text-left space-y-2">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <div className={`w-2 h-2 rounded-full ${currentTrack ? 'bg-rose-500 animate-pulse' : 'bg-slate-600'}`} />
              <span className={`text-[8px] font-black uppercase tracking-[0.3em] ${currentTrack ? 'text-rose-500' : 'text-slate-400'}`}>
                {currentTrack ? 'AO VIVO PARA JURADOS' : 'AGUARDANDO COMANDO'}
              </span>
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tighter italic text-white">
              {currentTrack?.nome_coreografia || 'Nenhuma selecionada'}
            </h2>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              {currentTrack?.estudio || 'Clique em "Iniciar" em uma coreografia abaixo'}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => currentTrack && handleAnnounce(currentTrack)}
              disabled={!currentTrack}
              className="p-4 bg-white/5 text-white rounded-2xl hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              title="Anunciar com Narração IA"
            >
              <Volume2 size={24} className="group-hover:text-[#ff0068] transition-colors" />
            </button>
            <button
              onClick={togglePlayPause}
              disabled={!currentTrack}
              className="w-16 h-16 bg-[#ff0068] text-white rounded-2xl flex items-center justify-center shadow-lg shadow-[#ff0068]/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title={isPlaying ? 'Pausar narração' : 'Tocar narração'}
            >
              {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
            </button>
            <button
              onClick={handleEndLive}
              disabled={!currentTrack || updatingLive}
              className="p-4 bg-white/5 text-white rounded-2xl hover:bg-rose-500/20 hover:text-rose-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={saidaAtiva && currentTrack && audios[currentTrack.id]?.saida
                ? 'Encerrar com narração de saída (toca antes de zerar live)'
                : 'Encerrar transmissão (jurados pararão de ver AO VIVO)'}
            >
              <StopCircle size={24} />
            </button>
          </div>
        </div>
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
          {(() => {
            // Agrupa visualmente: blocos em ordem (bloco.ordem), dentro de cada
            // bloco SortableContext próprio (drag-drop só dentro do bloco). Sem
            // bloco no final como secao "residuo".
            const sortedBlocos = [...blocos].sort((a, b) => a.ordem - b.ordem);
            let globalIdx = 0;
            const sections: React.ReactNode[] = [];

            const renderRows = (regs: Registration[], startIdx: number) =>
              regs.map((reg, localIdx) => (
                <SortableRow
                  key={reg.id}
                  reg={reg}
                  index={startIdx + localIdx}
                  conflicts={conflicts[reg.id] || []}
                  audioSet={audios[reg.id]}
                  saidaAtiva={saidaAtiva}
                  isLive={currentTrack?.id === reg.id}
                  isGenerating={generatingId === reg.id}
                  batchInProgress={!!batchProgress}
                  updatingLive={updatingLive}
                  currentVoice={config?.voice_id || 'Charon'}
                  blocos={blocos}
                  onAssignBloco={handleAssignBloco}
                  onGenerateOne={handleGenerateOne}
                  onAnnounce={handleAnnounce}
                  onPrepare={handlePrepare}
                />
              ));

            for (const bloco of sortedBlocos) {
              const regs = registrations.filter(r => r.bloco_id === bloco.id);
              const startIdx = globalIdx;
              globalIdx += regs.length;
              sections.push(
                <div key={bloco.id} className="space-y-2">
                  <div className="flex items-center gap-2 pt-2">
                    <div className="h-px flex-1 bg-[#ff0068]/30" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] px-2">
                      {bloco.name} · {regs.length}
                    </span>
                    <div className="h-px flex-1 bg-[#ff0068]/30" />
                  </div>
                  {regs.length === 0 ? (
                    <p className="text-center py-4 text-[9px] font-bold text-slate-400 dark:text-white/30 italic">
                      Nenhuma coreografia atribuída a este bloco ainda
                    </p>
                  ) : (
                    <SortableContext items={regs.map(r => r.id)} strategy={verticalListSortingStrategy}>
                      {renderRows(regs, startIdx)}
                    </SortableContext>
                  )}
                </div>
              );
            }

            // Sem bloco
            const semBloco = registrations.filter(r => !r.bloco_id);
            if (semBloco.length > 0) {
              const startIdx = globalIdx;
              sections.push(
                <div key="__sem_bloco__" className="space-y-2">
                  {sortedBlocos.length > 0 && (
                    <div className="flex items-center gap-2 pt-2">
                      <div className="h-px flex-1 bg-slate-300 dark:bg-white/10" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-2">
                        Sem bloco · {semBloco.length}
                      </span>
                      <div className="h-px flex-1 bg-slate-300 dark:bg-white/10" />
                    </div>
                  )}
                  <SortableContext items={semBloco.map(r => r.id)} strategy={verticalListSortingStrategy}>
                    {renderRows(semBloco, startIdx)}
                  </SortableContext>
                </div>
              );
            }

            return <div className="space-y-2">{sections}</div>;
          })()}
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

      {/* ── Modal Gerenciar Blocos (Etapa 2) ── */}
      {showBlocosManager && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 sm:p-8"
          onClick={() => setShowBlocosManager(false)}
        >
          <div
            className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-xl text-amber-600 dark:text-amber-400">
                  <Layers size={18} />
                </div>
                <div>
                  <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic text-base">
                    Blocos do Cronograma
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5">
                    Organize as coreografias em blocos (ex: Manhã, Tarde, Final)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBlocosManager(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-2">
              {blocos.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-[11px] text-slate-400 dark:text-white/40 mb-4">
                    Nenhum bloco criado ainda. Crie blocos pra agrupar as coreografias.
                  </p>
                </div>
              ) : (
                [...blocos].sort((a, b) => a.ordem - b.ordem).map((bloco, idx, arr) => {
                  const regsCount = registrations.filter(r => r.bloco_id === bloco.id).length;
                  return (
                    <div
                      key={bloco.id}
                      className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-2xl"
                    >
                      <span className="text-[10px] font-black tabular-nums text-slate-400 w-6">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                          {bloco.name}
                        </p>
                        <p className="text-[9px] text-slate-500 dark:text-white/40 mt-0.5">
                          {regsCount} {regsCount === 1 ? 'coreografia' : 'coreografias'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleMoveBloco(bloco, 'up')}
                        disabled={idx === 0}
                        className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Subir"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => handleMoveBloco(bloco, 'down')}
                        disabled={idx === arr.length - 1}
                        className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Descer"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        onClick={() => handleRenameBloco(bloco)}
                        className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg"
                        title="Renomear"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteBloco(bloco)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg"
                        title="Deletar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]">
              <button
                onClick={handleAddBloco}
                disabled={!selectedEventId}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
              >
                <Plus size={14} />
                Adicionar Bloco
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Schedule;
