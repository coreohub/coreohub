// Credenciamento de ingresso: o ingresso é de UMA sessão (cada sessão é um evento). Aqui fica a regra
// pura que diz se o ingresso lido na portaria é da sessão que está acontecendo agora.
// Testado em tests/checkin-session.test.ts.

export interface SessionInfo {
  id: string;
  name?: string | null;
  start_date: string | null;
  end_date?: string | null;
  event_time: string | null;
  session_group_id?: string | null;
  sessao_status?: string | null;
}

export type SessionVerdict =
  | { level: 'ok' }
  | { level: 'warn'; reason: 'sessao_cancelada' | 'outro_dia' | 'outra_sessao'; message: string };

const ymd = (d: string | null | undefined): string | null => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
const brDay = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const hhmm = (t: string | null | undefined): string | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

/** Rótulo curto: "20/12 às 15:30" (ou só "20/12" sem horário). */
export function sessionText(s: Pick<SessionInfo, 'start_date' | 'event_time'> | null | undefined): string {
  const d = ymd(s?.start_date);
  if (!d) return '';
  const h = hhmm(s?.event_time);
  return `${brDay(d)}${h ? ` às ${h}` : ''}`;
}

/** Hoje no calendário de Brasília (AAAA-MM-DD), mesmo com o aparelho em outro fuso. */
export function todayBrasilia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Minutos desde 00:00 de Brasília. */
function minutesBrasilia(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

const toMinutes = (t: string | null | undefined): number | null => {
  const h = hhmm(t);
  return h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) : null;
};

/**
 * O ingresso de `ticketSession` vale agora? `siblings` são TODAS as sessões do mesmo espetáculo
 * (inclui a do ingresso). Avisa, sem decidir sozinho: o operador pode liberar mesmo assim.
 * - sessão cancelada;
 * - hoje fora das datas do evento (ingresso de outro dia);
 * - mesmo dia, mas outra sessão do espetáculo está mais perto do horário atual.
 */
export function checkTicketSession(ticketSession: SessionInfo | null | undefined, siblings: SessionInfo[], now: Date = new Date()): SessionVerdict {
  if (!ticketSession) return { level: 'ok' };
  if (ticketSession.sessao_status === 'cancelada') {
    return { level: 'warn', reason: 'sessao_cancelada', message: `A sessão deste ingresso (${sessionText(ticketSession)}) foi cancelada.` };
  }
  const start = ymd(ticketSession.start_date);
  if (!start) return { level: 'ok' };
  const end = ymd(ticketSession.end_date) ?? start;
  const today = todayBrasilia(now);
  // Sessão que passa da meia-noite: até as 06:00 do dia seguinte ainda vale o dia anterior.
  const nextDay = (iso: string) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const afterMidnight = today === nextDay(end) && minutesBrasilia(now) < 6 * 60;
  if (today < start || (today > end && !afterMidnight)) {
    return { level: 'warn', reason: 'outro_dia', message: `Este ingresso é da sessão ${sessionText(ticketSession)}, e hoje é ${brDay(today)}.` };
  }
  const myMin = toMinutes(ticketSession.event_time);
  if (myMin !== null) {
    const nowMin = minutesBrasilia(now);
    const sameDay = siblings.filter(x => x.id !== ticketSession.id && ymd(x.start_date) === start && x.sessao_status !== 'cancelada' && toMinutes(x.event_time) !== null);
    const closer = sameDay.find(x => Math.abs((toMinutes(x.event_time) as number) - nowMin) < Math.abs(myMin - nowMin));
    // Só avisa quando o horário atual está longe da sessão do ingresso (mais de 3h): atraso comum não incomoda.
    if (closer && Math.abs(myMin - nowMin) > 180) {
      return { level: 'warn', reason: 'outra_sessao', message: `Este ingresso é da sessão das ${hhmm(ticketSession.event_time)}, mas agora está mais perto da sessão das ${hhmm(closer.event_time)}.` };
    }
  }
  return { level: 'ok' };
}
