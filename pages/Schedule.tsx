import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GripVertical, Sparkles, Download, Save, AlertCircle,
  CheckCircle2, Music, MusicIcon, Settings2, RefreshCw,
  Loader2, FileArchive, Users, ChevronDown, ChevronUp, Info,
  Volume2, Play, Pause, Radio, Square, AlertTriangle,
  Layers, X, Plus, Trash2, ArrowUp, ArrowDown, Edit3, SkipForward,
  Search, Megaphone, FileText, Rewind, FastForward,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import PageHeader from '../components/PageHeader';
import { DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
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
import { SCHEDULABLE_REGISTRATIONS_OR_FILTER } from '../utils/registrationStatus';
import { resolveEstudio, toTitleCase, resolveTrilhaUrl } from '../utils/formatters';
import { isStyleInList } from '../utils/styleMatch';

type AudioSlot = { audio_url: string; duration_seconds: number; voice_id?: string };
type AudioMap = Record<string, { entrada?: AudioSlot; saida?: AudioSlot }>;

// Formata segundos como mm:ss — usado no rótulo da barra de progresso da
// trilha, tanto no render normal (state) quanto na atualização via DOM
// durante o arraste do seek bar (ref, sem re-render).
const fmtTrilhaTime = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

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
  status_pagamento?: string;
  status_trilha?: string;
  trilha_url?: string;
  ordem_apresentacao?: number;
  elenco?: Dancer[];
  formacao?: string;
  estilo_danca?: string;
  categoria?: string;
  classificacao_final?: string;
  bloco_id?: string | null;
  excluded_from_schedule?: boolean;
  // Snapshot congelado na última publicação — o que o inscrito vê hoje,
  // independente de quanto o produtor já reorganizou desde então.
  ordem_apresentacao_publicado?: number | null;
  bloco_id_publicado?: string | null;
  // Wizard atual grava o nome do estúdio aqui (event_data.estudio_nome), não
  // na coluna top-level `estudio` — que fica vazia pra praticamente toda
  // inscrição recente. Ver buildNarrationText.
  event_data?: { estudio_nome?: string; [key: string]: any } | null;
}

interface Bloco {
  id: string;
  event_id: string;
  name: string;
  ordem: number;
  cor?: string | null;
}

interface Judge {
  id: string;
  name: string;
  competencias_generos?: string[] | null;
  is_active?: boolean;
}

/** "08/07 14:32", fuso Brasil — usado no status de última publicação. */
function formatDateTimeBr(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
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
      const id = dancer.cpf || dancer.full_name || dancer.nome || dancer.name;
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
          r1Elenco.find((d: any) => (d.cpf || d.full_name || d.nome || d.name) === dancerId)?.full_name ||
          r1Elenco.find((d: any) => (d.cpf || d.full_name || d.nome || d.name) === dancerId)?.nome ||
          r1Elenco.find((d: any) => (d.cpf || d.full_name || d.nome || d.name) === dancerId)?.name ||
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

function generateSmartOrder(
  registrations: Registration[],
  minInterval: number,
  opts?: { judgeSignatures?: Record<string, string>; minimizeJudgeChanges?: boolean }
): Registration[] {
  const result: Registration[] = [];
  const remaining = [...registrations];
  const lastSeenPosition: Record<string, number> = {};
  const judgeSignatures = opts?.judgeSignatures ?? {};
  const minimizeJudgeChanges = !!opts?.minimizeJudgeChanges;
  let lastSignature: string | null = null;

  while (remaining.length > 0) {
    let bestIdx = 0; // default 0 — se ninguem tem conflito, pega primeiro
    let bestConflicts = Infinity;
    let bestPanelChange = Infinity; // 0 = mesma banca da anterior, 1 = troca

    for (let i = 0; i < remaining.length; i++) {
      const reg = remaining[i];
      const position = result.length;
      let conflicts = 0;

      getElenco(reg).forEach((dancer: any) => {
        const id = dancer.cpf || dancer.full_name || dancer.nome || dancer.name;
        if (!id) return;
        const last = lastSeenPosition[id];
        if (last !== undefined && position - last < minInterval) {
          conflicts++;
        }
      });

      // Critério de banca só desempata dentro do mesmo nível de conflito —
      // intervalo de segurança de bailarino nunca é sacrificado por conveniência
      // de jurado.
      let panelChange = 0;
      if (minimizeJudgeChanges) {
        const sig = judgeSignatures[reg.id] ?? '';
        panelChange = (lastSignature !== null && sig !== lastSignature) ? 1 : 0;
      }

      if (
        conflicts < bestConflicts ||
        (conflicts === bestConflicts && panelChange < bestPanelChange)
      ) {
        bestConflicts = conflicts;
        bestPanelChange = panelChange;
        bestIdx = i;
        if (conflicts === 0 && panelChange === 0) break;
      }
    }

    // BUG fix: splice(idx, 0) retorna []; correto eh splice(idx, 1)[0]
    const chosen = remaining.splice(bestIdx, 1)[0];

    getElenco(chosen).forEach((dancer: any) => {
      const id = dancer.cpf || dancer.full_name || dancer.nome || dancer.name;
      if (id) lastSeenPosition[id] = result.length;
    });

    if (minimizeJudgeChanges) lastSignature = judgeSignatures[chosen.id] ?? '';
    result.push(chosen);
  }

  return result;
}

// ---------- empty bloco drop zone ----------
// Bloco sem nenhuma coreografia não tinha SortableContext nem alvo soltável —
// dnd-kit precisa de um `over` válido pra detectar o drop, então arrastar pra
// um bloco recém-criado (ainda vazio) não tinha onde cair.
const EMPTY_BLOCO_PREFIX = 'empty-bloco-';

const EmptyBlocoDropZone: React.FC<{ blocoId: string }> = ({ blocoId }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `${EMPTY_BLOCO_PREFIX}${blocoId}` });
  return (
    <p
      ref={setNodeRef}
      className={`text-center py-4 text-[9px] font-bold italic rounded-2xl border-2 border-dashed transition-colors ${
        isOver
          ? 'border-[#ff0068] bg-[#ff0068]/10 text-[#ff0068]'
          : 'border-transparent text-slate-400 dark:text-white/30'
      }`}
    >
      Nenhuma coreografia atribuída a este bloco ainda — arraste uma pra cá
    </p>
  );
};

// ---------- sortable row ----------
interface SortableRowProps {
  reg: Registration;
  index: number;
  conflicts: { dancerName: string; otherIndex: number }[];
  judgeNames?: string[];
  audioSet?: { entrada?: AudioSlot; saida?: AudioSlot };
  trackDuration?: number;
  saidaAtiva: boolean;
  isLive: boolean;
  isLastPlayed: boolean;
  isGenerating: boolean;
  batchInProgress: boolean;
  updatingLive: boolean;
  currentVoice: string;
  blocos: Bloco[];
  matchesSearch: boolean;
  recentlyMoved: boolean;
  onOpenBlocoPicker: (reg: Registration) => void;
  onGenerateOne: (reg: Registration) => void;
  onAnnounce: (reg: Registration) => void;
  onPrepare: (reg: Registration) => void;
  onMarkLiveOnly: (reg: Registration) => void;
  onExclude: (regId: string) => void;
}

const SortableRow: React.FC<SortableRowProps> = ({
  reg, index, conflicts, judgeNames,
  audioSet, trackDuration, saidaAtiva, isLive, isLastPlayed, isGenerating, batchInProgress, updatingLive, currentVoice,
  blocos, matchesSearch, recentlyMoved, onOpenBlocoPicker,
  onGenerateOne, onAnnounce, onPrepare, onMarkLiveOnly, onExclude,
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
      className={`flex flex-wrap sm:flex-nowrap items-center gap-3 p-3 rounded-2xl border transition-all select-none
        ${isDragging ? 'shadow-2xl ring-2 ring-[#ff0068]/40' : ''}
        ${recentlyMoved ? 'ring-2 ring-emerald-400/70 animate-drop-in' : ''}
        ${matchesSearch ? 'ring-2 ring-amber-400/70 bg-amber-50/40 dark:bg-amber-500/10' : ''}
        ${isLive
          ? 'bg-[#ff0068]/5 border-[#ff0068]/40'
          : hasConflict
            ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/40'
            : isLastPlayed
              ? 'bg-slate-100 dark:bg-white/[0.06] border-slate-300 dark:border-white/20'
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

      {/* main info — em mobile força wrap (basis-[calc(100%-5rem)] = larg restante depois do drag+pos),
          empurra actions pra próxima linha. Em desktop volta a ser flex-1 inline. */}
      <div className="basis-[calc(100%-5rem)] sm:basis-0 sm:flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className={`text-[11px] font-black uppercase tracking-tight truncate ${isLive ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
            {reg.nome_coreografia}
          </h4>
          {/* Última música que tocou (sobrevive ao Stop) — pedido real da
              produção: sem isso, encerrar a transmissão fazia a linha perder
              todo destaque e forçava procurar a mesma faixa numa lista longa. */}
          {isLastPlayed && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-white/10 border border-slate-300 dark:border-white/15 shrink-0">
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                Última tocada
              </span>
            </span>
          )}
          {/* Badge discreto pra Avaliada — produtor identifica visualmente no
              cronograma e o jurado sabe que vai entrar em modo feedback. */}
          {(reg as any).tipo_apresentacao === 'Avaliada' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-white/10 border border-slate-300 dark:border-white/15 shrink-0">
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                Avaliada
              </span>
            </span>
          )}
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
            {resolveEstudio(reg)}
          </span>
          {reg.formacao && (
            <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/50 rounded-full text-[8px] font-black uppercase tracking-wider">
              {reg.formacao}
            </span>
          )}
          {reg.estilo_danca && (
            <span className="px-1.5 py-0.5 bg-[#ff0068]/10 text-[#ff0068] rounded-full text-[8px] font-black uppercase tracking-wider">
              {reg.estilo_danca}
            </span>
          )}
          {reg.categoria && (
            <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 rounded-full text-[8px] font-black uppercase tracking-wider">
              {reg.categoria}
            </span>
          )}
          {/* Banca de jurados que avalia essa coreografia — ajuda o produtor a
              ver de relance se a composição está agrupada ou dispersa, sem
              precisar cruzar estilo x competências de cabeça. */}
          {judgeNames && judgeNames.length > 0 && (
            <span
              className="px-1.5 py-0.5 bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-[#1de7f2] rounded-full text-[8px] font-black uppercase tracking-wider cursor-help"
              title={`Banca: ${judgeNames.join(', ')}`}
            >
              {judgeNames.map(n => n.trim().charAt(0).toUpperCase()).join('')}
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
            <span className="text-[8px] font-black uppercase tracking-widest tabular-nums">
              {trackDuration
                ? `${Math.floor(trackDuration / 60)}:${String(Math.floor(trackDuration % 60)).padStart(2, '0')}`
                : 'Trilha OK'}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 dark:bg-amber-500/10 text-amber-500 rounded-xl">
            <MusicIcon size={10} />
            <span className="text-[8px] font-black uppercase tracking-widest">Sem Trilha</span>
          </div>
        )}
      </div>

      {/* Bloco picker — botao compacto que abre modal/bottomsheet com lista.
          Substitui o select inline que estourava layout em mobile. */}
      {blocos.length > 0 && (() => {
        const blocoAtual = blocos.find(b => b.id === reg.bloco_id);
        return (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenBlocoPicker(reg); }}
            onPointerDown={e => e.stopPropagation()}
            title="Mover pra outro bloco"
            className="shrink-0 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-slate-600 dark:text-slate-300 hover:border-[#ff0068]/40 hover:text-[#ff0068] transition-colors"
          >
            <Layers size={10} />
            <span className="hidden sm:inline max-w-[80px] truncate">
              {blocoAtual?.name ?? 'Sem bloco'}
            </span>
          </button>
        );
      })()}

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
          aria-label="Anunciar com narração IA"
          className="p-2 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-xl transition-all"
          title="Anunciar com Narração IA (só toca o áudio, não sincroniza o Voto)"
        >
          <Volume2 size={14} />
        </button>
        {!isLive && (
          <button
            onClick={() => onMarkLiveOnly(reg)}
            disabled={updatingLive}
            aria-label="Marcar ao vivo sem narração"
            className="p-2 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-xl transition-all disabled:opacity-50"
            title="Marcar AO VIVO sem narração (sincroniza o Voto Popular; use quando o anúncio é feito manualmente no microfone)"
          >
            <Radio size={14} />
          </button>
        )}
        <button
          onClick={() => onPrepare(reg)}
          disabled={updatingLive}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
            isLive
              ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/20'
              : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400 hover:bg-[#ff0068]/10 hover:text-[#ff0068]'
          }`}
          title={isLive ? 'Apresentação ao vivo pra jurados' : 'Anunciar com narração IA + marcar como ao vivo (sincroniza o Voto Popular)'}
        >
          {isLive ? <Radio size={11} /> : null}
          {isLive ? 'Ao Vivo' : 'Iniciar'}
        </button>
        {/* Remover do cronograma — não reprova nem estorna, só tira da grade.
            Reincluível na seção "Removidas". */}
        <button
          onClick={() => {
            if (confirm(`Remover "${reg.nome_coreografia}" do cronograma?\n\nA inscrição e o pagamento continuam válidos — você pode reincluir depois na seção "Removidas".`)) {
              onExclude(reg.id);
            }
          }}
          onPointerDown={e => e.stopPropagation()}
          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all"
          title="Remover do cronograma (mantém inscrição e pagamento)"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

// ---------- main component ----------
const Schedule = () => {
  const navigate = useNavigate();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  // Coreografias removidas do cronograma pelo produtor (inscrição/pagamento
  // seguem válidos). Restauráveis via seção "Removidas".
  const [excludedRegs, setExcludedRegs] = useState<Registration[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  // ── Publicar pros inscritos (draft → publish) ──
  const [schedulePublishedAt, setSchedulePublishedAt] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [isPublishingSchedule, setIsPublishingSchedule] = useState(false);
  // Depois de publicar, o modal vira uma 2ª etapa oferecendo postar também
  // um Aviso destacado — null = etapa 1 (confirmação), objeto = etapa 2.
  const [publishResult, setPublishResult] = useState<{ notified: number } | null>(null);
  const [isPostingAnnouncement, setIsPostingAnnouncement] = useState(false);
  // Alcance da última publicação — "N de M já visualizaram". Só existe
  // depois de pelo menos 1 publish; nunca expõe quem, só a contagem.
  const [readStats, setReadStats] = useState<{ total: number; read: number } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  // Duração das trilhas, lida via metadata do <audio> (o banco só guarda a
  // URL — nunca a duração). Cache por registration.id evita reler a mesma
  // faixa a cada render; preload='metadata' baixa só o cabeçalho do arquivo.
  const [trackDurations, setTrackDurations] = useState<Record<string, number>>({});
  const trackDurationsRequested = useRef<Set<string>>(new Set());
  const [minInterval, setMinInterval] = useState(10);
  const [tempoEntrada, setTempoEntrada] = useState(15);
  const [intervaloSeguranca, setIntervaloSeguranca] = useState(3);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [orderChanged, setOrderChanged] = useState(false);

  /* Edition selector */
  const [allEvents, setAllEvents] = useState<{ id: string; name: string; edition_year?: number; is_demo?: boolean }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  /* Banca de jurados — minimizar troca ao gerar ordem inteligente */
  const [judges, setJudges] = useState<Judge[]>([]);
  const [minimizeJudgeChanges, setMinimizeJudgeChanges] = useState(false);

  /* Blocos (Etapa 2 da fusão) */
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [showBlocosManager, setShowBlocosManager] = useState(false);
  // Picker de bloco por coreografia (substitui select inline em mobile —
  // botao na row abre bottomsheet com lista de blocos pra atribuir).
  const [blocoPickerForReg, setBlocoPickerForReg] = useState<Registration | null>(null);
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
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
  // Última coreografia que tocou (sobrevive ao Stop). Sem isso, encerrar a
  // transmissão zerava currentTrack e a linha perdia todo destaque — em
  // cronograma de 100+ inscritos, a produção relatou ter que caçar de novo
  // a mesma música na lista pra tocar de novo.
  const [lastPlayedId, setLastPlayedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [updatingLive, setUpdatingLive] = useState(false);
  const [audios, setAudios] = useState<AudioMap>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const trilhaAudioRef = useRef<HTMLAudioElement | null>(null);
  // Preenchimento visual + rótulo mm:ss da barra de progresso — atualizados
  // direto via DOM durante o arraste do seek bar, sem passar por setState
  // (ver comentário no JSX da barra).
  const trilhaFillRef = useRef<HTMLDivElement | null>(null);
  const trilhaTimeLabelRef = useRef<HTMLSpanElement | null>(null);
  const sequenceTimerRef = useRef<number | null>(null);
  // Timeout de segurança do modo SISTEMA: se o evento 'ended' de um audio nao
  // disparar (arquivo com duracao mal-formada, engasgo de rede, etc.), força
  // a sequencia a avançar mesmo assim em vez de travar em silencio.
  const failsafeTimerRef = useRef<number | null>(null);
  const saidaAtiva = !!config?.narracao_saida_ativa;
  // Modo MANUAL = sonoplasta toca trilha em equipamento externo (default).
  // Modo SISTEMA = app toca sequencia narracao->wait->trilha->saida automaticamente.
  // Modo TRILHA = app toca so a trilha (pre-cacheada), narrador anuncia ao vivo no microfone.
  const modoSistema = config?.modo_sonoplastia === 'SISTEMA';
  const modoTrilha = config?.modo_sonoplastia === 'TRILHA';
  // Pre-cache das trilhas do modo TRILHA: baixa tudo pro Cache Storage do
  // navegador assim que a tela carrega, pra tocar independente da rede na
  // hora do play (motivo real do modo — reduzir risco de engasgo ao vivo).
  const [precacheStatus, setPrecacheStatus] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [playerSection, setPlayerSection] = useState<'idle' | 'entrada' | 'wait' | 'trilha' | 'saida'>('idle');
  const [trilhaProgress, setTrilhaProgress] = useState(0);
  const [trilhaDuration, setTrilhaDuration] = useState(0);
  const [waitRemaining, setWaitRemaining] = useState(0);

  // PointerSensor: desktop (mouse). TouchSensor: mobile/tablet — sem ele,
  // arrastar não funciona em celular. delay=200ms evita disparar drag em
  // tap/scroll comum. KeyboardSensor: a11y (espaço pra pegar, setas pra mover).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    // Filtra por created_by — events é público (vitrine), então sem o filtro
    // o picker mostraria eventos de OUTROS produtores. Espelha Registrations.tsx.
    // Membro de equipe não é created_by do evento do produtor — inclui
    // também o evento vinculado em profiles.team_event_id (setado no
    // aceite do convite de equipe, ver apply-team-invite).
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { fetchData(null); return; }
      const { data: profile } = await supabase
        .from('profiles')
        .select('team_event_id')
        .eq('id', user.id)
        .maybeSingle();
      const query = supabase
        .from('events')
        .select('id,name,edition_year,start_date,created_at,is_demo')
        // Evento real sempre vence um evento DEMO mais recente (evita o
        // DEMO sombrear o Cronograma real — mesmo bug de resolveActiveEventId,
        // ver CLAUDE.md 2026-07-12). Dentro do mesmo grupo, o mais recente vence.
        .order('is_demo', { ascending: true })
        .order('created_at', { ascending: false });
      const { data } = profile?.team_event_id
        ? await query.or(`created_by.eq.${user.id},id.eq.${profile.team_event_id}`)
        : await query.eq('created_by', user.id);
      if (data && data.length > 0) {
        setAllEvents(data);
        setSelectedEventId(prev => prev ?? data[0].id);
      } else {
        fetchData(null);
      }
    })();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (selectedEventId !== undefined) fetchData(selectedEventId);
  }, [selectedEventId]); // eslint-disable-line

  const fetchData = async (eventId: string | null) => {
    setIsLoading(true);
    try {
      // Cronograma mostra automaticamente toda inscrição PAGA (status_pagamento
      // APROVADO/CONFIRMADO — cobre eventos gratuitos, que recebem APROVADO sem
      // Asaas) OU já aprovada manualmente (status='APROVADA', não perde dado
      // histórico). O webhook seta status_pagamento via service_role, então
      // aparece sozinha sem o produtor aprovar uma a uma. Excluídas são
      // separadas em memória pra alimentar a seção "Removidas" (restaurável).
      let regsQuery = supabase
        .from('registrations')
        .select('*')
        .or(SCHEDULABLE_REGISTRATIONS_OR_FILTER)
        .order('ordem_apresentacao', { ascending: true });

      if (eventId) regsQuery = regsQuery.eq('event_id', eventId);

      const { data: allQualifying } = await regsQuery;
      const regs = (allQualifying || []).filter((r: Registration) => !r.excluded_from_schedule);
      setExcludedRegs((allQualifying || []).filter((r: Registration) => r.excluded_from_schedule));

      if (eventId) {
        const { data: evRow } = await supabase
          .from('events')
          .select('schedule_published_at')
          .eq('id', eventId)
          .maybeSingle();
        setSchedulePublishedAt(evRow?.schedule_published_at ?? null);

        if (evRow?.schedule_published_at) {
          const { data: stats } = await supabase.rpc('get_schedule_publish_read_stats', { p_event_id: eventId });
          const row = stats?.[0];
          setReadStats(row ? { total: row.total_notified, read: row.total_read } : null);
        } else {
          setReadStats(null);
        }
      } else {
        setSchedulePublishedAt(null);
        setReadStats(null);
      }

      // Lê o config da ROW DO EVENTO (multi-tenant), não da legacy id='1'.
      // Bug 2026-06-11: produtor (não-super-admin) salva voice_id só na row do
      // evento via /narracao-ia; lendo id='1' aqui o cronograma gerava narração
      // com voz velha/default. Fallback pra legacy cobre eventos sem row própria.
      let cfg: any = null;
      if (eventId) {
        const { data } = await supabase
          .from('configuracoes')
          .select('*')
          .eq('id', eventId)
          .maybeSingle();
        cfg = data;
      }
      if (!cfg) {
        const { data } = await supabase
          .from('configuracoes')
          .select('*')
          .eq('id', '1')
          .maybeSingle();
        cfg = data;
      }

      if (cfg?.intervalo_seguranca) { setMinInterval(cfg.intervalo_seguranca); setIntervaloSeguranca(cfg.intervalo_seguranca); }
      if (cfg?.tempo_entrada) setTempoEntrada(cfg.tempo_entrada);
      if (cfg) setConfig(cfg);
      const list = regs || [];
      setRegistrations(list);
      setOrderChanged(false);

      // Jurados do produtor (RLS já escopa pra created_by) — usados só pra
      // calcular a banca que avalia cada coreografia (chip visual + critério
      // opcional de "minimizar troca de jurados" no Gerar Ordem Inteligente).
      const { data: judgesData } = await supabase
        .from('judges')
        .select('id, name, competencias_generos, is_active')
        .order('name');
      setJudges((judgesData || []).filter((j: Judge) => j.is_active !== false));

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

      // Zera "última tocada" ao trocar de evento — sem isso, o destaque de
      // uma faixa tocada no evento anterior reaparecia (sessão vira contexto
      // errado depois de trocar de evento e voltar).
      setLastPlayedId(null);

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

  // Chave estável do conjunto de trilhas do evento — evita reiniciar o
  // pré-cache (e piscar o selo de progresso) a cada reordenação/atribuição
  // de bloco, que recria o array `registrations` mas não muda as trilhas.
  const trilhasKey = useMemo(
    () => registrations.filter((r) => !!r.trilha_url).map((r) => `${r.id}:${r.trilha_url}`).sort().join('|'),
    [registrations],
  );

  // Pre-cache das trilhas quando modo TRILHA está ativo. Roda em background,
  // sem travar a tela — cache.match dedup natural evita rebaixar trilhas já
  // baixadas em fetchs anteriores (reload de página, troca de evento e volta).
  useEffect(() => {
    if (!modoTrilha || !selectedEventId || !('caches' in window)) {
      setPrecacheStatus(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const withTrack = registrations.filter((r) => !!r.trilha_url);
      if (withTrack.length === 0) { setPrecacheStatus(null); return; }
      setPrecacheStatus({ done: 0, total: withTrack.length, failed: 0 });
      try {
        const cache = await caches.open(`coreohub-trilhas-${selectedEventId}`);
        let done = 0;
        let failed = 0;
        for (const reg of withTrack) {
          if (cancelled) return;
          const url = resolveTrilhaUrl(reg.trilha_url);
          const existing = await cache.match(url);
          if (!existing) {
            try {
              const res = await fetch(url);
              if (res.ok) {
                await cache.put(url, res.clone());
              } else {
                failed += 1;
                console.warn(`[Cronograma] Trilha de "${reg.nome_coreografia}" retornou HTTP ${res.status} — não cacheada.`);
              }
            } catch (e) {
              failed += 1;
              console.warn(`[Cronograma] Falha ao pré-cachear trilha de "${reg.nome_coreografia}":`, e);
            }
          }
          done += 1;
          if (!cancelled) setPrecacheStatus({ done, total: withTrack.length, failed });
        }
      } catch (e) {
        console.warn('[Cronograma] Falha ao abrir cache de trilhas:', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoTrilha, selectedEventId, trilhasKey]);

  // Resolve o path/URL crua do banco pra URL tocável (ver resolveTrilhaUrl)
  // e, se possível, pro blob já pré-cacheado — cache local (modo TRILHA já
  // pré-cacheado) tem prioridade; sem cache (ou API indisponível), cai pra
  // rede direto — nunca bloqueia o play.
  const resolveTrilhaSrc = async (pathOrUrl: string): Promise<string> => {
    const url = resolveTrilhaUrl(pathOrUrl);
    if (!modoTrilha || !selectedEventId || !('caches' in window)) return url;
    try {
      const cache = await caches.open(`coreohub-trilhas-${selectedEventId}`);
      const hit = await cache.match(url);
      if (hit) {
        const blob = await hit.blob();
        return URL.createObjectURL(blob);
      }
    } catch (e) {
      console.warn('[Cronograma] Falha ao ler cache de trilha, usando rede:', e);
    }
    return url;
  };

  // ---------- narração helpers (espelhando MesaDeSom) ----------
  const buildNarrationText = (reg: Registration, kind: NarrationKind = 'entrada'): string => {
    const fallback = kind === 'saida'
      ? 'Uma salva de palmas para [ESTUDIO]!'
      : 'Com a coreografia [COREOGRAFIA], recebam no palco: [ESTUDIO]';
    const tplKey = kind === 'saida' ? 'texto_ia_saida' : 'texto_ia';
    const template = (config?.[tplKey] ?? '').trim() || fallback;
    const estudioNome = resolveEstudio(reg);
    let texto = template
      .replaceAll('[COREOGRAFIA]', reg.nome_coreografia ?? '')
      .replaceAll('[ESTUDIO]', estudioNome);
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
    if (trilhaAudioRef.current) {
      const prevSrc = trilhaAudioRef.current.src;
      trilhaAudioRef.current.pause();
      trilhaAudioRef.current.src = '';
      trilhaAudioRef.current = null;
      // Object URL do blob cacheado (modo TRILHA) — liberar memória.
      if (prevSrc.startsWith('blob:')) URL.revokeObjectURL(prevSrc);
    }
    if (sequenceTimerRef.current) {
      clearInterval(sequenceTimerRef.current);
      sequenceTimerRef.current = null;
    }
    if (failsafeTimerRef.current) {
      clearTimeout(failsafeTimerRef.current);
      failsafeTimerRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setPlayerSection('idle');
    setTrilhaProgress(0);
    setTrilhaDuration(0);
    setWaitRemaining(0);
  };

  // Modo SISTEMA: encadeia narracao entrada -> espera (tempo_entrada) ->
  // trilha sonora -> narracao saida (se ativa). Cada etapa avanca via
  // listener 'ended'. Pode ser interrompida por handleEndLive ou skip.
  const playTrilhaWithSequence = (reg: Registration) => {
    if (!reg.trilha_url) {
      // Sem trilha: vai direto pra saida (ou fim). Log explícito — esse é o
      // motivo nº1 de "narração toca e depois nada acontece" em modo SISTEMA:
      // a linha não tem trilha_url mesmo que o badge da lista pareça OK.
      console.warn(`[Cronograma] "${reg.nome_coreografia}" sem trilha_url — sequência pula pra saída/fim sem tocar trilha.`);
      if (saidaAtiva && audios[reg.id]?.saida) {
        setPlayerSection('saida');
        handleAnnounce(reg, 'saida');
      } else {
        setPlayerSection('idle');
      }
      return;
    }
    setPlayerSection('trilha');
    const audio = new Audio(resolveTrilhaUrl(reg.trilha_url));
    trilhaAudioRef.current = audio;
    audio.addEventListener('loadedmetadata', () => setTrilhaDuration(audio.duration || 0));
    audio.addEventListener('timeupdate', () => setTrilhaProgress(audio.currentTime));
    // Guard contra 'ended' e 'error' disparando os dois pro mesmo audio (ex:
    // engasgo de rede dispara 'error' e um 'ended' tardio ainda chega depois)
    // — sem isso, a saida tocaria 2x e narrationAudioRef perderia a
    // referencia da 1a instancia.
    let trilhaAdvanced = false;
    const advanceAfterTrilha = () => {
      if (trilhaAdvanced) return;
      trilhaAdvanced = true;
      // Trilha terminou (ou falhou): toca saida (se ativa) ou volta pra idle
      if (saidaAtiva && audios[reg.id]?.saida) {
        setPlayerSection('saida');
        const audioSaida = new Audio(audios[reg.id]!.saida!.audio_url);
        narrationAudioRef.current = audioSaida;
        audioSaida.addEventListener('ended', () => {
          setPlayerSection('idle');
          setIsPlaying(false);
        });
        audioSaida.addEventListener('error', (e) => {
          console.error('[Cronograma] Falha ao tocar narração de saída, encerrando sequência:', e);
          setPlayerSection('idle');
          setIsPlaying(false);
        });
        audioSaida.play().catch(e => console.warn('Falha ao tocar saida:', e));
      } else {
        setPlayerSection('idle');
        setIsPlaying(false);
      }
    };
    audio.addEventListener('ended', advanceAfterTrilha);
    audio.addEventListener('error', (e) => {
      console.error('[Cronograma] Falha ao carregar/tocar trilha, avançando sequência:', e);
      advanceAfterTrilha();
    });
    audio.play().catch(e => console.warn('Falha ao tocar trilha:', e));
  };

  // 2) Espera (tempo_entrada segundos) com countdown visual, depois toca a
  //    trilha. Compartilhado pelos dois caminhos de narração de entrada
  //    (audio pre-renderizado e fallback Web Speech).
  const advanceToWaitThenTrilha = (reg: Registration) => {
    const waitSec = Math.max(0, tempoEntrada || 0);
    if (waitSec === 0) {
      playTrilhaWithSequence(reg);
      return;
    }
    setPlayerSection('wait');
    setWaitRemaining(waitSec);
    let remaining = waitSec;
    sequenceTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setWaitRemaining(Math.max(0, remaining));
      if (remaining <= 0) {
        if (sequenceTimerRef.current) {
          clearInterval(sequenceTimerRef.current);
          sequenceTimerRef.current = null;
        }
        playTrilhaWithSequence(reg);
      }
    }, 1000);
  };

  const startSequenceMode = (reg: Registration) => {
    setPlayerSection('entrada');
    setIsPlaying(true);
    // 1) Toca entrada. Se nao houver audio pre-renderizado, cai em Web Speech
    //    e estima duracao com tempo_entrada como fallback (Web Speech nao
    //    da evento 'ended' confiavel pra audios sintetizados curtos).
    const preEntrada = audios[reg.id]?.entrada;
    if (preEntrada?.audio_url) {
      const audio = new Audio(preEntrada.audio_url);
      narrationAudioRef.current = audio;
      let advanced = false;
      const advanceOnce = () => {
        if (advanced) return;
        advanced = true;
        if (failsafeTimerRef.current) {
          clearTimeout(failsafeTimerRef.current);
          failsafeTimerRef.current = null;
        }
        advanceToWaitThenTrilha(reg);
      };
      audio.addEventListener('ended', advanceOnce);
      audio.addEventListener('error', (e) => {
        console.error('[Cronograma] Falha ao tocar narração de entrada, avançando sequência:', e);
        advanceOnce();
      });
      // Timeout de segurança: alguns audios (ex: mp3 sem duracao correta no
      // header) nunca disparam 'ended' de forma confiavel. Sem isso, a
      // sequencia trava em silencio depois da narração e a trilha nunca toca
      // — sintoma relatado em produção. Usa a duracao conhecida (gravada na
      // geração da narração) + margem de 3s; se ausente, cai pra 20s.
      const failsafeMs = ((preEntrada.duration_seconds || 17) + 3) * 1000;
      failsafeTimerRef.current = window.setTimeout(() => {
        console.warn('[Cronograma] Narração de entrada não disparou "ended" a tempo — avançando sequência via timeout de segurança.');
        advanceOnce();
      }, failsafeMs);
      audio.play().catch(e => console.warn('Falha ao tocar entrada:', e));
    } else {
      // Fallback: Web Speech + timer estimado (~10s) pra avancar
      handleAnnounce(reg, 'entrada');
      failsafeTimerRef.current = window.setTimeout(() => {
        failsafeTimerRef.current = null;
        advanceToWaitThenTrilha(reg);
      }, 10000);
    }
  };

  // Skip da etapa atual (botao "Pular trecho" no UI). Avanca pra proxima.
  const skipCurrentSection = () => {
    if (!currentTrack) return;
    if (playerSection === 'entrada' || playerSection === 'saida') {
      if (narrationAudioRef.current) {
        narrationAudioRef.current.pause();
        narrationAudioRef.current.src = '';
        narrationAudioRef.current = null;
      }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (playerSection === 'entrada') {
        // Pula direto pra trilha
        if (sequenceTimerRef.current) {
          clearInterval(sequenceTimerRef.current);
          sequenceTimerRef.current = null;
        }
        if (failsafeTimerRef.current) {
          clearTimeout(failsafeTimerRef.current);
          failsafeTimerRef.current = null;
        }
        playTrilhaWithSequence(currentTrack);
      } else {
        setPlayerSection('idle');
        setIsPlaying(false);
      }
    } else if (playerSection === 'wait') {
      if (sequenceTimerRef.current) {
        clearInterval(sequenceTimerRef.current);
        sequenceTimerRef.current = null;
      }
      playTrilhaWithSequence(currentTrack);
    } else if (playerSection === 'trilha') {
      if (trilhaAudioRef.current) {
        trilhaAudioRef.current.pause();
        trilhaAudioRef.current.src = '';
        trilhaAudioRef.current = null;
      }
      if (saidaAtiva && audios[currentTrack.id]?.saida) {
        setPlayerSection('saida');
        const audioSaida = new Audio(audios[currentTrack.id]!.saida!.audio_url);
        narrationAudioRef.current = audioSaida;
        audioSaida.addEventListener('ended', () => { setPlayerSection('idle'); setIsPlaying(false); });
        audioSaida.play().catch(e => console.warn('Falha ao tocar saida:', e));
      } else {
        setPlayerSection('idle');
        setIsPlaying(false);
      }
    }
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

  // Modo TRILHA: toca só a trilha da coreografia (sem narração IA) — o
  // narrador anuncia ao vivo no microfone. Usa o cache local quando
  // disponível (pré-cacheado no efeito acima), senão cai pra rede.
  const playTrilhaOnly = async (reg: Registration) => {
    stopAnyAudio();
    if (!reg.trilha_url) {
      console.warn(`[Cronograma] "${reg.nome_coreografia}" sem trilha_url — nada pra tocar em modo Trilha.`);
      return;
    }
    setPlayerSection('trilha');
    setIsPlaying(true);
    const src = await resolveTrilhaSrc(reg.trilha_url);
    const audio = new Audio(src);
    trilhaAudioRef.current = audio;
    audio.addEventListener('loadedmetadata', () => setTrilhaDuration(audio.duration || 0));
    audio.addEventListener('timeupdate', () => setTrilhaProgress(audio.currentTime));
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    audio.addEventListener('ended', () => { setPlayerSection('idle'); setIsPlaying(false); });
    audio.addEventListener('error', (e) => {
      console.error('[Cronograma] Falha ao tocar trilha (modo Trilha):', e);
      setPlayerSection('idle');
      setIsPlaying(false);
    });
    audio.play().catch(e => console.warn('Falha ao tocar trilha:', e));
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
    // Fallback sem narração IA pré-gravada (audios[reg.id] vazio). Sem
    // voice fixada, o Chrome escolhe a voz default de forma inconsistente
    // entre chamadas — sintoma "cada play uma voz diferente". getVoices()
    // também carrega async (lista vazia na 1ª chamada da sessão), então
    // espera 'voiceschanged' quando necessário pra sempre escolher a
    // mesma voz pt-BR instalada.
    const speakWithStableVoice = () => {
      const ptVoice = window.speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('pt'));
      if (ptVoice) utterance.voice = ptVoice;
      window.speechSynthesis.speak(utterance);
    };
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = speakWithStableVoice;
    } else {
      speakWithStableVoice();
    }
  };

  const togglePlayPause = () => {
    // Trilha tocando agora (modo TRILHA sempre, ou modo SISTEMA na etapa 3) —
    // pausa/retoma a MÚSICA. Sem esse check primeiro, apertar de novo caía
    // direto na lógica de narração (narrationAudioRef vazio nessa fase, já
    // que quem toca é trilhaAudioRef) e reiniciava a narração de entrada por
    // cima da música ainda tocando — bug real, mais fácil de disparar agora
    // que existe atalho de teclado (Espaço) além do botão.
    if (playerSection === 'trilha' && trilhaAudioRef.current?.src) {
      const t = trilhaAudioRef.current;
      if (t.paused) {
        t.play().catch(e => console.warn('Falha ao retomar trilha:', e));
      } else {
        t.pause();
      }
      return;
    }
    if (modoTrilha) {
      if (currentTrack) playTrilhaOnly(currentTrack);
      return;
    }
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

  // Avança/retrocede N segundos na trilha tocando agora. Só a trilha tem
  // seek (narração é curta, sem necessidade real) — pedido real da equipe
  // de produção: "precisa ter opção completa de avançar/atrasar o progresso
  // da música" pra corrigir corte errado sem reiniciar a faixa inteira.
  const seekTrilha = (deltaSeconds: number) => {
    const el = trilhaAudioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    el.currentTime = Math.min(Math.max(0, el.currentTime + deltaSeconds), el.duration);
    setTrilhaProgress(el.currentTime);
  };

  // Seek absoluto (clique/arraste na barra de progresso). fraction em [0,1].
  const seekTrilhaTo = (fraction: number) => {
    const el = trilhaAudioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    el.currentTime = Math.max(0, Math.min(1, fraction)) * el.duration;
    setTrilhaProgress(el.currentTime);
  };

  // Atalhos de teclado do player — padrão de qualquer software de DJ/mesa de
  // som (espaço = play/pause, setas = seek ±10s). Ignora quando o foco está
  // em qualquer elemento interativo (input/textarea/select/button/link) pra
  // não roubar digitação nem a ativação por Espaço de um botão focado (ex:
  // navegar com Tab até "Excluir" numa linha e apertar Espaço deveria clicar
  // o botão, não pausar o player).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || target?.isContentEditable) return;
      if (!currentTrack) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'ArrowLeft' && playerSection === 'trilha') {
        e.preventDefault();
        seekTrilha(-10);
      } else if (e.code === 'ArrowRight' && playerSection === 'trilha') {
        e.preventDefault();
        seekTrilha(10);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentTrack, playerSection, modoTrilha]);

  const setLiveRegistration = async (reg: Registration) => {
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

  const handlePrepare = async (reg: Registration) => {
    setCurrentTrack(reg);
    setLastPlayedId(reg.id);
    setIsPlaying(false);
    if (modoSistema) {
      // Modo SISTEMA: dispara sequencia automatica entrada->wait->trilha->saida
      startSequenceMode(reg);
    } else if (modoTrilha) {
      // Modo TRILHA: so toca a trilha (cache local), narrador anuncia ao vivo.
      await playTrilhaOnly(reg);
    } else {
      // Modo MANUAL (default): so toca a narracao de entrada; sonoplasta
      // controla a trilha em equipamento externo.
      handleAnnounce(reg);
    }
    await setLiveRegistration(reg);
  };

  // Sincroniza só o status "ao vivo" (e o Voto Popular via trigger), sem
  // narração — pra quando o anúncio é feito manualmente no microfone.
  const handleMarkLiveOnly = async (reg: Registration) => {
    setCurrentTrack(reg);
    setLastPlayedId(reg.id);
    setIsPlaying(false);
    await setLiveRegistration(reg);
  };

  const handleEndLive = async () => {
    const ending = currentTrack;
    // Modo TRILHA nunca toca narração de saída — o narrador encerra ao vivo.
    if (!modoTrilha && saidaAtiva && ending && audios[ending.id]?.saida) {
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

  // Banca de jurados por coreografia: cruza estilo_danca com as competências
  // de gênero de cada jurado ativo. sigMap serve pro algoritmo (string
  // comparável), namesMap alimenta o chip visual da linha.
  const judgeBanca = useMemo(() => {
    const sigMap: Record<string, string> = {};
    const namesMap: Record<string, string[]> = {};
    registrations.forEach((reg) => {
      const matched = judges.filter((j) => isStyleInList(reg.estilo_danca, j.competencias_generos));
      sigMap[reg.id] = matched.map((j) => j.id).sort().join(',');
      namesMap[reg.id] = matched.map((j) => j.name);
    });
    return { sigMap, namesMap };
  }, [registrations, judges]);

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

  // Lê a duração de cada trilha via metadata do áudio (banco só guarda a
  // URL). preload='metadata' baixa só o cabeçalho, não o arquivo inteiro.
  // Alimenta o "tempo total de música" por bloco/dia e o PDF de ordem.
  // Fila com concorrência limitada — evento grande (150-200+ inscritos)
  // não deve disparar 150-200 requisições de metadata simultâneas.
  const trackDurationQueueRef = useRef<{ id: string; url: string }[]>([]);
  const trackDurationActiveRef = useRef(0);
  const MAX_CONCURRENT_DURATION_PROBES = 6;

  const pumpTrackDurationQueue = () => {
    while (trackDurationActiveRef.current < MAX_CONCURRENT_DURATION_PROBES && trackDurationQueueRef.current.length > 0) {
      const next = trackDurationQueueRef.current.shift()!;
      trackDurationActiveRef.current += 1;
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = next.url;
      const done = () => {
        trackDurationActiveRef.current -= 1;
        pumpTrackDurationQueue();
      };
      audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setTrackDurations(prev => ({ ...prev, [next.id]: audio.duration }));
        }
        done();
      }, { once: true });
      audio.addEventListener('error', done, { once: true });
    }
  };

  useEffect(() => {
    registrations.forEach((reg) => {
      if (!reg.trilha_url || trackDurationsRequested.current.has(reg.id)) return;
      trackDurationsRequested.current.add(reg.id);
      trackDurationQueueRef.current.push({ id: reg.id, url: resolveTrilhaUrl(reg.trilha_url) });
    });
    pumpTrackDurationQueue();
  }, [registrations]);

  const fmtDuracaoTotal = (totalSeconds: number): string => {
    const mins = Math.round(totalSeconds / 60);
    if (mins < 60) return `${mins}min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  };

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

  /** Atribui bloco direto no DB (sem esperar "Salvar Ordem"). Esperar o botão
      gerava o bug "coreografia some" — produtor movia, fechava sem salvar, e
      perdia a mudança. Ordem dentro do bloco continua sendo manual via drag +
      Salvar Ordem; só o vínculo a bloco é instantâneo. */
  const handleAssignBloco = async (regId: string, blocoId: string | null) => {
    const prevReg = registrations.find(r => r.id === regId);
    setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, bloco_id: blocoId } : r));
    setRecentlyMovedId(regId);
    setTimeout(() => setRecentlyMovedId(curr => (curr === regId ? null : curr)), 2000);
    const { error } = await supabase
      .from('registrations')
      .update({ bloco_id: blocoId })
      .eq('id', regId);
    if (error) {
      console.error('[Schedule] falha ao salvar bloco_id', error);
      setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, bloco_id: prevReg?.bloco_id ?? null } : r));
      setSavedMsg('Falha ao mover. Tente de novo.');
      setTimeout(() => setSavedMsg(''), 3000);
      return;
    }
    const blocoNome = blocoId ? (blocos.find(b => b.id === blocoId)?.name ?? 'bloco') : 'Sem bloco';
    setSavedMsg(`Movida pra ${blocoNome}`);
    setTimeout(() => setSavedMsg(''), 2200);
  };

  /** Remove a coreografia do cronograma (não reprova nem estorna). Move pra
      seção "Removidas", de onde pode ser reincluída. `.select('id')` detecta
      bloqueio de RLS (padrão do projeto — UPDATE silencioso retorna 0 rows). */
  const handleExcludeFromSchedule = async (regId: string) => {
    const reg = registrations.find(r => r.id === regId);
    if (!reg) return;
    // Optimistic. Zera ordem_apresentacao/bloco_id (rascunho) E as colunas
    // _publicado — remover é uma ação de segurança (engano, cancelamento) e
    // precisa sumir do card do inscrito na hora, sem esperar a próxima
    // publicação. Sem isso, o número antigo ficava órfão e continuava
    // aparecendo no card "Ordem de apresentação" mesmo depois de removida.
    setRegistrations(prev => prev.filter(r => r.id !== regId));
    setExcludedRegs(prev => [...prev, {
      ...reg, excluded_from_schedule: true,
      ordem_apresentacao: undefined, bloco_id: null,
      ordem_apresentacao_publicado: null, bloco_id_publicado: null,
    }]);
    const { data, error } = await supabase
      .from('registrations')
      .update({
        excluded_from_schedule: true,
        ordem_apresentacao: null, bloco_id: null,
        ordem_apresentacao_publicado: null, bloco_id_publicado: null,
      })
      .eq('id', regId)
      .select('id');
    if (error || !data?.length) {
      console.error('[Schedule] falha ao remover do cronograma', error);
      setExcludedRegs(prev => prev.filter(r => r.id !== regId));
      setRegistrations(prev => [...prev, reg]);
      setSavedMsg('Falha ao remover. Tente de novo.');
      setTimeout(() => setSavedMsg(''), 3000);
      return;
    }
    setSavedMsg(`"${reg.nome_coreografia}" removida do cronograma`);
    setTimeout(() => setSavedMsg(''), 2600);
  };

  /** Reinclui no cronograma uma coreografia que tinha sido removida. */
  const handleRestoreToSchedule = async (regId: string) => {
    const reg = excludedRegs.find(r => r.id === regId);
    if (!reg) return;
    // Optimistic
    setExcludedRegs(prev => prev.filter(r => r.id !== regId));
    setRegistrations(prev => [...prev, { ...reg, excluded_from_schedule: false }]);
    const { data, error } = await supabase
      .from('registrations')
      .update({ excluded_from_schedule: false })
      .eq('id', regId)
      .select('id');
    if (error || !data?.length) {
      console.error('[Schedule] falha ao reincluir no cronograma', error);
      setRegistrations(prev => prev.filter(r => r.id !== regId));
      setExcludedRegs(prev => [...prev, reg]);
      setSavedMsg('Falha ao reincluir. Tente de novo.');
      setTimeout(() => setSavedMsg(''), 3000);
      return;
    }
    setSavedMsg(`"${reg.nome_coreografia}" voltou pro cronograma`);
    setTimeout(() => setSavedMsg(''), 2600);
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Detecta bloco_id de origem e destino. Se forem diferentes, atualiza
    // bloco_id da coreografia arrastada imediato no DB (igual handleAssignBloco)
    // e marca ordem como suja pra produtor salvar manual.
    const fromReg = registrations.find(r => r.id === active.id);
    const fromBlocoId = fromReg?.bloco_id ?? null;

    // Drop na zona vazia de um bloco (over.id não é uma registration, é o
    // placeholder EMPTY_BLOCO_PREFIX+blocoId) — não há item pra dar arrayMove,
    // só troca o bloco_id.
    if (typeof over.id === 'string' && over.id.startsWith(EMPTY_BLOCO_PREFIX)) {
      const toBlocoId = over.id.slice(EMPTY_BLOCO_PREFIX.length);
      if (fromBlocoId === toBlocoId) return;
      setRegistrations(prev => prev.map(r => r.id === active.id ? { ...r, bloco_id: toBlocoId } : r));
      setOrderChanged(true);
      setRecentlyMovedId(active.id);
      setTimeout(() => setRecentlyMovedId(curr => (curr === active.id ? null : curr)), 2000);
      const { error } = await supabase
        .from('registrations')
        .update({ bloco_id: toBlocoId })
        .eq('id', active.id);
      if (error) {
        console.error('[Schedule] falha ao salvar bloco_id no drag:', error);
        setRegistrations(prev => prev.map(r => r.id === active.id ? { ...r, bloco_id: fromBlocoId } : r));
        setSavedMsg('Falha ao mover. Tente de novo.');
        setTimeout(() => setSavedMsg(''), 3000);
      } else {
        const blocoNome = blocos.find(b => b.id === toBlocoId)?.name ?? 'bloco';
        setSavedMsg(`Movida pra ${blocoNome}`);
        setTimeout(() => setSavedMsg(''), 2200);
      }
      return;
    }

    const toReg   = registrations.find(r => r.id === over.id);
    const toBlocoId   = toReg?.bloco_id ?? null;
    setRegistrations((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id);
      const newIndex = prev.findIndex((r) => r.id === over.id);
      const reordered = arrayMove(prev, oldIndex, newIndex);
      if (fromBlocoId !== toBlocoId) {
        return reordered.map(r => r.id === active.id ? { ...r, bloco_id: toBlocoId } : r);
      }
      return reordered;
    });
    setOrderChanged(true);
    if (fromBlocoId !== toBlocoId) {
      setRecentlyMovedId(active.id);
      setTimeout(() => setRecentlyMovedId(curr => (curr === active.id ? null : curr)), 2000);
      const { error } = await supabase
        .from('registrations')
        .update({ bloco_id: toBlocoId })
        .eq('id', active.id);
      if (error) {
        console.error('[Schedule] falha ao salvar bloco_id no drag:', error);
        setRegistrations(prev => prev.map(r => r.id === active.id ? { ...r, bloco_id: fromBlocoId } : r));
        setSavedMsg('Falha ao mover. Tente de novo.');
        setTimeout(() => setSavedMsg(''), 3000);
      } else {
        const blocoNome = toBlocoId ? (blocos.find(b => b.id === toBlocoId)?.name ?? 'bloco') : 'Sem bloco';
        setSavedMsg(`Movida pra ${blocoNome}`);
        setTimeout(() => setSavedMsg(''), 2200);
      }
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
    const genOpts = { judgeSignatures: judgeBanca.sigMap, minimizeJudgeChanges };
    for (const bloco of sortedBlocos) {
      const regsDoBloco = registrations.filter(r => r.bloco_id === bloco.id);
      const ordered = generateSmartOrder([...regsDoBloco], minInterval, genOpts);
      result.push(...ordered);
    }
    const semBloco = registrations.filter(r => !r.bloco_id);
    const orderedSemBloco = generateSmartOrder([...semBloco], minInterval, genOpts);
    result.push(...orderedSemBloco);
    setRegistrations(result);
    setOrderChanged(true);
    setIsGenerating(false);

    if (minimizeJudgeChanges) {
      let trocas = 0;
      for (let i = 1; i < result.length; i++) {
        if ((judgeBanca.sigMap[result[i].id] ?? '') !== (judgeBanca.sigMap[result[i - 1].id] ?? '')) trocas++;
      }
      setSavedMsg(`Ordem gerada · ${trocas} troca${trocas !== 1 ? 's' : ''} de banca de jurados`);
      setTimeout(() => setSavedMsg(''), 4500);
    }
  };

  // Publica as coreografias do cronograma no Voto Popular (push pro projeto isolado).
  const handlePublishToVote = async () => {
    if (!selectedEventId) { alert('Selecione um evento primeiro.'); return; }
    setIsPublishing(true);
    try {
      const { data, error } = await supabase.functions.invoke('publish-vote-groups', {
        body: { event_id: selectedEventId },
      });
      if (error) throw error;
      alert(`Publicado no Voto Popular: ${(data as any)?.published ?? 0} coreografias.`);
    } catch (e: any) {
      alert('Erro ao publicar no Voto: ' + (e?.message ?? String(e)));
    } finally {
      setIsPublishing(false);
    }
  };

  /** Calcula ordem global respeitando blocos: blocos em ordem (bloco.ordem),
      dentro de cada bloco a ordem visual atual (registrations array).
      Coreografias sem bloco vão pro final como resíduo. Compartilhado entre
      "Salvar Ordem" (rascunho, usado ao vivo por Terminal/Telão) e
      "Publicar pros inscritos" (snapshot congelado) — ambos precisam do
      mesmo cálculo, já que o array local não guarda ordem_apresentacao
      atualizado entre um save e outro (só a posição no array importa). */
  const computeOrderUpdates = (): { id: string; ordem_apresentacao: number; bloco_id: string | null }[] => {
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
    return updates;
  };

  /** Coreografias organizadas em algum bloco vs. ainda soltas em "Sem bloco".
      Mostrado perto do botão Publicar pra não deixar o produtor às cegas
      sobre se já deu pra todo mundo uma posição. */
  const scheduleCoverage = useMemo(() => {
    const total = registrations.length;
    const semBloco = registrations.filter(r => !r.bloco_id).length;
    return { total, organizadas: total - semBloco, semBloco };
  }, [registrations]);

  /** Quantas coreografias mudariam de posição/bloco se publicasse agora,
      comparado com o snapshot `_publicado` atual (o que o inscrito já vê). */
  const publishDiff = useMemo(() => {
    const fresh = computeOrderUpdates();
    const byId = new Map(registrations.map(r => [r.id, r]));
    let changed = 0;
    for (const u of fresh) {
      const r = byId.get(u.id);
      if (!r) continue;
      if ((r.ordem_apresentacao_publicado ?? null) !== u.ordem_apresentacao ||
          (r.bloco_id_publicado ?? null) !== (u.bloco_id ?? null)) {
        changed++;
      }
    }
    return { changed, total: fresh.length };
  }, [registrations, blocos]); // eslint-disable-line

  const handleSaveOrder = async () => {
    setIsSaving(true);
    try {
      const updates = computeOrderUpdates();

      // UPDATE por linha (paralelo), não upsert. `.upsert(...,{onConflict})`
      // monta um INSERT ... ON CONFLICT DO UPDATE no Postgres — sob RLS isso
      // pode falhar pro produtor (que só tem policy de UPDATE em
      // registrations, não de INSERT, desde o fix de 2026-05-22), mesmo
      // quando toda linha já existe e só seria atualizada. UPDATE direto
      // evita esse caminho por completo. Bug real: "Falha ao salvar ordem"
      // sempre disparando pro produtor (Usualdance Festival, 2026-07-08).
      if (updates.length > 0) {
        const results = await Promise.all(
          updates.map(u =>
            supabase
              .from('registrations')
              .update({ ordem_apresentacao: u.ordem_apresentacao, bloco_id: u.bloco_id })
              .eq('id', u.id)
          )
        );
        const firstError = results.find(r => r.error)?.error;
        if (firstError) throw firstError;
      }

      setOrderChanged(false);
      setSavedMsg('Ordem salva com sucesso!');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (err) {
      console.error('Erro ao salvar ordem:', err);
      const msg = (err as { message?: string })?.message;
      setSavedMsg(msg ? `Falha ao salvar ordem: ${msg}` : 'Falha ao salvar ordem. Tente de novo.');
      setTimeout(() => setSavedMsg(''), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  /** Congela o arranjo atual em `_publicado` — só a partir daqui o inscrito
      vê o novo número. Grava também nas colunas "live" (equivalente a um
      Salvar Ordem), então Publicar funciona mesmo sem clicar Salvar antes. */
  const handlePublishSchedule = async () => {
    if (!selectedEventId) return;
    setIsPublishingSchedule(true);
    try {
      // Captura antes de escrever — depois do upsert o diff sempre daria 0.
      const isFirstPublish = !schedulePublishedAt;
      const hadChanges = publishDiff.changed > 0;

      const orderUpdates = computeOrderUpdates();
      const updates = orderUpdates.map(u => ({
        id: u.id,
        ordem_apresentacao: u.ordem_apresentacao,
        bloco_id: u.bloco_id,
        ordem_apresentacao_publicado: u.ordem_apresentacao,
        bloco_id_publicado: u.bloco_id,
      }));
      // UPDATE por linha (paralelo) — mesmo motivo do handleSaveOrder acima:
      // upsert vira INSERT ON CONFLICT sob o capô, que pode esbarrar em RLS
      // que só libera UPDATE pro produtor.
      if (updates.length > 0) {
        const results = await Promise.all(
          updates.map(u =>
            supabase
              .from('registrations')
              .update({
                ordem_apresentacao: u.ordem_apresentacao,
                bloco_id: u.bloco_id,
                ordem_apresentacao_publicado: u.ordem_apresentacao_publicado,
                bloco_id_publicado: u.bloco_id_publicado,
              })
              .eq('id', u.id)
          )
        );
        const firstError = results.find(r => r.error)?.error;
        if (firstError) throw firstError;
      }

      const nowIso = new Date().toISOString();
      const { data, error: evError } = await supabase
        .from('events')
        .update({ schedule_published_at: nowIso })
        .eq('id', selectedEventId)
        .select('id');
      if (evError) throw evError;
      if (!data?.length) throw new Error('RLS bloqueou update em events.schedule_published_at');

      const byId = new Map(updates.map(u => [u.id, u]));
      setRegistrations(prev => prev.map(r => {
        const u = byId.get(r.id);
        return u
          ? { ...r, ordem_apresentacao: u.ordem_apresentacao, bloco_id: u.bloco_id,
              ordem_apresentacao_publicado: u.ordem_apresentacao_publicado, bloco_id_publicado: u.bloco_id_publicado }
          : r;
      }));
      setOrderChanged(false);
      setSchedulePublishedAt(nowIso);

      // Notifica só quando faz sentido — 1ª publicação ou quando algo de
      // fato mudou. Publicar de novo sem alteração nenhuma não deveria
      // reenviar a mesma notificação pra todo mundo.
      let notified = 0;
      if (isFirstPublish || hadChanges) {
        const { data: count, error: notifyError } = await supabase.rpc('notify_schedule_published', {
          p_event_id: selectedEventId,
        });
        if (notifyError) console.error('Erro ao notificar inscritos:', notifyError);
        else notified = count ?? 0;
      }

      setPublishResult({ notified });
      // Otimista: ninguém leu ainda a leva que acabou de sair. Se não notificou
      // de novo (sem mudança), mantém o readStats anterior como está.
      if (isFirstPublish || hadChanges) setReadStats({ total: notified, read: 0 });
      setSavedMsg('Ordem publicada — os inscritos já veem a posição atual.');
      setTimeout(() => setSavedMsg(''), 4000);
    } catch (err) {
      console.error('Erro ao publicar ordem:', err);
      const msg = (err as { message?: string })?.message;
      setSavedMsg(msg ? `Falha ao publicar: ${msg}` : 'Falha ao publicar. Tente de novo.');
      setTimeout(() => setSavedMsg(''), 5000);
    } finally {
      setIsPublishingSchedule(false);
    }
  };

  /** Etapa 2 do modal de publicação — sugestão de 1 clique pra também
      destacar a publicação como Aviso na Início (reaproveita event_announcements,
      já usado em /avisos). Texto fixo v1, sem edição — quem quiser algo
      customizado cria manualmente em Avisos. */
  const handlePostAnnouncement = async () => {
    if (!selectedEventId) return;
    setIsPostingAnnouncement(true);
    try {
      const { error } = await supabase.from('event_announcements').insert({
        event_id: selectedEventId,
        title: 'Ordem de apresentação publicada',
        body: 'Confira sua posição na fila de apresentação na tela Início.',
        cta_label: 'Ver ordem',
        cta_url: '/dashboard',
      });
      if (error) throw error;
      setShowPublishModal(false);
      setPublishResult(null);
      setSavedMsg('Aviso publicado também!');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (err) {
      console.error('Erro ao publicar aviso:', err);
      setSavedMsg('Falha ao publicar o aviso. Tente de novo em /avisos.');
      setTimeout(() => setSavedMsg(''), 4000);
    } finally {
      setIsPostingAnnouncement(false);
    }
  };

  const handleClosePublishModal = () => {
    setShowPublishModal(false);
    setPublishResult(null);
  };

  /** Exporta a ordem de apresentação em PDF — prática de mercado (Joinville,
      Catanduva, CompetitionSuite/DanceComp Genie sempre publicam a "ordem do
      dia" impressa/PDF pra bailarinos, pais, staff e júri conferirem sem
      depender do app). Sem horário por coreografia de propósito: o cronograma
      ao vivo sempre atrasa, e prometer minuto exato gera mais reclamação do
      que não mostrar — mesmo princípio já aplicado no card "Ordem de
      apresentação" da tela Início do inscrito. */
  const handleExportPdf = async () => {
    if (registrations.length === 0) return;
    setIsExportingPdf(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const eventName = allEvents.find(e => e.id === selectedEventId)?.name || 'Cronograma';
      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFillColor(255, 0, 104);
      doc.rect(0, 0, pageWidth, 26, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Ordem de Apresentação', pageWidth / 2, 12, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(eventName, pageWidth / 2, 19, { align: 'center' });

      const sortedBlocos = [...blocos].sort((a, b) => a.ordem - b.ordem);
      let cursorY = 36;

      const gruposParaExportar: { nome: string; regs: Registration[] }[] = [
        ...sortedBlocos.map(b => ({ nome: b.name, regs: registrations.filter(r => r.bloco_id === b.id) })),
        { nome: 'Sem bloco', regs: registrations.filter(r => !r.bloco_id) },
      ].filter(g => g.regs.length > 0);

      for (const grupo of gruposParaExportar) {
        if (cursorY > 260) { doc.addPage(); cursorY = 20; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 0, 104);
        doc.text(grupo.nome, 14, cursorY);
        doc.setTextColor(40, 40, 40);
        cursorY += 4;

        const body = grupo.regs.map((r, i) => [
          String(r.ordem_apresentacao ?? i + 1),
          r.nome_coreografia || '—',
          toTitleCase(resolveEstudio(r)) || '—',
          r.categoria || '—',
          r.estilo_danca || '—',
        ]);

        autoTable(doc, {
          head: [['Nº', 'Coreografia', 'Estúdio', 'Categoria', 'Estilo']],
          body,
          startY: cursorY,
          theme: 'striped',
          headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8, textColor: 40 },
          alternateRowStyles: { fillColor: [248, 248, 250] },
          columnStyles: {
            0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
          },
          margin: { left: 14, right: 14 },
        });

        cursorY = (doc as any).lastAutoTable.finalY + 8;
      }

      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(
        'Ordem sequencial de apresentação — horários variam ao vivo. Gerado por CoreoHub.',
        14, doc.internal.pageSize.getHeight() - 8
      );

      doc.save(`ordem-apresentacao-${eventName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
    } catch (err) {
      console.error('Erro ao gerar PDF da ordem:', err);
      alert('Erro ao gerar o PDF. Tente de novo.');
    } finally {
      setIsExportingPdf(false);
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
        const studio = sanitize(resolveEstudio(reg) || 'Estudio');
        const coreografia = sanitize(reg.nome_coreografia || 'Coreografia');
        const style = sanitize(reg.estilo_danca || 'Estilo');
        const category = sanitize(reg.categoria || 'Geral');
        const ext = reg.trilha_url.split('?')[0].split('.').pop() || 'mp3';
        const filename = `${num}_${studio}_${coreografia}_${style}_${category}.${ext}`;

        try {
          const response = await fetch(resolveTrilhaUrl(reg.trilha_url));
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
    if (!selectedEventId) { setShowSettings(false); return; }
    setIsSavingSettings(true);
    try {
      // Grava na row do evento (multi-tenant), não na legacy id='1' compartilhada.
      // Espelha a leitura por event_id e o padrão do /narracao-ia.
      await supabase.from('configuracoes').update({
        tempo_entrada:       tempoEntrada,
        intervalo_seguranca: intervaloSeguranca,
      }).eq('id', selectedEventId);
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
    <div className="max-w-7xl mx-auto space-y-6 pb-16 animate-in fade-in duration-500">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <PageHeader
          title={<>Sonoplastia & <span className="text-[#ff0068]">Cronograma</span></>}
          subtitle="Cronograma inteligente & trilhas sonoras"
        />

        <div className="flex items-center gap-2 flex-wrap">
          {/* Edition selector — em modo demo só mostra demos; em modo real só mostra reais.
              Evita produtor abrir demo e ver eventos de produção misturados no picker. */}
          {allEvents.length > 0 && (() => {
            const selectedEv = allEvents.find(ev => ev.id === selectedEventId);
            const isInDemo = !!selectedEv?.is_demo;
            const visibleEvents = allEvents.filter(ev => !!ev.is_demo === isInDemo);
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
                    {visibleEvents.map(ev => {
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

          {/* Busca rápida — destaca rows que batem com o termo (não filtra,
              só sinaliza). Permite achar 1 entre N coreografias sem perder
              contexto do cronograma. */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar coreografia..."
              className="pl-7 pr-3 py-2 w-44 sm:w-56 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-white placeholder-slate-400 outline-none focus:border-[#ff0068]/50"
            />
          </div>

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

          {/* Blocos — gerenciador (Etapa 2). Padronizado pra outline neutro. */}
          <button
            onClick={() => setShowBlocosManager(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-white/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
            title="Criar e gerenciar blocos do cronograma (Bloco 1 - Manhã, etc)"
          >
            <Layers size={12} />
            Blocos
            {blocos.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-500 text-[8px] tabular-nums">{blocos.length}</span>
            )}
          </button>

          {/* Modificador opt-in do "Gerar Ordem Inteligente" — quando ligado,
              o algoritmo prioriza manter a mesma banca de jurados avaliando
              em sequência (desempate dentro do intervalo de segurança, nunca
              o sobrepõe). Desligado, comportamento é o de sempre (aleatório). */}
          <button
            onClick={() => setMinimizeJudgeChanges((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-[9px] font-black uppercase tracking-widest transition-all
              ${minimizeJudgeChanges
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent'
                : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400'}`}
            title="Ao gerar a ordem, evita trocar a composição de jurados a cada coreografia — só entra em ação junto com 'Gerar Ordem Inteligente'. O Intervalo de Segurança de bailarinos continua tendo prioridade."
          >
            <Users size={12} />
            Minimizar troca de jurados
          </button>

          <button
            onClick={handleGenerateSmart}
            disabled={isGenerating || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-white/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-60"
          >
            {isGenerating && <Loader2 size={12} className="animate-spin" />}
            {isGenerating ? 'Gerando...' : 'Gerar Ordem Inteligente'}
          </button>

          {/* Atalho recíproco pra Configurações > Narração IA — pra quando o
              sonoplasta precisa ajustar voz/template no meio de um evento
              sem sair navegando pelo menu num momento de estresse. */}
          <button
            onClick={() => navigate('/narracao-ia')}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-white/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
            title="Ajustar template, voz e modo de sonoplastia da Narração IA"
          >
            <Volume2 size={12} />
            Ajustar Narração IA
          </button>

          {/* IA de Narração — gerar todas em batch */}
          <button
            onClick={handleGenerateAll}
            disabled={!!batchProgress || registrations.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-white/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
            title="Gerar narrações IA pré-renderizadas pra todas as coreografias"
          >
            {batchProgress
              ? <><Loader2 size={12} className="animate-spin" /> Gerando {batchProgress.done}/{batchProgress.total}...</>
              : 'Gerar narrações IA'
            }
          </button>

          <button
            onClick={handlePublishToVote}
            disabled={isPublishing || registrations.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-[#ff0068]/50 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
            title="Enviar as coreografias do cronograma pro Voto Popular (vote.usualdance.com)"
          >
            {isPublishing ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} />}
            {isPublishing ? 'Publicando...' : 'Publicar no Voto'}
          </button>

          {orderChanged && (
            <button
              onClick={handleSaveOrder}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-60"
            >
              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {isSaving ? 'Salvando...' : 'Salvar Ordem'}
            </button>
          )}

          {/* Publicar pros inscritos — separado do Salvar Ordem de propósito.
              Salvar grava o rascunho (usado ao vivo por Terminal/Telão);
              Publicar congela o snapshot que o card "Ordem de apresentação"
              do inscrito exibe. Ver [[schedule-publish-fase2]]. */}
          <button
            onClick={() => { setPublishResult(null); setShowPublishModal(true); }}
            disabled={registrations.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50"
            title="Publica a ordem atual pros inscritos verem no painel deles"
          >
            <Megaphone size={12} />
            Publicar pros inscritos
          </button>

          <button
            onClick={handleDownloadZip}
            disabled={isDownloading || stats.withTrack === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-white/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-60"
          >
            {isDownloading
              ? <><Loader2 size={12} className="animate-spin" />{downloadProgress}%</>
              : <><FileArchive size={12} />Baixar Trilhas ZIP</>}
          </button>

          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf || registrations.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-white/20 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-60"
            title="Gera PDF com a ordem de apresentação, horário estimado e bloco de cada coreografia"
          >
            {isExportingPdf
              ? <><Loader2 size={12} className="animate-spin" />Gerando...</>
              : <><FileText size={12} />Exportar PDF</>}
          </button>
        </div>
      </div>

      {/* ── Cobertura + status de publicação ── */}
      {registrations.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            {scheduleCoverage.organizadas}/{scheduleCoverage.total} organizadas em blocos
            {scheduleCoverage.semBloco > 0 && (
              <span className="text-amber-500"> · {scheduleCoverage.semBloco} sem bloco</span>
            )}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/30">
            {schedulePublishedAt
              ? `Última publicação: ${formatDateTimeBr(schedulePublishedAt)}`
              : 'Ainda não publicado pros inscritos'}
          </span>
          {readStats && readStats.total > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              {readStats.read}/{readStats.total} já visualizaram
            </span>
          )}
        </div>
      )}

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
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
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
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
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
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
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

      {/* Indicador de pré-cache do modo TRILHA — some sozinho quando termina */}
      {modoTrilha && precacheStatus && precacheStatus.done < precacheStatus.total && (
        <div aria-live="polite" className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          Baixando trilhas pro dispositivo: {precacheStatus.done}/{precacheStatus.total}
        </div>
      )}
      {modoTrilha && precacheStatus && precacheStatus.done === precacheStatus.total && precacheStatus.total > 0 && (
        precacheStatus.failed > 0 ? (
          <div aria-live="polite" className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-widest">
            <AlertTriangle size={12} aria-hidden="true" />
            {precacheStatus.total - precacheStatus.failed}/{precacheStatus.total} trilhas offline · {precacheStatus.failed} não baixaram (toca da rede se houver conexão)
          </div>
        ) : (
          <div aria-live="polite" className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
            <CheckCircle2 size={12} aria-hidden="true" />
            {precacheStatus.total} trilhas prontas offline neste dispositivo
          </div>
        )
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-slate-900 dark:text-white', bg: 'bg-white dark:bg-white/5', border: 'border-slate-200 dark:border-white/10' },
          { label: 'Com Trilha', value: stats.withTrack, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20' },
          { label: 'Sem Trilha', value: stats.withoutTrack, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20' },
          { label: 'Conflitos', value: stats.conflicts, color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-500/10', border: 'border-rose-200 dark:border-rose-500/20' },
          // Runtime estimado do dia inteiro: soma de trilhas lidas + buffer
          // de entrada/intervalo por apresentação (mesma config da Narração
          // IA). "+" quando ainda falta ler a duração de alguma trilha.
          (() => {
            const totalMusicSecs = registrations.reduce((acc, r) => acc + (trackDurations[r.id] || 0), 0);
            const totalMissing = registrations.filter(r => r.trilha_url && trackDurations[r.id] == null).length;
            const totalBufferSecs = registrations.length * (tempoEntrada + intervaloSeguranca);
            const label = totalMusicSecs > 0
              ? `~${fmtDuracaoTotal(totalMusicSecs + totalBufferSecs)}${totalMissing > 0 ? '+' : ''}`
              : '—';
            return { label: 'Duração Estimada', value: label, color: 'text-[#1de7f2]', bg: 'bg-[#1de7f2]/10', border: 'border-[#1de7f2]/20' };
          })(),
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-2xl p-4 space-y-1`}>
            <p className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-white/40">{s.label}</p>
            <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Stage / Player ao vivo ── */}
      {/* Intentional dark card: padrão "now playing" de console DJ (Spotify/Apple Music
          mantêm dark mesmo em light mode quando representa player ao vivo).
          sticky: relato real da produção — em cronograma com muitos inscritos,
          o player ficava fora da viewport ao rolar a lista pra escolher a
          próxima música, obrigando a rolar de volta pro topo pra pausar/parar. */}
      {/* z-[51]: linha em drag-and-drop sobe pra zIndex:50 (inline style,
          ver SortableRow) — o player sticky precisa ficar acima dela, senão
          uma linha arrastada perto do topo tampa os controles. */}
      <div className="sticky top-0 z-[51] bg-slate-900 rounded-[2rem] p-6 border border-white/10 shadow-2xl relative overflow-hidden">
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
            <h2 className="text-2xl font-black uppercase tracking-tighter text-white">
              {currentTrack?.nome_coreografia || 'Nenhuma selecionada'}
            </h2>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              {currentTrack
                ? resolveEstudio(currentTrack)
                : 'Clique em "Iniciar" em uma coreografia abaixo'}
            </p>
            {/* Indicador de secao do modo SISTEMA (auto-play sequencial) */}
            {modoSistema && currentTrack && playerSection !== 'idle' && (
              <div className="pt-2 flex items-center gap-2 flex-wrap text-[9px] font-black uppercase tracking-widest">
                <span className={`px-2 py-0.5 rounded-full ${playerSection === 'entrada' ? 'bg-violet-500 text-white' : 'bg-white/5 text-slate-500'}`}>1 Narração</span>
                <span className={`px-2 py-0.5 rounded-full ${playerSection === 'wait' ? 'bg-amber-500 text-white' : 'bg-white/5 text-slate-500'}`}>
                  2 Espera{playerSection === 'wait' ? ` (${waitRemaining}s)` : ''}
                </span>
                <span className={`px-2 py-0.5 rounded-full ${playerSection === 'trilha' ? 'bg-[#ff0068] text-white' : 'bg-white/5 text-slate-500'}`}>3 Trilha</span>
                {saidaAtiva && (
                  <span className={`px-2 py-0.5 rounded-full ${playerSection === 'saida' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-slate-500'}`}>4 Saída</span>
                )}
              </div>
            )}
            {/* Barra de progresso da trilha — modo SISTEMA (na etapa 3) ou modo
                TRILHA (toca só a música, sem sequência de seções). Bug fixado
                2026-07-10: antes só aparecia presa atrás de modoSistema, então
                o modo Trilha (provavelmente o mais usado ao vivo) tocava a
                música sem nunca mostrar progresso/duração pro sonoplasta. */}
            {((modoSistema || modoTrilha) && playerSection === 'trilha') && trilhaDuration > 0 && (
              <div className="pt-2 space-y-1">
                {/* Barra de progresso arrastável/clicável — pedido real da equipe
                    de produção: "precisa ter opção completa de avançar, atrasar
                    o progresso da música". py-2/-my-2 alarga o alvo de toque
                    sem engordar a barra visual.
                    role=slider + tabIndex: fica na ordem de tabulação e é
                    identificável por leitor de tela (as setas de teclado do
                    player já funcionam quando o foco cai aqui, via listener
                    global). Durante o arraste, atualiza o preenchimento
                    direto no DOM (ref) em vez de chamar setTrilhaProgress a
                    cada pointermove — evita re-renderizar a página inteira
                    (incl. a lista de linhas, que pode ter 100+ inscritos) a
                    cada tick do gesto. O seek de fato (currentTime + state)
                    só é commitado 1x no pointerup. */}
                <div
                  className="py-2 -my-2 cursor-pointer touch-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0068] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                  role="slider"
                  tabIndex={0}
                  aria-label="Progresso da trilha"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(trilhaDuration)}
                  aria-valuenow={Math.round(trilhaProgress)}
                  aria-valuetext={fmtTrilhaTime(trilhaProgress)}
                  onPointerDown={(e) => {
                    const bar = e.currentTarget;
                    const fractionAt = (clientX: number) => {
                      const rect = bar.getBoundingClientRect();
                      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                    };
                    // Fill + rótulo mm:ss atualizados juntos via DOM durante o
                    // arraste — sem isso o texto ficava preso no valor antigo
                    // até soltar, descompassado da barra que já se movia.
                    const applyFraction = (fraction: number) => {
                      if (trilhaFillRef.current) trilhaFillRef.current.style.width = `${fraction * 100}%`;
                      if (trilhaTimeLabelRef.current) trilhaTimeLabelRef.current.textContent = fmtTrilhaTime(fraction * trilhaDuration);
                    };
                    let lastFraction = fractionAt(e.clientX);
                    applyFraction(lastFraction);
                    bar.setPointerCapture(e.pointerId);
                    const onMove = (ev: PointerEvent) => {
                      lastFraction = fractionAt(ev.clientX);
                      applyFraction(lastFraction);
                    };
                    const onUp = () => {
                      bar.removeEventListener('pointermove', onMove);
                      seekTrilhaTo(lastFraction);
                    };
                    bar.addEventListener('pointermove', onMove);
                    bar.addEventListener('pointerup', onUp, { once: true });
                  }}
                >
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div ref={trilhaFillRef} className="h-full bg-[#ff0068] transition-all" style={{ width: `${(trilhaProgress / trilhaDuration) * 100}%` }} />
                  </div>
                </div>
                <div className="flex justify-between text-[8px] font-bold text-slate-400 tabular-nums">
                  <span ref={trilhaTimeLabelRef}>{fmtTrilhaTime(trilhaProgress)}</span>
                  <span>{fmtTrilhaTime(trilhaDuration)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Modo TRILHA não tem narração IA — narrador fala ao vivo no
                microfone, então esse botão só existe nos outros 2 modos. */}
            {!modoTrilha && (
              <button
                onClick={() => currentTrack && handleAnnounce(currentTrack)}
                disabled={!currentTrack}
                className="p-4 bg-white/5 text-white rounded-2xl hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                title="Anunciar com Narração IA"
              >
                <Volume2 size={24} className="group-hover:text-[#ff0068] transition-colors" />
              </button>
            )}
            {/* Retroceder/avançar 10s — só faz sentido com trilha tocando (não narração). */}
            {playerSection === 'trilha' && trilhaDuration > 0 && (
              <button
                onClick={() => seekTrilha(-10)}
                aria-label="Voltar 10 segundos"
                className="p-3 bg-white/5 text-white rounded-2xl hover:bg-white/10 transition-all"
                title="Voltar 10s"
              >
                <Rewind size={20} />
              </button>
            )}
            <button
              onClick={togglePlayPause}
              disabled={!currentTrack}
              className="w-16 h-16 bg-[#ff0068] text-white rounded-2xl flex items-center justify-center shadow-lg shadow-[#ff0068]/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title={isPlaying ? (modoTrilha ? 'Pausar trilha' : 'Pausar narração') : (modoTrilha ? 'Tocar trilha' : 'Tocar narração')}
            >
              {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
            </button>
            {playerSection === 'trilha' && trilhaDuration > 0 && (
              <button
                onClick={() => seekTrilha(10)}
                aria-label="Avançar 10 segundos"
                className="p-3 bg-white/5 text-white rounded-2xl hover:bg-white/10 transition-all"
                title="Avançar 10s"
              >
                <FastForward size={20} />
              </button>
            )}
            {/* Skip — so visivel em modo SISTEMA com sequencia rolando */}
            {modoSistema && playerSection !== 'idle' && (
              <button
                onClick={skipCurrentSection}
                className="p-4 bg-white/5 text-white rounded-2xl hover:bg-amber-500/20 hover:text-amber-400 transition-all"
                title="Pular trecho atual e ir pra próxima etapa"
              >
                <SkipForward size={24} />
              </button>
            )}
            <button
              onClick={handleEndLive}
              disabled={!currentTrack || updatingLive}
              className="p-4 bg-white/5 text-white rounded-2xl hover:bg-rose-500/20 hover:text-rose-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={saidaAtiva && currentTrack && audios[currentTrack.id]?.saida
                ? 'Encerrar com narração de saída (toca antes de zerar live)'
                : 'Encerrar transmissão (jurados pararão de ver AO VIVO)'}
            >
              <Square size={20} fill="currentColor" />
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
              {excludedRegs.length > 0 ? 'Todas removidas do cronograma' : 'Nenhuma coreografia ainda'}
            </p>
            <p className="text-[9px] font-bold text-slate-300 dark:text-white/20 mt-1">
              {excludedRegs.length > 0
                ? 'Reinclua alguma na seção "Removidas" abaixo'
                : 'Assim que uma inscrição for paga, ela aparece aqui automaticamente'}
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

            const searchLower = search.trim().toLowerCase();
            const matches = (r: Registration) => {
              if (!searchLower) return false;
              return (
                (r.nome_coreografia ?? '').toLowerCase().includes(searchLower) ||
                resolveEstudio(r).toLowerCase().includes(searchLower)
              );
            };

            const renderRows = (regs: Registration[], startIdx: number) =>
              regs.map((reg, localIdx) => (
                <SortableRow
                  key={reg.id}
                  reg={reg}
                  index={startIdx + localIdx}
                  conflicts={conflicts[reg.id] || []}
                  judgeNames={judgeBanca.namesMap[reg.id]}
                  audioSet={audios[reg.id]}
                  trackDuration={trackDurations[reg.id]}
                  saidaAtiva={saidaAtiva}
                  isLive={currentTrack?.id === reg.id}
                  isLastPlayed={!currentTrack && lastPlayedId === reg.id}
                  isGenerating={generatingId === reg.id}
                  batchInProgress={!!batchProgress}
                  updatingLive={updatingLive}
                  currentVoice={config?.voice_id || 'Charon'}
                  blocos={blocos}
                  matchesSearch={matches(reg)}
                  recentlyMoved={recentlyMovedId === reg.id}
                  onOpenBlocoPicker={setBlocoPickerForReg}
                  onGenerateOne={handleGenerateOne}
                  onAnnounce={handleAnnounce}
                  onPrepare={handlePrepare}
                  onMarkLiveOnly={handleMarkLiveOnly}
                  onExclude={handleExcludeFromSchedule}
                />
              ));

            for (const bloco of sortedBlocos) {
              const regs = registrations.filter(r => r.bloco_id === bloco.id);
              const startIdx = globalIdx;
              globalIdx += regs.length;
              // Soma a duração das trilhas já lidas + buffer de troca
              // (entrada+intervalo, mesma config usada pela Narração IA) por
              // apresentação — estimativa de runtime do bloco, padrão de
              // mercado (CompetitionSuite/DanceComp Genie mostram isso em
              // todo cronograma pra produtor calcular hora de término).
              const musicSecs = regs.reduce((acc, r) => acc + (trackDurations[r.id] || 0), 0);
              const missingCount = regs.filter(r => r.trilha_url && trackDurations[r.id] == null).length;
              const bufferSecs = regs.length * (tempoEntrada + intervaloSeguranca);
              const runtimeLabel = musicSecs > 0
                ? `~${fmtDuracaoTotal(musicSecs + bufferSecs)}${missingCount > 0 ? '+' : ''}`
                : null;
              sections.push(
                <div key={bloco.id} className="space-y-2">
                  <div className="flex items-center gap-2 pt-2">
                    <div className="h-px flex-1 bg-[#ff0068]/30" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] px-2">
                      {bloco.name} · {regs.length}
                      {runtimeLabel && <span className="text-slate-400 dark:text-white/30 normal-case tracking-normal"> · {runtimeLabel} estimado</span>}
                    </span>
                    <div className="h-px flex-1 bg-[#ff0068]/30" />
                  </div>
                  {regs.length === 0 ? (
                    <EmptyBlocoDropZone blocoId={bloco.id} />
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

      {/* ── Removidas do cronograma (restauráveis) ── */}
      {excludedRegs.length > 0 && !isLoading && (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] overflow-hidden">
          <button
            onClick={() => setShowExcluded(s => !s)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <X size={12} />
              {excludedRegs.length} removida{excludedRegs.length !== 1 ? 's' : ''} do cronograma
            </span>
            {showExcluded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
          </button>
          {showExcluded && (
            <div className="px-3 pb-3 space-y-2">
              {excludedRegs.map(reg => (
                <div key={reg.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-white/8 bg-white dark:bg-white/5">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[11px] font-black uppercase tracking-tight truncate text-slate-700 dark:text-slate-200">
                      {reg.nome_coreografia}
                    </h4>
                    <span className="text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-widest truncate">
                      {resolveEstudio(reg)}{reg.categoria ? ` · ${reg.categoria}` : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRestoreToSchedule(reg.id)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest bg-[#ff0068]/10 text-[#ff0068] hover:bg-[#ff0068]/20 active:scale-95 transition-all"
                    title="Reincluir no cronograma"
                  >
                    <Plus size={11} /> Reincluir
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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
              Os arquivos serão renomeados no padrão: 001_Estudio_Coreografia_Estilo_Categoria.mp3 — na ordem atual do cronograma.
            </p>
          </div>
        </div>
      )}

      {/* ── Modal Publicar pros inscritos (2 etapas: confirmar → sugerir Aviso) ── */}
      {showPublishModal && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !isPublishingSchedule && !isPostingAnnouncement && handleClosePublishModal()}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {!publishResult ? (
              <>
                <div className="p-5 border-b border-slate-200 dark:border-white/10 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Megaphone size={16} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Publicar</p>
                    <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic text-base">
                      Ordem de apresentação
                    </h3>
                  </div>
                </div>

                <div className="p-5 space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {scheduleCoverage.organizadas} de {scheduleCoverage.total} coreografias organizadas em blocos.
                  </p>

                  {scheduleCoverage.semBloco > 0 && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                      <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        {scheduleCoverage.semBloco} coreografia{scheduleCoverage.semBloco !== 1 ? 's' : ''} ainda sem bloco —
                        {' '}vão aparecer no fim da lista pro inscrito de cada uma.
                      </p>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {schedulePublishedAt
                      ? (publishDiff.changed > 0
                          ? `${publishDiff.changed} coreografia${publishDiff.changed !== 1 ? 's' : ''} vão mudar de posição/bloco desde a última publicação (${formatDateTimeBr(schedulePublishedAt)}). Os inscritos afetados serão notificados no sininho.`
                          : `Nenhuma mudança desde a última publicação (${formatDateTimeBr(schedulePublishedAt)}) — ninguém será notificado de novo.`)
                      : 'Esta é a primeira publicação — todos os inscritos organizados serão notificados no sininho.'}
                  </p>

                  <p className="text-[9px] text-slate-400 dark:text-white/30">
                    Depois de publicar, o card "Ordem de apresentação" na Início de cada inscrito atualiza na hora.
                  </p>
                </div>

                <div className="flex gap-2 p-4 border-t border-slate-200 dark:border-white/10">
                  <button
                    onClick={handleClosePublishModal}
                    disabled={isPublishingSchedule}
                    className="flex-1 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handlePublishSchedule}
                    disabled={isPublishingSchedule}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-60"
                  >
                    {isPublishingSchedule ? <Loader2 size={12} className="animate-spin" /> : <Megaphone size={12} />}
                    {isPublishingSchedule ? 'Publicando...' : 'Publicar agora'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-5 border-b border-slate-200 dark:border-white/10 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <CheckCircle2 size={16} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Publicado</p>
                    <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white italic text-base">
                      {publishResult.notified > 0
                        ? `${publishResult.notified} inscrito${publishResult.notified !== 1 ? 's' : ''} notificado${publishResult.notified !== 1 ? 's' : ''}`
                        : 'Ordem publicada'}
                    </h3>
                  </div>
                </div>

                <div className="p-5 space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Quer também destacar isso com um Aviso na tela Início? Fica mais visível que só a notificação do sininho.
                  </p>
                  <div className="p-3 bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-xl">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Aviso do produtor</p>
                    <h4 className="font-black text-sm text-slate-900 dark:text-white mt-0.5">
                      Ordem de apresentação publicada
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Confira sua posição na fila de apresentação na tela Início.
                    </p>
                  </div>
                  <p className="text-[9px] text-slate-400 dark:text-white/30">
                    Pode editar ou remover depois em Operação → Avisos.
                  </p>
                </div>

                <div className="flex gap-2 p-4 border-t border-slate-200 dark:border-white/10">
                  <button
                    onClick={handleClosePublishModal}
                    disabled={isPostingAnnouncement}
                    className="flex-1 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    Não, obrigado
                  </button>
                  <button
                    onClick={handlePostAnnouncement}
                    disabled={isPostingAnnouncement}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-60"
                  >
                    {isPostingAnnouncement ? <Loader2 size={12} className="animate-spin" /> : <Megaphone size={12} />}
                    {isPostingAnnouncement ? 'Publicando...' : 'Postar Aviso também'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal Gerenciar Blocos (Etapa 2) ── */}
      {/* Bloco Picker — modal/bottomsheet pra atribuir coreografia a um bloco.
          Substitui o select inline da row (que estourava layout em mobile). */}
      {blocoPickerForReg && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setBlocoPickerForReg(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col max-h-[80dvh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200 dark:border-white/10">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mover pra outro bloco</p>
              <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate mt-0.5">
                {blocoPickerForReg.nome_coreografia}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{toTitleCase(resolveEstudio(blocoPickerForReg))}</p>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
              <button
                onClick={() => { handleAssignBloco(blocoPickerForReg.id, null); setBlocoPickerForReg(null); }}
                className={`w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left ${!blocoPickerForReg.bloco_id ? 'bg-[#ff0068]/5' : ''}`}
              >
                <span className={`text-[11px] font-black uppercase tracking-widest ${!blocoPickerForReg.bloco_id ? 'text-[#ff0068]' : 'text-slate-700 dark:text-slate-300'}`}>
                  — Sem bloco
                </span>
                {!blocoPickerForReg.bloco_id && <CheckCircle2 size={14} className="text-[#ff0068]" />}
              </button>
              {[...blocos].sort((a, b) => a.ordem - b.ordem).map(b => {
                const active = blocoPickerForReg.bloco_id === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={() => { handleAssignBloco(blocoPickerForReg.id, b.id); setBlocoPickerForReg(null); }}
                    className={`w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left ${active ? 'bg-[#ff0068]/5' : ''}`}
                  >
                    <span className={`text-[11px] font-black uppercase tracking-tight truncate ${active ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
                      {b.name}
                    </span>
                    {active && <CheckCircle2 size={14} className="text-[#ff0068] shrink-0" />}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setBlocoPickerForReg(null)}
              className="px-5 py-3 border-t border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showBlocosManager && (
        <div
          className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          onClick={() => setShowBlocosManager(false)}
        >
          <div
            className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden flex flex-col max-h-[85dvh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#ff0068]/10 rounded-2xl text-[#ff0068]">
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
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg"
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
                        className="p-1.5 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Subir"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => handleMoveBloco(bloco, 'down')}
                        disabled={idx === arr.length - 1}
                        className="p-1.5 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Descer"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        onClick={() => handleRenameBloco(bloco)}
                        className="p-1.5 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg"
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
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all disabled:opacity-50"
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
