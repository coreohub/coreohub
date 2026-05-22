import { useEffect, useState } from 'react';
import { trackEvent } from '../services/analytics';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let cachedPrompt: BeforeInstallPromptEvent | null = null;
let listenerInstalled = false;
const subscribers = new Set<(p: BeforeInstallPromptEvent | null) => void>();

const notifyAll = () => {
  for (const cb of subscribers) cb(cachedPrompt);
};

/** Tracking PWA — eventos custom no GA4 (master) + Meta Pixel se disponivel.
 *  Mede o funil completo: prompt disponivel → exibido → aceito/rejeitado →
 *  instalado. Sessão 4.2 B5 (2026-05-21). */
const trackPwa = (event: string, extra?: Record<string, any>) => {
  try {
    trackEvent(event, {
      ...(extra ?? {}),
      // useful pra cruzar com sessões: sabe se ja tinha PWA antes
      display_mode: typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
        ? 'standalone'
        : 'browser',
    });
    // Meta Pixel custom event paralelo — usa trackCustom pra não conflitar
    // com eventos padrão (Lead/Purchase/etc) que tem regras de attribution.
    if (typeof window !== 'undefined' && typeof (window as any).fbq === 'function') {
      (window as any).fbq('trackCustom', event, extra ?? {});
    }
  } catch {
    // silencia — analytics nunca pode quebrar o app
  }
};

const ensureGlobalListener = () => {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    cachedPrompt = e as BeforeInstallPromptEvent;
    // Browser sinalizou que o app e instalavel — o usuario AINDA nao viu prompt,
    // mas existe a possibilidade. Dispara so 1 vez por sessao via cachedPrompt.
    trackPwa('pwa_install_available');
    notifyAll();
  });
  window.addEventListener('appinstalled', () => {
    cachedPrompt = null;
    // Confirmacao oficial — usuario completou o instalador do SO.
    trackPwa('pwa_installed');
    notifyAll();
  });
};

/**
 * Single-source-of-truth pro evento `beforeinstallprompt`. Sem isso, dois
 * componentes que registram o listener competem pelo evento — quem registra
 * antes "rouba" e o outro fica sem prompt (bug observado no botão da aba Geral).
 */
export const usePWAInstall = () => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(cachedPrompt);

  useEffect(() => {
    ensureGlobalListener();
    subscribers.add(setInstallPrompt);
    setInstallPrompt(cachedPrompt);
    return () => { subscribers.delete(setInstallPrompt); };
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | null> => {
    if (!installPrompt) return null;
    // Antes de prompt(): user CLICOU no botao de instalar (intenção explicita).
    trackPwa('pwa_install_prompt_shown');
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    // Outcome do prompt nativo do navegador. "accepted" significa que o user
    // clicou no botao de confirmar — `appinstalled` ainda vai disparar.
    trackPwa(choice.outcome === 'accepted' ? 'pwa_install_accepted' : 'pwa_install_dismissed');
    cachedPrompt = null;
    notifyAll();
    return choice.outcome;
  };

  return { installPrompt, promptInstall };
};
