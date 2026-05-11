/**
 * Wizard de inscrição modalidade-first (PR-B).
 *
 * 4 passos numerados (Coreografia → Elenco → Trilha → Pagamento) — padrão
 * Sympla/Eventbrite. Substitui o NewRegistration.tsx (mantido como fallback
 * em /register sem modalidade pré-selecionada).
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
  AlertCircle, CheckCircle, Plus, Trash2, ArrowRight,
} from 'lucide-react';

const inputCls = 'w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-5 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm dark:[color-scheme:dark]';
const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1';

interface BailarinoEntry {
  id?: string;          // preenchido após insert em `elenco`
  nome: string;
  cpf: string;
  data_nascimento: string;
}

interface WizardData {
  // Passo 1 — Coreografia
  nome_coreografia: string;
  estilo_danca: string;
  categoria: string;
  duracao_minutos: string;
  coreografo_nome: string;
  estudio_nome: string;
  // Passo 2 — Elenco
  bailarinos: BailarinoEntry[];
  // Passo 3 — Trilha
  trilha_url: string;
  trilha_pendente: boolean;
  trilha_obs: string;
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

const InscricaoWizard: React.FC = () => {
  const { idOrSlug, modalidade } = useParams<{ idOrSlug: string; modalidade: string }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);

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
    categoria: '',
    duracao_minutos: '',
    coreografo_nome: '',
    estudio_nome: '',
    bailarinos: [{ nome: '', cpf: '', data_nascimento: '' }],
    trilha_url: '',
    trilha_pendente: false,
    trilha_obs: '',
  });

  // ─── Load event + config + user ──────────────────────────────────────────
  useEffect(() => {
    if (!idOrSlug || !modalidade) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Q2 padrão Sympla: redireciona pra login preservando rota de retorno.
        // CRÍTICO: modalidade vem decoded do useParams (ex.: "Conjunto/Grupo");
        // re-encoda pra não virar 2 path segments no callback do OAuth.
        const redirectPath = `/festival/${idOrSlug}/inscrever/${encodeURIComponent(modalidade)}`;
        navigate(`/login?redirectTo=${encodeURIComponent(redirectPath)}`);
        return;
      }
      setUserId(user.id);

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
      const filterCol = isUuid ? 'id' : 'slug';

      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, name, formacoes_config, registration_start_date, registration_end_date, start_date, event_date')
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
      const modalidadeMatch = (ev.formacoes_config ?? []).find((m: any) =>
        m.name?.trim().toLowerCase() === modalidade.trim().toLowerCase()
      );
      if (!modalidadeMatch) {
        setError(`Modalidade "${modalidade}" não está disponível neste evento. Volte e escolha uma modalidade da lista.`);
        setLoading(false);
        return;
      }

      const isOpen = (() => {
        const now = new Date();
        const s = ev.registration_start_date ? new Date(ev.registration_start_date) : null;
        const e = ev.registration_end_date ? new Date(ev.registration_end_date) : null;
        if (s && now < s) return false;
        if (e && now > e) return false;
        return true;
      })();
      if (!isOpen) { setError('Inscrições deste evento estão fechadas.'); setLoading(false); return; }

      // Pré-popula coreógrafo com nome do user (ele loga, ele inscreve, aparece no recibo).
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();

      const [{ data: cfg }, { data: legacy }] = await Promise.all([
        supabase.from('configuracoes').select('categorias, estilos, tolerancia, age_reference, age_reference_date').eq('event_id', ev.id).maybeSingle(),
        supabase.from('configuracoes').select('categorias, estilos, tolerancia, age_reference, age_reference_date').eq('id', '1').maybeSingle(),
      ]);
      const finalCfg = cfg && (cfg.categorias || cfg.estilos) ? cfg : legacy;

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

      if (profile?.full_name) {
        setData(d => ({ ...d, coreografo_nome: profile.full_name }));
      }

      // Ajusta tamanho do array de bailarinos pro mínimo da modalidade.
      const formacao = (ev.formacoes_config ?? []).find((m: any) =>
        m.name?.trim().toLowerCase() === modalidade.trim().toLowerCase()
      );
      const minMembers = Number(formacao?.min_members ?? 1);
      setData(d => ({
        ...d,
        bailarinos: Array.from({ length: minMembers }, () => ({ nome: '', cpf: '', data_nascimento: '' })),
      }));

      setLoading(false);
    })();
  }, [idOrSlug, modalidade, navigate]);

  const formacao = useMemo(() => {
    if (!event || !modalidade) return null;
    return (event.formacoes_config ?? []).find((m: any) =>
      m.name?.trim().toLowerCase() === modalidade.trim().toLowerCase()
    );
  }, [event, modalidade]);

  const minMembers = Number(formacao?.min_members ?? 1);
  const maxMembers = Number(formacao?.max_members ?? 50);

  const categorias: { name: string; min_age?: number; max_age?: number }[] = config?.categorias ?? [];
  const estilos: { name: string }[] = (config?.estilos ?? []).map((s: any) =>
    typeof s === 'string' ? { name: s } : { name: s.name ?? '' }
  ).filter((s: any) => s.name);

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
      if (!data.categoria)                 return 'Selecione a categoria etária.';
      if (data.duracao_minutos && Number(data.duracao_minutos) <= 0) return 'Duração inválida.';
      if (!data.coreografo_nome.trim())    return 'Informe o nome do coreógrafo.';
    }
    if (s === 1) {
      if (data.bailarinos.length < minMembers) return `Adicione pelo menos ${minMembers} bailarino(s).`;
      if (data.bailarinos.length > maxMembers) return `Máximo ${maxMembers} bailarinos pra ${modalidade}.`;
      for (let i = 0; i < data.bailarinos.length; i++) {
        const b = data.bailarinos[i];
        if (!b.nome.trim())          return `Bailarino ${i + 1}: informe o nome.`;
        if (!validCPF(b.cpf))        return `Bailarino ${i + 1}: CPF inválido.`;
        if (!b.data_nascimento)      return `Bailarino ${i + 1}: informe a data de nascimento.`;
      }
      // Tolerância: STRICT bloqueia, FLEXIBLE deixa passar (mas grava flag em event_data
      // pra produtor ver no painel — mesma regra do MinhasCoreografias.tsx legacy).
      if (toleranceRule.enforcement === 'STRICT' && toleranceStatus.violates) {
        return `Tolerância excedida: ${toleranceStatus.outCount} bailarino(s) fora da faixa "${data.categoria}". Limite do evento: até ${toleranceStatus.limitLabel}.`;
      }
    }
    if (s === 2) {
      if (!data.trilha_pendente && data.trilha_url && !/^https?:\/\//.test(data.trilha_url)) {
        return 'Link da trilha precisa começar com http:// ou https://';
      }
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

      const bailarinosDetalhes = (elencoCreated ?? []).map(b => ({ id: b.id, nome: b.nome }));
      const createdElencoIds   = (elencoCreated ?? []).map(b => b.id);

      // M2: salva metadados legacy (event_nome, mod_fee) em event_data pra
      // compat com MinhasCoreografias.tsx que lê esses campos pra exibir.
      const firstLote = (formacao?.lotes ?? [])[0];
      const modFee = firstLote?.preco ?? formacao?.fee ?? formacao?.base_fee ?? 0;

      // 2) Cria registration. Status AGUARDANDO_PAGAMENTO — Checkout completa.
      const { data: reg, error: regErr } = await supabase
        .from('registrations')
        .insert({
          event_id:             event.id,
          user_id:              userId,
          nome_coreografia:     data.nome_coreografia.trim(),
          estilo_danca:         data.estilo_danca || null,
          categoria:            data.categoria,
          formato_participacao: formacao?.name ?? modalidade,
          bailarinos_detalhes:  bailarinosDetalhes,
          trilha_url:           data.trilha_pendente ? null : (data.trilha_url || null),
          status_trilha:        data.trilha_pendente || !data.trilha_url ? 'PENDENTE' : 'ENVIADA',
          status:               'AGUARDANDO_PAGAMENTO',
          status_pagamento:     'PENDENTE',
          criado_em:            new Date().toISOString(),
          data_inscricao:       new Date().toISOString(),
          event_data: {
            event_nome:       event.name ?? '',
            mod_fee:          Number(modFee) || 0,
            duracao_minutos:  data.duracao_minutos ? Number(data.duracao_minutos) : null,
            coreografo_nome:  data.coreografo_nome.trim(),
            estudio_nome:     data.estudio_nome.trim() || null,
            trilha_obs:       data.trilha_obs.trim() || null,
            wizard_version:   'PR-B-2026-05-06',
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
          },
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

      // 3) Redireciona pra Checkout existente — reusa integração Asaas/cupom/etc.
      navigate(`/festival/${event.id}/checkout?registration_id=${reg.id}`);
    } catch (e: any) {
      setError(e.message ?? 'Erro inesperado ao finalizar inscrição.');
      setSubmitting(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-32">
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
            {STEPS.map((s, i) => (
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
            {STEPS.map((s, i) => (
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
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* ─── Passo 0: Coreografia ─────────────────────────────────────── */}
        {step === 0 && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Music2 size={18} /></div>
              <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">Sobre sua coreografia</h2>
            </div>

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
                  onChange={e => setData(d => ({ ...d, estilo_danca: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">Selecione…</option>
                  {estilos.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>

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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Duração (minutos)</label>
                <input
                  type="number"
                  min={1}
                  value={data.duracao_minutos}
                  onChange={e => setData(d => ({ ...d, duracao_minutos: e.target.value }))}
                  placeholder="Ex: 3"
                  className={inputCls}
                />
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
                    <input
                      type="date"
                      value={b.data_nascimento}
                      onChange={e => setData(d => ({ ...d, bailarinos: d.bailarinos.map((x, idx) => idx === i ? { ...x, data_nascimento: e.target.value } : x) }))}
                      className={inputCls}
                    />
                  </div>
                </div>
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

        {/* ─── Passo 2: Trilha ──────────────────────────────────────────── */}
        {step === 2 && (
          <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Upload size={18} /></div>
              <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">Trilha sonora</h2>
            </div>

            <div>
              <label className={labelCls}>Link da trilha (Google Drive, WeTransfer, Dropbox)</label>
              <input
                type="url"
                value={data.trilha_url}
                disabled={data.trilha_pendente}
                onChange={e => setData(d => ({ ...d, trilha_url: e.target.value }))}
                placeholder="https://drive.google.com/..."
                className={`${inputCls} ${data.trilha_pendente ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
              <p className="text-[10px] text-slate-500 mt-1.5 ml-1">
                Configure o link como público ou com permissão de "qualquer pessoa com o link".
              </p>
            </div>

            <button
              onClick={() => setData(d => ({ ...d, trilha_pendente: !d.trilha_pendente, trilha_url: !d.trilha_pendente ? '' : d.trilha_url }))}
              className={`w-full flex items-start gap-3 p-4 rounded-2xl border transition-all text-left ${
                data.trilha_pendente
                  ? 'border-[#ff0068] bg-[#ff0068]/5'
                  : 'border-slate-200 dark:border-white/10'
              }`}
            >
              <div className={`shrink-0 mt-0.5 w-4 h-4 rounded border-2 ${data.trilha_pendente ? 'border-[#ff0068] bg-[#ff0068]' : 'border-slate-300 dark:border-white/30'}`}>
                {data.trilha_pendente && <CheckCircle size={12} className="text-white -m-px" />}
              </div>
              <div className="min-w-0">
                <p className={`text-[11px] font-black uppercase tracking-widest ${data.trilha_pendente ? 'text-[#ff0068]' : 'text-slate-700 dark:text-slate-200'}`}>
                  Vou anexar a trilha depois
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  Acesse "Minhas coreografias" pra anexar antes do prazo do evento.
                </p>
              </div>
            </button>

            <div>
              <label className={labelCls}>Observações pro operador de som (opcional)</label>
              <textarea
                value={data.trilha_obs}
                onChange={e => setData(d => ({ ...d, trilha_obs: e.target.value }))}
                placeholder="Ex: começar em volume baixo, subir em 0:30"
                rows={3}
                className={inputCls}
              />
            </div>
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
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Bailarinos</span>
                <span className="font-black text-slate-900 dark:text-white">{data.bailarinos.length}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-slate-400">Trilha</span>
                <span className="font-black text-slate-900 dark:text-white text-right">
                  {data.trilha_pendente
                    ? '⏳ Anexar depois'
                    : data.trilha_url
                      ? '✅ Link enviado'
                      : '⏳ Não enviada'}
                </span>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-white/10 pt-4 mt-4">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Ao confirmar, você cria sua inscrição e vai pra tela de pagamento. O valor depende
                do lote vigente (Pix, cartão ou boleto via Asaas).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Barra de navegação fixa embaixo ──────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-white/5 px-4 py-3 z-20">
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
              Próximo: {STEPS[step + 1].label} <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {submitting ? 'Criando inscrição…' : 'Confirmar e ir pro pagamento'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InscricaoWizard;
