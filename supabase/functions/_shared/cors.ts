/**
 * CORS multi-origem — necessário desde que eventos passaram a ter domínio
 * próprio (festival.usualdance.com, etc). Antes ALLOWED_ORIGIN era 1 valor
 * fixo (FRONTEND_URL ?? app.coreohub.com); qualquer chamada vinda de um
 * domínio custom era bloqueada pelo browser (CORS) — checkout falhava
 * silenciosamente ("Load failed" no Safari/iOS).
 *
 * Allowlist: app.coreohub.com + domínios custom cadastrados em
 * middleware.ts (CUSTOM_DOMAIN_SLUGS) + staging.coreohub.com (ambiente de
 * staging, decretado 2026-08-11) + localhost pra dev.
 * Reflete o Origin da request se estiver na allowlist; senão cai no default.
 */

const DEFAULT_ORIGIN = 'https://app.coreohub.com'

const ALLOWED_ORIGINS = new Set<string>([
  DEFAULT_ORIGIN,
  'https://coreohub.com',
  'https://staging.coreohub.com',
  'https://festival.usualdance.com',
  'http://localhost:3000',
  'http://localhost:5173',
])

const extra = Deno.env.get('FRONTEND_URL')
if (extra) ALLOWED_ORIGINS.add(extra)

export function resolveOrigin(req: Request): string {
  const origin = req.headers.get('origin')
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin
  return DEFAULT_ORIGIN
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(req),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}
