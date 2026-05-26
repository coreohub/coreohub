import React, { useEffect, useState, useMemo } from 'react';
import {
  Search, Download, RefreshCw,
  Trash2, AlertTriangle, X, DollarSign,
  ShieldAlert, CheckCircle2, Clock, Users, Info, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Bell, SlidersHorizontal,
  Undo2, Loader2, Eye, Music2, Video, Calendar, User, Instagram,
  TrendingUp, ExternalLink, Pencil, Save, Lock as LockIcon,
  BarChart3, MessageCircle,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { refundRegistration } from '../services/refundService';
import EventPickerSheet from '../components/EventPickerSheet';
import { maskCpfCnpj, unmaskCpfCnpj, validateCpf, maskData, parseDataISO, maskMoeda, parseMoeda } from '../utils/masks';
import BailarinosEditor from '../components/BailarinosEditor';
import {
  hasIncompleteBailarinos as hasIncompleteBailarinosUtil,
  isElencoIncompleto,
  collectAllBailarinosIds,
  type ElencoById,
  type ElencoRow,
} from '../utils/bailarinos';

const Registrations = () => {
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [filteredRegistrations, setFilteredRegistrations] = useState<any[]>([]);
  // Map de rows da tabela `elenco` (id → row), hidratada via batch fetch
  // após carregar as registrations. Fonte de verdade dos dados pessoais
  // (CPF, data_nascimento, nome). O JSONB `bailarinos_detalhes` só tem
  // `{id, nome, instagram_handle}` por design (ver pages/InscricaoWizard.tsx:826).
  // RLS `producer_reads_event_elenco` (migration 20260601) libera o produtor
  // a ler elenco dos bailarinos referenciados nas inscrições do evento dele.
  const [elencoById, setElencoById] = useState<ElencoById>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('ALL');
  const [modalidadeFilter, setModalidadeFilter] = useState('ALL');
  const [categoriaFilter, setCategoriaFilter] = useState('ALL');
  const [estiloFilter, setEstiloFilter] = useState('ALL');
  const [inscritoFilter, setInscritoFilter] = useState('ALL');
  // Pedido Grazieli/Usualdance 2026-05-19: filtrar por Mostra Competitiva/Avaliada.
  const [tipoApresentacaoFilter, setTipoApresentacaoFilter] = useState<'ALL' | 'Competitiva' | 'Avaliada'>('ALL');
  // Sessão 3 P4 backlog painel produtor — filtro por range de data
  const [dateFilter, setDateFilter] = useState<'ALL' | 'today' | '7d' | '30d' | 'month'>('ALL');
  // Sessão 4.1 P8: alerta rápido (vencendo em 24h / trilhas pendentes). Click no
  // banner do topo seta esse filtro extra que sobrepõe os filtros normais.
  // 'fora_faixa' não entra aqui — vai pra aba TRIAGEM direto (regime separado).
  const [quickAlert, setQuickAlert] = useState<'vencendo' | 'no_trilha' | 'incompletos' | null>(null);
  // Sessão 4.1 sort header: click na coluna alterna asc/desc. Default é data desc
  // (mais recentes primeiro, padrão Stripe/Linear).
  const [sortBy, setSortBy]   = useState<'data' | 'nome' | 'valor' | 'status'>('data');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Sessão 4.1 paginação: lista trava mobile com 50+ rows. PAGE_SIZE 50 cobre
  // 90%+ dos festivais BR pequenos/médios sem precisar paginar.
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  // Sessão 4.1 P5 comparativo edição anterior. Quando o evento atual tem
  // edition_year e existe outro evento do mesmo produtor com edition_year menor,
  // computa receita + inscrições pagas pra mostrar delta no topo.
  const [prevEdition, setPrevEdition] = useState<{
    name: string;
    edition_year: number;
    receita: number;
    inscricoes: number;
  } | null>(null);
  // Sessão 4.2 item 6: drawer único de filtros (padrão Sympla/Linear). Hoje
  // os 7 selects ocupam 2 linhas no desktop. Drawer abre on-demand, mostra
  // chips dos filtros ativos sempre visíveis (com X pra remover individual).
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Sessão 4.2 PR3: card "Análise Financeira" colapsável. Default fechado
  // pra não sobrecarregar visão inicial — produtor abre quando quer
  // explorar quem são os top estúdios / distribuição etc.
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  // Sessão 4.2 PR3 — bulk actions (ações em massa).
  // Set<id> evita duplicatas e dá O(1) pra toggle. Só desktop (table view)
  // por enquanto — mobile (cards) precisaria de "selection mode" toggle.
  // Action bar flutuante embaixo quando ≥1 selecionado.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionFeedback, setBulkActionFeedback] = useState<string | null>(null);
  const [refundModal, setRefundModal] = useState<any>(null);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  // Edição inline de inscrição (pedido Grazieli/Usualdance 2026-05-19):
  // produtor corrige estilo/categoria/formação/tipo_apresentacao no modal de
  // detalhes. RLS protege — produtor edita as próprias, super admin tem bypass.
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const startEditing = (reg: any) => {
    setEditing(true);
    setEditError(null);
    setEditValues({
      formato_participacao: reg.formato_participacao ?? '',
      categoria:            reg.categoria ?? '',
      estilo_danca:         reg.estilo_danca ?? '',
      tipo_apresentacao:    reg.tipo_apresentacao ?? '',
      // Refator 2026-06-01: CPF/data/nome reais vêm da `elenco` (JSONB
      // bailarinos_detalhes só tem id+nome+@). elencoId carrega o id da row
      // pra save fazer UPDATE em vez de INSERT. Produtor não cria bailarino
      // novo aqui (canAddRemove=false no editor + RLS só FOR UPDATE).
      bailarinos: Array.isArray(reg.bailarinos_detalhes)
        ? reg.bailarinos_detalhes.map((b: any) => {
            const elenco = b?.id ? elencoById[b.id] : null;
            const dobIso = String(elenco?.data_nascimento ?? '').trim();
            const dobBR = dobIso
              ? maskData(dobIso.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3$2$1'))
              : '';
            return {
              elencoId:         b?.id || undefined,
              nome:             elenco?.nome ?? b?.nome ?? '',
              cpf:              maskCpfCnpj(String(elenco?.cpf ?? '')),
              data_nascimento:  dobBR,
              instagram_handle: b?.instagram_handle ?? '',
            };
          })
        : [],
      // Solo/Duo/Trio → @ por bailarino; Grupo/Conjunto → 1 @ unico do grupo
      // (combinado em sessao anterior — pedir @ de 4+ bailarinos sobrecarrega o
      // coreografo na pratica). Padrao validado em InscricaoWizard.tsx:1531.
      instagram_principal: reg.instagram_principal ?? '',
    });
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditError(null);
    setEditValues({});
  };

  // Mutadores agora vivem em components/BailarinosEditor.tsx (refactor 2026-05-22).
  // O componente recebe `bailarinos` + `onChange` e gerencia add/remove/update internamente.

  const handleSaveEdit = async (regId: string) => {
    setSavingEdit(true);
    setEditError(null);
    try {
      const patch: Record<string, any> = {};
      // Só envia campos que mudaram pra não resetar coluna por engano.
      for (const k of ['formato_participacao', 'categoria', 'estilo_danca', 'tipo_apresentacao']) {
        const v = editValues[k]?.trim?.() ?? editValues[k];
        if (v !== undefined && v !== '') patch[k] = v;
      }
      // Sessão 4.2 item 2: bailarinos editáveis. Normaliza CPF (só dígitos),
      // valida quando preenchido, força lowercase no instagram (lição 2026-05-19),
      // converte data BR→ISO. Solo/Duo/Trio → @ por bailarino; Grupo/Conjunto →
      // só @ principal (skip instagram_handle individual no save pra não persistir
      // sujeira se a inscrição mudar de modalidade).
      const formato = (patch.formato_participacao ?? editValues.formato_participacao ?? '') as string;
      const isGrupoLike = formato === 'Grupo' || formato === 'Conjunto';
      // Refator 2026-06-01: dados pessoais persistem em `elenco`. Produtor faz
      // SÓ UPDATE (RLS producer_updates_event_elenco em 20260602) — nunca
      // INSERT/DELETE. canAddRemove=false no editor garante que o array do
      // form nunca tem bailarino novo sem elencoId. Se aparecer (bug futuro),
      // levanta erro claro.
      let normalizedJsonb: any[] | undefined;
      if (Array.isArray(editValues.bailarinos)) {
        const updates: Array<{ elencoId: string; nome: string; cpf: string; data_nascimento: string; instagram_handle?: string }> = [];
        for (let i = 0; i < editValues.bailarinos.length; i++) {
          const b = editValues.bailarinos[i];
          if (!b?.elencoId) {
            throw new Error(`Bailarino ${i + 1} sem id de elenco. Produtor não pode adicionar bailarinos — peça pro inscrito completar via /minhas-coreografias.`);
          }
          const cpfDigits = unmaskCpfCnpj(String(b?.cpf ?? ''));
          if (cpfDigits && cpfDigits.length === 11 && !validateCpf(cpfDigits)) {
            throw new Error(`CPF inválido no bailarino ${i + 1}${b?.nome ? ` (${b.nome})` : ''}.`);
          }
          if (cpfDigits && cpfDigits.length !== 11) {
            throw new Error(`CPF incompleto no bailarino ${i + 1}${b?.nome ? ` (${b.nome})` : ''}.`);
          }
          // Data vem mascarada (DD/MM/AAAA) — converte pra ISO. Vazia passa direto.
          const dobMasked = String(b?.data_nascimento ?? '').trim();
          let dobIso = '';
          if (dobMasked) {
            const iso = parseDataISO(dobMasked);
            if (!iso) {
              throw new Error(`Data de nascimento inválida no bailarino ${i + 1}: use DD/MM/AAAA.`);
            }
            dobIso = iso;
          }
          updates.push({
            elencoId:         b.elencoId,
            nome:             String(b?.nome ?? '').trim(),
            cpf:              cpfDigits,
            data_nascimento:  dobIso,
            instagram_handle: isGrupoLike
              ? undefined
              : (String(b?.instagram_handle ?? '').trim().toLowerCase().replace(/^@/, '') || undefined),
          });
        }

        // Persiste cada UPDATE individual em elenco (RLS filtra por evento).
        for (let i = 0; i < updates.length; i++) {
          const u = updates[i];
          const { data, error } = await supabase
            .from('elenco')
            .update({
              nome:            u.nome,
              cpf:             u.cpf,
              data_nascimento: u.data_nascimento || null,
            })
            .eq('id', u.elencoId)
            .select('id');
          if (error) throw error;
          if (!data || data.length === 0) {
            throw new Error(`Sem permissão pra editar o bailarino ${i + 1}. Recarregue e tente de novo.`);
          }
        }

        // Reconstrói bailarinos_detalhes (referência leve) preservando ids,
        // atualizando nome e instagram_handle. CPF/data NÃO entram aqui — só
        // moram em elenco.
        normalizedJsonb = updates.map(u => ({
          id:               u.elencoId,
          nome:             u.nome,
          instagram_handle: u.instagram_handle ?? null,
        }));
        patch.bailarinos_detalhes = normalizedJsonb;

        // Hidrata elencoById local pra refletir sem refetch.
        setElencoById(prev => {
          const next = { ...prev };
          for (const u of updates) {
            next[u.elencoId] = {
              id:              u.elencoId,
              nome:            u.nome,
              cpf:             u.cpf,
              data_nascimento: u.data_nascimento || null,
            };
          }
          return next;
        });
      }
      // @ do grupo/coreografo (Grupo/Conjunto only). Em Solo/Duo/Trio limpa pra
      // nao guardar sujeira de uma edicao previa que era em outra modalidade.
      const igPrincipal = String(editValues.instagram_principal ?? '').trim().toLowerCase().replace(/^@/, '');
      patch.instagram_principal = isGrupoLike ? (igPrincipal || null) : null;
      // .select('id') força PostgREST a retornar as rows afetadas. Sem isso,
      // RLS bloqueando o UPDATE retorna 200/204 com 0 rows e o front pensa que
      // salvou. Bug descoberto na auditoria 2026-05-21: produtor sem policy
      // UPDATE (migration 20260525) salvava no localStorage do React mas nao
      // persistia no banco.
      const { data, error } = await supabase
        .from('registrations')
        .update(patch)
        .eq('id', regId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Sem permissão pra editar essa inscrição. Aplique a migration 20260525 ou peça pro admin.');
      }
      // Atualiza state local pra refletir mudança sem refetch.
      setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, ...patch } : r));
      setViewingReg((prev: any) => prev && prev.id === regId ? { ...prev, ...patch } : prev);
      cancelEditing();
    } catch (e: any) {
      setEditError(e.message ?? 'Erro ao salvar.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenRefund = (reg: any) => {
    // Guard: rejeita silently se já estornada. O botão FOI mostrado mesmo
    // em ESTORNADO em ~1 caso reportado (provavelmente state local stale
    // entre webhook e refresh). Sem o guard, modal abria com valor zumbi
    // e produtor podia tentar refund duplicado contra Asaas.
    if (reg?.status_pagamento === 'ESTORNADO' || reg?.refunded_at) {
      alert('Esta inscrição já foi reembolsada.');
      return;
    }
    setRefundModal(reg);
    // Pré-preenche com valor pago (padrão Asaas/Stripe). Produtor edita
    // pra reembolso parcial. Tenta valor_total → valor_pago (legacy) → vazio.
    // Usa maskMoeda (centavos progressivos, formato "R$ 40,00") em vez de
    // type=number que sofre com spinner, scroll, autofill — bug reportado
    // 2026-05-25 onde modal abria com "3600548411111" por acumulação.
    const valorPago = Number(reg?.valor_total ?? reg?.valor_pago ?? 0);
    const cents = Math.round(valorPago * 100);
    setRefundAmount(cents > 0 ? maskMoeda(String(cents)) : '');
    setRefundReason('');
    setRefundError(null);
  };

  const handleConfirmRefund = async () => {
    if (!refundModal) return;
    setRefunding(true);
    setRefundError(null);
    try {
      const parsedAmount = refundAmount ? parseMoeda(refundAmount) : 0;
      const result = await refundRegistration({
        registration_id: refundModal.id,
        amount:          parsedAmount > 0 ? parsedAmount : undefined,
        reason:          refundReason || undefined,
      });
      setRegistrations(prev => prev.map(r => r.id === refundModal.id
        ? { ...r, status: 'CANCELADA', status_pagamento: 'ESTORNADO', refunded_at: new Date().toISOString(), refund_amount: result.refund_amount }
        : r));
      setRefundModal(null);
    } catch (e: any) {
      setRefundError(e.message);
    } finally {
      setRefunding(false);
    }
  };
  const [tab, setTab] = useState<'LIST' | 'TRIAGEM'>('LIST');
  const [reviewingReg, setReviewingReg] = useState<any>(null);
  // Modal "Ver detalhes" — pedido pelo produtor (Usualdance 2026-05-18).
  // Linha da tabela vira clicável (estilo Notion/Linear). Abre modal com
  // todos os campos: coreografia, bailarinos, trilha, vídeo, pagamento.
  const [viewingReg, setViewingReg] = useState<any>(null);

  /* tolerance + config loaded once */
  const [toleranceRule, setToleranceRule] = useState<{ mode: 'PERCENT' | 'COUNT'; value: number }>({ mode: 'PERCENT', value: 20 });
  const [ageRefMode, setAgeRefMode] = useState<'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE'>('EVENT_DAY');
  const [ageRefFixed, setAgeRefFixed] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [triageAction, setTriageAction] = useState<{ reg: any; decision: 'APPROVE' | 'PENALIZE' | 'DISQUALIFY' } | null>(null);

  /* Edition selector */
  const [allEvents, setAllEvents] = useState<{ id: string; name: string; edition_year?: number }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  /* Evento ativo (nome + slug) — usado no CTA do empty state pra compor o
     link público do evento. Carregado junto do fetchData. */
  const [activeEventInfo, setActiveEventInfo] = useState<{ name?: string; slug?: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    // Default do dropdown: primeiro evento (ordenado por created_at desc).
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('events')
        .select('id,name,edition_year,start_date,is_demo,created_at')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setAllEvents(data);
        setSelectedEventId(prev => prev ?? data[0].id);
      }
    })();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Schema real usa created_at (não criado_em). order com coluna inexistente
      // fazia o select falhar silently — explicação do "0 inscrições" no demo.
      // Pull events.video_selection_enabled pra o modal de detalhes mostrar a
      // seção "Vídeo (seletiva)" só quando o evento tem a feature habilitada.
      // Profiles NÃO podem ser embed porque registrations.user_id referencia
      // auth.users(id), não profiles(id) — Postgrest não infere a FK e o query
      // inteiro retorna 0 rows (bug em prod 2026-05-18). Fetch separado abaixo.
      // Sem embed events(...) — o embed quebrava a query inteira (Postgrest
      // retornava 0 rows) quando a RLS de events não permitia ler o evento
      // pai. Bug em prod 2026-05-18: /seletiva-video mostrava a inscrição
      // mas /registrations zerava. Fetch separado abaixo pega o flag de
      // video_selection_enabled do evento ativo (1 query por mount).
      let regsQuery = supabase
        .from('registrations')
        .select('*')
        .order('created_at', { ascending: false });
      if (selectedEventId) regsQuery = regsQuery.eq('event_id', selectedEventId);

      const { fetchActiveEventConfig } = await import('../services/supabase');
      const [
        { data, error },
        cfg,
      ] = await Promise.all([
        regsQuery,
        fetchActiveEventConfig('tolerancia,age_reference,age_reference_date,data_evento'),
      ]);
      if (error) throw error;

      // Hidrata profiles em batch (1 query extra). Vazio se nenhuma inscrição
      // tem user_id (fluxo antigo guest). Map por id pra lookup O(1) no merge.
      const userIds = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
      let profilesById: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, email, whatsapp')
          .in('id', userIds);
        profilesById = Object.fromEntries((profs || []).map(p => [p.id, p]));
      }

      // Fetch separado do evento ativo (modal + empty state precisam).
      // Não pode ser embed na query principal porque travava o query
      // inteiro em prod (ver bug 2026-05-18).
      let activeEvent: { video_selection_enabled?: boolean; name?: string; slug?: string } | null = null;
      if (selectedEventId) {
        const { data: ev } = await supabase
          .from('events')
          .select('video_selection_enabled, name, slug')
          .eq('id', selectedEventId)
          .maybeSingle();
        activeEvent = ev;
        setActiveEventInfo(ev);
      }

      const enriched = (data || []).map(r => ({
        ...r,
        profiles: r.user_id ? profilesById[r.user_id] ?? null : null,
        events: activeEvent,
      }));
      setRegistrations(enriched);
      setFilteredRegistrations(enriched);

      // Hidrata elenco em batch. RLS `producer_reads_event_elenco` filtra
      // automaticamente pelos ids referenciados nas inscrições do produtor.
      // Sem isso, helper trataria tudo como incompleto (id no JSONB sem row
      // visível = inconsistente). Aqui o JSONB é fonte da lista de ids; o
      // elenco fornece os dados pessoais.
      const allIds = collectAllBailarinosIds(enriched);
      if (allIds.length > 0) {
        const { data: elenco } = await supabase
          .from('elenco')
          .select('id, nome, cpf, data_nascimento')
          .in('id', allIds);
        const map: ElencoById = Object.fromEntries(
          (elenco ?? []).map((e: ElencoRow) => [e.id, e])
        );
        setElencoById(map);
      } else {
        setElencoById({});
      }

      if (cfg?.tolerancia) setToleranceRule(cfg.tolerancia);
      if (cfg?.age_reference) setAgeRefMode(cfg.age_reference as 'EVENT_DAY' | 'YEAR_END' | 'FIXED_DATE');
      if (cfg?.age_reference_date) setAgeRefFixed(cfg.age_reference_date);
      if (cfg?.data_evento) setEventDate(cfg.data_evento);

      // P5 backlog painel produtor — comparativo edição anterior. Procura no
      // próprio dropdown (mesmo produtor) o evento com maior edition_year que
      // ainda seja < edição atual. Não filtra por nome porque produtor pode
      // ter renomeado entre edições (ex.: "Usualdance 2025" → "Festival Cultural
      // Estúdio 2026"). Esse mesmo princípio do ResultsPanel.tsx:259.
      const currentEvent = allEvents.find(e => e.id === selectedEventId);
      if (currentEvent?.edition_year) {
        const prev = allEvents
          .filter(e => e.id !== selectedEventId && typeof e.edition_year === 'number' && e.edition_year < (currentEvent.edition_year as number))
          .sort((a, b) => (b.edition_year ?? 0) - (a.edition_year ?? 0))[0];
        if (prev) {
          const { data: prevRegs } = await supabase
            .from('registrations')
            .select('status_pagamento, valor_pago, valor_total, mod_fee, charged_amount')
            .eq('event_id', prev.id);
          const pagas = (prevRegs ?? []).filter(r => r.status_pagamento === 'APROVADO' || r.status_pagamento === 'CONFIRMADO');
          const receita = pagas.reduce((s, r) => {
            const v = Number(r.valor_pago ?? r.valor_total ?? r.charged_amount ?? r.mod_fee ?? 0) || 0;
            return s + v;
          }, 0);
          setPrevEdition({ name: prev.name, edition_year: prev.edition_year as number, receita, inscricoes: pagas.length });
        } else {
          setPrevEdition(null);
        }
      } else {
        setPrevEdition(null);
      }
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    // Webhook sempre salva 'APROVADO'. Manter consistência aqui também
    // — o painel deve mostrar o mesmo valor em ambos os caminhos
    // (pagamento real via Asaas + aprovação manual pelo produtor).
    const { error } = await supabase.from('registrations').update({ status: 'APROVADA', status_pagamento: 'APROVADO' }).eq('id', id);
    if (error) return;
    setRegistrations(prev => prev.map(reg => reg.id === id ? { ...reg, status: 'APROVADA', status_pagamento: 'APROVADO' } : reg));
    setReviewingReg(null);
  };

  /* age-tolerance helpers */
  const resolveRefDate = (regEventDate?: string): string => {
    const base = regEventDate || eventDate || new Date().toISOString().slice(0, 10);
    if (ageRefMode === 'YEAR_END') {
      const year = new Date(base + 'T12:00:00').getFullYear();
      return `${year}-12-31`;
    }
    if (ageRefMode === 'FIXED_DATE' && ageRefFixed) return ageRefFixed;
    return base;
  };

  const calcAge = (dob: string, refDate: string) => {
    const birth = new Date(dob + 'T00:00:00');
    const ref = new Date(refDate + 'T00:00:00');
    let age = ref.getFullYear() - birth.getFullYear();
    const m = ref.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
    return age;
  };

  /**
   * Checks if a registration violates the age tolerance rule.
   * Returns { violates: boolean, outCount: number, totalCount: number, pct: number }
   *
   * Refator 2026-06-01: a `data_nascimento` é lida via JOIN com elencoById
   * (fonte de verdade). O JSONB `bailarinos_detalhes` só tem id+nome+@ —
   * b.data_nascimento sempre era undefined, então `outOfRange` ficava sempre
   * vazio e toda triagem etária retornava false. Mesmo bug do refator de
   * dados-pendentes ([[refactor-elenco-dados-pendentes-shipado]]).
   */
  const checkViolation = (reg: any) => {
    const bailarinos: any[] = reg.bailarinos_detalhes || [];
    if (!bailarinos.length || !reg.cat_min_age || !reg.cat_max_age) {
      return { violates: false, outCount: 0, totalCount: bailarinos.length, pct: 0 };
    }
    const refDate = resolveRefDate(reg.event_data);
    const outOfRange = bailarinos.filter(b => {
      const dob = elencoById[b?.id]?.data_nascimento;
      if (!dob) return false;
      const age = calcAge(dob, refDate);
      return age < reg.cat_min_age || age > reg.cat_max_age;
    });
    const outCount = outOfRange.length;
    const totalCount = bailarinos.length;
    const pct = totalCount > 0 ? (outCount / totalCount) * 100 : 0;

    let violates = false;
    if (toleranceRule.mode === 'PERCENT') violates = pct > toleranceRule.value;
    else violates = outCount > toleranceRule.value;

    return { violates, outCount, totalCount, pct, outOfRange };
  };

  /* registrations that actually have a violation */
  // Helper: webhook usa 'APROVADO'. Legado de meses atrás usava 'CONFIRMADO'.
  // Aceitar ambos pra cobrir rows antigas até backfill.
  const isPago = (s?: string) => s === 'APROVADO' || s === 'CONFIRMADO';

  /** Re-habilitado 2026-06-01 (refator) — agora consulta `elencoById`
   *  hidratado no fetchData. Detalhe da topologia em utils/bailarinos.ts.
   *  Render do modal usa `isElencoIncompleto(elencoById[b.id])` direto;
   *  esse wrapper aqui serve só pro filter/useMemo de alertCounts. */
  const hasIncompleteBailarinos = (reg: any): boolean => hasIncompleteBailarinosUtil(reg, elencoById);

  const violatingRegs = useMemo(() => {
    return registrations
      .filter(r => isPago(r.status_pagamento))
      .filter(r => {
        const { violates } = checkViolation(r);
        return violates;
      })
      .map(r => ({ ...r, _violation: checkViolation(r) }));
  }, [registrations, toleranceRule, ageRefMode, ageRefFixed, eventDate, elencoById]); // eslint-disable-line

  // Só dispara fetchData quando selectedEventId já resolveu — antes disso, o
  // primeiro fetch trazia TODOS os registros (sem filter), depois o segundo
  // fetch filtrava por evento e zerava se não batesse. Daí o flash "aparece
  // e some". Solução: aguardar resolução do evento ativo, evita 2 requests
  // e o flicker do estado intermediário.
  useEffect(() => {
    if (selectedEventId) fetchData();
    // Se allEvents resolveu vazio (produtor sem eventos), libera o loading
    else if (allEvents.length > 0 && !selectedEventId) setIsLoading(false);
  }, [selectedEventId, allEvents.length]); // eslint-disable-line

  useEffect(() => {
    let result = registrations;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(reg =>
        reg.nome_coreografia?.toLowerCase().includes(term) ||
        reg.estudio?.toLowerCase().includes(term) ||
        reg.profiles?.full_name?.toLowerCase().includes(term) ||
        reg.profiles?.email?.toLowerCase().includes(term)
      );
    }
    if (paymentFilter !== 'ALL') {
      // 'APROVADO' do filtro cobre rows antigas com 'CONFIRMADO' também.
      result = paymentFilter === 'APROVADO'
        ? result.filter(reg => isPago(reg.status_pagamento))
        : result.filter(reg => reg.status_pagamento === paymentFilter);
    }
    if (modalidadeFilter !== 'ALL') result = result.filter(reg => reg.formato_participacao === modalidadeFilter);
    if (categoriaFilter !== 'ALL') result = result.filter(reg => reg.categoria === categoriaFilter);
    if (estiloFilter !== 'ALL')    result = result.filter(reg => reg.estilo_danca === estiloFilter);
    if (inscritoFilter !== 'ALL')  result = result.filter(reg => (reg.inscrito_nome ?? reg.profiles?.full_name) === inscritoFilter);
    if (tipoApresentacaoFilter !== 'ALL') result = result.filter(reg => reg.tipo_apresentacao === tipoApresentacaoFilter);
    // Sessão 4.1 P8: filtro de alerta rápido. "Vencendo em 24h" usa o sinal
    // implícito de prazo (default dueDate do Asaas = created_at + 3d) — pega
    // PENDENTE criados há 48-72h. "Trilhas pendentes" = APROVADO sem trilha_url.
    if (quickAlert === 'vencendo') {
      result = result.filter(reg => {
        if (reg.status_pagamento !== 'PENDENTE') return false;
        const raw = reg.created_at ?? reg.criado_em;
        const t = raw ? new Date(raw).getTime() : 0;
        if (!t) return false;
        const ageH = (Date.now() - t) / 3600_000;
        return ageH >= 48 && ageH <= 72;
      });
    } else if (quickAlert === 'no_trilha') {
      result = result.filter(reg => isPago(reg.status_pagamento) && !reg.trilha_url);
    } else if (quickAlert === 'incompletos') {
      result = result.filter(reg => hasIncompleteBailarinos(reg));
    }
    // Filtro por data — usa created_at (data da inscrição)
    if (dateFilter !== 'ALL') {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const cutoff = (() => {
        if (dateFilter === 'today') return startOfDay;
        if (dateFilter === '7d')    return startOfDay - 6 * 86400_000;
        if (dateFilter === '30d')   return startOfDay - 29 * 86400_000;
        if (dateFilter === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        return 0;
      })();
      result = result.filter(reg => {
        // A18 auditoria Sessão 3: se a row não tem created_at/criado_em, NÃO
        // esconder do filtro (datar como Date.now() = inclui em qualquer cutoff
        // passado). O fallback antigo `?? 0` excluía rows antigas sem data.
        const raw = reg.created_at ?? reg.criado_em;
        const t = raw ? new Date(raw).getTime() : Date.now();
        return t >= cutoff;
      });
    }
    setFilteredRegistrations(result);
  }, [searchTerm, paymentFilter, modalidadeFilter, categoriaFilter, estiloFilter, inscritoFilter, tipoApresentacaoFilter, dateFilter, quickAlert, registrations, elencoById]);

  // Sessão 4.1 sort: ordena depois de filtrar pra estabilizar a navegação por
  // página (sem reorder no meio da paginação).
  const sortedRegistrations = useMemo(() => {
    const arr = [...filteredRegistrations];
    arr.sort((a, b) => {
      if (sortBy === 'nome') {
        const av = String(a.nome_coreografia ?? '');
        const bv = String(b.nome_coreografia ?? '');
        return sortDir === 'asc' ? av.localeCompare(bv, 'pt-BR') : bv.localeCompare(av, 'pt-BR');
      }
      if (sortBy === 'status') {
        const av = String(a.status_pagamento ?? '');
        const bv = String(b.status_pagamento ?? '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (sortBy === 'valor') {
        const av = Number(a.valor_pago ?? a.valor_total ?? a.charged_amount ?? a.mod_fee ?? 0) || 0;
        const bv = Number(b.valor_pago ?? b.valor_total ?? b.charged_amount ?? b.mod_fee ?? 0) || 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      // data (default)
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortDir === 'asc' ? at - bt : bt - at;
    });
    return arr;
  }, [filteredRegistrations, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRegistrations.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paginatedRegistrations = useMemo(() => {
    return sortedRegistrations.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  }, [sortedRegistrations, safePage]);

  // Reset pra página 1 quando filtros/sort/alerta mudam (evita ficar numa
  // página vazia depois que o conjunto diminuiu).
  useEffect(() => {
    setPage(1);
  }, [searchTerm, paymentFilter, modalidadeFilter, categoriaFilter, estiloFilter, inscritoFilter, tipoApresentacaoFilter, dateFilter, quickAlert, sortBy, sortDir]);

  // Sessão 4.2 item 6: contador de filtros ativos (exclui search/quickAlert porque
  // têm UI própria). Mostrado em badge no botão "Filtros".
  // Sessão 4.2 PR2 — keyboard nav no drill-down side panel.
  // ←/→ navega entre inscrições (sortedRegistrations ordem visível). Esc fecha.
  // Só ativa quando o panel está aberto pra não interferir com outros atalhos.
  useEffect(() => {
    if (!viewingReg) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = sortedRegistrations.findIndex((r: any) => r.id === viewingReg.id);
      if (e.key === 'Escape') { cancelEditing(); setViewingReg(null); return; }
      if (e.key === 'ArrowLeft' && idx > 0) {
        cancelEditing();
        setViewingReg(sortedRegistrations[idx - 1]);
      }
      if (e.key === 'ArrowRight' && idx >= 0 && idx < sortedRegistrations.length - 1) {
        cancelEditing();
        setViewingReg(sortedRegistrations[idx + 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewingReg, sortedRegistrations]);

  // Sessão 4.2 PR3 — bulk action helpers.
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleIds = useMemo(() => paginatedRegistrations.map((r: any) => r.id), [paginatedRegistrations]);
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id: string) => selectedIds.has(id));
  const someVisibleSelected = allVisibleIds.some((id: string) => selectedIds.has(id));

  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        allVisibleIds.forEach((id: string) => next.delete(id));
      } else {
        allVisibleIds.forEach((id: string) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Bulk actions: export CSV das selecionadas, copia emails, copia WhatsApps.
  const selectedRegs = useMemo(
    () => sortedRegistrations.filter((r: any) => selectedIds.has(r.id)),
    [sortedRegistrations, selectedIds],
  );

  const showBulkFeedback = (msg: string) => {
    setBulkActionFeedback(msg);
    setTimeout(() => setBulkActionFeedback(null), 2500);
  };

  const handleBulkExportCSV = () => {
    if (selectedRegs.length === 0) return;
    const headers = ['Data', 'Coreografia', 'Modalidade', 'Tipo', 'Estúdio', 'Categoria', 'Estilo', 'Inscrito', 'Email', 'WhatsApp', 'Status Inscrição', 'Status Pagamento', 'Valor (R$)'];
    const escape = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = selectedRegs.map((r: any) => [
      r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '',
      r.nome_coreografia ?? '', r.formato_participacao ?? '', r.tipo_apresentacao ?? '',
      r.estudio ?? '', r.categoria ?? '', r.estilo_danca ?? '',
      r.profiles?.full_name ?? r.inscrito_nome ?? '',
      r.profiles?.email ?? r.inscrito_email ?? '',
      r.profiles?.whatsapp ?? r.inscrito_whatsapp ?? '',
      r.status ?? '', r.status_pagamento ?? '',
      String(r.valor_pago ?? r.valor_total ?? r.charged_amount ?? ''),
    ].map(escape).join(';'));
    const csv = '﻿' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscricoes-selecionadas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showBulkFeedback(`${selectedRegs.length} ${selectedRegs.length === 1 ? 'inscrição exportada' : 'inscrições exportadas'}`);
  };

  const handleBulkCopyEmails = () => {
    const emails = [...new Set(
      selectedRegs.map((r: any) => r.profiles?.email ?? r.inscrito_email).filter(Boolean)
    )];
    if (emails.length === 0) {
      showBulkFeedback('Nenhum e-mail encontrado nas selecionadas');
      return;
    }
    navigator.clipboard.writeText(emails.join(', ')).then(() => {
      showBulkFeedback(`${emails.length} ${emails.length === 1 ? 'e-mail copiado' : 'e-mails copiados'}`);
    }).catch(() => showBulkFeedback('Erro ao copiar — verifique permissão de clipboard'));
  };

  const handleBulkCopyWhatsapps = () => {
    const wpps = [...new Set(
      selectedRegs.map((r: any) => r.profiles?.whatsapp ?? r.inscrito_whatsapp).filter(Boolean)
    )];
    if (wpps.length === 0) {
      showBulkFeedback('Nenhum WhatsApp encontrado nas selecionadas');
      return;
    }
    navigator.clipboard.writeText(wpps.join(', ')).then(() => {
      showBulkFeedback(`${wpps.length} ${wpps.length === 1 ? 'WhatsApp copiado' : 'WhatsApps copiados'}`);
    }).catch(() => showBulkFeedback('Erro ao copiar — verifique permissão de clipboard'));
  };

  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (paymentFilter !== 'ALL') n++;
    if (dateFilter !== 'ALL') n++;
    if (modalidadeFilter !== 'ALL') n++;
    if (categoriaFilter !== 'ALL') n++;
    if (estiloFilter !== 'ALL') n++;
    if (tipoApresentacaoFilter !== 'ALL') n++;
    if (inscritoFilter !== 'ALL') n++;
    return n;
  }, [paymentFilter, dateFilter, modalidadeFilter, categoriaFilter, estiloFilter, tipoApresentacaoFilter, inscritoFilter]);

  // Reset de todos os filtros (botão "Limpar tudo" do drawer + empty state).
  const resetAllFilters = () => {
    setSearchTerm('');
    setPaymentFilter('ALL');
    setModalidadeFilter('ALL');
    setCategoriaFilter('ALL');
    setEstiloFilter('ALL');
    setInscritoFilter('ALL');
    setTipoApresentacaoFilter('ALL');
    setDateFilter('ALL');
    setQuickAlert(null);
  };

  // Helper de click no header pra alternar sort. Mesma coluna → inverte direção.
  // Coluna nova → começa em desc (padrão Stripe/Linear pra listas).
  const toggleSort = (col: 'data' | 'nome' | 'valor' | 'status') => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  // Sessão 4.1 P8: contadores dos alertas inteligentes. Derivados de registrations
  // (não filteredRegistrations) — banner mostra estado macro do evento independente
  // do filtro ativo.
  const alertCounts = useMemo(() => {
    let vencendo = 0;
    let noTrilha = 0;
    let incompletos = 0;
    for (const r of registrations) {
      if (r.status_pagamento === 'PENDENTE') {
        const raw = r.created_at ?? r.criado_em;
        const t = raw ? new Date(raw).getTime() : 0;
        if (t) {
          const ageH = (Date.now() - t) / 3600_000;
          if (ageH >= 48 && ageH <= 72) vencendo++;
        }
      }
      if (isPago(r.status_pagamento) && !r.trilha_url) noTrilha++;
      if (hasIncompleteBailarinos(r)) incompletos++;
    }
    return { vencendo, noTrilha, incompletos };
  }, [registrations, elencoById]);

  /* Stats no topo — cards de KPI (padrão Stripe Dashboard).
     Derivados de registrations (não filteredRegistrations) pra manter
     contexto global do evento mesmo com filtros ativos. */
  const stats = useMemo(() => {
    const total = registrations.length;
    const confirmadas = registrations.filter(r => isPago(r.status_pagamento)).length;
    const pendentes   = registrations.filter(r => r.status_pagamento === 'PENDENTE').length;
    // Helper: extrai o valor "esperado" da inscrição (snapshot ou config).
    const valorDe = (r: any) => Number(r.valor_pago ?? r.valor_total ?? r.charged_amount ?? r.mod_fee ?? 0) || 0;
    // Receita já recebida (APROVADO)
    const receita     = registrations.filter(r => isPago(r.status_pagamento)).reduce((s, r) => s + valorDe(r), 0);
    // Sessão 3 P9: receita prevista = soma das pendentes que ainda podem pagar.
    const receitaPrevista = registrations
      .filter(r => r.status_pagamento === 'PENDENTE')
      .reduce((s, r) => s + valorDe(r), 0);
    return { total, confirmadas, pendentes, receita, receitaPrevista };
  }, [registrations]);

  /* Sessão 4.2 — Análise Financeira (PR3 de 3).
     Widgets agregados pra produtor entender de onde vem a receita:
     - Top 5 estúdios por valor confirmado
     - Distribuição por modalidade (SOLO/DUO/TRIO/GRUPO)
     - Receita por categoria (INFANTIL/JUNIOR/ADULTO/etc)
     - Cupons mais usados (do que foi efetivamente aplicado)
     Padrão Stripe Dashboard / Sympla Painel — KPIs derivados, sem mexer no
     fluxo principal. Cálculo client-side (dataset pequeno, <1000 rows). */
  const analytics = useMemo(() => {
    const valorDe = (r: any) => Number(r.valor_pago ?? r.valor_total ?? r.charged_amount ?? r.mod_fee ?? 0) || 0;
    const pagas = registrations.filter(r => isPago(r.status_pagamento));

    // Top 5 estúdios (por valor confirmado)
    const estudioMap = new Map<string, { nome: string; total: number; count: number }>();
    for (const r of pagas) {
      const nome = r.estudio ?? r.inscrito_nome ?? r.profiles?.full_name ?? 'Sem estúdio';
      const cur = estudioMap.get(nome) ?? { nome, total: 0, count: 0 };
      cur.total += valorDe(r);
      cur.count += 1;
      estudioMap.set(nome, cur);
    }
    const topEstudios = [...estudioMap.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Distribuição por modalidade
    const modalidadeMap = new Map<string, number>();
    for (const r of registrations) {
      const m = r.formato_participacao ?? r.tipo_apresentacao ?? 'Sem modalidade';
      modalidadeMap.set(m, (modalidadeMap.get(m) ?? 0) + 1);
    }
    const totalReg = registrations.length || 1;
    const porModalidade = [...modalidadeMap.entries()]
      .map(([nome, count]) => ({ nome, count, pct: Math.round((count / totalReg) * 100) }))
      .sort((a, b) => b.count - a.count);

    // Receita por categoria (só de pagas)
    const categoriaMap = new Map<string, number>();
    for (const r of pagas) {
      const c = r.categoria ?? 'Sem categoria';
      categoriaMap.set(c, (categoriaMap.get(c) ?? 0) + valorDe(r));
    }
    const porCategoria = [...categoriaMap.entries()]
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total);

    // Cupons aplicados (registrations com coupon_id + discount_amount)
    const cupomMap = new Map<string, { code: string; count: number; descontoTotal: number }>();
    for (const r of registrations) {
      const code = r.coupon_code ?? (r.coupon_id ? 'Cupom' : null);
      if (!code) continue;
      const desc = Number(r.discount_amount ?? 0) || 0;
      const cur = cupomMap.get(code) ?? { code, count: 0, descontoTotal: 0 };
      cur.count += 1;
      cur.descontoTotal += desc;
      cupomMap.set(code, cur);
    }
    const topCupons = [...cupomMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    return { topEstudios, porModalidade, porCategoria, topCupons };
  }, [registrations]);

  /* Listas únicas pros dropdowns de filtro. Derivadas do dataset bruto pra
     não sumir opções quando o user já filtrou. */
  const categoriasDisponiveis = useMemo(() => {
    return [...new Set(registrations.map(r => r.categoria).filter(Boolean))].sort();
  }, [registrations]);
  const estilosDisponiveis = useMemo(() => {
    return [...new Set(registrations.map(r => r.estilo_danca).filter(Boolean))].sort();
  }, [registrations]);
  /* Lista de inscritos únicos pro filtro. Usa snapshot inscrito_nome primeiro
     (sobrevive a delete de profile), fallback pro profile fetched. Crítico
     pra dona de estúdio: ela inscreve N coreografias, filtro mostra todas. */
  const inscritosDisponiveis = useMemo(() => {
    return [...new Set(registrations.map(r => r.inscrito_nome ?? r.profiles?.full_name).filter(Boolean))].sort();
  }, [registrations]);

  const handleExportCSV = () => {
    if (sortedRegistrations.length === 0) return;
    const headers = [
      'Data', 'Coreografia', 'Modalidade', 'Tipo', 'Estúdio',
      'Categoria', 'Estilo', 'Inscrito', 'Email', 'WhatsApp',
      'Status Inscrição', 'Status Pagamento', 'Valor (R$)',
    ];
    const escape = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // Auditoria 2026-05-21: exporta na ordem do sort visível (sortedRegistrations),
    // não a ordem padrão do banco (filteredRegistrations). Quando o produtor ordena
    // por Valor pra ver as inscrições mais caras no topo, o CSV deve refletir isso.
    const rows = sortedRegistrations.map(r => [
      r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '',
      r.nome_coreografia ?? '',
      r.formato_participacao ?? '',
      r.tipo_apresentacao ?? '',
      r.estudio ?? '',
      r.categoria ?? '',
      r.estilo_danca ?? '',
      r.profiles?.full_name ?? '',
      r.profiles?.email ?? '',
      r.profiles?.whatsapp ?? '',
      r.status ?? '',
      r.status_pagamento ?? '',
      r.valor_total != null ? Number(r.valor_total).toFixed(2) : '',
    ].map(escape).join(','));
    // BOM UTF-8 pro Excel BR abrir com acentuação correta
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscricoes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleTriageDecision = async (regId: string, decision: 'APPROVE' | 'PENALIZE' | 'DISQUALIFY') => {
    let update: any = { penalidade_status: 'RESOLVIDO' };
    if (decision === 'APPROVE')     update = { ...update, penalidade_aplicada: 'NENHUMA' };
    if (decision === 'PENALIZE')    update = { ...update, penalidade_aplicada: 'DESCONTO_NOTA' };
    if (decision === 'DISQUALIFY')  update = { ...update, status: 'DESCLASSIFICADA', penalidade_aplicada: 'DESCLASSIFICACAO' };
    await supabase.from('registrations').update(update).eq('id', regId);
    setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, ...update } : r));
    setTriageAction(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APROVADO':
      case 'CONFIRMADO': return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';
      case 'PENDENTE': return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20';
      case 'VENCIDO':
      case 'EXPIRADO': return 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20';
      case 'ESTORNADO':
      case 'CANCELADO': return 'bg-slate-100 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-500/20';
      default: return 'bg-slate-100 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-500/20';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Inscrições</h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Controle mestre do festival</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:shrink-0">
          {/* Edition selector — EventPickerSheet custom (bottom sheet em mobile,
              dropdown ancorado em desktop). Substitui <select> nativo do Android
              que renderiza como bottom sheet ruim sem controle visual. */}
          {allEvents.length > 0 && (
            <EventPickerSheet
              events={allEvents}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
              className="w-full sm:w-auto"
            />
          )}
          <div className="flex items-center gap-2">
            <button onClick={fetchData} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all shrink-0">
              <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleExportCSV}
              disabled={filteredRegistrations.length === 0}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-40 disabled:cursor-not-allowed"
              title={filteredRegistrations.length === 0 ? 'Nada pra exportar com os filtros atuais' : `Exportar ${filteredRegistrations.length} inscrição(ões)`}
            >
              <Download size={14} /> Exportar CSV
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-4 border-b border-slate-200 dark:border-white/5">
        {['LIST', 'TRIAGEM'].map((t: any) => (
          <button key={t} onClick={() => setTab(t)} className={`pb-4 px-2 text-[10px] font-black uppercase tracking-widest transition-all relative ${tab === t ? 'text-[#ff0068]' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>
            {t === 'LIST' ? 'Lista Geral' : 'Triagem de Regulamento'}
            {tab === t && <motion.div layoutId="tab" className="absolute bottom-0 left-0 w-full h-1 bg-[#ff0068] rounded-full" />}
          </button>
        ))}
      </div>

      {tab === 'LIST' ? (
        <div className="space-y-6">
          {/* Sessão 4.1 P8: banner de alertas inteligentes. Só aparece quando
              tem ao menos 1 alerta ativo. Click no chip filtra a lista pra ver
              só essas. "Fora da faixa" pula direto pra aba TRIAGEM (regime
              separado, exige decisão do produtor). */}
          {(alertCounts.vencendo > 0 || alertCounts.noTrilha > 0 || alertCounts.incompletos > 0 || violatingRegs.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 p-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 flex items-center gap-2 mr-1">
                <Bell size={12} /> Atenção
              </p>
              {alertCounts.vencendo > 0 && (
                <button
                  onClick={() => setQuickAlert(q => q === 'vencendo' ? null : 'vencendo')}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-1.5 ${
                    quickAlert === 'vencendo'
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                  }`}
                  title="Inscrições pendentes a 48-72h da criação (próximas do vencimento padrão Asaas)"
                >
                  <Clock size={11} /> {alertCounts.vencendo} vencendo em 24h
                </button>
              )}
              {alertCounts.noTrilha > 0 && (
                <button
                  onClick={() => setQuickAlert(q => q === 'no_trilha' ? null : 'no_trilha')}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-1.5 ${
                    quickAlert === 'no_trilha'
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                  }`}
                  title="Inscrições pagas que ainda não enviaram a trilha sonora"
                >
                  <Music2 size={11} /> {alertCounts.noTrilha} trilha(s) pendente(s)
                </button>
              )}
              {alertCounts.incompletos > 0 && (
                <button
                  onClick={() => setQuickAlert(q => q === 'incompletos' ? null : 'incompletos')}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-1.5 ${
                    quickAlert === 'incompletos'
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                  }`}
                  title="Inscrições com bailarinos sem CPF ou data de nascimento — bloqueia certificado e validação etária"
                >
                  <AlertTriangle size={11} /> {alertCounts.incompletos} com dados incompletos
                </button>
              )}
              {violatingRegs.length > 0 && (
                <button
                  onClick={() => setTab('TRIAGEM')}
                  className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-all flex items-center gap-1.5"
                  title="Bailarinos fora da faixa etária da categoria — abre aba Triagem"
                >
                  <ShieldAlert size={11} /> {violatingRegs.length} fora da faixa
                </button>
              )}
              {quickAlert && (
                <button
                  onClick={() => setQuickAlert(null)}
                  className="ml-auto px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-all flex items-center gap-1"
                >
                  <X size={11} /> Limpar
                </button>
              )}
            </div>
          )}

          {/* Sessão 4.1 P5: comparativo edição anterior. Banner compacto antes
              dos KPIs quando o produtor tem evento de edição anterior no dropdown.
              Delta de receita + inscrições com cor verde/vermelha pra leitura
              rápida. Padrão Stripe Dashboard "vs período anterior". */}
          {prevEdition && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <TrendingUp size={12} /> Vs edição {prevEdition.edition_year}
              </p>
              {(() => {
                const deltaReceita = prevEdition.receita > 0
                  ? ((stats.receita - prevEdition.receita) / prevEdition.receita) * 100
                  : (stats.receita > 0 ? 100 : 0);
                const deltaInsc = prevEdition.inscricoes > 0
                  ? ((stats.confirmadas - prevEdition.inscricoes) / prevEdition.inscricoes) * 100
                  : (stats.confirmadas > 0 ? 100 : 0);
                const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
                const toneR = deltaReceita >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
                const toneI = deltaInsc    >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
                return (
                  <>
                    <p className="text-[11px] text-slate-700 dark:text-slate-200">
                      Receita <span className={`font-black ${toneR}`}>{fmtPct(deltaReceita)}</span>
                      <span className="text-slate-400"> (R$ {prevEdition.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                    </p>
                    <p className="text-[11px] text-slate-700 dark:text-slate-200">
                      Inscrições <span className={`font-black ${toneI}`}>{fmtPct(deltaInsc)}</span>
                      <span className="text-slate-400"> ({prevEdition.inscricoes})</span>
                    </p>
                  </>
                );
              })()}
            </div>
          )}

          {/* Stats cards — padrão Stripe Dashboard. KPIs do evento ativo,
              não respeitam filtros (visão macro mesmo com filtro estreito). */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={<Users size={14} />}        label="Total"       value={String(stats.total)}       tone="slate" />
            <StatCard icon={<CheckCircle2 size={14} />} label="Confirmadas" value={String(stats.confirmadas)} tone="emerald" />
            <StatCard icon={<Clock size={14} />}        label="Pendentes"   value={String(stats.pendentes)}   tone="amber" />
            <StatCard icon={<TrendingUp size={14} />}   label="Receita"     value={`R$ ${stats.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} tone="pink" />
            {/* Sessão 3 P9: receita prevista = soma das pendentes que ainda
                podem virar pagamento. Ajuda o produtor a saber o teto da
                edição sem ter que filtrar e somar mentalmente. */}
            <StatCard icon={<TrendingUp size={14} />}   label="Prevista"    value={`R$ ${stats.receitaPrevista.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} tone="slate" />
          </div>

          {/* Sessão 4.2 PR3 — Análise Financeira. Card colapsável com:
              - Top 5 estúdios (de onde vem a receita)
              - Distribuição por modalidade (gargalos de vagas)
              - Receita por categoria (faixa etária mais rentável)
              - Cupons usados (qual campanha trouxe inscritos)
              Default fechado pra preservar visão limpa. */}
          {(analytics.topEstudios.length > 0 || analytics.porModalidade.length > 0) && (
            <div className="bg-slate-100 dark:bg-slate-900/50 rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden">
              <button
                type="button"
                onClick={() => setAnalyticsOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-200/40 dark:hover:bg-white/5 transition-colors"
                aria-expanded={analyticsOpen}
              >
                <div className="flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#ff0068]" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">
                    Análise Financeira
                  </span>
                  {!analyticsOpen && (
                    <span className="text-[9px] font-bold text-slate-400 normal-case tracking-normal ml-1">
                      · {analytics.topEstudios.length} {analytics.topEstudios.length === 1 ? 'estúdio' : 'estúdios'} confirmados
                    </span>
                  )}
                </div>
                <ChevronDown
                  size={14}
                  className={`text-slate-400 transition-transform ${analyticsOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {analyticsOpen && (
                <div className="p-4 pt-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Top 5 Estúdios */}
                  <div className="bg-white dark:bg-white/[0.02] rounded-2xl border border-slate-200 dark:border-white/5 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-3">
                      Top Estúdios · receita confirmada
                    </p>
                    {analytics.topEstudios.length === 0 ? (
                      <p className="text-[10px] text-slate-400">Nenhum pagamento confirmado ainda</p>
                    ) : (
                      <div className="space-y-2.5">
                        {analytics.topEstudios.map((e, idx) => {
                          const maxTotal = analytics.topEstudios[0]?.total ?? 1;
                          const pct = (e.total / maxTotal) * 100;
                          return (
                            <div key={e.nome}>
                              <div className="flex items-baseline justify-between gap-2 mb-1">
                                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate flex items-center gap-1.5">
                                  <span className="text-[8px] font-black text-slate-400 w-3">{idx + 1}.</span>
                                  {e.nome}
                                </span>
                                <span className="text-[11px] font-black text-[#ff0068] tabular-nums shrink-0">
                                  R$ {e.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                              <div className="h-1 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#ff0068]/70"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <p className="text-[9px] text-slate-400 mt-1">
                                {e.count} {e.count === 1 ? 'coreografia' : 'coreografias'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Distribuição por modalidade */}
                  <div className="bg-white dark:bg-white/[0.02] rounded-2xl border border-slate-200 dark:border-white/5 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-3">
                      Por modalidade · % do total
                    </p>
                    {analytics.porModalidade.length === 0 ? (
                      <p className="text-[10px] text-slate-400">Sem inscrições</p>
                    ) : (
                      <div className="space-y-2.5">
                        {analytics.porModalidade.map(m => (
                          <div key={m.nome}>
                            <div className="flex items-baseline justify-between gap-2 mb-1">
                              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                                {m.nome}
                              </span>
                              <span className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                                {m.pct}%
                              </span>
                            </div>
                            <div className="h-1 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500/70"
                                style={{ width: `${m.pct}%` }}
                              />
                            </div>
                            <p className="text-[9px] text-slate-400 mt-1">
                              {m.count} {m.count === 1 ? 'inscrição' : 'inscrições'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Receita por categoria + Cupons */}
                  <div className="bg-white dark:bg-white/[0.02] rounded-2xl border border-slate-200 dark:border-white/5 p-4 space-y-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-3">
                        Por categoria · receita
                      </p>
                      {analytics.porCategoria.length === 0 ? (
                        <p className="text-[10px] text-slate-400">Sem confirmados</p>
                      ) : (
                        <div className="space-y-1.5">
                          {analytics.porCategoria.map(c => (
                            <div key={c.nome} className="flex items-baseline justify-between gap-2">
                              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                                {c.nome}
                              </span>
                              <span className="text-[11px] font-black text-slate-700 dark:text-slate-200 tabular-nums shrink-0">
                                R$ {c.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {analytics.topCupons.length > 0 && (
                      <div className="pt-3 border-t border-slate-200 dark:border-white/5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                          Cupons aplicados
                        </p>
                        <div className="space-y-1">
                          {analytics.topCupons.map(cp => (
                            <div key={cp.code} className="flex items-baseline justify-between gap-2">
                              <span className="text-[11px] font-mono font-black text-[#ff0068] truncate">
                                {cp.code}
                              </span>
                              <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                                {cp.count}× · −R$ {cp.descontoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-3xl border border-slate-200 dark:border-white/5 flex flex-col gap-3">
            {/* Sessão 4.2 fix: chip persistente do filtro de alerta. Aparece dentro
                do card de filtros quando quickAlert está ativo. Bug original: produtor
                clicava "Trilhas pendentes" e visualmente nada mudava porque todos os
                rows ja matchavam o filtro. Sem feedback, ele acha que o click falhou. */}
            {quickAlert && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/40 rounded-2xl">
                <Bell size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="flex-1 text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                  Filtrando: {
                    quickAlert === 'vencendo'    ? 'Vencendo em 24h' :
                    quickAlert === 'no_trilha'   ? 'Trilhas pendentes' :
                    'Dados incompletos'
                  }
                  <span className="ml-2 text-amber-600 dark:text-amber-400/80 normal-case font-bold tracking-normal">
                    ({filteredRegistrations.length} {filteredRegistrations.length === 1 ? 'resultado' : 'resultados'})
                  </span>
                </p>
                <button
                  onClick={() => setQuickAlert(null)}
                  className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 transition-all shrink-0"
                  title="Remover este filtro"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {/* Sessão 4.2 item 6: search bar + botão "Filtros" único. Antes os 7
                selects ocupavam 2 linhas no desktop. Agora ficam num drawer
                on-demand, mostrando chips dos filtros ativos abaixo. Padrão
                Sympla/Linear. */}
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input type="text" placeholder="Buscar coreografia, estúdio, inscrito ou e-mail..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]" />
              </div>
              <button
                onClick={() => setFiltersOpen(true)}
                className={`px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 shrink-0 ${
                  activeFiltersCount > 0
                    ? 'bg-[#ff0068]/10 text-[#ff0068] border-[#ff0068]/30 hover:bg-[#ff0068]/15'
                    : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-white/5 hover:border-[#ff0068]/30'
                }`}
                title={activeFiltersCount > 0 ? `${activeFiltersCount} filtro(s) ativo(s)` : 'Abrir filtros'}
              >
                <SlidersHorizontal size={14} />
                <span className="hidden sm:inline">Filtros</span>
                {activeFiltersCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-[#ff0068] text-white rounded-full text-[9px] font-black min-w-[18px] text-center">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </div>
            {/* Chips de filtros ativos — feedback explícito do que está aplicado.
                Cada chip tem X pra remover individualmente sem abrir drawer. */}
            {activeFiltersCount > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {paymentFilter !== 'ALL' && (
                  <ActiveFilterChip label={`Pagto: ${paymentFilter === 'APROVADO' ? 'Confirmado' : paymentFilter.charAt(0) + paymentFilter.slice(1).toLowerCase()}`} onRemove={() => setPaymentFilter('ALL')} />
                )}
                {dateFilter !== 'ALL' && (
                  <ActiveFilterChip label={`Data: ${dateFilter === 'today' ? 'Hoje' : dateFilter === '7d' ? '7 dias' : dateFilter === '30d' ? '30 dias' : 'Este mês'}`} onRemove={() => setDateFilter('ALL')} />
                )}
                {modalidadeFilter !== 'ALL' && (
                  <ActiveFilterChip label={`Modalidade: ${modalidadeFilter}`} onRemove={() => setModalidadeFilter('ALL')} />
                )}
                {categoriaFilter !== 'ALL' && (
                  <ActiveFilterChip label={`Categoria: ${categoriaFilter}`} onRemove={() => setCategoriaFilter('ALL')} />
                )}
                {estiloFilter !== 'ALL' && (
                  <ActiveFilterChip label={`Estilo: ${estiloFilter}`} onRemove={() => setEstiloFilter('ALL')} />
                )}
                {tipoApresentacaoFilter !== 'ALL' && (
                  <ActiveFilterChip label={`Mostra: ${tipoApresentacaoFilter}`} onRemove={() => setTipoApresentacaoFilter('ALL')} />
                )}
                {inscritoFilter !== 'ALL' && (
                  <ActiveFilterChip label={`Inscrito: ${inscritoFilter}`} onRemove={() => setInscritoFilter('ALL')} />
                )}
                <button
                  onClick={resetAllFilters}
                  className="px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-rose-500 transition-all"
                >
                  Limpar tudo
                </button>
              </div>
            )}
          </div>

          {/* Mobile: cards (md:hidden). Em desktop renderiza a table abaixo.
              Padrão Sympla/Mercado Pago — em mobile cada inscrição vira card
              tap-friendly, sem scroll horizontal. */}
          <div className="md:hidden space-y-3">
            {isLoading ? (
              <div className="py-20 text-center bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl">
                <RefreshCw className="animate-spin mx-auto text-[#ff0068]" size={32} />
              </div>
            ) : filteredRegistrations.length === 0 ? (
              <div className="py-16 px-4 text-center bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl">
                {registrations.length === 0 ? (
                  <div className="max-w-md mx-auto space-y-5">
                    <div className="w-16 h-16 mx-auto bg-[#ff0068]/10 rounded-3xl flex items-center justify-center">
                      <Users size={28} className="text-[#ff0068]" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Nenhuma inscrição ainda</p>
                      <p className="text-[11px] text-slate-500 mt-1 normal-case font-normal">Compartilhe o link do evento pros bailarinos se inscreverem.</p>
                    </div>
                    {activeEventInfo?.slug && (() => {
                      const url = `${window.location.origin}/evento/${activeEventInfo.slug}`;
                      return (
                        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 flex items-center gap-2 text-left">
                          <code className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate font-mono">{url}</code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(url).then(() => {
                                setCopiedLink(true);
                                setTimeout(() => setCopiedLink(false), 2000);
                              });
                            }}
                            className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shrink-0 ${copiedLink ? 'bg-emerald-500 text-white' : 'bg-[#ff0068] text-white hover:bg-[#e0005c]'}`}
                          >
                            {copiedLink ? <><CheckCircle2 size={12} /> Copiado</> : <><Eye size={12} /> Copiar</>}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <>
                    <p className="text-slate-500 font-black uppercase text-xs">Nenhuma inscrição encontrada</p>
                    <button
                      onClick={() => {
                        // Auditoria: zera TODOS os filtros, incluindo os que
                        // o user pode ter ativado de outro lugar (alerta no
                        // banner, chip de mostra, filtro de data).
                        setSearchTerm('');
                        setPaymentFilter('ALL');
                        setModalidadeFilter('ALL');
                        setCategoriaFilter('ALL');
                        setEstiloFilter('ALL');
                        setInscritoFilter('ALL');
                        setTipoApresentacaoFilter('ALL');
                        setDateFilter('ALL');
                        setQuickAlert(null);
                      }}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068] hover:text-white transition-all"
                    >
                      <X size={12} /> Limpar filtros
                    </button>
                  </>
                )}
              </div>
            ) : (
              paginatedRegistrations.map(reg => (
                <div
                  key={reg.id}
                  onClick={() => setViewingReg(reg)}
                  className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl p-4 cursor-pointer hover:border-[#ff0068]/30 transition-all"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-slate-900 dark:text-white uppercase tracking-tight text-sm">{reg.nome_coreografia}</p>
                      <p className="text-[9px] text-[#ff0068] font-bold uppercase tracking-widest mt-0.5">{reg.tipo_apresentacao}{reg.formato_participacao ? ` · ${reg.formato_participacao}` : ''}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border whitespace-nowrap ${getStatusColor(reg.status_pagamento)}`}>{reg.status_pagamento}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] mb-3">
                    {(reg.inscrito_nome ?? reg.profiles?.full_name) && (
                      <div className="min-w-0">
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Inscrito</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold truncate">{reg.inscrito_nome ?? reg.profiles?.full_name}</p>
                      </div>
                    )}
                    {reg.estudio && (
                      <div className="min-w-0">
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Estúdio</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold truncate">{reg.estudio}</p>
                      </div>
                    )}
                    {reg.categoria && (
                      <div className="min-w-0">
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Categoria</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold truncate">{reg.categoria}</p>
                      </div>
                    )}
                    {reg.created_at && (
                      <div>
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Data</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold">{new Date(reg.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })}</p>
                      </div>
                    )}
                    {reg.valor_total != null && Number(reg.valor_total) > 0 && (
                      <div>
                        <p className="text-slate-400 uppercase tracking-widest font-bold text-[9px]">Valor</p>
                        <p className="text-slate-700 dark:text-slate-300 font-bold">R$ {Number(reg.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-1 pt-3 border-t border-slate-100 dark:border-white/5">
                    <button
                      onClick={e => { e.stopPropagation(); setViewingReg(reg); }}
                      className="p-2 text-slate-500 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg transition-all"
                      title="Ver detalhes"
                    ><Eye size={16} /></button>
                    {reg.status_pagamento === 'PENDENTE' && (
                      <button
                        onClick={e => { e.stopPropagation(); setReviewingReg(reg); }}
                        className="p-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-500 hover:text-white transition-all"
                        title="Validar pagamento"
                      ><DollarSign size={16} /></button>
                    )}
                    {(reg.status_pagamento === 'CONFIRMADO' || reg.status_pagamento === 'APROVADO') && (
                      <button
                        onClick={e => { e.stopPropagation(); handleOpenRefund(reg); }}
                        className="p-2 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-500 hover:text-white transition-all"
                        title="Reembolsar"
                      ><Undo2 size={16} /></button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop: tabela tradicional (hidden md:block). */}
          <div className="hidden md:block bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-[2.5rem] overflow-x-auto shadow-sm dark:shadow-2xl">
            <table className="w-full min-w-[640px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
                  {/* Sessão 4.2 PR3 — checkbox "select all visible" no header */}
                  <th className="px-4 sm:px-6 py-5 w-10 hidden md:table-cell">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                      onChange={toggleSelectAllVisible}
                      onClick={e => e.stopPropagation()}
                      className="w-4 h-4 rounded border-slate-300 dark:border-white/20 text-[#ff0068] focus:ring-2 focus:ring-[#ff0068]/40 cursor-pointer"
                      aria-label="Selecionar todas visíveis"
                    />
                  </th>
                  {/* Sessão 4.1 sort header: click alterna direção. Ícone "≡" cinza
                      indica coluna sortable, seta ↑/↓ rosa marca a ativa. */}
                  <th onClick={() => toggleSort('nome')} className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:text-[#ff0068] transition-colors select-none">
                    <span className="inline-flex items-center gap-1">Coreografia <SortIcon active={sortBy === 'nome'} dir={sortDir} /></span>
                  </th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden lg:table-cell">Inscrito</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden md:table-cell">Estúdio</th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden xl:table-cell">Categoria</th>
                  <th onClick={() => toggleSort('data')} className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden xl:table-cell cursor-pointer hover:text-[#ff0068] transition-colors select-none">
                    <span className="inline-flex items-center gap-1">Data <SortIcon active={sortBy === 'data'} dir={sortDir} /></span>
                  </th>
                  <th onClick={() => toggleSort('valor')} className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right hidden md:table-cell cursor-pointer hover:text-[#ff0068] transition-colors select-none">
                    <span className="inline-flex items-center gap-1 justify-end w-full">Valor <SortIcon active={sortBy === 'valor'} dir={sortDir} /></span>
                  </th>
                  <th onClick={() => toggleSort('status')} className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center cursor-pointer hover:text-[#ff0068] transition-colors select-none">
                    <span className="inline-flex items-center gap-1 justify-center w-full">Pagamento <SortIcon active={sortBy === 'status'} dir={sortDir} /></span>
                  </th>
                  <th className="px-4 sm:px-8 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {isLoading ? (
                  <tr><td colSpan={9} className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-[#ff0068]" size={32} /></td></tr>
                ) : filteredRegistrations.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      {/* 2 estados de vazio diferentes:
                          1) Sem inscrições nenhuma no evento → CTA pra compartilhar
                             o link público (chama bailarinos pra se inscreverem).
                          2) Tem inscrições mas filtros zeraram → reset dos filtros. */}
                      {registrations.length === 0 ? (
                        <div className="max-w-md mx-auto space-y-5 px-4">
                          <div className="w-16 h-16 mx-auto bg-[#ff0068]/10 rounded-3xl flex items-center justify-center">
                            <Users size={28} className="text-[#ff0068]" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Nenhuma inscrição ainda</p>
                            <p className="text-[11px] text-slate-500 mt-1 normal-case font-normal">Compartilhe o link do evento pros bailarinos se inscreverem.</p>
                          </div>
                          {activeEventInfo?.slug ? (() => {
                            const url = `${window.location.origin}/evento/${activeEventInfo.slug}`;
                            return (
                              <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 flex items-center gap-2 text-left">
                                <code className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate font-mono">{url}</code>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(url).then(() => {
                                      setCopiedLink(true);
                                      setTimeout(() => setCopiedLink(false), 2000);
                                    });
                                  }}
                                  className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shrink-0 ${
                                    copiedLink
                                      ? 'bg-emerald-500 text-white'
                                      : 'bg-[#ff0068] text-white hover:bg-[#e0005c]'
                                  }`}
                                >
                                  {copiedLink ? <><CheckCircle2 size={12} /> Copiado</> : <><Eye size={12} /> Copiar</>}
                                </button>
                              </div>
                            );
                          })() : (
                            <p className="text-[10px] text-slate-400 normal-case">Configure um <em>slug</em> pro evento pra gerar o link de compartilhamento.</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <p className="text-slate-500 font-black uppercase text-xs">Nenhuma inscrição encontrada</p>
                          <button
                            onClick={() => {
                              // Auditoria: zera TODOS os filtros, incluindo
                              // alerta rápido, mostra e data.
                              setSearchTerm('');
                              setPaymentFilter('ALL');
                              setModalidadeFilter('ALL');
                              setCategoriaFilter('ALL');
                              setEstiloFilter('ALL');
                              setInscritoFilter('ALL');
                              setTipoApresentacaoFilter('ALL');
                              setDateFilter('ALL');
                              setQuickAlert(null);
                            }}
                            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068] hover:text-white transition-all"
                          >
                            <X size={12} /> Limpar filtros
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ) : paginatedRegistrations.map(reg => (
                  <tr
                    key={reg.id}
                    onClick={() => setViewingReg(reg)}
                    className={`hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer ${selectedIds.has(reg.id) ? 'bg-[#ff0068]/[0.03] dark:bg-[#ff0068]/10' : ''}`}
                    title="Ver detalhes da inscrição"
                  >
                    {/* Sessão 4.2 PR3 — checkbox individual. stopPropagation
                        pra não disparar o setViewingReg da row. */}
                    <td className="px-4 sm:px-6 py-6 w-10 hidden md:table-cell" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(reg.id)}
                        onChange={() => toggleSelected(reg.id)}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded border-slate-300 dark:border-white/20 text-[#ff0068] focus:ring-2 focus:ring-[#ff0068]/40 cursor-pointer"
                        aria-label={`Selecionar ${reg.nome_coreografia ?? 'inscrição'}`}
                      />
                    </td>
                    <td className="px-4 sm:px-8 py-6">
                      <p className="font-black text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-[#ff0068] transition-colors">{reg.nome_coreografia}</p>
                      <p className="text-[9px] text-[#ff0068] font-bold uppercase tracking-widest">{reg.tipo_apresentacao}</p>
                      {/* Mostra estúdio + categoria em mobile (colunas escondidas em <md/<lg) */}
                      <p className="text-[10px] text-slate-500 mt-1 md:hidden">{reg.estudio}{reg.categoria ? ` · ${reg.categoria}` : ''}</p>
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-xs font-bold text-slate-700 dark:text-slate-200 hidden lg:table-cell truncate max-w-[160px]">
                      {reg.inscrito_nome ?? reg.profiles?.full_name ?? <span className="text-slate-400 font-normal">—</span>}
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-xs font-bold text-slate-600 dark:text-slate-300 hidden md:table-cell">{reg.estudio}</td>
                    <td className="px-4 sm:px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest hidden xl:table-cell">{reg.categoria}</td>
                    <td className="px-4 sm:px-8 py-6 text-[10px] text-slate-500 hidden xl:table-cell whitespace-nowrap">
                      {reg.created_at ? new Date(reg.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-right text-xs font-bold text-slate-700 dark:text-slate-300 hidden md:table-cell whitespace-nowrap">
                      {(() => {
                        // Webhook novo (2026-05-31) seta valor_pago. Legado usa valor_total. Fallback final: mod_fee.
                        const v = Number(reg.valor_pago ?? reg.valor_total ?? reg.mod_fee ?? 0);
                        return v > 0
                          ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : <span className="text-slate-400 font-normal">—</span>;
                      })()}
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-center">
                      <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${getStatusColor(reg.status_pagamento)}`}>{reg.status_pagamento}</span>
                    </td>
                    <td className="px-4 sm:px-8 py-6 text-right">
                      {/* stopPropagation em cada ação pra clique na linha não disparar.
                          Botão de ver explícito (Eye) pra dar affordance — mesmo com a linha clicável,
                          padrão Notion/Linear mantém ícone visível pra reduzir incerteza. */}
                      <div className="flex justify-end gap-1 sm:gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); setViewingReg(reg); }}
                          className="p-2 text-slate-500 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg transition-all"
                          title="Ver detalhes"
                        ><Eye size={16} /></button>
                        {reg.status_pagamento === 'PENDENTE' && (
                          <button
                            onClick={e => { e.stopPropagation(); setReviewingReg(reg); }}
                            className="p-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-500 hover:text-white transition-all"
                            title="Validar pagamento"
                          ><DollarSign size={16} /></button>
                        )}
                        {(reg.status_pagamento === 'CONFIRMADO' || reg.status_pagamento === 'APROVADO') && (
                          <button
                            onClick={e => { e.stopPropagation(); handleOpenRefund(reg); }}
                            className="p-2 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-500 hover:text-white transition-all"
                            title="Reembolsar"
                          ><Undo2 size={16} /></button>
                        )}
                        <button
                          onClick={e => e.stopPropagation()}
                          className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-all opacity-50 cursor-not-allowed"
                          title="Remover (em breve)"
                          disabled
                        ><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sessão 4.1 paginação: só aparece quando passa de PAGE_SIZE rows.
              Compartilhado entre mobile e desktop — fica abaixo de qualquer um
              dos dois renders. */}
          {sortedRegistrations.length > PAGE_SIZE && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-2 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, sortedRegistrations.length)} de {sortedRegistrations.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="p-2 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-[#ff0068] hover:text-[#ff0068] transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-700"
                  title="Página anterior"
                >
                  <ChevronLeft size={14} />
                </button>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 min-w-[80px] text-center">
                  Página {safePage} / {totalPages}
                </p>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="p-2 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-[#ff0068] hover:text-[#ff0068] transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-700"
                  title="Próxima página"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── TRIAGEM DE REGULAMENTO ── */
        <div className="space-y-6">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
            <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest">Regra Ativa</p>
              <p className="text-[10px] text-amber-600 dark:text-amber-300 mt-0.5">
                Tolerância: {toleranceRule.mode === 'PERCENT'
                  ? `até ${toleranceRule.value}% do grupo fora da faixa etária`
                  : `até ${toleranceRule.value} participante(s) fora da faixa etária`}
                {' · '}Referência: {ageRefMode === 'EVENT_DAY' ? 'data do evento' : ageRefMode === 'YEAR_END' ? '31/12 do ano' : ageRefFixed || 'data fixa'}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="py-20 flex justify-center"><RefreshCw className="animate-spin text-[#ff0068]" size={28} /></div>
          ) : violatingRegs.length === 0 ? (
            <div className="py-20 text-center bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-[3rem]">
              <CheckCircle2 className="mx-auto text-emerald-500 mb-4" size={40} />
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhuma infração pendente de triagem</p>
              <p className="text-[10px] text-slate-400 mt-1">Todas as inscrições confirmadas estão dentro da tolerância configurada.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                {violatingRegs.length} inscrição(ões) aguardando decisão
              </p>
              {violatingRegs.map(reg => (
                <div
                  key={reg.id}
                  className="bg-white dark:bg-slate-900/50 border border-amber-300/40 dark:border-amber-500/20 rounded-3xl p-5 flex flex-col sm:flex-row gap-4 sm:items-center"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-amber-500/10 rounded-2xl flex items-center justify-center shrink-0">
                      <ShieldAlert size={18} className="text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-slate-900 dark:text-white uppercase truncate">{reg.nome_coreografia || '—'}</p>
                      <p className="text-[9px] text-slate-500 uppercase tracking-widest">{reg.estudio} · {reg.categoria}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Users size={10} className="text-amber-500" />
                        <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                          {reg._violation.outCount}/{reg._violation.totalCount} fora da faixa
                          {' '}({reg._violation.pct.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 shrink-0 flex-wrap">
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'APPROVE' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-white transition-all"
                    >
                      <CheckCircle2 size={12} /> Aprovar
                    </button>
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'PENALIZE' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-amber-500 hover:text-white transition-all"
                    >
                      <Clock size={12} /> Penalizar
                    </button>
                    <button
                      onClick={() => setTriageAction({ reg, decision: 'DISQUALIFY' })}
                      className="flex items-center gap-1.5 px-4 py-2 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all"
                    >
                      <AlertTriangle size={12} /> Desclassificar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {/* ── Triage decision modal ── */}
        {triageAction && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTriageAction(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                  {triageAction.decision === 'APPROVE'    && <span className="text-emerald-500">Aprovar</span>}
                  {triageAction.decision === 'PENALIZE'   && <span className="text-amber-500">Penalizar</span>}
                  {triageAction.decision === 'DISQUALIFY' && <span className="text-rose-500">Desclassificar</span>}
                </h2>
                <button onClick={() => setTriageAction(null)} className="p-2 text-slate-500 hover:text-rose-500"><X size={20} /></button>
              </div>
              <div className="p-8 space-y-5">
                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl">
                  <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest">Inscrição</p>
                  <p className="font-black text-sm text-slate-900 dark:text-white uppercase mt-1">{triageAction.reg.nome_coreografia || '—'}</p>
                  <p className="text-[9px] text-amber-500 font-black uppercase mt-0.5">
                    {triageAction.reg._violation.outCount} fora da faixa etária
                    {' '}({triageAction.reg._violation.pct.toFixed(0)}%)
                  </p>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {triageAction.decision === 'APPROVE'    && 'A inscrição será aprovada com exceção de tolerância registrada.'}
                  {triageAction.decision === 'PENALIZE'   && 'Uma penalidade de desconto de nota será aplicada na avaliação.'}
                  {triageAction.decision === 'DISQUALIFY' && 'A inscrição será desclassificada e não concorrerá a resultados.'}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setTriageAction(null)} className="flex-1 py-3 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleTriageDecision(triageAction.reg.id, triageAction.decision)}
                    className={`flex-1 py-3 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg ${
                      triageAction.decision === 'APPROVE'    ? 'bg-emerald-500 shadow-emerald-500/20 hover:scale-105' :
                      triageAction.decision === 'PENALIZE'   ? 'bg-amber-500 shadow-amber-500/20 hover:scale-105' :
                      'bg-rose-500 shadow-rose-500/20 hover:scale-105'
                    }`}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reviewingReg && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setReviewingReg(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Auditoria <span className="text-[#ff0068]">Financeira</span></h2>
                <button onClick={() => setReviewingReg(null)} className="p-2 text-slate-500 hover:text-rose-500"><X size={24} /></button>
              </div>
              <div className="p-8 space-y-6">
                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl space-y-2">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Coreografia</p>
                  <p className="text-sm font-black text-slate-900 dark:text-white uppercase">{reviewingReg.nome_coreografia}</p>
                </div>
                <div className="p-4 bg-[#ff0068]/5 border border-[#ff0068]/20 rounded-2xl flex justify-between items-center">
                  <span className="text-[10px] font-black text-[#ff0068] uppercase tracking-widest">Valor Total</span>
                  <span className="text-xl font-black text-[#ff0068]">R$ {reviewingReg.valor_total || '0,00'}</span>
                </div>
                <button onClick={() => handleApprove(reviewingReg.id)} className="w-full py-5 bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl shadow-emerald-500/20">Confirmar Recebimento</button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── Refund modal ── */}
        {refundModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !refunding && setRefundModal(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl border border-amber-500/20">
                    <Undo2 size={16} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight italic">Reembolso</h2>
                    <p className="text-[10px] text-slate-500">{refundModal.nome_coreografia ?? refundModal.estudio ?? '—'}</p>
                  </div>
                </div>
                <button onClick={() => !refunding && setRefundModal(null)} disabled={refunding} className="p-2 text-slate-500 hover:text-rose-500 disabled:opacity-50"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                    O valor será estornado pela Asaas para o bailarino. Sua comissão também é estornada proporcionalmente. <strong>Ação irreversível.</strong>
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Valor a reembolsar</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={refundAmount}
                    onChange={e => setRefundAmount(maskMoeda(e.target.value))}
                    placeholder="R$ 0,00"
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500/50 tabular-nums"
                  />
                  {(refundModal?.valor_total ?? refundModal?.valor_pago) != null && (
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      Pago: <strong className="text-slate-700 dark:text-slate-300">R$ {Number(refundModal?.valor_total ?? refundModal?.valor_pago).toFixed(2)}</strong>. Edite pra reembolsar parcialmente.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Motivo (opcional)</label>
                  <textarea
                    rows={3}
                    value={refundReason}
                    onChange={e => setRefundReason(e.target.value)}
                    placeholder="Ex: Cancelamento solicitado pelo bailarino..."
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500/50 resize-none"
                  />
                </div>

                {refundError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                    <AlertTriangle size={14} className="text-red-500 shrink-0" />
                    <p className="text-xs text-red-600 dark:text-red-400">{refundError}</p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setRefundModal(null)}
                    disabled={refunding}
                    className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirmRefund}
                    disabled={refunding}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                  >
                    {refunding ? <Loader2 size={14} className="animate-spin" /> : <><Undo2 size={14} /> Confirmar Reembolso</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal "Ver Detalhes" — pedido produtor Usualdance 2026-05-18.
          Estilo Notion/Linear: linha clicável abre painel lateral/modal
          com tudo sobre a inscrição. Padrão dashboard moderno. */}
      <AnimatePresence>
        {viewingReg && (() => {
          // Sessão 4.2 PR2 — drill-down side panel.
          // Desktop: slide-in from right (padrão Notion/Linear/Stripe Dashboard).
          // Mobile: modal centralizado (mantém UX original em telas pequenas).
          // Nav prev/next via arrow keys + botões no header (sem fechar pra
          // abrir próxima — navegação fluida pra produtor revisar lista).
          const idxAtual    = sortedRegistrations.findIndex((r: any) => r.id === viewingReg.id);
          const regAnterior = idxAtual > 0 ? sortedRegistrations[idxAtual - 1] : null;
          const regProxima  = idxAtual >= 0 && idxAtual < sortedRegistrations.length - 1
            ? sortedRegistrations[idxAtual + 1]
            : null;
          const navTo = (reg: any) => {
            if (!reg) return;
            cancelEditing();
            setViewingReg(reg);
          };
          return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center sm:items-stretch sm:justify-end p-4 sm:p-0">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { cancelEditing(); setViewingReg(null); }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              key={viewingReg.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: 'spring', damping: 25, stiffness: 240 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="reg-panel-title"
              className="relative bg-white dark:bg-slate-900 max-w-2xl w-full max-h-[90vh] sm:max-h-screen sm:h-screen sm:w-[34rem] sm:max-w-none rounded-3xl sm:rounded-l-3xl sm:rounded-r-none overflow-y-auto shadow-2xl"
            >
              {/* Header sticky com nav prev/next (drill-down side panel) */}
              <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 px-6 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#ff0068] mb-1">
                    {viewingReg.tipo_apresentacao ?? '—'}
                    {idxAtual >= 0 && (
                      <span className="ml-2 text-slate-400 normal-case tracking-normal">
                        · {idxAtual + 1}/{sortedRegistrations.length}
                      </span>
                    )}
                  </p>
                  <h2 id="reg-panel-title" className="font-black text-lg uppercase tracking-tight text-slate-900 dark:text-white leading-tight">{viewingReg.nome_coreografia ?? 'Sem nome'}</h2>
                  {viewingReg.estudio && <p className="text-[11px] text-slate-500 mt-1">{viewingReg.estudio}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Nav prev/next — só desktop, ajuda revisar lista sem fechar */}
                  <div className="hidden sm:flex items-center gap-0.5 mr-1">
                    <button
                      onClick={() => navTo(regAnterior)}
                      disabled={!regAnterior}
                      className="p-2 text-slate-500 hover:text-[#ff0068] hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-all"
                      title="Inscrição anterior (← seta esquerda)"
                      aria-label="Inscrição anterior"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => navTo(regProxima)}
                      disabled={!regProxima}
                      className="p-2 text-slate-500 hover:text-[#ff0068] hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-all"
                      title="Próxima inscrição (→ seta direita)"
                      aria-label="Próxima inscrição"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  {!editing && (
                    <button
                      onClick={() => startEditing(viewingReg)}
                      className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl transition-all flex items-center gap-1.5"
                      title="Editar dados da inscrição"
                    >
                      <Pencil size={12} /> Editar
                    </button>
                  )}
                  <button onClick={() => { cancelEditing(); setViewingReg(null); }} className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-all" title="Fechar (Esc)">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Inscrito — quem fez a inscrição (dono da conta).
                    Fallback: usa snapshot inscrito_* da registration quando o
                    profile não pôde ser lido (RLS bloqueando ou conta deletada).
                    Garante que produtor sempre vê os dados de contato. */}
                {(() => {
                  const nome     = viewingReg.profiles?.full_name ?? viewingReg.inscrito_nome;
                  const email    = viewingReg.profiles?.email     ?? viewingReg.inscrito_email;
                  const whatsapp = viewingReg.profiles?.whatsapp  ?? viewingReg.inscrito_whatsapp;
                  if (!nome && !email && !whatsapp && !viewingReg.estudio) return null;
                  return (
                    <section>
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><User size={12} /> Inscrito</h3>
                      <dl className="grid grid-cols-2 gap-3 text-[12px]">
                        <DetailItem label="Nome" value={nome} />
                        <DetailItem label="E-mail" value={email} />
                        <DetailItem label="WhatsApp" value={whatsapp} />
                        <DetailItem label="Estúdio / Escola" value={viewingReg.estudio} />
                      </dl>
                    </section>
                  );
                })()}

                {/* Coreografia */}
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><Music2 size={12} /> Coreografia</h3>
                  {editing ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 text-[12px]">
                        {/* Modalidade trava em inscrição APROVADA — mudança altera
                            preço (fee/pricing_type por formação) e exige
                            estorno + recobrança. Pra Solo→Grupo num pago
                            seria fraude potencial. */}
                        {viewingReg.status_pagamento === 'APROVADO' ? (
                          <div>
                            <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Modalidade</label>
                            <div className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-500 flex items-center gap-2">
                              <LockIcon size={11} /> {viewingReg.formato_participacao ?? '—'}
                            </div>
                            <p className="text-[9px] text-slate-400 mt-1">Trocar modalidade exige estornar e refazer a inscrição (afeta preço).</p>
                          </div>
                        ) : (
                          <EditField label="Modalidade" value={editValues.formato_participacao}
                            onChange={v => setEditValues(p => ({ ...p, formato_participacao: v }))}
                            options={['Solo', 'Duo', 'Trio', 'Grupo', 'Conjunto']} />
                        )}
                        <EditField label="Categoria" value={editValues.categoria}
                          onChange={v => setEditValues(p => ({ ...p, categoria: v }))}
                          options={categoriasDisponiveis} />
                        <EditField label="Estilo / Gênero" value={editValues.estilo_danca}
                          onChange={v => setEditValues(p => ({ ...p, estilo_danca: v }))}
                          options={estilosDisponiveis} />
                        <EditField label="Tipo de Mostra" value={editValues.tipo_apresentacao}
                          onChange={v => setEditValues(p => ({ ...p, tipo_apresentacao: v }))}
                          options={['Competitiva', 'Avaliada']} />
                      </div>
                    </>
                  ) : (
                    <dl className="grid grid-cols-2 gap-3 text-[12px]">
                      <DetailItem label="Modalidade" value={viewingReg.formato_participacao} />
                      <DetailItem label="Categoria" value={viewingReg.categoria} />
                      <DetailItem label="Estilo / Gênero" value={viewingReg.estilo_danca} />
                      <DetailItem label="Subgênero" value={viewingReg.subgenero} />
                      <DetailItem label="Coreógrafo(a)" value={viewingReg.coreografo_nome} />
                      <DetailItem label="Duração" value={viewingReg.duracao_minutos ? `${viewingReg.duracao_minutos} min` : null} />
                    </dl>
                  )}
                  {editing && (
                    <div className="mt-4 flex items-center justify-end gap-2">
                      {editError && (
                        <p className="flex-1 text-[10px] font-black text-rose-500 uppercase tracking-widest">{editError}</p>
                      )}
                      <button
                        onClick={cancelEditing}
                        disabled={savingEdit}
                        className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-all disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleSaveEdit(viewingReg.id)}
                        disabled={savingEdit}
                        className="px-4 py-2 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 flex items-center gap-1.5 disabled:opacity-60"
                      >
                        {savingEdit ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                        Salvar
                      </button>
                    </div>
                  )}
                </section>

                {/* Bailarinos — readonly mostra quando há array com dados.
                    Editor (Sessão 4.2 item 2) mostra sempre que editing=true
                    pra permitir adicionar do zero numa inscrição sem dados. */}
                {(editing || (Array.isArray(viewingReg.bailarinos_detalhes) && viewingReg.bailarinos_detalhes.length > 0)) && (
                  <section>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
                      <Users size={12} /> Bailarinos ({editing ? (editValues.bailarinos?.length ?? 0) : viewingReg.bailarinos_detalhes.length})
                      {/* Sessão 4.2 item 3: badge agregado quando algum bailarino
                          tem CPF/nasc/nome faltando. Bloqueia emissão de certificado
                          e validação de faixa etária. */}
                      {!editing && hasIncompleteBailarinos(viewingReg) && (
                        <span className="ml-1 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/30 rounded-full normal-case tracking-normal flex items-center gap-1">
                          <AlertTriangle size={10} /> dados pendentes
                        </span>
                      )}
                    </h3>
                    {editing ? (
                      <BailarinosEditor
                        bailarinos={editValues.bailarinos ?? []}
                        onChange={next => setEditValues(p => ({ ...p, bailarinos: next }))}
                        formato={editValues.formato_participacao ?? viewingReg.formato_participacao ?? ''}
                        instagramPrincipal={editValues.instagram_principal}
                        onInstagramPrincipalChange={v => setEditValues(p => ({ ...p, instagram_principal: v }))}
                        // Produtor só edita bailarinos existentes — sem INSERT/DELETE
                        // em elenco (RLS producer_updates_event_elenco em 20260602
                        // só dá FOR UPDATE). Pra adicionar, inscrito completa em
                        // /minhas-coreografias.
                        canAddRemove={false}
                      />
                    ) : (
                    <div className="space-y-2">
                      {viewingReg.bailarinos_detalhes.map((b: any, i: number) => {
                        // Lê dados pessoais reais da `elenco` via JOIN no JSONB.
                        // Fallback no `b.nome` quando o JSONB tem o nome mas o
                        // elenco ainda não foi hidratado (loading) — evita "—".
                        const elenco = elencoById[b?.id];
                        const incompleto = isElencoIncompleto(elenco);
                        const nome = elenco?.nome ?? b.nome ?? `Bailarino ${i + 1}`;
                        return (
                          <div key={i} className={`flex items-center justify-between gap-3 p-3 rounded-xl ${
                            incompleto
                              ? 'bg-amber-50 dark:bg-amber-500/5 border border-amber-300/60 dark:border-amber-500/20'
                              : 'bg-slate-50 dark:bg-white/5'
                          }`}>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                {nome}
                                {incompleto && (
                                  <AlertTriangle size={11} className="text-amber-500 shrink-0" />
                                )}
                              </p>
                              <p className={`text-[10px] ${incompleto ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-slate-400'}`}>
                                CPF {formatCpf(elenco?.cpf)} · Nasc. {formatDateBR(elenco?.data_nascimento)}
                                {incompleto && <span className="ml-1">· pedir ao inscrito</span>}
                              </p>
                            </div>
                            {b.instagram_handle && (
                              <a href={`https://instagram.com/${b.instagram_handle.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[#ff0068] hover:underline text-[10px] font-bold flex items-center gap-1 shrink-0">
                                <Instagram size={11} /> {b.instagram_handle}
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    )}
                    {viewingReg.instagram_principal && (
                      <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                        <Instagram size={11} /> Grupo/coreógrafo: <a href={`https://instagram.com/${viewingReg.instagram_principal.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[#ff0068] hover:underline font-bold">{viewingReg.instagram_principal}</a>
                      </p>
                    )}
                  </section>
                )}

                {/* Mídia — Vídeo (seletiva) só aparece se o evento usa essa feature.
                    Antes mostrava 'pending' pra qualquer evento, confundindo o produtor. */}
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><Video size={12} /> Trilha sonora{viewingReg.events?.video_selection_enabled ? ' & Vídeo' : ''}</h3>
                  <div className="space-y-2 text-[12px]">
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                      <span className="text-slate-500">Trilha sonora</span>
                      {viewingReg.trilha_url ? (
                        <a href={viewingReg.trilha_url.startsWith('http') ? viewingReg.trilha_url : '#'} target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 size={12} /> Enviada
                        </a>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                          <Clock size={12} /> Pendente
                        </span>
                      )}
                    </div>
                    {/* Vídeo seletiva: condicional pelo flag do evento */}
                    {viewingReg.events?.video_selection_enabled && (
                      <>
                        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                          <span className="text-slate-500">Vídeo (seletiva)</span>
                          <span className={`font-bold flex items-center gap-1 ${
                            viewingReg.video_status === 'approved' ? 'text-emerald-600 dark:text-emerald-400' :
                            viewingReg.video_status === 'rejected' ? 'text-rose-600 dark:text-rose-400' :
                            'text-amber-600 dark:text-amber-400'
                          }`}>
                            {viewingReg.video_status === 'approved' ? <><CheckCircle2 size={12} /> Aprovado</> :
                             viewingReg.video_status === 'rejected' ? <><X size={12} /> Reprovado</> :
                             viewingReg.video_status === 'submitted' ? <><Clock size={12} /> Em análise</> :
                             <><Clock size={12} /> {viewingReg.video_status ?? 'Pendente'}</>}
                          </span>
                        </div>
                        {viewingReg.video_feedback && (
                          <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Feedback do vídeo</p>
                            <p className="text-[11px] text-slate-700 dark:text-slate-300">{viewingReg.video_feedback}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>

                {/* Pagamento */}
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><DollarSign size={12} /> Pagamento</h3>
                  <dl className="grid grid-cols-2 gap-3 text-[12px]">
                    {/* Sessão 3 — valor por inscrição (P1 backlog painel produtor). */}
                    {(() => {
                      const v = Number(viewingReg.valor_pago ?? viewingReg.valor_total ?? viewingReg.charged_amount ?? viewingReg.mod_fee ?? 0);
                      return v > 0 ? (
                        <DetailItem label="Valor pago" value={`R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                      ) : null;
                    })()}
                    <DetailItem label="Status" value={viewingReg.status_pagamento} />
                    <DetailItem label="Método" value={viewingReg.payment_method ?? viewingReg.metodo_pagamento} />
                    <DetailItem label="ID Asaas" value={viewingReg.payment_id} mono />
                    {viewingReg.coupon_id && (
                      <DetailItem label="Cupom aplicado" value={`R$ ${Number(viewingReg.discount_amount ?? 0).toFixed(2)} de desconto`} />
                    )}
                    <DetailItem label="Status da inscrição" value={viewingReg.status} />
                  </dl>
                </section>

                {/* Tempos / Timeline — Sessão 3 P2 backlog painel produtor */}
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2"><Calendar size={12} /> Timeline</h3>
                  {(() => {
                    type TimelineIcon = 'created' | 'audio' | 'video' | 'paid' | 'refund';
                    // A16 auditoria Sessão 3: trilha_uploaded_at/video_uploaded_at
                    // não existem como colunas em registrations (confirmado via grep
                    // das migrations). Sem coluna dedicada, fallback é updated_at —
                    // não é o instante exato do upload mas é o melhor sinal disponível
                    // (qualquer update marca updated_at, então é a janela do upload).
                    const events: Array<{ label: string; at: string | null; icon: TimelineIcon }> = [
                      { label: 'Inscrição criada',  at: viewingReg.created_at ?? viewingReg.criado_em ?? null, icon: 'created' as TimelineIcon },
                      { label: 'Trilha enviada',    at: viewingReg.trilha_url ? (viewingReg.updated_at ?? null) : null, icon: 'audio' as TimelineIcon },
                      { label: 'Vídeo enviado',    at: viewingReg.video_url ? (viewingReg.updated_at ?? null) : null, icon: 'video' as TimelineIcon },
                      { label: 'Pagamento confirmado', at: viewingReg.paid_at ?? null, icon: 'paid' as TimelineIcon },
                      { label: 'Reembolsada',       at: viewingReg.refunded_at ?? null, icon: 'refund' as TimelineIcon },
                    ].filter(e => e.at);

                    if (events.length === 0) {
                      return <p className="text-[11px] text-slate-500">Sem eventos registrados ainda.</p>;
                    }

                    return (
                      <ol className="space-y-2 relative pl-4 border-l-2 border-slate-200 dark:border-white/10">
                        {events.map((e, i) => (
                          <li key={i} className="relative">
                            <span className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                              e.icon === 'paid' ? 'bg-emerald-500' :
                              e.icon === 'refund' ? 'bg-rose-500' :
                              e.icon === 'audio' || e.icon === 'video' ? 'bg-amber-500' :
                              'bg-slate-400'
                            }`} />
                            <p className="text-[11px] font-black text-slate-700 dark:text-slate-200">{e.label}</p>
                            <p className="text-[10px] text-slate-500">
                              {new Date(e.at!).toLocaleString('pt-BR', {
                                day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
                              })}
                            </p>
                          </li>
                        ))}
                      </ol>
                    );
                  })()}
                </section>
              </div>

              {/* Footer com ações rápidas */}
              <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 px-6 py-4 flex flex-wrap justify-end gap-2">
                {/* Sessão 3 P3: WhatsApp pré-preenchido. Aparece em qualquer
                    status quando o inscrito tem whatsapp cadastrado.
                    Mensagem varia por contexto (cobrar pagamento / confirmar
                    logística / aviso de inscrição vencida). */}
                {viewingReg.profiles?.whatsapp && (() => {
                  const digits = String(viewingReg.profiles?.whatsapp ?? '').replace(/\D/g, '');
                  if (!digits) return null;
                  // A17 auditoria Sessão 3: precisa de 10 (DDD+8) ou 11 (DDD+9) dígitos
                  // antes de prefixar 55. Com prefixo BR, aceita 12 ou 13. Qualquer
                  // outro tamanho é número quebrado — não mostra botão.
                  const hasBr = digits.startsWith('55');
                  const local = hasBr ? digits.slice(2) : digits;
                  if (local.length !== 10 && local.length !== 11) return null;
                  const phone = `55${local}`;
                  const nome = viewingReg.profiles?.full_name ?? '';
                  const coreo = viewingReg.nome_coreografia ?? '';
                  const eventoNome = activeEventInfo?.name ?? '';
                  const url = viewingReg.payment_url
                    ?? (viewingReg.payment_id ? `https://www.asaas.com/i/${String(viewingReg.payment_id).replace(/^pay_/, '')}` : '');

                  let body: string;
                  if (viewingReg.status_pagamento === 'PENDENTE') {
                    body = `Oi ${nome.split(' ')[0]}! Aqui é da produção${eventoNome ? ` do ${eventoNome}` : ''}. Sua inscrição "${coreo}" ainda está aguardando pagamento.` +
                      (url ? `\n\nPra confirmar é só pagar por aqui: ${url}` : '') +
                      `\n\nQualquer dúvida me chama por aqui. 🎉`;
                  } else if (viewingReg.status_pagamento === 'APROVADO' || viewingReg.status_pagamento === 'CONFIRMADO') {
                    body = `Oi ${nome.split(' ')[0]}! Aqui é da produção${eventoNome ? ` do ${eventoNome}` : ''}. Tô passando pra falar sobre a sua inscrição "${coreo}".`;
                  } else if (viewingReg.status_pagamento === 'VENCIDO' || viewingReg.status_pagamento === 'EXPIRADO') {
                    body = `Oi ${nome.split(' ')[0]}! Aqui é da produção${eventoNome ? ` do ${eventoNome}` : ''}. Sua inscrição "${coreo}" venceu sem pagamento. Se ainda quiser participar, me chama por aqui pra ver as opções.`;
                  } else {
                    body = `Oi ${nome.split(' ')[0]}! Aqui é da produção${eventoNome ? ` do ${eventoNome}` : ''} sobre sua inscrição "${coreo}".`;
                  }
                  const msg = encodeURIComponent(body);
                  return (
                    <a
                      href={`https://wa.me/${phone}?text=${msg}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-xl transition-all flex items-center gap-2"
                      title="Enviar mensagem pelo WhatsApp"
                    >
                      📱 WhatsApp
                    </a>
                  );
                })()}
                {/* Deep link Asaas — abre a fatura pública (mesma URL que o
                    pagador vê). Aceita payment_id com ou sem prefixo 'pay_'. */}
                {viewingReg.payment_id && (
                  <a
                    href={`https://www.asaas.com/i/${String(viewingReg.payment_id).replace(/^pay_/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl transition-all flex items-center gap-2"
                    title="Abrir fatura no Asaas (nova aba)"
                  >
                    <ExternalLink size={12} /> Abrir fatura
                  </a>
                )}
                {(viewingReg.status_pagamento === 'CONFIRMADO' || viewingReg.status_pagamento === 'APROVADO') && (
                  <button
                    onClick={() => { handleOpenRefund(viewingReg); setViewingReg(null); }}
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded-xl transition-all flex items-center gap-2"
                  >
                    <Undo2 size={12} /> Reembolsar
                  </button>
                )}
                <button
                  onClick={() => setViewingReg(null)}
                  className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl transition-all"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
          );
        })()}
      </AnimatePresence>

      {/* Sessão 4.2 item 6: drawer único de filtros. Modal centralizado (mesmo
          padrão visual dos outros modals do projeto). Contém os 7 selects que
          antes ficavam empilhados na tela. */}
      <AnimatePresence>
        {filtersOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setFiltersOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full max-h-[85dvh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-white/10"
            >
              <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={16} className="text-[#ff0068]" />
                  <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Filtros</h2>
                  {activeFiltersCount > 0 && (
                    <span className="px-2 py-0.5 bg-[#ff0068] text-white rounded-full text-[10px] font-black">
                      {activeFiltersCount}
                    </span>
                  )}
                </div>
                <button onClick={() => setFiltersOpen(false)} className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-all">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-3">
                <FilterSelectLabel label="Pagamento">
                  <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark]">
                    <option value="ALL">Todos</option>
                    <option value="APROVADO">Confirmado</option>
                    <option value="PENDENTE">Pendente</option>
                    <option value="VENCIDO">Vencido</option>
                    <option value="ESTORNADO">Estornado</option>
                    <option value="EXPIRADO">Expirado</option>
                  </select>
                </FilterSelectLabel>
                <FilterSelectLabel label="Data">
                  <select value={dateFilter} onChange={e => setDateFilter(e.target.value as any)} className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark]">
                    <option value="ALL">Todas</option>
                    <option value="today">Hoje</option>
                    <option value="7d">7 dias</option>
                    <option value="30d">30 dias</option>
                    <option value="month">Este mês</option>
                  </select>
                </FilterSelectLabel>
                <FilterSelectLabel label="Modalidade">
                  <select value={modalidadeFilter} onChange={e => setModalidadeFilter(e.target.value)} className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark]">
                    <option value="ALL">Todas</option>
                    <option value="Solo">Solo</option>
                    <option value="Duo">Duo</option>
                    <option value="Trio">Trio</option>
                    <option value="Grupo">Grupo</option>
                  </select>
                </FilterSelectLabel>
                <FilterSelectLabel label="Categoria">
                  <select value={categoriaFilter} onChange={e => setCategoriaFilter(e.target.value)} disabled={categoriasDisponiveis.length === 0} className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark] disabled:opacity-50">
                    <option value="ALL">Todas</option>
                    {categoriasDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FilterSelectLabel>
                <FilterSelectLabel label="Estilo / Gênero">
                  <select value={estiloFilter} onChange={e => setEstiloFilter(e.target.value)} disabled={estilosDisponiveis.length === 0} className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark] disabled:opacity-50">
                    <option value="ALL">Todos</option>
                    {estilosDisponiveis.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </FilterSelectLabel>
                <FilterSelectLabel label="Tipo de Mostra">
                  <select value={tipoApresentacaoFilter} onChange={e => setTipoApresentacaoFilter(e.target.value as 'ALL' | 'Competitiva' | 'Avaliada')} className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark]">
                    <option value="ALL">Todas</option>
                    <option value="Competitiva">Mostra Competitiva</option>
                    <option value="Avaliada">Mostra Avaliada</option>
                  </select>
                </FilterSelectLabel>
                <FilterSelectLabel label="Inscrito">
                  <select value={inscritoFilter} onChange={e => setInscritoFilter(e.target.value)} disabled={inscritosDisponiveis.length === 0} className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark] disabled:opacity-50">
                    <option value="ALL">Todos</option>
                    {inscritosDisponiveis.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </FilterSelectLabel>
              </div>
              <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 px-6 py-4 flex items-center justify-between gap-3">
                <button
                  onClick={resetAllFilters}
                  disabled={activeFiltersCount === 0 && !searchTerm && !quickAlert}
                  className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-rose-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Limpar tudo
                </button>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="px-6 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20"
                >
                  Aplicar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sessão 4.2 PR3 — action bar flutuante quando ≥1 selecionado.
          Sticky bottom, slide-in from below. Mostra count + ações:
          Exportar CSV / Copiar e-mails / Copiar WhatsApps / Limpar.
          Aria-live anuncia feedback (acessibilidade). */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 280 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 hidden md:flex items-center gap-3 px-5 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl shadow-2xl border border-slate-800 dark:border-slate-200"
            role="region"
            aria-label="Ações em massa"
          >
            <span className="text-[10px] font-black uppercase tracking-widest">
              {selectedIds.size} {selectedIds.size === 1 ? 'selecionada' : 'selecionadas'}
            </span>
            <div className="w-px h-6 bg-slate-700 dark:bg-slate-300" />
            <button
              onClick={handleBulkExportCSV}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white/10 dark:hover:bg-slate-900/10 flex items-center gap-1.5 transition-all"
              title="Exportar selecionadas como CSV"
            >
              <Download size={12} /> CSV
            </button>
            <button
              onClick={handleBulkCopyEmails}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white/10 dark:hover:bg-slate-900/10 flex items-center gap-1.5 transition-all"
              title="Copiar e-mails das selecionadas"
            >
              <User size={12} /> E-mails
            </button>
            <button
              onClick={handleBulkCopyWhatsapps}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white/10 dark:hover:bg-slate-900/10 flex items-center gap-1.5 transition-all"
              title="Copiar WhatsApps das selecionadas"
            >
              <MessageCircle size={12} /> WhatsApp
            </button>
            <div className="w-px h-6 bg-slate-700 dark:bg-slate-300" />
            <button
              onClick={clearSelection}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white dark:hover:text-slate-900 hover:bg-white/10 dark:hover:bg-slate-900/10 transition-all"
              title="Limpar seleção"
              aria-label="Limpar seleção"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {bulkActionFeedback && (
        <div
          className="fixed bottom-20 md:bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-emerald-500 text-white rounded-xl shadow-lg text-[10px] font-black uppercase tracking-widest"
          role="status"
          aria-live="polite"
        >
          {bulkActionFeedback}
        </div>
      )}
    </div>
  );
};

/** Máscaras visuais — CPF 000.000.000-00 e data ISO → dd/mm/yyyy.
 *  Retorna '—' pra valor vazio. Tolera string já mascarada (só formata
 *  o que tem 11 dígitos limpos). Data aceita 'YYYY-MM-DD' ou ISO completo. */
const formatCpf = (raw?: string | null): string => {
  if (!raw) return '—';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 11) return raw;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};
const formatDateBR = (raw?: string | null): string => {
  if (!raw) return '—';
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

/** Indicador de sort no header da tabela. "≡" cinza pra coluna sortable inativa,
 *  ↑/↓ rosa pra coluna ativa (cor brand). Padrão Linear/Notion. */
const SortIcon: React.FC<{ active: boolean; dir: 'asc' | 'desc' }> = ({ active, dir }) => {
  if (!active) return <ChevronDown size={10} className="text-slate-300 dark:text-slate-600 opacity-60" />;
  return dir === 'asc'
    ? <ChevronUp size={10} className="text-[#ff0068]" />
    : <ChevronDown size={10} className="text-[#ff0068]" />;
};

/** Chip de filtro ativo (Sessão 4.2 item 6). Mostra "Categoria: Junior" com X
 *  pra remoção rápida — padrão Sympla/Linear. Tom rosa pra dar afetividade
 *  com o botão Filtros (mesma família visual). */
const ActiveFilterChip: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <span className="inline-flex items-center gap-1 pl-2 pr-1 py-1 bg-[#ff0068]/10 dark:bg-[#ff0068]/15 text-[#ff0068] border border-[#ff0068]/30 rounded-lg text-[10px] font-black uppercase tracking-widest">
    {label}
    <button
      type="button"
      onClick={onRemove}
      className="p-0.5 hover:bg-[#ff0068]/20 rounded transition-all"
      title="Remover este filtro"
    >
      <X size={10} />
    </button>
  </span>
);

/** Label + container pros selects dentro do drawer de filtros. Padrão "form
 *  estruturado" — label small caps acima do controle, espaçamento generoso. */
const FilterSelectLabel: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">{label}</label>
    {children}
  </div>
);

/** KPI card no topo da lista. Padrão Stripe Dashboard: número grande +
 *  label + ícone tonalizado. Tom controla cor do ícone/borda esquerda. */
const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; tone: 'slate' | 'emerald' | 'amber' | 'pink' }> = ({ icon, label, value, tone }) => {
  const tones = {
    slate:   { bg: 'bg-slate-500/10',   text: 'text-slate-600 dark:text-slate-400',     border: 'border-slate-200 dark:border-white/5' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-500/20' },
    amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400',     border: 'border-amber-200 dark:border-amber-500/20' },
    pink:    { bg: 'bg-[#ff0068]/10',   text: 'text-[#ff0068]',                          border: 'border-[#ff0068]/20' },
  }[tone];
  return (
    <div className={`bg-white dark:bg-slate-900/40 border ${tones.border} rounded-2xl p-4 flex items-center gap-3`}>
      <div className={`w-9 h-9 rounded-xl ${tones.bg} ${tones.text} flex items-center justify-center shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 truncate">{label}</p>
        <p className="text-lg font-black text-slate-900 dark:text-white truncate">{value}</p>
      </div>
    </div>
  );
};

/** Helper de item de detalhe (label + valor). Esconde quando valor é vazio
 *  pra modal não exibir "—" pra campos que o inscrito não preencheu. */
const DetailItem: React.FC<{ label: string; value?: string | null; mono?: boolean }> = ({ label, value, mono }) => {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{label}</dt>
      <dd className={`text-slate-900 dark:text-white break-all ${mono ? 'font-mono text-[11px]' : 'font-bold'}`}>{value}</dd>
    </div>
  );
};

/** Campo editável combo: select com opções conhecidas + datalist-style fallback
 *  livre. Permite escolher valor existente OU digitar novo (útil quando produtor
 *  precisa de uma categoria que ainda não existe em outras inscrições). */
const EditField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}> = ({ label, value, onChange, options }) => {
  // Mostra select se valor atual está nas opções; senão input livre.
  const inOptions = options.includes(value);
  return (
    <div>
      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</label>
      {inOptions ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068] dark:[color-scheme:dark]"
        >
          {options.map(o => <option key={o} value={o}>{o}</option>)}
          {!inOptions && value && <option value={value}>{value} (atual)</option>}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={options.length > 0 ? `Ex.: ${options[0]}` : ''}
          className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-900 dark:text-white outline-none focus:border-[#ff0068]"
          list={`opts-${label}`}
        />
      )}
      {!inOptions && options.length > 0 && (
        <datalist id={`opts-${label}`}>
          {options.map(o => <option key={o} value={o} />)}
        </datalist>
      )}
    </div>
  );
};

export default Registrations;
