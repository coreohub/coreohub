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
import { fetchTerminalData, fetchPreviousEvaluations, submitEvaluation as submitEvaluationViaApi, uploadAudio as uploadAudioViaApi } from '../services/judgeApi';

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
];

const DEMO_AWARDS: SpecialAward[] = [
  { id: 'tpl_bailarino',  name: 'Melhor Bailarino(a)', enabled: true, isTemplate: true, formation: 'Solo',  description: 'Melhor desempenho individual' },
  { id: 'tpl_revelacao',  name: 'Prêmio Revelação',    enabled: true, isTemplate: true, formation: 'Solo',  description: 'Estreante de destaque' },
  { id: 'tpl_coreografo', name: 'Melhor Coreógrafo',   enabled: true, isTemplate: true, formation: 'TODOS', description: 'Melhor trabalho coreográfico' },
  { id: 'tpl_grupo',      name: 'Melhor Grupo da Noite',enabled: true, isTemplate: true, formation: 'Grupo', description: 'Melhor desempenho em grupo' },
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
    // Confirmacao contextual: so se houver nota em rascunho (research-backed —
    // logout nao eh destrutivo, modal so atrita; padrao Twitter/Slack).
    // `scores` eh o state de notas digitadas (vai ser declarado abaixo).
    const hasDraft = Object.values(scoresRef.current ?? {}).some(v => v !== '' && v !== undefined && v !== null);
    if (hasDraft && !confirm('Sair? Sua nota em andamento será descartada.')) return;
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
  // Mantem scoresRef sincronizado com scores (usado por handleSwitchJudge)
  useEffect(() => { scoresRef.current = scores; }, [scores]);

  /* ── Special Awards (loaded from event config) ── */
  const [awardsConfig, setAwardsConfig] = useState<SpecialAward[]>([]);
  // Phase 3: marcações ⭐ por apresentação (Set de registration_id).
  // Substitui o modelo antigo de chips por prêmio — agora é 1 estrela curatorial,
  // a atribuição de prêmio acontece pós-bloco em /deliberacao.
  const [starredSet, setStarredSet] = useState<Set<string>>(new Set());
  const [starringInFlight, setStarringInFlight] = useState(false);

  // Phase 4: âncora central — qual apresentação está em palco AGORA segundo
  // a Mesa de Som. Quando muda, terminal mostra banner "AO VIVO" e auto-advance
  // após jurado submeter nota.
  const [liveRegistrationId, setLiveRegistrationId] = useState<string | null>(null);

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
          // Phase 2A: jurado logou via PIN, sem sessão de produtor.
          // Tudo vem da Edge Function (que valida o token + judge_id no backend).
          const td = await fetchTerminalData();
          jData = td.judges;
          cfg = td.config;
          sched = td.registrations;
          gData = td.event_styles;
          // Phase 3: hidrata estrelas previamente marcadas neste evento
          if (Array.isArray(td.marcacoes) && td.marcacoes.length > 0) {
            setStarredSet(new Set(td.marcacoes.map(m => m.registration_id)));
          }
          // Phase 4: hidrata âncora "ao vivo" da Mesa de Som
          setLiveRegistrationId(td.event?.live_registration_id ?? null);
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
              .select('live_registration_id')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
          jData = judgesRes.data;
          cfg = cfgRes;
          sched = schedRes.data;
          gData = gRes.data;
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

  /* ── Update criteria when performance changes ── */
  useEffect(() => {
    if (!currentPerformance) return;
    const newCriteria = resolveGenreCriteria(currentPerformance.estilo_danca, evalConfig, genreList);
    setActiveCriteria(newCriteria);
    setActiveField(newCriteria[0]?.name ?? '');
    setScores(initScores(newCriteria));
    setIsSubmitted(false);
    setSubmittedAt(null);
    setTieWarning(null);
    // starredSet NÃO reseta por apresentação — é global por jurado/evento.
    // O estado da estrela na apresentação atual vem de `starredSet.has(currentPerformance.id)`
  }, [currentIndex, currentPerformance?.estilo_danca, evalConfig, genreList, resolveGenreCriteria]);

  /* ── Phase 4: auto-advance pós-submit quando Mesa de Som troca a live ──
     Quando jurado já submeteu nota E a Mesa marcou outra apresentação como
     ao vivo, terminal pula automaticamente pra essa nova apresentação.
     Self-paced preservado: se ainda não submeteu, NÃO interrompe avaliação. */
  useEffect(() => {
    if (!liveRegistrationId || !isSubmitted) return;
    if (!filteredSchedule.length) return;
    if (currentPerformance?.id === liveRegistrationId) return;
    const liveIdx = filteredSchedule.findIndex((r: any) => r.id === liveRegistrationId);
    if (liveIdx < 0 || liveIdx === currentIndex) return;
    // Reset states (mesma lógica do handleAdvance, mas vai pro índice da live)
    setIsSubmitted(false);
    setSubmittedAt(null);
    rollingChunksRef.current = [];
    setMicAttempted(false);
    setTieWarning(null);
    setFeedbackText('');
    setCurrentIndex(liveIdx);
  }, [liveRegistrationId, isSubmitted, filteredSchedule, currentPerformance?.id, currentIndex]);

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
    } catch { /* mic denied */ }
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
        const { toggleStar } = await import('../services/judgeApi');
        await toggleStar(id);
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
      // Phase 3: highlights/destaques inline foram REMOVIDOS — atribuição de
      // prêmio especial agora acontece pós-bloco em /deliberacao a partir das
      // marcações ⭐ (tabela marcacoes_juri).

      let audioUrl: string | null = null;
      if (rollingChunksRef.current.length > 0) {
        const blob = new Blob(rollingChunksRef.current, { type: 'audio/webm' });
        if (judgeSession) {
          // Phase 2B: upload via Edge Function (sem produtor logado)
          try {
            audioUrl = await uploadAudioViaApi(currentPerformance.id, blob);
          } catch (e) {
            console.warn('Falha no upload de áudio via Edge Function:', e);
          }
        } else {
          // Fluxo legado: produtor/admin tem Storage permission via RLS
          const fn   = `feedback_${currentPerformance.id}_${selectedJudge.id}_${Date.now()}.webm`;
          const { data: up, error: ue } = await supabase.storage.from('audio-feedbacks').upload(fn, blob);
          if (!ue && up) audioUrl = supabase.storage.from('audio-feedbacks').getPublicUrl(fn).data.publicUrl;
        }
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
    setStarredSet(new Set());
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
    // starredSet persiste — é global por jurado/evento
    rollingChunksRef.current = [];
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
      className={`relative flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-3xl overflow-hidden select-none border border-slate-200 dark:border-slate-700 lg:max-w-7xl lg:mx-auto lg:w-full ${activeDeviceClass}`}
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
            <span className="text-[9px] font-black uppercase tracking-widest">AO VIVO:</span>
            <span className="text-[10px] font-black uppercase tracking-tight truncate">{liveReg.nome_coreografia}</span>
            <ChevronRight size={12} className="shrink-0" />
          </button>
        );
      })()}

      {/* ── Header — denso: 1 linha em mobile, 2 em tablet ── */}
      <header className="shrink-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-3 py-1.5 flex items-center justify-between gap-2">

        {/* Live + coreography info */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1 shrink-0">
            <div className={`w-1.5 h-1.5 rounded-full ${currentPerformance ? 'bg-rose-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-rose-500 hidden sm:inline">{t('header.live')}</span>
          </div>
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

          {/* Phase 3: ⭐ Marcar destaque pra deliberação pós-bloco.
              Em desktop (lg+) fica aqui no header; em mobile/tablet pequeno
              vai pra um botão grande abaixo dos critérios (ergonomia polegar). */}
          {currentPerformance && (() => {
            const starred = starredSet.has(currentPerformance.id);
            return (
              <button
                onClick={toggleStarCurrent}
                disabled={isSubmitted || starringInFlight}
                title={starred ? 'Remover marcação' : 'Marcar como destaque pra deliberação'}
                className={`hidden lg:inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all
                  ${isSubmitted
                    ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed'
                    : starred
                      ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900 shadow-sm'
                      : 'bg-white dark:bg-white/5 border-slate-300 dark:border-white/20 text-slate-600 dark:text-slate-300 hover:border-slate-500 dark:hover:border-white/50'
                  }`}
              >
                <Star size={12} className={starred ? 'fill-current' : ''} />
                <span className="text-[8px] font-black uppercase tracking-widest">
                  {starred ? 'Destaque' : 'Marcar'}
                </span>
              </button>
            );
          })()}

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
              <div className="flex-1 px-2 py-2 grid grid-cols-2 gap-1 content-start lg:grid-cols-1 lg:content-stretch lg:auto-rows-fr">
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

              {/* Phase 3: ⭐ Marcar destaque (visível só em mobile/tablet pequeno).
                  Em lg+ o botão fica no header. Aqui embaixo do painel de critérios
                  pra ergonomia (polegar alcança facil em landscape mobile/tablet),
                  com destaque visual pra não esquecer durante apresentação. */}
              {currentPerformance && (() => {
                const starred = starredSet.has(currentPerformance.id);
                return (
                  <div className="lg:hidden px-2 py-2 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
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
                      {starred ? 'Marcado como destaque' : 'Marcar destaque'}
                    </button>
                  </div>
                );
              })()}
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
                      Aguardando próxima apresentação
                    </p>
                  </div>

                  {/* Média final compacta */}
                  <div className="flex items-baseline gap-2">
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Média</span>
                    <span className={`text-3xl md:text-4xl font-black italic tabular-nums leading-none ${scoreGrade(calcWeightedAvg(), scoreScale)}`}>
                      {calcWeightedAvg()}
                    </span>
                  </div>

                  {/* Indicador de estrela quando esta apresentação foi marcada */}
                  {currentPerformance && starredSet.has(currentPerformance.id) && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 dark:bg-white border border-slate-900 dark:border-white rounded-full">
                      <Star size={9} className="text-white dark:text-slate-900 fill-current" />
                      <span className="text-[8px] font-black uppercase tracking-widest text-white dark:text-slate-900">
                        Marcada
                      </span>
                    </div>
                  )}

                  {/* Link sutil de fallback (caso produtor não avance fila) */}
                  <button
                    onClick={handleAdvance}
                    className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white underline underline-offset-2 transition-colors"
                  >
                    Avançar manualmente <ChevronRight size={10} />
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
                        disabled={isLastField}
                        className={`rounded-lg md:rounded-xl flex items-center justify-center transition-all touch-manipulation
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
                          title={`Preencha os ${missingCount} critérios restantes`}
                        >
                          Faltam {missingCount} {missingCount === 1 ? 'critério' : 'critérios'}
                        </button>
                      );
                    }

                    return (
                      <button
                        onClick={handleNext}
                        disabled={isLastField}
                        className={`shrink-0 w-full flex items-center justify-center gap-2 py-2 md:py-3 rounded-lg md:rounded-xl font-black text-xs uppercase tracking-widest transition-all touch-manipulation
                          ${isLastField
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
