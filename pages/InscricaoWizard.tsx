/**
 * Wizard de inscrição modalidade-first (PR-B).
 *
 * 4 passos numerados (Coreografia → Elenco → Trilha → Pagamento) — padrão
 * Sympla/Eventbrite. Único fluxo de inscrição (legado NewRegistration removido 2026-05-18).
 *
 * Rota: /festival/:idOrSlug/inscrever/:modalidade
 *
 * Decisões pragmáticas:
 * - Trilha sonora: aceita URL externa (Drive/WeTransfer) ou "anexar depois".
 *   Upload direto fica no fluxo legado de MinhasCoreografias (precisa setup
 *   de policies de Storage que já existem lá).
 * - Elenco: cria entries em `elenco` na hora pra cada bailarino novo, depois
 *   referencia em registrations.bailarinos_detalhes (mesmo padrão de
 *   MinhasCoreografias).
 * - Pagamento: cria registration com status AGUARDANDO_PAGAMENTO e redireciona
 *   pra Checkout.tsx existente — sem refazer integração Asaas.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  ChevronLeft, ChevronRight, Loader2, Music2, User, Users, Upload,
  AlertCircle, CheckCircle, Plus, Trash2, ArrowRight, Video,
} from 'lucide-react';
import { maskTempo, parseTempoSegundos, formatTempo, maskedChange } from '../utils/masks';
import { trackViewEvent } from '../services/producerAnalytics';
import ProducerPixels from '../components/ProducerPixels';

/** Marca um evento como "já trackeado" na sessão. Lido pelo Wizard pra
 *  evitar disparar view_event duplicado quando inscrito veio da vitrine
 *  (que já disparou). PublicEventPage seta isso após o próprio trackViewEvent. */
const VIEW_TRACKED_PREFIX = 'coreohub_viewed_';
const VIEW_TRACKED_TTL_MS = 5 * 60 * 1000; // 5min — depois disso vale re-trackear.
const wasRecentlyTracked = (eventId: string): boolean => {
  try {
    const ts = Number(sessionStorage.getItem(VIEW_TRACKED_PREFIX + eventId) ?? '0');
    return ts > 0 && Date.now() - ts < VIEW_TRACKED_TTL_MS;
  } catch { return false; }
};
const markAsTracked = (eventId: string): void => {
  try { sessionStorage.setItem(VIEW_TRACKED_PREFIX + eventId, String(Date.now())); }
  catch { /* sessionStorage indisponível (privado/embed) — ignore */ }
};

/** Persistência do rascunho do Wizard em localStorage.
 *  Inscrito perde tudo se clicar voltar do browser/checkout. Salva 1 draft por
 *  evento (chave coreohub:wizard:<eventId>), TTL 24h, limpa após submit. */
const WIZARD_DRAFT_PREFIX = 'coreohub:wizard:';
const WIZARD_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const readWizardDraft = (eventId: string): any | null => {
  try {
    const raw = localStorage.getItem(WIZARD_DRAFT_PREFIX + eventId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > WIZARD_DRAFT_TTL_MS) {
      localStorage.removeItem(WIZARD_DRAFT_PREFIX + eventId);
      return null;
    }
    return parsed.data ?? null;
  } catch { return null; }
};
const writeWizardDraft = (eventId: string, data: any): void => {
  try {
    localStorage.setItem(
      WIZARD_DRAFT_PREFIX + eventId,
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch { /* quota cheia / modo privado — ignora silenciosamente */ }
};
const clearWizardDraft = (eventId: string): void => {
  try { localStorage.removeItem(WIZARD_DRAFT_PREFIX + eventId); } catch { /* ignore */ }
};

/** Lê a duração de um arquivo de áudio em segundos via HTML5 Audio API.
 *  Retorna 0 se não conseguir ler (formato inválido, arquivo corrompido).
 *  Tem timeout de 10s — alguns browsers não disparam 'error' em codecs raros
 *  (WebM Opus em Safari, etc.) e a Promise nunca resolveria. */
const readAudioDuration = (file: File): Promise<number> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    let finished = false;
    const done = (dur: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      resolve(dur);
    };
    const timeoutId = setTimeout(() => done(0), 10000);
    audio.addEventListener('loadedmetadata', () => {
      const dur = isFinite(audio.duration) ? Math.round(audio.duration) : 0;
      done(dur);
    });
    audio.addEventListener('error', () => done(0));
  });

const inputCls = 'w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-5 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm dark:[color-scheme:dark]';
const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1';

interface BailarinoEntry {
  id?: string;          // preenchido após insert em `elenco`
  nome: string;
  cpf: string;
  data_nascimento: string;
  /** @ Instagram opcional. Solo/Duo/Trio: usado pra marcar em divulgações. */
  instagram_handle?: string;
}

interface WizardData {
  // Passo 1 — Coreografia
  nome_coreografia: string;
  estilo_danca: string;
  /** Modalidade do gênero (ex: K-Pop → Cover/Creative). Vazio quando o
   *  gênero selecionado não tem sub_types em event_styles. */
  subgenero: string;
  categoria: string;
  duracao_minutos: string;
  coreografo_nome: string;
  estudio_nome: string;
  tipo_apresentacao: 'Competitiva' | 'Avaliada' | '';
  // Passo 2 — Elenco
  bailarinos: BailarinoEntry[];
  /** Em GRUPO: @ do grupo ou coreógrafo, usado pra marcar nas divulgações.
   *  Solo/Duo/Trio usam o handle por bailarino acima. */
  instagram_principal?: string;
  // Passo 3 — Trilha (Modelo 1, sem seletiva) OU Vídeo (quando seletiva ativa)
  trilha_url: string;
  trilha_pendente: boolean;
  // Link da seletiva quando event.video_selection_enabled. Joinville-style: vídeo
  // é submetido NA inscrição (não em página separada). Trilha vai pra pós-aprovação.
  video_url: string;
}

const STEPS = [
  { key: 'coreografia', label: 'Coreografia' },
  { key: 'elenco',      label: 'Elenco' },
  { key: 'trilha',      label: 'Trilha' },
  { key: 'pagamento',   label: 'Pagamento' },
] as const;

const onlyDigits = (v: string) => v.replace(/\D/g, '');

const maskCPF = (v: string) => {
  const d = onlyDigits(v).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

const validCPF = (v: string) => {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
  let r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
  r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(d[10]);
};

/** Máscara DD/MM/AAAA pra input de data ao digitar. Aceita só dígitos.
 *  Ex: "31122020" → "31/12/2020". User reportou que calendário nativo trava
 *  a digitação livre — input mascarado é mais rápido pra ano antigo. */
const maskDateBR = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

/** "31/12/2020" → "2020-12-31" (formato ISO usado no banco).
 *  Retorna "" se a data não está completa ou é inválida. */
const dateBRtoISO = (v: string): string => {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  const year = parseInt(yyyy, 10);
  if (year < 1900 || year > new Date().getFullYear()) return '';
  if (month < 1 || month > 12) return '';
  if (day < 1 || day > 31) return '';
  return `${yyyy}-${mm}-${dd}`;
};

/** ISO "2020-12-31" → BR "31/12/2020" (display). */
const dateISOtoBR = (v: string): string => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return v;
  const [, yyyy, mm, dd] = m;
  return `${dd}/${mm}/${yyyy}`;
};

/** Input mascarado de data de nascimento (DD/MM/AAAA). Mantém state interno
 *  pra preservar digitação parcial sem perder ao re-render. Quando completa
 *  e válida, emite valor ISO pro parent. Quando parcial/inválida, emite ""
 *  (validação do submit pega). */
const DateInputBR: React.FC<{ value: string; onChange: (iso: string) => void; className?: string }> = ({ value, onChange, className }) => {
  // Inicializa com formato BR derivado do ISO recebido (ou string vazia)
  const [local, setLocal] = React.useState(() => dateISOtoBR(value || ''));
  // Sincroniza se o parent mudar value externamente (ex: reset de form)
  React.useEffect(() => {
    const fromIso = dateISOtoBR(value || '');
    // Só sobrescreve se o parent mandou algo diferente do que temos
    if (fromIso && fromIso !== local) setLocal(fromIso);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="DD/MM/AAAA"
      maxLength={10}
      value={local}
      onChange={e => {
        const masked = maskDateBR(e.target.value);
        setLocal(masked);
        onChange(dateBRtoISO(masked));
      }}
      className={className}
    />
  );
};

/** Calcula idade na data de referência. Mesma lógica do MinhasCoreografias.tsx legacy. */
const calcAgeOnDate = (dob: string, refDateStr: string): number => {
  if (!dob) return 0;
  if (!refDateStr) {
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }
  const birth = new Date(dob + 'T00:00:00');
  const ref   = new Date(refDateStr + 'T00:00:00');
  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
  return age;
};

/** Resolve a data de referência conforme modo configurado pelo produtor.
 *  EVENT_DAY: dia do evento. YEAR_END: 31/12 do ano. FIXED_DATE: data fixa. */
const resolveRefDate = (
  mode: 'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE' | undefined,
  fixedDate: string | null,
  eventDate: string | null,
): string => {
  if (mode === 'YEAR_END') {
    const year = eventDate
      ? new Date(eventDate + 'T12:00:00').getFullYear()
      : new Date().getFullYear();
    return `${year}-12-31`;
  }
  if (mode === 'FIXED_DATE' && fixedDate) return fixedDate;
  return eventDate || new Date().toISOString().slice(0, 10);
};

// Normaliza CAIXA ALTA pra Title Case (mantém "de/da" minúsculo). Evita que o
// inscrito grave nome de coreografia/estúdio/coreógrafo todo em maiúsculo.
const PARTICULAS_NOME = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'di', 'du', 'na', 'no']);
function normalizeNomeProprio(s: string): string {
  const t = (s ?? '').trim();
  if (!t) return t;
  const isAllCaps = t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t);
  if (!isAllCaps) return t;
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && PARTICULAS_NOME.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const InscricaoWizard: React.FC = () => {
  const { idOrSlug, modalidade: urlModalidade } = useParams<{ idOrSlug: string; modalidade?: string }>();
  // Permite trocar modalidade pelo select do Passo 1 SEM perder state preenchido.
  // Atualiza URL via History API (replaceState) — não dispara remount do componente.
  const [overrideModalidade, setOverrideModalidade] = useState<string | undefined>(undefined);
  const modalidade = overrideModalidade ?? urlModalidade;
  const navigate = useNavigate();

  const [event, setEvent] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  // Gêneros estruturados (event_styles) — fonte da verdade nova com sub_types.
  // Usado pra dropdown de modalidade dependente do gênero escolhido.
  const [eventStyles, setEventStyles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  // Fase 4B — gate de view_event quando inscrito chega no Wizard por link
  // direto (sem passar pela vitrine). Espera ProducerPixels chamar onReady
  // antes de disparar, e checa se a vitrine já trackou nessa sessão pra
  // não duplicar (sessionStorage flag, TTL 5min).
  const [pixelsReady, setPixelsReady] = useState(false);
  const [viewTracked, setViewTracked] = useState(false);

  // Configuração de tolerância e referência de idade do produtor (mesmo modelo
  // do MinhasCoreografias.tsx legacy). Default flexível 20% se config faltar.
  const [toleranceRule, setToleranceRule] = useState<{
    mode: 'PERCENT' | 'COUNT';
    value: number;
    enforcement: 'FLEXIBLE' | 'STRICT';
  }>({ mode: 'PERCENT', value: 20, enforcement: 'FLEXIBLE' });
  const [ageRefMode, setAgeRefMode] = useState<'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE'>('EVENT_DAY');
  const [ageRefFixedDate, setAgeRefFixedDate] = useState<string>('');

  const [data, setData] = useState<WizardData>({
    nome_coreografia: '',
    estilo_danca: '',
    subgenero: '',
    categoria: '',
    duracao_minutos: '',
    coreografo_nome: '',
    estudio_nome: '',
    tipo_apresentacao: '', // Sem pré-seleção quando ambos disponíveis (force escolha). Auto-set abaixo se só 1 habilitado.
    bailarinos: [{ nome: '', cpf: '', data_nascimento: '' }],
    trilha_url: '',
    trilha_pendente: false,
    video_url: '',
  });

  // Tipos de apresentação habilitados no evento (default: ambos pra retrocompat).
  // Lido de configuracoes.tipos_apresentacao. Se só houver um, força esse tipo.
  const [tiposApresentacao, setTiposApresentacao] = useState<string[]>(['Competitiva']);

  // ─── Upload de trilha (Supabase Storage bucket 'trilhas') ─────────────────
  const [trilhaFileName, setTrilhaFileName] = useState<string | null>(null);
  const [trilhaUploading, setTrilhaUploading] = useState(false);
  const [trilhaError, setTrilhaError] = useState<string | null>(null);
  const [trilhaDurationSeconds, setTrilhaDurationSeconds] = useState<number | null>(null);

  /** Troca a modalidade SEM remount do componente (preserva state preenchido).
   *  Atualiza URL via History API + state local + redimensiona array de bailarinos
   *  pro novo min_members da formação escolhida. */
  const handleChangeModalidade = (novoNome: string) => {
    if (!idOrSlug || !novoNome || novoNome === modalidade) return;
    setOverrideModalidade(novoNome);
    try {
      window.history.replaceState(
        null,
        '',
        `/festival/${idOrSlug}/inscrever/${encodeURIComponent(novoNome)}`,
      );
    } catch { /* navegadores muito antigos */ }
    // Ajusta tamanho do array de bailarinos pro min_members da nova formação.
    // Preserva nomes/CPFs já preenchidos quando possível (trunca ou adiciona vazios).
    const novaFormacao = ((event as any)?.formacoes_config ?? []).find(
      (m: any) => m.name?.trim().toLowerCase() === novoNome.trim().toLowerCase(),
    );
    const novoMin = Number(novaFormacao?.min_members ?? 1);
    setData(d => {
      const atuais = d.bailarinos ?? [];
      const next = atuais.length >= novoMin
        ? atuais.slice(0, novoMin)
        : [...atuais, ...Array.from({ length: novoMin - atuais.length }, () => ({ nome: '', cpf: '', data_nascimento: '' }))];
      return { ...d, bailarinos: next };
    });
  };

  const handleTrilhaUpload = async (file: File | null) => {
    if (!file || !userId) return;
    setTrilhaError(null);
    if (file.size > 30 * 1024 * 1024) {
      setTrilhaError('Arquivo muito grande. Máximo: 30 MB.');
      return;
    }
    const allowed = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/aac', 'audio/ogg'];
    if (!allowed.includes(file.type) && !/\.(mp3|m4a|wav|aac|ogg)$/i.test(file.name)) {
      setTrilhaError('Formato não suportado. Use MP3, M4A, WAV, AAC ou OGG.');
      return;
    }
    setTrilhaUploading(true);
    try {
      // Lê duração via HTML5 Audio API — pré-preenche o campo de duração
      // da coreografia se ainda estiver vazio (user pode editar pra menor).
      const durationSec = await readAudioDuration(file);

      // Se já havia trilha enviada (path interno, não URL externa), deleta o
      // arquivo antigo pra não acumular órfão no storage quando user troca.
      const pathAntigo = data.trilha_url;
      if (pathAntigo && !pathAntigo.startsWith('http')) {
        try { await supabase.storage.from('trilhas').remove([pathAntigo]); }
        catch (_e) { /* best-effort, não bloqueia upload novo */ }
      }

      const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
      const path = `${userId}/${event?.id ?? 'evento'}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('trilhas')
        // cacheControl 1 ano: o path já é único por timestamp (nunca sobrescreve
        // em uso real — upsert:false), então o conteúdo nunca muda depois de
        // salvo. Cache curto (era 1h) fazia o navegador rebaixar o arquivo
        // inteiro de novo a cada replay depois de 1h — achado real de egress
        // estourado no Supabase (801% da cota do plano Free).
        .upload(path, file, { cacheControl: '31536000', upsert: false });
      if (upErr) throw upErr;

      setData(d => ({
        ...d,
        trilha_url: path,
        trilha_pendente: false,
        // Auto-fill duração da coreografia com a da trilha quando vazia.
        // Trilha e coreografia são conceitos distintos (trilha pode ter intro/outro),
        // mas começar com o valor exato do arquivo evita erro de digitação.
        duracao_minutos: d.duracao_minutos || (durationSec > 0 ? formatTempo(durationSec) : ''),
      }));
      setTrilhaFileName(file.name);
      setTrilhaDurationSeconds(durationSec > 0 ? durationSec : null);
    } catch (e: any) {
      setTrilhaError(e?.message ?? 'Erro ao enviar trilha.');
    } finally {
      setTrilhaUploading(false);
    }
  };

  const handleTrilhaRemove = async () => {
    if (!data.trilha_url || data.trilha_url.startsWith('http')) {
      setData(d => ({ ...d, trilha_url: '' }));
      setTrilhaFileName(null);
      setTrilhaDurationSeconds(null);
      return;
    }
    try {
      await supabase.storage.from('trilhas').remove([data.trilha_url]);
    } catch (_e) { /* best-effort */ }
    setData(d => ({ ...d, trilha_url: '' }));
    setTrilhaFileName(null);
    setTrilhaDurationSeconds(null);
  };

  // ─── Load event + config + user ──────────────────────────────────────────
  // Suporta modalidade undefined (entry via /inscrever sem param) — nesse
  // caso o evento + config carrega normal, mas mostramos a tela de seleção
  // de modalidade (Passo 0) antes do passo 1.
  useEffect(() => {
    if (!idOrSlug) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Q2 padrão Sympla: redireciona pra login preservando rota de retorno.
        // Quando modalidade está presente, preserva ela na rota de retorno.
        const redirectPath = modalidade
          ? `/festival/${idOrSlug}/inscrever/${encodeURIComponent(modalidade)}`
          : `/festival/${idOrSlug}/inscrever`;
        navigate(`/login?redirectTo=${encodeURIComponent(redirectPath)}`);
        return;
      }
      setUserId(user.id);

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
      const filterCol = isUuid ? 'id' : 'slug';

      // Nota: registration_start_date/end_date ainda não existem como coluna
      // no DB (declaradas em types.ts mas sem migration). Não incluir no select
      // pra não disparar "column does not exist". Quando a feature de janela
      // de inscrições for criada, adicionar a migration e voltar aqui.
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, name, slug, formacoes_config, start_date, event_date, producer_ga4_id, producer_meta_pixel_id, video_selection_enabled, video_selection_fee_required, video_selection_fee, is_demo')
        .eq(filterCol, idOrSlug)
        .maybeSingle();

      // Separa erro de busca (RLS, network) de "não achou" pra debug futuro.
      if (evErr) {
        console.error('[InscricaoWizard] erro ao buscar evento:', evErr);
        setError(`Erro ao buscar evento: ${evErr.message}`);
        setLoading(false);
        return;
      }
      if (!ev) { setError('Evento não encontrado.'); setLoading(false); return; }

      // A2: valida que a modalidade da URL existe nas formacoes_config do evento.
      // Sem isso, salvaria string crua em formato_participacao (modalidade fantasma).
      // Quando modalidade não está na URL (entry via /inscrever sem param), pula
      // validação — vai cair na tela de seleção (Passo 0).
      if (modalidade) {
        const modalidadeMatch = (ev.formacoes_config ?? []).find((m: any) =>
          m.name?.trim().toLowerCase() === modalidade.trim().toLowerCase()
        );
        if (!modalidadeMatch) {
          setError(`Modalidade "${modalidade}" não está disponível neste evento. Volte e escolha uma modalidade da lista.`);
          setLoading(false);
          return;
        }
      }


      // Pré-popula coreógrafo com nome do user (ele loga, ele inscreve, aparece no recibo).
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();

      const [{ data: cfg }, { data: legacy }, { data: styles }] = await Promise.all([
        supabase.from('configuracoes').select('categorias, estilos, tolerancia, age_reference, age_reference_date, tipos_apresentacao, prazo_inscricao').eq('event_id', ev.id).maybeSingle(),
        supabase.from('configuracoes').select('categorias, estilos, tolerancia, age_reference, age_reference_date, tipos_apresentacao, prazo_inscricao').eq('id', '1').maybeSingle(),
        // Gêneros estruturados (com sub_types/modalidades). Source of truth nova.
        supabase.from('event_styles').select('id, name, is_active, sub_types').eq('event_id', ev.id).eq('is_active', true).order('name'),
      ]);
      setEventStyles(styles ?? []);
      const finalCfg = cfg && (cfg.categorias || cfg.estilos) ? cfg : legacy;

      // Prazo de inscrição (configuracoes.prazo_inscricao) vence às 23:59:59
      // do dia informado. Bloqueia entrada direta por link mesmo se o botão
      // da vitrine (PublicEventPage) já tiver sido burlado/cacheado.
      if (finalCfg?.prazo_inscricao) {
        const prazo = finalCfg.prazo_inscricao as string;
        const deadline = new Date((prazo.includes('T') ? prazo : prazo + 'T23:59:59'));
        if (Date.now() > deadline.getTime()) {
          setError('As inscrições para este evento já foram encerradas.');
          setLoading(false);
          return;
        }
      }

      // Aplica regra de tolerância e modo de referência etária do produtor.
      // Mesma estrutura usada em MinhasCoreografias.tsx — ref date conforme
      // ageRefMode + cálculo idade individual + violation enforcement.
      if (finalCfg?.tolerancia) {
        setToleranceRule({
          mode:        finalCfg.tolerancia.mode ?? 'PERCENT',
          value:       Number(finalCfg.tolerancia.value ?? 20),
          enforcement: finalCfg.tolerancia.enforcement ?? 'FLEXIBLE',
        });
      }
      if (finalCfg?.age_reference) setAgeRefMode(finalCfg.age_reference);
      if (finalCfg?.age_reference_date) setAgeRefFixedDate(finalCfg.age_reference_date);

      // A3: se config retorna null/vazia em both event + legacy, usuário ficaria
      // preso no Passo 1 com dropdowns vazios sem mensagem. Bloqueia explicitamente.
      const hasCategorias = Array.isArray(finalCfg?.categorias) && finalCfg.categorias.length > 0;
      const hasEstilos    = Array.isArray(finalCfg?.estilos)    && finalCfg.estilos.length    > 0;
      if (!hasCategorias || !hasEstilos) {
        setError('Este evento ainda não tem categorias ou estilos configurados. Contate o produtor antes de tentar se inscrever.');
        setLoading(false);
        return;
      }

      setConfig(finalCfg);
      setEvent(ev);

      // Tipos de apresentação habilitados pelo produtor (default Competitiva).
      // Se houver só 1 tipo, força automaticamente no state (sem perguntar).
      const tipos = Array.isArray(finalCfg?.tipos_apresentacao) && finalCfg.tipos_apresentacao.length > 0
        ? finalCfg.tipos_apresentacao
        : ['Competitiva'];
      setTiposApresentacao(tipos);
      if (tipos.length === 1) {
        setData(d => ({ ...d, tipo_apresentacao: tipos[0] as 'Competitiva' | 'Avaliada' }));
      }
      // Quando há 2+ tipos, mantém '' pra forçar o inscrito a escolher
      // conscientemente (evita inscrição errada por pré-seleção automática).

      if (profile?.full_name) {
        setData(d => ({ ...d, coreografo_nome: profile.full_name }));
      }

      // Ajusta tamanho do array de bailarinos pro mínimo da modalidade.
      // Só roda quando modalidade já está selecionada — senão fica pro
      // próximo carregamento (após user escolher no Passo 0).
      if (modalidade) {
        const formacao = (ev.formacoes_config ?? []).find((m: any) =>
          m.name?.trim().toLowerCase() === modalidade.trim().toLowerCase()
        );
        const minMembers = Number(formacao?.min_members ?? 1);
        setData(d => ({
          ...d,
          bailarinos: Array.from({ length: minMembers }, () => ({ nome: '', cpf: '', data_nascimento: '' })),
        }));
      }

      // Hidrata rascunho do localStorage (last write wins). Sempre depois dos
      // setData defaults acima pra sobrescrever pré-preenchimentos quando o
      // user já tinha algo em andamento — perda zero ao voltar do Asaas.
      const draft = readWizardDraft(String(ev.id));
      if (draft && typeof draft === 'object') {
        setData(d => ({ ...d, ...draft }));
      }

      setLoading(false);
    })();
  }, [idOrSlug, modalidade, navigate]);

  // Salva o rascunho em localStorage 300ms após cada mudança em `data`.
  // Debounce evita gravar a cada keystroke em arrays grandes de bailarinos.
  useEffect(() => {
    if (!event?.id || loading) return;
    const eventId = String(event.id);
    const handle = setTimeout(() => writeWizardDraft(eventId, data), 300);
    return () => clearTimeout(handle);
  }, [data, event?.id, loading]);

  const formacao = useMemo(() => {
    if (!event || !modalidade) return null;
    return (event.formacoes_config ?? []).find((m: any) =>
      m.name?.trim().toLowerCase() === modalidade.trim().toLowerCase()
    );
  }, [event, modalidade]);

  const minMembers = Number(formacao?.min_members ?? 1);
  // Defaults seguros baseados no NOME quando o produtor não setou max_members
  // explicitamente. Evita o bug do botão "Adicionar bailarino" em Solo (vi
  // no smoke test 2026-05-19): Solo deve ter max=1, Duo=2, Trio=3. Grupo
  // sem limite explícito = 50.
  const inferDefaultMax = (name: string | undefined): number => {
    const n = (name ?? '').trim().toLowerCase();
    if (n === 'solo') return 1;
    if (n === 'duo' || n === 'dupla')  return 2;
    if (n === 'trio') return 3;
    return 50;
  };
  const maxMembers = Number(formacao?.max_members ?? inferDefaultMax(formacao?.name));

  // Modelo seletiva (Joinville-style): inscrito submete LINK do vídeo no wizard
  // em vez da trilha sonora. Trilha vai pra pós-aprovação em /minhas-coreografias.
  // - isSeletivaMode = true → Passo 3 vira "Vídeo da Seletiva"
  // - videoLinkRequired = true → campo obrigatório (Modelo 2 + Modelo 3)
  const isSeletivaMode      = Boolean((event as any)?.video_selection_enabled);
  const videoLinkRequired   = isSeletivaMode && Boolean((event as any)?.video_selection_fee_required);

  // Label dinâmico do passo 2 conforme modo (Trilha vs Vídeo).
  const stepsForEvent = useMemo(() => STEPS.map((s, i) => (
    i === 2 && isSeletivaMode ? { ...s, label: 'Vídeo' } : s
  )), [isSeletivaMode]);

  const categorias: { name: string; min_age?: number; max_age?: number }[] = config?.categorias ?? [];
  // Estilos: prioriza event_styles (tabela nova, com sub_types). Fallback pra
  // configuracoes.estilos (legacy só com nomes) quando a nova tá vazia.
  const estilos: { name: string; sub_types?: any[] }[] = eventStyles.length > 0
    ? eventStyles.map((s: any) => ({
        name: s.name,
        sub_types: Array.isArray(s.sub_types) ? s.sub_types : [],
      }))
    : (config?.estilos ?? []).map((s: any) =>
        typeof s === 'string' ? { name: s, sub_types: [] } : { name: s.name ?? '', sub_types: s.sub_types ?? [] }
      ).filter((s: any) => s.name);

  // Modalidades (sub_types) do gênero selecionado. Quando vazio, select de
  // modalidade fica oculto — permite gênero direto sem subdivisão (Estilo Livre).
  const selectedStyleObj = estilos.find(s => s.name === data.estilo_danca);
  const modalities: { name: string }[] = (selectedStyleObj?.sub_types ?? [])
    .map((m: any) => ({ name: typeof m === 'string' ? m : (m.name ?? '') }))
    .filter((m: any) => m.name);

  // Categoria livre — flag setada pelo produtor em event_styles[].sub_types[].
  // Quando true, modalidade ignora restrição etária (ex: K-Pop > Cover Livre).
  // Esconde o select de categoria e salva categoria='Livre' no submit.
  const selectedModalityObj = (selectedStyleObj?.sub_types ?? []).find(
    (m: any) => (typeof m === 'string' ? m : m.name) === data.subgenero
  );
  const isCategoriaLivre = !!(
    selectedModalityObj && typeof selectedModalityObj === 'object' && (selectedModalityObj as any).is_categoria_livre
  );

  // Categoria selecionada (resolve min_age/max_age pra checagem etária).
  const categoriaSelecionada = useMemo(() => {
    return categorias.find(c => c.name === data.categoria) ?? null;
  }, [categorias, data.categoria]);

  // Data de referência pra cálculo de idade. Usa age_reference do produtor
  // (EVENT_DAY/YEAR_END/FIXED_DATE) sobre a data do evento.
  const refDate = useMemo(() => {
    const eventDate = event?.event_date ?? event?.start_date ?? null;
    return resolveRefDate(ageRefMode, ageRefFixedDate || null, eventDate);
  }, [event, ageRefMode, ageRefFixedDate]);

  // Status de tolerância: quantos bailarinos estão fora da faixa, % do total,
  // se viola a regra do produtor. Mesma estrutura do MinhasCoreografias.tsx.
  const toleranceStatus = useMemo(() => {
    if (!categoriaSelecionada || data.bailarinos.length === 0) {
      return { violates: false, outCount: 0, totalCount: 0, pct: 0, limitLabel: '', outNames: [] as string[] };
    }
    const minAge = Number(categoriaSelecionada.min_age ?? 0);
    const maxAge = Number(categoriaSelecionada.max_age ?? 99);
    const validBailarinos = data.bailarinos.filter(b => !!b.data_nascimento);
    const outOfRange = validBailarinos.filter(b => {
      const age = calcAgeOnDate(b.data_nascimento, refDate);
      return age < minAge || age > maxAge;
    });
    const outCount = outOfRange.length;
    const totalCount = validBailarinos.length;
    const pct = totalCount > 0 ? (outCount / totalCount) * 100 : 0;

    let violates = false;
    let limitLabel = '';
    if (toleranceRule.mode === 'PERCENT') {
      violates = pct > toleranceRule.value;
      limitLabel = `${toleranceRule.value}%`;
    } else {
      violates = outCount > toleranceRule.value;
      limitLabel = `${toleranceRule.value} pessoa(s)`;
    }
    return {
      violates, outCount, totalCount, pct, limitLabel,
      outNames: outOfRange.map(b => b.nome.trim() || 'sem nome'),
    };
  }, [categoriaSelecionada, data.bailarinos, refDate, toleranceRule]);

  // ─── Validação por passo ─────────────────────────────────────────────────
  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!data.nome_coreografia.trim()) return 'Informe o nome da coreografia.';
      if (!data.estilo_danca)              return 'Selecione o estilo.';
      // Modalidade obrigatória quando o gênero selecionado tem sub_types
      if (modalities.length > 0 && !data.subgenero) {
        return `Selecione a modalidade do gênero ${data.estilo_danca}.`;
      }
      // Categoria etária só é obrigatória quando a modalidade NÃO é livre.
      if (!isCategoriaLivre && !data.categoria) return 'Selecione a categoria etária.';
      if (data.duracao_minutos) {
        const sec = parseTempoSegundos(data.duracao_minutos);
        if (sec <= 0)        return 'Duração inválida. Use o formato MM:SS (ex: 03:45).';
        if (sec < 30)        return 'Duração muito curta. Mínimo: 00:30.';
        if (sec > 30 * 60)   return 'Duração muito longa. Máximo: 30:00.';
        // Item 1 auditoria 2026-05-17: valida contra max_time da modalidade.
        // Regulamentos típicos: Solo/Duo/Trio 2-3min, Grupo 3-5min.
        const maxTime = (formacao as any)?.max_time as string | undefined;
        const maxSec = maxTime ? parseTempoSegundos(maxTime) : 0;
        if (maxSec > 0 && sec > maxSec) {
          return `Duração (${data.duracao_minutos}) excede o máximo da modalidade ${modalidade} (${maxTime}). Reduza a duração ou troque de modalidade.`;
        }
      }
      if (!data.coreografo_nome.trim())    return 'Informe o nome do coreógrafo.';
      // Tipo de mostra obrigatório quando há 2+ opções habilitadas pelo produtor.
      // Quando há só 1, o state já foi auto-setado no load — não cai aqui.
      if (tiposApresentacao.length > 1 && !data.tipo_apresentacao) {
        return 'Selecione o tipo de mostra (Competitiva ou Avaliada).';
      }
    }
    if (s === 1) {
      if (data.bailarinos.length < minMembers) return `Adicione pelo menos ${minMembers} bailarino(s).`;
      if (data.bailarinos.length > maxMembers) return `Máximo ${maxMembers} bailarinos pra ${modalidade}.`;

      // Detecta CPF duplicado entre bailarinos da MESMA inscrição.
      // Cada CPF é único — mesma pessoa não pode ser cadastrada 2x na mesma coreografia.
      const cpfSeen = new Map<string, number>();
      for (let i = 0; i < data.bailarinos.length; i++) {
        const digits = data.bailarinos[i].cpf.replace(/\D/g, '');
        if (digits.length === 11) {
          const prev = cpfSeen.get(digits);
          if (prev !== undefined) {
            return `CPF duplicado: Bailarino ${prev + 1} e Bailarino ${i + 1} têm o mesmo CPF (${data.bailarinos[i].cpf}). Cada bailarino deve ter CPF único.`;
          }
          cpfSeen.set(digits, i);
        }
      }

      for (let i = 0; i < data.bailarinos.length; i++) {
        const b = data.bailarinos[i];
        const nomeTrim = b.nome.trim();
        if (!nomeTrim)               return `Bailarino ${i + 1}: informe o nome.`;
        // Nome completo: 2+ palavras (mínimo nome + sobrenome). Cada palavra
        // precisa de pelo menos 2 caracteres pra evitar "J K" ou "Ana A".
        const palavras = nomeTrim.split(/\s+/).filter(p => p.length >= 2);
        if (palavras.length < 2)     return `Bailarino ${i + 1}: informe o nome completo (nome + sobrenome).`;
        if (!validCPF(b.cpf))        return `Bailarino ${i + 1}: CPF inválido.`;
        if (!b.data_nascimento)      return `Bailarino ${i + 1}: informe a data de nascimento.`;
        // Regex estrita YYYY-MM-DD (4 dígitos no ano exatamente). type="date" tem
        // min/max mas browsers permissivos aceitam ano de 5-6 dígitos; bloqueamos aqui.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data_nascimento)) {
          return `Bailarino ${i + 1}: data de nascimento inválida.`;
        }
        const [anoStr, mesStr, diaStr] = b.data_nascimento.split('-');
        const ano = parseInt(anoStr, 10);
        const mes = parseInt(mesStr, 10);
        const dia = parseInt(diaStr, 10);
        const anoAtual = new Date().getFullYear();
        if (ano < 1900 || ano > anoAtual || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
          return `Bailarino ${i + 1}: data de nascimento inválida.`;
        }
      }
      // Tolerância: STRICT bloqueia, FLEXIBLE deixa passar (mas grava flag em event_data
      // pra produtor ver no painel — mesma regra do MinhasCoreografias.tsx legacy).
      if (toleranceRule.enforcement === 'STRICT' && toleranceStatus.violates) {
        return `Tolerância excedida: ${toleranceStatus.outCount} bailarino(s) fora da faixa "${data.categoria}". Limite do evento: até ${toleranceStatus.limitLabel}.`;
      }
    }
    if (s === 2) {
      if (isSeletivaMode) {
        // Modo seletiva: passo é "Vídeo da Seletiva" em vez de "Trilha".
        // Trilha vai pra pós-aprovação.
        if (videoLinkRequired && !data.video_url?.trim()) {
          return 'Informe o link do vídeo da seletiva.';
        }
        if (data.video_url?.trim()) {
          const url = data.video_url.trim();
          try { new URL(url); }
          catch { return 'Link do vídeo inválido. Cole a URL completa (https://...).'; }
          // Padrão dos festivais BR (Joinville, Catanduva, SESI): seletiva por
          // vídeo único, não playlist. Rejeita URLs com `list=` ou /playlist —
          // jurado precisa de 1 link de 1 vídeo (sem navegar entre vários).
          const lower = url.toLowerCase();
          const hasListParam = /[?&]list=/.test(lower);
          const isPlaylistRoute = /youtube\.com\/playlist\b/.test(lower);
          if (hasListParam || isPlaylistRoute) {
            return 'Cole o link de UM vídeo específico (não playlist). Remova `&list=...` da URL ou copie de novo direto do vídeo.';
          }
        }
      }
      // Modo Trilha (não-seletiva): nada obrigatório — pode "anexar depois".
    }
    return null;
  };

  const advance = () => {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError(null);
    setStep(s => Math.min(3, (s + 1)) as 0 | 1 | 2 | 3);
  };

  const back = () => {
    setError(null);
    setStep(s => Math.max(0, s - 1) as 0 | 1 | 2 | 3);
  };

  // ─── Submit final: cria elenco entries + registration + redireciona ──────
  const handleSubmit = async () => {
    const err = validateStep(2);
    if (err) { setError(err); return; }
    setSubmitting(true);
    setError(null);

    // Modelo 3 (taxa A obrigatória > 0): CPF é necessário pra emitir cobrança
    // Asaas. Sem ele a registration é criada mas a cobrança falha — wizard
    // ficava num estado intermediário ruim. Bloqueia antes do submit.
    if (isSeletivaMode && videoLinkRequired && Number((event as any)?.video_selection_fee ?? 0) > 0) {
      const { data: profSnap } = await supabase
        .from('profiles')
        .select('cpf_cnpj')
        .eq('id', userId!)
        .maybeSingle();
      const cpfDigits = (profSnap?.cpf_cnpj ?? '').replace(/\D/g, '');
      if (!cpfDigits) {
        setError('Pra pagar a taxa de seletiva você precisa cadastrar CPF/CNPJ no perfil. Acesse "Meu Perfil" antes de confirmar.');
        setSubmitting(false);
        return;
      }
    }

    try {
      // 1) Cria entries de elenco em batch (uma por bailarino).
      //    RLS: user só insere com user_id próprio.
      const elencoRows = data.bailarinos.map(b => ({
        user_id:         userId,
        nome:            b.nome.trim(),
        cpf:             onlyDigits(b.cpf),
        data_nascimento: b.data_nascimento,
      }));
      const { data: elencoCreated, error: elencoErr } = await supabase
        .from('elenco')
        .insert(elencoRows)
        .select('id, nome');
      if (elencoErr) throw new Error('Erro ao criar elenco: ' + elencoErr.message);

      // Faz join entre o que o Supabase retornou (id + nome) e o input local
      // pra capturar o @ Instagram informado no wizard. Solo/Duo/Trio usam
      // bailarinos_detalhes[].instagram_handle; grupo usa instagram_principal.
      const bailarinosDetalhes = (elencoCreated ?? []).map((b, idx) => ({
        id:               b.id,
        nome:             b.nome,
        instagram_handle: data.bailarinos[idx]?.instagram_handle?.trim() || null,
      }));
      const createdElencoIds   = (elencoCreated ?? []).map(b => b.id);

      // M2: salva metadados legacy (event_nome, mod_fee) em event_data pra
      // compat com MinhasCoreografias.tsx que lê esses campos pra exibir.
      const firstLote = (formacao?.lotes ?? [])[0];
      const modFee = firstLote?.preco ?? formacao?.fee ?? formacao?.base_fee ?? 0;

      // UTMs salvos quando inscrito chegou na vitrine via link rastreável
      // (?utm_source=instagram&utm_campaign=2026). Fase 4 — Atribuição de vendas.
      const utms = (await import('../services/utmTracking')).getUtmsForRegistration();

      // Snapshot dos dados de contato do inscrito direto na registration.
      // Imutável após o insert — protege produtor caso o inscrito delete a
      // conta um dia (LGPD). Padrão de fatura/recibo de e-commerce.
      const [{ data: { user: authUser } }, { data: profileSnap }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('profiles').select('full_name, whatsapp, cpf_cnpj').eq('id', userId!).maybeSingle(),
      ]);

      // CPF do pagador — auto-captura SÓ em Solo. Num solo, o bailarino é, na
      // prática, o próprio pagador, então adota o CPF dele no perfil pra a tela
      // de pagamento já vir pré-preenchida (editável pra confirmar). Em duo/
      // trio/grupo o pagador é o coreógrafo — que NÃO é necessariamente o 1º
      // bailarino —, então não chuta: o pagamento coleta o CPF do responsável
      // uma vez. Best-effort: não bloqueia a inscrição se falhar, e nunca
      // sobrescreve um CPF de pagamento já salvo no perfil.
      const isSoloInscricao = data.bailarinos.length === 1;
      if (isSoloInscricao && !profileSnap?.cpf_cnpj) {
        const soloCpf = onlyDigits(data.bailarinos[0]?.cpf ?? '');
        if (soloCpf.length === 11) {
          try {
            await supabase
              .from('profiles')
              .update({ cpf_cnpj: soloCpf, document: soloCpf })
              .eq('id', userId!);
          } catch { /* best-effort — pagamento ainda coleta CPF se isto falhar */ }
        }
      }

      // 2) Cria registration. Status AGUARDANDO_PAGAMENTO — Checkout completa.
      const { data: reg, error: regErr } = await supabase
        .from('registrations')
        .insert({
          event_id:             event.id,
          user_id:              userId,
          inscrito_nome:        profileSnap?.full_name ?? null,
          inscrito_email:       authUser?.email ?? null,
          inscrito_whatsapp:    profileSnap?.whatsapp ?? null,
          ...(utms ?? {}),
          nome_coreografia:     normalizeNomeProprio(data.nome_coreografia),
          estilo_danca:         data.estilo_danca || null,
          subgenero:            data.subgenero || null,
          // Modalidade marcada como Livre pelo produtor não exige categoria etária.
          categoria:            isCategoriaLivre ? 'Livre' : data.categoria,
          formato_participacao: formacao?.name ?? modalidade,
          tipo_apresentacao:    data.tipo_apresentacao,
          bailarinos_detalhes:  bailarinosDetalhes,
          instagram_principal:  data.instagram_principal?.trim() || null,
          // Modo seletiva: trilha sonora vai pra pós-aprovação em /minhas-coreografias.
          // Modo normal: trilha submetida no wizard (legado).
          trilha_url:           isSeletivaMode ? null : (data.trilha_pendente ? null : (data.trilha_url || null)),
          status_trilha:        isSeletivaMode ? 'PENDENTE' : (data.trilha_pendente || !data.trilha_url ? 'PENDENTE' : 'ENVIADA'),
          // Vídeo da seletiva (Joinville-style): submetido aqui, não em /seletiva.
          // video_status='submitted' → cai direto na fila de análise do produtor
          // após pagamento da taxa A (ou imediatamente se Modelo 2 grátis).
          video_url:            isSeletivaMode && data.video_url?.trim() ? data.video_url.trim() : null,
          video_status:         isSeletivaMode && data.video_url?.trim() ? 'submitted' : null,
          video_submitted_at:   isSeletivaMode && data.video_url?.trim() ? new Date().toISOString() : null,
          // Duração do arquivo de áudio em si (extraída via HTML5 Audio API).
          // Distinto de event_data.duracao_segundos (duração da COREOGRAFIA).
          duracao_trilha_segundos: trilhaDurationSeconds ?? null,
          // `status` aposentado em 2026-06-30 — nunca era atualizado pós-criação
          // e vivia dessincronizado. status_pagamento é a fonte única. Deixa o
          // default do banco ('pendente') preencher pra não quebrar leitor legado.
          status_pagamento:     'PENDENTE',
          criado_em:            new Date().toISOString(),
          data_inscricao:       new Date().toISOString(),
          event_data: (() => {
            const duracaoSec = data.duracao_minutos ? parseTempoSegundos(data.duracao_minutos) : 0;
            return {
              event_nome:       event.name ?? '',
              mod_fee:          Number(modFee) || 0,
              // Duração da COREOGRAFIA em segundos (precisão exata).
              duracao_segundos: duracaoSec || null,
              // Legacy: mantém duracao_minutos em decimal pra compat com
              // MinhasCoreografias.tsx que lê esse campo. Pode ser removido
              // quando todas as views forem migradas pra duracao_segundos.
              duracao_minutos:  duracaoSec ? Math.round((duracaoSec / 60) * 100) / 100 : null,
              coreografo_nome:  normalizeNomeProprio(data.coreografo_nome),
              estudio_nome:     normalizeNomeProprio(data.estudio_nome) || null,
              wizard_version:   'PR-B-2026-05-08',
              // Flag pra produtor ver no painel (legacy MinhasCoreografias).
              // Só salva quando há violação real — caso contrário, null.
              tolerance_violation: toleranceStatus.violates ? {
                out_count:    toleranceStatus.outCount,
                total_count:  toleranceStatus.totalCount,
                pct:          Math.round(toleranceStatus.pct * 10) / 10,
                limit_label:  toleranceStatus.limitLabel,
                mode:         toleranceRule.mode,
                flagged_at:   new Date().toISOString(),
                source:       'wizard',
              } : null,
            };
          })(),
        })
        .select('id')
        .single();

      // A1: rollback do elenco criado se registration falha. Sem isso, próxima
      // tentativa cria duplicatas no cadastro pessoal do user.
      if (regErr || !reg) {
        if (createdElencoIds.length > 0) {
          await supabase.from('elenco').delete().in('id', createdElencoIds);
        }
        throw regErr ?? new Error('Erro ao criar inscrição.');
      }

      // Registration commitada — rascunho não é mais útil. Limpa antes de
      // qualquer branch de saída pra cobrir tanto navigate quanto window.location.
      clearWizardDraft(String(event.id));

      // 3) Branching pelo modelo de seletiva (Sessão seletiva v1):
      //    Modelo 3 (taxa A obrigatória + valor > 0): marca AGUARDANDO_VIDEO,
      //      cria cobrança da taxa A e redireciona pro checkout Asaas.
      //    Modelo 2 (taxa A obrigatória + valor R$ 0): marca AGUARDANDO_VIDEO
      //      + video_fee_status='waived' e manda direto pro /seletiva.
      //    Modelo 1 / sem seletiva: fluxo normal do carrinho (/minhas-coreografias).
      const evWithSelecao = event as any;
      const requiresVideoSel = Boolean(evWithSelecao?.video_selection_enabled) && Boolean(evWithSelecao?.video_selection_fee_required);
      const videoFee         = Number(evWithSelecao?.video_selection_fee ?? 0);

      if (requiresVideoSel && videoFee > 0) {
        // Em evento DEMO (is_demo=true), pula Asaas e marca taxa waived — vai
        // direto pra /minhas-coreografias pro inscrito ver a inscrição criada
        // sem cobrar R$ real. Sem isso, testar o fluxo no demo gerava cobrança
        // real (reportado em 2026-05-21).
        if ((event as any)?.is_demo) {
          await supabase
            .from('registrations')
            .update({ status_pagamento: 'AGUARDANDO_VIDEO', video_fee_status: 'waived' })
            .eq('id', reg.id);
          navigate(`/minhas-coreografias?nova=${reg.id}`);
          return;
        }
        // Modelo 3 — cobra taxa de seletiva antes do upload do vídeo.
        await supabase
          .from('registrations')
          .update({ status_pagamento: 'AGUARDANDO_VIDEO', video_fee_status: 'pending' })
          .eq('id', reg.id);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const r = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-video-selection-payment`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session?.access_token ?? ''}`,
                'Content-Type':  'application/json',
              },
              body: JSON.stringify({ registration_id: reg.id, event_id: event.id }),
            }
          );
          const payload = await r.json();
          if (!r.ok) throw new Error(payload.error ?? 'Erro ao criar cobrança da taxa de seletiva.');
          if (payload.invoice_url) {
            window.location.href = payload.invoice_url;
            return;
          }
        } catch (e: any) {
          // Rota correta é /minha-seletiva (não /seletiva). Edge function pode
          // falhar por CPF faltando — mensagem clara pro inscrito completar
          // perfil e retomar pela página de status da seletiva.
          const msg = String(e.message ?? '');
          const isCpfMissing = msg.toLowerCase().includes('cpf');
          setError(
            isCpfMissing
              ? `Pra pagar a taxa de seletiva você precisa completar seu CPF no perfil. Acesse "Meu Perfil" → CPF e volte em "Minha Seletiva" pra retomar.`
              : `Inscrição criada mas falha ao gerar cobrança: ${msg}. Acesse "Minha Seletiva" pra retomar.`
          );
          navigate(isCpfMissing ? '/profile' : '/minha-seletiva');
          return;
        }
      } else if (requiresVideoSel && videoFee === 0) {
        // Modelo 2 — inscrição provisória grátis, vídeo é pré-requisito do
        // pagamento da inscrição cheia.
        await supabase
          .from('registrations')
          .update({ status_pagamento: 'AGUARDANDO_VIDEO', video_fee_status: 'waived' })
          .eq('id', reg.id);
        navigate('/minha-seletiva');
        return;
      }

      // Modelo 1 / sem seletiva — carrinho padrão Sessão 2.
      // Param `nova=<id>` permite a UI destacar/animar a inscrição recém-criada.
      navigate(`/minhas-coreografias?nova=${reg.id}`);
    } catch (e: any) {
      setError(e.message ?? 'Erro inesperado ao finalizar inscrição.');
      setSubmitting(false);
    }
  };

  // Fase 4B — view_event quando user chega no Wizard por link direto.
  // Quem veio da vitrine já foi trackeado lá: PublicEventPage marca
  // sessionStorage flag com TTL 5min e a gente respeita isso aqui pra
  // não duplicar a conversão. Endereçamento explícito pros pixels do
  // produtor evita pollution com pixel de outro festival na mesma sessão.
  useEffect(() => {
    if (!event || !pixelsReady || viewTracked) return;
    const eventId = String(event.id);
    if (wasRecentlyTracked(eventId)) {
      setViewTracked(true);
      return;
    }
    trackViewEvent(
      {
        event_slug: (event as any).slug ?? eventId,
        event_name: (event as any).name ?? 'Festival',
      },
      {
        ga4:   (event as any).producer_ga4_id,
        pixel: (event as any).producer_meta_pixel_id,
      },
    );
    markAsTracked(eventId);
    setViewTracked(true);
  }, [event, pixelsReady, viewTracked]);

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-md">
          <AlertCircle size={40} className="text-rose-400 mx-auto" />
          <p className="font-black text-xl text-slate-900 dark:text-white">Não foi possível abrir a inscrição</p>
          <p className="text-slate-500 text-sm">{error}</p>
          {idOrSlug && (
            <button
              onClick={() => navigate(`/festival/${idOrSlug}`)}
              className="mt-4 inline-flex items-center gap-2 px-5 py-3 bg-[#ff0068] text-white rounded-xl font-black text-xs uppercase tracking-widest"
            >
              <ChevronLeft size={14} /> Voltar pro festival
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Passo 0: Seleção de modalidade ────────────────────────────────────
  // Renderizado APENAS quando inscrito chegou via /inscrever (sem :modalidade
  // na URL — entry genérico: site externo, link compartilhado, botão "Inscreva-se"
  // do header). Cards visuais mostram cada formação com nome + min/max + preço.
  // Click navega pra /inscrever/<Nome> que recarrega esse mesmo componente
  // com modalidade preenchida e pula direto pro Passo 1 (Coreografia).
  if (event && !modalidade) {
    const formacoes: any[] = Array.isArray((event as any).formacoes_config)
      ? (event as any).formacoes_config
      : [];
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-32">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-white/5 px-4 py-4">
          <div className="max-w-4xl mx-auto">
            <button
              onClick={() => navigate(`/festival/${idOrSlug}`)}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] inline-flex items-center gap-1"
            >
              <ChevronLeft size={12} /> Voltar pro festival
            </button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 dark:text-white italic">
              Como você vai se apresentar?
            </h1>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Escolha a modalidade. Você pode trocar depois durante a inscrição se mudar de ideia.
            </p>
          </div>
          {formacoes.length === 0 ? (
            <div className="text-center text-slate-500 text-sm">
              Este festival ainda não tem modalidades configuradas. Contate o produtor.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {formacoes.map((f: any) => {
                const min = Number(f.min_members ?? 1);
                const max = Number(f.max_members ?? min);
                const lotes = Array.isArray(f.lotes) ? f.lotes : [];
                const preco = lotes[0]?.preco ?? f.fee ?? 0;
                const perMember = f.pricing_type === 'PER_MEMBER';
                const peopleLabel = min === max
                  ? `${min} ${min === 1 ? 'pessoa' : 'pessoas'}`
                  : `${min}–${max === 99 ? '∞' : max} pessoas`;
                return (
                  <button
                    key={f.name}
                    onClick={() => navigate(`/festival/${idOrSlug}/inscrever/${encodeURIComponent(f.name)}`)}
                    className="group text-left p-5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl hover:border-[#ff0068] hover:shadow-lg hover:shadow-[#ff0068]/10 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      {min === 1 ? <User size={18} className="text-[#ff0068]" />
                                  : <Users size={18} className="text-[#ff0068]" />}
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-[#ff0068]">
                        {peopleLabel}
                      </span>
                    </div>
                    <p className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">
                      {f.name}
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[#ff0068] font-black text-xl">
                        R$ {Number(preco).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                      {perMember && (
                        <span className="text-[9px] font-bold text-slate-400 uppercase">/pessoa</span>
                      )}
                    </div>
                    <div className="mt-4 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-[#ff0068] transition-colors">
                      Começar <ChevronRight size={12} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-32">
      {/* Fase 4B — pixels do produtor + view_event de link direto.
          Quando inscrito cai aqui SEM passar pela vitrine (link de Insta,
          QR code da modalidade, etc), o view_event nunca seria disparado.
          Aqui dispara só se a vitrine não trackou nessa sessão (flag em
          sessionStorage com TTL 5min, setado lá ao carregar). */}
      {event && (
        <ProducerPixels
          ga4Id={(event as any).producer_ga4_id}
          metaPixelId={(event as any).producer_meta_pixel_id}
          onReady={() => setPixelsReady(true)}
        />
      )}
      {/* Header com progresso ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-white/5 px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => navigate(`/festival/${idOrSlug}`)}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] inline-flex items-center gap-1"
            >
              <ChevronLeft size={12} /> Voltar
            </button>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {modalidade} · Passo {step + 1} de 4
            </p>
          </div>
          <div className="flex items-center gap-2">
            {stepsForEvent.map((s, i) => (
              <div key={s.key} className="flex-1 flex items-center gap-2">
                <div
                  className={`h-2 flex-1 rounded-full transition-colors ${
                    i < step ? 'bg-[#ff0068]' : i === step ? 'bg-[#ff0068]' : 'bg-slate-200 dark:bg-white/10'
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            {stepsForEvent.map((s, i) => (
              <span
                key={s.key}
                className={`text-[9px] font-black uppercase tracking-widest ${
                  i === step ? 'text-[#ff0068]' : 'text-slate-400'
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Conteúdo do passo atual ──────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* ─── Passo 0: Coreografia ─────────────────────────────────────── */}
        {step === 0 && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Music2 size={18} /></div>
              <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">Sobre sua coreografia</h2>
            </div>

            {/* Modalidade — selecionável a qualquer momento. Trocar reorganiza
                o array de bailarinos no Passo 2 mas preserva o resto preenchido.
                Sempre visível pra reforçar contexto (user sabe que tá em Solo,
                pode trocar pra Duo sem refazer tudo).
                Item 3 auditoria 2026-05-17: mostra preço no chip pra user ver
                custo da modalidade antes/durante a inscrição (evita surpresa
                no checkout). PER_MEMBER adiciona "/p" pra deixar claro. */}
            {Array.isArray((event as any)?.formacoes_config) && (event as any).formacoes_config.length > 0 && (
              <div>
                <label className={labelCls}>Modalidade *</label>
                <div className="flex flex-wrap gap-2">
                  {(event as any).formacoes_config.map((f: any) => {
                    const isActive = f.name?.trim().toLowerCase() === modalidade?.trim().toLowerCase();
                    const lotes = Array.isArray(f.lotes) ? f.lotes : [];
                    const preco = lotes[0]?.preco ?? f.fee ?? 0;
                    const perMember = f.pricing_type === 'PER_MEMBER';
                    const precoLabel = preco > 0
                      ? `R$ ${Number(preco).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${perMember ? '/p' : ''}`
                      : null;
                    return (
                      <button
                        key={f.name}
                        type="button"
                        onClick={() => handleChangeModalidade(f.name)}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 ${
                          isActive
                            ? 'bg-[#ff0068] border-[#ff0068] text-white shadow-md shadow-[#ff0068]/20'
                            : 'bg-transparent border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-[#ff0068]/40 hover:text-[#ff0068]'
                        }`}
                      >
                        <span>{f.name}</span>
                        {precoLabel && (
                          <span className={`text-[9px] font-bold ${isActive ? 'text-white/80' : 'text-slate-400'}`}>
                            {precoLabel}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-2">
                  Pode trocar a qualquer momento — o resto do preenchimento é preservado.
                </p>
              </div>
            )}

            <div>
              <label className={labelCls}>Nome da coreografia *</label>
              <input
                type="text"
                value={data.nome_coreografia}
                onChange={e => setData(d => ({ ...d, nome_coreografia: e.target.value }))}
                placeholder='Ex: "Renascer", "Voar"'
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Estilo *</label>
                <select
                  value={data.estilo_danca}
                  onChange={e => setData(d => ({ ...d, estilo_danca: e.target.value, subgenero: '' }))}
                  className={inputCls}
                >
                  <option value="">Selecione…</option>
                  {estilos.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>

              {/* Modalidade (sub_type) — só aparece quando o gênero tem sub_types.
                  Ex: K-Pop → Cover/Creative. Estilos diretos (sem sub_types)
                  pulam esse campo. */}
              {modalities.length > 0 && (
                <div>
                  <label className={labelCls}>Modalidade *</label>
                  <select
                    value={data.subgenero}
                    onChange={e => setData(d => ({ ...d, subgenero: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Selecione a modalidade…</option>
                    {modalities.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
              )}

              {isCategoriaLivre ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
                    Categoria Livre
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Esta modalidade ({data.subgenero}) não tem restrição de idade.
                  </p>
                </div>
              ) : (
                <div>
                  <label className={labelCls}>Categoria etária *</label>
                  <select
                    value={data.categoria}
                    onChange={e => setData(d => ({ ...d, categoria: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Selecione…</option>
                    {categorias.map(c => (
                      <option key={c.name} value={c.name}>
                        {c.name}{c.min_age != null ? ` (${c.min_age}–${c.max_age != null && c.max_age < 99 ? c.max_age : '+'} anos)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Duração (MM:SS)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={data.duracao_minutos}
                  onChange={e => maskedChange(e, maskTempo, v => setData(d => ({ ...d, duracao_minutos: v })))}
                  placeholder="Ex: 03:45"
                  maxLength={5}
                  className={inputCls}
                />
                {/* Validação visual contra max_time da modalidade (item 1 da
                    auditoria 2026-05-17). Mostra ✓ quando dentro do limite,
                    ⚠️ quando excede. Submit fica bloqueado quando excede. */}
                {(() => {
                  const sec = data.duracao_minutos ? parseTempoSegundos(data.duracao_minutos) : 0;
                  const maxStr = (formacao as any)?.max_time as string | undefined;
                  const maxSec = maxStr ? parseTempoSegundos(maxStr) : 0;
                  if (!sec) {
                    return (
                      <p className="text-[9px] text-slate-400 mt-1">
                        Formato minuto:segundo. {maxSec > 0 ? `Máx. da ${modalidade}: ${maxStr}.` : 'Sem limite definido nesta modalidade — confira o regulamento.'}
                      </p>
                    );
                  }
                  if (maxSec > 0 && sec > maxSec) {
                    return (
                      <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 font-bold">
                        ⚠ Excede o máximo da modalidade {modalidade} ({maxStr}). Reduza a duração ou troque pra uma modalidade com tempo maior.
                      </p>
                    );
                  }
                  if (maxSec > 0) {
                    return (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
                        ✓ Dentro do limite ({maxStr} é o máximo da {modalidade}).
                      </p>
                    );
                  }
                  return (
                    <p className="text-[9px] text-slate-400 mt-1">
                      Formato minuto:segundo. Sem limite definido nesta modalidade — confira o regulamento.
                    </p>
                  );
                })()}
              </div>

              <div>
                <label className={labelCls}>Coreógrafo(a) *</label>
                <input
                  type="text"
                  value={data.coreografo_nome}
                  onChange={e => setData(d => ({ ...d, coreografo_nome: e.target.value }))}
                  placeholder="Quem coreografou"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Estúdio/escola (opcional)</label>
              <input
                type="text"
                value={data.estudio_nome}
                onChange={e => setData(d => ({ ...d, estudio_nome: e.target.value }))}
                placeholder="Independente"
                className={inputCls}
              />
            </div>

            {/* Tipo de apresentação — só aparece se o evento habilitou ambos.
                Se for só 1, já foi forçado no state pelo load do config. */}
            {tiposApresentacao.length > 1 && (
              <div>
                <label className={labelCls}>Tipo de mostra</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                  {tiposApresentacao.map(tipo => {
                    const selected = data.tipo_apresentacao === tipo;
                    const isCompetitiva = tipo === 'Competitiva';
                    // Nome completo "Mostra Competitiva" / "Mostra Avaliada" —
                    // padrão do mercado de festivais BR. Estado interno mantém
                    // só "Competitiva"/"Avaliada" pra compat com banco/lógica.
                    const fullName = isCompetitiva ? 'Mostra Competitiva' : 'Mostra Avaliada';
                    return (
                      <button
                        key={tipo}
                        type="button"
                        onClick={() => setData(d => ({ ...d, tipo_apresentacao: tipo as 'Competitiva' | 'Avaliada' | '' }))}
                        className={`text-left p-3 rounded-xl border transition-all ${
                          selected
                            ? 'border-[#ff0068] bg-[#ff0068]/5'
                            : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                        }`}
                      >
                        <p className={`text-[11px] font-black uppercase tracking-tight ${selected ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
                          {fullName}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">
                          {isCompetitiva
                            ? 'Concorre a prêmio e ranking por categoria.'
                            : 'Recebe feedback técnico dos jurados, sem competir.'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Passo 1: Elenco ──────────────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]">
                {minMembers === 1 ? <User size={18} /> : <Users size={18} />}
              </div>
              <div>
                <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  {minMembers === 1 ? 'Quem vai dançar' : 'Elenco do grupo'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {minMembers === maxMembers
                    ? `${modalidade} aceita ${minMembers} bailarino${minMembers > 1 ? 's' : ''}.`
                    : `${modalidade}: de ${minMembers} a ${maxMembers} bailarinos.`}
                </p>
              </div>
            </div>

            {data.bailarinos.map((b, i) => (
              <div key={i} className="border border-slate-200 dark:border-white/10 rounded-2xl p-4 space-y-3 relative">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Bailarino {i + 1}
                  </p>
                  {data.bailarinos.length > minMembers && (
                    <button
                      onClick={() => setData(d => ({ ...d, bailarinos: d.bailarinos.filter((_, idx) => idx !== i) }))}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Nome completo *</label>
                  <input
                    type="text"
                    value={b.nome}
                    onChange={e => setData(d => ({ ...d, bailarinos: d.bailarinos.map((x, idx) => idx === i ? { ...x, nome: e.target.value } : x) }))}
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>CPF *</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={b.cpf}
                      maxLength={14}
                      onChange={e => setData(d => ({ ...d, bailarinos: d.bailarinos.map((x, idx) => idx === i ? { ...x, cpf: maskCPF(e.target.value) } : x) }))}
                      placeholder="000.000.000-00"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Nascimento *</label>
                    {/* Data nascimento — input mascarado DD/MM/AAAA em vez do
                        calendário nativo. User reportou que escolher ano antigo
                        no picker era lento; digitação direta é mais rápida.
                        DateInputBR mantém state interno pra digitação parcial. */}
                    <DateInputBR
                      value={b.data_nascimento}
                      onChange={iso => setData(d => ({
                        ...d,
                        bailarinos: d.bailarinos.map((x, idx) =>
                          idx === i ? { ...x, data_nascimento: iso } : x
                        ),
                      }))}
                      className={inputCls}
                    />
                  </div>
                </div>
                {/* @ Instagram do bailarino — só Solo/Duo/Trio (maxMembers <= 3).
                    Grupo usa instagram_principal mais abaixo (campo único). */}
                {maxMembers <= 3 && (
                  <div>
                    <label className={labelCls}>@ Instagram (opcional)</label>
                    <input
                      type="text"
                      value={b.instagram_handle ?? ''}
                      onChange={e => {
                        // @ handles do Instagram são case-insensitive e a
                        // plataforma armazena em minúsculas — força lowercase
                        // pra padronizar e evitar duplicatas tipo @USUARIO vs @usuario.
                        const raw = e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, '');
                        const handle = raw ? `@${raw.replace(/^@+/, '')}` : '';
                        setData(d => ({
                          ...d,
                          bailarinos: d.bailarinos.map((x, idx) =>
                            idx === i ? { ...x, instagram_handle: handle } : x
                          ),
                        }));
                      }}
                      placeholder="@seuinsta"
                      maxLength={31}
                      className={inputCls}
                    />
                    <p className="text-[9px] text-slate-400 mt-1">
                      Usado pra marcar nas divulgações nas redes sociais.
                    </p>
                  </div>
                )}
              </div>
            ))}

            {data.bailarinos.length < maxMembers && (
              <button
                onClick={() => setData(d => ({ ...d, bailarinos: [...d.bailarinos, { nome: '', cpf: '', data_nascimento: '' }] }))}
                className="w-full inline-flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] hover:border-[#ff0068]/40 transition-colors"
              >
                <Plus size={12} /> Adicionar bailarino
              </button>
            )}

            {/* Campo único pra GRUPO (maxMembers > 3). Pedir @ de 4+ bailarinos
                seria atrito demais; produtor marca o grupo OU o coreógrafo. */}
            {maxMembers > 3 && (
              <div className="border border-slate-200 dark:border-white/10 rounded-2xl p-4 space-y-2">
                <label className={labelCls}>@ do grupo ou coreógrafo (opcional)</label>
                <input
                  type="text"
                  value={data.instagram_principal ?? ''}
                  onChange={e => {
                    const raw = e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, '');
                    const handle = raw ? `@${raw.replace(/^@+/, '')}` : '';
                    setData(d => ({ ...d, instagram_principal: handle }));
                  }}
                  placeholder="@nomedogrupo"
                  maxLength={31}
                  className={inputCls}
                />
                <p className="text-[9px] text-slate-400">
                  Usado pra marcar o grupo nas divulgações nas redes sociais.
                </p>
              </div>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              💡 CPF é usado pra emitir o certificado individual de cada bailarino.
            </p>

            {/* Alerta de tolerância de idade — categoria escolhida vs idade real
                dos bailarinos preenchidos. Cor varia: âmbar = dentro do limite
                de tolerância (FLEXIBLE), vermelho = excede limite (STRICT bloqueia). */}
            {categoriaSelecionada && toleranceStatus.outCount > 0 && (
              <div
                className={`p-4 rounded-2xl border ${
                  toleranceStatus.violates
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                }`}
              >
                <p className="text-[11px] font-black uppercase tracking-widest mb-1.5">
                  {toleranceStatus.violates ? '⚠ Tolerância excedida' : '⚠ Bailarino(s) fora da faixa etária'}
                </p>
                <p className="text-[11px] leading-relaxed">
                  {toleranceStatus.outCount} de {toleranceStatus.totalCount} bailarino(s)
                  {toleranceStatus.outNames.length <= 3 && (
                    <> (<strong>{toleranceStatus.outNames.join(', ')}</strong>)</>
                  )}{' '}
                  fora da faixa <strong>{categoriaSelecionada.name}</strong> ({categoriaSelecionada.min_age}–{(categoriaSelecionada.max_age ?? 99) >= 99 ? '+' : categoriaSelecionada.max_age} anos).
                </p>
                <p className="text-[10px] mt-2 leading-relaxed">
                  {toleranceStatus.violates
                    ? toleranceRule.enforcement === 'STRICT'
                      ? `Excede o limite do produtor (${toleranceStatus.limitLabel}). Não é possível avançar — escolha outra categoria ou ajuste o elenco.`
                      : `Excede o limite (${toleranceStatus.limitLabel}). A inscrição vai ser sinalizada pra produção revisar.`
                    : `Dentro do limite de tolerância (${toleranceStatus.limitLabel}) — inscrição segue normal.`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ─── Passo 2: Vídeo da Seletiva (modo seletiva) ou Trilha sonora ─── */}
        {step === 2 && isSeletivaMode && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Video size={18} /></div>
              <div>
                <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">Vídeo da seletiva</h2>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  A comissão analisa o vídeo antes da inscrição ser confirmada. A trilha sonora será solicitada depois da aprovação.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Link do vídeo {videoLinkRequired && <span className="text-rose-500">*</span>}
              </label>
              <input
                type="url"
                placeholder="https://youtube.com/watch?v=... ou https://drive.google.com/..."
                value={data.video_url}
                onChange={e => setData(d => ({ ...d, video_url: e.target.value }))}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068] transition-all"
              />
              <p className="text-[10px] text-slate-400">
                YouTube, Vimeo ou Google Drive (link compartilhável). Os bailarinos no vídeo devem ser os mesmos cadastrados no passo anterior — anti-fraude segue padrão dos festivais (Joinville, Catanduva).
              </p>
            </div>

            {/* Aviso sobre taxa de seletiva (Modelo 3) */}
            {videoLinkRequired && Number((event as any)?.video_selection_fee ?? 0) > 0 && (
              <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">Taxa de seletiva</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Você vai pagar a taxa de seletiva ao confirmar — esse valor cobre a análise técnica do vídeo pela comissão e <strong>não tem reembolso em caso de reprovação</strong> (padrão dos festivais brasileiros).
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && !isSeletivaMode && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Upload size={18} /></div>
              <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">Trilha sonora</h2>
            </div>

            {/* Estado 1: trilha pendente (vai anexar depois) */}
            {data.trilha_pendente ? (
              <div className="border border-[#ff0068]/30 bg-[#ff0068]/5 rounded-2xl p-5 flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-[#ff0068]/10 flex items-center justify-center">
                  <Upload size={18} className="text-[#ff0068]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-widest text-[#ff0068]">
                    Você vai anexar depois
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    Acesse "Minhas coreografias" pra enviar antes do prazo do evento.
                  </p>
                </div>
                <button
                  onClick={() => setData(d => ({ ...d, trilha_pendente: false }))}
                  className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] underline"
                >
                  Mudei de ideia
                </button>
              </div>
            ) : data.trilha_url && !data.trilha_url.startsWith('http') ? (
              /* Estado 2: trilha já enviada */
              <div className="border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/5 rounded-2xl p-5 flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle size={18} className="text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                    Trilha enviada
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug truncate">
                    {trilhaFileName ?? data.trilha_url.split('/').pop()}
                  </p>
                </div>
                <button
                  onClick={handleTrilhaRemove}
                  className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-rose-500 underline"
                >
                  Trocar
                </button>
              </div>
            ) : (
              /* Estado 3: nenhuma escolha ainda — drop zone + botão alternativo */
              <div className="space-y-3">
                <label className={`block border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer ${
                  trilhaUploading
                    ? 'border-[#ff0068]/30 bg-[#ff0068]/5'
                    : 'border-slate-300 dark:border-white/15 hover:border-[#ff0068]/50 hover:bg-[#ff0068]/5'
                }`}>
                  <input
                    type="file"
                    accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/x-m4a,audio/aac,audio/ogg,.mp3,.m4a,.wav,.aac,.ogg"
                    onChange={e => handleTrilhaUpload(e.target.files?.[0] ?? null)}
                    disabled={trilhaUploading}
                    className="hidden"
                  />
                  {trilhaUploading ? (
                    <>
                      <Loader2 size={28} className="text-[#ff0068] mx-auto animate-spin" />
                      <p className="text-[11px] font-black uppercase tracking-widest text-[#ff0068] mt-3">
                        Enviando trilha…
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1.5">
                        Pode demorar alguns minutos em conexão lenta. Não feche a aba.
                      </p>
                    </>
                  ) : (
                    <>
                      <Upload size={28} className="text-slate-400 mx-auto" />
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 mt-3">
                        Clique pra escolher a trilha
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        MP3, M4A, WAV, AAC ou OGG · máx. 30 MB
                      </p>
                    </>
                  )}
                </label>

                {trilhaError && (
                  <p className="text-[10px] text-rose-500 dark:text-rose-400 px-1">{trilhaError}</p>
                )}

                <button
                  onClick={() => setData(d => ({ ...d, trilha_pendente: true, trilha_url: '' }))}
                  disabled={trilhaUploading}
                  className="w-full py-2.5 rounded-xl border-2 border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/30 hover:text-slate-700 dark:hover:text-slate-200 transition-all disabled:opacity-50"
                >
                  Anexar depois
                </button>
              </div>
            )}

          </div>
        )}

        {/* ─── Passo 3: Resumo + Pagamento ──────────────────────────────── */}
        {step === 3 && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><CheckCircle size={18} /></div>
              <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">Resumo da inscrição</h2>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Festival</span>
                <span className="font-black text-slate-900 dark:text-white text-right">{event.name}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Modalidade</span>
                <span className="font-black text-slate-900 dark:text-white">{formacao?.name ?? modalidade}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Coreografia</span>
                <span className="font-black text-slate-900 dark:text-white text-right">{data.nome_coreografia}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Estilo · Categoria</span>
                <span className="font-black text-slate-900 dark:text-white text-right">{data.estilo_danca} · {data.categoria}</span>
              </div>
              {data.subgenero && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">Modalidade do gênero</span>
                  <span className="font-black text-slate-900 dark:text-white text-right">{data.subgenero}</span>
                </div>
              )}
              {data.tipo_apresentacao && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">Tipo de mostra</span>
                  <span className="font-black text-slate-900 dark:text-white text-right">
                    {data.tipo_apresentacao === 'Competitiva' ? 'Mostra Competitiva' : 'Mostra Avaliada'}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Bailarinos</span>
                <span className="font-black text-slate-900 dark:text-white">{data.bailarinos.length}</span>
              </div>
              {/* Preview do valor estimado — multiplica × bailarinos se PER_MEMBER.
                  Bug Grazieli/Usualdance (2026-05-19): inscrita não via que Grupo
                  de 18 bailarinos × R$ 35 = R$ 630 antes de confirmar. */}
              {(() => {
                const firstLote = ((formacao as any)?.lotes ?? [])[0];
                const feeUnit = Number(firstLote?.preco ?? (formacao as any)?.fee ?? (formacao as any)?.base_fee ?? 0);
                if (feeUnit <= 0) return null;
                const perMember = (formacao as any)?.pricing_type === 'PER_MEMBER';
                const total = perMember ? feeUnit * data.bailarinos.length : feeUnit;
                return (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500 dark:text-slate-400">Valor estimado</span>
                    <span className="font-black text-[#ff0068] text-right">
                      {perMember && data.bailarinos.length > 1 ? (
                        <>R$ {feeUnit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} × {data.bailarinos.length} = R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</>
                      ) : (
                        <>R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</>
                      )}
                    </span>
                  </div>
                );
              })()}
              {isSeletivaMode ? (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">Vídeo da seletiva</span>
                  <span className="font-black text-slate-900 dark:text-white text-right break-all max-w-[60%]">
                    {data.video_url?.trim() ? '✅ Link informado' : '⏳ Não informado'}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">Trilha</span>
                  <span className="font-black text-slate-900 dark:text-white text-right">
                    {data.trilha_pendente
                      ? '⏳ Anexar depois'
                      : data.trilha_url
                        ? '✅ Enviada'
                        : '⏳ Não enviada'}
                  </span>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 dark:border-white/10 pt-4 mt-4">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Ao confirmar, sua inscrição é salva como pendente em <strong>Minhas Coreografias</strong>.
                Lá você decide: pagar agora separadamente, juntar com outras coreografias em 1 PIX, ou
                adicionar mais inscrições antes. O valor depende do lote vigente (Pix, cartão ou boleto via Asaas).
              </p>
            </div>

            {/* Condições de participação — cobre transparência LGPD sobre o
                feedback dos jurados (áudio/texto). O bailarino é terceiro: o
                inscrito aceita ao confirmar. Frase única pra todos os eventos. */}
            <div className="border-t border-slate-200 dark:border-white/10 pt-4 mt-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                Condições de participação
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Ao se inscrever, você concorda que as apresentações poderão ser avaliadas por jurados e que
                essas avaliações podem incluir <strong>comentários em áudio e/ou texto</strong>, gravados
                durante o evento e disponibilizados de forma <strong>privada a você</strong> na plataforma,
                com finalidade exclusivamente técnica e pedagógica.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Erro sticky logo acima da barra de navegação — sempre visível,
          mesmo quando user está rolando no conteúdo do step. Antes o erro
          ficava no topo do step content e sumia da viewport no mobile. */}
      {error && (
        <div className="fixed bottom-32 sm:bottom-16 left-0 right-0 z-40 px-4 pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <div className="bg-rose-500/95 dark:bg-rose-600/95 backdrop-blur border border-rose-400 dark:border-rose-500 rounded-xl p-3 text-sm text-white shadow-lg shadow-rose-500/40 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1 font-bold">{error}</span>
              <button
                onClick={() => setError(null)}
                aria-label="Fechar"
                className="shrink-0 -m-1 p-1 hover:bg-white/20 rounded transition-colors text-white/80 hover:text-white text-lg leading-none"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de navegação fixa embaixo — em mobile fica acima do BottomNavBar
          (que tem h-16 no app) pra Voltar/Próximo nunca sumir atrás do menu. */}
      <div className="fixed bottom-16 sm:bottom-0 left-0 right-0 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-white/5 px-4 py-3 z-30">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={back}
            disabled={step === 0 || submitting}
            className="inline-flex items-center gap-1.5 px-4 py-3 text-slate-500 hover:text-slate-900 dark:hover:text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} /> Voltar
          </button>

          {step < 3 ? (
            <button
              onClick={advance}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Próximo: {stepsForEvent[step + 1].label} <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {submitting ? 'Criando inscrição…' : 'Confirmar inscrição'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InscricaoWizard;
