/**
 * Wrapper fino sobre o gtag.js do Google Analytics 4 (Fase 4 completa).
 *
 * O script gtag é carregado em index.html SÓ em app.coreohub.com. Em qualquer
 * outro hostname (dev local, preview Vercel, staging), window.gtag fica
 * undefined — os helpers viram no-op silencioso. Sem poluir relatório com
 * tráfego de teste.
 *
 * Eventos padronizados:
 * - page_view         → React Router (App.tsx) ao mudar de rota
 * - campaign_landing  → captureUtmsFromUrl (quando chega com ?utm_*)
 * - view_event        → PublicEventPage (visualizou vitrine)
 * - begin_checkout    → InscricaoWizard/NewRegistration (clicou Inscreva-se)
 * - purchase          → asaas-webhook (server-side via Measurement Protocol — futuro)
 *
 * GA4 cria conversões automaticamente pra eventos com nomes reservados
 * (purchase, begin_checkout). Outros eventos custom podem ser marcados
 * como conversão no painel.
 */

/** Measurement ID do GA4 master da CoreoHub. Espelha o ID hardcoded em index.html. */
export const MASTER_GA4_ID = 'G-Y7N93KHNP8';

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

/** True se gtag está disponível (i.e. estamos em prod com script carregado). */
export const isAnalyticsActive = (): boolean =>
  typeof window !== 'undefined' && typeof window.gtag === 'function';

/**
 * Dispara um evento custom no GA4. No-op silencioso se gtag não carregado
 * (dev/preview). Params livres — GA4 aceita até 25 por evento.
 *
 * `sendTo` opcional restringe destinos. Quando omitido, GA4 manda pra TODOS
 * os streams configurados via gtag('config', X). Usar `sendTo` é a maneira
 * oficial de isolar eventos por stream em ambiente multi-tenant (master +
 * pixel do produtor), evitando que eventos do Festival B vazem pro GA4 do
 * Festival A que ainda está configurado na sessão.
 *
 * @example trackEvent('view_event', { event_slug: 'usualdance-2026' }, ['G-MASTER', 'G-PROD'])
 */
export const trackEvent = (
  name: string,
  params?: Record<string, any>,
  sendTo?: Array<string | null | undefined>,
): void => {
  if (!isAnalyticsActive()) return;
  try {
    const targets = (sendTo ?? []).filter((id): id is string => !!id);
    const finalParams = targets.length > 0
      ? { ...(params ?? {}), send_to: targets }
      : (params ?? {});
    window.gtag!('event', name, finalParams);
  } catch {
    // gtag pode falhar em browsers com bloqueador de tracking — silencia.
  }
};

/** Page view manual (SPA — não há navegação real entre páginas). */
export const trackPageView = (path: string, title?: string): void => {
  if (!isAnalyticsActive()) return;
  try {
    window.gtag!('event', 'page_view', {
      page_path: path,
      page_title: title ?? document.title,
      page_location: window.location.href,
    });
  } catch {
    // silencia
  }
};
