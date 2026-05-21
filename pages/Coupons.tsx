import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import {
  listCouponsByEvent, createCoupon, updateCoupon, deleteCoupon,
} from '../services/couponService';
import type { Coupon } from '../types';
import {
  Ticket, Plus, Trash2, Calendar, Users, Percent,
  Loader2, X, AlertCircle, CheckCircle, Power, DollarSign, Pencil,
} from 'lucide-react';
import EventPickerSheet from '../components/EventPickerSheet';

type DiscountType = 'percent' | 'fixed';

interface EventOption { id: string; name: string; }

const Coupons: React.FC = () => {
  const [events, setEvents]               = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [coupons, setCoupons]             = useState<Coupon[]>([]);
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [showModal, setShowModal]         = useState(false);
  const [editingId, setEditingId]         = useState<string | null>(null);

  // Scope no banco: 6 valores possíveis (mora em types.ts/Coupon.scope).
  // UI usa multi-select de 4 setores (Inscrição/Plateia/Workshop/Seletiva)
  // e MAPEIA pras combinações válidas do banco atual no save:
  //   1 setor → valor direto
  //   inscription + audience → 'both'
  //   todos os 4 → 'all'
  //   outras combinações → erro (migration de array fica como backlog)
  type Scope = 'inscription' | 'audience' | 'workshop' | 'video_selection' | 'both' | 'all';
  type SetorAtomic = 'inscription' | 'audience' | 'workshop' | 'video_selection';

  /** Decompõe scope do banco em set de setores atômicos. */
  const scopeToSetores = (scope?: string | null): SetorAtomic[] => {
    if (!scope) return ['inscription'];
    if (scope === 'both') return ['inscription', 'audience'];
    if (scope === 'all')  return ['inscription', 'audience', 'workshop', 'video_selection'];
    return [scope as SetorAtomic];
  };

  /** Mapeia set de setores pro valor único do banco. Retorna null se combinação
   *  não é suportada pelo enum atual. */
  const setoresToScope = (setores: SetorAtomic[]): Scope | null => {
    const set = new Set(setores);
    if (set.size === 0) return null;
    if (set.size === 1) return setores[0] as Scope;
    if (set.size === 4) return 'all';
    if (set.size === 2 && set.has('inscription') && set.has('audience')) return 'both';
    return null; // combinação não suportada
  };

  const emptyForm = {
    code:           '',
    discount_type:  'percent' as DiscountType,
    discount_value: 10,
    max_uses:       '' as string | number,
    expires_at:     '',
    setores:        ['inscription'] as SetorAtomic[],
  };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const toggleSetor = (s: SetorAtomic) => {
    setForm(f => {
      const has = f.setores.includes(s);
      return { ...f, setores: has ? f.setores.filter(x => x !== s) : [...f.setores, s] };
    });
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (c: Coupon) => {
    setEditingId(c.id);
    setForm({
      code:           c.code,
      discount_type:  c.discount_type,
      discount_value: c.discount_value,
      max_uses:       c.max_uses ?? '',
      expires_at:     c.expires_at ?? '',
      setores:        scopeToSetores(c.scope),
    });
    setFormError(null);
    setShowModal(true);
  };

  /* ── carrega eventos do produtor ── */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('events')
        .select('id, name, is_demo')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setEvents(data);
        // Prioriza evento demo no default (alinhado com DemoBanner).
        const demo = data.find(e => (e as any).is_demo);
        setSelectedEventId(prev => prev ?? (demo?.id ?? data[0].id));
      } else {
        setLoading(false);
      }
    })();
  }, []);

  /* ── carrega cupons do evento selecionado ── */
  const refresh = useCallback(async () => {
    if (!selectedEventId) return;
    setLoading(true);
    try {
      const list = await listCouponsByEvent(selectedEventId);
      setCoupons(list);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSave = async () => {
    setFormError(null);
    if (!selectedEventId) return;
    if (!form.code.trim()) { setFormError('Informe o código do cupom.'); return; }
    if (form.discount_value <= 0) { setFormError('Valor do desconto deve ser maior que zero.'); return; }
    if (form.discount_type === 'percent' && form.discount_value > 100) {
      setFormError('Percentual não pode ser maior que 100%.');
      return;
    }
    // Mapeia setores selecionados pro scope único do banco. Combinações não
    // suportadas pelo enum atual bloqueiam o salvar com mensagem clara.
    const scopeMapped = setoresToScope(form.setores);
    if (!scopeMapped) {
      if (form.setores.length === 0) {
        setFormError('Selecione ao menos um setor onde o cupom se aplica.');
      } else {
        setFormError('Combinação atual não suportada. Selecione: 1 setor, Inscrição + Plateia, ou os 4 setores juntos.');
      }
      return;
    }
    // Cupom 100% off não funciona pra plateia (Asaas exige valor > 0).
    // Inscrição também é problemática mas existe fluxo gratuito separado.
    if (form.discount_type === 'percent' && form.discount_value === 100 && scopeMapped !== 'inscription') {
      setFormError('Cupom 100% off não é suportado em ingressos de plateia (Asaas exige cobrança > 0). Use desconto parcial ou crie cortesia direta.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateCoupon(editingId, {
          code:           form.code.trim().toUpperCase(),
          discount_type:  form.discount_type,
          discount_value: form.discount_value,
          max_uses:       form.max_uses === '' ? null : Number(form.max_uses),
          expires_at:     form.expires_at || null,
          scope:          scopeMapped,
        });
      } else {
        await createCoupon({
          event_id:       selectedEventId,
          code:           form.code,
          discount_type:  form.discount_type,
          discount_value: form.discount_value,
          max_uses:       form.max_uses === '' ? null : Number(form.max_uses),
          expires_at:     form.expires_at || null,
          scope:          scopeMapped,
        });
      }
      setShowModal(false);
      setEditingId(null);
      setForm(emptyForm);
      await refresh();
    } catch (e: any) {
      setFormError(
        e.message?.includes('duplicate') || e.code === '23505'
          ? 'Já existe um cupom com esse código neste evento.'
          : e.message
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (coupon: Coupon) => {
    await updateCoupon(coupon.id, { is_active: !coupon.is_active });
    await refresh();
  };

  const handleDelete = async (coupon: Coupon) => {
    if (!confirm(`Excluir o cupom "${coupon.code}"?`)) return;
    await deleteCoupon(coupon.id);
    await refresh();
  };

  const fmtDiscount = (c: Coupon) =>
    c.discount_type === 'percent' ? `${c.discount_value}%` : `R$ ${c.discount_value.toFixed(2)}`;

  const isExhausted = (c: Coupon) => c.max_uses != null && c.used_count >= c.max_uses;
  const isExpired   = (c: Coupon) =>
    c.expires_at ? new Date(c.expires_at + 'T23:59:59').getTime() < Date.now() : false;

  const statusOf = (c: Coupon) => {
    if (!c.is_active)   return { label: 'Inativo',   cls: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400' };
    if (isExhausted(c)) return { label: 'Esgotado',  cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400' };
    if (isExpired(c))   return { label: 'Expirado',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' };
    return               { label: 'Ativo',     cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' };
  };

  const totalActive = coupons.filter(c => c.is_active && !isExhausted(c) && !isExpired(c)).length;
  const totalUses   = coupons.reduce((s, c) => s + c.used_count, 0);

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-1.5 bg-[#ff0068] rounded-full animate-pulse shadow-[0_0_8px_#ff0068]" />
            <span className="text-[9px] font-black text-[#ff0068] uppercase tracking-[0.3em]">Promoções</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase text-slate-900 dark:text-white">
            Cupons de <span className="text-[#ff0068]">Desconto</span>
          </h1>
          <p className="text-xs text-slate-500 font-bold mt-1">
            Crie códigos promocionais para incentivar inscrições antecipadas ou recuperar leads.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 sm:shrink-0">
          {events.length > 0 && (
            <EventPickerSheet
              events={events}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
              className="w-full sm:w-auto"
            />
          )}
          <button
            disabled={!selectedEventId}
            onClick={openCreate}
            className="flex items-center justify-center gap-2 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-xl shadow-[#ff0068]/20"
          >
            <Plus size={16} /> Novo Cupom
          </button>
        </div>
      </div>

      {/* Stats — 3 colunas em mobile compactas (padrão Stripe/Mercado Pago).
          Antes 1 coluna mobile inflava verticalmente sem necessidade. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <StatCard icon={Ticket}  label="Cupons Ativos"   value={totalActive} />
        <StatCard icon={Users}   label="Total de Usos"   value={totalUses}   />
        <StatCard icon={Percent} label="Cupons Criados"  value={coupons.length} />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-[#ff0068]" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
          <AlertCircle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-200 dark:border-white/10 rounded-3xl">
          <Ticket size={40} className="text-slate-300 dark:text-white/20 mx-auto mb-3" />
          <p className="font-black text-sm text-slate-600 dark:text-white uppercase">Nenhum cupom criado</p>
          <p className="text-xs text-slate-500 mt-1">Clique em "Novo Cupom" para começar.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-white/5 text-left text-slate-500 text-[9px] font-black uppercase tracking-widest border-b border-slate-100 dark:border-white/5">
                <th className="px-4 sm:px-6 py-4">Código</th>
                <th className="px-4 sm:px-6 py-4">Desconto</th>
                <th className="px-4 sm:px-6 py-4 hidden md:table-cell">Uso / Limite</th>
                <th className="px-4 sm:px-6 py-4 hidden lg:table-cell">Expira</th>
                <th className="px-4 sm:px-6 py-4">Status</th>
                <th className="px-4 sm:px-6 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {coupons.map(c => {
                const s = statusOf(c);
                return (
                  <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 sm:px-6 py-4">
                      <span className="font-mono font-bold text-sm text-slate-900 dark:text-white bg-slate-100 dark:bg-white/10 px-3 py-1 rounded-lg border border-slate-200 dark:border-white/10">
                        {c.code}
                      </span>
                      {c.scope && c.scope !== 'inscription' && (() => {
                        const scopeLabels: Record<string, { label: string; cls: string }> = {
                          audience:        { label: 'Plateia',  cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400' },
                          workshop:        { label: 'Workshop', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
                          video_selection: { label: 'Seletiva', cls: 'bg-pink-100 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400' },
                          both:            { label: 'Insc+Plateia', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
                          all:             { label: 'Todos',    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
                        };
                        const meta = scopeLabels[c.scope];
                        if (!meta) return null;
                        return (
                          <span className={`ml-2 inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${meta.cls}`}>
                            {meta.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 sm:px-6 py-4 font-black text-[#ff0068]">{fmtDiscount(c)}</td>
                    <td className="px-4 sm:px-6 py-4 hidden md:table-cell">
                      {c.max_uses != null ? (
                        <div className="flex items-center gap-3">
                          <div className="flex-1 max-w-[100px] h-2 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-[#ff0068]" style={{ width: `${Math.min(100, (c.used_count / c.max_uses) * 100)}%` }} />
                          </div>
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{c.used_count}/{c.max_uses}</span>
                        </div>
                      ) : (
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{c.used_count} usos · ilimitado</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-xs text-slate-600 dark:text-slate-400 hidden lg:table-cell">
                      {c.expires_at ? (
                        <span className="flex items-center gap-2">
                          <Calendar size={12} className="text-slate-400" />
                          {new Date(c.expires_at + 'T12:00').toLocaleDateString('pt-BR')}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${s.cls}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(c)}
                          title="Editar"
                          className="p-2 rounded-lg text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 transition-colors"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleToggle(c)}
                          title={c.is_active ? 'Desativar' : 'Ativar'}
                          className={`p-2 rounded-lg transition-colors ${
                            c.is_active
                              ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
                              : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                          }`}
                        >
                          <Power size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          title="Excluir"
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal criar — z-[60] cobre o BottomNavBar (z-50) MAS Chrome mobile
          ainda renderizava o nav por cima em alguns devices (issue confirmado
          em 2026-05-21). Fix definitivo: pb-16 sm:pb-0 deixa 64px de margem
          no rodape em mobile = altura do BottomNav. Footer do modal sempre
          fica acima do nav, sem depender de z-stacking. */}
      {showModal && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center pb-16 sm:pb-0 sm:p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => { setShowModal(false); setEditingId(null); setFormError(null); }}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[92dvh] sm:max-h-[90dvh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
              <div className="min-w-0">
                <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white">{editingId ? 'Editar Cupom' : 'Novo Cupom'}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{editingId ? 'Mude valores, escopo ou limites.' : 'Código, desconto e limites opcionais.'}</p>
              </div>
              <button onClick={() => { setShowModal(false); setEditingId(null); setFormError(null); }} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 sm:px-6 py-5 flex-1">
              <Field label="Código do Cupom">
                <input
                  type="text"
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="EX: DANCE20"
                  className="w-full font-mono font-bold bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50 uppercase"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo">
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl">
                    <button
                      onClick={() => setForm(f => ({ ...f, discount_type: 'percent' }))}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        form.discount_type === 'percent' ? 'bg-[#ff0068] text-white' : 'text-slate-500'
                      }`}
                    >
                      <Percent size={12} /> %
                    </button>
                    <button
                      onClick={() => setForm(f => ({ ...f, discount_type: 'fixed' }))}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        form.discount_type === 'fixed' ? 'bg-[#ff0068] text-white' : 'text-slate-500'
                      }`}
                    >
                      <DollarSign size={12} /> R$
                    </button>
                  </div>
                </Field>

                <Field label={form.discount_type === 'percent' ? 'Percentual (%)' : 'Valor (R$)'}>
                  <input
                    type="number"
                    min={0}
                    max={form.discount_type === 'percent' ? 100 : undefined}
                    step={form.discount_type === 'percent' ? 1 : 0.01}
                    value={form.discount_value}
                    onChange={e => {
                      // Clamp pra 0-100 quando %. O atributo max= só limita o spinner
                      // do browser; digitação livre ainda passava (bug em prod).
                      const raw = Number(e.target.value);
                      if (form.discount_type === 'percent') {
                        setForm(f => ({ ...f, discount_value: Math.max(0, Math.min(100, raw)) }));
                      } else {
                        setForm(f => ({ ...f, discount_value: Math.max(0, raw) }));
                      }
                    }}
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Limite de usos (opcional)">
                  <input
                    type="number"
                    min={1}
                    value={form.max_uses}
                    onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))}
                    placeholder="Ilimitado"
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]/50"
                  />
                </Field>
                <Field label="Expira em (opcional)">
                  <input
                    type="date"
                    value={form.expires_at}
                    onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50"
                  />
                </Field>
              </div>

              {/* Scope selector — multi-select via checkboxes. Produtor escolhe
                  em quais setores o cupom vale. Combinações suportadas mapeiam
                  pros valores enum do banco (1 setor / Insc+Plateia / Todos).
                  Outras combinações bloqueiam o salvar com mensagem clara. */}
              <Field label="Aplica em">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: 'inscription',     label: 'Inscrição',  hint: 'Taxa da coreografia' },
                    { v: 'audience',        label: 'Plateia',    hint: 'Ingressos do público' },
                    { v: 'workshop',        label: 'Workshop',   hint: 'Taxa de workshop' },
                    { v: 'video_selection', label: 'Seletiva',   hint: 'Taxa de seletiva de vídeo' },
                  ] as const).map(o => {
                    const checked = form.setores.includes(o.v);
                    return (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => toggleSetor(o.v)}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border transition-all text-left ${
                          checked
                            ? 'border-[#ff0068] bg-[#ff0068]/5'
                            : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                          checked
                            ? 'border-[#ff0068] bg-[#ff0068]'
                            : 'border-slate-300 dark:border-white/20'
                        }`}>
                          {checked && <CheckCircle size={10} className="text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[11px] font-black uppercase tracking-widest ${
                            checked ? 'text-[#ff0068]' : 'text-slate-900 dark:text-white'
                          }`}>
                            {o.label}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                            {o.hint}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                  Marque os setores onde o cupom deve valer. Combinações suportadas: 1 setor, Inscrição + Plateia, ou os 4 juntos.
                </p>
              </Field>

              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
                </div>
              )}
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-white/10 shrink-0 bg-white dark:bg-slate-900">
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#ff0068] hover:bg-[#e0005c] disabled:opacity-50 text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <><CheckCircle size={16} /> {editingId ? 'Salvar alterações' : 'Criar Cupom'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">{label}</label>
    {children}
  </div>
);

const StatCard: React.FC<{ icon: any; label: string; value: number }> = ({ icon: Icon, label, value }) => {
  return (
    <div className="bg-white dark:bg-white/5 p-3 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-white/5">
      <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-[#ff0068]/10 text-[#ff0068] border border-[#ff0068]/20 flex items-center justify-center mb-2 sm:mb-3">
        <Icon size={14} className="sm:hidden" />
        <Icon size={18} className="hidden sm:block" />
      </div>
      <h3 className="text-slate-500 text-[8px] font-black uppercase tracking-[0.15em] sm:tracking-[0.2em] truncate">{label}</h3>
      <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tighter">{value}</p>
    </div>
  );
};

export default Coupons;
