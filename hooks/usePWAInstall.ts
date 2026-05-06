import { useEffect, useState } from 'react';

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

const ensureGlobalListener = () => {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    cachedPrompt = e as BeforeInstallPromptEvent;
    notifyAll();
  });
  window.addEventListener('appinstalled', () => {
    cachedPrompt = null;
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
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    cachedPrompt = null;
    notifyAll();
    return choice.outcome;
  };

  return { installPrompt, promptInstall };
};
