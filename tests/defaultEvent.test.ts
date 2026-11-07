import { describe, it, expect } from 'vitest';
import { pickDefaultEvent } from '../utils/defaultEvent';

describe('pickDefaultEvent', () => {
  const principal = { id: 'a', session_group_id: 'a' };
  const sessao2 = { id: 'b', session_group_id: 'a' };
  it('sessão irmã abre na principal', () => {
    expect(pickDefaultEvent(sessao2, [sessao2, principal])).toBe(principal);
  });
  it('principal fica como está', () => {
    expect(pickDefaultEvent(principal, [principal, sessao2])).toBe(principal);
  });
  it('sem grupo, ou principal fora da lista, mantém o escolhido', () => {
    const solo = { id: 'c', session_group_id: null };
    expect(pickDefaultEvent(solo, [solo])).toBe(solo);
    expect(pickDefaultEvent(sessao2, [sessao2])).toBe(sessao2);
  });
});
