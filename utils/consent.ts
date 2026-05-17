/**
 * Gerenciamento de consentimento de cookies (LGPD).
 *
 * Pixels de marketing (Meta Pixel + GA4) só carregam quando o usuário deu
 * consentimento explícito via banner. Estado persiste em localStorage por
 * 12 meses (ANPD recomenda renovar pelo menos 1x/ano). Sem consent → sem
 * cookies de marketing, sem identificação cross-site.
 *
 * Tracking interno (UTM em registrations) NÃO depende de consent: roda em
 * legítimo interesse pra atribuição de campanha do próprio festival. Sem
 * compartilhamento com terceiros.
 *
 * Categorias:
 * - "essential": sempre ativo (login, sessão, idioma). Sem opt-out.
 * - "marketing": Meta Pixel + GA4 + CAPI. Opt-in expresso.
 */

const STORAGE_KEY = 'coreohub_cookie_consent_v1';
const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 12 meses

export interface ConsentState {
  marketing: boolean;
  timestamp: number;
}

/** Lê o consent atual. Retorna null se nunca foi dado OU se expirou (> 12m). */
export function getConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: ConsentState = JSON.parse(raw);
    if (!parsed.timestamp || Date.now() - parsed.timestamp > CONSENT_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Salva consent. Quando marketing=true, dispara `coreohub:consent-granted`
 *  no window pra os componentes que precisam reagir (CookieBanner, ProducerPixels). */
export function setConsent(state: { marketing: boolean }): void {
  if (typeof window === 'undefined') return;
  const payload: ConsentState = { ...state, timestamp: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { /* localStorage cheio ou bloqueado — ignora */ }
  window.dispatchEvent(new CustomEvent('coreohub:consent-changed', { detail: payload }));
}

/** True quando user já aceitou marketing E o consent ainda é válido. */
export function hasMarketingConsent(): boolean {
  return getConsent()?.marketing === true;
}

/** Limpa consent (botão "revogar" — útil pra debug/teste). */
export function clearConsent(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('coreohub:consent-changed', { detail: null }));
}
