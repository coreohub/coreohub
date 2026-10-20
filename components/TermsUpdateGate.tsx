import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { FileText, Loader2, AlertCircle, LogOut } from 'lucide-react';
import { supabase } from '../services/supabase';
import {
  TERMO_PRODUTOR_VERSION,
  termoGateStatus,
  termoVigenciaTexto,
} from '../utils/termoVersion';

interface Props {
  producerId: string;
  /** "Ver como" do admin: o aceite gravaria o id do admin, então não mostra nada. */
  isImpersonating: boolean;
  onLogout: () => void;
}

const BULLETS: Array<{ title: string; text: string; clauses: string }> = [
  {
    title: 'Taxa de pagamento',
    text: 'Quando ativada no seu evento, o comprador paga uma taxa discriminada no Pix e no cartão. Você recebe o mesmo valor líquido de hoje.',
    clauses: 'cláusulas 11.3 a 11.9',
  },
  {
    title: 'Cartão parcelado',
    text: 'O comprador pode parcelar até o limite do seu evento, com a taxa de parcelamento paga por ele. Você recebe o valor líquido da venda integralmente quando a antecipação é aprovada.',
    clauses: 'cláusulas 11.10 e 11.11',
  },
  {
    title: 'Estornos e retenção',
    text: 'Estorno ou contestação de venda parcelada alcança o pedido inteiro e pode ser descontado do seu saldo. A CoreoHub pode reter o repasse de vendas parceladas até a realização do evento.',
    clauses: 'cláusulas 11.12 e 11.13',
  },
];

/**
 * Atualização do Termo do Produtor no estilo "avisamos antes, vale para todos a partir de uma data":
 * antes da vigência um aviso no painel (o produtor aceita quando quiser, com um clique); a partir da
 * vigência uma tela obrigatória, sem "ver depois". O aceite é sempre um ato do produtor (botão "Li e
 * aceito"), gravado pela mesma RPC de /termo-produtor (IP do servidor + log imutável). A taxa de
 * pagamento e o parcelado só são ligados por evento depois do aceite.
 *
 * Quem não é produtor, o "Ver como" do admin e a própria página /termo-produtor (que tem o aceite
 * dela) não veem nada. Sem pendência o componente não desenha nada, de propósito: é um aviso, não
 * uma área da tela.
 */
const TermsUpdateGate: React.FC<Props> = ({ producerId, isImpersonating, onLogout }) => {
  const location = useLocation();
  const [version, setVersion] = useState<string | null | undefined>(undefined); // undefined = ainda lendo
  const [open, setOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('producer_terms_version')
      .eq('id', producerId)
      .maybeSingle();
    if (error) {
      // Falha de leitura nunca trava o painel: sem versão conhecida, não mostra nada.
      console.error('[TermsUpdateGate] erro ao ler a versão do Termo:', error.message);
      return;
    }
    setVersion(data?.producer_terms_version ?? null);
  }, [producerId]);

  useEffect(() => {
    if (isImpersonating) return;
    load();
    const onAccepted = () => load();
    const onFocus = () => load();
    window.addEventListener('coreohub:termo-aceito', onAccepted);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('coreohub:termo-aceito', onAccepted);
      window.removeEventListener('focus', onFocus);
    };
  }, [load, isImpersonating]);

  if (isImpersonating || version === undefined) return null;
  const status = termoGateStatus(version);
  if (status === 'aceito') return null;
  // /termo-produtor tem o texto completo e o próprio botão de aceite.
  if (location.pathname === '/termo-produtor') return null;

  const handleAccept = async () => {
    setAccepting(true);
    setErrorMsg(null);
    const { error } = await supabase.rpc('accept_producer_terms', {
      p_version: TERMO_PRODUTOR_VERSION,
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
    setAccepting(false);
    if (error) {
      console.error('[TermsUpdateGate] erro ao registrar aceite:', error.message);
      setErrorMsg(error.message ?? 'Não foi possível registrar o aceite. Tente de novo.');
      return;
    }
    setVersion(TERMO_PRODUTOR_VERSION);
    setOpen(false);
    window.dispatchEvent(new Event('coreohub:termo-aceito'));
  };

  const mandatory = status === 'obrigatorio';
  const vigencia = termoVigenciaTexto();

  const panel = (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      onClick={mandatory ? undefined : () => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Termo do Produtor atualizado"
        className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#ff0068]/10 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-[#ff0068]" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">
              Termo do Produtor · versão {TERMO_PRODUTOR_VERSION}
            </p>
            <h2 className="text-lg font-black uppercase tracking-tighter italic text-slate-900 dark:text-white leading-tight">
              {mandatory ? 'Aceite para continuar' : 'Termo atualizado'}
            </h2>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {mandatory
            ? `A nova versão do Termo vale para todos os produtores desde ${vigencia}. Para continuar usando o painel, leia o resumo e aceite.`
            : `A nova versão do Termo vale para todos os produtores a partir de ${vigencia}. Veja o que muda e aceite agora, com um clique.`}
        </p>

        <ul className="space-y-3">
          {BULLETS.map(b => (
            <li key={b.title} className="rounded-2xl border border-slate-200 dark:border-white/10 p-3">
              <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">
                {b.title} <span className="font-bold normal-case tracking-normal text-slate-400">({b.clauses})</span>
              </p>
              <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed mt-1">{b.text}</p>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          A taxa de pagamento e o parcelado só são ativados no seu evento depois do seu aceite. Vendas já feitas continuam como estavam.{' '}
          <a href="/termo-produtor" target="_blank" rel="noopener noreferrer" className="font-black text-[#ff0068] hover:underline">
            Ler o Termo completo
          </a>
        </p>

        {errorMsg && (
          <p className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
            <AlertCircle size={12} className="shrink-0" /> {errorMsg}
          </p>
        )}

        {/* Botão sempre à vista, mesmo no celular com o resumo rolando por trás. */}
        <div className="sticky bottom-0 -mx-6 -mb-6 space-y-3 bg-white dark:bg-slate-900 px-6 pb-6 pt-3 border-t border-slate-100 dark:border-white/5">
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#ff0068] hover:bg-[#e0005c] disabled:bg-slate-200 dark:disabled:bg-white/10 disabled:text-slate-500 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-colors"
          >
            {accepting ? <Loader2 size={14} className="animate-spin" /> : null}
            Li e aceito o Termo (versão {TERMO_PRODUTOR_VERSION})
          </button>

          {mandatory ? (
            <button
              type="button"
              onClick={onLogout}
              className="mx-auto flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              <LogOut size={12} /> Sair da conta
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mx-auto block text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Antes da vigência: faixa discreta no painel. A partir dela o aceite vira a tela obrigatória. */}
      {!mandatory && (
        <div
          className="mx-3 lg:mx-4 mt-3 flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60"
          role="status"
        >
          <div className="w-10 h-10 rounded-2xl bg-[#ff0068]/10 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-[#ff0068]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Termo do Produtor atualizado</p>
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
              A versão {TERMO_PRODUTOR_VERSION} vale para todos a partir de {vigencia}. Leia o resumo e aceite agora, com um clique.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center justify-center gap-2 px-5 py-3 bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-xl font-black text-xs uppercase tracking-widest transition-colors flex-shrink-0"
          >
            Ler e aceitar
          </button>
        </div>
      )}
      {(mandatory || open) && createPortal(panel, document.body)}
    </>
  );
};

export default TermsUpdateGate;
