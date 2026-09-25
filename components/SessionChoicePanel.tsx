import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, Copy } from 'lucide-react';
import { supabase } from '../services/supabase';
import { edgeErrorMessage } from '../utils/edgeError';

/**
 * Escolha do comprador numa sessão adiada/cancelada (Decreto 13.108/2026, arts. 20-22):
 * manter (só adiada), crédito (cupom de uso único) ou restituição integral com taxas.
 * Grava por edge function (choose-session-option) com o token do ingresso.
 * Fica sobre o cartão branco da página do ingresso (tema claro).
 */
interface Choice {
  sessao_escolha: string | null;
  sessao_escolha_em: string | null;
  sessao_escolha_erro: string | null;
  credito_codigo: string | null;
  credito_valor: number | null;
  credito_valido_ate: string | null;
  pode_credito: boolean;
}

interface Props {
  token: string;
  sessaoStatus: 'adiada' | 'cancelada';
  statusPagamento: string;
  checkedIn: boolean;
  /** Recarrega o ingresso depois de uma escolha (o status muda em restituição/crédito). */
  onChanged: () => void;
}

const brl = (n: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));

const SessionChoicePanel: React.FC<Props> = ({ token, sessaoStatus, statusPagamento, checkedIn, onChanged }) => {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [confirming, setConfirming] = useState<'credito' | 'restituicao' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data, error: rpcErr } = await supabase.rpc('get_ticket_session_choice', { p_token: token });
    if (rpcErr) { console.warn('[SessionChoicePanel] get_ticket_session_choice:', rpcErr.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setChoice(row as Choice);
  }, [token]);

  useEffect(() => { void load(); }, [load, statusPagamento]);

  const choose = async (option: 'manter' | 'credito' | 'restituicao') => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('choose-session-option', {
        body: { access_token: token, option },
      });
      if (invokeErr) throw new Error(await edgeErrorMessage(invokeErr, 'Não foi possível registrar a sua escolha.'));
      if (data?.error) throw new Error(data.error);
      setConfirming(null);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!choice) return null;
  const escolha = choice.sessao_escolha;

  // ── Escolha já feita ──────────────────────────────────────────────────────
  if (escolha === 'credito' && choice.credito_codigo) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 text-emerald-900 p-4 text-sm space-y-2 print:hidden">
        <p className="font-black uppercase tracking-tight flex items-center gap-1.5"><Check size={16} /> Ingresso convertido em crédito</p>
        <p>Use este código no campo de cupom do checkout de outra sessão do mesmo espetáculo:</p>
        <div className="flex items-center gap-2">
          <code className="px-3 py-2 bg-white border border-emerald-300 rounded-lg font-mono font-black tracking-wider">{choice.credito_codigo}</code>
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(choice.credito_codigo!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-300 text-xs font-bold hover:bg-emerald-100"
          >
            <Copy size={12} /> {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <p className="text-xs">Valor: <strong>{brl(choice.credito_valor)}</strong>{choice.credito_valido_ate && <> · válido até {new Date(choice.credito_valido_ate + 'T12:00:00').toLocaleDateString('pt-BR')}</>} · uso único.</p>
      </div>
    );
  }
  if (escolha === 'restituicao') {
    return (
      <div className="rounded-2xl border border-sky-300 bg-sky-50 text-sky-900 p-4 text-sm space-y-1 print:hidden">
        <p className="font-black uppercase tracking-tight flex items-center gap-1.5"><Check size={16} /> Restituição pedida</p>
        {statusPagamento === 'ESTORNADO'
          ? <p>O estorno integral, com as taxas, foi processado. O prazo para aparecer na sua fatura depende do meio de pagamento.</p>
          : <p>Recebemos o seu pedido de restituição integral, com as taxas. Ele está em processamento e você receberá um e-mail quando concluir.</p>}
      </div>
    );
  }

  // Ingresso inativo ou já usado: sem escolha a fazer.
  if (statusPagamento !== 'APROVADO' || checkedIn) return null;

  const manteve = escolha === 'manter';
  return (
    <div className="rounded-2xl border border-slate-300 bg-white text-slate-900 p-4 text-sm space-y-3 print:hidden">
      <p className="font-black uppercase tracking-tight">O que você quer fazer com este ingresso?</p>
      {manteve && <p className="text-xs text-emerald-700 font-bold flex items-center gap-1"><Check size={12} /> Você escolheu manter o ingresso para a nova data. Pode mudar de ideia abaixo.</p>}

      {confirming ? (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed">
            {confirming === 'restituicao'
              ? 'Confirmar restituição integral? O valor pago, com as taxas, será estornado e este ingresso deixará de valer. Não dá para desfazer.'
              : 'Confirmar conversão em crédito? Você recebe um cupom de uso único no valor pago e este ingresso deixará de valer. Não dá para desfazer.'}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="flex-1 py-2.5 rounded-xl border border-slate-300 text-[11px] font-black uppercase tracking-widest">Voltar</button>
            <button type="button" disabled={busy} onClick={() => choose(confirming)} className="flex-1 py-2.5 rounded-xl bg-[#ff0068] text-white text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
              {busy && <Loader2 size={12} className="animate-spin" />} Confirmar
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {sessaoStatus === 'adiada' && !manteve && (
            <button type="button" disabled={busy} onClick={() => choose('manter')} className="w-full py-3 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
              {busy && <Loader2 size={12} className="animate-spin" />} Manter para a nova data
            </button>
          )}
          {choice.pode_credito && (
            <button type="button" disabled={busy} onClick={() => setConfirming('credito')} className="w-full py-3 rounded-xl border border-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
              Converter em crédito
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setConfirming('restituicao')} className="w-full py-3 rounded-xl border border-rose-300 text-rose-700 text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
            Pedir restituição integral
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-rose-700 font-bold">{error}</p>}
      {sessaoStatus === 'cancelada' && !choice.pode_credito && (
        <p className="text-[11px] text-slate-500">Não há outra sessão disponível para usar crédito no momento.</p>
      )}
    </div>
  );
};

export default SessionChoicePanel;
