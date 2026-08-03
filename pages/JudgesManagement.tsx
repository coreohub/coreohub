import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  UserPlus, Pencil, Trash2, Instagram, Fingerprint,
  ShieldCheck, KeyRound, X, Save, Loader2, RefreshCw,
  Mic, Award, ChevronDown, ChevronUp, Upload, Camera,
  CheckCircle2, AlertCircle, Copy, Eye, EyeOff,
  Hash, Sparkles, FileDown, MessageCircle,
} from 'lucide-react';

const generatePin = (): string => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeCanvas } from 'qrcode.react';
import imageCompression from 'browser-image-compression';
import { supabase } from '../services/supabase';
import { getAllGenres } from '../services/genreService';
import { normalizeStyleName, isStyleInList } from '../utils/styleMatch';
import { resolveEstudio, toTitleCase } from '../utils/formatters';
import { formatDataBRComDia } from '../utils/lotes';
import { SCHEDULABLE_REGISTRATIONS_OR_FILTER } from '../utils/registrationStatus';
import { EventStyle } from '../types';
import EventPickerSheet from '../components/EventPickerSheet';

/* ────────────────────────────────────────────────────────── */
/* Types                                                       */
/* ────────────────────────────────────────────────────────── */

interface Judge {
  id: string;
  name: string;
  mini_bio?: string;
  avatar_url?: string;
  instagram?: string;
  competencias_generos: string[];
  competencias_formatos: string[];
  pin?: string;
  language?: string;
  is_active?: boolean;
  is_public?: boolean;
  /** 'M' | 'F' — flexão da palavra "Jurado/Jurada" no card público */
  gender?: 'M' | 'F' | null;
  /** URL da assinatura digital pra emissão de certificados */
  assinatura_url?: string | null;
  /** Sessão Seletiva v1: jurado elegível pra avaliar vídeos da seletiva.
   *  Default TRUE — produtor desmarca pra restringir avaliação de vídeo a
   *  um subset dos jurados de palco. */
  can_evaluate_video?: boolean;
  /** Subconjunto de `competencias_generos` que esse jurado avalia com critério
   *  Artístico (Impacto Cênico/Interpretação, configurado em Avaliação).
   *  Estilo marcado em competencias_generos mas FORA daqui = Técnico (critério
   *  por estilo/override de gênero) — default, sem precisar marcar nada. */
  competencias_artisticas: string[];
}

const FORMATS = [
  'Mostra Competitiva',
  'Mostra Avaliada',
  'Ambas (Competitiva + Avaliada)',
  'Batalhas',
];

const EMPTY_JUDGE: Omit<Judge, 'id'> = {
  name: '',
  mini_bio: '',
  avatar_url: '',
  instagram: '',
  competencias_generos: [],
  competencias_formatos: [],
  competencias_artisticas: [],
  pin: '',
  language: 'pt-BR',
  is_active: true,
  // Jurado nasce VISÍVEL na vitrine (é vitrine de venda do festival, igual ao
  // professor de workshop que já é público por default). Produtor oculta no toggle.
  is_public: true,
  gender: null,
  can_evaluate_video: true,
};

const inputCls = 'w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-4 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm';
const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1';

/* ────────────────────────────────────────────────────────── */
/* Sub-components                                              */
/* ────────────────────────────────────────────────────────── */

const TagToggle = ({
  item, selected, onToggle, color = 'bg-[#ff0068]',
}: { item: string; selected: boolean; onToggle: () => void; color?: string }) => (
  <button
    type="button"
    onClick={onToggle}
    className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
      selected
        ? `${color} border-transparent text-white shadow-md`
        : 'bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-[#ff0068]/40'
    }`}
  >
    {item}
  </button>
);


/* ────────────────────────────────────────────────────────── */
/* Main Page                                                   */
/* ────────────────────────────────────────────────────────── */

interface EventOption { id: string; name: string; is_demo?: boolean | null; edition_year?: number | null; start_date?: string | null; }

const JudgesManagement = () => {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [genres, setGenres] = useState<EventStyle[]>([]);
  const [loading, setLoading] = useState(true);
  // Código/QR de acesso do jurado é por EVENTO desde 2026-07-15 (não mais por
  // produtor) — produtor com 2+ eventos escolhe explicitamente de qual é o
  // código, em vez do sistema adivinhar "o mais recente" (ambíguo, já causou
  // sombreamento real de dados). Default prioriza o evento real mais recente
  // (não-demo) — só cai pra demo se for o único evento existente.
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  // Jurado atua num evento só se explicitamente vinculado (event_judges,
  // migration 20260715) — antes disso, todo jurado do produtor aparecia em
  // qualquer evento, inclusive jurado fictício de demo vazando pro evento
  // real. Novo evento já nasce com os jurados ativos vinculados (trigger no
  // banco) — produtor desmarca quem não participa desta edição.
  const [assignedJudgeIds, setAssignedJudgeIds] = useState<Set<string>>(new Set());
  const [togglingAssignment, setTogglingAssignment] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJudge, setEditingJudge] = useState<Judge | null>(null);
  const [form, setForm] = useState<Omit<Judge, 'id'>>(EMPTY_JUDGE);
  const [tab, setTab] = useState<'publico' | 'tecnico'>('publico');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [showPin, setShowPin] = useState(false);
  const [copiedField, setCopiedField] = useState<'pin' | 'invite' | null>(null);
  const [revealedPinId, setRevealedPinId] = useState<string | null>(null);
  const [publishingAll, setPublishingAll] = useState(false);

  const copyToClipboard = async (text: string, field: 'pin' | 'invite') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {}
  };

  /* Acesso do jurado — 1 link só (app.coreohub.com/entrar-juri) + 1 código
     de 6 caracteres, mesmo padrão Kahoot (kahoot.it + PIN). O link assinado
     por token (/judge-login/<uuid>) continua existindo como rota interna —
     é pra onde /entrar-juri redireciona depois de resolver o código — mas
     nunca mais aparece pro produtor copiar/compartilhar: expor 2 "links"
     pra fazer a mesma coisa é o que gerava a confusão original. A QR code
     também aponta pro /entrar-juri (com o código já preenchido), não pro
     link cru — escanear ou digitar caem no mesmo lugar. */
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [shortCodeLoading, setShortCodeLoading] = useState(false);
  const [shortCodeCopied, setShortCodeCopied] = useState(false);
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  const fetchShortCode = async (): Promise<string> => {
    if (!selectedEventId) return '';
    if (shortCode !== null) return shortCode;
    const { data: event } = await supabase
      .from('events').select('judge_short_code').eq('id', selectedEventId).maybeSingle();
    const code = event?.judge_short_code ?? '';
    setShortCode(code);
    return code;
  };

  const generateShortCode = async () => {
    if (!selectedEventId) return;
    setShortCodeLoading(true);
    try {
      const { data, error } = await supabase.rpc('regenerate_judge_short_code', { p_event_id: selectedEventId });
      if (error) throw error;
      setShortCode(data as string);
    } catch (e: any) {
      alert(e.message || 'Erro ao gerar código.');
    } finally {
      setShortCodeLoading(false);
    }
  };

  // Troca de evento invalida o código em cache — sem isso, o painel mostraria
  // o código do evento anterior colado à URL/QR do evento novo.
  useEffect(() => {
    setShortCode(null);
  }, [selectedEventId]);

  // Carrega quais jurados estão vinculados ao evento selecionado.
  useEffect(() => {
    if (!selectedEventId) { setAssignedJudgeIds(new Set()); return; }
    (async () => {
      const { data, error } = await supabase.rpc('get_event_judge_ids', { p_event_id: selectedEventId });
      if (error) { console.error('get_event_judge_ids:', error.message); return; }
      setAssignedJudgeIds(new Set((data ?? []) as string[]));
    })();
  }, [selectedEventId]);

  const toggleEventJudge = async (judgeId: string, assigned: boolean) => {
    if (!selectedEventId) return;
    setTogglingAssignment(judgeId);
    // Otimista — reverte se a RPC falhar.
    setAssignedJudgeIds(prev => {
      const next = new Set(prev);
      if (assigned) next.add(judgeId); else next.delete(judgeId);
      return next;
    });
    try {
      const { error } = await supabase.rpc('set_event_judge', {
        p_event_id: selectedEventId, p_judge_id: judgeId, p_assigned: assigned,
      });
      if (error) throw error;
    } catch (e: any) {
      setAssignedJudgeIds(prev => {
        const next = new Set(prev);
        if (assigned) next.delete(judgeId); else next.add(judgeId);
        return next;
      });
      alert(e.message || 'Erro ao atualizar vínculo do jurado com o evento.');
    } finally {
      setTogglingAssignment(null);
    }
  };

  const copyShortCode = async () => {
    if (!shortCode) return;
    try {
      await navigator.clipboard.writeText(shortCode);
      setShortCodeCopied(true);
      setTimeout(() => setShortCodeCopied(false), 1500);
    } catch {}
  };

  const entrarJuriUrl = (code: string) => `${window.location.origin}/entrar-juri?code=${code}`;

  const toggleInvitePanel = async () => {
    const opening = !invitePanelOpen;
    setInvitePanelOpen(opening);
    if (opening) await fetchShortCode();
  };

  /* Convite pronto pra WhatsApp — 1 link + 1 código, sem o link cru assinado
     por token que só confundia (2 "links" fazendo a mesma coisa). */
  const copyInviteMessage = async () => {
    if (!selectedEventId) return;
    setInviteLoading(true);
    try {
      let code = await fetchShortCode();
      if (!code) {
        const { data, error } = await supabase.rpc('regenerate_judge_short_code', { p_event_id: selectedEventId });
        if (error) throw error;
        code = data as string;
        setShortCode(code);
      }

      const message = `Você foi convidado(a) como jurado(a)!\n\n` +
        `Acesse app.coreohub.com/entrar-juri e digite o código: ${code}\n\n` +
        `Quando abrir, toque em "Instalar app" pra deixar salvo na tela do celular/tablet.`;

      await copyToClipboard(message, 'invite');
    } catch (e: any) {
      alert(e.message || 'Erro ao montar o convite.');
    } finally {
      setInviteLoading(false);
    }
  };

  /* ── eventos do produtor — pro seletor do painel de código + Súmula/PDF ── */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('events')
        .select('id, name, is_demo, edition_year, start_date')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setEvents(data);
        // Prioriza o evento real (não-demo) mais recente — só cai pra demo
        // se for o único evento existente. É o fix direto do bug de
        // sombreamento (demo criado depois do real virando "o ativo" à toa).
        const nonDemo = data.find(e => !e.is_demo);
        setSelectedEventId(prev => prev ?? (nonDemo?.id ?? data[0].id));
      }
    })();
  }, []);

  /* ── fetch ── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // getAllGenres() sem eventId traz os gêneros de TODOS os eventos do
      // produtor (+ catálogo global) — produtor com 2+ eventos via o mesmo
      // gênero duplicado na lista (ex: "DANÇA CLÁSSICA" 2x). Escopa pro
      // evento selecionado no painel, igual a tela de Configurações → Gêneros.
      const [{ data: judgesData }, genresData] = await Promise.all([
        supabase.from('judges').select('*').order('name'),
        getAllGenres({ eventId: selectedEventId }),
      ]);
      setJudges((judgesData || []).map(normalizeJudge));
      setGenres(genresData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const normalizeJudge = (row: any): Judge => ({
    id: row.id,
    name: row.name || '',
    mini_bio: row.mini_bio || '',
    avatar_url: row.avatar_url || '',
    instagram: row.instagram || '',
    competencias_generos: row.competencias_generos || [],
    competencias_formatos: row.competencias_formatos || [],
    pin: row.pin || '',
    language: row.language || 'pt-BR',
    is_active: row.is_active ?? true,
    is_public: row.is_public ?? false,
    gender: row.gender ?? null,
    can_evaluate_video: row.can_evaluate_video ?? true,
    competencias_artisticas: row.competencias_artisticas || [],
  });

  /* ── Súmula Geral (PDF) — folha em branco por jurado, contingência de papel
     se o terminal cair. 1 grupo de páginas por jurado ativo, listando só as
     apresentações que caem na fila DELE (mesmo filtro de gênero do terminal:
     JudgeTerminal.tsx `filteredSchedule`). Critérios/pesos vêm de
     regras_avaliacao.globalRules — overrides por gênero não entram aqui
     ainda (mesma limitação seria replicar toda a lógica de resolveGenreCriteria
     do terminal; a maioria dos eventos usa os mesmos critérios pro evento
     inteiro, overrides são exceção pontual). */
  const [exportingSumula, setExportingSumula] = useState(false);

  const exportSumulaPDF = async () => {
    setExportingSumula(true);
    try {
      const { fetchActiveEventConfig } = await import('../services/supabase');
      const eventId = selectedEventId;
      if (!eventId) { alert('Selecione um evento primeiro.'); return; }

      let eventName = 'Evento';
      let editionYear = new Date().getFullYear();
      const { data: ev } = await supabase.from('events').select('name, edition_year, start_date').eq('id', eventId).maybeSingle();
      if (ev) {
        eventName = ev.name || eventName;
        editionYear = ev.edition_year ?? (ev.start_date ? new Date(ev.start_date).getFullYear() : editionYear);
      }

      const cfg = await fetchActiveEventConfig('regras_avaliacao, escala_notas', eventId);
      const DEFAULT_CRITERIOS = [
        { name: 'Performance', peso: 2 }, { name: 'Criatividade', peso: 2 },
        { name: 'Musicalidade', peso: 2 }, { name: 'Técnica', peso: 2 }, { name: 'Figurino', peso: 2 },
      ];
      const globalCriterios = (cfg?.regras_avaliacao as any)?.globalRules?.criterios;
      const criterios: { name: string; peso: number }[] = Array.isArray(globalCriterios) && globalCriterios.length > 0
        ? globalCriterios : DEFAULT_CRITERIOS;
      const scale = cfg?.escala_notas === 'BASE_100' ? '0–100' : '0–10';

      const { data: regs } = await supabase
        .from('registrations')
        .select('id, nome_coreografia, estudio, estilo_danca, ordem_apresentacao, ordem_apresentacao_dia, excluded_from_schedule, event_data')
        .eq('event_id', eventId)
        .or(SCHEDULABLE_REGISTRATIONS_OR_FILTER)
        .order('ordem_apresentacao', { ascending: true });
      const schedule = (regs ?? []).filter((r: any) => !r.excluded_from_schedule);

      // Filtra por vínculo real com o evento (event_judges, migration
      // 20260715) — antes disso, qualquer jurado ativo do produtor entrava
      // aqui, inclusive de outra edição/evento demo.
      const activeJudges = judges.filter(j => j.is_active !== false && assignedJudgeIds.has(j.id));
      if (activeJudges.length === 0) { alert('Nenhum jurado vinculado a este evento — vincule em "Vinculado a este evento" no card do jurado.'); return; }

      // Dentro dos jurados vinculados, ainda pula quem não teria nada pra
      // avaliar nesta edição específica (gêneros configurados não batem com
      // nenhuma coreografia do cronograma) — evita folha em branco à toa.
      const judgesWithQueue = activeJudges
        .map(judge => {
          const genresOf = judge.competencias_generos ?? [];
          const queue = genresOf.length === 0
            ? schedule
            : schedule.filter((r: any) => isStyleInList(r.estilo_danca, genresOf));
          return { judge, queue };
        })
        .filter(({ queue }) => queue.length > 0);

      if (judgesWithQueue.length === 0) {
        alert('Nenhum jurado ativo tem apresentações na fila deste evento — confira as competências de gênero configuradas.');
        return;
      }

      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      judgesWithQueue.forEach(({ judge, queue }, idx) => {
        if (idx > 0) doc.addPage();

        doc.setFillColor(255, 0, 104);
        doc.rect(0, 0, pageWidth, 24, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(15);
        doc.setFont('helvetica', 'bold');
        doc.text('Súmula Geral de Avaliação', 14, 11);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`${eventName.toUpperCase()} · Edição ${editionYear} · Jurado: ${judge.name} · Escala ${scale}`, 14, 18);

        let y = 32;
        doc.setFontSize(7.5);
        doc.setTextColor(120, 120, 120);
        doc.text('ASSINATURA', 14, y);
        doc.text('DATA', pageWidth - 40, y);
        doc.setDrawColor(200, 200, 200);
        doc.line(14, y + 7, 130, y + 7);
        doc.line(pageWidth - 40, y + 7, pageWidth - 14, y + 7);
        y += 14;

        const head = ['Nº', 'Coreografia', 'Estúdio/Grupo', ...criterios.map(c => `${c.name} (peso ${c.peso})`), 'Nota Final', 'Obs.'];
        const body = queue.length > 0
          ? queue.map((r: any) => [
              // Prefere o número do dia (reinicia por dia, evento multi-dia)
              // e cai pro global quando o bloco não tem data (evento de 1 dia).
              String(r.ordem_apresentacao_dia ?? r.ordem_apresentacao ?? '—'),
              r.nome_coreografia ?? '—',
              (r.estudio?.trim?.() || r.event_data?.estudio_nome || '—'),
              ...criterios.map(() => ''),
              '',
              '',
            ])
          : [['—', 'Nenhuma apresentação na fila deste jurado (gêneros configurados não batem com o cronograma)', '', ...criterios.map(() => ''), '', '']];

        const critStart = 3;
        const columnStyles: Record<number, any> = {
          0: { cellWidth: 9, halign: 'center', fontStyle: 'bold' },
          1: { cellWidth: 46, fontStyle: 'bold' },
          2: { cellWidth: 40 },
          [critStart + criterios.length]: { cellWidth: 22, halign: 'center', fillColor: [255, 240, 246] },
        };
        criterios.forEach((_, i) => { columnStyles[critStart + i] = { cellWidth: 26, halign: 'center' }; });

        autoTable(doc, {
          head: [head],
          body,
          startY: y,
          theme: 'grid',
          headStyles: { fillColor: [26, 26, 26], textColor: 255, fontSize: 6.8, fontStyle: 'bold', halign: 'center', valign: 'middle' },
          bodyStyles: { fontSize: 8, textColor: 40, minCellHeight: 9 },
          columnStyles,
          margin: { left: 14, right: 14 },
        });

        doc.setFontSize(7.5);
        doc.setTextColor(140, 140, 140);
        doc.text('Confirmo que as notas acima são minhas — assinatura do jurado. Só contingência de papel: em caso de rede voltar, avaliação real fica no terminal.', 14, pageHeight - 8);
      });

      const slug = (eventName || 'evento')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
      doc.save(`sumula-geral-${editionYear}-${slug}.pdf`);
    } catch (err) {
      console.error('Erro ao exportar súmula:', err);
      alert('Falha ao gerar a súmula: ' + (err instanceof Error ? err.message : 'desconhecido'));
    } finally {
      setExportingSumula(false);
    }
  };

  /* ── Cronograma de Jurados (PDF) — uso do Coordenador do Júri pra acompanhar
     quando a banca de jurados muda ao longo da sequência real de apresentação
     (ordem_apresentacao, contínua entre blocos — bloco é só divisão visual da
     tela de Cronograma). Cada jurado fica na mesma coluna enquanto continua
     avaliando; quem sai libera a coluna pra quem entra, então a troca aparece
     sem precisar ler célula por célula. Confirmado com o produtor em sessão
     (dados reais do Usualdance Festival, trocas nas posições 4,5,15,16,17,
     19,20,21,33 batendo com o cálculo). */
  const [exportingJudgeSchedule, setExportingJudgeSchedule] = useState(false);

  const exportJudgeSchedulePDF = async () => {
    setExportingJudgeSchedule(true);
    try {
      const eventId = selectedEventId;
      if (!eventId) { alert('Selecione um evento primeiro.'); return; }

      let eventName = 'Evento';
      const { data: ev } = await supabase.from('events').select('name').eq('id', eventId).maybeSingle();
      if (ev?.name) eventName = ev.name;

      const [{ data: regs }, { data: blocosData }] = await Promise.all([
        supabase
          .from('registrations')
          .select('id, nome_coreografia, estudio, estilo_danca, ordem_apresentacao, ordem_apresentacao_dia, excluded_from_schedule, bloco_id, event_data')
          .eq('event_id', eventId)
          .or(SCHEDULABLE_REGISTRATIONS_OR_FILTER)
          .order('ordem_apresentacao', { ascending: true }),
        supabase.from('cronograma_blocos').select('id, name, ordem, data').eq('event_id', eventId).order('ordem'),
      ]);

      const schedule = (regs ?? []).filter((r: any) => !r.excluded_from_schedule && r.ordem_apresentacao != null);
      if (schedule.length === 0) { alert('Nenhuma apresentação com ordem definida encontrada no Cronograma.'); return; }

      const blocosList = blocosData ?? [];
      const blocosById = new Map(blocosList.map((b: any) => [b.id, b]));

      // Filtra por vínculo real com o evento (event_judges) — mesma razão
      // da Súmula acima.
      const activeJudges = judges.filter(j => j.is_active !== false && assignedJudgeIds.has(j.id));
      if (activeJudges.length === 0) { alert('Nenhum jurado vinculado a este evento — vincule em "Vinculado a este evento" no card do jurado.'); return; }

      const getBanca = (estilo: string | null): string[] => {
        if (!estilo) return [];
        return activeJudges
          .filter(j => isStyleInList(estilo, j.competencias_generos))
          .map(j => j.name)
          .sort();
      };

      const maxCols = Math.max(1, ...schedule.map((r: any) => getBanca(r.estilo_danca).length));

      type LinhaJurados = {
        ordem: number; ordemDia: number | null; nome: string; estudio: string; estilo: string;
        blocoName: string; blocoData: string | null;
        cols: (string | null)[]; mudou: boolean[]; trocou: boolean;
      };
      const linhas: LinhaJurados[] = [];
      let prevCols: (string | null)[] | null = null;

      schedule.forEach((r: any) => {
        const banca = getBanca(r.estilo_danca);
        const cols: (string | null)[] = new Array(maxCols).fill(null);
        const mudou: boolean[] = new Array(maxCols).fill(false);

        if (!prevCols) {
          banca.forEach((j, i) => { cols[i] = j; });
        } else {
          const usados = new Set<string>();
          prevCols.forEach((j, i) => {
            if (j && banca.includes(j)) { cols[i] = j; usados.add(j); }
          });
          const restantes = banca.filter(j => !usados.has(j));
          let ri = 0;
          for (let i = 0; i < maxCols; i++) {
            if (cols[i] === null && ri < restantes.length) { cols[i] = restantes[ri++]; mudou[i] = true; }
          }
        }

        const bloco = r.bloco_id ? blocosById.get(r.bloco_id) : null;
        linhas.push({
          ordem: r.ordem_apresentacao,
          ordemDia: r.ordem_apresentacao_dia ?? null,
          nome: toTitleCase(r.nome_coreografia) || '—',
          estudio: toTitleCase(resolveEstudio(r)) || '—',
          estilo: r.estilo_danca || '—',
          blocoName: (bloco as any)?.name || 'Sem bloco',
          blocoData: (bloco as any)?.data ?? null,
          cols,
          mudou,
          trocou: prevCols !== null && mudou.some(Boolean),
        });
        prevCols = cols;
      });

      const gruposMap = new Map<string, LinhaJurados[]>();
      linhas.forEach(r => {
        if (!gruposMap.has(r.blocoName)) gruposMap.set(r.blocoName, []);
        gruposMap.get(r.blocoName)!.push(r);
      });
      const blocosOrdenadosNomes = [...blocosList].sort((a: any, b: any) => a.ordem - b.ordem).map((b: any) => b.name);
      const gruposOrdenados = [
        ...blocosOrdenadosNomes.filter(n => gruposMap.has(n)),
        ...(gruposMap.has('Sem bloco') ? ['Sem bloco'] : []),
      ];

      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      // Paisagem — 7 colunas (Nº + coreografia + estúdio + estilo + N jurados)
      // não cabem em retrato sem quebrar "Jazz/Contemporâneo" no meio da
      // palavra. Horizontal dá 269mm de largura útil, tudo em 1 linha.
      const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFillColor(255, 0, 104);
      doc.rect(0, 0, pageWidth, 26, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bolditalic');
      doc.text('CRONOGRAMA DE JURADOS', pageWidth / 2, 12, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`${eventName} · uso do Coordenador do Júri`, pageWidth / 2, 19, { align: 'center' });

      let cursorY = 36;
      const totalCols = 4 + maxCols;
      const jurHead = Array.from({ length: maxCols }, (_, i) => `Jurado ${i + 1}`);

      gruposOrdenados.forEach(blocoName => {
        const grupoLinhas = gruposMap.get(blocoName)!;
        if (cursorY > 180) { doc.addPage(); cursorY = 20; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 0, 104);
        const blocoData = grupoLinhas[0]?.blocoData;
        const headerLabel = blocoData ? `${blocoName.toUpperCase()} · ${formatDataBRComDia(blocoData).toUpperCase()}` : blocoName.toUpperCase();
        doc.text(headerLabel, 14, cursorY);
        doc.setTextColor(40, 40, 40);
        cursorY += 4;

        const body: any[] = [];
        grupoLinhas.forEach(r => {
          if (r.trocou) {
            // Helvetica (fonte nativa do jsPDF, sem embed) não tem glifo pra
            // símbolos tipo ⟳/⚠ — vira "'ó" ilegível. Texto puro só.
            body.push([{
              content: 'TROCA',
              colSpan: totalCols,
              styles: { halign: 'center', fillColor: [255, 255, 255], textColor: [255, 0, 104], fontStyle: 'bold', fontSize: 7, minCellHeight: 3, cellPadding: 1 },
            }]);
          }
          body.push([
            String(r.ordemDia ?? r.ordem),
            r.nome,
            r.estudio,
            r.estilo,
            // content vira só o "raw" que o didParseCell/didDrawCell leem pra
            // desenhar o pill arredondado (autoTable não tem border-radius
            // nativo por célula) — mudou marca cor rosa vs cinza claro.
            ...r.cols.map((j, i) => (j ? { content: j, mudou: r.mudou[i] } : '—')),
          ]);
        });

        // Larguras FIXAS — sem isso o autoTable auto-dimensiona pela largura do
        // texto de cada célula. Como o texto dos jurados é esvaziado no
        // didParseCell (a gente redesenha o pill na mão), as colunas de jurado
        // colapsavam pra ~0 e os nomes vazavam/sobrepunham. Com cellWidth
        // explícito a largura não depende do conteúdo. A4 paisagem usável =
        // 269mm (297 - 14 - 14 de margem) — cabe tudo em 1 linha sem quebrar.
        const judgeColW = Math.max(28, Math.floor((269 - 10 - 58 - 58 - 33) / maxCols));
        const columnStyles: Record<number, any> = {
          0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
          1: { cellWidth: 58 },
          2: { cellWidth: 58 },
          3: { cellWidth: 33 },
        };
        for (let i = 0; i < maxCols; i++) columnStyles[4 + i] = { cellWidth: judgeColW, halign: 'center' };

        autoTable(doc, {
          head: [['Nº', 'Coreografia', 'Estúdio', 'Estilo', ...jurHead].map(h => h.toUpperCase())],
          body,
          startY: cursorY,
          theme: 'striped',
          headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 7, fontStyle: 'bold', halign: 'center' },
          bodyStyles: { fontSize: 8, textColor: 40, valign: 'middle' },
          alternateRowStyles: { fillColor: [248, 248, 250] },
          columnStyles,
          margin: { left: 14, right: 14 },
          didParseCell: (data: any) => {
            // Célula de jurado (col >= 4, corpo, raw é objeto {content,mudou})
            // esconde o texto default — a gente redesenha na mão no didDrawCell
            // como pill arredondado, igual ao mockup aprovado.
            if (data.section === 'body' && data.column.index >= 4 && data.cell.raw && typeof data.cell.raw === 'object') {
              data.cell.text = [];
            }
          },
          didDrawCell: (data: any) => {
            if (data.section !== 'body') return;
            const raw = data.cell.raw;
            if (!raw || typeof raw !== 'object') return;

            // Linha "TROCA" — mockup tem duas réguas rosa flanqueando o texto
            // (.linha::before/::after). autoTable só desenha o texto centralizado,
            // então a gente adiciona as réguas na mão.
            if (raw.content === 'TROCA') {
              const { x, y, width, height } = data.cell;
              const cy = y + height / 2;
              const cx = x + width / 2;
              doc.setFontSize(7);
              doc.setFont('helvetica', 'bold');
              const tw = doc.getTextWidth('TROCA');
              const gap = 4;
              doc.setDrawColor(255, 0, 104);
              doc.setLineWidth(0.3);
              doc.line(x + 2, cy, cx - tw / 2 - gap, cy);
              doc.line(cx + tw / 2 + gap, cy, x + width - 2, cy);
              doc.setFont('helvetica', 'normal');
              return;
            }

            if (data.column.index < 4) return;
            const label = String(raw.content);
            const mudou = !!raw.mudou;
            const { x, y, width, height } = data.cell;
            // Pill abraça o texto (não preenche a célula toda) — igual ao chip
            // do mockup: raio = metade da altura = pontas 100% arredondadas.
            doc.setFontSize(7);
            doc.setFont('helvetica', mudou ? 'bold' : 'normal');
            const textW = doc.getTextWidth(label);
            const padX = 2;
            const pillH = 5;
            const pillW = Math.min(textW + padX * 2, width - 1.5);
            const pillX = x + (width - pillW) / 2;
            const pillY = y + (height - pillH) / 2;
            if (mudou) doc.setFillColor(255, 0, 104); else doc.setFillColor(241, 241, 244);
            doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2, pillH / 2, 'F');
            if (mudou) doc.setTextColor(255, 255, 255); else doc.setTextColor(51, 51, 51);
            doc.text(label, x + width / 2, y + height / 2 + 0.2, { align: 'center', baseline: 'middle' });
            doc.setFont('helvetica', 'normal');
          },
        });

        cursorY = (doc as any).lastAutoTable.finalY + 8;
      });

      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(
        'Uso interno do Coordenador do Júri · troca calculada em relação à apresentação anterior (contínua entre blocos) · Gerado por CoreoHub.',
        14, doc.internal.pageSize.getHeight() - 8,
      );

      const slug = (eventName || 'evento')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
      doc.save(`cronograma-jurados-${slug}.pdf`);
    } catch (err) {
      console.error('Erro ao exportar cronograma de jurados:', err);
      alert('Falha ao gerar o PDF: ' + (err instanceof Error ? err.message : 'desconhecido'));
    } finally {
      setExportingJudgeSchedule(false);
    }
  };

  /* ── open modal ── */
  const openAdd = () => {
    setEditingJudge(null);
    // Gera PIN automaticamente pra evitar campo vazio (segue prática Square/Toast).
    setForm({ ...EMPTY_JUDGE, pin: generatePin() });
    setTab('publico');
    setSaveError(null);
    setSaveSuccess(false);
    setShowPin(false);
    setModalOpen(true);
  };

  const openEdit = (judge: Judge) => {
    setEditingJudge(judge);
    setForm({ ...judge });
    setTab('publico');
    setSaveError(null);
    setSaveSuccess(false);
    setModalOpen(true);
  };

  /* ── avatar upload (base64 — sem depender de bucket) ── */
  const handleAvatarUpload = async (file: File) => {
    if (!file) return;
    setAvatarUploading(true);
    setSaveError(null);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.15,
        maxWidthOrHeight: 320,
        useWebWorker: true,
        fileType: 'image/webp',
      });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });
      setForm(f => ({ ...f, avatar_url: base64 }));
    } catch (e: any) {
      setSaveError(`Erro ao processar foto: ${e.message}`);
    } finally {
      setAvatarUploading(false);
    }
  };

  /* ── save com auto-detecção de colunas ── */
  const trySaveWithPayload = async (
    payload: Record<string, any>,
    isNew: boolean,
    judgeId?: string,
  ): Promise<any> => {
    // Item 39: UPDATE usa .maybeSingle() pra não estourar PGRST116 quando RLS
    // bloqueia silenciosamente (0 rows). INSERT mantém .single() — se inserção
    // não retorna a row, é erro real.
    const query = isNew
      ? supabase.from('judges').insert(payload).select().single()
      : supabase.from('judges').update(payload).eq('id', judgeId!).select().maybeSingle();

    const { data, error } = await query;

    if (error) {
      // Detecta coluna inexistente e tenta de novo sem ela
      const colMatch =
        error.message.match(/could not find the '([^']+)' column/i) ||
        error.message.match(/column "([^"]+)" of relation/i);
      if (colMatch) {
        const badCol = colMatch[1];
        console.warn(`Coluna '${badCol}' não existe na tabela judges — removendo do payload.`);
        const reduced = { ...payload };
        delete reduced[badCol];
        if (Object.keys(reduced).length === 0) throw new Error('Nenhuma coluna válida encontrada.');
        return trySaveWithPayload(reduced, isNew, judgeId);
      }
      throw error;
    }
    // UPDATE retornando 0 rows = RLS bloqueou ou jurado removido entre clicks
    if (!isNew && !data) {
      throw new Error('Jurado não encontrado ou sem permissão pra editar.');
    }
    return data;
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setSaveError('Informe o nome do jurado.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        mini_bio: form.mini_bio,
        avatar_url: form.avatar_url,
        instagram: form.instagram?.replace('@', '').trim(),
        competencias_generos: form.competencias_generos,
        competencias_formatos: form.competencias_formatos,
        pin: form.pin,
        language: form.language || 'pt-BR',
        is_active: form.is_active ?? true,
        is_public: form.is_public ?? false,
        gender: form.gender ?? null,
        can_evaluate_video: form.can_evaluate_video ?? true,
        // Garante que nada em competencias_artisticas sobrou de um estilo que
        // foi desmarcado em competencias_generos (ex.: produtor marcou K-Pop
        // como artístico, depois removeu K-Pop da lista de estilos).
        competencias_artisticas: form.competencias_artisticas.filter(g => form.competencias_generos.includes(g)),
      };

      const data = await trySaveWithPayload(payload, !editingJudge, editingJudge?.id);

      if (editingJudge) {
        setJudges(js => js.map(j => j.id === editingJudge.id ? normalizeJudge(data) : j));
      } else {
        setJudges(js => [...js, normalizeJudge(data)]);
      }
      setSaveSuccess(true);
      setTimeout(() => setModalOpen(false), 900);
    } catch (e: any) {
      console.error('Erro ao salvar jurado:', e);
      setSaveError(`Erro ao salvar: ${e?.message || JSON.stringify(e)}`);
    } finally {
      setSaving(false);
    }
  };

  /* ── delete ── */
  const handleDelete = async (judge: Judge) => {
    if (!confirm(`Excluir jurado "${judge.name}"?`)) return;
    const { error } = await supabase.from('judges').delete().eq('id', judge.id);
    if (error) { alert('Erro: ' + error.message); return; }
    setJudges(js => js.filter(j => j.id !== judge.id));
  };

  /* ── toggle format/genre ──
   * Match case-insensitive (isStyleInList) pq o nome canônico exibido em
   * genreNames pode diferir em maiúscula/minúscula do que já foi salvo no
   * jurado (rows duplicadas no banco com a mesma grafia variando o caso). */
  const toggleList = (field: 'competencias_generos' | 'competencias_formatos', val: string) => {
    setForm(f => {
      const isSelected = isStyleInList(val, f[field]);
      const next: Omit<Judge, 'id'> = {
        ...f,
        [field]: isSelected ? f[field].filter(x => normalizeStyleName(x) !== normalizeStyleName(val)) : [...f[field], val],
      };
      // Desmarcar um estilo também tira ele de "avalia como Artístico" —
      // não deixa órfão marcado num estilo que o jurado nem julga mais.
      if (field === 'competencias_generos' && isSelected) {
        next.competencias_artisticas = f.competencias_artisticas.filter(x => normalizeStyleName(x) !== normalizeStyleName(val));
      }
      return next;
    });
  };

  /* ── toggle Técnico/Artístico pra um estilo já selecionado ── */
  const toggleArtistico = (genreName: string) => {
    setForm(f => ({
      ...f,
      competencias_artisticas: isStyleInList(genreName, f.competencias_artisticas)
        ? f.competencias_artisticas.filter(g => normalizeStyleName(g) !== normalizeStyleName(genreName))
        : [...f.competencias_artisticas, genreName],
    }));
  };

  // Defesa extra contra duplicata: o banco tem rows de event_styles repetidas
  // pro mesmo evento+nome (cleanup histórico incompleto, ver genreService.ts).
  // Dedup por nome normalizado (case/espaço-insensitive) — Set por string exata
  // não bastava pq a duplicata real no banco também varia em maiúscula/minúscula.
  const genreNames = Array.from(
    new Map(genres.map(g => [normalizeStyleName(g.name), g.name])).values()
  );
  const avatarSrc = (j: Judge) =>
    j.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(j.name)}`;

  // Jurados ocultos da vitrine (is_public=false). Banner + ação "publicar todos"
  // resolve o caso comum: produtor cadastrou a banca mas ninguém aparece na vitrine.
  const hiddenJudges = judges.filter(j => !j.is_public);
  const publishAllJudges = async () => {
    if (hiddenJudges.length === 0) return;
    setPublishingAll(true);
    try {
      const { data, error } = await supabase
        .from('judges')
        .update({ is_public: true })
        .in('id', hiddenJudges.map(j => j.id))
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Não foi possível publicar — sem permissão.');
      setJudges(js => js.map(j => ({ ...j, is_public: true })));
    } catch (e: any) {
      alert(e.message || 'Erro ao publicar jurados na vitrine.');
    } finally {
      setPublishingAll(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
            Equipe de <span className="text-[#ff0068]">Jurados</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Banca técnica · competências · terminais de avaliação
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {events.length > 0 && (
            <EventPickerSheet
              events={events}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
            />
          )}
          <button onClick={fetchAll} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={copyInviteMessage}
            disabled={judges.length === 0 || inviteLoading || !selectedEventId}
            className="px-4 py-3 bg-[#ff0068]/10 border border-[#ff0068]/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:bg-[#ff0068]/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Copia link + código + lembrete de instalar o app numa mensagem só, pronta pra colar no WhatsApp"
          >
            {inviteLoading ? <Loader2 size={14} className="animate-spin" /> : (copiedField === 'invite' ? <CheckCircle2 size={14} /> : <MessageCircle size={14} />)}
            {copiedField === 'invite' ? 'Convite copiado!' : 'Copiar convite'}
          </button>
          <button
            onClick={toggleInvitePanel}
            disabled={judges.length === 0 || !selectedEventId}
            aria-expanded={invitePanelOpen}
            aria-controls="invite-panel"
            className="px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-[#ff0068] hover:border-[#ff0068]/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Ver código + QR de acesso pros jurados"
          >
            <Hash size={14} /> Código de acesso
          </button>
          <button
            onClick={exportSumulaPDF}
            disabled={exportingSumula || judges.length === 0 || !selectedEventId}
            className="px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-[#ff0068] hover:border-[#ff0068]/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Baixa 1 folha em branco por jurado — contingência de papel se o terminal falhar no dia"
          >
            {exportingSumula ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Súmula (PDF)
          </button>
          <button
            onClick={exportJudgeSchedulePDF}
            disabled={exportingJudgeSchedule || judges.length === 0 || !selectedEventId}
            className="px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-[#ff0068] hover:border-[#ff0068]/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="PDF de uso do Coordenador do Júri — mostra quando a banca de jurados muda ao longo da sequência de apresentação"
          >
            {exportingJudgeSchedule ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Cronograma de Jurados (PDF)
          </button>
          <button
            onClick={openAdd}
            className="px-5 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 flex items-center gap-2"
          >
            <UserPlus size={16} /> Novo Jurado
          </button>
        </div>
      </div>

      {/* Painel único de acesso do jurado — 1 link (app.coreohub.com/entrar-juri)
          + 1 código de 6 caracteres, mesmo padrão Kahoot (kahoot.it + PIN).
          A QR aponta pro próprio /entrar-juri com o código preenchido — ela
          é só um atalho pro mesmo link, não um segundo caminho diferente. */}
      {invitePanelOpen && (
        <div id="invite-panel" className="p-5 bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-2xl flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068] shrink-0"><Hash size={18} /></div>
          <div className="flex-1">
            <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">
              Acesso do jurado
            </p>
            {/* Código é por evento desde 2026-07-15 — deixa explícito de qual
                evento é esse código, pra não confundir com outro evento do
                produtor. */}
            <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] mt-0.5">
              Válido só pra: {events.find(e => e.id === selectedEventId)?.name ?? '—'}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              Peça pro jurado abrir <span className="font-bold">app.coreohub.com/entrar-juri</span> e digitar o código — ou escanear o QR, que abre o mesmo link com o código já preenchido.
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              Ao entrar, o jurado vai ver os botões <strong className="text-slate-500 dark:text-slate-300">"Instalar app"</strong> (salva na tela do dispositivo) e <strong className="text-slate-500 dark:text-slate-300">"Configurar como Terminal"</strong> (fixa o tablet nessa tela pras próximas vezes).
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {shortCode ? (
              <>
                <div className="p-2 bg-white rounded-xl">
                  <QRCodeCanvas value={entrarJuriUrl(shortCode)} size={72} level="M" />
                </div>
                <span className="px-4 py-2.5 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl text-lg font-black tracking-[0.25em] text-slate-900 dark:text-white">
                  {shortCode}
                </span>
                <button
                  onClick={copyShortCode}
                  className="p-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 hover:text-[#ff0068] transition-colors"
                  title="Copiar código"
                  aria-label="Copiar código"
                >
                  {shortCodeCopied ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Copy size={16} />}
                </button>
                <button
                  onClick={generateShortCode}
                  disabled={shortCodeLoading}
                  className="p-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 hover:text-[#ff0068] transition-colors disabled:opacity-50"
                  title="Gerar novo código (revoga o atual)"
                  aria-label="Gerar novo código"
                >
                  {shortCodeLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                </button>
              </>
            ) : (
              <button
                onClick={generateShortCode}
                disabled={shortCodeLoading}
                className="px-4 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {shortCodeLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Gerar código
              </button>
            )}
          </div>
        </div>
      )}

      {/* Jurados ocultos da vitrine — ação rápida pra publicar todos */}
      {!loading && hiddenJudges.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
          <div className="flex items-start gap-2.5">
            <EyeOff size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300 leading-snug">
              {hiddenJudges.length} jurado{hiddenJudges.length > 1 ? 's' : ''} {hiddenJudges.length > 1 ? 'ocultos' : 'oculto'} da vitrine do evento.
              <span className="block text-amber-600/80 dark:text-amber-400/70 font-medium">Jurados só aparecem pro público quando marcados como visíveis.</span>
            </p>
          </div>
          <button
            onClick={publishAllJudges}
            disabled={publishingAll}
            className="shrink-0 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-60 flex items-center gap-2 transition-all"
          >
            {publishingAll ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
            Publicar todos na vitrine
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="text-[#ff0068] animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && judges.length === 0 && (
        <div className="py-20 text-center bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-3xl">
          <Award size={40} className="mx-auto text-slate-400 mb-3" />
          <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhum jurado cadastrado ainda.</p>
          <button onClick={openAdd} className="mt-4 px-5 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all">
            Cadastrar primeiro jurado
          </button>
        </div>
      )}

      {/* Judge cards grid */}
      {!loading && judges.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {judges.map(judge => {
            const isExpanded = expandedId === judge.id;
            return (
              <div
                key={judge.id}
                className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden shadow-sm dark:shadow-xl transition-all hover:border-[#ff0068]/30"
              >
                {/* Card header */}
                <div className="p-5 flex gap-4 items-start">
                  <div className="relative shrink-0">
                    <img
                      src={avatarSrc(judge)}
                      alt={judge.name}
                      className="w-14 h-14 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-white/10"
                    />
                    <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 ${judge.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white text-sm uppercase tracking-tight truncate">{judge.name}</p>
                    {judge.mini_bio && (
                      <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">{judge.mini_bio}</p>
                    )}
                    {judge.instagram && (
                      <a
                        href={`https://instagram.com/${judge.instagram}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 mt-1 text-[9px] font-black text-[#ff0068] hover:underline uppercase tracking-widest"
                      >
                        <Instagram size={10} /> @{judge.instagram}
                      </a>
                    )}
                  </div>

                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(judge)} className="p-1.5 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg transition-all">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(judge)} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Competencies preview — modalidade artística destacada em violeta */}
                {(judge.competencias_generos.length > 0 || judge.competencias_formatos.length > 0) && (
                  <div className="px-5 pb-3 flex flex-wrap gap-1.5">
                    {judge.competencias_generos.map(g => {
                      const isArtistico = judge.competencias_artisticas?.includes(g);
                      return (
                        <span
                          key={g}
                          title={isArtistico ? 'Avalia como Artístico' : 'Avalia como Técnico'}
                          className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
                            isArtistico
                              ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                              : 'bg-[#ff0068]/10 text-[#ff0068]'
                          }`}
                        >
                          {g}
                        </span>
                      );
                    })}
                    {judge.competencias_formatos.map(f => (
                      <span key={f} className="px-2 py-0.5 bg-slate-200 dark:bg-white/5 text-slate-500 rounded-full text-[8px] font-black uppercase tracking-widest">
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {/* Vínculo com o evento selecionado (event_judges, migration
                    20260715) — jurado só entra na Súmula/Cronograma/terminal
                    desse evento se estiver marcado aqui. */}
                {selectedEventId && (
                  <div className="px-5 pb-3">
                    <button
                      type="button"
                      onClick={() => toggleEventJudge(judge.id, !assignedJudgeIds.has(judge.id))}
                      disabled={togglingAssignment === judge.id}
                      className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                        assignedJudgeIds.has(judge.id)
                          ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400'
                      }`}
                    >
                      {togglingAssignment === judge.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={11} />
                      )}
                      {assignedJudgeIds.has(judge.id) ? 'Vinculado a este evento' : 'Vincular a este evento'}
                    </button>
                  </div>
                )}

                {/* Footer: PIN + expand */}
                <div
                  className="px-5 py-3 border-t border-slate-100 dark:border-white/5 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : judge.id)}
                >
                  <div className="flex items-center gap-2">
                    <KeyRound size={12} className={judge.pin ? 'text-emerald-500' : 'text-slate-400'} />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {judge.pin ? 'PIN configurado' : 'Sem PIN'}
                    </span>
                    {judge.assinatura_url && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <Fingerprint size={11} className="text-emerald-500" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Assinatura</span>
                      </>
                    )}
                  </div>
                  {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </div>

                {/* Expanded: PIN + competencies + bio */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 space-y-3">
                        {judge.pin && (
                          <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 rounded-xl">
                            <div className="flex items-center gap-2 min-w-0">
                              <KeyRound size={12} className="text-emerald-500 shrink-0" />
                              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">PIN</span>
                              <span className="text-base font-black tracking-[0.4em] text-slate-900 dark:text-white">
                                {revealedPinId === judge.id ? judge.pin : '••••'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); setRevealedPinId(revealedPinId === judge.id ? null : judge.id); }}
                                className="p-1.5 text-slate-500 hover:text-[#ff0068] transition-colors"
                                title={revealedPinId === judge.id ? 'Ocultar' : 'Mostrar'}
                              >
                                {revealedPinId === judge.id ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(judge.pin!, 'pin'); }}
                                className="p-1.5 text-slate-500 hover:text-[#ff0068] transition-colors"
                                title="Copiar PIN"
                              >
                                {copiedField === 'pin' ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {judge.competencias_generos.map(g => (
                            <span key={g} className="px-2 py-1 bg-[#ff0068]/10 text-[#ff0068] rounded-xl text-[9px] font-black uppercase tracking-widest">
                              {g}
                              {judge.competencias_artisticas?.includes(g) && (
                                <span className="ml-1 text-violet-400" title="Avalia como Artístico">· A</span>
                              )}
                            </span>
                          ))}
                          {judge.competencias_formatos.map(f => (
                            <span key={f} className="px-2 py-1 bg-violet-500/10 text-violet-500 rounded-xl text-[9px] font-black uppercase tracking-widest">{f}</span>
                          ))}
                        </div>
                        {judge.mini_bio && (
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 italic leading-snug">{judge.mini_bio}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ── */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setModalOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                    {editingJudge ? 'Editar' : 'Novo'} <span className="text-[#ff0068]">Jurado</span>
                  </h2>
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mt-0.5">
                    {editingJudge ? editingJudge.name : 'Preencha os dados abaixo'}
                  </p>
                </div>
                <button onClick={() => setModalOpen(false)} className="p-2 text-slate-400 hover:text-rose-500 transition-all">
                  <X size={20} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 px-6 pt-4 shrink-0">
                {[
                  { key: 'publico', label: 'Dados Públicos', icon: Award },
                  { key: 'tecnico', label: 'Dados Técnicos', icon: ShieldCheck },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key as any)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      tab === key
                        ? 'bg-[#ff0068] text-white shadow-md shadow-[#ff0068]/20'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                    }`}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>

              {/* Modal body (scrollable) */}
              <div className="overflow-y-auto flex-1 p-6 space-y-5">

                {/* ── TAB: Dados Públicos ── */}
                {tab === 'publico' && (
                  <>
                    <div className="flex gap-4 items-start">
                      {/* Avatar preview + upload */}
                      <div className="shrink-0 relative group">
                        <img
                          src={form.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(form.name || 'jurado')}`}
                          alt="avatar"
                          className="w-16 h-16 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-white/10"
                        />
                        {/* Camera overlay sempre visível em mobile (touch não tem hover).
                            Padrão LinkedIn/Twitter/iOS Photos: ícone com badge no canto. */}
                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={avatarUploading}
                          className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#ff0068] text-white flex items-center justify-center shadow-lg ring-2 ring-white dark:ring-slate-900 hover:scale-110 transition-transform"
                          title={form.avatar_url ? 'Trocar foto' : 'Adicionar foto'}
                          aria-label={form.avatar_url ? 'Trocar foto' : 'Adicionar foto'}
                        >
                          {avatarUploading
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Camera size={12} />
                          }
                        </button>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => { if (e.target.files?.[0]) handleAvatarUpload(e.target.files[0]); }}
                        />
                      </div>
                      <div className="flex-1">
                        <label className={labelCls}>Nome Artístico / Profissional *</label>
                        <input
                          type="text"
                          placeholder="Ex: Ticko Bboy"
                          value={form.name}
                          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    {/* Botão "Trocar foto" duplicado removido — Camera overlay no canto
                        da foto cumpre a função (padrão LinkedIn/Twitter/iOS Photos). */}

                    <div>
                      <label className={labelCls}>Especialidade / Mini-Bio (máx. 2 linhas)</label>
                      <textarea
                        rows={2}
                        placeholder="Ex: Especialista em Danças Urbanas, 26 anos de mercado, coreógrafo premiado."
                        value={form.mini_bio}
                        onChange={e => setForm(f => ({ ...f, mini_bio: e.target.value }))}
                        className={`${inputCls} resize-none`}
                        maxLength={160}
                      />
                      <p className="text-[9px] text-slate-400 ml-1 mt-1">{(form.mini_bio || '').length}/160 — aparece no boletim do bailarino</p>
                    </div>

                    <div>
                      <label className={labelCls}>Instagram</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-black text-sm">@</span>
                        <input
                          type="text"
                          placeholder="seu.instagram"
                          value={form.instagram || ''}
                          onChange={e => setForm(f => ({ ...f, instagram: e.target.value.replace('@', '') }))}
                          className={`${inputCls} pl-9`}
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 ml-1 mt-1">Gera mídia orgânica quando o bailarino posta a nota e marca o jurado</p>
                    </div>

                    <div>
                      <label className={labelCls}>Idioma do Terminal</label>
                      <select
                        value={form.language || 'pt-BR'}
                        onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                        className={`${inputCls} bg-slate-50 dark:bg-slate-800`}
                      >
                        <option value="pt-BR" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Português (Brasil)</option>
                        <option value="en-US" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">English</option>
                        <option value="es-ES" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Español</option>
                      </select>
                      <p className="text-[9px] text-slate-400 ml-1 mt-1">Idioma exibido no Terminal de Jurados deste jurado</p>
                    </div>

                    <div>
                      <label className={labelCls}>Status</label>
                      <div className="flex gap-3">
                        {[
                          { val: true, label: 'Ativo', color: 'bg-emerald-500' },
                          { val: false, label: 'Inativo', color: 'bg-slate-400' },
                        ].map(({ val, label, color }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, is_active: val }))}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                              form.is_active === val
                                ? 'border-transparent text-white shadow-md ' + color
                                : 'bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/10 text-slate-500'
                            }`}
                          >
                            <div className={`w-2 h-2 rounded-full ${form.is_active === val ? 'bg-white' : color}`} />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Etapa 1.5: campo Gênero — controla flexão "Jurado/a/e"
                        no card público da vitrine. Inclusivo (M / F / NB). */}
                    <div>
                      <label className={labelCls}>Como aparecer no card público</label>
                      <p className="text-[9px] text-slate-400 mb-2 ml-1">Define como a palavra "Jurado" é flexionada no chip do card. Default: detecta pelo nome.</p>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { val: null, label: 'Auto', sub: 'Pelo nome' },
                          { val: 'M' as const, label: 'Jurado', sub: 'Masculino' },
                          { val: 'F' as const, label: 'Jurada', sub: 'Feminino' },
                        ]).map(opt => {
                          const active = (form.gender ?? null) === opt.val;
                          return (
                            <button
                              key={String(opt.val)}
                              type="button"
                              onClick={() => setForm(f => ({ ...f, gender: opt.val }))}
                              className={`text-left p-2.5 rounded-xl border transition-all ${
                                active
                                  ? 'border-[#ff0068]/60 bg-[#ff0068]/10'
                                  : 'border-slate-200 dark:border-white/10 hover:border-[#ff0068]/30'
                              }`}
                            >
                              <p className={`text-[10px] font-black uppercase tracking-tight ${active ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'}`}>
                                {opt.label}
                              </p>
                              <p className="text-[9px] text-slate-400 mt-0.5">{opt.sub}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Etapa 1.5: toggle Publicar na vitrine */}
                    <div>
                      <label className={labelCls}>Publicar na vitrine pública</label>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, is_public: !f.is_public }))}
                        className={`flex items-center justify-between gap-3 w-full px-4 py-3 rounded-xl border text-left transition-all ${
                          form.is_public
                            ? 'border-[#ff0068] bg-[#ff0068]/10'
                            : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5'
                        }`}
                      >
                        <div className="flex-1">
                          <p className={`text-[11px] font-black uppercase tracking-widest ${form.is_public ? 'text-[#ff0068]' : 'text-slate-700 dark:text-slate-300'}`}>
                            {form.is_public ? '✓ Visível pro público' : 'Oculto da vitrine'}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                            Quando ativo, o card aparece na seção "Jurados" da página pública do evento (foto + bio + modalidades + Instagram).
                          </p>
                        </div>
                        <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${form.is_public ? 'bg-[#ff0068] justify-end' : 'bg-slate-300 dark:bg-white/10 justify-start'}`}>
                          <div className="w-5 h-5 bg-white rounded-full shadow" />
                        </div>
                      </button>
                    </div>

                    {/* Sessão Seletiva v1: pode avaliar vídeo da seletiva? */}
                    <div className="md:col-span-2">
                      <label className={labelCls}>Avalia seletiva de vídeo</label>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, can_evaluate_video: !f.can_evaluate_video }))}
                        className={`flex items-center justify-between gap-3 w-full px-4 py-3 rounded-xl border text-left transition-all ${
                          form.can_evaluate_video
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5'
                        }`}
                      >
                        <div className="flex-1">
                          <p className={`text-[11px] font-black uppercase tracking-widest ${form.can_evaluate_video ? 'text-emerald-500' : 'text-slate-700 dark:text-slate-300'}`}>
                            {form.can_evaluate_video ? '✓ Acessa a fila de seletiva' : 'Sem acesso à seletiva'}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                            Quando ativo, este jurado pode avaliar os vídeos enviados na seletiva (modo multi-jurado). Default: ativo.
                          </p>
                        </div>
                        <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${form.can_evaluate_video ? 'bg-emerald-500 justify-end' : 'bg-slate-300 dark:bg-white/10 justify-start'}`}>
                          <div className="w-5 h-5 bg-white rounded-full shadow" />
                        </div>
                      </button>
                    </div>
                  </>
                )}

                {/* ── TAB: Dados Técnicos ── */}
                {tab === 'tecnico' && (
                  <>
                    {/* Trava de Competência + Tipo de Júri por estilo */}
                    <div>
                      <label className={labelCls + ' flex items-center gap-1.5'}>
                        <Fingerprint size={12} /> Trava de Competência — Gêneros que ele julga
                      </label>
                      <p className="text-[9px] text-slate-400 ml-1 mb-3">
                        O terminal do jurado só exibirá as apresentações dos gêneros selecionados. Pra cada estilo marcado, escolha se ele avalia como <strong>Técnico</strong> (critério da própria especialidade) ou <strong>Artístico</strong> (olhar geral — Impacto Cênico/Interpretação, configurado em Avaliação → Critério Artístico). Mesmo jurado pode ser Técnico num estilo e Artístico noutro — ex: Técnico em K-Pop, Artístico em Danças Urbanas.
                      </p>
                      {genreNames.length === 0 ? (
                        <p className="text-[10px] text-slate-400 italic">Nenhum gênero cadastrado. Vá em Configurações → Gêneros.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {genreNames.map(g => {
                            // Match case-insensitive: o nome canônico em genreNames pode
                            // diferir em maiúscula/minúscula do que foi salvo no jurado,
                            // já que vinha de uma das rows duplicadas no banco.
                            const selected = isStyleInList(g, form.competencias_generos);
                            const isArtistico = isStyleInList(g, form.competencias_artisticas);
                            return (
                              <div
                                key={g}
                                className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-all ${
                                  selected
                                    ? 'border-[#ff0068]/30 bg-[#ff0068]/5'
                                    : 'border-slate-200 dark:border-white/10'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleList('competencias_generos', g)}
                                  className="flex items-center gap-2.5 flex-1 text-left"
                                >
                                  <div className={`w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-all ${
                                    selected ? 'bg-[#ff0068] border-[#ff0068]' : 'border-slate-300 dark:border-white/20'
                                  }`}>
                                    {selected && <CheckCircle2 size={10} className="text-white" />}
                                  </div>
                                  <span className={`text-[11px] font-bold uppercase tracking-tight ${
                                    selected ? 'text-slate-900 dark:text-white' : 'text-slate-400'
                                  }`}>
                                    {g}
                                  </span>
                                </button>
                                {selected && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest hidden sm:inline">Tipo</span>
                                    <select
                                      value={isArtistico ? 'artistico' : 'tecnico'}
                                      onChange={e => {
                                        const wantsArtistico = e.target.value === 'artistico';
                                        if (wantsArtistico !== isArtistico) toggleArtistico(g);
                                      }}
                                      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg py-1.5 pl-2 pr-1 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#ff0068]/50"
                                    >
                                      <option value="tecnico">Técnico</option>
                                      <option value="artistico">Artístico</option>
                                    </select>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Formatos que avalia */}
                    <div>
                      <label className={labelCls + ' flex items-center gap-1.5'}>
                        <Mic size={12} /> Formatos de Apresentação — Feedback em áudio
                      </label>
                      <p className="text-[9px] text-slate-400 ml-1 mb-3">
                        Define em quais formatos o jurado envia feedback por áudio ao bailarino.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {FORMATS.map(f => (
                          <TagToggle
                            key={f} item={f}
                            selected={form.competencias_formatos.includes(f)}
                            onToggle={() => toggleList('competencias_formatos', f)}
                            color="bg-violet-600"
                          />
                        ))}
                      </div>
                    </div>

                    {/* PIN */}
                    <div>
                      <label className={labelCls + ' flex items-center gap-1.5'}>
                        <KeyRound size={12} /> PIN de Acesso (4 dígitos)
                      </label>
                      <p className="text-[9px] text-slate-400 ml-1 mb-2">
                        Gerado automaticamente pelo sistema. Compartilhe com o jurado via WhatsApp ao enviar o link de acesso.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type={showPin ? 'text' : 'password'}
                          inputMode="numeric"
                          maxLength={4}
                          placeholder="0000"
                          value={form.pin || ''}
                          onChange={e => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                            setForm(f => ({ ...f, pin: v }));
                          }}
                          className={`${inputCls} w-32 text-center text-xl tracking-[0.4em] font-black`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPin(s => !s)}
                          className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-500 hover:text-[#ff0068] transition-all"
                          title={showPin ? 'Ocultar PIN' : 'Mostrar PIN'}
                        >
                          {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => form.pin && copyToClipboard(form.pin, 'pin')}
                          disabled={!form.pin || form.pin.length !== 4}
                          className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-500 hover:text-[#ff0068] transition-all disabled:opacity-40"
                          title="Copiar PIN"
                        >
                          {copiedField === 'pin'
                            ? <CheckCircle2 size={14} className="text-emerald-500" />
                            : <Copy size={14} />
                          }
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, pin: generatePin() }))}
                          className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-500 hover:text-[#ff0068] transition-all"
                          title="Gerar novo PIN"
                        >
                          <RefreshCw size={14} />
                        </button>
                      </div>
                    </div>

                  </>
                )}
              </div>

              {/* Error / success banner */}
              {(saveError || saveSuccess) && (
                <div className={`mx-6 mb-0 mt-0 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2
                  ${saveSuccess
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30'
                    : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30'
                  }`}
                >
                  {saveSuccess ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {saveSuccess ? 'Jurado salvo com sucesso!' : saveError}
                </div>
              )}

              {/* Modal footer */}
              <div className="flex gap-3 p-6 border-t border-slate-100 dark:border-white/5 shrink-0">
                <button
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-3 rounded-2xl bg-[#ff0068] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'Salvando...' : 'Salvar Jurado'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default JudgesManagement;
