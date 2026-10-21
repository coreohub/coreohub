/**
 * Código curto de uma sessão de espetáculo, usado em `?sessao=` no link do evento principal.
 * Formato `AAAA-MM-DD-HHMM` (ex.: 2026-11-30-1930). É único dentro do grupo: duplicate_event_session
 * não deixa criar duas sessões com a mesma data e horário.
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

/** Caminho público de uma sessão: o link do principal; as demais levam `?sessao=<código>`. */
export const sessionPath = (
  principalSlug: string,
  session: { id: string; start_date?: string | null; event_time?: string | null },
  principalId: string | null,
): string => {
  const base = `/evento/${principalSlug}`;
  if (session.id === principalId) return base;
  const code = sessionCode(session.start_date, session.event_time);
  return code ? `${base}?sessao=${code}` : base;
};
