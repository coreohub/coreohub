import { describe, it, expect } from 'vitest';
import { normalizeLeadPhone } from '../supabase/functions/_shared/lead-phone';
import { telefoneParaSalvar, maskTelefoneBR } from '../utils/masks';

describe('normalizeLeadPhone (calculadora)', () => {
  it.each([
    ['17991326034', '17991326034'],
    ['(17) 99132-6034', '17991326034'],
    ['+5517991326034', '17991326034'],
    ['5517991326034', '17991326034'],
    ['0055 17 99132-6034', '17991326034'],
    ['1732221234', '1732221234'],
    ['55991234567', '55991234567'],
    ['+14155552671', '+14155552671'],
    ['+351 912 345 678', '+351912345678'],
  ])('"%s" vira "%s"', (entrada, saida) => {
    expect(normalizeLeadPhone(entrada)).toBe(saida);
  });
  it.each(['55179913260', '123', '', '+123', undefined])('recusa "%s"', entrada => {
    expect(normalizeLeadPhone(entrada)).toBeNull();
  });
  it('aceita o que o campo da página envia', () => {
    for (const digitado of ['+5517991326034', '17991326034', '+14155552671']) {
      expect(normalizeLeadPhone(telefoneParaSalvar(maskTelefoneBR(digitado)))).not.toBeNull();
    }
  });
});
