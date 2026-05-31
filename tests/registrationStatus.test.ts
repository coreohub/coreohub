import { describe, it, expect } from 'vitest';
import { isRegistrationPaid, isRegistrationPending, isRegistrationCancelled } from '../utils/registrationStatus';

// Regressão do bug histórico (2026-05-20): telas filtravam só 'CONFIRMADO' e
// zeravam métricas porque o valor real é 'APROVADO'. Estes testes travam o
// contrato: APROVADO e CONFIRMADO (legacy) contam como pago.

describe('isRegistrationPaid', () => {
  it('APROVADO conta como pago (valor atual)', () => {
    expect(isRegistrationPaid('APROVADO')).toBe(true);
  });
  it('CONFIRMADO conta como pago (legacy + cupom 100%)', () => {
    expect(isRegistrationPaid('CONFIRMADO')).toBe(true);
  });
  it('PENDENTE não é pago', () => {
    expect(isRegistrationPaid('PENDENTE')).toBe(false);
  });
  it('AGUARDANDO_VIDEO não é pago', () => {
    expect(isRegistrationPaid('AGUARDANDO_VIDEO')).toBe(false);
  });
  it('VENCIDO/ESTORNADO não são pagos', () => {
    expect(isRegistrationPaid('VENCIDO')).toBe(false);
    expect(isRegistrationPaid('ESTORNADO')).toBe(false);
  });
  it('null/undefined/lixo não quebram (retornam false)', () => {
    expect(isRegistrationPaid(null)).toBe(false);
    expect(isRegistrationPaid(undefined)).toBe(false);
    expect(isRegistrationPaid('qualquer')).toBe(false);
  });
});

describe('isRegistrationPending', () => {
  it('só PENDENTE é pendente', () => {
    expect(isRegistrationPending('PENDENTE')).toBe(true);
    expect(isRegistrationPending('AGUARDANDO_VIDEO')).toBe(false); // não conta como pendente de pagamento
    expect(isRegistrationPending('APROVADO')).toBe(false);
  });
});

describe('isRegistrationCancelled', () => {
  it('VENCIDO e ESTORNADO são cancelados', () => {
    expect(isRegistrationCancelled('VENCIDO')).toBe(true);
    expect(isRegistrationCancelled('ESTORNADO')).toBe(true);
  });
  it('estados ativos não são cancelados', () => {
    expect(isRegistrationCancelled('APROVADO')).toBe(false);
    expect(isRegistrationCancelled('PENDENTE')).toBe(false);
  });
});
