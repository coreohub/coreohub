import React, { useEffect, useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

/**
 * Banner persistente fino que aparece no topo do PrivateLayout sugerindo
 * instalar o app. Aparece SÓ após a 2ª sessão (não first-load) — research
 * Pinterest/Twitter mostra que prompt no first-load tem 91% dismiss rate.
 *
 * - Já instalado (display-mode: standalone): nunca aparece
 * - Dispensado pelo usuário: esconde por 30 dias
 * - 1ª sessão: incrementa contador, não mostra
 * - 2ª+ sessão: mostra banner
 *
 * Click "Instalar" dispara o prompt nativo (Chrome/Android) ou abre modal
 * com instruções (iOS Safari) — reusa InstallPWAButton via hint state.
 */

const SESSION_COUNT_KEY = 'coreohub_session_count';
const SESSION_TS_KEY    = 'coreohub_last_session_at';
const DISMISS_KEY       = 'coreohub_install_banner_dismissed_at';
const DISMISS_TTL_MS    = 30 * 24 * 60 * 60 * 1000;
const SESSION_GAP_MS    = 30 * 60 * 1000; // 30min gap = nova sessão

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
   (window.navigator as any).standalone === true);

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as any).MSStream;

const wasDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
};

/**
 * Conta sessões — incrementa a cada login após 30min de gap.
 * Retorna o contador atual.
 */
const trackSession = (): number => {
  try {
    const lastTs = Number(localStorage.getItem(SESSION_TS_KEY) ?? 0);
    const now = Date.now();
    if (now - lastTs > SESSION_GAP_MS) {
      const count = Number(localStorage.getItem(SESSION_COUNT_KEY) ?? 0) + 1;
      localStorage.setItem(SESSION_COUNT_KEY, String(count));
      localStorage.setItem(SESSION_TS_KEY, String(now));
      return count;
    }
    return Number(localStorage.getItem(SESSION_COUNT_KEY) ?? 1);
  } catch {
    return 0;
  }
};

const InstallAppBanner: React.FC = () => {
  const [show, setShow] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const { promptInstall } = usePWAInstall();

  useEffect(() => {
    if (isStandalone() || wasDismissed()) return;
    const sessions = trackSession();
    if (sessions >= 2) setShow(true);
  }, []);

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') setShow(false);
    if (outcome === null) setShowInstructions(true);
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setShow(false);
  };

  if (!show) return null;

  return (
    <>
      <div className="bg-gradient-to-r from-[#ff0068]/10 via-[#ff0068]/5 to-transparent border-b border-[#ff0068]/20 px-3 py-2.5">
        <div className="flex items-center gap-3 max-w-6xl mx-auto">
          <Smartphone size={16} className="text-[#ff0068] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
              <span className="hidden sm:inline">Instale a CoreoHub como app — </span>
              acesso rápido na tela inicial
            </p>
          </div>
          <button
            onClick={handleInstall}
            className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 bg-[#ff0068] text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-colors shrink-0"
          >
            <Download size={12} />
            <span className="hidden xs:inline">Instalar</span>
          </button>
          <button
            onClick={handleDismiss}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors shrink-0"
            aria-label="Dispensar"
            title="Dispensar por 30 dias"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Modal de instruções pra iOS Safari ou casos sem prompt nativo */}
      {showInstructions && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={() => setShowInstructions(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068]">Instalar como app</p>
                <h3 className="text-lg font-black text-slate-900 dark:text-white mt-1">CoreoHub na tela inicial</h3>
              </div>
              <button
                onClick={() => setShowInstructions(false)}
                className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg shrink-0"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            {isIOS() ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  No iPhone/iPad, é preciso usar o <strong>Safari</strong> (não Chrome/Edge):
                </p>
                <ol className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  <li className="flex items-start gap-2">
                    <span className="font-black text-[#ff0068] shrink-0">1.</span>
                    Toque no botão <strong>Compartilhar</strong> <span className="inline-block px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 rounded text-xs">□↑</span> na barra inferior
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-black text-[#ff0068] shrink-0">2.</span>
                    Role e selecione <strong>"Adicionar à Tela de Início"</strong>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-black text-[#ff0068] shrink-0">3.</span>
                    Toque em <strong>Adicionar</strong> no canto superior direito
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  No Chrome/Edge (Android ou desktop):
                </p>
                <ol className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  <li className="flex items-start gap-2">
                    <span className="font-black text-[#ff0068] shrink-0">1.</span>
                    Abra o menu do navegador <strong>⋮</strong> (canto superior direito)
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-black text-[#ff0068] shrink-0">2.</span>
                    Toque em <strong>"Instalar app"</strong> ou <strong>"Adicionar à tela inicial"</strong>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-black text-[#ff0068] shrink-0">3.</span>
                    Confirme. App aparece na tela inicial como qualquer outro
                  </li>
                </ol>
                <p className="text-xs text-slate-500 mt-3 italic">
                  Se a opção não aparecer, recarregue a página algumas vezes — o navegador libera após confirmar que é um PWA válido.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default InstallAppBanner;
