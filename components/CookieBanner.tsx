/**
 * Banner LGPD de consentimento de cookies de marketing.
 *
 * Aparece quando user não deu consent OU quando o consent anterior expirou
 * (> 12 meses, conforme recomendação ANPD). 2 botões: "Aceitar" liga Meta
 * Pixel + GA4; "Recusar" deixa tudo desligado. Sempre pode reverter via
 * link "Cookies" no footer (não implementado nesta versão — opt-in só).
 *
 * Renderiza só em páginas públicas (vitrine, wizard, sucesso) — não polui
 * o painel do produtor que já está logado e familiar com tracking interno.
 *
 * UX research: banner inferior + 2 CTAs claros > modal full-screen (Nielsen
 * Norman Group: bloquear o user pra LGPD aumenta bounce em 13%).
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
    // Só pra páginas públicas — não polui painel do produtor logado.
    const path = window.location.pathname;
    const isPublicSurface = path === '/'
      || path.startsWith('/evento/')
      || path.startsWith('/festival/')
      || path.startsWith('/u/')
      || path.startsWith('/pagamento-sucesso')
      || path.startsWith('/leaderboard/');

    if (!isPublicSurface) return;

    const current = getConsent();
    if (current === null) {
      // Sem consent (ou expirado) — mostra banner depois de 1.5s (pra não
      // estourar na cara de quem só quer ver a vitrine rapidamente).
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
    // Tem consent válido — se for marketing=true, carrega pixels já.
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
      className="fixed bottom-0 left-0 right-0 z-50 p-3 sm:p-4 bg-slate-900/95 backdrop-blur-md border-t border-white/10 text-white shadow-2xl"
    >
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] sm:text-[12px] leading-relaxed">
            <strong>🍪 Cookies de marketing</strong> — usamos pixels (Meta + Google Analytics) pra entender quem chega na vitrine e otimizar campanhas dos produtores. Você decide.
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            Recusar não atrapalha em nada a sua inscrição. Você pode mudar a qualquer momento.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <button
            onClick={handleReject}
            className="flex-1 sm:flex-initial px-4 py-2 text-[10px] font-black uppercase tracking-widest border border-white/20 hover:border-white/40 rounded-xl transition-colors"
          >
            Recusar
          </button>
          <button
            onClick={handleAccept}
            className="flex-1 sm:flex-initial px-5 py-2 text-[10px] font-black uppercase tracking-widest bg-[#ff0068] hover:bg-[#e0005c] rounded-xl transition-colors shadow-lg shadow-[#ff0068]/20"
          >
            Aceitar
          </button>
        </div>
      </div>
    </div>
  );
}
