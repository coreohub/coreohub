import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { isStyleInList } from '../utils/styleMatch';
import { classifyAward as classifyAwardShared, resolveMedalLabel, type MedalLabels } from '../utils/awardClassification';
import {
  BarChart3, Download, RefreshCw, Loader2, Search,
  ChevronDown, ChevronUp, ChevronRight, Trophy, CheckCircle2, AlertCircle,
  Volume2, FileText, AlertTriangle, FileDown, Trash2,
} from 'lucide-react';

/* ── Types ── */
interface ScoreDetail {
  judge: string;
  judge_id: string;
  tipo_juri: 'tecnico' | 'artistico';
  scores: Record<string, number>;
  final: number | null;
  audio_url: string | null;
  submitted_at: string;
  audit_log: any;
}

interface GroupedResult {
  id: string;
  nome_coreografia: string;
  estudio: string;
  estilo_danca: string;
  categoria: string;
  /** Formação (Solo/Duo/Trio/Grupo/...) — cada formação é uma classe de
   *  disputa separada do mesmo estilo+categoria, precisa entrar na chave de
   *  agrupamento do ranking senão Trio e Solo do mesmo estilo/categoria
   *  competem juntos por engano. */
  formato_participacao: string;
  /** Subgênero/modalidade (ex: K-Pop → Cover/Creative) — quando o estilo tem
   *  sub_types configurados, cada subgênero é uma classe de disputa separada
   *  (achado real: Usualdance mistura Cover e Creative de K-Pop no mesmo
   *  estilo+categoria+formação sem isso). Vazio quando o estilo não usa
   *  subgênero — não deve criar um grupo a mais nesse caso. */
  subgenero: string;
  tipo_apresentacao: string;
  status: string;
  resultado_publicado: boolean;
  /** Nota final combinada (Técnico × Artístico, pelos pesos configurados em
   *  Avaliação) — usada pra ranking/medalhas/publicação, mantém o nome legado
   *  pra não quebrar o resto do componente. */
  average_score: number;
  /** Médias separadas por tipo de jurado, exibidas pra transparência (padrão
   *  scorecard de patinação artística: TES/PCS visíveis + total combinado). */
  average_score_tecnico: number | null;
  average_score_artistico: number | null;
  /** Contagem de avaliações COM nota (final_weighted_average != null) — usada
   *  pra ranking/medalha/CSV. Mostra Avaliada (feedback só-texto/áudio) sempre
   *  grava final_weighted_average=null, então fica 0 aqui mesmo com feedbacks
   *  reais — use total_evaluations_count pra esses casos. */
  evaluations_count: number;
  /** Contagem real de linhas em `evaluations` pra essa coreografia, com ou sem
   *  nota — é o que decide se há algo pra "Limpar avaliações de teste". */
  total_evaluations_count: number;
  scores_detail: ScoreDetail[];
  has_outlier: boolean;
}

interface MedalThresholds { gold: number; silver: number; bronze: number; }
type PremiationSystem = 'THRESHOLD' | 'RANKING';

const DEFAULT_THRESHOLDS: MedalThresholds = { gold: 9.0, silver: 8.0, bronze: 7.0 };

/* ── Medal styles — cor/ícone ficam fixos por faixa, só o texto do label é
 *  configurável (configuracoes.medal_labels, ex: "1º Lugar" em vez de "Ouro"). ── */
const MEDAL_STYLE_GOLD          = { color: 'text-yellow-500', dot: 'bg-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-500/10', border: 'border-yellow-200 dark:border-yellow-500/30' };
const MEDAL_STYLE_SILVER        = { color: 'text-slate-400',  dot: 'bg-slate-400',  bg: 'bg-slate-50 dark:bg-slate-800',      border: 'border-slate-300 dark:border-slate-600'      };
const MEDAL_STYLE_BRONZE        = { color: 'text-amber-600',  dot: 'bg-amber-600',  bg: 'bg-amber-50 dark:bg-amber-500/10',   border: 'border-amber-200 dark:border-amber-500/30'   };
// Sem label de "Participação" por padrão — nem todo evento configura essa
// faixa como um prêmio real (ex: Usualdance não tem essa categoria). Traço
// honesto: "abaixo de bronze", sem inventar uma medalha que o produtor não
// ofereceu (mas ainda pode ser customizado via medal_labels.participation).
const MEDAL_STYLE_PARTICIPATION = { color: 'text-slate-500',  dot: 'bg-slate-400',  bg: 'bg-slate-50 dark:bg-white/5',        border: 'border-slate-200 dark:border-white/10'       };

/* ── Helpers ── */
const getMedalByThreshold = (score: number, t: MedalThresholds, labels?: MedalLabels | null) => {
  if (score >= t.gold)   return { ...MEDAL_STYLE_GOLD,          label: resolveMedalLabel('gold', labels) };
  if (score >= t.silver) return { ...MEDAL_STYLE_SILVER,        label: resolveMedalLabel('silver', labels) };
  if (score >= t.bronze) return { ...MEDAL_STYLE_BRONZE,        label: resolveMedalLabel('bronze', labels) };
  return { ...MEDAL_STYLE_PARTICIPATION, label: resolveMedalLabel('participation', labels) };
};

const getMedalByRank = (rank: number, labels?: MedalLabels | null) => {
  if (rank === 0) return { ...MEDAL_STYLE_GOLD,          label: resolveMedalLabel('gold', labels) };
  if (rank === 1) return { ...MEDAL_STYLE_SILVER,        label: resolveMedalLabel('silver', labels) };
  if (rank === 2) return { ...MEDAL_STYLE_BRONZE,        label: resolveMedalLabel('bronze', labels) };
  return { ...MEDAL_STYLE_PARTICIPATION, label: resolveMedalLabel('participation', labels) };
};

const resolveMedal = (score: number, rank: number, system: PremiationSystem, t: MedalThresholds, labels?: MedalLabels | null) =>
  system === 'RANKING' ? getMedalByRank(rank, labels) : getMedalByThreshold(score, t, labels);

/* ── Prêmios especiais no PDF: mesma classificação por nome usada no Telão
 *  de Palco (pages/TelaoControle.tsx) — mantém as 2 telas consistentes sobre
 *  o que é "Ouro/Prata/Bronze" (faixa festival-wide), "Maior nota", prêmio
 *  por deliberação dos jurados ou escolha manual (ex: Voto Popular). ── */
interface SpecialAwardCfg {
  id: string; nome: string; valor?: string; description?: string;
  /** Vencedor(es) já revelado/salvo em Resultados → Premiação (fonte da
   *  verdade compartilhada com Telão e vitrine pública). Quando presente, o
   *  PDF usa esse valor em vez de recalcular — garante que o PDF mostra
   *  EXATAMENTE o que já foi confirmado/publicado, não uma 2ª conta paralela. */
  winner_nome?: string;
  winner_estudio?: string;
  winner_items?: { nome: string; estudio?: string; media?: number }[];
}
// Wrapper local só pra manter os call sites existentes chamando classifyAward(a)
// com o objeto inteiro, em vez de (nome, description) espalhado — a lógica de
// classificação em si vive em utils/awardClassification.ts, compartilhada com
// o Telão (TelaoControle.tsx) e a Premiação (Deliberacoes.tsx).
const classifyAward = (a: SpecialAwardCfg) => classifyAwardShared(a.nome, a.description);

/* ── Component ── */
const ResultsPanel = () => {
  const navigate = useNavigate();
  const [allResults, setAllResults] = useState<GroupedResult[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<'competitiva' | 'avaliada'>('competitiva');
  const [filterGenre,    setFilterGenre]    = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [thresholds, setThresholds] = useState<MedalThresholds>(DEFAULT_THRESHOLDS);
  const [premiationSystem, setPremiationSystem] = useState<PremiationSystem>('THRESHOLD');
  const [medalLabels, setMedalLabels] = useState<MedalLabels | null>(null);
  /** id da coreografia sendo limpa, ou 'all' — null = nada em andamento.
   *  Usado pro botão "Limpar avaliações de teste" (por linha + geral). */
  const [clearing, setClearing] = useState<string | null>(null);
  // Premiação — MESMA fonte que o Telão de Palco e o PDF (winner_nome/
  // winner_items salvos, com fallback pro cálculo ao vivo). Mostrada acima
  // da lista por categoria, que é só ferramenta de auditoria.
  const [awards, setAwards] = useState<SpecialAwardCfg[]>([]);
  const [deliberationWinners, setDeliberationWinners] = useState<Record<string, { nome: string; estudio: string }>>({});

  /* ── Player de áudio único — evita 2 comentários tocando sobrepostos
     quando o produtor clica em "Ouvir Áudio" mais de uma vez (mesmo
     padrão já usado em MyResults.tsx pro inscrito). ── */
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = useCallback((url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (playingAudio === url) {
      setPlayingAudio(null);
      return;
    }
    setPlayingAudio(url);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => setPlayingAudio(null));
    audio.onended = () => setPlayingAudio(null);
  }, [playingAudio]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  /* ── Fetch ── */
  const fetchResults = async () => {
    setLoading(true);
    try {
      const { fetchActiveEventConfig, resolveActiveEventId } = await import('../services/supabase');
      const cfg = await fetchActiveEventConfig('medal_thresholds, premiation_system, medal_labels, regras_avaliacao, premios_especiais');
      setThresholds(cfg?.medal_thresholds ?? DEFAULT_THRESHOLDS);
      setPremiationSystem(cfg?.premiation_system === 'RANKING' ? 'RANKING' : 'THRESHOLD');
      setMedalLabels(cfg?.medal_labels ?? null);
      const regras: any = cfg?.regras_avaliacao ?? {};

      // Premiação (mesma fonte que Telão/PDF) — lê os prêmios salvos +
      // resolve o vencedor por deliberação da banca (tipo 'premio') igual o
      // PDF faz, pra não duplicar essa conta com resultado divergente.
      const rawAwards: any[] = Array.isArray(cfg?.premios_especiais) ? cfg.premios_especiais : [];
      const enabledAwards: SpecialAwardCfg[] = rawAwards
        .filter((a: any) => a && a.enabled !== false && a.id != null)
        .map((a: any) => ({
          id: String(a.id),
          nome: (a.nome ?? a.name ?? 'Prêmio').trim(),
          valor: a.valor ? String(a.valor) : undefined,
          description: a.description ?? a.descricao ?? '',
          winner_nome: a.winner_nome || undefined,
          winner_estudio: a.winner_estudio || undefined,
          winner_items: Array.isArray(a.winner_items) && a.winner_items.length > 0 ? a.winner_items : undefined,
        }));
      setAwards(enabledAwards);
      const eventId = await resolveActiveEventId();
      const premioAwardIds = enabledAwards.filter(a => classifyAward(a).tipo === 'premio').map(a => a.id);
      if (eventId && premioAwardIds.length > 0) {
        const { data: agg } = await supabase
          .from('deliberation_aggregate')
          .select('award_id, registration_id, judge_count')
          .eq('event_id', eventId)
          .in('award_id', premioAwardIds);
        const byAward: Record<string, { registration_id: string; judge_count: number }> = {};
        (agg ?? []).forEach((row: any) => {
          const cur = byAward[row.award_id];
          if (!cur || row.judge_count > cur.judge_count) byAward[row.award_id] = row;
        });
        const winnerRegIds = Object.values(byAward).map(w => w.registration_id);
        const dw: Record<string, { nome: string; estudio: string }> = {};
        if (winnerRegIds.length > 0) {
          const { data: winnerRegs } = await supabase
            .from('registrations')
            .select('id, nome_coreografia, estudio, event_data')
            .in('id', winnerRegIds);
          const regById: Record<string, any> = {};
          (winnerRegs ?? []).forEach((r: any) => { regById[r.id] = r; });
          Object.entries(byAward).forEach(([awardId, w]) => {
            const r = regById[w.registration_id];
            if (r) dw[awardId] = { nome: r.nome_coreografia ?? '—', estudio: (r.estudio?.trim?.() || r.event_data?.estudio_nome || '—') };
          });
        }
        setDeliberationWinners(dw);
      } else {
        setDeliberationWinners({});
      }
      // ?? em vez de || pra default — convenção do projeto (evita zerar peso
      // legítimo). Number.isFinite cobre o caso de valor salvo não-numérico.
      const rawPesoTecnico   = Number(regras.pesoTecnico   ?? 50);
      const rawPesoArtistico = Number(regras.pesoArtistico ?? 50);
      const pesoTecnico   = Number.isFinite(rawPesoTecnico)   ? rawPesoTecnico   : 50;
      const pesoArtistico = Number.isFinite(rawPesoArtistico) ? rawPesoArtistico : 50;

      // Query refatorada: 3 queries simples sem joins PostgREST.
      // Antes usava `registrations!inner(...)` mas PostgREST as vezes nao
      // reconhece a FK e devolve 400. Mais robusto buscar separado e juntar
      // no client. Performance equivalente em escala de festival (~100 evals).
      const { data: evals, error } = await supabase
        .from('evaluations')
        .select('id, registration_id, judge_id, final_weighted_average, scores, audio_url, submitted_at, audit_log')
        .order('submitted_at', { ascending: true });
      if (error) throw error;

      const regIds = Array.from(new Set((evals ?? []).map((e: any) => e.registration_id).filter(Boolean)));
      const judgeIds = Array.from(new Set((evals ?? []).map((e: any) => e.judge_id).filter(Boolean)));

      const [regsRes, judgesRes] = await Promise.all([
        regIds.length > 0
          ? supabase.from('registrations')
              .select('id, nome_coreografia, estudio, estilo_danca, categoria, formato_participacao, subgenero, tipo_apresentacao, status, resultado_publicado')
              .in('id', regIds)
          : Promise.resolve({ data: [], error: null }),
        judgeIds.length > 0
          ? supabase.from('judges').select('id, name, competencias_artisticas').in('id', judgeIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      // Sem isso, uma falha em qualquer uma das 2 queries (RLS, coluna ausente
      // por migration não aplicada, etc.) ficava silenciosa: judgesById/regsById
      // ficavam vazios e toda a tela corrompia (nomes de jurado virando UUID,
      // tipo_juri sempre 'tecnico') sem nenhum erro visível.
      if (regsRes.error) throw regsRes.error;
      if (judgesRes.error) throw judgesRes.error;

      const regsById: Record<string, any> = {};
      (regsRes.data ?? []).forEach((r: any) => { regsById[r.id] = r; });
      const judgesById: Record<string, any> = {};
      (judgesRes.data ?? []).forEach((j: any) => { judgesById[j.id] = j; });

      const grouped: Record<string, any> = {};
      (evals || []).forEach((e: any) => {
        const rid = e.registration_id;
        const reg = regsById[rid];
        if (!reg) return; // evaluations órfãs (registration deletada) ignoradas
        if (!grouped[rid]) {
          grouped[rid] = {
            id: rid,
            nome_coreografia: reg.nome_coreografia ?? '—',
            estudio:          reg.estudio          ?? '—',
            estilo_danca:     reg.estilo_danca      ?? '—',
            categoria:        reg.categoria         ?? '—',
            formato_participacao: reg.formato_participacao ?? '—',
            subgenero:        reg.subgenero          ?? '',
            tipo_apresentacao: reg.tipo_apresentacao ?? 'Competitiva',
            status:           reg.status_pagamento  ?? '—',
            resultado_publicado: reg.resultado_publicado === true,
            scores_all:        [],
            scores_tecnico:    [],
            scores_artistico:  [],
            scores_detail: [],
          };
        }
        // Tipo de júri é por ESTILO, não fixo pro jurado — mesmo jurado pode
        // ser Técnico em K-Pop e Artístico em Danças Urbanas. Checa se o estilo
        // DESTA coreografia está na lista de competencias_artisticas dele.
        const competenciasArtisticas: string[] = judgesById[e.judge_id]?.competencias_artisticas ?? [];
        const tipoJuri: 'tecnico' | 'artistico' =
          isStyleInList(reg.estilo_danca, competenciasArtisticas) ? 'artistico' : 'tecnico';
        if (e.final_weighted_average != null) {
          const val = Number(e.final_weighted_average);
          grouped[rid].scores_all.push(val);
          (tipoJuri === 'artistico' ? grouped[rid].scores_artistico : grouped[rid].scores_tecnico).push(val);
        }
        grouped[rid].scores_detail.push({
          judge:       judgesById[e.judge_id]?.name || e.judge_id,
          judge_id:    e.judge_id,
          tipo_juri:   tipoJuri,
          scores:      e.scores || {},
          final:       e.final_weighted_average,
          audio_url:   e.audio_url,
          submitted_at: e.submitted_at,
          audit_log:   e.audit_log,
        });
      });

      const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

      const built: GroupedResult[] = Object.values(grouped).map((g: any) => {
        const avgTecnico   = g.scores_tecnico.length   ? mean(g.scores_tecnico)   : null;
        const avgArtistico = g.scores_artistico.length ? mean(g.scores_artistico) : null;
        // Combina pelos pesos configurados (padrão patinação artística TES+PCS).
        // Se só um dos dois tipos avaliou, a final usa só o disponível — não
        // penaliza coreografia por falta de banca artística no evento.
        let combined: number;
        if (avgTecnico != null && avgArtistico != null) {
          const totalPeso = pesoTecnico + pesoArtistico;
          combined = totalPeso > 0
            ? (avgTecnico * pesoTecnico + avgArtistico * pesoArtistico) / totalPeso
            : (avgTecnico + avgArtistico) / 2;
        } else {
          combined = avgTecnico ?? avgArtistico ?? 0;
        }
        const hasOutlier = g.scores_all.length >= 2 &&
          (Math.max(...g.scores_all) - Math.min(...g.scores_all)) >= 2.0;
        return {
          ...g,
          average_score: combined,
          average_score_tecnico: avgTecnico,
          average_score_artistico: avgArtistico,
          evaluations_count: g.scores_all.length,
          total_evaluations_count: g.scores_detail.length,
          has_outlier: hasOutlier,
        };
      }).sort((a: any, b: any) => b.average_score - a.average_score);

      setAllResults(built);
    } catch (err) {
      console.error('ResultsPanel error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchResults(); }, []);

  /* ── Derived lists ── */
  const competitiva = useMemo(() => allResults.filter(r => r.tipo_apresentacao !== 'Avaliada'), [allResults]);
  const avaliada    = useMemo(() => allResults.filter(r => r.tipo_apresentacao === 'Avaliada'),  [allResults]);
  const activeList  = activeTab === 'competitiva' ? competitiva : avaliada;

  /* ── Vencedores por prêmio — MESMA lógica/precedência do PDF e do Telão:
     winner_items/winner_nome salvos têm prioridade; sem isso, faixa/maior
     nota recalculam ao vivo da média (festival inteiro, nunca por categoria);
     'premio' usa a deliberação; 'manual' fica pra cerimônia. ── */
  type AwardWinnerRow = { nome: string; estudio?: string; media?: number };
  const awardWinners = useMemo(() => {
    const m = new Map<string, { fonte: string; hint?: string; winners: AwardWinnerRow[] }>();
    const avaliadas = competitiva.filter(x => x.evaluations_count > 0);
    awards.forEach(a => {
      const r = classifyAward(a);
      if (a.winner_items && a.winner_items.length > 0) {
        m.set(a.id, { fonte: 'Salvo em Premiação', winners: a.winner_items });
        return;
      }
      if (a.winner_nome) {
        m.set(a.id, { fonte: 'Salvo em Premiação', winners: [{ nome: a.winner_nome, estudio: a.winner_estudio }] });
        return;
      }
      if (r.tipo === 'faixa') {
        const lo = r.faixa === 'ouro' ? thresholds.gold : r.faixa === 'prata' ? thresholds.silver : thresholds.bronze;
        const hi = r.faixa === 'ouro' ? null : r.faixa === 'prata' ? thresholds.gold : thresholds.silver;
        const naFaixa = avaliadas.filter(x => x.average_score >= lo && (hi == null || x.average_score < hi)).sort((x, y) => y.average_score - x.average_score);
        m.set(a.id, { fonte: `Faixa ${r.faixa} · média dos jurados`, hint: naFaixa.length === 0 ? 'Nenhuma coreografia nesta faixa' : undefined, winners: naFaixa.map(x => ({ nome: x.nome_coreografia, estudio: x.estudio, media: x.average_score })) });
      } else if (r.tipo === 'maior_nota') {
        const top = [...avaliadas].sort((x, y) => y.average_score - x.average_score)[0];
        m.set(a.id, { fonte: 'Maior média do festival', hint: top ? undefined : 'Sem notas ainda', winners: top ? [{ nome: top.nome_coreografia, estudio: top.estudio, media: top.average_score }] : [] });
      } else if (r.tipo === 'premio') {
        const w = deliberationWinners[a.id];
        m.set(a.id, { fonte: 'Deliberação da banca', hint: w ? undefined : 'Sem deliberação — revele em Resultados → Premiação', winners: w ? [w] : [] });
      } else {
        m.set(a.id, { fonte: 'Voto Popular / definido na cerimônia', hint: 'A revelar na cerimônia', winners: [] });
      }
    });
    return m;
  }, [awards, thresholds, competitiva, deliberationWinners]);

  const filtered = useMemo(() => {
    let res = activeList;
    if (search)         res = res.filter(r => r.nome_coreografia.toLowerCase().includes(search.toLowerCase()) || r.estudio.toLowerCase().includes(search.toLowerCase()));
    if (filterGenre)    res = res.filter(r => r.estilo_danca === filterGenre);
    if (filterCategory) res = res.filter(r => r.categoria   === filterCategory);
    return res;
  }, [activeList, search, filterGenre, filterCategory]);

  /* Competitiva grouped by genre + category (each group has its own ranking) */
  const groupedByGenreCat = useMemo(() => {
    const groups: Record<string, GroupedResult[]> = {};
    filtered.forEach(r => {
      const key = `${r.estilo_danca}|${r.categoria}|${r.formato_participacao}|${r.subgenero}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    Object.values(groups).forEach(g => g.sort((a, b) => b.average_score - a.average_score));
    return groups;
  }, [filtered]);

  const genres     = useMemo(() => [...new Set(activeList.map(r => r.estilo_danca))].filter(Boolean).sort(), [activeList]);
  const categories = useMemo(() => [...new Set(activeList.map(r => r.categoria))].filter(Boolean).sort(),   [activeList]);

  /* ── Publish: rank per genre+category ── */
  const handlePublish = async () => {
    setPublishing(true);
    try {
      let firstCheck = true;
      for (const entries of Object.values(groupedByGenreCat)) {
        for (let i = 0; i < entries.length; i++) {
          const { data, error } = await supabase.from('registrations').update({
            classificacao_final: i + 1,
            media_final:         entries[i].average_score,
            resultado_publicado: true,
          }).eq('id', entries[i].id).select('id');
          if (error) throw error;
          // Primeira iteração: aborta cedo se RLS bloqueia silently (0 rows).
          // Lição bug-rls-producer-update-registrations.
          if (firstCheck) {
            if (!data || data.length === 0) {
              throw new Error('Sem permissão pra publicar resultados. Verifique se está logado como produtor do evento.');
            }
            firstCheck = false;
          }
        }
      }
      for (const r of avaliada) {
        const { error } = await supabase.from('registrations').update({
          media_final: null, resultado_publicado: true,
        }).eq('id', r.id);
        if (error) throw error;
      }
      alert('Resultados publicados com sucesso!');
      // Sem isso, o state local fica com resultado_publicado=false (stale) e os
      // botões "Limpar avaliações de teste" continuam habilitados pras coreografias
      // que acabaram de ser publicadas — trava de segurança furada por state obsoleto.
      await fetchResults();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? 'Erro ao publicar resultados.');
    } finally {
      setPublishing(false);
    }
  };

  /* ── Limpar avaliações de teste ──
     Só permite limpar coreografias NÃO publicadas — trava de segurança pra
     nunca apagar nota real já enviada ao inscrito (mesma régua do handlePublish). */
  const handleClearOne = async (entry: GroupedResult) => {
    if (entry.resultado_publicado || entry.total_evaluations_count === 0) return;
    if (!window.confirm(`Apagar ${entry.total_evaluations_count} avaliação${entry.total_evaluations_count !== 1 ? 'ões' : ''} de "${entry.nome_coreografia}"? Irreversível.`)) return;
    setClearing(entry.id);
    try {
      const { error } = await supabase.from('evaluations').delete().eq('registration_id', entry.id);
      if (error) throw error;
      await fetchResults();
    } catch (err: any) {
      alert(err?.message ?? 'Erro ao limpar avaliações.');
    } finally {
      setClearing(null);
    }
  };

  const handleClearAll = async () => {
    const candidates = allResults.filter(r => !r.resultado_publicado && r.total_evaluations_count > 0);
    const totalEvals = candidates.reduce((s, r) => s + r.total_evaluations_count, 0);
    if (totalEvals === 0) {
      alert('Não há avaliações de coreografias não publicadas pra limpar.');
      return;
    }
    if (!window.confirm(`Apagar ${totalEvals} avaliações de ${candidates.length} coreografia${candidates.length !== 1 ? 's' : ''} não publicada${candidates.length !== 1 ? 's' : ''} deste evento? Irreversível.`)) return;
    setClearing('all');
    try {
      const { error } = await supabase.from('evaluations').delete().in('registration_id', candidates.map(r => r.id));
      if (error) throw error;
      await fetchResults();
    } catch (err: any) {
      alert(err?.message ?? 'Erro ao limpar avaliações.');
    } finally {
      setClearing(null);
    }
  };

  /* ── CSV Export ── */
  const exportCSV = () => {
    // "Posição" só faz sentido em modo RANKING (medalha decidida pela colocação
    // dentro do grupo). Em THRESHOLD (nota mínima — caso do Usualdance), a
    // ordem é só de leitura; incluir "1°/2°" sugeriria uma disputa de posição
    // que não é como a medalha é decidida.
    const header = premiationSystem === 'RANKING'
      ? ['Posição', 'Coreografia', 'Estúdio/Grupo', 'Gênero', 'Subgênero', 'Formação', 'Categoria', 'Tipo', 'Média', 'Nº Jurados', 'Medalha', 'Outlier']
      : ['Coreografia', 'Estúdio/Grupo', 'Gênero', 'Subgênero', 'Formação', 'Categoria', 'Tipo', 'Média', 'Nº Jurados', 'Medalha', 'Outlier'];
    const rows: (string | number)[][] = [header];
    Object.entries(groupedByGenreCat).forEach(([, entries]) => {
      entries.forEach((r, i) => {
        const medal = resolveMedal(r.average_score, i, premiationSystem, thresholds, medalLabels);
        const base = [r.nome_coreografia, r.estudio, r.estilo_danca, r.subgenero, r.formato_participacao, r.categoria, r.tipo_apresentacao, r.average_score.toFixed(2), r.evaluations_count, medal.label, r.has_outlier ? 'Sim' : ''];
        rows.push(premiationSystem === 'RANKING' ? [`${i + 1}°`, ...base] : base);
      });
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `resultados-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  /* ── PDF Export ── */
  const exportPDF = async () => {
    setExportingPdf(true);
    try {
      // Resolve evento ativo pra buscar nome + ano da edicao
      const { resolveActiveEventId } = await import('../services/supabase');
      const eventId = await resolveActiveEventId();
      let eventName = 'Apuração Final';
      let editionYear = new Date().getFullYear();
      if (eventId) {
        const { data: ev } = await supabase
          .from('events')
          .select('name, edition_year, start_date')
          .eq('id', eventId)
          .maybeSingle();
        if (ev) {
          eventName = ev.name || eventName;
          editionYear = ev.edition_year ?? (ev.start_date ? new Date(ev.start_date).getFullYear() : editionYear);
        }
      }

      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Capa
      doc.setFillColor(255, 0, 104);
      doc.rect(0, 0, pageWidth, 50, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(28);
      doc.setFont('helvetica', 'bold');
      doc.text('Apuração Final', pageWidth / 2, 25, { align: 'center' });
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text(eventName.toUpperCase(), pageWidth / 2, 35, { align: 'center' });
      doc.text(`Edição ${editionYear}`, pageWidth / 2, 42, { align: 'center' });

      doc.setTextColor(40, 40, 40);
      doc.setFontSize(10);
      doc.text(`Total avaliadas: ${allResults.length}`, 20, 65);
      doc.text(`Melhor média: ${bestScore > 0 ? bestScore.toFixed(2) : '—'}`, 20, 71);
      doc.text(`Modo de premiação: ${premiationSystem === 'RANKING' ? 'Por colocação (top 3 por categoria)' : 'Por nota mínima'}`, 20, 77);

      let cursorY = 95;

      // ── Premiação — MESMA fonte/estrutura do Telão de Palco (TelaoControle.tsx)
      // e da tela Resultados → Premiação: 1 lista por prêmio, festival inteiro
      // (não dividida por categoria/estilo). É o resultado OFICIAL — vem
      // primeiro no PDF. O detalhamento por categoria/estilo (rankings
      // informativos) vem depois, claramente separado, pra não confundir com
      // a premiação de verdade.
      if (eventId) {
        const { fetchActiveEventConfig } = await import('../services/supabase');
        const specialCfg = await fetchActiveEventConfig('premios_especiais');
        const rawAwards: any[] = Array.isArray(specialCfg?.premios_especiais) ? specialCfg.premios_especiais : [];
        const awards: SpecialAwardCfg[] = rawAwards
          .filter((a: any) => a && a.enabled !== false && a.id != null)
          .map((a: any) => ({
            id: String(a.id),
            nome: (a.nome ?? a.name ?? 'Prêmio').trim(),
            valor: a.valor ? String(a.valor) : undefined,
            description: a.description ?? a.descricao ?? '',
            winner_nome: a.winner_nome || undefined,
            winner_estudio: a.winner_estudio || undefined,
            winner_items: Array.isArray(a.winner_items) && a.winner_items.length > 0 ? a.winner_items : undefined,
          }));

        if (awards.length > 0) {
          // Winner por deliberação dos jurados (tipo 'premio') vem da mesma
          // view que alimenta /deliberacoes e o Telão — só busca se necessário.
          const premioAwardIds = awards.filter(a => classifyAward(a).tipo === 'premio').map(a => a.id);
          let deliberationWinners: Record<string, { nome: string; estudio: string }> = {};
          if (premioAwardIds.length > 0) {
            const { data: agg } = await supabase
              .from('deliberation_aggregate')
              .select('award_id, registration_id, judge_count')
              .eq('event_id', eventId)
              .in('award_id', premioAwardIds);
            const byAward: Record<string, { registration_id: string; judge_count: number }> = {};
            (agg ?? []).forEach((row: any) => {
              const cur = byAward[row.award_id];
              if (!cur || row.judge_count > cur.judge_count) byAward[row.award_id] = row;
            });
            const winnerRegIds = Object.values(byAward).map(w => w.registration_id);
            if (winnerRegIds.length > 0) {
              const { data: winnerRegs } = await supabase
                .from('registrations')
                .select('id, nome_coreografia, estudio, event_data')
                .in('id', winnerRegIds);
              const regById: Record<string, any> = {};
              (winnerRegs ?? []).forEach((r: any) => { regById[r.id] = r; });
              Object.entries(byAward).forEach(([awardId, w]) => {
                const r = regById[w.registration_id];
                if (r) {
                  deliberationWinners[awardId] = {
                    nome: r.nome_coreografia ?? '—',
                    estudio: (r.estudio?.trim?.() || r.event_data?.estudio_nome || '—'),
                  };
                }
              });
            }
          }

          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 0, 104);
          doc.text('Premiação', 20, cursorY);
          doc.setTextColor(40, 40, 40);
          cursorY += 10;

          const fmtValor = (v?: string) => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '';

          const awardRows = awards.map(a => {
            const r = classifyAward(a);
            let vencedor = '—';
            // Fonte primária: o que já foi salvo em Premiação (mesmo dado que o
            // Telão revela e a vitrine pública mostra) — o PDF só recalcula se o
            // produtor ainda não clicou "Salvar vencedores" pra esse prêmio.
            if (a.winner_items && a.winner_items.length > 0) {
              vencedor = a.winner_items.map(w => `${w.nome}${w.media != null ? ` (${w.media.toFixed(2)})` : ''}`).join('\n');
            } else if (a.winner_nome) {
              vencedor = a.winner_estudio ? `${a.winner_nome} · ${a.winner_estudio}` : a.winner_nome;
            } else if (r.tipo === 'faixa') {
              const lo = r.faixa === 'ouro' ? thresholds.gold : r.faixa === 'prata' ? thresholds.silver : thresholds.bronze;
              const hi = r.faixa === 'ouro' ? null : r.faixa === 'prata' ? thresholds.gold : thresholds.silver;
              const naFaixa = competitiva
                .filter(x => x.evaluations_count > 0 && x.average_score >= lo && (hi == null || x.average_score < hi))
                .sort((x, y) => y.average_score - x.average_score);
              // Uma coreografia por linha (autotable respeita \n) — a faixa Ouro
              // pode ter muitas coreografias; juntar tudo com "; " virava um
              // parágrafo ilegível numa célula só.
              vencedor = naFaixa.length > 0
                ? naFaixa.map(x => `${x.nome_coreografia} (${x.average_score.toFixed(2)})`).join('\n')
                : 'Nenhuma coreografia na faixa';
            } else if (r.tipo === 'maior_nota') {
              const top = competitiva.filter(x => x.evaluations_count > 0).sort((x, y) => y.average_score - x.average_score)[0];
              vencedor = top ? `${top.nome_coreografia} (${top.average_score.toFixed(2)})` : '—';
            } else if (r.tipo === 'premio') {
              // Prêmio de deliberação da banca. Sem jargão "deliberação pendente"
              // quando não houve deliberação — o produtor revela na mão no telão.
              const w = deliberationWinners[a.id];
              vencedor = w ? `${w.nome} · ${w.estudio}` : 'A revelar na cerimônia';
            } else {
              vencedor = 'A revelar na cerimônia (Voto Popular)';
            }
            return [a.nome, fmtValor(a.valor) || '—', vencedor];
          });

          autoTable(doc, {
            head: [['Prêmio', 'Valor', 'Vencedor']],
            body: awardRows,
            startY: cursorY,
            theme: 'striped',
            headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 9, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9, textColor: 40 },
            alternateRowStyles: { fillColor: [248, 248, 250] },
            columnStyles: {
              0: { cellWidth: 45, fontStyle: 'bold' },
              1: { cellWidth: 25, halign: 'center' },
            },
            margin: { left: 20, right: 20 },
          });

          cursorY = (doc as any).lastAutoTable.finalY + 10;
        }
      }

      // ── Detalhamento por gênero e categoria — ranking informativo (não é a
      // premiação oficial, que vem acima). Útil pra ver colocação relativa
      // dentro de cada estilo/categoria, mas a medalha de cada linha ainda
      // segue o mesmo threshold festival-wide (não é medalha "por categoria").
      const groups = Object.entries(groupedByGenreCat);
      if (groups.length > 0) {
        doc.addPage();
        cursorY = 20;
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 0, 104);
        doc.text('Detalhamento por Estilo e Categoria', 20, cursorY);
        doc.setTextColor(40, 40, 40);
        cursorY += 6;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(130, 130, 130);
        doc.text('Ranking informativo — a Premiação oficial está nas páginas anteriores.', 20, cursorY);
        doc.setTextColor(40, 40, 40);
        cursorY += 6;
        if (outlierCount > 0) {
          doc.setFontSize(9);
          doc.setTextColor(200, 100, 0);
          // "!" em vez de "⚠" — o Helvetica embutido do jsPDF (sem fonte custom)
          // não tem esse glifo Unicode e renderizava como "&" no PDF gerado.
          doc.text(`! ${outlierCount} ${outlierCount === 1 ? 'coreografia com outlier' : 'coreografias com outlier'} (divergência >= 2.0 entre jurados) — marcadas na coluna Outlier de cada tabela abaixo`, 20, cursorY);
          doc.setTextColor(40, 40, 40);
          cursorY += 6;
        }
        cursorY += 4;
      }
      // "Pos." (1°/2°/3°) só faz sentido em modo RANKING, onde a colocação
      // decide a medalha. Em THRESHOLD (nota mínima) a ordem é só de leitura —
      // mostrar "1°/2°" sugeriria uma disputa de posição que não é como a
      // medalha é decidida (2 coreografias podem empatar em Ouro, por ex.).
      const showPos = premiationSystem === 'RANKING';

      for (const [key, entries] of groups) {
        // Quebra de pagina se nao cabe header + ao menos 2 linhas
        if (cursorY > pageHeight - 50) {
          doc.addPage();
          cursorY = 20;
        }

        // "K-Pop|Livre|Trio|Cover" → título é o ESTILO (+ subgênero/modalidade,
        // quando existir — ex: Cover vs Creative do K-Pop são disputas
        // separadas), legenda pequena abaixo esclarece FORMAÇÃO e CATEGORIA —
        // o "|" cru confundia porque nada indicava o que cada lado significava.
        const [estiloKey, categoriaKey, formatoKey, subgeneroKey] = key.split('|');

        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 0, 104);
        doc.text(subgeneroKey ? `${estiloKey || '—'} · ${subgeneroKey}` : (estiloKey || '—'), 20, cursorY);
        cursorY += 4.5;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(130, 130, 130);
        doc.text(`ESTILO · FORMAÇÃO · CATEGORIA: ${(formatoKey || '—').toUpperCase()} · ${(categoriaKey || '—').toUpperCase()}`, 20, cursorY);
        doc.setTextColor(40, 40, 40);
        cursorY += 4;

        const tableData = entries.map((r, i) => {
          const medal = resolveMedal(r.average_score, i, premiationSystem, thresholds, medalLabels);
          const row = [
            r.nome_coreografia,
            r.estudio,
            r.average_score.toFixed(2),
            String(r.evaluations_count),
            medal.label,
            r.has_outlier ? 'Sim' : '',
          ];
          return showPos ? [`${i + 1}°`, ...row] : row;
        });

        const head = showPos
          ? ['Pos.', 'Coreografia', 'Estúdio/Grupo', 'Média', 'Jurados', 'Medalha', 'Outlier']
          : ['Coreografia', 'Estúdio/Grupo', 'Média', 'Jurados', 'Medalha', 'Outlier'];
        const off = showPos ? 1 : 0;

        autoTable(doc, {
          head: [head],
          body: tableData,
          startY: cursorY,
          theme: 'striped',
          headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 9, fontStyle: 'bold' },
          bodyStyles: { fontSize: 9, textColor: 40 },
          alternateRowStyles: { fillColor: [248, 248, 250] },
          columnStyles: {
            ...(showPos ? { 0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' } } : {}),
            [2 + off]: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
            [3 + off]: { cellWidth: 18, halign: 'center' },
            [4 + off]: { cellWidth: 24, halign: 'center' },
            [5 + off]: { cellWidth: 16, halign: 'center', textColor: [200, 100, 0], fontStyle: 'bold' },
          },
          margin: { left: 20, right: 20 },
        });

        cursorY = (doc as any).lastAutoTable.finalY + 10;
      }

      // Rodape em todas paginas
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(140, 140, 140);
        const dateStr = `${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR').slice(0, 5)}`;
        doc.text(`Gerado em ${dateStr} • CoreoHub`, 20, pageHeight - 8);
        doc.text(`Página ${i} de ${totalPages}`, pageWidth - 20, pageHeight - 8, { align: 'right' });
      }

      const slug = (eventName || 'evento')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
      doc.save(`apuracao-${editionYear}-${slug}.pdf`);
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      alert('Falha ao gerar PDF: ' + (err instanceof Error ? err.message : 'desconhecido'));
    } finally {
      setExportingPdf(false);
    }
  };

  /* ── Stats ── */
  const outlierCount = competitiva.filter(r => r.has_outlier).length;
  const pendingCount = allResults.filter(r => r.evaluations_count === 0).length;
  const bestScore    = competitiva.length ? Math.max(...competitiva.map(r => r.average_score)) : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
            Apuração <span className="text-[#ff0068]">Final</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Ranking por gênero e categoria · Feedbacks da Mostra Avaliada
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={fetchResults} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all" title="Recarregar">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={exportCSV}
            disabled={competitiva.length === 0}
            className="px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-600 dark:text-slate-300 font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-white/10 transition-all disabled:opacity-40 flex items-center gap-2"
          >
            <Download size={14} /> Exportar CSV
          </button>
          <button
            onClick={exportPDF}
            disabled={exportingPdf || competitiva.length === 0}
            className="px-4 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-700 dark:hover:bg-slate-200 transition-all disabled:opacity-40 flex items-center gap-2"
            title="Gerar PDF formatado com ranking por categoria"
          >
            {exportingPdf
              ? <><Loader2 size={14} className="animate-spin" /> Gerando...</>
              : <><FileDown size={14} /> Exportar PDF</>}
          </button>
          <button
            onClick={handleClearAll}
            disabled={clearing !== null || allResults.every(r => r.resultado_publicado || r.total_evaluations_count === 0)}
            className="px-4 py-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-all disabled:opacity-40 flex items-center gap-2"
            title="Apaga avaliações de coreografias ainda não publicadas — use pra zerar testes antes do evento real"
          >
            {clearing === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Limpar avaliações de teste
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing || allResults.length === 0}
            className="px-5 py-3 bg-[#ff0068] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#d4005a] transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-50 flex items-center gap-2"
          >
            {publishing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Publicar Resultados
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: <BarChart3 size={18} className="text-[#ff0068]" />, label: 'Total Avaliadas',  value: allResults.length,              valueColor: 'text-slate-900 dark:text-white' },
          { icon: <Trophy    size={18} className="text-yellow-500" />, label: 'Melhor Média',    value: bestScore > 0 ? bestScore.toFixed(2) : '—', valueColor: 'text-yellow-500' },
          { icon: <AlertTriangle size={18} className="text-amber-500" />, label: 'Outliers',     value: outlierCount, valueColor: outlierCount > 0 ? 'text-amber-500' : 'text-slate-400' },
          { icon: <AlertCircle   size={18} className="text-rose-500"  />, label: 'Sem Avaliação', value: pendingCount, valueColor: pendingCount  > 0 ? 'text-rose-500'  : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-center shadow-sm">
            <div className="flex justify-center mb-1.5">{s.icon}</div>
            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">{s.label}</p>
            <p className={`text-xl font-black mt-0.5 ${s.valueColor}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Outlier global warning */}
      {outlierCount > 0 && (
        <div className="flex items-start gap-3 px-5 py-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
            <strong>{outlierCount} coreografia{outlierCount > 1 ? 's' : ''}</strong> com divergência alta entre jurados (≥ 2,0 pontos de diferença). Verifique antes de publicar — estão marcadas com <span className="italic">Outlier</span>.
          </p>
        </div>
      )}

      {/* Atalho pra Premiação — só um link, não duplica a tela. A lógica de
          vencedor por prêmio (winnersByAward) já existe completa em
          Deliberacoes.tsx; aqui só usa a mesma fonte pra contar quantos já
          têm vencedor definido, sem reimplementar a tela inteira aqui dentro. */}
      {awards.length > 0 && (
        <button onClick={() => navigate('/premiacao')}
          className="w-full flex items-center justify-between gap-3 px-5 py-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl hover:bg-slate-50 dark:hover:bg-white/10 transition-all text-left">
          <div className="flex items-center gap-3 min-w-0">
            <Trophy size={18} className="text-[#ff0068] shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Premiação</p>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest truncate">
                {awards.filter(a => (awardWinners.get(a.id)?.winners.length ?? 0) > 0).length} de {awards.length} prêmios com vencedor definido
              </p>
            </div>
          </div>
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#ff0068]">
            Ver premiação completa <ChevronRight size={12} />
          </span>
        </button>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-white/10">
        {([
          { id: 'competitiva', label: `Mostra Competitiva (${competitiva.length})` },
          { id: 'avaliada',    label: `Mostra Avaliada — Feedbacks (${avaliada.length})` },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setFilterGenre(''); setFilterCategory(''); setSearch(''); }}
            className={`px-5 py-3 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-[#ff0068] text-[#ff0068]'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
          <input
            type="text" placeholder="Buscar coreografia ou estúdio..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white outline-none focus:border-[#ff0068]/50"
          />
        </div>
        <select value={filterGenre} onChange={e => setFilterGenre(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white outline-none">
          <option value="">Todos os Gêneros</option>
          {genres.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white outline-none">
          <option value="">Todas as Categorias</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="p-16 flex flex-col items-center gap-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl">
          <Loader2 size={36} className="text-[#ff0068] animate-spin" />
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Apurando...</p>
        </div>

      ) : activeTab === 'competitiva' ? (

        /* ══ COMPETITIVA: grouped ranking per genre + category ══ */
        <div className="space-y-6">
          {Object.entries(groupedByGenreCat).length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl">
              <Trophy size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              {/* Mensagem específica quando o festival é Avaliada-only:
                  competitiva.length === 0 mas avaliada.length > 0 indica que
                  o produtor configurou só Mostra Avaliada. Sem isso, parecia
                  "nenhum resultado" genérico e o produtor não entendia. */}
              {competitiva.length === 0 && avaliada.length > 0 ? (
                <>
                  <p className="text-sm font-black uppercase tracking-widest text-slate-400">Festival sem competição</p>
                  <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                    Este festival é exclusivo Mostra Avaliada — não há ranking ou premiação. Veja os feedbacks dos jurados na aba <strong>Mostra Avaliada</strong>.
                  </p>
                </>
              ) : (
                <p className="text-sm font-black uppercase tracking-widest text-slate-400">Nenhum resultado encontrado</p>
              )}
            </div>
          ) : (
            Object.entries(groupedByGenreCat).map(([key, entries]) => {
              const [genre, category, formato, subgenero] = key.split('|');
              // Escala mista: nesse grupo, algumas coreografias têm nota combinada
              // (Técnico+Artístico) e outras só de um lado — não são comparáveis
              // na mesma régua se os pesos configurados não forem 50/50.
              const scaleKinds = new Set(
                entries
                  .filter(e => e.evaluations_count > 0)
                  .map(e =>
                    e.average_score_tecnico != null && e.average_score_artistico != null ? 'combined'
                    : e.average_score_tecnico != null ? 'tecnico'
                    : e.average_score_artistico != null ? 'artistico'
                    : 'none'
                  )
              );
              const hasMixedScale = scaleKinds.size > 1;
              return (
                <div key={key} className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-3 px-5 py-3.5 bg-slate-50 dark:bg-white/[0.03] border-b border-slate-100 dark:border-white/10">
                    <Trophy size={14} className="text-[#ff0068] shrink-0" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">
                      {genre}{subgenero ? ` · ${subgenero}` : ''} · {formato && formato !== '—' ? `${formato} · ` : ''}{category}
                    </span>
                    {hasMixedScale && (
                      <span
                        className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-full text-[7px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400"
                        title="Coreografias deste grupo foram avaliadas por combinações diferentes de jurado Técnico/Artístico — as notas podem não estar na mesma régua se os pesos não forem 50/50."
                      >
                        <AlertTriangle size={8} /> Escalas diferentes
                      </span>
                    )}
                    <span className="ml-auto text-[8px] font-black text-slate-400 uppercase tracking-widest">
                      {entries.length} coreografia{entries.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {entries.map((entry, idx) => {
                      const medal  = resolveMedal(entry.average_score, idx, premiationSystem, thresholds, medalLabels);
                      const isOpen = expandedId === entry.id;
                      return (
                        <div key={entry.id}>
                          <div
                            className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                            onClick={() => setExpandedId(isOpen ? null : entry.id)}
                          >
                            {/* Position badge — só numera colocação em modo RANKING. Em
                                THRESHOLD (nota mínima) a ordem na lista é só de leitura,
                                não decide a medalha, então não mostra "1°/2°". */}
                            {premiationSystem === 'RANKING' ? (
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                                idx === 0 ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                                idx === 1 ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300' :
                                idx === 2 ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-500' :
                                'bg-slate-50 dark:bg-white/5 text-slate-400'
                              }`}>
                                {idx + 1}°
                              </div>
                            ) : (
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${medal.bg} ${medal.border} border`}>
                                <span className={`w-2.5 h-2.5 rounded-full ${medal.dot}`} />
                              </div>
                            )}

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                                  {entry.nome_coreografia}
                                </p>
                                {entry.has_outlier && (
                                  <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-full text-[7px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                                    <AlertTriangle size={8} /> Outlier
                                  </span>
                                )}
                              </div>
                              <p className="text-[9px] text-slate-500 uppercase font-bold">
                                {entry.estudio} · {entry.evaluations_count} jurado{entry.evaluations_count !== 1 ? 's' : ''}
                              </p>
                            </div>

                            {/* Medal + Score */}
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${medal.bg} ${medal.color} ${medal.border}`}>
                                {medal.label}
                              </span>
                              <div className="text-right">
                                <p className="text-xl font-black italic tabular-nums leading-none text-slate-900 dark:text-white">
                                  {entry.average_score.toFixed(2)}
                                </p>
                                {/* Breakdown Técnico/Artístico — só quando o evento tem os 2 tipos de jurado avaliando esta coreografia */}
                                {entry.average_score_tecnico != null && entry.average_score_artistico != null && (
                                  <p className="text-[7px] font-black uppercase tracking-widest text-slate-400 mt-0.5 whitespace-nowrap">
                                    <span className="text-sky-500">T {entry.average_score_tecnico.toFixed(1)}</span>
                                    {' · '}
                                    <span className="text-violet-500">A {entry.average_score_artistico.toFixed(1)}</span>
                                  </p>
                                )}
                              </div>
                              {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                            </div>
                          </div>

                          {/* Expanded: scores + audit per judge */}
                          {isOpen && (
                            <div className="px-5 pb-5 pt-2 space-y-2 bg-slate-50 dark:bg-white/[0.02]">
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                                  Notas por jurado · Trilha de auditoria
                                </p>
                                <button
                                  onClick={e => { e.stopPropagation(); handleClearOne(entry); }}
                                  disabled={entry.resultado_publicado || clearing !== null}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
                                  title={entry.resultado_publicado ? 'Resultado já publicado — não pode limpar' : 'Apagar avaliações desta coreografia'}
                                >
                                  {clearing === entry.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                                  Limpar
                                </button>
                              </div>
                              {entry.scores_detail.map((sd, i) => {
                                const feedbackNote = sd.audit_log?.feedback_text;
                                return (
                                <div key={i} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{sd.judge}</p>
                                        <span className={`px-1 py-0.5 rounded-full text-[6px] font-black uppercase tracking-widest shrink-0 ${
                                          sd.tipo_juri === 'artistico'
                                            ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                                            : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                        }`}>
                                          {sd.tipo_juri === 'artistico' ? 'Artístico' : 'Técnico'}
                                        </span>
                                      </div>
                                      <p className="text-[8px] text-slate-400">
                                        {sd.submitted_at ? new Date(sd.submitted_at).toLocaleString('pt-BR') : '—'}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {sd.audio_url && (
                                        <button
                                          onClick={e => { e.stopPropagation(); playAudio(sd.audio_url!); }}
                                          className={`p-1.5 rounded-lg transition-all ${
                                            playingAudio === sd.audio_url
                                              ? 'bg-violet-500 text-white'
                                              : 'bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-500/20'
                                          }`}
                                          title={playingAudio === sd.audio_url ? 'Pausar áudio do jurado' : 'Ouvir áudio do jurado'}
                                        >
                                          <Volume2 size={12} />
                                        </button>
                                      )}
                                      <span className="text-base font-black italic tabular-nums text-slate-900 dark:text-white">
                                        {sd.final != null ? Number(sd.final).toFixed(2) : '—'}
                                      </span>
                                    </div>
                                  </div>
                                  {/* Per-criterion scores */}
                                  {Object.keys(sd.scores).length > 0 && (
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                      {Object.entries(sd.scores).map(([k, v]) => (
                                        <span key={k} className="text-[9px] text-slate-500 dark:text-slate-400">
                                          <span className="font-bold text-slate-700 dark:text-slate-300">{k}</span>: {Number(v).toFixed(1)}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {feedbackNote && (
                                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 mt-2 pt-2">
                                      {feedbackNote}
                                    </p>
                                  )}
                                </div>
                              );})}
                              {/* Outlier alert */}
                              {entry.has_outlier && (
                                <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                                  <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                                  <p className="text-[9px] font-bold text-amber-700 dark:text-amber-400">
                                    Divergência alta entre jurados (diferença ≥ 2,0 pontos). Verifique antes de publicar.
                                  </p>
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
            })
          )}
        </div>

      ) : (

        /* ══ AVALIADA: feedback list ══ */
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <FileText size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-black uppercase tracking-widest text-slate-400">Nenhum feedback registrado</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {filtered.map(entry => {
                const isOpen = expandedId === entry.id;
                return (
                  <div key={entry.id}>
                    <div
                      className="flex items-center gap-3 px-5 py-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      onClick={() => setExpandedId(isOpen ? null : entry.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">{entry.nome_coreografia}</p>
                        <p className="text-[9px] text-slate-500 uppercase font-bold">{entry.estudio} · {entry.categoria} · {entry.estilo_danca}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-1 bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20 rounded-full text-[8px] font-black uppercase tracking-widest">
                          {entry.total_evaluations_count} feedback{entry.total_evaluations_count !== 1 ? 's' : ''}
                        </span>
                        {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="px-5 pb-5 pt-2 space-y-3 bg-slate-50 dark:bg-white/[0.02]">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Feedbacks dos jurados</p>
                          <button
                            onClick={e => { e.stopPropagation(); handleClearOne(entry); }}
                            disabled={entry.resultado_publicado || clearing !== null}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
                            title={entry.resultado_publicado ? 'Resultado já publicado — não pode limpar' : 'Apagar feedbacks desta coreografia'}
                          >
                            {clearing === entry.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                            Limpar
                          </button>
                        </div>
                        {entry.scores_detail.map((sd, i) => {
                          const feedbackNote = sd.audit_log?.feedback_text;
                          return (
                            <div key={i} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl px-4 py-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{sd.judge}</p>
                                  <p className="text-[8px] text-slate-400">
                                    {sd.submitted_at ? new Date(sd.submitted_at).toLocaleString('pt-BR') : '—'}
                                  </p>
                                </div>
                                {sd.audio_url && (
                                  <button
                                    onClick={e => { e.stopPropagation(); playAudio(sd.audio_url!); }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black transition-all ${
                                      playingAudio === sd.audio_url
                                        ? 'bg-violet-500 text-white'
                                        : 'bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-500/20'
                                    }`}
                                  >
                                    <Volume2 size={11} /> {playingAudio === sd.audio_url ? 'Pausar' : 'Ouvir Áudio'}
                                  </button>
                                )}
                              </div>
                              {feedbackNote && (
                                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-2">
                                  {feedbackNote}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ResultsPanel;
