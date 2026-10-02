import { describe, it, expect } from 'vitest';
import { cardCreditFallback } from '../supabase/functions/_shared/card-credit-date';

// Cartão: o Asaas credita ~32 dias corridos após a confirmação, passando pro
// próximo dia útil se cair em fim de semana. Caso real: confirmada 15/09/2026
// às 22:15 (Brasília) -> 17/10 (sábado) -> "Saque disponível em" 19/10.

describe('cardCreditFallback', () => {
  it('caso real: confirmada 15/09 22:15 BRT cai sábado e rola pra segunda 19/10', () => {
    const paid = Date.parse('2026-09-16T01:15:00Z'); // 15/09 22:15 em Brasília
    expect(cardCreditFallback(paid)).toBe('2026-10-19T15:00:00.000Z');
  });
  it('dia útil fica no próprio dia (confirmada 01/09 -> 03/10 sábado -> 05/10)', () => {
    expect(cardCreditFallback(Date.parse('2026-09-01T15:00:00Z'))).toBe('2026-10-05T15:00:00.000Z');
  });
  it('+32 caindo em dia útil não rola (confirmada 02/09 -> 04/10 domingo -> 05/10; 03/09 -> 05/10)', () => {
    expect(cardCreditFallback(Date.parse('2026-09-03T15:00:00Z'))).toBe('2026-10-05T15:00:00.000Z');
    expect(cardCreditFallback(Date.parse('2026-09-04T15:00:00Z'))).toBe('2026-10-06T15:00:00.000Z');
  });
  it('domingo também rola pra segunda', () => {
    expect(cardCreditFallback(Date.parse('2026-09-02T15:00:00Z'))).toBe('2026-10-05T15:00:00.000Z');
  });
});
