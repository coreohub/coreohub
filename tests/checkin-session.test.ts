import { describe, it, expect } from 'vitest';
import { checkTicketSession, sessionText, todayBrasilia, type SessionInfo } from '../utils/checkinSession';

const s = (id: string, d: string, t: string | null, extra: Partial<SessionInfo> = {}): SessionInfo => ({ id, start_date: d, event_time: t, ...extra });
const s1 = s('a', '2026-12-20', '15:30:00');
const s2 = s('b', '2026-12-20', '19:30:00');
const s3 = s('c', '2026-12-21', '19:30:00');
const at = (iso: string) => new Date(iso);

describe('sessionText / todayBrasilia', () => {
  it('rotulo', () => {
    expect(sessionText(s1)).toBe('20/12 às 15:30');
    expect(sessionText(s('x', '2026-12-20', null))).toBe('20/12');
    expect(sessionText(null)).toBe('');
  });
  it('hoje em Brasilia (01:30 UTC ainda e o dia anterior em BRT)', () => {
    expect(todayBrasilia(at('2026-12-21T01:30:00Z'))).toBe('2026-12-20');
  });
});

describe('checkTicketSession', () => {
  const all = [s1, s2, s3];
  it('sessao certa, no horario', () => {
    expect(checkTicketSession(s2, all, at('2026-12-20T19:00:00-03:00')).level).toBe('ok');
    expect(checkTicketSession(s1, all, at('2026-12-20T15:00:00-03:00')).level).toBe('ok');
  });
  it('ingresso das 15:30 lido as 19:20 avisa outra sessao', () => {
    const v = checkTicketSession(s1, all, at('2026-12-20T19:20:00-03:00'));
    expect(v).toMatchObject({ level: 'warn', reason: 'outra_sessao' });
    expect((v as any).message).toMatch(/15:30/);
    expect((v as any).message).toMatch(/19:30/);
  });
  it('ingresso das 19:30 lido a tarde: a das 15:30 e mais perto', () => {
    expect(checkTicketSession(s2, all, at('2026-12-20T14:30:00-03:00'))).toMatchObject({ level: 'warn', reason: 'outra_sessao' });
  });
  it('atraso comum (ate 3h) nao avisa', () => {
    expect(checkTicketSession(s('p', '2026-12-20', '15:00'), [s('p', '2026-12-20', '15:00'), s('q', '2026-12-20', '20:00')], at('2026-12-20T17:45:00-03:00')).level).toBe('ok');
  });
  it('sessao que passa da meia-noite vale ate as 06:00 do dia seguinte', () => {
    const late = s('l', '2026-12-20', '23:00', { end_date: '2026-12-20' });
    expect(checkTicketSession(late, [late], at('2026-12-21T00:30:00-03:00')).level).toBe('ok');
    expect(checkTicketSession(late, [late], at('2026-12-21T08:00:00-03:00')).level).toBe('warn');
  });
  it('outro dia', () => {
    expect(checkTicketSession(s3, all, at('2026-12-20T19:30:00-03:00'))).toMatchObject({ level: 'warn', reason: 'outro_dia' });
    expect(checkTicketSession(s1, all, at('2026-12-22T10:00:00-03:00'))).toMatchObject({ level: 'warn', reason: 'outro_dia' });
  });
  it('sessao cancelada', () => {
    expect(checkTicketSession(s('z', '2026-12-20', '15:30', { sessao_status: 'cancelada' }), all, at('2026-12-20T15:00:00-03:00'))).toMatchObject({ reason: 'sessao_cancelada' });
  });
  it('evento de varios dias: vale em qualquer dia do intervalo', () => {
    const fest = s('f', '2026-12-10', null, { end_date: '2026-12-12' });
    expect(checkTicketSession(fest, [fest], at('2026-12-11T10:00:00-03:00')).level).toBe('ok');
    expect(checkTicketSession(fest, [fest], at('2026-12-13T10:00:00-03:00')).level).toBe('warn');
  });
  it('sem horario ou sem data: nao avisa por horario', () => {
    expect(checkTicketSession(s('n', '2026-12-20', null), all, at('2026-12-20T19:00:00-03:00')).level).toBe('ok');
    expect(checkTicketSession({ id: 'q', start_date: null, event_time: null }, [], at('2026-12-20T19:00:00-03:00')).level).toBe('ok');
    expect(checkTicketSession(null, [], new Date()).level).toBe('ok');
  });
  it('sessao irma cancelada nao conta como mais perto', () => {
    const cancel = s('b', '2026-12-20', '19:30', { sessao_status: 'cancelada' });
    expect(checkTicketSession(s1, [s1, cancel], at('2026-12-20T19:20:00-03:00')).level).toBe('ok');
  });
});
