/**
 * Lógica pura da API pública v1 (somente leitura). Vive fora do handler para ser testável.
 * A visibilidade espelha a vitrine (pages/Festivais.tsx): evento público, fora do sandbox de
 * pagamento, com capa E descrição. Nada financeiro nem de inscrito sai por aqui.
 */

export const API_VERSION = '1';
export const SITE_APP_URL = 'https://app.coreohub.com';
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export type EventRow = {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  start_date: string | null;
  end_date: string | null;
  event_time: string | null;
  city: string | null;
  state: string | null;
  location: string | null;
  session_group_id: string | null;
  sessao_status: string | null;
};

export type PublicEvent = {
  slug: string;
  name: string;
  description: string;
  cover_url: string;
  start_date: string | null;
  end_date: string | null;
  event_time: string | null;
  city: string | null;
  state: string | null;
  location: string | null;
  url: string;
  sessions?: { start_date: string | null; event_time: string | null }[];
};

export type ApiErrorBody = {
  error: string;
  message: string;
  hint: string;
  status: number;
  path?: string;
};

export const apiError = (status: number, error: string, message: string, hint: string, path?: string): ApiErrorBody => ({
  error,
  message,
  hint,
  status,
  ...(path ? { path } : {}),
});

const bySession = (a: { start_date: string | null; event_time: string | null }, b: { start_date: string | null; event_time: string | null }) =>
  (a.start_date ?? '').localeCompare(b.start_date ?? '') || (a.event_time ?? '').localeCompare(b.event_time ?? '');

const toPublic = (e: EventRow, sessions?: PublicEvent['sessions']): PublicEvent => ({
  slug: e.slug as string,
  name: e.name,
  description: (e.description ?? '').trim(),
  cover_url: e.cover_url as string,
  start_date: e.start_date,
  end_date: e.end_date,
  event_time: e.event_time,
  city: e.city,
  state: e.state,
  location: e.location,
  url: `${SITE_APP_URL}/evento/${e.slug}`,
  ...(sessions ? { sessions } : {}),
});

/** Eventos completos o bastante para a vitrine (slug, capa e descrição). Linhas do banco já vêm filtradas por is_public e fora do sandbox. */
export const completeRows = (rows: EventRow[]): EventRow[] =>
  rows.filter((e) => e.slug && e.cover_url && (e.description ?? '').trim());

/** Lista da vitrine: espetáculo com várias sessões vira UM item (o principal), com as sessões não canceladas. */
export function listPublicEvents(rows: EventRow[]): PublicEvent[] {
  const complete = completeRows(rows);
  const groups = new Map<string, EventRow[]>();
  for (const e of complete) {
    if (!e.session_group_id) continue;
    groups.set(e.session_group_id, [...(groups.get(e.session_group_id) ?? []), e]);
  }
  const out: PublicEvent[] = [];
  for (const e of complete) {
    const g = e.session_group_id ? groups.get(e.session_group_id) : undefined;
    if (!g || g.length < 2) { out.push(toPublic(e)); continue; }
    const anchor = g.find((x) => x.id === e.session_group_id) ?? [...g].sort(bySession)[0];
    if (anchor.id !== e.id) continue;
    const live = g.filter((x) => x.sessao_status !== 'cancelada');
    const sessions = live.map((x) => ({ start_date: x.start_date, event_time: x.event_time })).sort(bySession);
    out.push(toPublic(e, sessions));
  }
  return out;
}

/** Detalhe por slug (aceita também o slug de uma sessão). */
export function findPublicEvent(rows: EventRow[], slug: string): PublicEvent | null {
  const hit = completeRows(rows).find((e) => e.slug === slug);
  return hit ? toPublic(hit) : null;
}

export type ListParams = { limit: number; offset: number };

/** Valida limit/offset. Devolve o erro 400 pronto quando inválido. */
export function parseListParams(query: Record<string, unknown>): { ok: boolean; value?: ListParams; error?: ApiErrorBody } {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const parse = (raw: unknown, name: string, min: number, max: number, def: number) => {
    const v = one(raw);
    if (v === undefined || v === '') return { n: def } as const;
    const s = String(v);
    if (!/^\d+$/.test(s)) return { err: `O parâmetro "${name}" deve ser um número inteiro entre ${min} e ${max}.` } as const;
    const n = Number(s);
    if (n < min || n > max) return { err: `O parâmetro "${name}" deve ser um número inteiro entre ${min} e ${max}.` } as const;
    return { n } as const;
  };
  const l = parse(query.limit, 'limit', 1, MAX_LIMIT, DEFAULT_LIMIT);
  if ('err' in l) return { ok: false, error: apiError(400, 'invalid_parameter', l.err, `Use limit de 1 a ${MAX_LIMIT} (padrão ${DEFAULT_LIMIT}).`) };
  const o = parse(query.offset, 'offset', 0, 100000, 0);
  if ('err' in o) return { ok: false, error: apiError(400, 'invalid_parameter', o.err, 'Use offset a partir de 0 para paginar.') };
  return { ok: true, value: { limit: l.n, offset: o.n } };
}

/** Valida o slug da rota de detalhe (só letras, números e hífen). */
export const isValidSlug = (s: string): boolean => /^[a-z0-9][a-z0-9-]{0,119}$/i.test(s);
