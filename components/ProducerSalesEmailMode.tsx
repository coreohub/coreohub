import React, { useEffect, useState } from 'react';
import { Mail, Loader2, Check } from 'lucide-react';
import { supabase } from '../services/supabase';

/**
 * Como o produtor recebe o aviso de venda por e-mail: resumo semanal (padrao, sexta 09:00) ou 1 e-mail a cada
 * venda. Grava profiles.producer_sales_email_mode da propria conta (RLS). Estorno continua sempre imediato.
 * Sempre renderiza (estado visivel mesmo carregando ou com erro). Plano: docs/plano-resumo-semanal-vendas-produtor.md.
 */
type Mode = 'weekly' | 'each';

const OPTIONS: Array<{ value: Mode; title: string; desc: string }> = [
  { value: 'weekly', title: 'Resumo semanal (recomendado)', desc: 'Um e-mail por semana, toda sexta às 09:00, com as vendas de cada evento. Em semana de pico de venda, você só vê tudo na sexta; pelo painel o número é em tempo real.' },
  { value: 'each', title: 'A cada venda', desc: 'Um e-mail para cada venda, na hora. Em semana movimentada chegam muitos e-mails.' },
];

const ProducerSalesEmailMode: React.FC = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [saving, setSaving] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!alive || !user) return;
      setUserId(user.id);
      const { data, error: qErr } = await supabase
        .from('profiles').select('producer_sales_email_mode').eq('id', user.id).maybeSingle();
      if (!alive) return;
      if (qErr) {
        console.error('[ProducerSalesEmailMode] ler modo:', qErr.message);
        setError('Não foi possível carregar essa preferência agora.');
        return;
      }
      setMode(data?.producer_sales_email_mode === 'each' ? 'each' : 'weekly');
    })();
    return () => { alive = false; };
  }, []);

  const choose = async (next: Mode) => {
    if (!userId || next === mode || saving) return;
    const prev = mode;
    setSaving(next);
    setError(null);
    setMode(next);
    const { data, error: uErr } = await supabase
      .from('profiles').update({ producer_sales_email_mode: next }).eq('id', userId).select('id');
    setSaving(null);
    if (uErr || !data || data.length === 0) {
      console.error('[ProducerSalesEmailMode] salvar modo:', uErr?.message ?? '0 linhas atualizadas');
      setMode(prev);
      setError('Não foi possível salvar. Tente de novo.');
      return;
    }
    setSavedAt(Date.now());
  };

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-[#ff0068]/10 flex items-center justify-center shrink-0">
          <Mail size={18} className="text-[#ff0068]" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Avisos de venda por e-mail</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">Como você quer ser avisado de cada venda?</p>
        </div>
      </div>

      <div role="radiogroup" aria-label="Avisos de venda por e-mail" className="mt-4 grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const active = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={mode === null || saving !== null}
              onClick={() => choose(o.value)}
              className={`flex flex-col justify-start text-left rounded-2xl border-2 p-4 transition-all disabled:cursor-not-allowed ${
                active
                  ? 'border-[#ff0068] bg-[#ff0068]/5'
                  : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-black text-slate-900 dark:text-white">{o.title}</span>
                {saving === o.value ? (
                  <Loader2 size={14} className="animate-spin text-[#ff0068] shrink-0" />
                ) : active ? (
                  <Check size={14} className="text-[#ff0068] shrink-0" />
                ) : null}
              </span>
              <span className="block text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 mt-1.5">{o.desc}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3" aria-live="polite">
        {mode === null && !error ? 'Carregando sua preferência…' : null}
        {error ? <span className="text-rose-600 dark:text-rose-400 font-bold">{error}</span> : null}
        {!error && savedAt ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">Preferência salva. </span> : null}
        {mode !== null ? 'Avisos de estorno chegam sempre na hora, em qualquer opção.' : null}
      </p>
    </div>
  );
};

export default ProducerSalesEmailMode;
