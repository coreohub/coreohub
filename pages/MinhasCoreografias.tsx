import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import SystemErrorBanner from '../components/SystemErrorBanner';
import {
  Music2, Plus, Trash2, AlertCircle, Loader2, CheckCircle,
  Clapperboard, Calendar, MapPin, Clock, CreditCard, QrCode,
  ChevronRight, AlertTriangle, ShoppingCart, X,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
interface Registration {
  id:                    string;
  user_id:               string;
  event_id:              string | null;
  nome_coreografia:      string | null;
  formato_participacao:  string | null;
  tipo_apresentacao:     string | null;
  estilo_danca:          string | null;
  categoria:             string | null;
  status:                string;
  status_pagamento:      string;
  payment_url:           string | null;
  payment_preference_id: string | null;
  payment_id:            string | null;
  payment_group_id:      string | null;
  mod_fee:               number | null;
  charged_amount:        number | null;
  valor_pago:            number | null;
  paid_at:               string | null;
  created_at:            string;
  /** Hidratado do join com events */
  _event?: {
    id:         string;
    name:       string;
    slug:       string | null;
    start_date: string | null;
    location:   string | null;
  };
  /** Preço calculado client-side pra exibição (charged_amount / valor_pago /
   *  mod_fee / fallback formacao.preco). Null quando não há base configurada. */
  _precoDisplay?: number | null;
}

interface AggregatePayment {
  id:               string;
  user_id:          string;
  event_id:         string;
  value_total:      number;
  asaas_payment_id: string | null;
  payment_url:      string | null;
  status:           string;
  expires_at:       string | null;
  created_at:       string;
  paid_at:          string | null;
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
const fmtDate = (d?: string | null): string => {
  if (!d) return '—';
  // Aceita 'YYYY-MM-DD' ou ISO completo.
  const s = d.length === 10 ? `${d}T12:00:00` : d;
  const date = new Date(s);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const fmtMoney = (v?: number | null): string =>
  v != null
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
    : '—';

const diasAte = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diff = d.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
};

/**
 * Mapeia `status_pagamento` do banco pra label/cor da UI. Cobre todos os
 * estados reais que o webhook/cron produz.
 */
const STATUS_PAGAMENTO_CFG: Record<string, { bg: string; text: string; label: string; tone: 'pendente' | 'ok' | 'erro' | 'expirado' }> = {
  PENDENTE:  { bg: 'bg-amber-50 dark:bg-amber-500/10',   text: 'text-amber-700 dark:text-amber-400',     label: 'Aguardando pagamento', tone: 'pendente' },
  APROVADO:  { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', label: 'Confirmada',         tone: 'ok' },
  VENCIDO:   { bg: 'bg-slate-100 dark:bg-white/5',       text: 'text-slate-500',                         label: 'Vencida',              tone: 'expirado' },
  EXPIRADO:  { bg: 'bg-slate-100 dark:bg-white/5',       text: 'text-slate-500',                         label: 'Expirada',             tone: 'expirado' },
  ESTORNADO: { bg: 'bg-slate-100 dark:bg-white/5',       text: 'text-slate-500',                         label: 'Estornada',            tone: 'erro' },
  CANCELADO: { bg: 'bg-slate-100 dark:bg-white/5',       text: 'text-slate-500',                         label: 'Cancelada',            tone: 'erro' },
};
const statusCfg = (s: string) => STATUS_PAGAMENTO_CFG[s] ?? STATUS_PAGAMENTO_CFG.PENDENTE;


/* ══════════════════════════════════════════════════════════════
   COMPONENT
══════════════════════════════════════════════════════════════ */
const MinhasCoreografias = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const novaId = searchParams.get('nova');

  const [registrations, setRegistrations]    = useState<Registration[]>([]);
  const [activePayments, setActivePayments]  = useState<Record<string, AggregatePayment>>({});
  const [profileCpf, setProfileCpf]          = useState<string | null>(null);
  const [loading,  setLoading]               = useState(true);
  const [error,    setError]                 = useState<string | null>(null);

  const [confirmDel, setConfirmDel]          = useState<Registration | null>(null);
  const [payingEvent, setPayingEvent]        = useState<string | null>(null);
  const [payingSingle, setPayingSingle]      = useState<string | null>(null);
  const [deleting,    setDeleting]           = useState(false);

  /* ══════════════════════════════════════════════════════════
     FETCH
  ══════════════════════════════════════════════════════════ */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
        return;
      }

      // Perfil pra checar CPF (necessário antes de gerar fatura agregada — A4).
      const { data: profile } = await supabase
        .from('profiles')
        .select('cpf_cnpj')
        .eq('id', user.id)
        .maybeSingle();
      setProfileCpf(profile?.cpf_cnpj ?? null);

      // Inscrições do user. Não usamos embed PostgREST com events porque
      // registrations tem múltiplas FKs pra events (event_id + outras
      // colunas com FK ambígua) e o embed falha com erro PGRST201.
      // Buscamos events em query separada e mapeamos client-side.
      const { data: regsData, error: regsErr } = await supabase
        .from('registrations')
        .select(`
          id, user_id, event_id,
          nome_coreografia, formato_participacao, tipo_apresentacao,
          estilo_danca, categoria,
          status, status_pagamento,
          payment_url, payment_preference_id, payment_id, payment_group_id,
          mod_fee, charged_amount, valor_pago, paid_at, created_at
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (regsErr) throw regsErr;
      const regsRaw = regsData ?? [];

      // Carrega events e configuracoes em batch. `formacoes_config` em events
      // + `formatos_precos` em configuracoes são as fontes de preço por
      // formação (mesmas fontes que create-aggregate-payment-asaas lê).
      const eventIds = Array.from(new Set(regsRaw.map((r: any) => r.event_id).filter(Boolean))) as string[];
      let eventsMap:  Record<string, any> = {};
      let configsMap: Record<string, any> = {};
      if (eventIds.length > 0) {
        const [{ data: eventsData }, { data: configsData }] = await Promise.all([
          supabase
            .from('events')
            .select('id, name, slug, start_date, location, formacoes_config, fee_mode, commission_percent')
            .in('id', eventIds),
          supabase
            .from('configuracoes')
            .select('event_id, formatos_precos')
            .in('event_id', eventIds),
        ]);
        for (const ev of (eventsData  ?? [])) eventsMap[ev.id]        = ev;
        for (const cf of (configsData ?? [])) configsMap[cf.event_id] = cf;
      }

      // Helper: calcula o preço a mostrar pra uma inscrição. Espelha a lógica
      // de create-aggregate-payment-asaas (sem o passo de lote — pra simples
      // exibição usamos o preço base da formação).
      const calcPrecoDisplay = (r: any): number | null => {
        if (r.charged_amount != null && r.charged_amount > 0) return Number(r.charged_amount);
        if (r.valor_pago     != null && r.valor_pago     > 0) return Number(r.valor_pago);
        if (r.mod_fee        != null && r.mod_fee        > 0) return Number(r.mod_fee);
        if (!r.event_id) return null;
        const formacaoNome: string = (r.formato_participacao ?? r.tipo_apresentacao ?? '').toLowerCase();
        if (!formacaoNome) return null;
        const cfg     = configsMap[r.event_id];
        const ev      = eventsMap[r.event_id];
        const fmCfg   = (cfg?.formatos_precos ?? []).find((f: any) => f.nome?.toLowerCase() === formacaoNome);
        const fmEvent = (ev?.formacoes_config ?? []).find((m: any) => m.name?.toLowerCase() === formacaoNome);
        const base    = fmCfg?.preco ?? fmEvent?.fee ?? fmEvent?.base_fee ?? null;
        if (base == null || base <= 0) return null;
        // Se o evento repassa a taxa, soma a comissão pra mostrar o que o inscrito paga.
        const feeMode = ev?.fee_mode ?? 'repassar';
        if (feeMode === 'repassar') {
          const pct = Number(ev?.commission_percent ?? 10);
          return parseFloat((Number(base) * (1 + pct / 100)).toFixed(2));
        }
        return Number(base);
      };

      const regs: Registration[] = regsRaw.map((r: any) => ({
        ...r,
        _event:        r.event_id ? eventsMap[r.event_id] : undefined,
        // Snapshot do preço calculado pra exibir. Não é persistido — é só pra UI.
        _precoDisplay: calcPrecoDisplay(r),
      }));
      setRegistrations(regs);

      // Active payments: 1 PENDENTE por evento (no máximo).
      const { data: payments } = await supabase
        .from('payments')
        .select('id, user_id, event_id, value_total, asaas_payment_id, payment_url, status, expires_at, created_at, paid_at')
        .eq('user_id', user.id)
        .eq('status', 'PENDENTE');
      const map: Record<string, AggregatePayment> = {};
      for (const p of (payments ?? [])) map[p.event_id] = p as AggregatePayment;
      setActivePayments(map);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Limpa o ?nova= depois de 5s pra não persistir na URL.
  useEffect(() => {
    if (!novaId) return;
    const t = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('nova');
        return next;
      }, { replace: true });
    }, 5000);
    return () => clearTimeout(t);
  }, [novaId, setSearchParams]);

  /* ══════════════════════════════════════════════════════════
     DERIVED — agrupar por evento
  ══════════════════════════════════════════════════════════ */
  type Grupo = {
    eventId:    string;
    eventNome:  string;
    eventSlug:  string | null;
    eventData:  string | null;
    eventLocal: string | null;
    pendentes:  Registration[];
    outras:     Registration[];
    totalPendente: number;
    payment:    AggregatePayment | undefined;
  };

  const grupos: Grupo[] = useMemo(() => {
    const map = new Map<string, Grupo>();
    for (const r of registrations) {
      if (!r.event_id) continue;
      const key = r.event_id;
      if (!map.has(key)) {
        map.set(key, {
          eventId:    key,
          eventNome:  r._event?.name ?? 'Evento',
          eventSlug:  r._event?.slug ?? null,
          eventData:  r._event?.start_date ?? null,
          eventLocal: r._event?.location ?? null,
          pendentes:  [],
          outras:     [],
          totalPendente: 0,
          payment:    activePayments[key],
        });
      }
      const g = map.get(key)!;
      if (r.status_pagamento === 'PENDENTE') {
        g.pendentes.push(r);
        // Soma o preço calculado pra UI. Quando a fatura agregada existe,
        // o valor real já está em payment.value_total e sobrescreve este total.
        g.totalPendente += Number(r._precoDisplay ?? 0);
      } else {
        g.outras.push(r);
      }
    }
    // Pendentes primeiro, depois por data do evento.
    return Array.from(map.values()).sort((a, b) => {
      if (a.pendentes.length !== b.pendentes.length) {
        return b.pendentes.length - a.pendentes.length;
      }
      return (a.eventData ?? '').localeCompare(b.eventData ?? '');
    });
  }, [registrations, activePayments]);

  /* ══════════════════════════════════════════════════════════
     ACTIONS
  ══════════════════════════════════════════════════════════ */

  /** Valida CPF antes de qualquer chamada de payment. */
  const requireCpf = (): boolean => {
    if (!profileCpf || !profileCpf.replace(/\D/g, '')) {
      setError('Pra pagar você precisa completar seu CPF no perfil.');
      navigate('/meu-perfil');
      return false;
    }
    return true;
  };

  const handlePagarAgregado = async (grupo: Grupo) => {
    if (!requireCpf()) return;
    if (grupo.pendentes.length === 0) return;
    setPayingEvent(grupo.eventId);
    setError(null);
    try {
      // Se já existe fatura agregada PENDENTE pra esse evento, abre a URL existente.
      if (grupo.payment?.payment_url) {
        window.location.href = grupo.payment.payment_url;
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada. Faça login novamente.');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-aggregate-payment-asaas`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            event_id:         grupo.eventId,
            registration_ids: grupo.pendentes.map(r => r.id),
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        if (data?.error_code === 'CPF_REQUIRED') {
          navigate('/meu-perfil');
          throw new Error('CPF/CNPJ obrigatório. Complete seu perfil.');
        }
        throw new Error(data?.error ?? 'Erro ao gerar fatura.');
      }
      if (data?.invoice_url) {
        window.location.href = data.invoice_url;
      }
    } catch (e: any) {
      setError(e.message);
      setPayingEvent(null);
    }
  };

  const handlePagarSingle = async (reg: Registration) => {
    if (!requireCpf()) return;
    // Se a registration já tem payment_url (gerada anteriormente — ou pelo
    // create-payment-asaas legacy, ou pela create-aggregate), reusa.
    if (reg.payment_url) {
      window.location.href = reg.payment_url;
      return;
    }
    setPayingSingle(reg.id);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada.');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment-asaas`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            registration_id: reg.id,
            event_id:        reg.event_id,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error ?? 'Erro ao gerar pagamento.');
      if (data?.invoice_url) {
        window.location.href = data.invoice_url;
      }
    } catch (e: any) {
      setError(e.message);
      setPayingSingle(null);
    }
  };

  const handleDelete = async (reg: Registration) => {
    setDeleting(true);
    setError(null);
    try {
      // Se está numa fatura agregada, primeiro precisamos desfazer.
      // O webhook não pode confirmar uma fatura cuja registrations sumiram.
      // Decisão simples: bloqueia delete quando faz parte de payment PENDENTE.
      // (Sessão futura: cancelar Asaas + remover só essa registration do grupo.)
      if (reg.payment_group_id) {
        throw new Error(
          'Esta inscrição está agrupada numa fatura. Cancele a fatura no checkout ' +
          'ou aguarde o prazo expirar antes de remover.'
        );
      }
      const { error: delErr } = await supabase.from('registrations').delete().eq('id', reg.id);
      if (delErr) throw delErr;
      setRegistrations(prev => prev.filter(r => r.id !== reg.id));
      setConfirmDel(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-16 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#ff0068]" />
      </div>
    );
  }

  const totalPendentesGlobal = grupos.reduce((s, g) => s + g.pendentes.length, 0);
  const totalConfirmadasGlobal = grupos.reduce(
    (s, g) => s + g.outras.filter(r => r.status_pagamento === 'APROVADO').length,
    0
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
            Minhas <span className="text-[#ff0068]">Coreografias</span>
          </h1>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
            {registrations.length} inscriç{registrations.length === 1 ? 'ão' : 'ões'}
            {totalConfirmadasGlobal > 0 && ` · ${totalConfirmadasGlobal} confirmada${totalConfirmadasGlobal !== 1 ? 's' : ''}`}
            {totalPendentesGlobal > 0 && ` · ${totalPendentesGlobal} pendente${totalPendentesGlobal !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* ── Banner "Inscrição criada" ── */}
      {novaId && registrations.some(r => r.id === novaId) && (
        <div className="flex items-start gap-3 p-4 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
          <CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
              Inscrição adicionada
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Adicione mais coreografias antes de pagar pra economizar — pague tudo de uma vez no botão "Pagar todas".
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-600 dark:text-slate-300 text-sm">
          <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {registrations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center">
            <Music2 size={20} className="text-slate-400" />
          </div>
          <div>
            <p className="font-black uppercase tracking-tight text-slate-500">Nenhuma inscrição ainda</p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Acesse a vitrine pública do festival pra se inscrever
            </p>
          </div>
        </div>
      )}

      {/* ── Grupos por evento ── */}
      {grupos.map(grupo => (
        <div key={grupo.eventId} className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden">

          {/* Cabeçalho do evento */}
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/5 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                {grupo.eventNome}
              </p>
              <div className="flex flex-wrap gap-3 mt-0.5">
                {grupo.eventData && (
                  <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                    <Calendar size={9} /> {fmtDate(grupo.eventData)}
                  </span>
                )}
                {grupo.eventLocal && (
                  <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1 truncate">
                    <MapPin size={9} /> {grupo.eventLocal}
                  </span>
                )}
              </div>
            </div>
            {grupo.eventSlug && (
              <button
                onClick={() => navigate(`/festival/${grupo.eventSlug}/inscrever`)}
                className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] flex items-center gap-1 shrink-0"
                title="Inscrever mais coreografias"
              >
                <Plus size={12} /> Nova inscrição
              </button>
            )}
          </div>

          {/* CTA agregado quando há pendentes */}
          {grupo.pendentes.length > 0 && (() => {
            // Se já tem fatura PENDENTE no Asaas, usa o valor dela. Senão, soma estimada.
            const total = grupo.payment?.value_total ?? grupo.totalPendente;
            const expiraDias = grupo.payment?.expires_at ? diasAte(grupo.payment.expires_at) : null;
            return (
              <div className="px-5 py-4 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                      Pagar todas
                    </p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5 tabular-nums">
                      {fmtMoney(total)}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                      {grupo.pendentes.length} coreografia{grupo.pendentes.length !== 1 ? 's' : ''} em 1 PIX
                      {expiraDias != null && expiraDias <= 7 && (
                        <span className="text-slate-500 ml-2">
                          · {expiraDias === 0 ? 'Vence hoje' : `Vence em ${expiraDias} dia${expiraDias !== 1 ? 's' : ''}`}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => handlePagarAgregado(grupo)}
                    disabled={payingEvent === grupo.eventId}
                    className="flex items-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-40 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 transition-all"
                  >
                    {payingEvent === grupo.eventId ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <ShoppingCart size={13} />
                    )}
                    Pagar tudo
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Lista de inscrições */}
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {[...grupo.pendentes, ...grupo.outras].map(reg => {
              const st = statusCfg(reg.status_pagamento);
              const isNova = reg.id === novaId;
              const isPendente = reg.status_pagamento === 'PENDENTE';
              const modalidade = reg.tipo_apresentacao ?? reg.formato_participacao ?? null;
              // Preço a mostrar: pagas usam valor_pago real; pendentes usam o
              // calculado client-side (_precoDisplay) com base na formação.
              const valorMostrar = isPendente
                ? reg._precoDisplay ?? null
                : (reg.valor_pago ?? reg.charged_amount ?? reg._precoDisplay ?? null);

              return (
                <div
                  key={reg.id}
                  className={`p-4 flex items-start gap-3 transition-colors ${isNova ? 'bg-slate-50 dark:bg-white/[0.02]' : ''}`}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-slate-100 dark:bg-white/5">
                    <Clapperboard size={14} className="text-slate-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                          {reg.nome_coreografia || 'Sem nome'}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {modalidade && (
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 text-slate-500 text-[8px] font-black uppercase tracking-widest rounded-full">{modalidade}</span>
                          )}
                          {reg.categoria && (
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 text-slate-500 text-[8px] font-black uppercase tracking-widest rounded-full">{reg.categoria}</span>
                          )}
                          {reg.estilo_danca && (
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-white/5 text-slate-500 text-[8px] font-black uppercase tracking-widest rounded-full">{reg.estilo_danca}</span>
                          )}
                        </div>
                      </div>

                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${st.bg} ${st.text} ${st.tone === 'ok' ? 'border-emerald-200 dark:border-emerald-500/20' : st.tone === 'pendente' ? 'border-amber-200 dark:border-amber-500/20' : 'border-slate-200 dark:border-white/10'}`}>
                        {st.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                      <div className="text-[10px] font-bold text-slate-500 flex items-center gap-3 tabular-nums">
                        {valorMostrar != null && (
                          <span>{fmtMoney(valorMostrar)}</span>
                        )}
                        {reg.paid_at && (
                          <span className="flex items-center gap-1 text-slate-400">
                            <Clock size={9} /> Pago em {fmtDate(reg.paid_at)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {st.tone === 'ok' && (
                          <button
                            onClick={() => navigate(`/credencial/${reg.id}`)}
                            className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                            title="Credencial (QR)"
                          >
                            <QrCode size={13} />
                          </button>
                        )}
                        {isPendente && (
                          <button
                            onClick={() => handlePagarSingle(reg)}
                            disabled={payingSingle === reg.id}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5 disabled:opacity-50 transition-all"
                            title="Pagar só esta inscrição"
                          >
                            {payingSingle === reg.id
                              ? <Loader2 size={11} className="animate-spin" />
                              : <CreditCard size={11} />}
                            Pagar só esta
                          </button>
                        )}
                        {isPendente && !reg.payment_group_id && (
                          <button
                            onClick={() => setConfirmDel(reg)}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                            title="Remover inscrição"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ── Aviso CPF faltando ── */}
      {registrations.length > 0 && totalPendentesGlobal > 0 && !profileCpf && (
        <div className="flex items-start gap-3 p-4 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
              CPF necessário pra pagar
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Pra gerar a fatura, complete seu CPF no perfil.
            </p>
            <button
              onClick={() => navigate('/meu-perfil')}
              className="mt-2 px-3 py-1.5 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-[9px] uppercase tracking-widest"
            >
              Completar perfil
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          DELETE CONFIRMATION
      ══════════════════════════════════════════════════════════ */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={18} className="text-rose-500" />
            </div>
            <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">
              Remover {confirmDel.nome_coreografia || 'inscrição'}?
            </h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDel(null)}
                disabled={deleting}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDel)}
                disabled={deleting}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <><Trash2 size={12} /> Remover</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MinhasCoreografias;

/**
 * Compat com import default — SystemErrorBanner inutilizado no novo layout
 * mas mantido pra evitar bug em outros lugares que façam side-imports.
 */
void SystemErrorBanner;
