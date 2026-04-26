import { useSyncExternalStore } from 'react';
import judgePt, { type JudgeDictKey } from '../i18n/judge-pt';
import judgeEn from '../i18n/judge-en';
import judgeEs from '../i18n/judge-es';

export type Locale = 'pt' | 'en' | 'es';

const LS_KEY = 'judge-locale';

const DICTS: Record<Locale, Record<JudgeDictKey, string>> = {
  pt: judgePt,
  en: judgeEn,
  es: judgeEs,
};

const readStoredLocale = (): Locale => {
  if (typeof window === 'undefined') return 'pt';
  try {
    const v = window.localStorage.getItem(LS_KEY);
    if (v === 'en') return 'en';
    if (v === 'es') return 'es';
    return 'pt';
  } catch {
    return 'pt';
  }
};

let currentLocale: Locale = readStoredLocale();
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const getSnapshot = () => currentLocale;

export const setLocale = (loc: Locale): void => {
  if (loc === currentLocale) return;
  currentLocale = loc;
  try { window.localStorage.setItem(LS_KEY, loc); } catch { /* noop */ }
  listeners.forEach(l => l());
};

export const useLocale = (): Locale =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export type Translator = (key: JudgeDictKey, vars?: Record<string, string | number>) => string;

export const useT = (): Translator => {
  const locale = useLocale();
  const dict = DICTS[locale];
  return (key, vars) => {
    let s: string = dict[key] ?? key;
    if (vars) {
      for (const k in vars) {
        s = s.split(`{${k}}`).join(String(vars[k]));
      }
    }
    return s;
  };
};
