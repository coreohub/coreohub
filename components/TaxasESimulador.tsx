import React, { useEffect, useMemo, useState } from 'react';
import { Receipt, Loader2, CheckCircle2, AlertCircle, Calculator } from 'lucide-react';
import { supabase } from '../services/supabase';
import { computeInscricaoCheckout, inscricaoLineApplies, normalizeInscricaoMode, type InscricaoProcessingMode } from '../supabase/functions/_shared/inscricao-checkout';
import { computeWorkshopCheckout } from '../supabase/functions/_shared/workshop-checkout';
import { computeAudienceCheckout } from '../supabase/functions/_shared/audience-checkout';
import { round2, type PaymentMethod } from '../supabase/functions/_shared/processing-fee';

type Payer = 'comprador' | 'produtor';
type SimProduct = 'inscricao' | 'ingresso' | 'workshop' | 'passe';

interface EventInfo {
  billing_plan: string | null;
  processing_fee_enabled: boolean;
  inscricao_processing_mode: string | null;
  audience_processing_payer: string | null;
  commission_percent: number | null;
  fee_mode: string | null;
  state: string | null;
}
interface PayerRow { id: string; name: string; processing_payer: string | null }

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const MODES: { value: InscricaoProcessingMode; title: string; desc: string }[] = [
  { value: 'pix_fechado_cartao_taxa', title: 'Pix sem taxa, cartão com taxa (padrão)', desc: 'No Pix o inscrito paga só o valor da inscrição. No cartão ele paga a taxa de pagamento, que cobre o custo do cartão.' },
  { value: 'taxa_todas', title: 'Taxa em todos os pagamentos', desc: 'O inscrito paga a taxa de pagamento tanto no Pix quanto no cartão.' },
  { value: 'fechado_total', title: 'Preço fechado', desc: 'O inscrito nunca vê a taxa. No cartão, o custo real do cartão sai do seu repasse e é somado à comissão da CoreoHub.' },
];

const PAYER_LABEL: Record<Payer, string> = { comprador: 'Comprador paga', produtor: 'Eu pago' };

const PayerToggle: React.FC<{ value: Payer; disabled?: boolean; onChange: (p: Payer) => void }> = ({ value, disabled, onChange }) => (
  <div className="inline-flex rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden shrink-0">
    {(['comprador', 'produtor'] as Payer[]).map(p => (
      <button
        key={p}
        type="button"
        disabled={disabled}
        onClick={() => value !== p && onChange(p)}
        className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
          value === p ? 'bg-[#ff0068] text-white' : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10'
        }`}
      >
        {PAYER_LABEL[p]}
      </button>
    ))}
  </div>
);

const TaxasESimulador: React.FC<{ eventId: string | null }> = ({ eventId }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ev, setEv] = useState<EventInfo | null>(null);
  const [workshops, setWorkshops] = useState<PayerRow[]>([]);
  const [passes, setPasses] = useState<PayerRow[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Simulador
  const [simProduct, setSimProduct] = useState<SimProduct>('inscricao');
  const [simPrice, setSimPrice] = useState('100');
  const [simMethod, setSimMethod] = useState<PaymentMethod>('pix');
  const [simPayer, setSimPayer] = useState<Payer>('comprador');

  useEffect(() => {
    if (!eventId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const [evRes, wsRes, psRes] = await Promise.all([
        supabase.from('events')
          .select('billing_plan, processing_fee_enabled, inscricao_processing_mode, audience_processing_payer, commission_percent, fee_mode, state')
          .eq('id', eventId).maybeSingle(),
        supabase.from('workshops').select('id, name, processing_payer').eq('event_id', eventId).order('created_at'),
        supabase.from('workshop_passes').select('id, name, processing_payer').eq('event_id', eventId).order('created_at'),
      ]);
      if (cancelled) return;
      const err = evRes.error ?? wsRes.error ?? psRes.error;
      if (err) {
        console.error('[TaxasESimulador] erro ao carregar:', err.message);
        setLoadError('Não foi possível carregar as taxas deste evento.');
      }
      setEv((evRes.data as EventInfo | null) ?? null);
      setWorkshops((wsRes.data as PayerRow[] | null) ?? []);
      setPasses((psRes.data as PayerRow[] | null) ?? []);
      setSimPayer(((evRes.data as EventInfo | null)?.audience_processing_payer as Payer) === 'produtor' ? 'produtor' : 'comprador');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const planEligible = ev ? inscricaoLineApplies(ev.billing_plan, true) : false;
  const mode = normalizeInscricaoMode(ev?.inscricao_processing_mode);

  const persist = async (key: string, table: 'events' | 'workshops' | 'workshop_passes', id: string, patch: Record<string, string>, apply: () => void) => {
    setSavingKey(key);
    setSaveMsg(null);
    const { data, error } = await supabase.from(table).update(patch).eq('id', id).select('id');
    setSavingKey(null);
    if (error || !data || data.length === 0) {
      console.error('[TaxasESimulador] erro ao salvar:', error?.message ?? 'nenhuma linha atualizada');
      setSaveMsg({ ok: false, text: 'Não foi possível salvar. Tente de novo.' });
      return;
    }
    apply();
    setSaveMsg({ ok: true, text: 'Salvo. Vale para as próximas compras.' });
  };

  const sim = useMemo(() => {
    if (!ev) return null;
    const price = round2(Number(simPrice.replace(',', '.')));
    if (!(price > 0)) return null;
    const pct = Number(ev.commission_percent ?? 10);
    const feeMode = String(ev.fee_mode ?? 'repassar');
    const repassar = feeMode === 'repassar';
    try {
      if (simProduct === 'inscricao') {
        const commission = round2(price * pct / 100);
        const r = computeInscricaoCheckout({
          items: [{ baseFee: price, charged: repassar ? round2(price + commission) : price, producer: repassar ? price : round2(price - commission), commission }],
          billingPlan: ev.billing_plan, mode, processingFeeEnabled: true, feeMode, method: simMethod, uf: ev.state,
        });
        return { total: r.chargedTotal, fee: r.processingFee, producerPaid: r.producerPaidFee, producer: r.producerTotal, commission: r.commissionTotal, warnings: r.warnings, noLine: !planEligible };
      }
      if (simProduct === 'ingresso') {
        const r = computeAudienceCheckout({
          resolved: [{ idx: 0, nome: 'Ingresso', kind: 'inteira', quantity: 1, precoUnit: price, quantidadeTotal: null }],
          totalBase: price, discountTotal: 0, commissionPercent: pct, feeMode, processingFeeEnabled: true,
          payer: simPayer, method: simMethod, uf: ev.state,
        });
        return { total: r.chargedTotal, fee: r.processingFee, producerPaid: r.producerPaidFee, producer: r.producerTotal, commission: r.commissionTotal, warnings: r.warnings, noLine: false };
      }
      const r = computeWorkshopCheckout({
        product: simProduct, itemShares: [price], commissionPercent: pct, feeMode, processingFeeEnabled: true,
        payer: simPayer, method: simMethod, uf: ev.state,
      });
      return { total: r.chargedTotal, fee: r.processingFee, producerPaid: r.producerPaidFee, producer: r.producerTotal, commission: r.commissionTotal, warnings: r.warnings, noLine: false };
    } catch (e: any) {
      console.error('[TaxasESimulador] simulação:', e?.message ?? e);
      return null;
    }
  }, [ev, simProduct, simPrice, simMethod, simPayer, mode, planEligible]);

  const card = 'bg-white shadow-sm dark:bg-white/5 dark:shadow-none border border-slate-200 dark:border-white/10 rounded-3xl overflow-hidden';
  const label = 'text-[10px] font-black uppercase tracking-widest text-slate-500';

  return (
    <div className={card}>
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-white/8">
        <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Receipt size={16} /></div>
        <div>
          <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight italic">Taxas e simulador</p>
          <p className="text-xs text-slate-500 mt-0.5">Defina quem paga a taxa de pagamento em cada produto e simule o resultado.</p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Carregando taxas do evento...</div>
        )}
        {!loading && !eventId && (
          <p className="text-xs text-slate-500">Crie ou selecione um evento para configurar as taxas.</p>
        )}
        {!loading && loadError && (
          <div className="flex items-center gap-2 p-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 text-xs text-rose-700 dark:text-rose-400"><AlertCircle size={14} /> {loadError}</div>
        )}

        {!loading && ev && (
          <>
            {!ev.processing_fee_enabled && (
              <div className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                <AlertCircle size={16} className="text-slate-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  A taxa de pagamento está <strong>desativada neste evento</strong>: hoje todas as vendas saem com o preço fechado, sem linha extra para o comprador. As escolhas abaixo ficam salvas e passam a valer quando a CoreoHub ativar a taxa neste evento. O simulador mostra como ficaria.
                </p>
              </div>
            )}

            {/* Inscrições */}
            <div className="space-y-3">
              <p className={label}>Inscrições e taxa de seletiva</p>
              {!planEligible ? (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  No plano {ev.billing_plan ?? 'Começo'} o preço da inscrição é fechado: o inscrito nunca paga taxa de pagamento. A escolha de modo vale para os planos Essencial e Escala.
                </p>
              ) : (
                <div className="grid gap-2">
                  {MODES.map(m => (
                    <button
                      key={m.value}
                      type="button"
                      disabled={savingKey === 'mode'}
                      onClick={() => mode !== m.value && persist('mode', 'events', eventId!, { inscricao_processing_mode: m.value }, () => setEv(e => e ? { ...e, inscricao_processing_mode: m.value } : e))}
                      className={`text-left p-4 rounded-2xl border-2 transition-all disabled:opacity-60 ${
                        mode === m.value ? 'border-[#ff0068] bg-[#ff0068]/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <p className="text-sm font-black text-slate-900 dark:text-white">{m.title}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">{m.desc}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quem paga: ingressos */}
            <div className="space-y-3">
              <p className={label}>Ingressos de plateia</p>
              <div className="flex items-center justify-between gap-3 flex-wrap p-4 rounded-2xl border border-slate-200 dark:border-white/10">
                <p className="text-xs text-slate-700 dark:text-slate-300">Quem paga a taxa de pagamento dos ingressos</p>
                <PayerToggle
                  value={ev.audience_processing_payer === 'produtor' ? 'produtor' : 'comprador'}
                  disabled={savingKey === 'audience'}
                  onChange={p => persist('audience', 'events', eventId!, { audience_processing_payer: p }, () => setEv(e => e ? { ...e, audience_processing_payer: p } : e))}
                />
              </div>
            </div>

            {/* Workshops */}
            <div className="space-y-3">
              <p className={label}>Workshops</p>
              {workshops.length === 0 && <p className="text-xs text-slate-500">Nenhum workshop neste evento ainda.</p>}
              {workshops.map(w => (
                <div key={w.id} className="flex items-center justify-between gap-3 flex-wrap p-4 rounded-2xl border border-slate-200 dark:border-white/10">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 min-w-0 truncate">{w.name}</p>
                  <PayerToggle
                    value={w.processing_payer === 'produtor' ? 'produtor' : 'comprador'}
                    disabled={savingKey === `w:${w.id}`}
                    onChange={p => persist(`w:${w.id}`, 'workshops', w.id, { processing_payer: p }, () => setWorkshops(l => l.map(x => x.id === w.id ? { ...x, processing_payer: p } : x)))}
                  />
                </div>
              ))}
            </div>

            {/* Passes */}
            <div className="space-y-3">
              <p className={label}>Passes de workshop</p>
              {passes.length === 0 && <p className="text-xs text-slate-500">Nenhum passe neste evento ainda.</p>}
              {passes.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 flex-wrap p-4 rounded-2xl border border-slate-200 dark:border-white/10">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 min-w-0 truncate">{p.name}</p>
                  <PayerToggle
                    value={p.processing_payer === 'produtor' ? 'produtor' : 'comprador'}
                    disabled={savingKey === `p:${p.id}`}
                    onChange={v => persist(`p:${p.id}`, 'workshop_passes', p.id, { processing_payer: v }, () => setPasses(l => l.map(x => x.id === p.id ? { ...x, processing_payer: v } : x)))}
                  />
                </div>
              ))}
            </div>

            {saveMsg && (
              <div className={`flex items-center gap-2 p-3 rounded-2xl border text-xs ${
                saveMsg.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' : 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400'
              }`}>
                {saveMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {saveMsg.text}
              </div>
            )}

            {/* Simulador */}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-white/8">
              <p className={`${label} flex items-center gap-2 pt-4`}><Calculator size={12} /> Simulador</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <label className="space-y-1">
                  <span className={label}>Produto</span>
                  <select value={simProduct} onChange={e => setSimProduct(e.target.value as SimProduct)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-bold text-slate-900 dark:text-white">
                    <option value="inscricao">Inscrição</option>
                    <option value="ingresso">Ingresso</option>
                    <option value="workshop">Workshop</option>
                    <option value="passe">Passe</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={label}>Preço (R$)</span>
                  <input value={simPrice} inputMode="decimal" onChange={e => setSimPrice(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-bold text-slate-900 dark:text-white" />
                </label>
                <label className="space-y-1">
                  <span className={label}>Forma</span>
                  <select value={simMethod} onChange={e => setSimMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-bold text-slate-900 dark:text-white">
                    <option value="pix">Pix</option>
                    <option value="card">Cartão (à vista)</option>
                  </select>
                </label>
                {simProduct !== 'inscricao' && (
                  <label className="space-y-1">
                    <span className={label}>Quem paga</span>
                    <select value={simPayer} onChange={e => setSimPayer(e.target.value as Payer)}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-xs font-bold text-slate-900 dark:text-white">
                      <option value="comprador">Comprador</option>
                      <option value="produtor">Eu (produtor)</option>
                    </select>
                  </label>
                )}
              </div>

              {!sim ? (
                <p className="text-xs text-slate-500">Informe um preço maior que zero para simular.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                    <p className={label}>O comprador paga</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{brl(sim.total)}</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                      {sim.fee > 0 ? `Inclui taxa de pagamento de ${brl(sim.fee)}` : 'Sem taxa de pagamento para o comprador'}
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                    <p className={label}>Você recebe</p>
                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{brl(sim.producer)}</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                      Comissão da CoreoHub {brl(sim.commission)}
                      {sim.producerPaid > 0 ? `, já com ${brl(sim.producerPaid)} de custo de pagamento` : ''}
                    </p>
                  </div>
                </div>
              )}
              {sim?.noLine && (
                <p className="text-[11px] text-slate-500">Plano {ev.billing_plan ?? 'Começo'}: preço fechado, sem taxa de pagamento para o inscrito.</p>
              )}
              {sim?.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">{w}</p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TaxasESimulador;
