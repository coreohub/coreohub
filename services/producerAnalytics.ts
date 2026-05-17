/**
 * Eventos sincronizados em GA4 + Meta Pixel (CoreoHub master + pixels do produtor).
 *
 * Isolamento multi-tenant: ProducerPixels faz `gtag('config', producerId)` e
 * `fbq('init', producerId)` quando user abre festival do produtor X. Quando
 * navega pro festival do produtor Y, os IDs do X CONTINUAM registrados na
 * sessão (gtag/fbq não tem unconfig oficial). Pra evitar que eventos do Y
 * vazem pros pixels do X, este wrapper dispara com endereçamento explícito:
 *
 * - GA4: `gtag('event', name, { ...params, send_to: [master, producer] })`
 * - Meta: `fbq('trackSingle', pixelId, event, params)` chamado uma vez por pixel
 *
 * `producerIds` é opcional — quando não passa, dispara só pro master.
 *
 * Mapeamento de nomes (GA4 → Meta Pixel padrão):
 * - view_event       → ViewContent
 * - begin_checkout   → InitiateCheckout
 * - purchase         → Purchase
 */

import { trackEvent as trackGa4, MASTER_GA4_ID } from './analytics';

/** Pixel ID do Meta Pixel master da CoreoHub. Espelha o ID hardcoded em index.html. */
const MASTER_META_PIXEL_ID = '968125229155814';

const isPixelActive = (): boolean =>
  typeof window !== 'undefined' && typeof window.fbq === 'function';

/** Dispara `fbq('trackSingle', pixelId, event, params)` em IDs específicos. */
const trackMetaTargeted = (
  event: string,
  params: Record<string, any>,
  pixelIds: Array<string | null | undefined>,
): void => {
  if (!isPixelActive()) return;
  for (const pixelId of pixelIds) {
    if (!pixelId) continue;
    try {
      window.fbq!('trackSingle', pixelId, event, params);
    } catch {
      // bloqueador ativo — silencia
    }
  }
};

declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
    _fbq?: any;
  }
}

export interface ProducerPixelIds {
  /** Measurement ID GA4 do produtor (G-XXXXXXXXXX). */
  ga4?: string | null;
  /** Pixel ID Meta do produtor (15-16 dígitos). */
  pixel?: string | null;
}

/** Coleta IDs ativos (master + produtor) pra um destino. Filtra falsy. */
const ga4Targets = (producer?: ProducerPixelIds) => [MASTER_GA4_ID, producer?.ga4];
const pixelTargets = (producer?: ProducerPixelIds) => [MASTER_META_PIXEL_ID, producer?.pixel];

/**
 * Dispara `view_event` (GA4) + `ViewContent` (Meta).
 * Use quando inscrito carrega a vitrine pública do festival.
 */
export const trackViewEvent = (
  params: { event_slug: string; event_name: string },
  producer?: ProducerPixelIds,
): void => {
  trackGa4('view_event', params, ga4Targets(producer));
  trackMetaTargeted('ViewContent', {
    content_type: 'product',
    content_ids: [params.event_slug],
    content_name: params.event_name,
  }, pixelTargets(producer));
};

/**
 * Dispara `begin_checkout` (GA4) + `InitiateCheckout` (Meta).
 * Use quando inscrito clica em "Inscreva-se" ou começa fluxo de inscrição.
 */
export const trackBeginCheckout = (
  params: {
    event_slug: string;
    event_name: string;
    /** Modalidade selecionada (Solo/Duo/Trio/Grupo) se já souber. */
    modalidade?: string;
    /** Valor da inscrição se já souber. */
    value?: number;
  },
  producer?: ProducerPixelIds,
): void => {
  trackGa4('begin_checkout', params, ga4Targets(producer));
  trackMetaTargeted('InitiateCheckout', {
    content_type: 'product',
    content_ids: [params.event_slug],
    content_name: params.event_name,
    content_category: params.modalidade,
    value: params.value,
    currency: 'BRL',
  }, pixelTargets(producer));
};

/**
 * Dispara `purchase` (GA4) + `Purchase` (Meta).
 * Use quando inscrição vira APROVADO (página de sucesso pós-pagamento).
 *
 * Importante: client-side perde ~30% iOS/adblock. Pra recuperar, Conversions
 * API server-side via webhook Asaas (Subfase futura).
 */
export const trackPurchase = (
  params: {
    transaction_id: string;
    event_slug: string;
    event_name: string;
    value: number;
  },
  producer?: ProducerPixelIds,
): void => {
  trackGa4('purchase', {
    transaction_id: params.transaction_id,
    currency: 'BRL',
    value: params.value,
    items: [{ item_id: params.event_slug, item_name: params.event_name }],
  }, ga4Targets(producer));
  trackMetaTargeted('Purchase', {
    content_type: 'product',
    content_ids: [params.event_slug],
    content_name: params.event_name,
    value: params.value,
    currency: 'BRL',
  }, pixelTargets(producer));
};
