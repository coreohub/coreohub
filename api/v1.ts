/**
 * API pública v1 da CoreoHub (somente leitura, sem autenticação).
 *   GET /api/v1/eventos          → lista de eventos públicos (limit, offset)
 *   GET /api/v1/eventos/{slug}   → um evento público
 * O vercel.json reescreve /api/v1/:path* para cá (?path=...). Todo erro é JSON
 * ({error, message, hint, status}). Política de versão e depreciação: /desenvolvedores.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  API_VERSION, apiError, findPublicEvent, isValidSlug, listPublicEvents, parseListParams, type ApiErrorBody, type EventRow,
} from './_public-events.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ghpltzzijlvykiytwslu.supabase.co';
// Anon key é pública por design; a RLS de events restringe o SELECT a is_public=true.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const COLS = 'id,slug,name,description,cover_url,start_date,end_date,event_time,city,state,location,session_group_id,sessao_status';

function baseHeaders(res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-API-Version', API_VERSION);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  res.setHeader('Link', '</openapi.json>; rel="service-desc"; type="application/json", <https://coreohub.com/desenvolvedores>; rel="service-doc"');
  res.setHeader('Vary', 'Accept');
}

function fail(res: VercelResponse, body: ApiErrorBody) {
  res.setHeader('Cache-Control', body.status >= 500 ? 'no-store' : 'public, max-age=0, s-maxage=60');
  res.status(body.status).send(JSON.stringify(body));
}

async function loadRows(): Promise<EventRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/events?select=${COLS}&is_public=eq.true&payment_sandbox=eq.false&order=start_date.desc&limit=1000`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return (await r.json()) as EventRow[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  baseHeaders(res);
  const rawPath = Array.isArray(req.query?.path) ? req.query.path.join('/') : String(req.query?.path ?? '');
  const parts = rawPath.split('/').filter(Boolean);
  const shownPath = `/api/v1/${parts.join('/')}`.replace(/\/$/, '').slice(0, 200);
  const method = (req.method ?? 'GET').toUpperCase();

  if (method === 'OPTIONS') { res.status(204).end(); return; }
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return fail(res, apiError(405, 'method_not_allowed', `O método ${method} não é aceito.`, 'Esta API é somente leitura: use GET.', shownPath));
  }

  const notFound = () => fail(res, apiError(404, 'not_found', 'Recurso inexistente.', 'Os recursos disponíveis são /api/v1/eventos e /api/v1/eventos/{slug}. Veja https://coreohub.com/openapi.json.', shownPath));
  if (parts[0] !== 'eventos' || parts.length > 2) return notFound();
  if (parts.length === 2 && !isValidSlug(parts[1])) return notFound();

  let listParams = null as ReturnType<typeof parseListParams> | null;
  if (parts.length === 1) {
    listParams = parseListParams(req.query ?? {});
    if (!listParams.ok) return fail(res, listParams.error as ApiErrorBody);
  }

  if (!SUPABASE_ANON_KEY) return fail(res, apiError(503, 'service_unavailable', 'Serviço temporariamente indisponível.', 'Tente novamente em instantes ou fale com contato@coreohub.com.'));

  let rows: EventRow[];
  try {
    rows = await loadRows();
  } catch (e) {
    console.error('[api/v1] falha ao ler eventos:', e);
    return fail(res, apiError(502, 'upstream_error', 'Não foi possível ler os eventos agora.', 'Tente novamente em instantes. Se persistir, escreva para contato@coreohub.com.'));
  }

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  if (parts.length === 2) {
    const ev = findPublicEvent(rows, parts[1]);
    if (!ev) return notFound();
    res.status(200).send(JSON.stringify(ev));
    return;
  }
  const { limit, offset } = listParams!.value!;
  const all = listPublicEvents(rows);
  res.status(200).send(JSON.stringify({ data: all.slice(offset, offset + limit), meta: { total: all.length, limit, offset, api_version: API_VERSION } }));
}
