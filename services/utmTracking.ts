/**
 * UTM tracking de atribuição (Fase 4 parcial — sem GA4 ainda).
 *
 * Captura parâmetros utm_* da URL na primeira visita, persiste em sessionStorage,
 * e devolve no momento da inscrição pra salvar em registrations. Permite produtor
 * saber de onde veio cada venda (Instagram, WhatsApp, direct, etc).
 *
 * Quando GA4 for adicionado (Fase 4 completa), basta plugar gtag('event',
 * 'campaign_landing', utms) no captureUtmsFromUrl().
 *
 * Por que sessionStorage e não localStorage:
 * - Persistir UTM por toda a sessão atual (inclui navegação entre páginas)
 * - Não contaminar visitas futuras "diretas" com atribuição antiga
 * - Padrão GA4 (eles usam ~30min de janela)
 */

const STORAGE_KEY = 'coreohub_utm';

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  /** Timestamp da primeira captura — útil pra debug. */
  captured_at?: string;
}

/**
 * Captura utm_* da URL atual e persiste em sessionStorage.
 * Chama no primeiro mount do app (App.tsx). Idempotente — se já tem UTMs salvos
 * e a URL atual NÃO tem UTMs novos, mantém os antigos.
 *
 * Comportamento "first-touch" + "last-touch hibrido":
 * - 1ª visita com ?utm_source=instagram → salva
 * - Usuario navega pra outra página sem UTM → mantém Instagram salvo
 * - Usuario volta com novo ?utm_source=whatsapp → sobrescreve com WhatsApp
 *   (last-touch wins quando há novo UTM explícito)
 */
export const captureUtmsFromUrl = (): UtmParams | null => {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const utm: UtmParams = {};
  let hasAnyUtm = false;

  (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const).forEach((key) => {
    const value = params.get(key);
    if (value) {
      utm[key] = value.slice(0, 100); // proteção contra abuso
      hasAnyUtm = true;
    }
  });

  if (!hasAnyUtm) {
    // Sem UTM novo na URL — devolve o que já tava salvo (se houver).
    return getStoredUtms();
  }

  utm.captured_at = new Date().toISOString();
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(utm));
  } catch {
    // sessionStorage pode falhar em modo privado de alguns navegadores — silencia.
  }
  return utm;
};

/** Lê UTMs salvos. Retorna null se nada salvo ou sessionStorage indisponível. */
export const getStoredUtms = (): UtmParams | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UtmParams;
  } catch {
    return null;
  }
};

/** Limpa UTMs salvos (chamar após gravar na inscrição pra não duplicar atribuição). */
export const clearStoredUtms = (): void => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // silencia
  }
};

/**
 * Snapshot pronto pra salvar em registrations.
 * Retorna objeto com chaves exatas das colunas do banco (utm_source, etc).
 * Strip do captured_at porque não é coluna do banco.
 */
export const getUtmsForRegistration = (): Pick<UtmParams, 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term'> | null => {
  const utms = getStoredUtms();
  if (!utms) return null;
  const { captured_at: _captured_at, ...registrationFields } = utms;
  // Se todos os campos forem undefined, retorna null em vez de objeto vazio.
  const hasAny = Object.values(registrationFields).some(Boolean);
  return hasAny ? registrationFields : null;
};
