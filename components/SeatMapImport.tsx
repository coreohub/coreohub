import React, { useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { FileUp, Loader2, AlertCircle } from 'lucide-react';
import { planToRows, type PlanConversion } from '../utils/seatMapFromPlan';

/**
 * "Importar de PDF ou imagem" do modal Novo local: envia a planta para a edge function parse-seat-map
 * (IA da Anthropic), converte a transcrição em grade (utils/seatMapFromPlan.ts) e entrega ao modal.
 * Nada é salvo aqui: o produtor revisa a prévia e confirma em "Salvar local".
 */

const MIME_OK = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
// Por extensão no input: `accept` com tipos MIME deixa o diálogo de arquivo do Chrome no Windows lento (vários segundos).
const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.webp';
const MAX_BYTES = 10 * 1024 * 1024;
const labelCls = 'text-[10px] font-black text-slate-500 uppercase tracking-widest px-1';
const inputCls = 'w-full p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white font-bold text-sm outline-none focus:ring-2 focus:ring-[#ff0068]';

async function readPlan(file: File): Promise<unknown> {
  const form = new FormData();
  form.append('file', file);
  const { data, error } = await supabase.functions.invoke('parse-seat-map', { body: form });
  if (error) {
    let msg: string | undefined;
    try { msg = (await (error as { context?: Response }).context?.json())?.error; } catch { /* corpo sem JSON */ }
    throw new Error(msg ?? 'A leitura por IA não está disponível agora. Monte a grade pelo gerador.');
  }
  if (!data?.plan) throw new Error('A leitura não devolveu uma planta. Tente de novo.');
  return data.plan;
}

const SeatMapImport: React.FC<{ onImported: (c: PlanConversion) => void }> = ({ onImported }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expectedTotal, setExpectedTotal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!MIME_OK.includes(file.type)) { setError('Formato não aceito. Envie PDF, PNG, JPG ou WEBP.'); return; }
    if (file.size > MAX_BYTES) { setError('O arquivo passa de 10 MB. Reduza e tente de novo.'); return; }
    setBusy(true);
    try {
      const plan = await readPlan(file);
      const total = Number(expectedTotal);
      onImported(planToRows(plan as Parameters<typeof planToRows>[0], Number.isInteger(total) && total > 0 ? total : undefined));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler a planta.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-3">
      <p className={labelCls}>Importar planta (IA)</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div className="space-y-1">
          <label htmlFor="seatmap-expected-total" className={labelCls}>Total de lugares (opcional)</label>
          <input
            id="seatmap-expected-total"
            type="number"
            min={1}
            value={expectedTotal}
            onChange={e => setExpectedTotal(e.target.value)}
            className={inputCls}
            placeholder="Ex: 317, para conferir a leitura"
          />
        </div>
        <div className="sm:col-span-2">
          <input ref={inputRef} type="file" accept={ACCEPT_ATTR} className="hidden" onChange={e => handleFile(e.target.files?.[0])} aria-label="Arquivo da planta" />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 disabled:opacity-60 text-slate-700 dark:text-white rounded-xl font-black text-[11px] uppercase tracking-widest"
          >
            {busy
              ? <><Loader2 size={14} className="animate-spin" /> Lendo a planta... pode levar até 1 minuto</>
              : <><FileUp size={14} /> Importar de PDF ou imagem</>}
          </button>
        </div>
      </div>
      <p className="px-1 text-[10px] text-slate-500">
        PDF, PNG, JPG ou WEBP de até 10 MB. A IA monta a grade na prévia abaixo; você revisa antes de salvar. Nada é salvo sozinho.
      </p>
      {error && (
        <div role="alert" className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-500 text-[11px] font-bold flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0" /> {error}
        </div>
      )}
    </div>
  );
};

export default SeatMapImport;
