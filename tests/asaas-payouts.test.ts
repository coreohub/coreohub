import { describe, it, expect } from 'vitest';
import { detectPixType, isKycPendingError, pickCoveredCommissionIds } from '../supabase/functions/_shared/asaas-payouts';

// Payout PIX: se detectPixType errar o tipo da chave, o Asaas rejeita a
// transferência e a grana do produtor fica presa. O caso ambíguo crítico é
// 11 dígitos: CPF (com checksum) vs celular (DDD+9). isKycPendingError decide
// se um erro do Asaas é "KYC pendente" (recuperável) ou falha real.

describe('detectPixType', () => {
  it('email pela presença de @', () => {
    expect(detectPixType('festival@usualdance.com')).toEqual({
      pixAddressKeyType: 'EMAIL', pixAddressKey: 'festival@usualdance.com',
    });
  });

  it('CNPJ = 14 dígitos', () => {
    expect(detectPixType('11.222.333/0001-81')).toEqual({
      pixAddressKeyType: 'CNPJ', pixAddressKey: '11222333000181',
    });
  });

  it('11 dígitos COM checksum válido = CPF', () => {
    // 340.014.208-56 é CPF válido (de teste em prod)
    expect(detectPixType('340.014.208-56')).toEqual({
      pixAddressKeyType: 'CPF', pixAddressKey: '34001420856',
    });
  });

  it('11 dígitos SEM checksum válido = celular (DDD+9), prefixa +55', () => {
    // 11987654321 não é CPF válido → tratado como telefone
    expect(detectPixType('11987654321')).toEqual({
      pixAddressKeyType: 'PHONE', pixAddressKey: '+5511987654321',
    });
  });

  it('13 dígitos começando com 55 = celular já com país', () => {
    expect(detectPixType('5511987654321')).toEqual({
      pixAddressKeyType: 'PHONE', pixAddressKey: '+5511987654321',
    });
  });

  it('UUID/chave aleatória = EVP (fallback)', () => {
    const evp = '123e4567-e89b-12d3-a456-426614174000';
    expect(detectPixType(evp)).toEqual({
      pixAddressKeyType: 'EVP', pixAddressKey: evp,
    });
  });

  it('chave vazia lança erro', () => {
    expect(() => detectPixType('')).toThrow();
    expect(() => detectPixType('   ')).toThrow();
  });
});

describe('isKycPendingError', () => {
  it('detecta padrão de KYC pendente em JSON do Asaas', () => {
    const body = JSON.stringify({
      errors: [{ code: 'invalid_action', description: 'Sua conta ainda não está aprovada para utilizar o Pix' }],
    });
    expect(isKycPendingError(body)).toBe(true);
  });

  it('detecta "documentos pendentes"', () => {
    const body = JSON.stringify({ errors: [{ description: 'Existem documentos pendentes de envio' }] });
    expect(isKycPendingError(body)).toBe(true);
  });

  it('é case-insensitive', () => {
    const body = JSON.stringify({ errors: [{ description: 'CONTA AINDA NÃO ESTÁ APROVADA' }] });
    expect(isKycPendingError(body)).toBe(true);
  });

  it('erro genérico NÃO é KYC pendente', () => {
    const body = JSON.stringify({ errors: [{ description: 'Valor da cobrança insuficiente para o estorno' }] });
    expect(isKycPendingError(body)).toBe(false);
  });

  it('faz fallback pra match textual quando body não é JSON', () => {
    expect(isKycPendingError('erro: conta ainda não está aprovada para o pix')).toBe(true);
    expect(isKycPendingError('internal server error')).toBe(false);
  });

  it('body vazio/sem errors retorna false', () => {
    expect(isKycPendingError('{}')).toBe(false);
    expect(isKycPendingError('{"errors":[]}')).toBe(false);
  });
});

// Repasse parcial: o sweep é limitado ao saldo real da subconta. Só pode marcar
// como liberada a comissão cujo valor realmente saiu (caso real: cartão que o
// Asaas ainda não creditou, Usualdance 2026-06).
describe("pickCoveredCommissionIds", () => {
  const items = [
    { id: "a", net: 100 },
    { id: "b", net: 50 },
    { id: "c", net: 697 },
  ];
  it("saque cobre tudo: libera todas", () => {
    expect(pickCoveredCommissionIds(items, 847)).toEqual(["a", "b", "c"]);
  });
  it("saque menor: deixa de fora a comissão que não foi coberta", () => {
    expect(pickCoveredCommissionIds(items, 150)).toEqual(["a", "b"]);
  });
  it("saldo insuficiente pra primeira: não libera nada", () => {
    expect(pickCoveredCommissionIds(items, 99)).toEqual([]);
  });
  it("tolera 1 centavo de arredondamento", () => {
    expect(pickCoveredCommissionIds([{ id: "x", net: 10.01 }], 10)).toEqual(["x"]);
  });
});
