/**
 * Identificador de uma sessão de espetáculo no link do evento principal: `?sessao=<chave>`.
 *
 * A chave é o slug da sessão sem o prefixo do slug do principal. Principal `festival-level-up-2026` e
 * sessão `festival-level-up-2026-sessao-2` viram `?sessao=sessao-2`. Se o slug da sessão não começa com o
 * do principal, a chave é o slug inteiro. O código `AAAA-MM-DD-HHMM` (data e horário) continua sendo
 * aceito na leitura, mas nenhum link novo é gerado com ele.
 */
const CODE_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/;

export const sessionCode = (startDate?: string | null, eventTime?: string | null): string | null => {
  if (!startDate || !eventTime) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(eventTime);
  if (!m) return null;
  return `${startDate.slice(0, 10)}-${m[1].padStart(2, '0')}${m[2]}`;
};

export const parseSessionCode = (code?: string | null): { date: string; time: string } | null => {
  const m = code ? CODE_RE.exec(code) : null;
  return m ? { date: m[1], time: `${m[2]}:${m[3]}` } : null;
};

type SessionLike = { id: string; slug?: string | null; start_date?: string | null; event_time?: string | null };

/** Chave legível da sessão (parte do slug depois do slug do principal). Cai pro código, depois pro id. */
export const sessionKey = (principalSlug: string | null | undefined, session: SessionLike): string => {
  const slug = session.slug ?? '';
  if (slug && principalSlug && slug.startsWith(`${principalSlug}-`) && slug.length > principalSlug.length + 1) {
    return slug.slice(principalSlug.length + 1);
  }
  return slug || sessionCode(session.start_date, session.event_time) || session.id;
};

/** Slugs candidatos para uma chave vinda de `?sessao=`: a chave pura e a chave com o prefixo do principal. */
export const sessionSlugCandidates = (principalSlug: string | null | undefined, key: string): string[] =>
  principalSlug ? [key, `${principalSlug}-${key}`] : [key];

/** Caminho público de uma sessão: o link do principal; as demais levam `?sessao=<chave>`. */
export const sessionPath = (
  principalSlug: string,
  session: SessionLike,
  principalId: string | null,
): string => {
  const base = `/evento/${principalSlug}`;
  if (session.id === principalId) return base;
  return `${base}?sessao=${encodeURIComponent(sessionKey(principalSlug, session))}`;
};
