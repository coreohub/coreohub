import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, StopCircle, Check, Loader2, Delete,
  Music, ChevronRight, Star, Trophy, X,
  AlertCircle, ChevronDown, Lock, Unlock,
  Shield, AlertTriangle, ClipboardCheck,
  Zap, Crown, Users, Award, Shirt,
  Monitor, Tablet, Smartphone, LogOut,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { useT, useLocale, setLocale } from '../hooks/useT';
import type { JudgeDictKey } from '../i18n/judge-pt';
import { readJudgeSession, clearJudgeSession } from './JudgeLogin';
import { fetchTerminalData, fetchPreviousEvaluations, submitEvaluation as submitEvaluationViaApi } from '../services/judgeApi';

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
}

type ScoreScale = 'BASE_10' | 'BASE_100';

/* ── Special award type (mirrors AccountSettings) ── */
interface SpecialAward {
  id: string;
  name: string;
  enabled: boolean;
  isTemplate: boolean;
  formation: string;  // 'TODOS' | formation name
  description: string;
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

/** Returns true if the award applies to the given formation */
const awardMatchesFormation = (award: SpecialAward, formation: string): boolean => {
  if (!award.enabled) return false;
  if (award.formation === 'TODOS') return true;
  const norm = (s: string) => s.toLowerCase().trim();
  return norm(award.formation) === norm(formation);
};

/* ── Constants ── */
const DEFAULT_CRITERIA: CriterionWithWeight[] = [
  { name: 'Performance',   peso: 2 },
  { name: 'Criatividade',  peso: 2 },
  { name: 'Musicalidade',  peso: 2 },
  { name: 'Técnica',       peso: 2 },
  { name: 'Figurino',      peso: 2 },
];

/* ── Score scale helpers ── */
const SCALE_MAX: Record<ScoreScale, number> = { BASE_10: 10, BASE_100: 100 };

/** Returns true if `raw` string is a valid partial/complete score for the given scale */
const isValidScoreStr = (raw: string, scale: ScoreScale): boolean => {
  if (scale === 'BASE_100') return /^\d{0,3}$/.test(raw) && (raw === '' || parseInt(raw, 10) <= 100);
  // BASE_10: allow up to "10", "10.0", "10.00", or "X.XX"
  return /^\d{0,2}(\.\d{0,2})?$/.test(raw) && (raw === '' || parseFloat(raw) <= 10);
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
];

const DEMO_AWARDS: SpecialAward[] = [
  { id: 'tpl_bailarino',  name: 'Melhor Bailarino(a)', enabled: true, isTemplate: true, formation: 'Solo',  description: 'Melhor desempenho individual' },
  { id: 'tpl_revelacao',  name: 'Prêmio Revelação',    enabled: true, isTemplate: true, formation: 'Solo',  description: 'Estreante de destaque' },
  { id: 'tpl_coreografo', name: 'Melhor Coreógrafo',   enabled: true, isTemplate: true, formation: 'TODOS', description: 'Melhor trabalho coreográfico' },
  { id: 'tpl_grupo',      name: 'Melhor Grupo da Noite',enabled: true, isTemplate: true, formation: 'Grupo', description: 'Melhor desempenho em grupo' },
];

/** Grade colour — pass `scale` to normalise BASE_100 values to 0-10 range */
const scoreGrade = (v: string | number, scale: ScoreScale = 'BASE_10') => {
  const n = typeof v === 'number' ? v : parseFloat(v as string);
  if (!v || isNaN(n)) return 'text-slate-400 dark:text-slate-500';
  const norm = scale === 'BASE_100' ? n / 10 : n;
  if (norm >= 9) return 'text-emerald-600 dark:text-emerald-400';
  if (norm >= 7) return 'text-yellow-600  dark:text-yellow-400';
  return 'text-rose-600 dark:text-rose-400';
};

/* ════════════════════════ COMPONENT ════════════════════════ */
const JudgeTerminal = () => {
  const navigate = useNavigate();

  // Sessão de jurado (PIN-based, via /judge-login). Quando existe, o terminal
  // pula o seletor "qual jurado é você?" e fixa o jurado da sessão.
  const judgeSession = useMemo(() => readJudgeSession(), []);

  const handleSwitchJudge = () => {
    clearJudgeSession();
    navigate('/judge-login', { replace: true });
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

  /* ── Schedule ── */
  const [schedule, setSchedule]             = useState<any[]>([]);
  const [currentIndex, setCurrentIndex]     = useState(0);

  /* ── Genre rules (loaded once, applied per performance) ── */
  const [evalConfig,  setEvalConfig]  = useState<EvalConfig | null>(null);
  const [genreList,   setGenreList]   = useState<{ id: string; name: string }[]>([]);
  const [activeCriteria, setActiveCriteria] = useState<CriterionWithWeight[]>(DEFAULT_CRITERIA);

  /* ── Scoring ── */
  const [activeField, setActiveField] = useState<string>(DEFAULT_CRITERIA[0].name);
  const [scores, setScores]           = useState<Record<string, string>>({});

  /* ── Special Awards (loaded from event config) ── */
  const [awardsConfig, setAwardsConfig] = useState<SpecialAward[]>([]);
  const [nominations,  setNominations]  = useState<Record<string, boolean>>({});  // award.id → nominated

  const toggleNomination = (awardId: string) =>
    setNominations(prev => ({ ...prev, [awardId]: !prev[awardId] }));

  /* ── Audio ── */
  const [isRecording,   setIsRecording]   = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [micAttempted,  setMicAttempted]  = useState(false);
  const [audioLevels,   setAudioLevels]   = useState<number[]>([0, 0, 0, 0, 0]);
  const audioContextRef    = useRef<AudioContext | null>(null);
  const analyserRef        = useRef<AnalyserNode | null>(null);
  const animationFrameRef  = useRef<number | undefined>(undefined);
  // Rolling buffer: keeps last 90 chunks (≈90s at 1s timeslice)
  const rollingChunksRef   = useRef<Blob[]>([]);
  const BUFFER_MAX_CHUNKS  = 90;

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

  /* ── Avaliada (non-competitive) feedback text ── */
  const [feedbackText, setFeedbackText] = useState('');
  const [prevGenreScores,  setPrevGenreScores]   = useState<number[]>([]);

  /* ── helpers ── */
  /* ── Filter schedule by judge's competências_generos ──
     If the judge has no genres configured, all performances are shown.
     If genres are set, only performances of matching styles appear. ── */
  const filteredSchedule = useMemo(() => {
    const genres: string[] = selectedJudge?.competencias_generos ?? [];
    if (genres.length === 0) return schedule;
    const norm = (s: string) => s?.toLowerCase().trim() ?? '';
    return schedule.filter(p => genres.some(g => norm(g) === norm(p.estilo_danca)));
  }, [schedule, selectedJudge]);

  const currentPerformance = filteredSchedule[currentIndex];
  const allDone            = currentIndex >= filteredSchedule.length && filteredSchedule.length > 0;

  /* Mostra Avaliada = feedback only, no scoring */
  const isAvaliada = currentPerformance?.tipo_apresentacao === 'Avaliada';

  const isAllFilled  = isAvaliada
    ? (feedbackText.trim().length > 0 || isRecording || rollingChunksRef.current.length > 0)
    : activeCriteria.length > 0 && activeCriteria.every(c => scores[c.name] && scores[c.name] !== '');
  const isLastField  = activeCriteria.findIndex(c => c.name === activeField) === activeCriteria.length - 1;

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
    setNominations({});
    rollingChunksRef.current = [];
    setAudioLevels([0, 0, 0, 0, 0]);
    setTieWarning(null);
  }, [selectedJudge?.id]);

  /* ── Aplica o idioma configurado pelo produtor para este jurado ── */
  useEffect(() => {
    if (selectedJudge?.language) {
      setLocale(mapJudgeLanguage(selectedJudge.language));
    }
  }, [selectedJudge?.language]);

  /* ── Genre rules resolution ── */
  const resolveGenreCriteria = useCallback((estiloName: string, config: EvalConfig | null, genres: typeof genreList): CriterionWithWeight[] => {
    if (!config) return DEFAULT_CRITERIA;
    const genre = genres.find(g => g.name.toLowerCase().trim() === estiloName?.toLowerCase().trim());
    if (!genre) return config.globalRules.criterios.length > 0 ? config.globalRules.criterios : DEFAULT_CRITERIA;
    const rules = config.overrides[genre.id] ?? config.globalRules;
    return rules.criterios.length > 0 ? rules.criterios : DEFAULT_CRITERIA;
  }, []);

  /* ── Tie detection: check previous scores for same genre ── */
  const checkTie = useCallback(async (judgeId: string, estiloName: string, avgScore: number) => {
    try {
      // Filtra registrations no schedule já carregado (não precisa nova query).
      // Schedule já contém apenas eventos do produtor ativo + status APROVADA.
      const ids = schedule.filter(s => s.estilo_danca === estiloName).map(s => s.id);
      if (ids.length === 0) return;

      let evals: any[] = [];
      if (judgeSession) {
        // Phase 2A: via Edge Function (não precisa de RLS de produtor)
        evals = await fetchPreviousEvaluations(ids);
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

  /* ── realtime ── */
  useEffect(() => {
    // Phase 2A: jurado sem produtor logado não consegue subscribe (sem RLS).
    // O cronograma fica estático nessa sessão; refresh manual via reload.
    if (judgeSession) return;
    const ch = supabase.channel('judge-terminal-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, () => {
        supabase.from('registrations').select('*').eq('status', 'APROVADA')
          .order('ordem_apresentacao', { ascending: true })
          .then(({ data }) => { if (data) setSchedule(data); });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

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
          // Phase 2A: jurado logou via PIN, sem sessão de produtor.
          // Tudo vem da Edge Function (que valida o token + judge_id no backend).
          const td = await fetchTerminalData();
          jData = td.judges;
          cfg = td.config;
          sched = td.registrations;
          gData = td.event_styles;
        } else {
          // Fluxo legado: produtor/admin logado no device, queries diretas via RLS.
          const { fetchActiveEventConfig } = await import('../services/supabase');
          const [judgesRes, cfgRes, schedRes, gRes] = await Promise.all([
            supabase.from('judges').select('*'),
            fetchActiveEventConfig('regras_avaliacao, escala_notas, premios_especiais, pin_inactivity_minutes'),
            supabase.from('registrations').select('*').eq('status', 'APROVADA').order('ordem_apresentacao', { ascending: true }),
            supabase.from('event_styles').select('id, name'),
          ]);
          jData = judgesRes.data;
          cfg = cfgRes;
          sched = schedRes.data;
          gData = gRes.data;
        }

        const judgeList = jData && jData.length > 0
          ? jData
          : [{ id: 'mock', name: 'Jurado (Demo)', language: 'pt-BR' }];
        setJudges(judgeList);
        // Se veio da /judge-login, fixa o jurado da sessão. Senão, primeiro da lista.
        const sessionJudge = judgeSession
          ? judgeList.find(j => j.id === judgeSession.judge_id)
          : null;
        setSelectedJudge(sessionJudge ?? judgeList[0]);

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
          ? resolveGenreCriteria(firstPerf.estilo_danca, parsedConfig, genres)
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

  /* ── Visible awards for the current performance (filtered by formation) ── */
  const visibleAwards = useMemo(() => {
    if (!currentPerformance) return [];
    const formation = currentPerformance.formacao || currentPerformance.formato || '';
    return awardsConfig.filter(a => awardMatchesFormation(a, formation));
  }, [currentPerformance, awardsConfig]);

  /* ── Update criteria + reset nominations when performance changes ── */
  useEffect(() => {
    if (!currentPerformance) return;
    const newCriteria = resolveGenreCriteria(currentPerformance.estilo_danca, evalConfig, genreList);
    setActiveCriteria(newCriteria);
    setActiveField(newCriteria[0]?.name ?? '');
    setScores(initScores(newCriteria));
    setIsSubmitted(false);
    setSubmittedAt(null);
    setTieWarning(null);
    setNominations({});  // reset nominations for new performance
  }, [currentIndex, currentPerformance?.estilo_danca, evalConfig, genreList, resolveGenreCriteria]);

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

      // AnalyserNode para onda sonora real
      const source   = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Loop de animação baseado em níveis reais de áudio
      const updateLevels = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const bucketSize = Math.max(1, Math.floor(data.length / 5));
        const levels = Array.from({ length: 5 }, (_, i) => {
          const slice = data.slice(i * bucketSize, (i + 1) * bucketSize);
          const avg   = slice.reduce((a, b) => a + b, 0) / slice.length;
          return avg / 255;
        });
        setAudioLevels(levels);
        animationFrameRef.current = requestAnimationFrame(updateLevels);
      };
      animationFrameRef.current = requestAnimationFrame(updateLevels);

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
    } catch { /* mic denied */ }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setAudioLevels([0, 0, 0, 0, 0]);
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (analyserRef.current) { analyserRef.current.disconnect(); analyserRef.current = null; }
      if (audioContextRef.current) audioContextRef.current.close();
    }
  };

  /* ── Flash invalid input ── */
  const triggerFlash = () => {
    if (flashRef.current) clearTimeout(flashRef.current);
    setFlashInvalid(true);
    flashRef.current = setTimeout(() => setFlashInvalid(false), 500);
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
        } else if (cur.length === 1 && cur !== '1') {
          candidate = cur + '.' + key;   // auto-insert decimal after first digit ≠ 1
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
      const nominatedAwards = visibleAwards.filter(a => nominations[a.id]);
      // Phase 2A: destaques_votacao não disponível pra jurado sem produtor
      // logado (RLS). Vai ser refatorado em Phase 2B.
      if (!judgeSession && nominatedAwards.length > 0) {
        const highlights = nominatedAwards.map(a => ({
          registration_id: currentPerformance.id,
          judge_id:        selectedJudge.id,
          tipo_destaque:   a.id.toUpperCase(),
          award_name:      a.name,
        }));
        await supabase.from('destaques_votacao').insert(highlights);
      }

      let audioUrl: string | null = null;
      // Phase 2A: jurado sem produtor logado não consegue upload pro Storage
      // (RLS exige session). Áudio fica desabilitado nesse modo até Phase 2B.
      if (!judgeSession && rollingChunksRef.current.length > 0) {
        const blob = new Blob(rollingChunksRef.current, { type: 'audio/webm' });
        const fn   = `feedback_${currentPerformance.id}_${selectedJudge.id}_${Date.now()}.webm`;
        const { data: up, error: ue } = await supabase.storage.from('audio-feedbacks').upload(fn, blob);
        if (!ue && up) audioUrl = supabase.storage.from('audio-feedbacks').getPublicUrl(fn).data.publicUrl;
      }

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
          scores:                 {},
          criteria_weights:       [],
          final_weighted_average: null,
          audio_url:              audioUrl,
          submitted_at:           now,
          created_at:             now,
          audit_log:              auditEntry,
        };
        if (judgeSession) {
          await submitEvaluationViaApi(evalRow);
        } else {
          const { error: evalErr } = await supabase.from('evaluations').insert([evalRow]);
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
      };

      const evalRow = {
        registration_id:        currentPerformance.id,
        judge_id:               selectedJudge.id,
        scores:                 numScores,
        criteria_weights:       activeCriteria,
        final_weighted_average: weightedAvg,
        audio_url:              audioUrl,
        submitted_at:           now,
        created_at:             now,
        audit_log:              auditEntry,
      };
      if (judgeSession) {
        await submitEvaluationViaApi(evalRow);
      } else {
        const { error: evalErr } = await supabase.from('evaluations').insert([evalRow]);
        if (evalErr) throw evalErr;
      }

      // Lock the fields — don't advance yet so the judge can review
      setIsSubmitted(true);
      setSubmittedAt(now);

    } catch (e: any) {
      setSubmitError(e?.message || t('errors.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

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
    setNominations({});
    setIsDemoMode(true);
    setIsSubmitted(false);
    setSubmittedAt(null);
    setTieWarning(null);
    setShowDemoTutorial(false);
  };

  /* ── Advance to next performance (after reviewing submitted state) ── */
  const handleAdvance = () => {
    handleActivity();
    setIsSubmitted(false);
    setSubmittedAt(null);
    setNominations({});
    rollingChunksRef.current = [];
    setAudioLevels([0, 0, 0, 0, 0]);
    setMicAttempted(false);
    setTieWarning(null);
    setFeedbackText('');
    setCurrentIndex(prev => prev + 1);
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
      <div className="h-full flex flex-col items-center justify-center bg-slate-950 rounded-3xl select-none gap-6 p-6">
        {/* Icon */}
        <div className="w-20 h-20 rounded-full bg-[#ff0068]/10 border-2 border-[#ff0068]/30 flex items-center justify-center">
          <Shield size={32} className="text-[#ff0068]" />
        </div>

        {/* Title */}
        <div className="text-center space-y-1">
          <h2 className="text-xl font-black uppercase tracking-tighter italic text-white">{pinTitle}</h2>
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

        {/* PIN numpad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button
              key={n}
              onClick={() => handlePinKey(n.toString())}
              className="bg-white/5 hover:bg-white/10 active:scale-95 border border-white/8 rounded-2xl text-2xl font-black py-5 transition-all text-white"
            >
              {n}
            </button>
          ))}
          <div /> {/* spacer */}
          <button
            onClick={() => handlePinKey('0')}
            className="bg-white/5 hover:bg-white/10 border border-white/8 rounded-2xl text-2xl font-black py-5 transition-all text-white active:scale-95"
          >
            0
          </button>
          <button
            onClick={handlePinDel}
            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/10 rounded-2xl flex items-center justify-center py-5 transition-all active:scale-95"
          >
            <Delete size={20} />
          </button>
        </div>

        {/* Hint */}
        {pinLocked && !showPinSetup && (
          <p className="text-[8px] text-slate-600 uppercase tracking-widest">{t('pin.hint')}</p>
        )}

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
      className={`relative flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-3xl overflow-hidden select-none border border-slate-200 dark:border-slate-700 ${activeDeviceClass}`}
      onPointerMove={handleActivity}
      onKeyDown={handleActivity}
      onClick={handleActivity}
    >

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

      {/* ── Header ── */}
      <header className="shrink-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-5 py-3 flex items-center justify-between gap-4">

        {/* Live + coreography info */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className={`w-2 h-2 rounded-full ${currentPerformance ? 'bg-rose-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
            <span className="text-[8px] font-black uppercase tracking-[0.3em] text-rose-500">{t('header.live')}</span>
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-black uppercase tracking-tighter italic leading-none truncate text-slate-900 dark:text-white">
              {currentPerformance?.nome_coreografia || t('header.waiting')}
            </h2>
            {currentPerformance && (
              <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest truncate">
                {currentPerformance.estudio} · {currentPerformance.estilo_danca} · {currentPerformance.categoria}
                <span className="ml-2 text-[#ff0068]">· {t('header.criteriaCount', { count: activeCriteria.length })}</span>
                {filteredSchedule.length > 0 && (
                  <span className="ml-2 text-slate-400 dark:text-slate-500">({currentIndex + 1}/{filteredSchedule.length})</span>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Actions: PIN lock + judge selector */}
        <div className="flex items-center gap-2 shrink-0">

          {/* PIN setup button */}
          <button
            onClick={() => setShowPinSetup(true)}
            className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 transition-all"
            title={t('header.pinSetupTooltip')}
          >
            <Shield size={14} />
          </button>

          {/* Manual lock */}
          <button
            onClick={() => setPinLocked(true)}
            className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 transition-all"
            title={t('header.lockNowTooltip')}
          >
            <Lock size={14} />
          </button>

          {/* Judge selector */}
          <div className="relative">
            <button
              onClick={() => judgeSession ? handleSwitchJudge() : setShowJudgePicker(p => !p)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-xl transition-all"
              title={judgeSession ? 'Trocar jurado (sair e voltar pro login)' : undefined}
            >
              <div className="w-6 h-6 rounded-lg bg-[#ff0068] flex items-center justify-center text-white text-[9px] font-black shrink-0">
                {selectedJudge?.name?.[0] || 'J'}
              </div>
              <div className="text-left hidden sm:block">
                    <p className="text-[9px] font-black uppercase text-slate-900 dark:text-white leading-tight">{judgeDisplayName(selectedJudge?.name)}</p>
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

      {/* Demo mode banner */}
      {isDemoMode && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest">
          <div className="flex items-center gap-2 min-w-0">
            <Star size={11} className="shrink-0" />
            <span className="hidden sm:inline truncate">{t('demo.bannerLong')}</span>
            <span className="sm:hidden">{t('demo.bannerShort')}</span>
          </div>

          {/* Device preview toggles */}
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-white/60 text-[7px] hidden md:inline mr-1">{t('demo.previewLabel')}</span>
            {([
              { id: 'mobile',  Icon: Smartphone, label: t('demo.deviceMobile') },
              { id: 'tablet',  Icon: Tablet,     label: t('demo.deviceTablet') },
              { id: 'desktop', Icon: Monitor,    label: t('demo.deviceDesktop') },
            ] as const).map(({ id, Icon, label }) => (
              <button
                key={id}
                title={label}
                onClick={() => setPreviewDevice(prev => prev === id ? null : id)}
                className={`p-1.5 rounded-lg transition-all ${
                  previewDevice === id
                    ? 'bg-white text-indigo-600 shadow'
                    : 'bg-white/20 hover:bg-white/30 text-white'
                }`}
              >
                <Icon size={12} />
              </button>
            ))}

            <div className="w-px h-4 bg-white/30 mx-1" />
            <button
              onClick={() => { setSchedule([]); setCurrentIndex(0); setIsDemoMode(false); setPreviewDevice(null); }}
              className="flex items-center gap-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded-lg transition-all text-[8px]"
            >
              {t('demo.exit')}
            </button>
          </div>
        </div>
      )}

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
          <div className="flex flex-col-reverse md:flex-row h-full min-h-0 overflow-hidden">

            {/* ══ CRITERIA PANEL — expanded, left on tablet ══ */}
            <section className="w-full md:w-[44%] lg:w-[42%] flex flex-col border-t md:border-t-0 md:border-r border-slate-100 dark:border-slate-800 bg-white dark:bg-transparent overflow-y-auto">

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

              {/* Criteria list — slim rows */}
              <div className="flex-1 px-2 py-2 space-y-1">
                {(() => {
                  const totalPeso = activeCriteria.reduce((s, c) => s + c.peso, 0);
                  return activeCriteria.map((criterion, i) => {
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
                            ${isSubmitted || val
                              ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                              : isActive
                                ? 'bg-[#ff0068] text-white'
                                : 'bg-slate-100 dark:bg-white/5 text-slate-400'
                            }`}>
                            {i + 1}
                          </span>
                          <div className="min-w-0 text-left">
                            <span className={`text-[11px] font-black uppercase tracking-widest truncate block leading-tight
                              ${isActive && !isSubmitted ? 'text-[#ff0068]' : val ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-400'}`}>
                              {criterionLabel(criterion)}
                            </span>
                            <span className="text-[7px] text-slate-400 font-bold">
                              ×{criterion.peso} · {totalPeso > 0 ? Math.round((criterion.peso / totalPeso) * 100) : 0}%
                            </span>
                          </div>
                        </div>
                        <span className={`text-xl font-black tracking-tighter tabular-nums italic shrink-0 ${scoreGrade(val, scoreScale)}`}>
                          {val || '—'}
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>

              {/* Nominations — conditional, only shown when there are visible awards */}
              {visibleAwards.length > 0 && (
                <div className="px-2 pb-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[7px] font-black uppercase tracking-widest text-slate-400 px-1 mb-1.5">{t('criteria.nominationsLabel')}</p>
                  <div className={`grid gap-1.5 ${visibleAwards.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {visibleAwards.map(award => {
                      const Icon      = resolveAwardIcon(award);
                      const nominated = !!nominations[award.id];
                      return (
                        <button
                          key={award.id}
                          onClick={() => { if (!isSubmitted) { toggleNomination(award.id); handleActivity(); } }}
                          disabled={isSubmitted}
                          title={award.description || award.name}
                          className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[7px] font-black uppercase tracking-widest border transition-all leading-tight text-center
                            ${nominated
                              ? 'bg-violet-600 border-transparent text-white shadow-md shadow-violet-500/20'
                              : isSubmitted
                                ? 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-default'
                                : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-violet-400/40 hover:text-violet-500'
                            }`}
                        >
                          <Icon size={10} className="shrink-0" />
                          <span className="truncate">{award.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* ══ NUMPAD PANEL — compact, right on tablet ══ */}
            <section className="flex-1 p-2 md:p-3 flex flex-col bg-slate-50 dark:bg-slate-950 border-l border-transparent dark:border-slate-800">

              {isSubmitted ? (
                /* ── Submitted / Locked state ── */
                <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center">
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border-2 border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center">
                    <ClipboardCheck size={36} className="text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tighter italic text-emerald-600 dark:text-emerald-400">{t('submitted.title')}</h3>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{t('submitted.subtitle')}</p>
                  </div>
                  <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
                    <div className="text-center">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">{t('submitted.weightedTitle')}</p>
                      <span className={`text-5xl font-black italic tabular-nums ${scoreGrade(calcWeightedAvg(), scoreScale)}`}>
                        {calcWeightedAvg()}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-1.5">
                      {activeCriteria.map(c => (
                        <div key={c.name} className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-500 dark:text-slate-400 font-bold">{criterionLabel(c)} <span className="text-slate-300 dark:text-slate-600">(×{c.peso})</span></span>
                          <span className={`font-black tabular-nums ${scoreGrade(scores[c.name] || '0', scoreScale)}`}>
                            {scores[c.name] || '0'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Submitted nominations summary */}
                  {visibleAwards.filter(a => nominations[a.id]).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {visibleAwards.filter(a => nominations[a.id]).map(a => {
                        const Icon = resolveAwardIcon(a);
                        return (
                          <div key={a.id} className="flex items-center gap-1 px-2 py-1 bg-violet-100 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/20 rounded-full">
                            <Icon size={8} className="text-violet-600 dark:text-violet-400" />
                            <span className="text-[7px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300">{a.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {submittedAt && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                      <Unlock size={10} className="text-slate-400 shrink-0" />
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                        {t('submitted.submittedAt', {
                          time: new Date(submittedAt).toLocaleTimeString(
                            formatLocale,
                            { hour: '2-digit', minute: '2-digit', second: '2-digit' },
                          ),
                        })}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={handleAdvance}
                    className="w-full max-w-sm px-8 py-5 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-[#ff0068]/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <ChevronRight size={18} /> {t('submitted.next')}
                  </button>
                </div>

              ) : (
                /* ── Numpad ── */
                <div className="flex flex-col h-full gap-3">

                  {/* Numpad header */}
                  <div className="flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">{t('numpad.label')}</span>
                      <span className={`text-[7px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        scoreScale === 'BASE_10'
                          ? 'bg-[#ff0068]/10 text-[#ff0068]'
                          : 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                      }`}>
                        {scoreScale === 'BASE_10' ? '0 – 10' : '0 – 100'}
                      </span>
                    </div>
                    <span className="text-[8px] font-black text-[#ff0068] uppercase tracking-widest truncate max-w-[50%]">
                      ▶ {activeField ? criterionLabel({ name: activeField, peso: 0 }) : ''}
                    </span>
                  </div>

                  {/* Score display — flashes red on invalid input */}
                  <div className={`shrink-0 h-14 md:h-16 rounded-xl border-2 flex items-center justify-center shadow-inner transition-all duration-100 ${
                    flashInvalid
                      ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-500'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600'
                  }`}>
                    <span className={`text-4xl md:text-5xl font-black italic tabular-nums tracking-tight transition-colors ${
                      flashInvalid ? 'text-rose-500' : scoreGrade(scores[activeField] || '', scoreScale)
                    }`}>
                      {scores[activeField] || '0'}
                    </span>
                  </div>

                  {/* Number grid — fills available space */}
                  <div className="flex-1 grid grid-cols-3 gap-1.5 md:gap-2">
                    {[1,2,3,4,5,6,7,8,9].map(n => (
                      <button
                        key={n}
                        onClick={() => handleKey(n.toString())}
                        className="bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 border border-slate-200 dark:border-slate-600 rounded-xl text-xl md:text-2xl font-black transition-all text-slate-900 dark:text-white shadow-sm touch-manipulation"
                      >
                        {n}
                      </button>
                    ))}

                    {/* Bottom-left: decimal (BASE_10) or next (BASE_100) */}
                    {scoreScale === 'BASE_10' ? (
                      <button
                        onClick={() => handleKey('.')}
                        className="bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl text-xl md:text-2xl font-black transition-all active:scale-95 flex items-center justify-center touch-manipulation"
                        title={t('numpad.decimalTooltip')}
                      >
                        ,
                      </button>
                    ) : (
                      <button
                        onClick={handleNext}
                        disabled={isLastField}
                        className={`rounded-xl flex items-center justify-center transition-all touch-manipulation
                          ${isLastField
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-700'
                            : 'bg-[#ff0068] hover:bg-[#d4005a] text-white shadow-lg shadow-[#ff0068]/20 active:scale-95'
                          }`}
                      >
                        <ChevronRight size={22} />
                      </button>
                    )}

                    <button
                      onClick={() => handleKey('0')}
                      className="bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xl md:text-2xl font-black transition-all text-slate-900 dark:text-white shadow-sm active:scale-95 touch-manipulation"
                    >
                      0
                    </button>
                    <button
                      onClick={() => handleKey('del')}
                      className="bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-500 border border-rose-200 dark:border-rose-500/10 rounded-xl flex items-center justify-center transition-all active:scale-95 touch-manipulation"
                    >
                      <Delete size={20} />
                    </button>
                  </div>

                  {/* BASE_10: "next" as full-width row below grid */}
                  {scoreScale === 'BASE_10' && (
                    <button
                      onClick={handleNext}
                      disabled={isLastField}
                      className={`shrink-0 w-full flex items-center justify-center gap-2 py-3 md:py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all touch-manipulation
                        ${isLastField
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-700 cursor-not-allowed'
                          : 'bg-[#ff0068] hover:bg-[#d4005a] text-white shadow-lg shadow-[#ff0068]/20 active:scale-95'
                        }`}
                    >
                      <ChevronRight size={15} /> {t('numpad.nextField')}
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Submit error */}
      {submitError && (
        <div className="shrink-0 mx-4 mb-1 flex items-center gap-2 px-4 py-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-[9px] font-black uppercase tracking-widest">
          <AlertCircle size={12} /> {submitError}
        </div>
      )}

      {/* ── Bottom bar ── */}
      <div className="shrink-0 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 px-4 py-3 md:px-5 md:py-4">
        <div className="flex items-center gap-3">

          {/* Mic */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isSubmitted}
            className={`flex items-center gap-3 flex-1 p-3 rounded-2xl border transition-all
              ${isSubmitted
                ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed'
                : isRecording
                  ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0
              ${isRecording ? 'bg-rose-500 animate-pulse text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
              {isRecording ? <StopCircle size={16} /> : <Mic size={16} />}
            </div>
            <div className="text-left min-w-0">
              <p className="text-[8px] font-black uppercase tracking-widest">
                {isRecording ? t('mic.recording') : t('mic.idle')}
              </p>
              <p className="text-[9px] font-bold truncate text-slate-700 dark:text-slate-300">
                {isRecording ? t('mic.recordingHint') : t('mic.idleHint')}
              </p>
            </div>
            {/* Onda sonora real via AnalyserNode */}
            {isRecording && (
              <div className="flex gap-[3px] items-end shrink-0 h-5">
                {audioLevels.map((level, i) => (
                  <div
                    key={i}
                    className="w-1 bg-rose-500 rounded-full transition-all duration-75"
                    style={{ height: `${Math.max(15, level * 100)}%` }}
                  />
                ))}
              </div>
            )}
          </button>

          {/* Submit button — only shows when not yet submitted */}
          {!isSubmitted ? (
            <button
              onClick={handleFinish}
              disabled={isSubmitting || !isAllFilled || !currentPerformance || allDone}
              className={`px-5 py-4 md:px-7 md:py-5 rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all flex items-center gap-2 shrink-0 touch-manipulation
                ${isAllFilled && currentPerformance && !allDone
                  ? 'bg-[#ff0068] hover:bg-[#d4005a] text-white shadow-xl shadow-[#ff0068]/20 active:scale-95'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                }`}
            >
              {isSubmitting
                ? <Loader2 size={18} className="animate-spin" />
                : <><Check size={18} /> {isAvaliada ? t('submit.feedback') : t('submit.score')}</>
              }
            </button>
          ) : (
            <div className="px-4 py-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-widest shrink-0">
              <Check size={14} /> {t('submit.saved')}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (showDeviceWrapper) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900/60 dark:bg-black/70 overflow-auto p-4">
        {terminalNode}
      </div>
    );
  }

  return terminalNode;
};

export default JudgeTerminal;
