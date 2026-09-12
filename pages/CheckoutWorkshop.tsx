/**
 * CheckoutWorkshop — Inscrição em workshop, guest checkout (sem login).
 *
 * Fluxo:
 *   /workshop/<idOrSlug> → click "Inscrever-se"
 *   /checkout-workshop/<id> ← AQUI
 *   form (nome+email+CPF+fone) + cupom + auto-detect combo via CPF
 *   → POST create-workshop-registration → redirect Asaas (ou direto pra voucher se GRATUITO)
 *   → comprador recebe email com link /meu-workshop/<token>
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import AsaasBadge from '../components/AsaasBadge';
import CheckoutLegalNotice from '../components/CheckoutLegalNotice';
import {
  Loader2, AlertCircle, ArrowLeft, ShieldCheck, User as UserIcon, Mail, Phone, FileText,
  Tag, X, Check, GraduationCap, Sparkles,
} from 'lucide-react';

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0);

// CPF mod-11
const isValidCpf = (cpf: string): boolean => {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(d[i]) * (10 - i);
  let c = 11 - (s % 11);
  if (c >= 10) c = 0;
  if (c !== parseInt(d[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(d[i]) * (11 - i);
  c = 11 - (s % 11);
  if (c >= 10) c = 0;
  return c === parseInt(d[10]);
};

const formatCpf = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};
const formatPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
};

const CheckoutWorkshop: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const discountToken = searchParams.get('discount_token');

  const [workshop, setWorkshop] = useState<any>(null);
  const [stock, setStock]       = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // Hospedagem (add-on, Frente 1 do Vicenza Dance Camp) — só relevante quando
  // o workshop tem hospedagem_delta configurado. Pool de vagas é por noite,
  // compartilhado entre todos os passes do mesmo evento.
  const [inclHospedagem, setInclHospedagem] = useState(false);
  const [roommatePreference, setRoommatePreference] = useState('');
  const [lodgingEsgotada, setLodgingEsgotada] = useState(false);
  // "Chegar um dia antes" / "sair um dia depois" — diária extra opcional na
  // ponta do período (Frente 4), preço fixo por pass, só some ao marcar
  // hospedagem.
  const [earlyArrival, setEarlyArrival] = useState(false);
  const [lateDeparture, setLateDeparture] = useState(false);

  // Day Pass — escolha de dia (Frente 2). Quando o workshop tem opções de
  // dia cadastradas, a escolha vira obrigatória (validado no submit e de
  // novo, atomicamente, na RPC).
  const [dayOptions, setDayOptions] = useState<Array<{ day_option_id: string; day_date: string; label: string | null; capacity_max: number | null; esgotado: boolean }>>([]);
  const [selectedDayOptionId, setSelectedDayOptionId] = useState('');

  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf]     = useState('');
  const [phone, setPhone] = useState('');
  const [paying, setPaying] = useState(false);
  // Mitigation #7: comprador precisa aceitar política de reembolso antes de pagar
  const [refundAccepted, setRefundAccepted] = useState(false);

  // Cupom
  const [couponInput, setCouponInput] = useState('');
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number; final_value: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  // Combo (auto-detect quando CPF válido + workshop tem event_id + auto_detect_combo)
  const [combo, setCombo] = useState<{ found: boolean; registration_id?: string; coreografia?: string; formato?: string; estudio?: string } | null>(null);
  const [comboLoading, setComboLoading] = useState(false);
  // Anti-fraude: combo só é detectado pra comprador logado (a edge function/RPC
  // exige user_id pra validar dono do CPF). userId === undefined = ainda checando.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  // Link de desconto por coreografia (canal sem CPF/login — coreógrafo
  // compartilha manualmente com as famílias via WhatsApp). ?discount_token=
  // na URL resolve a lista de bailarinos daquela inscrição; comprador escolhe
  // quem está se inscrevendo em vez de digitar CPF pra detectar combo.
  const [tokenInfo, setTokenInfo] = useState<{
    registrationId: string;
    coreografia: string;
    bailarinos: { id: string; nome: string }[];
  } | null | undefined>(discountToken ? undefined : null);
  const [selectedBailarinoId, setSelectedBailarinoId] = useState('');

  useEffect(() => {
    if (!discountToken || !workshop?.event_id) return;
    let active = true;
    (async () => {
      const { data, error: rpcErr } = await supabase.rpc('resolve_discount_token', { p_token: discountToken });
      if (!active) return;
      if (rpcErr || !data || data.length === 0) {
        setTokenInfo(null);
        return;
      }
      // Só vale pro mesmo evento do workshop — token de outro evento é noop.
      const rows = (data as any[]).filter(r => r.event_id === workshop.event_id);
      if (rows.length === 0) {
        setTokenInfo(null);
        return;
      }
      setTokenInfo({
        registrationId: rows[0].registration_id,
        coreografia: rows[0].nome_coreografia,
        bailarinos: rows.map(r => ({ id: r.bailarino_id, nome: r.bailarino_nome })),
      });
    })();
    return () => { active = false; };
  }, [discountToken, workshop?.event_id]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Hidrata workshop + stock
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const { data: ws, error: wsErr } = await supabase
          .from('workshops')
          .select('*')
          .eq('id', id)
          .eq('is_published', true)
          .maybeSingle();
        if (wsErr || !ws) { setError('Workshop não encontrado'); return; }

        if (new Date(ws.data_inicio).getTime() < Date.now()) {
          setError('Inscrições encerradas — workshop já começou');
          setWorkshop(ws);
          return;
        }

        setWorkshop(ws);

        const { data: st } = await supabase.rpc('get_workshop_stock', { p_workshop_id: id });
        const stRow = Array.isArray(st) ? st[0] : st;
        setStock(stRow);

        if (stRow?.active_lot_esgotado || stRow?.esgotado) {
          setError('Esgotado');
          return;
        }

        // Checa se alguma noite que esse pass cobre já está esgotada no pool
        // de hospedagem do evento — desabilita o toggle preventivamente (a
        // RPC de reserva é quem faz a checagem atômica de verdade no submit).
        if (ws.hospedagem_delta != null && Array.isArray(ws.hospedagem_noites) && ws.hospedagem_noites.length > 0 && ws.event_id) {
          const { data: lodgingStock } = await supabase.rpc('get_lodging_stock', { p_event_id: ws.event_id });
          const esgotada = (lodgingStock ?? []).some((r: any) => ws.hospedagem_noites.includes(r.night_date) && r.esgotado);
          setLodgingEsgotada(esgotada);
        }

        // Day Pass — carrega opções de dia (se houver). Sem nenhuma, o
        // workshop funciona normal (sem escolha exigida).
        const { data: dayStock } = await supabase.rpc('get_workshop_day_stock', { p_workshop_id: id });
        setDayOptions(dayStock ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Auto-detect combo quando CPF fica válido.
  // Audit T2: debounce 400ms pra não disparar a cada tecla.
  // Audit T1: chama via edge function (RPC foi REVOKE de anon — anti-enumeração CPF).
  useEffect(() => {
    // Fluxo de link por coreografia (discountToken) tem caminho próprio —
    // o estado `combo` é setado pela escolha do bailarino, não por CPF.
    if (discountToken) return;
    if (!workshop?.id || !workshop.event_id || !workshop.auto_detect_combo) {
      setCombo(null);
      return;
    }
    // Sem login não vale nem chamar a edge function — anti-fraude exige
    // comprador logado pra validar dono do CPF. userId === undefined ainda
    // está checando a sessão, espera resolver antes de decidir.
    if (userId === undefined) return;
    if (userId === null) {
      setCombo(null);
      return;
    }
    const clean = cpf.replace(/\D/g, '');
    if (!isValidCpf(clean)) {
      setCombo(null);
      return;
    }
    let active = true;
    const debounce = setTimeout(async () => {
      if (!active) return;
      setComboLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('detect-workshop-combo', {
          body: { workshop_id: workshop.id, cpf: clean },
        });
        if (!active) return;
        if (error) {
          setCombo({ found: false });
        } else if (data?.found) {
          setCombo({
            found: true,
            registration_id: data.registration_id,
            coreografia: data.coreografia,
            formato: data.formato_participacao,
            estudio: data.estudio,
          });
        } else {
          setCombo({ found: false });
        }
      } finally {
        if (active) setComboLoading(false);
      }
    }, 400);
    return () => { active = false; clearTimeout(debounce); };
  }, [cpf, workshop?.id, workshop?.event_id, workshop?.auto_detect_combo, userId, discountToken]);

  // Escolher um bailarino no fluxo de token já vale como combo encontrado —
  // reaproveita o mesmo `combo` state que alimenta o cálculo de preço.
  useEffect(() => {
    if (!discountToken || !tokenInfo) return;
    if (!selectedBailarinoId) {
      setCombo(null);
      return;
    }
    setCombo({ found: true, registration_id: tokenInfo.registrationId, coreografia: tokenInfo.coreografia });
  }, [discountToken, tokenInfo, selectedBailarinoId]);

  // Calcula preço
  const breakdown = useMemo(() => {
    if (!workshop) return null;
    const lotPreco       = stock?.active_lot_preco;
    const lotPrecoCombo  = stock?.active_lot_preco_combo;
    const wsPrecoCombo   = workshop.preco_inscritos_mostra;
    const precoBase = (lotPreco != null ? Number(lotPreco) : Number(workshop.preco_padrao));
    let precoAposCombo = precoBase;
    let comboApplied = false;
    if (combo?.found) {
      if (workshop.gratis_para_inscritos) {
        precoAposCombo = 0;
        comboApplied = true;
      } else if (lotPrecoCombo != null) {
        precoAposCombo = Number(lotPrecoCombo);
        comboApplied = true;
      } else if (wsPrecoCombo != null) {
        precoAposCombo = Number(wsPrecoCombo);
        comboApplied = true;
      }
    }
    let hospedagemDelta = inclHospedagem && workshop.hospedagem_delta != null ? Number(workshop.hospedagem_delta) : 0;
    if (inclHospedagem && earlyArrival && workshop.early_arrival_delta != null) hospedagemDelta += Number(workshop.early_arrival_delta);
    if (inclHospedagem && lateDeparture && workshop.late_departure_delta != null) hospedagemDelta += Number(workshop.late_departure_delta);
    const precoComHospedagem = precoAposCombo + hospedagemDelta;
    const discount = couponApplied ? Number(couponApplied.discount) : 0;
    const baseAfterCoupon = Math.max(0, Number((precoComHospedagem - discount).toFixed(2)));
    const commPct = Number(workshop.workshop_commission_percent ?? 10);
    const commission = Number((baseAfterCoupon * (commPct / 100)).toFixed(2));
    const feeMode = workshop.workshop_fee_mode ?? 'repassar';
    const charged = baseAfterCoupon === 0
      ? 0
      : feeMode === 'repassar' ? Number((baseAfterCoupon + commission).toFixed(2)) : baseAfterCoupon;
    return { precoBase, precoAposCombo, comboApplied, hospedagemDelta, discount, commission, feeMode, charged };
  }, [workshop, stock, combo, couponApplied, inclHospedagem, earlyArrival, lateDeparture]);

  const handleApplyCoupon = async () => {
    if (!workshop || couponLoading) return;
    const code = couponInput.trim();
    if (!code) return;
    setCouponError(null);
    setCouponLoading(true);
    try {
      const baseValue = (breakdown?.precoAposCombo ?? Number(workshop.preco_padrao)) + (breakdown?.hospedagemDelta ?? 0);
      if (baseValue === 0) {
        throw new Error('Combo grátis aplicado — cupom não é necessário');
      }
      const { data, error: rpcErr } = await supabase.rpc('validate_workshop_coupon', {
        p_workshop_id: workshop.id,
        p_code: code,
        p_base_value: baseValue,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.error_message) throw new Error(row?.error_message ?? 'Cupom inválido');
      setCouponApplied({ code: row.code, discount: row.discount, final_value: row.final_value });
    } catch (e: any) {
      setCouponError(e.message ?? 'Cupom inválido');
      setCouponApplied(null);
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponApplied(null);
    setCouponInput('');
    setCouponError(null);
  };

  const canSubmit = !!name.trim()
    && !!email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && isValidCpf(cpf)
    && !paying && !error && !comboLoading
    && (dayOptions.length === 0 || !!selectedDayOptionId)
    // tokenInfo fica `undefined` enquanto a RPC resolve_discount_token ainda
    // não respondeu — tratar como "sem token" deixaria o comprador submeter
    // antes do desconto carregar e perder o benefício silenciosamente.
    && (!discountToken || (tokenInfo !== undefined && (!tokenInfo || !!selectedBailarinoId)));

  const handlePay = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit || !workshop) return;
    setPaying(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: invokeErr } = await supabase.functions.invoke('create-workshop-registration', {
        body: {
          workshop_id: workshop.id,
          buyer: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            cpf: cpf.replace(/\D/g, ''),
            phone: phone.replace(/\D/g, '') || undefined,
          },
          user_id: user?.id,
          combo_opt_in: true,
          coupon_code: couponApplied?.code,
          inclui_hospedagem: inclHospedagem,
          roommate_preference: inclHospedagem ? (roommatePreference.trim() || undefined) : undefined,
          day_option_id: selectedDayOptionId || undefined,
          early_arrival: inclHospedagem && earlyArrival,
          late_departure: inclHospedagem && lateDeparture,
          ...(tokenInfo && selectedBailarinoId
            ? { discount_token: discountToken, bailarino_id: selectedBailarinoId }
            : {}),
        },
      });
      if (invokeErr) throw new Error(invokeErr.message ?? 'Erro ao criar inscrição');
      if (data?.error) throw new Error(data.error);

      // GRATUITO: vai direto pro voucher
      if (data?.status_pagamento === 'GRATUITO' && data?.access_token) {
        navigate(`/meu-workshop/${data.access_token}`);
        return;
      }

      // PENDENTE: redireciona pro Asaas
      if (data?.invoice_url) {
        window.location.href = data.invoice_url;
        return;
      }

      throw new Error('Resposta inesperada do servidor');
    } catch (err: any) {
      setError(err.message ?? String(err));
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#ff0068]" size={32} />
      </div>
    );
  }

  if (error && !workshop) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white/5 border border-rose-500/30 rounded-2xl p-6 text-center">
          <AlertCircle className="text-rose-400 mx-auto mb-3" size={32} />
          <p className="text-white font-bold mb-2">Não foi possível carregar</p>
          <p className="text-sm text-slate-400 mb-4">{error}</p>
          <button onClick={() => navigate(-1)} className="text-xs font-black text-[#ff0068] uppercase tracking-widest">← Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0b0f] text-white">
      {workshop?.cover_url && (
        <div className="relative h-32 md:h-48 overflow-hidden">
          <img src={workshop.cover_url} alt="" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0b0b0f]" />
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-6 -mt-8 relative">
        <button onClick={() => navigate(`/workshop/${workshop?.slug ?? workshop?.id}`)} className="inline-flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-[#ff0068] mb-6">
          <ArrowLeft size={14} /> Voltar pro workshop
        </button>

        <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-[#ff0068]/20 text-[#ff0068] px-2.5 py-1 rounded-full mb-2">
          <GraduationCap size={11} />Inscrição em workshop
        </div>
        <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase mb-1">{workshop.name}</h1>
        <p className="text-sm text-slate-400 mb-6">com {workshop.professor_name}</p>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 mb-4 text-sm text-rose-200 flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span className="font-bold">{error}</span>
          </div>
        )}

        <form onSubmit={handlePay} className="space-y-4">
          {/* Form */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
            <FieldLabel icon={UserIcon} label="Nome completo">
              <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Como vai aparecer no certificado" required />
            </FieldLabel>
            <FieldLabel icon={Mail} label="Email">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="voce@email.com" required />
            </FieldLabel>
            <FieldLabel icon={FileText} label="CPF">
              <input type="text" value={cpf} onChange={e => setCpf(formatCpf(e.target.value))} className={inputCls} placeholder="000.000.000-00" maxLength={14} required />
              {cpf.length === 14 && !isValidCpf(cpf) && (
                <p className="mt-1 text-[11px] text-rose-300">CPF inválido</p>
              )}
            </FieldLabel>
            <FieldLabel icon={Phone} label="Telefone (opcional)">
              <input type="tel" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} className={inputCls} placeholder="(00) 00000-0000" maxLength={15} />
            </FieldLabel>
          </div>

          {/* Day Pass — escolha de dia (obrigatória quando configurada) */}
          {dayOptions.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <FieldLabel icon={GraduationCap} label="Escolha o dia">
                <select
                  value={selectedDayOptionId}
                  onChange={e => setSelectedDayOptionId(e.target.value)}
                  className={`${inputCls} [color-scheme:dark]`}
                  required
                >
                  <option value="" style={{ backgroundColor: '#18181f', color: '#fff' }}>Selecione...</option>
                  {dayOptions.map(d => (
                    <option
                      key={d.day_option_id}
                      value={d.day_option_id}
                      disabled={d.esgotado}
                      style={{ backgroundColor: '#18181f', color: d.esgotado ? '#666' : '#fff' }}
                    >
                      {new Date(d.day_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                      {d.label ? ` — ${d.label}` : ''}
                      {d.esgotado ? ' (esgotado)' : ''}
                    </option>
                  ))}
                </select>
              </FieldLabel>
            </div>
          )}

          {/* Link de desconto por coreografia (?discount_token=) — seletor de
              bailarino substitui CPF/login pra detectar o combo. */}
          {discountToken && tokenInfo && (
            <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-3 space-y-2">
              <p className="text-sm font-bold text-violet-200 flex items-center gap-2">
                <Sparkles size={16} className="text-violet-400 shrink-0" />
                Desconto de inscrito — {tokenInfo.coreografia}
              </p>
              <FieldLabel icon={UserIcon} label="Quem está se inscrevendo?">
                <select
                  value={selectedBailarinoId}
                  onChange={e => setSelectedBailarinoId(e.target.value)}
                  className={`${inputCls} [color-scheme:dark]`}
                  required
                >
                  {/* [color-scheme:dark] no <select> não é suficiente em todo
                      browser/SO pra colorir a lista de opções aberta (Chrome
                      Windows ignora pro popup nativo) — estiliza cada <option>
                      explicitamente pra não ficar texto branco em fundo branco. */}
                  <option value="" style={{ backgroundColor: '#18181f', color: '#fff' }}>Selecione o bailarino</option>
                  {tokenInfo.bailarinos.map(b => (
                    <option key={b.id} value={b.id} style={{ backgroundColor: '#18181f', color: '#fff' }}>{b.nome}</option>
                  ))}
                </select>
              </FieldLabel>
            </div>
          )}
          {discountToken && tokenInfo === null && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-sm text-amber-200">
              Link de desconto inválido ou expirado — preço cheio será aplicado.
            </div>
          )}

          {/* Combo detection feedback */}
          {!discountToken && workshop.event_id && workshop.auto_detect_combo && (
            <>
              {userId === null && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-slate-300 flex items-start gap-2">
                  <Sparkles size={16} className="text-[#ff0068] mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold">Tem preço de inscrito?</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      <button type="button" onClick={() => navigate(`/login?redirectTo=${encodeURIComponent(`/checkout-workshop/${workshop.id}`)}`)} className="text-[#ff0068] font-bold underline">
                        Entre na sua conta
                      </button> para verificar se você tem o preço especial de inscrito da mostra.
                    </p>
                  </div>
                </div>
              )}
              {comboLoading && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-slate-400 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Verificando inscrição na mostra...
                </div>
              )}
              {!comboLoading && combo?.found && (
                <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-3 text-sm text-violet-200 flex items-start gap-2">
                  <Sparkles size={16} className="text-violet-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold">
                      {workshop.gratis_para_inscritos ? '🎉 Workshop grátis!' : '✨ Desconto de inscrito aplicado'}
                    </p>
                    <p className="text-xs opacity-80 mt-0.5">
                      Você está inscrito em <strong>{combo.coreografia}</strong>{combo.estudio ? ` (${combo.estudio})` : ''} na mostra deste festival.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Hospedagem (add-on) */}
          {workshop.hospedagem_delta != null && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inclHospedagem}
                  disabled={lodgingEsgotada}
                  onChange={e => setInclHospedagem(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#ff0068]"
                />
                <div>
                  <p className="text-sm font-bold text-white">
                    Incluir hospedagem <span className="text-[#ff0068]">+{formatBRL(Number(workshop.hospedagem_delta))}</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Hotel 4 estrelas, acomodação tripla compartilhada, café da manhã incluso.</p>
                  {lodgingEsgotada && (
                    <p className="text-xs text-rose-300 mt-1 font-bold">Vagas de hospedagem esgotadas pro período deste pass.</p>
                  )}
                </div>
              </label>
              {inclHospedagem && (
                <>
                  <FieldLabel icon={UserIcon} label="Prefere compartilhar o quarto com alguém? (opcional)">
                    <input
                      type="text"
                      value={roommatePreference}
                      onChange={e => setRoommatePreference(e.target.value)}
                      className={inputCls}
                      placeholder="Nome de quem você quer dividir o quarto"
                    />
                  </FieldLabel>
                  {workshop.early_arrival_delta != null && (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={earlyArrival}
                        onChange={e => setEarlyArrival(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[#ff0068]"
                      />
                      <p className="text-sm font-bold text-white">
                        Chegar um dia antes <span className="text-[#ff0068]">+{formatBRL(Number(workshop.early_arrival_delta))}</span>
                      </p>
                    </label>
                  )}
                  {workshop.late_departure_delta != null && (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lateDeparture}
                        onChange={e => setLateDeparture(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[#ff0068]"
                      />
                      <p className="text-sm font-bold text-white">
                        Sair um dia depois <span className="text-[#ff0068]">+{formatBRL(Number(workshop.late_departure_delta))}</span>
                      </p>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          {/* Cupom */}
          {breakdown && breakdown.precoAposCombo > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 inline-flex items-center gap-1.5">
                <Tag size={11} />Cupom
              </p>
              {couponApplied ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5 text-sm">
                    <Check size={14} className="text-emerald-400" />
                    <span className="font-bold text-emerald-200">{couponApplied.code}</span>
                    <span className="text-emerald-300">−{formatBRL(couponApplied.discount)}</span>
                  </div>
                  <button type="button" onClick={handleRemoveCoupon} className="text-slate-400 hover:text-rose-400"><X size={14} /></button>
                </div>
              ) : (
                <div className="flex items-stretch gap-2">
                  <input
                    value={couponInput}
                    onChange={e => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="Código"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    disabled={!couponInput.trim() || couponLoading}
                    onClick={handleApplyCoupon}
                    className="px-4 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                  >
                    {couponLoading ? <Loader2 size={14} className="animate-spin" /> : 'Aplicar'}
                  </button>
                </div>
              )}
              {couponError && <p className="mt-2 text-xs text-rose-300">{couponError}</p>}
            </div>
          )}

          {/* Resumo */}
          {breakdown && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-2">
              <Row label="Preço base" value={formatBRL(breakdown.precoBase)} />
              {breakdown.comboApplied && breakdown.precoAposCombo !== breakdown.precoBase && (
                <Row label="Desconto inscrito" value={`−${formatBRL(breakdown.precoBase - breakdown.precoAposCombo)}`} highlight="violet" />
              )}
              {breakdown.hospedagemDelta > 0 && (
                <Row label="Hospedagem" value={`+${formatBRL(breakdown.hospedagemDelta)}`} />
              )}
              {breakdown.discount > 0 && (
                <Row label="Cupom" value={`−${formatBRL(breakdown.discount)}`} highlight="emerald" />
              )}
              {breakdown.feeMode === 'repassar' && breakdown.commission > 0 && (
                <Row label="Taxa CoreoHub" value={formatBRL(breakdown.commission)} />
              )}
              <div className="border-t border-white/10 pt-2 flex items-center justify-between">
                <span className="text-sm font-black uppercase tracking-widest">Total</span>
                <span className="text-2xl font-black text-white">
                  {breakdown.charged === 0 ? 'Grátis' : formatBRL(breakdown.charged)}
                </span>
              </div>
            </div>
          )}

          {/* Bloco legal: política de reembolso (CDC art. 49) + recomendação PIX.
              Só obriga aceite em workshop pago — grátis não tem reembolso. */}
          {breakdown?.charged !== 0 && (
            <CheckoutLegalNotice
              accepted={refundAccepted}
              onAcceptedChange={setRefundAccepted}
              theme="dark"
            />
          )}

          <button
            type="submit"
            disabled={!canSubmit || (breakdown?.charged !== 0 && !refundAccepted)}
            title={
              comboLoading ? 'Verificando inscrição na mostra...'
                : breakdown?.charged !== 0 && !refundAccepted ? 'Aceite a política de reembolso para prosseguir'
                : undefined
            }
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff0068] px-4 py-3.5 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {(paying || comboLoading) && <Loader2 size={16} className="animate-spin" />}
            {comboLoading
              ? 'Verificando...'
              : breakdown?.charged === 0
                ? 'Confirmar inscrição grátis'
                : `Comprar · ${formatBRL(breakdown?.charged ?? 0)}`}
          </button>

          <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500 uppercase tracking-widest">
            <ShieldCheck size={11} /> Pagamento seguro Asaas · CoreoHub
          </div>

          {/* Selo BaaS Asaas — playbook pág. 3 exige em checkouts/páginas de venda */}
          <div className="flex justify-center pt-2">
            <AsaasBadge variant="compact" theme="negative" />
          </div>
        </form>
      </div>
    </div>
  );
};

const FieldLabel: React.FC<{ icon: any; label: string; children: React.ReactNode }> = ({ icon: Icon, label, children }) => (
  <label className="block">
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 inline-flex items-center gap-1.5">
      <Icon size={10} />{label}
    </span>
    {children}
  </label>
);

const Row: React.FC<{ label: string; value: string; highlight?: 'violet' | 'emerald' }> = ({ label, value, highlight }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-slate-400">{label}</span>
    <span className={`font-bold ${highlight === 'violet' ? 'text-violet-300' : highlight === 'emerald' ? 'text-emerald-300' : 'text-white'}`}>{value}</span>
  </div>
);

const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40';

export default CheckoutWorkshop;
