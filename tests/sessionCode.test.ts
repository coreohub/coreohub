import { describe, expect, it } from 'vitest';
import { parseSessionCode, sessionCode, sessionPath } from '../utils/sessionCode';

describe('sessionCode', () => {
  it('monta o código a partir de data e horário', () => {
    expect(sessionCode('2026-11-30', '19:30')).toBe('2026-11-30-1930');
    expect(sessionCode('2026-11-30', '9:05')).toBe('2026-11-30-0905');
    expect(sessionCode('2026-11-30T00:00:00', '15:30:00')).toBe('2026-11-30-1530');
  });

  it('devolve null sem data ou sem horário válido', () => {
    expect(sessionCode(null, '19:30')).toBeNull();
    expect(sessionCode('2026-11-30', null)).toBeNull();
    expect(sessionCode('2026-11-30', 'noite')).toBeNull();
  });

  it('lê o código de volta em data e hora', () => {
    expect(parseSessionCode('2026-11-30-1930')).toEqual({ date: '2026-11-30', time: '19:30' });
  });

  it('não confunde slug antigo com código', () => {
    expect(parseSessionCode('festival-level-up-2026-2026-11-30-1930')).toBeNull();
    expect(parseSessionCode('')).toBeNull();
    expect(parseSessionCode(null)).toBeNull();
  });

  it('principal fica sem parâmetro; irmã leva ?sessao=', () => {
    const principal = { id: 'a', start_date: '2026-11-30', event_time: '15:30' };
    const irma = { id: 'b', start_date: '2026-11-30', event_time: '19:30' };
    expect(sessionPath('festival-level-up-2026', principal, 'a')).toBe('/evento/festival-level-up-2026');
    expect(sessionPath('festival-level-up-2026', irma, 'a')).toBe('/evento/festival-level-up-2026?sessao=2026-11-30-1930');
  });
});
