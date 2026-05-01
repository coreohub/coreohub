import React, { useEffect, useState } from 'react';
import { Download, X, Copy, Check } from 'lucide-react';

/**
 * Botão discreto pra instalar o CoreoHub como PWA.
 *
 * Comportamento:
 * - Chrome/Edge/Android: usa o evento `beforeinstallprompt` e mostra botão
 *   "Instalar app" que dispara o prompt nativo do navegador.
 * - iOS Safari: não tem API — mostra instrução manual ("Toque em Compartilhar
 *   → Adicionar à Tela Inicial").
 * - iOS Chrome/Edge/Firefox: NÃO instala PWA real (limitação do WebKit).
 *   Mostra mensagem específica pedindo pra abrir no Safari + botão Copiar URL.
 * - Já instalado (display-mode: standalone): não mostra nada.
 * - Usuário fechou: lembra a escolha por 7 dias via localStorage.
 */

const DISMISS_KEY = 'coreohub_install_dismissed_at';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
   (window.navigator as any).standalone === true);

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as any).MSStream;

// Chrome iOS, Edge iOS, Firefox iOS, Opera iOS — todos usam WebKit por baixo
// MAS não suportam install PWA real (só Safari). Tem que avisar pro usuário.
const isIOSNonSafari = () => {
  if (!isIOS()) return false;
  const ua = navigator.userAgent;
  return /CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
};

const wasDismissedRecently = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
};

export const InstallPWAButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) {
      setHidden(true);
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setHidden(true);
      setInstallPrompt(null);
    } else {
      // Sem prompt nativo (iOS Safari, Chrome sem heurística disparada, etc.)
      // Mostra instruções manuais.
      setShowHint(true);
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setHidden(true);
  };

  if (hidden) return null;

  if (showHint) {
    const ios          = isIOS();
    const iosNonSafari = isIOSNonSafari();

    const handleCopyUrl = async () => {
      try {
        await navigator.clipboard.writeText(window.location.origin);
        setUrlCopied(true);
        setTimeout(() => setUrlCopied(false), 2000);
      } catch {
        // Fallback: seleciona a URL pra usuário copiar manualmente
        alert('Copie esta URL: ' + window.location.origin);
      }
    };

    return (
      <div className={`fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto bg-slate-900 border border-[#ff0068]/30 rounded-2xl p-4 shadow-2xl ${className}`}>
        <button onClick={() => setShowHint(false)} className="absolute top-2 right-2 p-1 text-slate-500 hover:text-white">
          <X size={14} />
        </button>
        <p className="text-[10px] font-black uppercase tracking-widest text-[#ff0068] mb-2">
          Instalar como app
        </p>

        {iosNonSafari ? (
          <>
            <p className="text-xs text-slate-300 leading-relaxed">
              <strong className="text-amber-400">⚠ Chrome/Edge/Firefox no iPhone não instala apps de verdade</strong> — só cria atalhos com barra de URL.<br /><br />
              <strong>Pra instalar como app real:</strong><br />
              1. Copie o link abaixo<br />
              2. Abra o <strong>Safari</strong> no iPhone<br />
              3. Cole no Safari e siga as instruções
            </p>
            <button
              onClick={handleCopyUrl}
              className="mt-3 inline-flex items-center gap-2 px-3 py-2 bg-[#ff0068]/10 border border-[#ff0068]/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-[#ff0068] hover:bg-[#ff0068]/20 transition-all"
            >
              {urlCopied ? <Check size={12} /> : <Copy size={12} />}
              {urlCopied ? 'Link copiado!' : 'Copiar link'}
            </button>
          </>
        ) : ios ? (
          <p className="text-xs text-slate-300 leading-relaxed">
            <strong>iPhone/iPad (Safari):</strong><br />
            1. Toque no botão <strong>Compartilhar</strong> (□↑) na barra inferior<br />
            2. Role e selecione <strong>"Adicionar à Tela de Início"</strong><br />
            3. Toque em <strong>Adicionar</strong> no canto superior direito
          </p>
        ) : (
          <p className="text-xs text-slate-300 leading-relaxed">
            <strong>Android/Desktop (Chrome/Edge):</strong><br />
            Toque no menu <strong>⋮</strong> do navegador → <strong>"Instalar app"</strong> (ou <strong>"Adicionar à tela inicial"</strong>).<br /><br />
            Se não aparecer, recarregue a página algumas vezes — o navegador libera a opção após confirmar que é um PWA válido.
          </p>
        )}
        <button
          onClick={handleDismiss}
          className="mt-3 text-[10px] text-slate-500 hover:text-slate-300 underline block"
        >
          Não mostrar por 7 dias
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleInstall}
      className={`inline-flex items-center gap-2 px-4 py-2.5 bg-[#ff0068]/10 border border-[#ff0068]/30 hover:bg-[#ff0068]/20 text-[#ff0068] rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${className}`}
      title="Instalar como app no dispositivo"
    >
      <Download size={12} />
      Instalar app
    </button>
  );
};

export default InstallPWAButton;
