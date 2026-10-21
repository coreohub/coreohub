import { describe, expect, it } from 'vitest';
import { parseSessionCode, sessionCode, sessionKey, sessionPath, sessionSlugCandidates } from '../utils/sessionCode';

describe('sessionCode (leitura de links antigos)', () => {
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

  it('não confunde slug com código', () => {
    expect(parseSessionCode('sessao-2')).toBeNull();
    expect(parseSessionCode('festival-level-up-2026-2026-11-30-1930')).toBeNull();
    expect(parseSessionCode('')).toBeNull();
    expect(parseSessionCode(null)).toBeNull();
  });
});

describe('sessionKey / sessionPath', () => {
  const principal = { id: 'a', slug: 'festival-level-up-2026', start_date: '2026-11-30', event_time: '15:30' };
  const irma = { id: 'b', slug: 'festival-level-up-2026-sessao-2', start_date: '2026-11-30', event_time: '19:30' };

  it('chave é o slug da sessão sem o prefixo do principal', () => {
    expect(sessionKey('festival-level-up-2026', irma)).toBe('sessao-2');
  });

  it('slug que não começa com o do principal vira a chave inteira', () => {
    expect(sessionKey('festival-level-up-2026', { id: 'c', slug: 'outro-nome' })).toBe('outro-nome');
  });

  it('sem slug cai pro código de data e hora e depois pro id', () => {
    expect(sessionKey('x', { id: 'd', slug: null, start_date: '2026-12-01', event_time: '20:00' })).toBe('2026-12-01-2000');
    expect(sessionKey('x', { id: 'e', slug: null })).toBe('e');
  });

  it('principal fica sem parâmetro; irmã leva ?sessao=<chave>', () => {
    expect(sessionPath('festival-level-up-2026', principal, 'a')).toBe('/evento/festival-level-up-2026');
    expect(sessionPath('festival-level-up-2026', irma, 'a')).toBe('/evento/festival-level-up-2026?sessao=sessao-2');
  });

  it('candidatos de slug para resolver a chave', () => {
    expect(sessionSlugCandidates('festival-level-up-2026', 'sessao-2')).toEqual(['sessao-2', 'festival-level-up-2026-sessao-2']);
    expect(sessionSlugCandidates(null, 'sessao-2')).toEqual(['sessao-2']);
  });
});
