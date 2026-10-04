import React, { useState } from 'react';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { TERMO_PRODUTOR_VERSION } from '../utils/termoVersion';

interface Props {
  /** Chamado depois que o aceite foi gravado, pra o gate liberar o assistente. */
  onAccepted: (version: string) => void;
}

/**
 * Tela exibida no lugar do assistente de criação de evento quando o produtor ainda não
 * aceitou a versão vigente do Termo. A mesma regra vale no banco (trigger
 * block_new_event_terms_not_accepted_trigger): esta tela só evita que ele preencha o
 * formulário inteiro pra descobrir no fim. O aceite usa a mesma RPC de /termo-produtor
 * (IP do servidor + audit log imutável).
 */
const NewEventTermsNotice: React.FC<Props> = ({ onAccepted }) => {
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!checked) { setErrorMsg('Marque a caixa de aceite para continuar.'); return; }
    setLoading(true);
    setErrorMsg(null);
    const { error } = await supabase.rpc('accept_producer_terms', {
      p_version:    TERMO_PRODUTOR_VERSION,
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
    setLoading(false);
    if (error) {
      console.error('[NewEventTermsNotice] erro ao registrar aceite:', error.message);
      setErrorMsg(error.message ?? 'Não foi possível registrar o aceite. Tente de novo.');
      return;
    }
    onAccepted(TERMO_PRODUTOR_VERSION);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-4" role="alert">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#ff0068]/10 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-[#ff0068]" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Termo atualizado</p>
            <h1 className="text-lg font-black uppercase tracking-tighter italic text-slate-900 dark:text-white leading-tight">
              Aceite para criar um evento
            </h1>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Para criar um evento novo, é preciso aceitar a versão {TERMO_PRODUTOR_VERSION} do Termo de Adesão do Produtor.
          Ela inclui a taxa de pagamento, a venda exclusivamente pela plataforma e as regras de estorno.
        </p>

        <label className="flex items-start gap-3 p-4 rounded-2xl border-2 border-[#ff0068]/30 bg-[#ff0068]/5 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#ff0068] shrink-0"
          />
          <span className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            Li e aceito o{' '}
            <a href="/termo-produtor" target="_blank" rel="noopener noreferrer" className="font-black text-[#ff0068] hover:underline">
              Termo de Adesão do Produtor (versão {TERMO_PRODUTOR_VERSION})
            </a>.
          </span>
        </label>

        {errorMsg && (
          <p className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
            <AlertCircle size={12} className="shrink-0" /> {errorMsg}
          </p>
        )}

        <button
          onClick={handleAccept}
          disabled={loading || !checked}
          className="w-full py-3 bg-[#ff0068] hover:bg-[#e0005c] disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-500 text-white rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          Aceitar e continuar
        </button>
      </div>
    </div>
  );
};

export default NewEventTermsNotice;
