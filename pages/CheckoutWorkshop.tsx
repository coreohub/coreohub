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
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import AsaasBadge from '../components/AsaasBadge';
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

  const [workshop, setWorkshop] = useState<any>(null);
  const [stock, setStock]       = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf]     = useState('');
  const [phone, setPhone] = useState('');
  const [paying, setPaying] = useState(false);

  // Cupom
  const [couponInput, setCouponInput] = useState('');
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number; final_value: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  // Combo (auto-detect quando CPF válido + workshop tem event_id + auto_detect_combo)
  const [combo, setCombo] = useState<{ found: boolean; registration_id?: string; coreografia?: string; formato?: string; estudio?: string } | null>(null);
  const [comboLoading, setComboLoading] = useState(false);

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
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Auto-detect combo quando CPF fica válido.
  // Audit T2: debounce 400ms pra não disparar a cada tecla.
  // Audit T1: chama via edge function (RPC foi REVOKE de anon — anti-enumeração CPF).
  useEffect(() => {
    if (!workshop?.id || !workshop.event_id || !workshop.auto_detect_combo) {
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
  }, [cpf, workshop?.id, workshop?.event_id, workshop?.auto_detect_combo]);

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
    const discount = couponApplied ? Number(couponApplied.discount) : 0;
    const baseAfterCoupon = Math.max(0, Number((precoAposCombo - discount).toFixed(2)));
    const commPct = Number(workshop.workshop_commission_percent ?? 10);
    const commission = Number((baseAfterCoupon * (commPct / 100)).toFixed(2));
    const feeMode = workshop.workshop_fee_mode ?? 'repassar';
    const charged = baseAfterCoupon === 0
      ? 0
      : feeMode === 'repassar' ? Number((baseAfterCoupon + commission).toFixed(2)) : baseAfterCoupon;
    return { precoBase, precoAposCombo, comboApplied, discount, commission, feeMode, charged };
  }, [workshop, stock, combo, couponApplied]);

  const handleApplyCoupon = async () => {
    if (!workshop || couponLoading) return;
    const code = couponInput.trim();
    if (!code) return;
    setCouponError(null);
    setCouponLoading(true);
    try {
      const baseValue = breakdown?.precoAposCombo ?? Number(workshop.preco_padrao);
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
    && !paying && !error;

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

          {/* Combo detection feedback */}
          {workshop.event_id && workshop.auto_detect_combo && (
            <>
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

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff0068] px-4 py-3.5 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-[#ff0068]/30 hover:bg-[#ff1a78] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {paying && <Loader2 size={16} className="animate-spin" />}
            {breakdown?.charged === 0 ? 'Confirmar inscrição grátis' : 'Continuar pro pagamento'}
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
