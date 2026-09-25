import { describe, it, expect } from 'vitest';
import { isProvablyFree } from '../supabase/functions/_shared/registration-free';

const free = { name: 'Solo', fee: 0, is_active: true };
const paid = { name: 'Solo', fee: 80, is_active: true };

describe('isProvablyFree', () => {
  it('formação a R$0 (evento gratuito) é gratuita', () => {
    expect(isProvablyFree({ formato_participacao: 'Solo' }, { formacoes_config: [free] }, {})).toBe(true);
  });
  it('formação paga não é gratuita', () => {
    expect(isProvablyFree({ formato_participacao: 'Solo' }, { formacoes_config: [paid] }, {})).toBe(false);
  });
  it('evento governamental é sempre gratuito', () => {
    expect(isProvablyFree({}, { event_type: 'government', formacoes_config: [paid] }, {})).toBe(true);
  });
  it('mod_fee > 0 na inscrição bloqueia', () => {
    expect(isProvablyFree({ formato_participacao: 'Solo', mod_fee: 50 }, { formacoes_config: [free] }, {})).toBe(false);
  });
  it('sem formação resolvida nunca é gratuita', () => {
    expect(isProvablyFree({ formato_participacao: 'Solo' }, { formacoes_config: [] }, {})).toBe(false);
    expect(isProvablyFree({}, {}, {})).toBe(false);
  });
  it('formatos_precos com preço tem prioridade sobre formação a R$0', () => {
    expect(isProvablyFree({ formato_participacao: 'Solo' }, { formacoes_config: [free] }, { formatos_precos: [{ nome: 'solo', preco: 40 }] })).toBe(false);
  });
  it('lote pago bloqueia mesmo com fee base 0', () => {
    const f = { ...free, lotes: [{ preco: 0 }, { preco: 90 }] };
    expect(isProvablyFree({ formato_participacao: 'Solo' }, { formacoes_config: [f] }, {})).toBe(false);
  });
  it('pacote progressivo com qualquer faixa paga não é gratuito (bug Tamoios)', () => {
    const f = { name: 'Solo', pricing_type: 'PROGRESSIVE_PER_DANCER', lotes: [{ preco: 0 }], progressive_tiers: [{ ordem: 1, valor: 20 }] };
    expect(isProvablyFree({ formato_participacao: 'Solo' }, { formacoes_config: [f] }, {})).toBe(false);
  });
  it('pacote progressivo todo a R$0 é gratuito', () => {
    const f = { name: 'Solo', pricing_type: 'PROGRESSIVE_PER_DANCER', progressive_tiers: [{ ordem: 1, valor: 0 }] };
    expect(isProvablyFree({ formato_participacao: 'Solo' }, { formacoes_config: [f] }, {})).toBe(true);
  });
  it('nome diferente cai na primeira formação ativa (mesmo critério do servidor de pagamento)', () => {
    expect(isProvablyFree({ formato_participacao: 'Outra' }, { formacoes_config: [paid] }, {})).toBe(false);
  });
});
