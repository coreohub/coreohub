/**
 * Banner LGPD de consentimento de cookies de análise/marketing.
 *
 * Aparece quando user não deu consent OU quando o anterior expirou (> 12m,
 * conforme recomendação ANPD). Padrão de mercado: posição inferior, copy
 * sóbrio, 2 botões com hierarquia visual clara (secundário "Apenas
 * essenciais" + primário "Aceitar todos"), sem emoji.
 *
 * Renderiza só em surface públicas (vitrine, wizard, sucesso). Painel do
 * produtor logado não vê — assume que ele já fez consent quando criou conta.
 */

import { useEffect, useState } from 'react';
import { getConsent, setConsent } from '../utils/consent';

declare global {
  interface Window {
    __loadCoreohubMarketing?: () => void;
    __coreohubMarketingLoaded?: boolean;
  }
}

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    const isPublicSurface = path === '/'
      || path.startsWith('/lp')
      || path.startsWith('/governo')
      || path.startsWith('/evento/')
      || path.startsWith('/festival/')
      || path.startsWith('/u/')
      || path.startsWith('/pagamento-sucesso')
      || path.startsWith('/leaderboard/');

    if (!isPublicSurface) return;

    const current = getConsent();
    if (current === null) {
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
    if (current.marketing && typeof window.__loadCoreohubMarketing === 'function') {
      window.__loadCoreohubMarketing();
    }
  }, []);

  const handleAccept = () => {
    setConsent({ marketing: true });
    if (typeof window.__loadCoreohubMarketing === 'function') {
      window.__loadCoreohubMarketing();
    }
    setVisible(false);
  };

  const handleReject = () => {
    setConsent({ marketing: false });
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Consentimento de cookies"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:left-6 sm:bottom-6 sm:right-auto sm:max-w-md z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1.5">
        Cookies neste site
      </h2>
      <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
        Usamos cookies essenciais para o funcionamento do site e, com seu consentimento, cookies de análise (Google Analytics e Meta Pixel) para entender como ele é usado e melhorar a experiência. Você pode mudar a qualquer momento.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={handleReject}
          className="flex-1 px-4 py-2 text-[13px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-lg transition-colors"
        >
          Apenas essenciais
        </button>
        <button
          onClick={handleAccept}
          className="flex-1 px-4 py-2 text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 rounded-lg transition-colors"
        >
          Aceitar todos
        </button>
      </div>
    </div>
  );
}
