import React from 'react';
import { AlertTriangle, RefreshCw, MessageCircle } from 'lucide-react';

/**
 * Banner de erro de sistema voltado pro USUÁRIO FINAL (inscrito).
 *
 * Substitui banners antigos que mostravam SQL bruto pra inscrito (CREATE TABLE...)
 * — esse SQL era ação de admin do Supabase, mas inscrito não tem como executar
 * nem entende. Resultado: trava completa sem ação.
 *
 * Agora: mensagem clara + botão "Tentar novamente" + contato de suporte.
 */

interface Props {
  /** Mensagem principal exibida pro usuário. Default genérico. */
  message?: string;
  /** Callback do botão "Tentar novamente". */
  onRetry?: () => void;
  /** E-mail de suporte. Default: contato@coreohub.com. */
  supportEmail?: string;
}

const SystemErrorBanner: React.FC<Props> = ({
  message = 'Não foi possível carregar esta seção. Tente novamente em instantes.',
  onRetry,
  supportEmail = 'contato@coreohub.com',
}) => {
  const subject = encodeURIComponent('CoreoHub — Sistema indisponível');
  const body = encodeURIComponent(`Olá, encontrei um erro ao acessar o CoreoHub.\n\nURL: ${typeof window !== 'undefined' ? window.location.href : ''}\nDetalhe: ${message}`);

  return (
    <div className="max-w-2xl mx-auto mt-10 p-6 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
      <div className="flex items-center gap-3 mb-3">
        <AlertTriangle className="text-amber-500 shrink-0" size={20} />
        <h2 className="font-black uppercase tracking-tight text-amber-700 dark:text-amber-400">
          Sistema temporariamente indisponível
        </h2>
      </div>

      <p className="text-sm text-amber-700 dark:text-amber-300 mb-5 leading-relaxed">
        {message}
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
          >
            <RefreshCw size={12} /> Tentar novamente
          </button>
        )}

        <a
          href={`mailto:${supportEmail}?subject=${subject}&body=${body}`}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-100 dark:hover:bg-amber-500/30 transition-all"
        >
          <MessageCircle size={12} /> Falar com suporte
        </a>
      </div>
    </div>
  );
};

export default SystemErrorBanner;
