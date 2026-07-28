/**
 * Analytics de uso interno do painel autenticado (produtor/equipe/inscrito).
 *
 * Separado de `analytics.ts` (que cobre a vitrine pública/marketing) — aqui o
 * objetivo é entender quais telas e funções são mais usadas dentro do app,
 * não conversão de visitante. Mesmo GA4 master (MASTER_GA4_ID), eventos
 * diferentes: `page_view` (troca de rota no painel) e `feature_used` (ação
 * de alto valor, ex. emitir certificados, gerar ordem inteligente).
 */

import { trackEvent, isAnalyticsActive } from './analytics';
import { Profile as UserProfile } from '../types';

/** Seta user_id (UUID do profile, sem PII) + role como user_property no GA4. */
export const identifyUser = (profile: UserProfile | null): void => {
  if (!isAnalyticsActive() || !profile) return;
  try {
    window.gtag!('set', {
      user_id: profile.id,
      user_properties: { app_role: profile.role },
    });
  } catch {
    // silencia
  }
};

/** Page view do painel autenticado — disparado a cada troca de rota. */
export const trackAppPageView = (path: string): void => {
  trackEvent('page_view', { page_path: path, page_location: window.location.href });
};

/** Uso de uma função/ação de alto valor dentro do painel (ex. 'emitir_certificados'). */
export const trackFeatureUsed = (featureName: string, params?: Record<string, any>): void => {
  trackEvent('feature_used', { feature_name: featureName, ...(params ?? {}) });
};
