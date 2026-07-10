import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, StopCircle, Check, Loader2, Delete,
  Music, ChevronRight, Star, Trophy, X,
  AlertCircle, ChevronDown, Lock, Unlock,
  Shield, AlertTriangle, ClipboardCheck,
  Zap, Crown, Users, Award, Shirt,
  Monitor, Tablet, Smartphone, LogOut,
  MoreVertical, FastForward, MessageSquare,
  ChevronLeft, List, Search,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { isStyleInList } from '../utils/styleMatch';
import { useT, useLocale, setLocale } from '../hooks/useT';
import type { JudgeDictKey } from '../i18n/judge-pt';
import { readJudgeSession, clearJudgeSession } from './JudgeLogin';
import { fetchTerminalData, fetchPreviousEvaluations, submitEvaluation as submitEvaluationViaApi, uploadAudio as uploadAudioViaApi } from '../services/judgeApi';
import { enqueueEvaluation, fetchTerminalDataSWR, fetchPreviousEvaluationsSWR } from '../services/judgeApiOffline';
import OfflineStatusBadge from '../components/OfflineStatusBadge';

/** Maps the canonical PT criterion name (used as score key in DB) to a dict key. */
const DEFAULT_CRITERION_KEYS: Record<string, JudgeDictKey> = {
  'Performance':  'criterion.performance',
  'Criatividade': 'criterion.criatividade',
  'Musicalidade': 'criterion.musicalidade',
  'Técnica':      'criterion.tecnica',
  'Figurino':     'criterion.figurino',
  'Coreografia':  'criterion.coreografia',
};

/* ── Types ── */
interface CriterionWithWeight { name: string; peso: number; displayName?: string; }

interface EvalRules {
  criterios: CriterionWithWeight[];
  desempate: string[];
}
interface EvalConfig {
  globalRules: EvalRules;
  overrides: Record<string, EvalRules | null>;
  /** Critério do Júri Artístico — ignora override por gênero. */
  artisticRules?: EvalRules | null;
  pesoTecnico?: number;
  pesoArtistico?: number;
}

type ScoreScale = 'BASE_10' | 'BASE_100';

/* ── Special award type (mirrors AccountSettings) ── */
interface SpecialAward {
  id: string;
  name: string;
  enabled: boolean;
  isTemplate: boolean;
  formation: string;  // 'TODOS' | formation name (Solo/Duo/Trio/Grupo)
  /** Tag de gênero ('TODOS' | Ballet/Jazz/Hip Hop/...). Filtro: prêmio só
   *  aparece na deliberação de coreografias do mesmo gênero. */
  genre: string;
  description: string;
  /** Valor monetário do prêmio (R$ decimal). Opcional. Terminal NÃO exibe
   *  por enquanto (minimalismo — jurado avalia técnica, não peso do prêmio).
   *  Campo aqui só pra TS compilar e config persistir. */
  valor?: number;
}

const AWARD_ICON_MAP: Record<string, React.ElementType> = {
  tpl_bailarino:  Star,
  tpl_revelacao:  Zap,
  tpl_coreografo: Crown,
  tpl_grupo:      Users,
};

const resolveAwardIcon = (award: SpecialAward): React.ElementType => {
  if (AWARD_ICON_MAP[award.id]) return AWARD_ICON_MAP[award.id];
  const n = award.name.toLowerCase();
  if (n.includes('figurino') || n.includes('roupa')) return Shirt;
  if (n.includes('grupo') || n.includes('conjunto'))  return Users;
  if (n.includes('bailarino'))                        return Star;
  if (n.includes('revelação') || n.includes('revelacao')) return Zap;
  if (n.includes('coreógrafo') || n.includes('coreografo')) return Crown;
  return Award;
};

/** Returns true if the award applies to the given formation AND genre.
 *  Backward-compat: prêmios antigos sem `genre` são tratados como 'TODOS'. */
const awardMatches = (award: SpecialAward, formation: string, genre?: string | null): boolean => {
  if (!award.enabled) return false;
  const norm = (s: string) => s.toLowerCase().trim();
  // Formation match: 'TODOS' ou nome exato
  if (award.formation !== 'TODOS' && norm(award.formation) !== norm(formation)) return false;
  // Genre match: 'TODOS' (ou ausente em legacy) ou nome exato. Se a
  // apresentação não tem gênero definido, mostra só os 'TODOS'.
  const awardGenre = award.genre ?? 'TODOS';
  if (awardGenre === 'TODOS') return true;
  if (!genre) return false;
  return norm(awardGenre) === norm(genre);
};

/** @deprecated mantém compat com chamadas antigas. Prefira awardMatches(award, formation, genre). */
const awardMatchesFormation = (award: SpecialAward, formation: string): boolean =>
  awardMatches(award, formation, null);

/* ── Constants ── */
const DEFAULT_CRITERIA: CriterionWithWeight[] = [
  { name: 'Performance',   peso: 2 },
  { name: 'Criatividade',  peso: 2 },
  { name: 'Musicalidade',  peso: 2 },
  { name: 'Técnica',       peso: 2 },
  { name: 'Figurino',      peso: 2 },
];

// Fallback do Júri Artístico quando o evento ainda não salvou
// configuracoes.regras_avaliacao.artisticRules (produtor nunca abriu
// AccountSettings → Avaliação após marcar um jurado como Artístico).
// NÃO usa DEFAULT_CRITERIA — ele inclui "Técnica", que é exatamente o que
// o Júri Artístico não deveria avaliar.
const DEFAULT_ARTISTIC_CRITERIA: CriterionWithWeight[] = [
  { name: 'Impacto Cênico',  peso: 2 },
  { name: 'Interpretação',   peso: 2 },
  { name: 'Impressão Geral', peso: 1 },
];

/* ── Score scale helpers ── */
const SCALE_MAX: Record<ScoreScale, number> = { BASE_10: 10, BASE_100: 100 };

/** Returns true if `raw` string is a valid partial/complete score for the given scale.
 *  BASE_10  → 1 decimal max (ex: 9.8). Antes aceitava 9.88 — bug.
 *  BASE_100 → inteiro 0-100 sem decimais. */
const isValidScoreStr = (raw: string, scale: ScoreScale): boolean => {
  if (scale === 'BASE_100') return /^\d{0,3}$/.test(raw) && (raw === '' || parseInt(raw, 10) <= 100);
  // BASE_10: aceita "9", "9.", "9.8", "10", "10.0" — sempre 1 decimal max
  return /^\d{0,2}(\.\d{0,1})?$/.test(raw) && (raw === '' || parseFloat(raw) <= 10);
};

/* ── Demo data for testing without approved registrations ── */
const DEMO_SCHEDULE = [
  {
    id: 'demo-1',
    nome_coreografia: 'Ritmo da Rua',
    estudio: 'Estúdio Move',
    estilo_danca: 'Danças Urbanas',
    categoria: 'Juvenil',
    formacao: 'Solo',
    ordem_apresentacao: 1,
    status: 'APROVADA',
  },
  {
    id: 'demo-2',
    nome_coreografia: 'Lago dos Cisnes Moderno',
    estudio: 'Ballet Clássico SP',
    estilo_danca: 'Clássico',
    categoria: 'Adulto',
    formacao: 'Grupo',
    ordem_apresentacao: 2,
    status: 'APROVADA',
  },
  {
    id: 'demo-3',
    nome_coreografia: 'K-Fire',
    estudio: 'K-Dance Academy',
    estilo_danca: 'K-Pop',
    categoria: 'Infantil',
    formacao: 'Duo',
    ordem_apresentacao: 3,
    status: 'APROVADA',
  },
  {
    id: 'demo-4',
    nome_coreografia: 'Sapateado em Nova York',
    estudio: 'Tap House',
    estilo_danca: 'Sapateado',
    categoria: 'Adulto',
    formacao: 'Grupo',
    ordem_apresentacao: 4,
    status: 'APROVADA',
  },
  {
    id: 'demo-5',
    nome_coreografia: 'Maracatu Elétrico',
    estudio: 'Raízes do Nordeste',
    estilo_danca: 'Dança Popular',
    categoria: 'Juvenil',
    formacao: 'Conjunto',
    ordem_apresentacao: 5,
    status: 'APROVADA',
  },
  {
    id: 'demo-6',
    nome_coreografia: 'Equilíbrio',
    estudio: 'Cia. Contemporânea',
    estilo_danca: 'Contemporâneo',
    categoria: 'Adulto',
    formacao: 'Duo',
    ordem_apresentacao: 6,
    status: 'APROVADA',
  },
  {
    id: 'demo-7',
    nome_coreografia: 'Tempestade de Areia',
    estudio: 'Estúdio Move',
    estilo_danca: 'Jazz',
    categoria: 'Juvenil',
    formacao: 'Grupo',
    ordem_apresentacao: 7,
    status: 'APROVADA',
  },
  {
    id: 'demo-8',
    nome_coreografia: 'Frevo no Pé',
    estudio: 'Raízes do Nordeste',
    estilo_danca: 'Dança Popular',
    categoria: 'Infantil',
    formacao: 'Solo',
    ordem_apresentacao: 8,
    status: 'APROVADA',
  },
  {
    id: 'demo-9',
    nome_coreografia: 'Giselle Reimaginada',
    estudio: 'Ballet Clássico SP',
    estilo_danca: 'Clássico',
    categoria: 'Adulto',
    formacao: 'Solo',
    ordem_apresentacao: 9,
    status: 'APROVADA',
  },
  {
    id: 'demo-10',
    nome_coreografia: 'Street Vibes',
    estudio: 'K-Dance Academy',
    estilo_danca: 'Danças Urbanas',
    categoria: 'Juvenil',
    formacao: 'Grupo',
    ordem_apresentacao: 10,
    status: 'APROVADA',
  },
];

const DEMO_AWARDS: SpecialAward[] = [
  { id: 'tpl_bailarino',  name: 'Melhor Bailarino(a)', enabled: true, isTemplate: true, formation: 'Solo',  genre: 'TODOS', description: 'Melhor desempenho individual' },
  { id: 'tpl_revelacao',  name: 'Prêmio Revelação',    enabled: true, isTemplate: true, formation: 'Solo',  genre: 'TODOS', description: 'Estreante de destaque' },
  { id: 'tpl_coreografo', name: 'Melhor Coreógrafo',   enabled: true, isTemplate: true, formation: 'TODOS', genre: 'TODOS', description: 'Melhor trabalho coreográfico' },
  { id: 'tpl_grupo',      name: 'Melhor Grupo da Noite',enabled: true, isTemplate: true, formation: 'Grupo', genre: 'TODOS', description: 'Melhor desempenho em grupo' },
];

/** Cor da nota — neutra (sem semântica que enviese o jurado).
 *  Antes: vermelho < 7, amarelo 7-8.9, verde >= 9.
 *  Pesquisa de viés cognitivo (BMC Psychology, NN/G color-bias): cores
 *  semânticas em scoring induzem o jurado a buscar inconscientemente o
 *  "verde positivo", inflando notas. Padrão olímpico: cor única neutra.
 *  scale parameter mantido pra retro-compatibilidade da assinatura. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const scoreGrade = (v: string | number, _scale: ScoreScale = 'BASE_10') => {
  const n = typeof v === 'number' ? v : parseFloat(v as string);
  if (!v || isNaN(n)) return 'text-slate-400 dark:text-slate-500';
  return 'text-slate-900 dark:text-white';
};

/* ════════════════════════ COMPONENT ════════════════════════ */
const JudgeTerminal = () => {
  const navigate = useNavigate();

  // Sessão de jurado (PIN-based, via /judge-login). Quando existe, o terminal
  // pula o seletor "qual jurado é você?" e fixa o jurado da sessão.
  const judgeSession = useMemo(() => readJudgeSession(), []);

  // Ref espelhando o state `scores` (declarado abaixo) — usado em handleSwitchJudge
  // pra checar rascunho sem expor scores em closure (state nao existe ainda nessa linha).
  const scoresRef = useRef<Record<string, string>>({});

  const handleSwitchJudge = () => {
    // Confirmacao SEMPRE — proposito eh trava de seguranca contra clique
    // acidental no meio do festival. Mensagem mais forte se houver rascunho.
    const hasDraft = Object.values(scoresRef.current ?? {}).some(v => v !== '' && v !== undefined && v !== null);
    const msg = hasDraft
      ? 'Sair do terminal? Sua nota em andamento será descartada e você precisará digitar o PIN novamente pra voltar.'
      : 'Sair do terminal? Você precisará digitar o PIN novamente pra voltar.';
    if (!confirm(msg)) return;
    // Rota é /judge-login/:token (token = producer_token) — sem ele, cai na
    // tela "Link inválido ou expirado" em vez de voltar pro PIN do produtor.
    const token = judgeSession?.producer_token;
    clearJudgeSession();
    navigate(token ? `/judge-login/${token}` : '/judge-login', { replace: true });
  };

  /* ── i18n ──
   * O idioma é definido pelo produtor por jurado (campo `language` em `judges`).
   * O jurado não escolhe — recebe o terminal já configurado. */
  const t      = useT();
  const locale = useLocale();

  /** Mapeia BCP-47 (ex: "pt-BR", "en-US", "es-ES") para nosso union "pt"|"en"|"es". */
  const mapJudgeLanguage = (lang?: string): 'pt' | 'en' | 'es' => {
    const v = (lang ?? '').toLowerCase();
    if (v.startsWith('en')) return 'en';
    if (v.startsWith('es')) return 'es';
    return 'pt';
  };

  /** Localized display name for a criterion: prefers explicit displayName,
   * then maps known PT defaults to translations, else returns raw name. */
  const criterionLabel = (c: CriterionWithWeight): string => {
    if (c.displayName) return c.displayName;
    const k = DEFAULT_CRITERION_KEYS[c.name];
    return k ? t(k) : c.name;
  };

  /** Localized fallback judge names (DB has none → mock judge). */
  const judgeDisplayName = (name?: string): string => {
    if (name === 'Jurado (Demo)')    return t('judge.demoFallback');
    if (name === 'Jurado (Offline)') return t('judge.offlineFallback');
    return name ?? '';
  };

  /** BCP-47 tag for time/number formatting based on the active UI locale. */
  const formatLocale = locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'pt-BR';

  /* ── Judge / session ── */
  const [judges, setJudges]                   = useState<any[]>([]);
  const [selectedJudge, setSelectedJudge]     = useState<any | null>(null);
  const [showJudgePicker, setShowJudgePicker] = useState(false);

  /* ── Header overflow menu (item 38 — pular pra #N) ── */
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  // Campo único: número (pula direto pra apresentação #N) OU texto (filtra a
  // lista por nome/estúdio). Antes eram 2 campos separados — jurado não
  // achava a busca por nome porque só via o campo numérico "Ex: 12".
  const [jumpToInput, setJumpToInput]           = useState('');
  const [jumpToError, setJumpToError]           = useState<string | null>(null);
  // Guard de navegação: índice-alvo aguardando confirmação de descarte.
  const [pendingNavIdx, setPendingNavIdx]       = useState<number | null>(null);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);

  /* ── Schedule ── */
  const [schedule, setSchedule]             = useState<any[]>([]);
  const [currentIndex, setCurrentIndex]     = useState(0);
  // Tela de fila como ponto de entrada (padrão CompetitionSuite): jurado vê
  // a lista e toca numa apresentação pra começar, em vez de cair direto na
  // nota. O efeito de sync com a Mesa de Som (liveRegistrationId) já tira o
  // jurado dessa tela automaticamente quando alguém é marcado ao vivo.
  const [showQueueScreen, setShowQueueScreen] = useState(true);

  /* ── Genre rules (loaded once, applied per performance) ── */
  const [evalConfig,  setEvalConfig]  = useState<EvalConfig | null>(null);
  const [genreList,   setGenreList]   = useState<{ id: string; name: string }[]>([]);
  const [activeCriteria, setActiveCriteria] = useState<CriterionWithWeight[]>(DEFAULT_CRITERIA);

  /* ── Scoring ── */
  const [activeField, setActiveField] = useState<string>(DEFAULT_CRITERIA[0].name);
  const [scores, setScores]           = useState<Record<string, string>>({});
  // Mantem scoresRef sincronizado com scores (usado por handleSwitchJudge)
  useEffect(() => { scoresRef.current = scores; }, [scores]);

  /* ── Special Awards (loaded from event config) ── */
  const [awardsConfig, setAwardsConfig] = useState<SpecialAward[]>([]);
  // Phase 3: marcações ⭐ por apresentação (Set de registration_id).
  // Substitui o modelo antigo de chips por prêmio — agora é 1 estrela curatorial,
  // a atribuição de prêmio acontece pós-bloco em /deliberacao.
  const [starredSet, setStarredSet] = useState<Set<string>>(new Set());
  const [starringInFlight, setStarringInFlight] = useState(false);

  // Navegação manual: registration_ids que este jurado já avaliou (offline-aware).
  // Popula no load via fetchPreviousEvaluationsSWR + adição otimista no submit.
  const [evaluatedSet, setEvaluatedSet] = useState<Set<string>>(new Set());

  // Phase 4: âncora central — qual apresentação está em palco AGORA segundo
  // a Mesa de Som. Quando muda, terminal mostra banner "AO VIVO" e auto-advance
  // após jurado submeter nota.
  const [liveRegistrationId, setLiveRegistrationId] = useState<string | null>(null);

  // Fase de deliberação do evento (COLETANDO/DELIBERACAO/CONFERENCIA/LIBERADO)
  // — controla se o atalho "Deliberação de Prêmios" aparece no menu ⋮.
  const [deliberationStatus, setDeliberationStatus] = useState<string | null>(null);

  /* ── Audio ── */
  const [isRecording,   setIsRecording]   = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [micAttempted,  setMicAttempted]  = useState(false);
  const audioContextRef    = useRef<AudioContext | null>(null);
  const analyserRef        = useRef<AnalyserNode | null>(null);
  const animationFrameRef  = useRef<number | undefined>(undefined);
  const waveformCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  // Buffer de gravação: chunks de 1s (timeslice) acumulados.
  // Phase 2B: passa de "rolling 90s" pra gravação completa, com cap de 30 min
  // (1800s) só pra evitar memory leak em jurado que esquece de parar.
  const rollingChunksRef   = useRef<Blob[]>([]);
  const BUFFER_MAX_CHUNKS  = 1800;

  /* ── Submit / loading ── */
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading,    setIsLoading]    = useState(true);
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const [isDemoMode,       setIsDemoMode]       = useState(false);
  const [showDemoTutorial, setShowDemoTutorial] = useState(false);

  /* ── Device preview (demo mode only) ── */
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'tablet' | 'desktop' | null>(null);

  /* ── Landscape check (mobile only) ── */
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const isMobile  = window.innerWidth < 768;
      const isPortrait = window.innerHeight > window.innerWidth;
      setIsPortraitMobile(isMobile && isPortrait);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  /* ── Score scale ── */
  const [scoreScale,    setScoreScale]    = useState<ScoreScale>('BASE_10');
  const [flashInvalid,  setFlashInvalid]  = useState(false);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Post-submit lock ── */
  const [isSubmitted,  setIsSubmitted]  = useState(false);
  const [submittedAt,  setSubmittedAt]  = useState<string | null>(null);

  /* ── PIN lock ── */
  const [pinLocked,     setPinLocked]     = useState(false);
  const [pinInput,      setPinInput]      = useState('');
  const [pinError,      setPinError]      = useState(false);
  const [showPinSetup,  setShowPinSetup]  = useState(false);
  const [newPinStep,    setNewPinStep]    = useState<'first' | 'confirm'>('first');
  const [newPinFirst,   setNewPinFirst]   = useState('');
  const [newPinInput,   setNewPinInput]   = useState('');
  // 0 = nunca bloquear; default 15 min, sobrescrito pela config do produtor
  const [pinInactivityMs, setPinInactivityMs] = useState(15 * 60 * 1000);
  const inactivityRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Tie detection ── */
  const [tieWarning,       setTieWarning]       = useState<string | null>(null);

  /* ── Feedback text — Avaliada usa como canal principal; modo competitivo
        usa como comentário escrito opcional (complementa o áudio). ── */
  const [feedbackText, setFeedbackText] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [prevGenreScores,  setPrevGenreScores]   = useState<number[]>([]);

  /* ── helpers ── */
  /* ── Filter schedule by judge's competências_generos ──
     If the judge has no genres configured, all performances are shown.
     If genres are set, only performances of matching styles appear. ── */
  const filteredSchedule = useMemo(() => {
    // Demo mode bypassa filtro de gênero: estilos do DEMO_SCHEDULE são fixos
    // e não correspondem ao perfil real do jurado logado.
    if (isDemoMode) return schedule;
    const genres: string[] = selectedJudge?.competencias_generos ?? [];
    if (genres.length === 0) return schedule;
    const norm = (s: string) => s?.toLowerCase().trim() ?? '';
    return schedule.filter(p => genres.some(g => norm(g) === norm(p.estilo_danca)));
  }, [schedule, selectedJudge, isDemoMode]);

  const currentPerformance = filteredSchedule[currentIndex];
  const allDone            = currentIndex >= filteredSchedule.length && filteredSchedule.length > 0;

  /* Mostra Avaliada = feedback only, no scoring */
  const isAvaliada = currentPerformance?.tipo_apresentacao === 'Avaliada';

  const isAllFilled  = isAvaliada
    ? (feedbackText.trim().length > 0 || isRecording || rollingChunksRef.current.length > 0)
    : activeCriteria.length > 0 && activeCriteria.every(c => scores[c.name] && scores[c.name] !== '');
  const isLastField  = activeCriteria.findIndex(c => c.name === activeField) === activeCriteria.length - 1;
  // Campo só está "pronto pra avançar" quando tem nota completa.
  // BASE_10: exige 2+ chars (ex: '5.5', '10', '5.') — impede avanço com '5' solto,
  //   já que o auto-decimal só dispara no 2º dígito (digitar só '5' deixa o campo cru).
  // BASE_100: qualquer 1+ dígito basta (inteiros).
  const isCurrentFieldReady = (() => {
    const cur = scores[activeField] || '';
    if (scoreScale === 'BASE_100') return cur.length >= 1;
    return cur.length >= 2 && cur !== '' && !cur.endsWith('.');
  })();

  const initScores = (cs: CriterionWithWeight[]) => {
    const s: Record<string, string> = {};
    cs.forEach(c => { s[c.name] = ''; });
    return s;
  };

  /* ── Weighted average (3 decimal places) ── */
  const calcWeightedAvg = useCallback((): string => {
    const totalPeso = activeCriteria.reduce((s, c) => s + c.peso, 0);
    if (totalPeso === 0) return '0.000';
    const weighted = activeCriteria.reduce((s, c) => {
      const v = parseFloat(scores[c.name] || '0') || 0;
      return s + v * c.peso;
    }, 0);
    return (weighted / totalPeso).toFixed(3);
  }, [activeCriteria, scores]);

  /* ── PIN helpers ── */
  const getPinKey = (judgeId: string) => `judge_pin_${judgeId}`;

  const getJudgePin = useCallback((judgeId: string) => {
    return sessionStorage.getItem(getPinKey(judgeId)) || '1234';
  }, []);

  const setJudgePin = useCallback((judgeId: string, pin: string) => {
    sessionStorage.setItem(getPinKey(judgeId), pin);
  }, []);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    // Se pinInactivityMs === 0, o produtor desativou o bloqueio automático
    if (pinInactivityMs === 0) return;
    inactivityRef.current = setTimeout(() => {
      setPinLocked(true);
    }, pinInactivityMs);
  }, [pinInactivityMs]);

  const handleActivity = useCallback(() => {
    if (!pinLocked) resetInactivityTimer();
  }, [pinLocked, resetInactivityTimer]);

  /* ── Reset navigation when judge changes ── */
  useEffect(() => {
    setCurrentIndex(0);
    setIsSubmitted(false);
    setSubmittedAt(null);
    setStarredSet(new Set()); // limpa starred local; load do terminal-data popula novamente
    rollingChunksRef.current = [];
    setTieWarning(null);
  }, [selectedJudge?.id]);

  /* ── Aplica o idioma configurado pelo produtor para este jurado ── */
  useEffect(() => {
    if (selectedJudge?.language) {
      setLocale(mapJudgeLanguage(selectedJudge.language));
    }
  }, [selectedJudge?.language]);

  /* ── Tipo de Júri é por ESTILO, não fixo pro jurado — ex: Técnico em K-Pop,
     Artístico em Danças Urbanas, mesmo jurado. */
  const isArtisticForStyle = useCallback((estiloName: string, competenciasArtisticas?: string[]): boolean => {
    return isStyleInList(estiloName, competenciasArtisticas);
  }, []);

  /* ── Genre rules resolution ── */
  const resolveGenreCriteria = useCallback((
    estiloName: string,
    config: EvalConfig | null,
    genres: typeof genreList,
    competenciasArtisticas?: string[],
  ): CriterionWithWeight[] => {
    // Júri Artístico avalia com olhar geral — usa o critério artístico configurado
    // em Avaliação, ignorando o override por gênero (que é só do Técnico). Checado
    // ANTES do `!config`: evento sem regras_avaliacao nenhuma ainda precisa do
    // fallback artístico certo, não do DEFAULT_CRITERIA técnico.
    if (isArtisticForStyle(estiloName, competenciasArtisticas)) {
      const artistic = config?.artisticRules;
      return artistic && artistic.criterios.length > 0 ? artistic.criterios : DEFAULT_ARTISTIC_CRITERIA;
    }
    if (!config) return DEFAULT_CRITERIA;
    const genre = genres.find(g => isStyleInList(estiloName, [g.name]));
    if (!genre) return config.globalRules.criterios.length > 0 ? config.globalRules.criterios : DEFAULT_CRITERIA;
    const rules = config.overrides[genre.id] ?? config.globalRules;
    return rules.criterios.length > 0 ? rules.criterios : DEFAULT_CRITERIA;
  }, [isArtisticForStyle]);

  /* ── Tie detection: check previous scores for same genre ── */
  const checkTie = useCallback(async (judgeId: string, estiloName: string, avgScore: number) => {
    try {
      // Filtra registrations no schedule já carregado (não precisa nova query).
      // Schedule já contém apenas eventos do produtor ativo + status APROVADA.
      const ids = schedule.filter(s => s.estilo_danca === estiloName).map(s => s.id);
      if (ids.length === 0) return;

      let evals: any[] = [];
      if (judgeSession) {
        // Phase 2A + 5: via Edge Function com fallback IndexedDB (offline-aware)
        evals = await fetchPreviousEvaluationsSWR(ids);
      } else {
        const { data } = await supabase
          .from('evaluations')
          .select('final_weighted_average')
          .eq('judge_id', judgeId)
          .in('registration_id', ids);
        evals = data ?? [];
      }

      if (!evals || evals.length === 0) {
        setPrevGenreScores([]);
        setTieWarning(null);
        return;
      }

      const prevScores = evals.map(e => parseFloat(e.final_weighted_average));
      setPrevGenreScores(prevScores);

      const duplicate = prevScores.find(s => Math.abs(s - avgScore) < 0.0005);
      if (duplicate !== undefined) {
        setTieWarning(t('tie.warning', { avg: avgScore.toFixed(3), style: estiloName }));
      } else {
        setTieWarning(null);
      }
    } catch { /* silent */ }
  }, [t, schedule, judgeSession]);

  /* ── realtime / polling ── */
  useEffect(() => {
    // Em demo mode, NÃO sincroniza com o banco — o schedule fictício do demo
    // tem que persistir até o jurado sair do modo manualmente.
    if (isDemoMode) return;

    // Phase 2B: jurado-sessão usa polling a cada 30s (não tem realtime sem
    // auth de produtor). Produtor/admin logado usa realtime do Supabase.
    if (judgeSession) {
      const interval = setInterval(async () => {
        try {
          const td = await fetchTerminalData();
          if (td.registrations) setSchedule(td.registrations);
          // Phase 4: atualiza âncora de "ao vivo" via polling
          setLiveRegistrationId(td.event?.live_registration_id ?? null);
          setDeliberationStatus(td.event?.deliberation_status ?? null);
        } catch (e) {
          // Silencioso — não interrompe avaliação por falha de polling
          console.warn('Polling falhou:', e);
        }
      }, 30_000);
      return () => clearInterval(interval);
    }
    // Produtor/admin: realtime tanto pra registrations quanto pro evento (live)
    const ch = supabase.channel('judge-terminal-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, () => {
        supabase.from('registrations').select('*').eq('status', 'APROVADA')
          .order('ordem_apresentacao', { ascending: true })
          .then(({ data }) => { if (data) setSchedule(data); });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, (payload: any) => {
        // Phase 4: Mesa de Som mudou live_registration_id
        const newLive = payload.new?.live_registration_id ?? null;
        setLiveRegistrationId(newLive);
        setDeliberationStatus(payload.new?.deliberation_status ?? null);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isDemoMode, judgeSession]);

  /* ── initial fetch ── */
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        let jData: any[] | null = null;
        let cfg: any = null;
        let sched: any[] | null = null;
        let gData: any[] | null = null;

        if (judgeSession) {
          // Phase 2A + 5: jurado logou via PIN. SWR contra IndexedDB cache —
          // se offline e tem cache, hidrata na hora; network rola em background.
          const cached = await fetchTerminalDataSWR((fresh) => {
            // Fresh chega depois — atualiza estado quando network resolve
            const td = fresh.data;
            if (td.registrations) setSchedule(td.registrations);
            if (Array.isArray(td.marcacoes)) {
              setStarredSet(new Set(td.marcacoes.map(m => m.registration_id)));
            }
            setLiveRegistrationId(td.event?.live_registration_id ?? null);
            setDeliberationStatus(td.event?.deliberation_status ?? null);
          });
          const td = cached.data;
          jData = td.judges;
          cfg = td.config;
          sched = td.registrations;
          gData = td.event_styles;
          if (Array.isArray(td.marcacoes) && td.marcacoes.length > 0) {
            setStarredSet(new Set(td.marcacoes.map(m => m.registration_id)));
          }
          setLiveRegistrationId(td.event?.live_registration_id ?? null);
          setDeliberationStatus(td.event?.deliberation_status ?? null);
        } else {
          // Fluxo legado: produtor/admin logado no device, queries diretas via RLS.
          const { fetchActiveEventConfig } = await import('../services/supabase');
          const [judgesRes, cfgRes, schedRes, gRes, evRes] = await Promise.all([
            supabase.from('judges').select('*'),
            fetchActiveEventConfig('regras_avaliacao, escala_notas, premios_especiais, pin_inactivity_minutes'),
            supabase.from('registrations').select('*').eq('status', 'APROVADA').order('ordem_apresentacao', { ascending: true }),
            supabase.from('event_styles').select('id, name'),
            // Phase 4: lê live_registration_id do evento ativo
            supabase.from('events')
              .select('live_registration_id, deliberation_status')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
          jData = judgesRes.data;
          cfg = cfgRes;
          sched = schedRes.data;
          gData = gRes.data;
          setDeliberationStatus(evRes.data?.deliberation_status ?? null);
          if (evRes.data?.live_registration_id) {
            setLiveRegistrationId(evRes.data.live_registration_id);
          }
        }

        const judgeList = jData && jData.length > 0
          ? jData
          : [{ id: 'mock', name: 'Jurado (Demo)', language: 'pt-BR' }];
        setJudges(judgeList);
        // Se veio da /judge-login, fixa o jurado da sessão. Senão, primeiro da lista.
        const sessionJudge = judgeSession
          ? judgeList.find(j => j.id === judgeSession.judge_id)
          : null;
        const resolvedJudge = sessionJudge ?? judgeList[0];
        setSelectedJudge(resolvedJudge);

        // Score scale
        if (cfg?.escala_notas) setScoreScale(cfg.escala_notas as ScoreScale);

        // PIN inactivity timeout (0 = nunca)
        if (cfg?.pin_inactivity_minutes != null) {
          const minutes = Number(cfg.pin_inactivity_minutes);
          setPinInactivityMs(minutes === 0 ? 0 : minutes * 60 * 1000);
        }

        // Special awards
        if (cfg?.premios_especiais && Array.isArray(cfg.premios_especiais)) {
          setAwardsConfig((cfg.premios_especiais as SpecialAward[]).filter(a => a.enabled));
        }

        // Parse evaluation config
        let parsedConfig: EvalConfig | null = null;
        if (cfg?.regras_avaliacao) {
          const raw = cfg.regras_avaliacao as any;
          if (raw.globalRules) {
            parsedConfig = raw as EvalConfig;
          }
        }
        setEvalConfig(parsedConfig);

        const genres = gData || [];
        setGenreList(genres);

        if (sched) setSchedule(sched);

        // Apply criteria for the first performance
        const firstPerf = sched?.[0];
        const criteria = firstPerf
          ? resolveGenreCriteria(firstPerf.estilo_danca, parsedConfig, genres, resolvedJudge?.competencias_artisticas)
          : (parsedConfig?.globalRules.criterios ?? DEFAULT_CRITERIA);

        setActiveCriteria(criteria);
        setScores(initScores(criteria));
        setActiveField(criteria[0]?.name ?? '');

      } catch {
        const fb = [{ id: 'mock', name: 'Jurado (Offline)', language: 'pt-BR' }];
        setJudges(fb);
        setSelectedJudge(fb[0]);
        setActiveCriteria(DEFAULT_CRITERIA);
        setScores(initScores(DEFAULT_CRITERIA));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [resolveGenreCriteria, judgeSession]);

  /* ── Navegação manual: hidrata o set de "já avaliadas" deste jurado ──
     Offline-aware: SWR/IndexedDB no fluxo de jurado, query direta no legado.
     Falha em silêncio — nunca bloqueia a avaliação. */
  useEffect(() => {
    if (isDemoMode) { setEvaluatedSet(new Set()); return; }
    const ids = schedule.map((s: any) => s.id).filter(Boolean);
    if (ids.length === 0 || !selectedJudge) return;
    let cancelled = false;
    (async () => {
      try {
        let rows: Array<{ registration_id: string }> = [];
        if (judgeSession) {
          rows = await fetchPreviousEvaluationsSWR(ids);
        } else {
          const { data } = await supabase
            .from('evaluations')
            .select('registration_id')
            .eq('judge_id', selectedJudge.id)
            .in('registration_id', ids);
          rows = data ?? [];
        }
        if (cancelled) return;
        setEvaluatedSet(new Set(rows.map(r => r.registration_id)));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [schedule, selectedJudge, judgeSession, isDemoMode]);

  /* ── Fecha o menu de navegação ao clicar/tocar fora ou Esc ──
     pointerdown cobre mouse + touch + caneta (tablet do júri). */
  useEffect(() => {
    if (!showOverflowMenu) return;
    const onDown = (e: PointerEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowOverflowMenu(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [showOverflowMenu]);

  /* ── Visible awards for the current performance (filtered by formation + genre) ── */
  const visibleAwards = useMemo(() => {
    if (!currentPerformance) return [];
    const formation = currentPerformance.formacao || currentPerformance.formato || '';
    const genre     = currentPerformance.estilo_danca || '';
    return awardsConfig.filter(a => awardMatches(a, formation, genre));
  }, [currentPerformance, awardsConfig]);

  /* ── Update criteria when performance changes ── */
  useEffect(() => {
    if (!currentPerformance) return;
    const newCriteria = resolveGenreCriteria(currentPerformance.estilo_danca, evalConfig, genreList, selectedJudge?.competencias_artisticas);
    setActiveCriteria(newCriteria);
    setActiveField(newCriteria[0]?.name ?? '');
    setScores(initScores(newCriteria));
    setIsSubmitted(false);
    setSubmittedAt(null);
    setTieWarning(null);
    // starredSet NÃO reseta por apresentação — é global por jurado/evento.
    // O estado da estrela na apresentação atual vem de `starredSet.has(currentPerformance.id)`
  }, [currentIndex, currentPerformance?.estilo_danca, evalConfig, genreList, resolveGenreCriteria, selectedJudge?.competencias_artisticas]);

  /* ── Phase 4: sync com a Mesa de Som via liveRegistrationId ──
     Dois cenários:
     1) Jurado ainda está na tela de fila (showQueueScreen, não começou a
        avaliar nada): a Mesa marca alguém ao vivo → pula a fila e entra
        direto na nota dessa apresentação. Não precisa de submit prévio,
        porque não há avaliação em andamento pra preservar.
     2) Jurado já está avaliando e JÁ submeteu a nota atual: auto-avança pra
        quem a Mesa marcou como próxima ao vivo. Self-paced preservado — se
        ainda não submeteu, não interrompe a avaliação em andamento. */
  useEffect(() => {
    if (!liveRegistrationId || !filteredSchedule.length) return;
    const liveIdx = filteredSchedule.findIndex((r: any) => r.id === liveRegistrationId);
    if (liveIdx < 0) return; // ao vivo é de outro gênero — não chega pra este jurado

    if (showQueueScreen) {
      if (liveIdx !== currentIndex) {
        setIsSubmitted(false);
        setSubmittedAt(null);
        rollingChunksRef.current = [];
        setMicAttempted(false);
        setTieWarning(null);
        setFeedbackText('');
        setShowComment(false);
        setCurrentIndex(liveIdx);
      }
      setShowQueueScreen(false);
      return;
    }

    if (!isSubmitted) return;
    if (currentPerformance?.id === liveRegistrationId || liveIdx === currentIndex) return;
    setIsSubmitted(false);
    setSubmittedAt(null);
    rollingChunksRef.current = [];
    setMicAttempted(false);
    setTieWarning(null);
    setFeedbackText('');
    setShowComment(false);
    setCurrentIndex(liveIdx);
  }, [liveRegistrationId, isSubmitted, showQueueScreen, filteredSchedule, currentPerformance?.id, currentIndex]);

  /* ── Tie check whenever weighted avg changes and all filled ── */
  useEffect(() => {
    if (!isAllFilled || !currentPerformance || !selectedJudge || isDemoMode) return;
    const avg = parseFloat(calcWeightedAvg());
    checkTie(selectedJudge.id, currentPerformance.estilo_danca, avg);
  }, [scores, isAllFilled, currentPerformance, selectedJudge, calcWeightedAvg, checkTie, isDemoMode]);

  /* ── Activity tracking for PIN ── */
  useEffect(() => {
    resetInactivityTimer();
    return () => { if (inactivityRef.current) clearTimeout(inactivityRef.current); };
  }, [resetInactivityTimer]);

  /* ── auto-start mic ── */
  useEffect(() => {
    if (currentPerformance && !isRecording && !micAttempted && !isSubmitted) {
      setMicAttempted(true);
      startRecording();
    }
  }, [currentPerformance, isRecording, micAttempted, isSubmitted]);

  /* ── Audio ── */
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const ac  = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (ac.state === 'suspended') await ac.resume();
      audioContextRef.current = ac;

      // AnalyserNode em frequency-domain (FFT spectrum analyzer).
      // Padrao Spotify/Winamp: barras fixas que dancam com magnitude da frequencia.
      // fftSize 64 → 32 bins, cada bar representa uma faixa. Smoothing evita jitter.
      // Diferente de time-domain: silencio = barras zeradas (nao oscila no nada).
      const source   = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      const NUM_BARS = analyser.frequencyBinCount; // 32
      // Reusa o buffer entre frames (evita alocar Uint8Array a cada draw)
      const freqData = new Uint8Array(NUM_BARS);
      // Visualizacao espelhada esquerda<->direita (estilo Spotify Now Playing):
      // mostramos metade dos bins, duplicados pra ambos os lados do centro horizontal.
      const HALF_BARS = Math.floor(NUM_BARS / 2);

      const drawWaveform = () => {
        const an     = analyserRef.current;
        const canvas = waveformCanvasRef.current;
        if (!an || !canvas) {
          animationFrameRef.current = requestAnimationFrame(drawWaveform);
          return;
        }
        // Frequency-domain: 0 = silencio, 255 = pico de magnitude na faixa
        an.getByteFrequencyData(freqData);

        const dpr = window.devicePixelRatio || 1;
        const w   = canvas.width  / dpr;
        const h   = canvas.height / dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          animationFrameRef.current = requestAnimationFrame(drawWaveform);
          return;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgb(255 0 104)'; // brand #ff0068

        const midY     = h / 2;
        const midX     = w / 2;
        // Total de barras renderizadas = HALF_BARS * 2 (esquerda + direita)
        const totalBars = HALF_BARS * 2;
        const barW   = w / totalBars;
        const barGap = Math.max(1, barW * 0.35);

        for (let i = 0; i < HALF_BARS; i++) {
          // Boost levemente pra fala baixa virar visivel sem saturar
          const norm   = Math.min(1, (freqData[i] / 255) * 1.4);
          const barH   = norm * (h - 2);
          const drawnH = Math.max(1, barH);
          // Espelhado: bar i vai a esquerda (midX - distancia) E direita (midX + distancia)
          // Quanto maior i (frequencia mais alta), mais distante do centro
          const distFromCenter = i * barW;
          // Esquerda do centro
          ctx.fillRect(midX - distFromCenter - barW + barGap / 2, midY - drawnH / 2, barW - barGap, drawnH);
          // Direita do centro
          ctx.fillRect(midX + distFromCenter + barGap / 2, midY - drawnH / 2, barW - barGap, drawnH);
        }
        animationFrameRef.current = requestAnimationFrame(drawWaveform);
      };
      animationFrameRef.current = requestAnimationFrame(drawWaveform);

      // Rolling buffer: chunks de 1s, mantém últimos 90s
      rollingChunksRef.current = [];
      rec.ondataavailable = e => {
        if (e.data.size > 0) {
          rollingChunksRef.current.push(e.data);
          if (rollingChunksRef.current.length > BUFFER_MAX_CHUNKS) {
            rollingChunksRef.current.shift();
          }
        }
      };
      rec.start(1000); // timeslice de 1 segundo
      setMediaRecorder(rec);
      setIsRecording(true);
    } catch (err) {
      console.error('[JudgeTerminal] microfone negado/indisponível:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (analyserRef.current) { analyserRef.current.disconnect(); analyserRef.current = null; }
      if (audioContextRef.current) audioContextRef.current.close();
      // Limpa o canvas pra nao deixar a ultima frame congelada
      const c = waveformCanvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, c.width, c.height);
      }
    }
  };

  /* ── Flash invalid input ── */
  const triggerFlash = () => {
    if (flashRef.current) clearTimeout(flashRef.current);
    setFlashInvalid(true);
    flashRef.current = setTimeout(() => setFlashInvalid(false), 500);
  };

  /* ── Phase 3: toggle estrela na apresentação atual ─────────────────────
     - Em demo: toggle só local (não persiste)
     - Em judgeSession: chama Edge Function (submit-star) com optimistic update
     - Em fluxo legado: insert/delete direto no Supabase
  */
  const toggleStarCurrent = async () => {
    if (!currentPerformance || isSubmitted || starringInFlight) return;
    handleActivity();
    const id = currentPerformance.id;
    const wasStarred = starredSet.has(id);

    // Optimistic update
    setStarredSet(prev => {
      const next = new Set(prev);
      if (wasStarred) next.delete(id); else next.add(id);
      return next;
    });

    if (isDemoMode) return; // não persiste em demo

    setStarringInFlight(true);
    try {
      if (judgeSession) {
        // Phase 5: enfileira no outbox (com colapso se já tinha pending)
        const { enqueueStarToggle } = await import('../services/judgeApiOffline');
        await enqueueStarToggle(id, wasStarred);
      } else if (selectedJudge) {
        // Fluxo legado: produtor logado, RLS via auth.uid()
        if (wasStarred) {
          await supabase
            .from('marcacoes_juri')
            .delete()
            .eq('judge_id', selectedJudge.id)
            .eq('registration_id', id);
        } else {
          await supabase.from('marcacoes_juri').insert([{
            judge_id: selectedJudge.id,
            registration_id: id,
            event_id: currentPerformance.event_id,
          }]);
        }
      }
    } catch (e) {
      console.warn('Falha ao toggle estrela, revertendo:', e);
      // Reverte optimistic update
      setStarredSet(prev => {
        const next = new Set(prev);
        if (wasStarred) next.add(id); else next.delete(id);
        return next;
      });
    } finally {
      setStarringInFlight(false);
    }
  };

  /* ── Numpad — scale-aware input handler ── */
  const handleKey = (key: string) => {
    if (!activeField || isSubmitted) return;
    handleActivity();

    setScores(prev => {
      const cur = prev[activeField] || '';

      // ── DELETE ──
      if (key === 'del') return { ...prev, [activeField]: cur.slice(0, -1) };

      // ── DECIMAL POINT (BASE_10 only) ──
      if (key === '.') {
        if (scoreScale === 'BASE_100') { triggerFlash(); return prev; }
        if (cur.includes('.') || cur === '') { triggerFlash(); return prev; }
        const candidate = cur + '.';
        return { ...prev, [activeField]: candidate };
      }

      // ── DIGIT ──
      let candidate: string;
      if (scoreScale === 'BASE_100') {
        // Integers only: build up to 3 digits
        if (cur.length >= 3) { triggerFlash(); return prev; }
        candidate = cur === '0' ? key : cur + key;          // avoid leading zeros
        const num = parseInt(candidate, 10);
        if (num > 100) { triggerFlash(); return prev; }
      } else {
        // BASE_10: decimal allowed, max 10.00
        if (cur.includes('.')) {
          const parts = cur.split('.');
          if (parts[1].length >= 2) { triggerFlash(); return prev; }
          candidate = cur + key;
        } else if (cur === '') {
          candidate = key;
        } else if (cur === '1' && key === '0') {
          candidate = '10';
        } else if (cur.length === 1) {
          // Auto-insere decimal após o 1º dígito. Pra '1', qualquer dígito 1-9
          // forma '1.X' (já que '1X' > 10 seria inválido); só '1'+'0' vira '10'
          // (tratado acima). Antes o '1' ficava preso esperando 2º dígito.
          candidate = cur + '.' + key;
        } else {
          candidate = cur + key;
        }
        const num = parseFloat(candidate);
        if (!isNaN(num) && num > 10) { triggerFlash(); return prev; }
      }

      if (!isValidScoreStr(candidate, scoreScale)) { triggerFlash(); return prev; }
      return { ...prev, [activeField]: candidate };
    });
  };

  const handleNext = () => {
    if (isSubmitted) return;
    handleActivity();
    // Não avança sem nota completa no campo atual (impede Enter/clique acidental
    // pular um quesito com dígito solto). Pisca o display pra sinalizar.
    if (!isCurrentFieldReady) { triggerFlash(); return; }
    const idx = activeCriteria.findIndex(c => c.name === activeField);
    if (idx < activeCriteria.length - 1) setActiveField(activeCriteria[idx + 1].name);
  };

  /* ── Submit ── */
  const handleFinish = async () => {
    if (!currentPerformance || isSubmitting || isSubmitted) return;
    handleActivity();
    stopRecording();
    setIsSubmitting(true);
    setSubmitError(null);

    const now = new Date().toISOString();

    /* ── Demo mode: skip DB writes, just simulate ── */
    if (isDemoMode) {
      await new Promise(r => setTimeout(r, 700)); // fake latency
      setIsSubmitted(true);
      setSubmittedAt(now);
      setIsSubmitting(false);
      return;
    }

    try {
      // Phase 3: highlights/destaques inline foram REMOVIDOS — atribuição de
      // prêmio especial agora acontece pós-bloco em /deliberacao a partir das
      // marcações ⭐ (tabela marcacoes_juri).

      // Phase 5: áudio vai como Blob pro outbox (best-effort, não bloqueia
      // submit). Drainer faz upload em background; eval é patchada com
      // audio_url quando upload completa, ou com null + flag se desistir.
      const audioBlob: Blob | null = rollingChunksRef.current.length > 0
        ? new Blob(rollingChunksRef.current, { type: 'audio/webm' })
        : null;

      /* ── Avaliada mode: no scores, save only feedback ── */
      if (isAvaliada) {
        const auditEntry = {
          judge_id:        selectedJudge.id,
          judge_name:      selectedJudge.name,
          registration_id: currentPerformance.id,
          estilo:          currentPerformance.estilo_danca,
          tipo_apresentacao: 'Avaliada',
          submitted_at:    now,
          feedback_text:   feedbackText.trim() || null,
        };
        const evalRow = {
          registration_id:        currentPerformance.id,
          judge_id:               selectedJudge.id,
          event_id:               currentPerformance.event_id,
          scores:                 {},
          criteria_weights:       [],
          final_weighted_average: null,
          submitted_at:           now,
          created_at:             now,
          audit_log:              auditEntry,
        };
        if (judgeSession) {
          await enqueueEvaluation({ evalPayload: evalRow, audioBlob });
        } else {
          // Fluxo legado (produtor logado): upload de áudio direto + upsert.
          // Reavaliar (2 dispositivos, ou reabrir e reenviar) atualiza a nota
          // do mesmo jurado em vez de criar uma 2ª linha fantasma que a
          // Apuração lia como "divergência entre jurados".
          let audioUrl: string | null = null;
          if (audioBlob) {
            const fn = `feedback_${currentPerformance.id}_${selectedJudge.id}_${Date.now()}.webm`;
            const { data: up, error: ue } = await supabase.storage.from('audio-feedbacks').upload(fn, audioBlob);
            if (!ue && up) audioUrl = supabase.storage.from('audio-feedbacks').getPublicUrl(fn).data.publicUrl;
            else if (ue) console.error('[JudgeTerminal] upload audio-feedbacks falhou:', ue.message);
          }
          const { error: evalErr } = await supabase.from('evaluations')
            .upsert([{ ...evalRow, audio_url: audioUrl }], { onConflict: 'judge_id,registration_id' });
          if (evalErr) throw evalErr;
        }
        setIsSubmitted(true);
        setSubmittedAt(now);
        return;
      }

      // Individual scores per criterion (for partial access)
      const numScores: Record<string, number> = {};
      activeCriteria.forEach(c => { numScores[c.name] = parseFloat(scores[c.name]) || 0; });

      const weightedAvg = parseFloat(calcWeightedAvg());

      // Audit log payload
      const auditEntry = {
        judge_id:        selectedJudge.id,
        judge_name:      selectedJudge.name,
        registration_id: currentPerformance.id,
        estilo:          currentPerformance.estilo_danca,
        submitted_at:    now,
        scores:          numScores,
        weighted_avg:    weightedAvg,
        criteria_used:   activeCriteria,
        feedback_text:   feedbackText.trim() || null,
      };

      const evalRow = {
        registration_id:        currentPerformance.id,
        judge_id:               selectedJudge.id,
        event_id:               currentPerformance.event_id,
        scores:                 numScores,
        criteria_weights:       activeCriteria,
        final_weighted_average: weightedAvg,
        submitted_at:           now,
        created_at:             now,
        audit_log:              auditEntry,
        feedback_text:          feedbackText.trim() || null,
      };
      if (judgeSession) {
        await enqueueEvaluation({ evalPayload: evalRow, audioBlob });
      } else {
        // Upsert em vez de insert — reavaliar atualiza a nota do mesmo
        // jurado em vez de duplicar (ver comentário no branch "Avaliada" acima).
        let audioUrl: string | null = null;
        if (audioBlob) {
          const fn = `feedback_${currentPerformance.id}_${selectedJudge.id}_${Date.now()}.webm`;
          const { data: up, error: ue } = await supabase.storage.from('audio-feedbacks').upload(fn, audioBlob);
          if (!ue && up) audioUrl = supabase.storage.from('audio-feedbacks').getPublicUrl(fn).data.publicUrl;
        }
        const { error: evalErr } = await supabase.from('evaluations')
          .upsert([{ ...evalRow, audio_url: audioUrl }], { onConflict: 'judge_id,registration_id' });
        if (evalErr) throw evalErr;
      }

      // Lock the fields — don't advance yet so the judge can review
      setIsSubmitted(true);
      setSubmittedAt(now);
      // Navegação manual: marca como avaliada otimisticamente (✓ na lista).
      setEvaluatedSet(prev => new Set(prev).add(currentPerformance.id));

    } catch (e: any) {
      setSubmitError(e?.message || t('errors.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ── Physical keyboard / numpad input ────────────────────────────────
     Espelha o numpad on-screen pra teclados físicos (notebook do júri).
     Pattern stateRef + fnRef pra evitar re-add do listener a cada digit. */
  const kbStateRef = useRef({ activeField, isSubmitted, isLastField, isAllFilled });
  kbStateRef.current = { activeField, isSubmitted, isLastField, isAllFilled };
  const kbFnRef = useRef({ handleKey, handleNext, handleFinish });
  kbFnRef.current = { handleKey, handleNext, handleFinish };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = kbStateRef.current;
      const fn = kbFnRef.current;
      if (!s.activeField || s.isSubmitted) return;

      // Não intercepta quando o foco está num input/textarea (PIN, feedback texto, etc.)
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;

      // Dígitos 0-9 (cobre top row e Numpad — event.key é igual em ambos)
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        fn.handleKey(e.key);
        return;
      }
      // Decimal: ponto, vírgula ou NumpadDecimal
      if (e.key === '.' || e.key === ',' || e.code === 'NumpadDecimal') {
        e.preventDefault();
        fn.handleKey('.');
        return;
      }
      // Apagar último dígito
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        fn.handleKey('del');
        return;
      }
      // Próximo critério ou enviar nota
      if (e.key === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (s.isLastField && s.isAllFilled) {
          fn.handleFinish();
        } else {
          fn.handleNext();
        }
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Demo mode ── */
  const activateDemo = () => setShowDemoTutorial(true);

  const confirmDemo = () => {
    const demoCriteria: CriterionWithWeight[] = [
      { name: 'Técnica',      peso: 3 },
      { name: 'Coreografia',  peso: 2 },
      { name: 'Musicalidade', peso: 2 },
      { name: 'Figurino',     peso: 1 },
    ];
    setSchedule(DEMO_SCHEDULE);
    setCurrentIndex(0);
    setActiveCriteria(demoCriteria);
    setScores(initScores(demoCriteria));
    setActiveField(demoCriteria[0].name);
    setAwardsConfig(DEMO_AWARDS);
    setStarredSet(new Set());
    setIsDemoMode(true);
    setPreviewDevice('desktop');
    setIsSubmitted(false);
    setSubmittedAt(null);
    setTieWarning(null);
    setShowDemoTutorial(false);
    // Tutorial já assume a tela de nota (passo 1 é "toque num quesito") —
    // demo pula a fila e cai direto na apresentação #1, igual sempre foi.
    setShowQueueScreen(false);
  };

  const exitDemo = () => {
    setSchedule([]);
    setCurrentIndex(0);
    setShowQueueScreen(true);
    setIsDemoMode(false);
    setPreviewDevice(null);
    setIsSubmitted(false);
  };

  /* ── Há avaliação em andamento NÃO submetida? (guard de navegação) ── */
  const hasUnsavedProgress = (): boolean => {
    if (isSubmitted) return false;
    if (isRecording || rollingChunksRef.current.length > 0) return true;
    if (feedbackText.trim().length > 0) return true;
    return activeCriteria.some(c => (scores[c.name] ?? '') !== '');
  };

  /* ── Aplica a troca de apresentação (reset manual; o effect de currentIndex
     cuida de scores/critérios/isSubmitted). Centraliza o que handleAdvance e
     handleJumpTo duplicavam — fonte única do reset. ── */
  const commitGoToIndex = (idx: number) => {
    handleActivity();
    setIsSubmitted(false);
    setSubmittedAt(null);
    // starredSet persiste — é global por jurado/evento
    rollingChunksRef.current = [];
    setMicAttempted(false);
    setTieWarning(null);
    setFeedbackText('');
    setShowComment(false);
    setCurrentIndex(idx);
    setShowOverflowMenu(false);
    setPendingNavIdx(null);
    setShowQueueScreen(false);
  };

  /* ── Pedido de navegação: valida bounds e dispara o guard de unsaved.
     Tudo 100% offline (só state local). ── */
  const requestGoToIndex = (idx: number) => {
    if (idx < 0 || idx >= filteredSchedule.length) return;
    if (idx === currentIndex) { setShowQueueScreen(false); return; }
    if (hasUnsavedProgress()) { setPendingNavIdx(idx); return; }
    commitGoToIndex(idx);
  };

  /* ── Advance to next performance (after reviewing submitted state) ── */
  const handleAdvance = () => { requestGoToIndex(currentIndex + 1); };

  /* ── Jump to performance by ordem_apresentacao (item 38 — push offline)
     Coordenador anuncia "apresentação #N" em voz alta quando Wi-Fi cai;
     jurado digita aqui e pula direto. ── */
  const handleJumpTo = () => {
    const raw = jumpToInput.trim();
    if (!raw) return;
    // Puramente numérico: pula direto pra apresentação #N (atalho Wi-Fi caído).
    const n = parseInt(raw, 10);
    if (/^\d+$/.test(raw) && !Number.isNaN(n)) {
      const idx = filteredSchedule.findIndex((r: any) => Number(r.ordem_apresentacao) === n);
      if (idx < 0) {
        setJumpToError(t('jumpTo.notFound', { n: String(n) }));
        return;
      }
      setJumpToInput('');
      setJumpToError(null);
      requestGoToIndex(idx);
      return;
    }
    // Texto: se sobrou só 1 resultado na busca, Enter/"Ir" já pula pra ele.
    const q = raw.toLowerCase();
    const matches = filteredSchedule
      .map((p: any, i: number) => ({ p, i }))
      .filter(({ p }) => `${p.nome_coreografia ?? ''} ${p.estudio ?? ''}`.toLowerCase().includes(q));
    if (matches.length === 1) {
      setJumpToInput('');
      setJumpToError(null);
      requestGoToIndex(matches[0].i);
    }
  };

  /* ── PIN handlers ── */
  const handlePinKey = (key: string) => {
    if (showPinSetup) {
      setNewPinInput(prev => {
        const next = prev.length < 4 ? prev + key : prev;
        if (next.length === 4) {
          if (newPinStep === 'first') {
            setNewPinFirst(next);
            setNewPinStep('confirm');
            return '';
          } else {
            if (next === newPinFirst) {
              setJudgePin(selectedJudge?.id || 'default', next);
              setShowPinSetup(false);
              setNewPinFirst('');
              setNewPinStep('first');
              return '';
            } else {
              setNewPinStep('first');
              setNewPinFirst('');
              return '';
            }
          }
        }
        return next;
      });
      return;
    }
    setPinInput(prev => {
      const next = prev.length < 4 ? prev + key : prev;
      if (next.length === 4) {
        const correctPin = getJudgePin(selectedJudge?.id || 'default');
        if (next === correctPin) {
          setPinLocked(false);
          setPinError(false);
          resetInactivityTimer();
          return '';
        } else {
          setPinError(true);
          setTimeout(() => setPinError(false), 800);
          return '';
        }
      }
      return next;
    });
  };

  const handlePinDel = () => {
    if (showPinSetup) setNewPinInput(prev => prev.slice(0, -1));
    else              setPinInput(prev => prev.slice(0, -1));
  };

  /* ── Loading ── */
  if (isLoading) return (
    <div className="h-full flex items-center justify-center bg-white dark:bg-slate-950 rounded-3xl">
      <div className="text-center space-y-3">
        <Loader2 className="text-[#ff0068] animate-spin mx-auto" size={40} />
        <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">{t('loading.title')}</p>
      </div>
    </div>
  );

  /* ── Portrait mobile overlay ── */
  if (isPortraitMobile) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-950 rounded-3xl select-none gap-6 p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-[#ff0068]/10 border-2 border-[#ff0068]/30 flex items-center justify-center">
          <Smartphone size={32} className="text-[#ff0068] rotate-90" />
        </div>
        <div>
          <h2 className="text-xl font-black uppercase tracking-tighter italic text-white">{t('mobile.rotateTitle')}</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2 max-w-xs leading-relaxed">
            {t('mobile.rotateBodyPre')}<span className="text-[#ff0068]">{t('mobile.rotateBodyHighlight')}</span>{t('mobile.rotateBodyPost')}
          </p>
        </div>
        <div className="flex gap-2 mt-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-[#ff0068]/40 animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  /* ════════════════════════════════ PIN OVERLAY ════════════════════════════════ */
  const displayPin   = pinLocked && !showPinSetup ? pinInput : newPinInput;
  const pinTitle     = showPinSetup
    ? (newPinStep === 'first' ? t('pin.title.setupNew') : t('pin.title.setupConfirm'))
    : t('pin.title.locked');
  const pinSubtitle  = showPinSetup
    ? (newPinStep === 'first' ? t('pin.subtitle.setupNew') : t('pin.subtitle.setupConfirm'))
    : t('pin.subtitle.locked');

  if (pinLocked || showPinSetup) {
    return (
      // Layout responsivo: portrait/desktop = 1 coluna empilhada (info em cima,
      // numpad embaixo). Landscape mobile = 2 colunas (info esquerda, numpad
      // direita) — necessario porque viewport curto (~370px) corta o numpad.
      // Padrao 1Password / Nubank em landscape mobile.
      <div className="h-full flex flex-col landscape:flex-row landscape:lg:flex-col items-center justify-center bg-slate-950 rounded-3xl select-none gap-6 landscape:gap-10 landscape:lg:gap-6 p-6">

        {/* Coluna esquerda (landscape mobile) / em cima (portrait/desktop): info */}
        <div className="flex flex-col items-center gap-4 landscape:gap-3 landscape:lg:gap-4">
          {/* Icon */}
          <div className="w-20 h-20 landscape:w-14 landscape:h-14 landscape:lg:w-20 landscape:lg:h-20 rounded-full bg-[#ff0068]/10 border-2 border-[#ff0068]/30 flex items-center justify-center shrink-0">
            <Shield size={32} className="text-[#ff0068] landscape:w-6 landscape:h-6 landscape:lg:w-8 landscape:lg:h-8" />
          </div>

          {/* Title */}
          <div className="text-center space-y-1">
            <h2 className="text-xl landscape:text-base landscape:lg:text-xl font-black uppercase tracking-tighter italic text-white">{pinTitle}</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{pinSubtitle}</p>
            {selectedJudge && (
              <p className="text-[9px] text-slate-500 uppercase tracking-widest">
                {judgeDisplayName(selectedJudge.name)}
              </p>
            )}
          </div>

          {/* PIN dots */}
          <div className={`flex gap-4 transition-all ${pinError ? 'animate-bounce' : ''}`}>
            {[0,1,2,3].map(i => (
              <div
                key={i}
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  displayPin.length > i
                    ? pinError
                      ? 'bg-rose-500 border-rose-500'
                      : 'bg-[#ff0068] border-[#ff0068]'
                    : 'bg-transparent border-white/20'
                }`}
              />
            ))}
          </div>

          {/* Hint */}
          {pinLocked && !showPinSetup && (
            <p className="text-[8px] text-slate-600 uppercase tracking-widest">{t('pin.hint')}</p>
          )}
        </div>

        {/* Coluna direita (landscape mobile) / embaixo (portrait/desktop): numpad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-xs landscape:max-w-[280px] landscape:lg:max-w-xs">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button
              key={n}
              onClick={() => handlePinKey(n.toString())}
              className="bg-white/5 hover:bg-white/10 active:scale-95 border border-white/8 rounded-2xl text-2xl font-black py-5 landscape:py-3 landscape:lg:py-5 transition-all text-white"
            >
              {n}
            </button>
          ))}
          <div /> {/* spacer */}
          <button
            onClick={() => handlePinKey('0')}
            className="bg-white/5 hover:bg-white/10 border border-white/8 rounded-2xl text-2xl font-black py-5 landscape:py-3 landscape:lg:py-5 transition-all text-white active:scale-95"
          >
            0
          </button>
          <button
            onClick={handlePinDel}
            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/10 rounded-2xl flex items-center justify-center py-5 landscape:py-3 landscape:lg:py-5 transition-all active:scale-95"
          >
            <Delete size={20} />
          </button>
        </div>

        {/* Cancel setup */}
        {showPinSetup && (
          <button
            onClick={() => { setShowPinSetup(false); setNewPinInput(''); setNewPinStep('first'); setNewPinFirst(''); }}
            className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    );
  }

  /* ════════════════════════════════ MAIN RENDER ════════════════════════════════ */
  const deviceClasses: Record<string, string> = {
    mobile:  'w-[390px] h-[844px] mx-auto shadow-2xl',
    tablet:  'w-[1024px] h-[768px] mx-auto shadow-2xl',
    desktop: 'h-full',
  };
  const activeDeviceClass = (isDemoMode && previewDevice) ? deviceClasses[previewDevice] : 'h-full';
  const showDeviceWrapper  = isDemoMode && previewDevice && previewDevice !== 'desktop';

  const terminalNode = (
    <div
      className={`relative flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-3xl overflow-hidden select-none border border-slate-200 dark:border-slate-700 lg:max-w-[1280px] lg:mx-auto lg:w-full ${activeDeviceClass} ${!previewDevice ? 'lg:max-h-[820px] lg:my-6 lg:shadow-2xl' : ''}`}
      onPointerMove={handleActivity}
      onKeyDown={handleActivity}
      onClick={handleActivity}
    >

      {/* ── Guard de navegação: avaliação em andamento não submetida ── */}
      {pendingNavIdx !== null && (
        <div className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-5">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nav-guard-msg"
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm border border-slate-200 dark:border-slate-700 shadow-2xl p-6 space-y-5"
          >
            <div className="flex items-center gap-3">
              <div className="inline-flex p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 shrink-0">
                <AlertTriangle size={18} className="text-amber-500" />
              </div>
              <p id="nav-guard-msg" className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-snug">
                {t('nav.unsavedConfirm')}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingNavIdx(null)}
                className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-white/10 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => commitGoToIndex(pendingNavIdx)}
                className="flex-1 py-3 rounded-2xl bg-[#ff0068] hover:bg-[#ff0068]/90 text-white text-[10px] font-black uppercase tracking-widest transition-all"
              >
                {t('nav.discardContinue')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Option A: Demo tutorial modal overlay ── */}
      {showDemoTutorial && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl">
                  <Star size={14} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white italic">{t('tutorial.title')}</p>
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{t('tutorial.subtitle')}</p>
                </div>
              </div>
              <button
                onClick={() => setShowDemoTutorial(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
              >
                <X size={14} />
              </button>
            </div>

            {/* Steps */}
            <div className="px-5 py-4 space-y-2.5">
              {[
                { n: '①', label: t('tutorial.step1'), icon: ChevronRight },
                { n: '②', label: t('tutorial.step2'), icon: Delete },
                { n: '③', label: t('tutorial.step3'), icon: Check },
                { n: '④', label: t('tutorial.step4'), icon: Mic },
                { n: '⑤', label: t('tutorial.step5'), icon: ClipboardCheck },
              ].map(({ n, label, icon: Icon }) => (
                <div key={n} className="flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black">{n}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon size={12} className="shrink-0 text-slate-400" />
                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 leading-tight">{label}</p>
                  </div>
                </div>
              ))}

              <div className="mt-1 px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                <p className="text-[9px] font-bold text-amber-700 dark:text-amber-400">
                  {t('tutorial.note')}
                </p>
              </div>
            </div>

            {/* CTA */}
            <div className="px-5 pb-5">
              <button
                onClick={confirmDemo}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20"
              >
                {t('tutorial.cta')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 4: Banner "AO VIVO" quando Mesa de Som marca outra apresentação ──
            Mostra só quando jurado AINDA NÃO submeteu (após submit, auto-advance
            cuida disso). Sinaliza pro jurado que ele está olhando a apresentação
            errada. Click leva pra apresentação ao vivo. */}
      {liveRegistrationId && currentPerformance && liveRegistrationId !== currentPerformance.id && !isSubmitted && (() => {
        const liveReg = filteredSchedule.find((r: any) => r.id === liveRegistrationId);
        if (!liveReg) return null; // live é de outro gênero (não desse jurado)
        const liveIdx = filteredSchedule.indexOf(liveReg);
        return (
          <button
            onClick={() => {
              setIsSubmitted(false);
              setSubmittedAt(null);
              rollingChunksRef.current = [];
              setMicAttempted(false);
              setTieWarning(null);
              setFeedbackText('');
              setCurrentIndex(liveIdx);
            }}
            className="shrink-0 w-full bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 flex items-center justify-center gap-2 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest">{t('live.label')}</span>
            <span className="text-[10px] font-black uppercase tracking-tight truncate">{liveReg.nome_coreografia}</span>
            <ChevronRight size={12} className="shrink-0" />
          </button>
        );
      })()}

      {/* ── Header — denso: 1 linha em mobile, 2 em tablet ── */}
      <header className="shrink-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-3 py-1.5 flex items-center justify-between gap-2">

        {/* Live + coreography info — o badge "AO VIVO" só aparece quando a
            apresentação atual é de fato a marcada pelo Mesa de Som
            (liveRegistrationId), não só "tem uma apresentação carregada". */}
        <div className="flex items-center gap-2 min-w-0">
          {currentPerformance?.id === liveRegistrationId && (
            <div className="flex items-center gap-1 shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-rose-500 hidden sm:inline">{t('header.live')}</span>
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-black uppercase tracking-tighter italic leading-none truncate text-slate-900 dark:text-white">
              {currentPerformance?.nome_coreografia || t('header.waiting')}
            </h2>
            {currentPerformance && (
              <p className="text-[8px] sm:text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest truncate hidden sm:block">
                {currentPerformance.estudio} · {currentPerformance.estilo_danca} · {currentPerformance.categoria}
                {filteredSchedule.length > 0 && (
                  <span className="ml-2 text-slate-400 dark:text-slate-500">({currentIndex + 1}/{filteredSchedule.length})</span>
                )}
              </p>
            )}
            {/* Em mobile, mostra só "estilo · 1/3" — info crítica em 1 linha */}
            {currentPerformance && (
              <p className="text-[8px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate sm:hidden">
                {currentPerformance.estilo_danca}
                {filteredSchedule.length > 0 && <span className="ml-1.5 text-slate-400">{currentIndex + 1}/{filteredSchedule.length}</span>}
              </p>
            )}
          </div>
        </div>

        {/* Actions: ⭐ marcar destaque + mic + PIN lock + judge selector */}
        <div className="flex items-center gap-1.5 shrink-0">

          {/* Phase 5: bolinha de status do outbox (online/offline + fila local) */}
          {judgeSession && <OfflineStatusBadge judgeId={judgeSession.judge_id} />}

          {/* Botão MARCAR foi movido pro rodapé do painel de critérios em
              todas as resoluções — mais ergonômico (perto da área de trabalho)
              e libera espaço no header pra status passivo. */}

          {/* Mic compacto inline — substitui o card grande do rodapé */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isSubmitted}
            className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all
              ${isSubmitted
                ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed'
                : isRecording
                  ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
              }`}
            title={isRecording ? t('mic.recording') : t('mic.idle')}
          >
            {isRecording ? <StopCircle size={12} /> : <Mic size={12} />}
            {isRecording && (
              /* Waveform real — Web Audio AnalyserNode em time-domain renderizado
                 em canvas 2D. Barras verticais rolling espelhadas no centro,
                 padrao Voice Memos / WhatsApp. */
              <canvas
                ref={el => {
                  waveformCanvasRef.current = el;
                  // HiDPI: dimensoes internas = CSS * dpr pra ficar nitido
                  if (el) {
                    const dpr = window.devicePixelRatio || 1;
                    if (el.width !== 60 * dpr) el.width = 60 * dpr;
                    if (el.height !== 16 * dpr) el.height = 16 * dpr;
                  }
                }}
                className="h-4 w-12 shrink-0"
              />
            )}
            <span className="text-[8px] font-black uppercase tracking-widest hidden sm:inline">
              {isRecording ? 'REC' : 'MIC'}
            </span>
          </button>

          {/* PIN setup button — escondido em mobile (acessível via outros caminhos) */}
          <button
            onClick={() => setShowPinSetup(true)}
            className="hidden lg:inline-flex p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 transition-all"
            title={t('header.pinSetupTooltip')}
          >
            <Shield size={12} />
          </button>

          {/* Manual lock */}
          <button
            onClick={() => setPinLocked(true)}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 transition-all"
            title={t('header.lockNowTooltip')}
          >
            <Lock size={12} />
          </button>

          {/* Voltar pra tela de fila (não reseta nada — só troca a visualização) */}
          {filteredSchedule.length > 0 && (
            <button
              onClick={() => setShowQueueScreen(true)}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 transition-all"
              title={t('header.queueTooltip')}
            >
              <List size={12} />
            </button>
          )}

          {/* Overflow menu — navegação manual (lista + anterior/próximo + #N) */}
          <div className="relative" ref={overflowMenuRef}>
            <button
              onClick={() => { setShowOverflowMenu(p => !p); setJumpToError(null); setJumpToInput(''); }}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 transition-all"
              title={t('header.moreTooltip')}
            >
              <MoreVertical size={12} />
            </button>

            {showOverflowMenu && (
              <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl z-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <List size={14} className="text-[#ff0068]" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-900 dark:text-white">
                    {t('nav.title')}
                  </p>
                </div>

                {/* Linha 1: Anterior + Próximo */}
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={() => requestGoToIndex(currentIndex - 1)}
                    disabled={currentIndex <= 0}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 transition-all"
                  >
                    <ChevronLeft size={12} /> {t('nav.previous')}
                  </button>
                  <button
                    onClick={() => requestGoToIndex(currentIndex + 1)}
                    disabled={currentIndex >= filteredSchedule.length - 1}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 transition-all"
                  >
                    {t('nav.next')} <ChevronRight size={12} />
                  </button>
                </div>

                {/* Linha 2: campo único — número pula direto pra #N, texto filtra
                    a lista abaixo por nome/estúdio (Wi-Fi caído OU busca por nome). */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative flex-1 w-0">
                    <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      inputMode="search"
                      aria-label={t('nav.searchLabel')}
                      placeholder={t('nav.searchPlaceholder')}
                      value={jumpToInput}
                      onChange={e => { setJumpToInput(e.target.value); setJumpToError(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') handleJumpTo(); }}
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068] transition-all"
                    />
                  </div>
                  <button
                    onClick={handleJumpTo}
                    disabled={!jumpToInput.trim()}
                    className="px-3 py-2 bg-[#ff0068] hover:bg-[#ff0068]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0"
                  >
                    {t('jumpTo.cta')}
                  </button>
                </div>
                {jumpToError && (
                  <p className="mb-2 text-[9px] font-bold text-rose-500 uppercase tracking-widest">{jumpToError}</p>
                )}

                {/* Lista rolável da fila inteira do jurado (filtrada pelo campo acima) */}
                {(() => {
                  const raw = jumpToInput.trim();
                  const q = /^\d+$/.test(raw) ? '' : raw.toLowerCase();
                  const visible = q
                    ? filteredSchedule
                        .map((p: any, i: number) => ({ p, i }))
                        .filter(({ p }) => `${p.nome_coreografia ?? ''} ${p.estudio ?? ''}`.toLowerCase().includes(q))
                    : filteredSchedule.map((p: any, i: number) => ({ p, i }));
                  if (visible.length === 0) {
                    return (
                      <p className="py-6 text-center text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        {q ? t('nav.searchEmpty') : t('nav.empty')}
                      </p>
                    );
                  }
                  return (
                  <div
                    className="max-h-72 overflow-y-auto overscroll-contain -mx-1 px-1 space-y-1"
                    style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
                  >
                    {visible.map(({ p, i }: { p: any; i: number }) => {
                      const isCurrent = i === currentIndex;
                      const isEvaluated = evaluatedSet.has(p.id);
                      const statusLabel = isCurrent
                        ? t('nav.status.current')
                        : isEvaluated ? t('nav.status.evaluated') : t('nav.status.pending');
                      return (
                        <button
                          key={p.id}
                          onClick={() => requestGoToIndex(i)}
                          aria-current={isCurrent ? 'true' : undefined}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all
                            ${isCurrent
                              ? 'bg-[#ff0068]/10 border-[#ff0068]/40'
                              : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-[#ff0068]/30 hover:bg-[#ff0068]/5'}`}
                        >
                          <span className={`shrink-0 w-7 text-center text-xs font-black tabular-nums ${isCurrent ? 'text-[#ff0068]' : 'text-slate-400'}`}>
                            {p.ordem_apresentacao ?? i + 1}
                          </span>
                          <span className="shrink-0">
                            {isCurrent
                              ? <span className="block w-2 h-2 rounded-full bg-[#ff0068] animate-pulse" />
                              : isEvaluated
                                ? <Check size={14} className="text-emerald-500" />
                                : <span className="block w-2 h-2 rounded-full border border-slate-300 dark:border-slate-600" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                              {p.nome_coreografia || '—'}
                            </span>
                            <span className="block text-[9px] font-bold text-slate-400 truncate">
                              {p.estudio} · {p.estilo_danca}
                            </span>
                          </span>
                          <span className={`shrink-0 text-[8px] font-black uppercase tracking-widest
                            ${isCurrent ? 'text-[#ff0068]' : isEvaluated ? 'text-emerald-500' : 'text-slate-400'}`}>
                            {statusLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  );
                })()}

                {/* Deliberação de Prêmios — some só durante COLETANDO (jurado ainda
                    tá avaliando, marcar prêmio ainda não faz sentido). Fica visível em
                    DELIBERACAO/CONFERENCIA/LIBERADO — mesmo depois de liberado o jurado
                    pode precisar voltar e ajustar uma atribuição. */}
                {deliberationStatus != null && deliberationStatus !== 'COLETANDO' && (
                  <button
                    onClick={() => { setShowOverflowMenu(false); navigate('/deliberacao'); }}
                    className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[#ff0068]/10 hover:bg-[#ff0068]/20 border border-[#ff0068]/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-[#ff0068] transition-all"
                  >
                    <Star size={12} className="fill-current" /> {t('nav.deliberation')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Judge selector */}
          <div className="relative">
            <button
              onClick={() => judgeSession ? handleSwitchJudge() : setShowJudgePicker(p => !p)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-xl transition-all"
              title={judgeSession ? t('header.switchTooltip') : undefined}
            >
              {/* Avatar: foto do jurado se houver, fallback DiceBear (mesmo do JudgeLogin) */}
              <div className="w-6 h-6 rounded-lg overflow-hidden shrink-0 bg-[#ff0068] flex items-center justify-center text-white text-[9px] font-black">
                {selectedJudge ? (
                  <img
                    src={(selectedJudge as any).avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(selectedJudge.name)}`}
                    alt={selectedJudge.name}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  'J'
                )}
              </div>
              <div className="text-left hidden sm:block">
                    <div className="flex items-center gap-1">
                      <p className="text-[9px] font-black uppercase text-slate-900 dark:text-white leading-tight">{judgeDisplayName(selectedJudge?.name)}</p>
                      {/* Tipo de júri é por estilo, não fixo — reflete a apresentação em cena agora */}
                      {currentPerformance && isArtisticForStyle(currentPerformance.estilo_danca, selectedJudge?.competencias_artisticas) && (
                        <span className="px-1 py-0.5 bg-violet-500/15 text-violet-600 dark:text-violet-400 rounded-full text-[6px] font-black uppercase tracking-widest leading-none shrink-0">
                          Artístico
                        </span>
                      )}
                    </div>
                    {selectedJudge?.competencias_generos?.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-0.5">
                        {selectedJudge.competencias_generos.slice(0, 3).map((g: string) => (
                          <span key={g} className="px-1.5 py-0.5 bg-[#ff0068]/10 text-[#ff0068] rounded-full text-[7px] font-black uppercase tracking-widest leading-none">
                            {g}
                          </span>
                        ))}
                        {selectedJudge.competencias_generos.length > 3 && (
                          <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-full text-[7px] font-black uppercase tracking-widest leading-none">
                            +{selectedJudge.competencias_generos.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                <p className="text-[7px] text-slate-400 uppercase tracking-widest">{t('header.judgeLabel')}</p>
              </div>
              {judgeSession ? <LogOut size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
            </button>

            {!judgeSession && showJudgePicker && judges.length > 1 && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden">
                {judges.map(j => (
                  <button
                    key={j.id}
                    onClick={() => { setSelectedJudge(j); setShowJudgePicker(false); handleActivity(); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left
                      ${selectedJudge?.id === j.id ? 'bg-[#ff0068]/5 dark:bg-[#ff0068]/10' : ''}`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-[#ff0068]/10 flex items-center justify-center text-[#ff0068] text-[10px] font-black shrink-0">
                      {j.name?.[0]}
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-900 dark:text-white">{judgeDisplayName(j.name)}</p>
                      {selectedJudge?.id === j.id && (
                        <p className="text-[8px] text-[#ff0068] font-black uppercase tracking-widest">{t('header.judgeActive')}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Demo mode banner — TEMPORARIAMENTE REMOVIDO (backlog: restaurar
          quando produtos ficarem mais maduros pra preview de produção limpo).
          Aviso de modo demo já existe na tela anterior antes do produtor entrar.
      {isDemoMode && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 h-5 bg-indigo-500 text-white text-[8px] font-black uppercase tracking-widest">
          <div className="flex items-center gap-1.5 min-w-0">
            <Star size={9} className="shrink-0" />
            <span className="truncate">{t('demo.bannerShort')}</span>
          </div>
          <button
            onClick={() => { setSchedule([]); setCurrentIndex(0); setIsDemoMode(false); setPreviewDevice(null); }}
            className="px-1.5 py-0 bg-white/20 hover:bg-white/30 rounded transition-all text-[7px] shrink-0"
          >
            {t('demo.exit')}
          </button>
        </div>
      )}
      */}

      {/* Progress bar */}
      {filteredSchedule.length > 0 && (
        <div className="h-1 bg-slate-100 dark:bg-slate-800 shrink-0">
          <div
            className="h-full bg-[#ff0068] transition-all"
            style={{ width: `${Math.min((currentIndex / filteredSchedule.length) * 100, 100)}%` }}
          />
        </div>
      )}

      {/* ── Tie Warning Banner ── */}
      {tieWarning && (
        <div className="shrink-0 mx-4 mt-2 flex items-start gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl text-amber-700 dark:text-amber-400 text-[9px] font-bold">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{tieWarning}</span>
        </div>
      )}

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto relative">

        {/* All done */}
        {allDone ? (
          <div className="flex flex-col items-center justify-center h-full py-20 gap-4 text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <Check size={36} className="text-emerald-500 dark:text-emerald-400" />
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tighter italic text-emerald-600 dark:text-emerald-400">
              {t('allDone.title')}
            </h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {t('allDone.subtitle', { count: filteredSchedule.length })}
            </p>
          </div>

        ) : !currentPerformance ? (
          <div className="flex flex-col items-center justify-center h-full py-20 gap-5 text-center px-8">
            <div className="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Music size={32} className="text-slate-400 dark:text-slate-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tighter italic text-slate-500">{t('header.waiting')}</h2>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest max-w-xs mt-2">
                {selectedJudge?.competencias_generos?.length > 0 && schedule.length > 0
                  ? t('empty.noMatchingGenres', { genres: selectedJudge.competencias_generos.join(', ') })
                  : t('empty.noSchedule')
                }
              </p>
            </div>

            {/* Demo mode separator */}
            <div className="flex items-center gap-3 w-full max-w-xs">
              <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">{t('empty.or')}</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
            </div>

            <div className="flex flex-col items-center gap-3 max-w-xs w-full">
              <button
                onClick={activateDemo}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95"
              >
                <Star size={14} />
                {t('empty.demoCta')}
              </button>

              {/* Option D: inline step pills always visible below the button */}
              <div className="w-full space-y-1.5 pt-1">
                {[
                  { n: '①', label: t('empty.step1') },
                  { n: '②', label: t('empty.step2') },
                  { n: '③', label: t('empty.step3') },
                  { n: '④', label: t('empty.step4') },
                  { n: '⑤', label: t('empty.step5') },
                ].map(({ n, label }) => (
                  <div key={n} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/8 rounded-xl">
                    <span className="shrink-0 w-4 h-4 flex items-center justify-center text-[8px] font-black text-indigo-500 dark:text-indigo-400">{n}</span>
                    <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
                  </div>
                ))}
                <p className="text-[8px] text-slate-300 dark:text-slate-600 text-center pt-0.5">
                  {t('empty.demoNote')}
                </p>
              </div>
            </div>
          </div>

        ) : showQueueScreen ? (
          /* ══ FILA — tela de entrada: jurado escolhe a apresentação antes de
             avaliar, em vez de cair direto na nota (padrão CompetitionSuite).
             Item "ao vivo" (Mesa de Som) fica destacado; tocar nele entra
             direto na nota. ══ */
          <div className="flex flex-col h-full px-4 py-5 gap-4 overflow-y-auto">
            <div className="max-w-xl mx-auto w-full">
              <h2 className="text-xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
                {t('queue.title')}
              </h2>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {t('queue.subtitle')}
              </p>
            </div>
            <div className="max-w-xl mx-auto w-full space-y-1.5 pb-4">
              {filteredSchedule.map((p: any, i: number) => {
                const isLive = p.id === liveRegistrationId;
                const isEvaluated = evaluatedSet.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => requestGoToIndex(i)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all
                      ${isLive
                        ? 'bg-rose-500/10 border-rose-500/40'
                        : isEvaluated
                          ? 'bg-slate-50 dark:bg-white/[0.02] border-slate-100 dark:border-white/5 opacity-50'
                          : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-[#ff0068]/30'}`}
                  >
                    <span className={`shrink-0 w-8 text-center text-sm font-black tabular-nums ${isLive ? 'text-rose-500' : 'text-slate-400'}`}>
                      {p.ordem_apresentacao ?? i + 1}
                    </span>
                    <span className="shrink-0">
                      {isLive
                        ? <span className="block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                        : isEvaluated
                          ? <Check size={16} className="text-emerald-500" />
                          : <span className="block w-2 h-2 rounded-full border border-slate-300 dark:border-slate-600" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                        {p.nome_coreografia || '—'}
                      </span>
                      <span className="block text-[10px] font-bold text-slate-400 truncate">
                        {p.estudio} · {p.estilo_danca}
                      </span>
                    </span>
                    {isLive && (
                      <span className="shrink-0 px-2 py-1 bg-rose-500 text-white rounded-lg text-[8px] font-black uppercase tracking-widest">
                        {t('queue.liveBadge')}
                      </span>
                    )}
                    <span className={`shrink-0 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest ${
                      isEvaluated && !isLive
                        ? 'bg-slate-100 dark:bg-white/5 text-slate-400'
                        : 'bg-[#ff0068]/10 text-[#ff0068]'
                    }`}>
                      {isEvaluated && !isLive ? t('nav.status.evaluated') : t('queue.cta')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

        ) : isAvaliada ? (
          /* ══ AVALIADA MODE — feedback only, no scores ══ */
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-8 overflow-y-auto">
            {/* Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/30 rounded-full">
              <Music size={12} className="text-violet-500" />
              <span className="text-[9px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400">
                {t('avaliada.badge')}
              </span>
            </div>

            {/* Coreografia info */}
            <div className="text-center space-y-1">
              <h3 className="text-lg font-black uppercase tracking-tight italic text-slate-900 dark:text-white">
                {currentPerformance.nome_coreografia}
              </h3>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                {currentPerformance.estudio} · {currentPerformance.estilo_danca} · {currentPerformance.categoria}
              </p>
            </div>

            {/* Text feedback area */}
            <div className="w-full max-w-md space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {t('avaliada.feedbackLabel')}
              </label>
              <textarea
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                disabled={isSubmitted}
                placeholder={t('avaliada.feedbackPlaceholder')}
                rows={5}
                spellCheck
                lang="pt-BR"
                autoCapitalize="sentences"
                autoCorrect="on"
                className={`w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-400/30 resize-none transition-all ${
                  isSubmitted ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              />
              <p className="text-[8px] text-slate-400 dark:text-slate-600">
                {t('avaliada.audioNote')}
              </p>
            </div>

            {/* Submitted state */}
            {isSubmitted && (
              <div className="w-full max-w-md flex flex-col items-center gap-3 p-5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-3xl text-center">
                <Check size={24} className="text-emerald-500" />
                <div>
                  <p className="text-sm font-black uppercase tracking-tight text-emerald-700 dark:text-emerald-400">{t('avaliada.feedbackSent')}</p>
                  <p className="text-[9px] text-emerald-600 dark:text-emerald-500 mt-0.5">{submittedAt ? new Date(submittedAt).toLocaleTimeString(formatLocale) : ''}</p>
                </div>
                <button
                  onClick={handleAdvance}
                  className="w-full py-3 bg-[#ff0068] hover:bg-[#d4005a] active:scale-95 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all"
                >
                  {t('submitted.next')}
                </button>
              </div>
            )}
          </div>

        ) : (
          /* ── Tablet-first layout: criteria bigger (left), numpad compact (right) ── */
          <div className="flex flex-col-reverse landscape:flex-row h-full min-h-0 overflow-hidden">

            {/* ══ CRITERIA PANEL — expanded, left on tablet ══ */}
            <section className="w-full landscape:w-[44%] lg:w-[42%] flex flex-col border-t landscape:border-t-0 landscape:border-r border-slate-100 dark:border-slate-800 bg-white dark:bg-transparent overflow-y-auto">

              {/* Sticky header: genre + weighted avg */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2.5 bg-white dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 shrink-0">{t('criteria.label')}</span>
                  <span className="px-1.5 py-0.5 bg-[#ff0068]/10 text-[#ff0068] text-[7px] font-black uppercase tracking-widest rounded-full truncate">
                    {currentPerformance.estilo_danca}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-base font-black italic tabular-nums leading-none ${scoreGrade(calcWeightedAvg(), scoreScale)}`}>
                    {calcWeightedAvg()}
                  </span>
                  <span className="text-[6px] text-slate-400 font-bold uppercase tracking-widest block">{t('criteria.average')}</span>
                </div>
              </div>

              {/* Criteria list — 2-col em mobile/tablet (cabe mais criterio
                  em landscape compacto, alinhado com numpad), 1-col so em
                  desktop (lg+) onde sobra largura. */}
              <div className="flex-1 px-2 py-2 grid grid-cols-2 gap-1 content-start lg:grid-cols-1 lg:content-start lg:auto-rows-min">
                {activeCriteria.map((criterion, i) => {
                    const isActive = activeField === criterion.name;
                    const val      = scores[criterion.name] || '';
                    return (
                      <button
                        key={criterion.name}
                        onClick={() => { if (!isSubmitted) { setActiveField(criterion.name); handleActivity(); } }}
                        disabled={isSubmitted}
                        className={`w-full px-2.5 py-2 rounded-xl border transition-all flex justify-between items-center gap-2
                          ${isSubmitted
                            ? 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-70 cursor-default'
                            : isActive
                              ? 'bg-[#ff0068]/5 dark:bg-[#ff0068]/10 border-[#ff0068]'
                              : val
                                ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                                : 'bg-transparent border-transparent hover:border-slate-200 dark:hover:border-slate-700'
                          }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[7px] font-black w-4 h-4 rounded-md flex items-center justify-center shrink-0
                            ${isActive
                              ? 'bg-[#ff0068] text-white'
                              : isSubmitted || val
                                ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                : 'bg-slate-100 dark:bg-white/5 text-slate-400'
                            }`}>
                            {i + 1}
                          </span>
                          <div className="min-w-0 text-left flex-1">
                            {/* Quebra em ate 2 linhas em vez de truncar com '...'
                                Tracking reduzido um tique pra caber mais texto */}
                            <span className={`text-[11px] font-black uppercase tracking-tight line-clamp-2 block leading-tight
                              ${isActive && !isSubmitted ? 'text-[#ff0068]' : val ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-400'}`}>
                              {criterionLabel(criterion)}
                            </span>
                            <span className="text-[7px] text-slate-400 font-bold">
                              peso {criterion.peso}
                            </span>
                          </div>
                        </div>
                        <span className={`text-xl font-black tracking-tighter tabular-nums italic shrink-0 ${scoreGrade(val, scoreScale)}`}>
                          {val || '—'}
                        </span>
                      </button>
                    );
                  })}
              </div>

              {/* Phase 3: ⭐ Marcar destaque (em todas as resoluções).
                  Aqui embaixo do painel de critérios pra ergonomia (perto
                  dos quesitos sendo avaliados em vez de no header de status). */}
              {currentPerformance && (() => {
                const starred = starredSet.has(currentPerformance.id);
                return (
                  <div className="px-2 py-2 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
                    <button
                      onClick={toggleStarCurrent}
                      disabled={isSubmitted || starringInFlight}
                      className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-black uppercase tracking-widest text-[10px] transition-all
                        ${isSubmitted
                          ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-400 opacity-60 cursor-not-allowed'
                          : starred
                            ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900 shadow-md'
                            : 'bg-white dark:bg-white/5 border-slate-300 dark:border-white/30 text-slate-600 dark:text-slate-300 hover:border-slate-500 dark:hover:border-white/60 active:scale-[0.98]'
                        }`}
                    >
                      <Star size={14} className={starred ? 'fill-current' : ''} />
                      {starred ? t('star.mobileOn') : t('star.mobileOff')}
                    </button>
                  </div>
                );
              })()}

              {/* Comentário escrito (opcional) — colapsado por padrão pra não
                  ocupar altura no layout compacto. Complementa o áudio, não o
                  substitui. Expande inline; a section é overflow-y-auto. */}
              {!isAvaliada && (
                <div className="px-2 pb-2 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
                  {!showComment ? (
                    <button
                      onClick={() => { if (!isSubmitted) { setShowComment(true); handleActivity(); } }}
                      disabled={isSubmitted}
                      className={`w-full flex items-center justify-center gap-2 py-2 mt-2 rounded-xl border border-dashed font-black uppercase tracking-widest text-[9px] transition-all
                        ${isSubmitted
                          ? 'border-slate-200 dark:border-slate-700 text-slate-400 opacity-60 cursor-not-allowed'
                          : feedbackText.trim()
                            ? 'border-emerald-300 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/5'
                            : 'border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/40 active:scale-[0.98]'
                        }`}
                    >
                      {feedbackText.trim()
                        ? <><Check size={12} /> {t('comment.filled')}</>
                        : <><MessageSquare size={12} /> {t('comment.toggle')}</>
                      }
                    </button>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <MessageSquare size={11} /> {t('comment.toggle')}
                        </span>
                        <button
                          onClick={() => setShowComment(false)}
                          className="text-[8px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                          {t('comment.hide')}
                        </button>
                      </div>
                      <textarea
                        value={feedbackText}
                        onChange={e => { setFeedbackText(e.target.value); handleActivity(); }}
                        disabled={isSubmitted}
                        placeholder={t('comment.placeholder')}
                        rows={3}
                        spellCheck
                        lang="pt-BR"
                        autoCapitalize="sentences"
                        autoCorrect="on"
                        className={`w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#ff0068]/20 resize-none transition-all ${
                          isSubmitted ? 'opacity-60 cursor-not-allowed' : ''
                        }`}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ══ NUMPAD PANEL — compact, right on tablet ══ */}
            <section className="flex-1 p-1.5 md:p-3 flex flex-col bg-slate-50 dark:bg-slate-950 border-l border-transparent dark:border-slate-800">

              {isSubmitted ? (
                /* ── Submitted / Aguardando próxima ──
                   Layout compacto: ícone, "Aguardando próxima apresentação",
                   média final, indicador de destaque, link sutil de fallback.
                   Cabe em viewport mobile landscape sem scroll. */
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-3 py-2 overflow-y-auto">
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border-2 border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center shrink-0">
                    <ClipboardCheck size={24} className="text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-base md:text-lg font-black uppercase tracking-tighter italic text-emerald-600 dark:text-emerald-400 leading-none">{t('submitted.title')}</h3>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">
                      {t('submitted.waitingNext')}
                    </p>
                  </div>

                  {/* Média final compacta */}
                  <div className="flex items-baseline gap-2">
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">{t('submitted.averageLabel')}</span>
                    <span className={`text-3xl md:text-4xl font-black italic tabular-nums leading-none ${scoreGrade(calcWeightedAvg(), scoreScale)}`}>
                      {calcWeightedAvg()}
                    </span>
                  </div>

                  {/* Indicador de estrela quando esta apresentação foi marcada */}
                  {currentPerformance && starredSet.has(currentPerformance.id) && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 dark:bg-white border border-slate-900 dark:border-white rounded-full">
                      <Star size={9} className="text-white dark:text-slate-900 fill-current" />
                      <span className="text-[8px] font-black uppercase tracking-widest text-white dark:text-slate-900">
                        {t('star.markedChip')}
                      </span>
                    </div>
                  )}

                  {/* Link sutil de fallback (caso produtor não avance fila) */}
                  <button
                    onClick={handleAdvance}
                    className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white underline underline-offset-2 transition-colors"
                  >
                    {t('submitted.advanceManually')} <ChevronRight size={10} />
                  </button>
                </div>

              ) : (
                /* ── Numpad ── */
                <div className="flex flex-col h-full gap-1.5 md:gap-2">

                  {/* Numpad header REMOVIDO. A escala (0-10 / 0-100) já é
                      configurada pelo produtor antes do evento; o jurado não
                      precisa do lembrete a cada nota. Padrao Square POS:
                      teclado direto sem header. */}

                  {/* Score display — só visível em desktop (lg+). Em mobile e
                      tablet, o valor já é mostrado no row do critério ativo
                      (economia critica de ~80px). */}
                  <div className={`hidden lg:flex shrink-0 h-14 rounded-xl border-2 items-center justify-center shadow-inner transition-all duration-100 ${
                    flashInvalid
                      ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-500'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600'
                  }`}>
                    <span className={`text-4xl font-black italic tabular-nums tracking-tight transition-colors ${
                      flashInvalid ? 'text-rose-500' : scoreGrade(scores[activeField] || '', scoreScale)
                    }`}>
                      {scores[activeField] || '0'}
                    </span>
                  </div>

                  {/* Number grid — 4 linhas iguais via inline style (mais
                      garantido que classes Tailwind em alguns ambientes).
                      min-h-0 nos children permite squish se necessario. */}
                  <div
                    className="flex-1 min-h-0 grid grid-cols-3 [&>*]:min-h-0 gap-1 md:gap-2 lg:max-h-[400px] mx-auto w-full max-w-2xl"
                    style={{ gridTemplateRows: 'repeat(4, minmax(0, 1fr))' }}
                  >
                    {[1,2,3,4,5,6,7,8,9].map(n => (
                      <button
                        key={n}
                        onClick={() => handleKey(n.toString())}
                        className="bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 border border-slate-200 dark:border-slate-600 rounded-lg md:rounded-xl text-xl md:text-2xl font-black transition-all text-slate-900 dark:text-white shadow-sm touch-manipulation"
                      >
                        {n}
                      </button>
                    ))}

                    {/* Bottom-left: decimal (BASE_10) or next (BASE_100) */}
                    {scoreScale === 'BASE_10' ? (
                      <button
                        onClick={() => handleKey('.')}
                        className="bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg md:rounded-xl text-xl md:text-2xl font-black transition-all active:scale-95 flex items-center justify-center touch-manipulation"
                        title={t('numpad.decimalTooltip')}
                      >
                        ,
                      </button>
                    ) : (
                      <button
                        onClick={handleNext}
                        disabled={isLastField || !isCurrentFieldReady}
                        className={`rounded-lg md:rounded-xl flex items-center justify-center transition-all touch-manipulation
                          ${isLastField || !isCurrentFieldReady
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-700'
                            : 'bg-[#ff0068] hover:bg-[#d4005a] text-white shadow-lg shadow-[#ff0068]/20 active:scale-95'
                          }`}
                      >
                        <ChevronRight size={22} />
                      </button>
                    )}

                    <button
                      onClick={() => handleKey('0')}
                      className="bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg md:rounded-xl text-xl md:text-2xl font-black transition-all text-slate-900 dark:text-white shadow-sm active:scale-95 touch-manipulation"
                    >
                      0
                    </button>
                    <button
                      onClick={() => handleKey('del')}
                      className="bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-500 border border-rose-200 dark:border-rose-500/10 rounded-lg md:rounded-xl flex items-center justify-center transition-all active:scale-95 touch-manipulation"
                    >
                      <Delete size={20} />
                    </button>
                  </div>

                  {/* BASE_10: botao unico CTA — Proximo ou Enviar Nota.
                      Padrao wizard multi-step (Typeform/Google Forms): mesmo
                      botao avanca e finaliza, reduzindo carga cognitiva e
                      eliminando rodape duplicado. */}
                  {scoreScale === 'BASE_10' && (() => {
                    const missingCount = activeCriteria.filter(c => !scores[c.name] || scores[c.name] === '').length;
                    const isFinalSubmit = isLastField && isAllFilled && !isSubmitted && !allDone;
                    const enabled = isFinalSubmit
                      ? !isSubmitting
                      : (!isLastField || !isSubmitted);

                    if (isFinalSubmit) {
                      return (
                        <button
                          onClick={handleFinish}
                          disabled={!enabled}
                          className="shrink-0 w-full flex items-center justify-center gap-2 py-2 md:py-3 rounded-lg md:rounded-xl font-black text-xs uppercase tracking-widest transition-all touch-manipulation bg-[#ff0068] hover:bg-[#d4005a] text-white shadow-lg shadow-[#ff0068]/20 active:scale-95"
                        >
                          {isSubmitting
                            ? <Loader2 size={15} className="animate-spin" />
                            : <><Check size={15} /> {isAvaliada ? t('submit.feedback') : t('submit.score')}</>
                          }
                        </button>
                      );
                    }

                    if (isLastField && !isAllFilled) {
                      return (
                        <button
                          disabled
                          className="shrink-0 w-full flex items-center justify-center gap-2 py-2 md:py-3 rounded-lg md:rounded-xl font-black text-xs uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 cursor-not-allowed"
                          title={t(missingCount === 1 ? 'numpad.missingTooltip.one' : 'numpad.missingTooltip.other', { count: missingCount })}
                        >
                          {t(missingCount === 1 ? 'numpad.missingCriteria.one' : 'numpad.missingCriteria.other', { count: missingCount })}
                        </button>
                      );
                    }

                    return (
                      <button
                        onClick={handleNext}
                        disabled={isLastField || !isCurrentFieldReady}
                        className={`shrink-0 w-full flex items-center justify-center gap-2 py-2 md:py-3 rounded-lg md:rounded-xl font-black text-xs uppercase tracking-widest transition-all touch-manipulation
                          ${isLastField || !isCurrentFieldReady
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-700 cursor-not-allowed'
                            : 'bg-[#ff0068] hover:bg-[#d4005a] text-white shadow-lg shadow-[#ff0068]/20 active:scale-95'
                          }`}
                      >
                        <ChevronRight size={15} /> {t('numpad.nextField')}
                      </button>
                    );
                  })()}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Submit error — flutuante no rodape sem ocupar barra fixa */}
      {submitError && (
        <div className="shrink-0 mx-4 mb-2 flex items-center gap-2 px-4 py-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-[9px] font-black uppercase tracking-widest">
          <AlertCircle size={12} /> {submitError}
        </div>
      )}

      {/* Bottom bar removida — Submit foi mesclado no botao "Proximo Quesito"
          que vira "Enviar Nota" no ultimo criterio (padrao wizard).
          Mic ja estava no header. Liberou ~70px de altura. */}
    </div>
  );

  /* ── Demo preview toolbar (só visível em isDemoMode) ───────────────────
     Permite testar o layout em mobile / tablet / desktop sem DevTools,
     útil pra apresentar o terminal pra clientes ou validar responsividade. */
  const demoToolbar = isDemoMode ? (
    <div className="fixed bottom-24 right-6 md:bottom-6 md:right-6 z-50 flex items-center gap-1.5 px-1.5 py-1.5 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl">
      {([
        { id: 'mobile',  Icon: Smartphone, label: 'Mobile'  },
        { id: 'tablet',  Icon: Tablet,     label: 'Tablet'  },
        { id: 'desktop', Icon: Monitor,    label: 'Desktop' },
      ] as const).map(({ id, Icon, label }) => (
        <button
          key={id}
          onClick={() => setPreviewDevice(id)}
          title={label}
          className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all ${
            previewDevice === id
              ? 'bg-[#ff0068] text-white shadow-lg shadow-[#ff0068]/30'
              : 'text-slate-300 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Icon size={16} />
        </button>
      ))}
      <div className="w-px h-6 bg-white/10 mx-1" />
      <button
        onClick={exitDemo}
        title="Sair do modo demo"
        className="px-3 h-9 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all"
      >
        <LogOut size={14} />
        Sair
      </button>
    </div>
  ) : null;

  if (showDeviceWrapper) {
    return (
      <>
        <div className="h-full flex items-center justify-center bg-slate-900/60 dark:bg-black/70 overflow-auto p-4">
          {terminalNode}
        </div>
        {demoToolbar}
      </>
    );
  }

  return (
    <>
      {terminalNode}
      {demoToolbar}
    </>
  );
};

export default JudgeTerminal;
