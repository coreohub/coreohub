/**
 * Injeção dinâmica dos pixels de marketing do produtor (Fase 4B).
 *
 * Quando produtor cadastra GA4 + Meta Pixel em /configurações, esses scripts
 * carregam ADICIONALMENTE aos pixels master da CoreoHub (que vivem no
 * index.html). Eventos disparam em ambos em paralelo.
 *
 * Renderiza apenas em páginas públicas do festival:
 * - PublicEventPage (vitrine)
 * - InscricaoWizard
 * - Checkout
 * - Página de sucesso
 *
 * Multi-tenant: gtag/fbq não tem unconfig oficial — IDs configurados ficam
 * registrados até refresh. Pra evitar pollution entre festivais, o disparo
 * de eventos usa `send_to` (GA4) e `trackSingle` (Meta) com IDs explícitos,
 * via `services/producerAnalytics.ts`. Este componente só é responsável por
 * REGISTRAR o ID do produtor — o roteamento por destino fica no wrapper.
 *
 * `onReady` é chamado APÓS o registro (ou imediatamente em dev). Páginas
 * usam isso pra adiar o disparo do view_event/purchase até ter certeza
 * que o stream do produtor está pronto pra receber.
 *
 * IDs públicos por design — vão no HTML. Sem risco de segurança.
 */

import { useEffect } from 'react';
import { hasMarketingConsent } from '../utils/consent';

interface Props {
  ga4Id?: string | null;
  metaPixelId?: string | null;
  /** Disparado depois do init (ou imediatamente em dev/sem-IDs/sem-consent). */
  onReady?: () => void;
}

declare global {
  interface Window {
    /** Map de IDs do produtor já inicializados nesta sessão pra evitar re-init. */
    __coreohub_producer_pixels?: Set<string>;
  }
}

const isProd = (): boolean =>
  typeof window !== 'undefined' && window.location.hostname === 'app.coreohub.com';

/** Valida formato GA4 — começa com G- + 6-15 chars alfanum. */
const isValidGa4 = (id: string | null | undefined): id is string =>
  !!id && /^G-[A-Z0-9]{6,15}$/i.test(id);

/** Valida Pixel ID — 13-16 dígitos numéricos. */
const isValidPixel = (id: string | null | undefined): id is string =>
  !!id && /^\d{13,16}$/.test(id);

export default function ProducerPixels({ ga4Id, metaPixelId, onReady }: Props) {
  useEffect(() => {
    // Em dev/preview os scripts master nem carregam — libera o ready
    // imediatamente pra não bloquear o disparo dos eventos.
    if (!isProd()) {
      onReady?.();
      return;
    }
    // LGPD: sem consent → não inicializa pixel do produtor (master também
    // já foi gated em index.html). onReady ainda dispara pra não travar UI
    // de tracking caller — `trackEvent`/`trackMeta` viram no-op naturalmente
    // porque `window.gtag`/`window.fbq` continuam undefined.
    if (!hasMarketingConsent()) {
      onReady?.();
      return;
    }

    window.__coreohub_producer_pixels = window.__coreohub_producer_pixels ?? new Set<string>();
    const initialized = window.__coreohub_producer_pixels;

    // ── GA4 do produtor (config adicional no gtag master) ──
    if (isValidGa4(ga4Id) && !initialized.has(`ga4:${ga4Id}`)) {
      try {
        if (typeof window.gtag === 'function') {
          window.gtag('config', ga4Id, { send_page_view: false });
          initialized.add(`ga4:${ga4Id}`);
        }
      } catch {
        // gtag não carregado (adblock, etc) — silencia
      }
    }

    // ── Meta Pixel do produtor (fbq init adicional) ──
    if (isValidPixel(metaPixelId) && !initialized.has(`fbq:${metaPixelId}`)) {
      try {
        if (typeof window.fbq === 'function') {
          window.fbq('init', metaPixelId);
          // PageView do pixel do produtor — explicitamente endereçado
          // pra não duplicar com o PageView automático do master.
          window.fbq('trackSingle', metaPixelId, 'PageView');
          initialized.add(`fbq:${metaPixelId}`);
        }
      } catch {
        // fbq não carregado — silencia
      }
    }

    onReady?.();
  }, [ga4Id, metaPixelId, onReady]);

  return null;
}
