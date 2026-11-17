import { describe, it, expect } from 'vitest';
import { matchesBuyerSearch, matchesElencoSearch } from '../utils/buyerSearch';

const leila = { buyer_name: 'Leila Souza', buyer_email: 'leila@exemplo.com', buyer_cpf: '12345678901', buyer_phone: '17999991234' };
const joao = { buyer_name: 'João Lima', buyer_email: 'joao@exemplo.com', buyer_cpf: '98765432100', buyer_phone: null };

describe('matchesBuyerSearch', () => {
  it('busca vazia passa todos', () => {
    expect(matchesBuyerSearch(leila, '')).toBe(true);
    expect(matchesBuyerSearch(leila, '   ')).toBe(true);
  });
  it('busca por nome só devolve quem casa (bug do includes vazio)', () => {
    expect(matchesBuyerSearch(leila, 'leila')).toBe(true);
    expect(matchesBuyerSearch(joao, 'leila')).toBe(false);
  });
  it('busca por e-mail', () => {
    expect(matchesBuyerSearch(joao, 'JOAO@')).toBe(true);
    expect(matchesBuyerSearch(leila, 'joao@')).toBe(false);
  });
  it('busca por CPF com e sem máscara', () => {
    expect(matchesBuyerSearch(leila, '123.456.789-01')).toBe(true);
    expect(matchesBuyerSearch(leila, '12345678901')).toBe(true);
    expect(matchesBuyerSearch(joao, '123.456')).toBe(false);
  });
  it('busca por WhatsApp com e sem máscara, com e sem DDD', () => {
    expect(matchesBuyerSearch(leila, '17 99999-1234')).toBe(true);
    expect(matchesBuyerSearch(leila, '(17) 99999-1234')).toBe(true);
    expect(matchesBuyerSearch(leila, '999991234')).toBe(true);
    expect(matchesBuyerSearch(leila, '99999-1234')).toBe(true);
    expect(matchesBuyerSearch(joao, '999991234')).toBe(false);
  });
  it('telefone nulo ou vazio não quebra', () => {
    expect(matchesBuyerSearch({ buyer_name: 'A', buyer_phone: null }, '17999')).toBe(false);
    expect(matchesBuyerSearch({ buyer_name: 'A' }, '17999')).toBe(false);
  });
  it('texto sem dígitos não casa documento', () => {
    expect(matchesBuyerSearch(joao, 'zzz')).toBe(false);
  });
});

describe('matchesElencoSearch', () => {
  const ana = { nome: 'Ana Paula', cpf: '123.456.789-01' };
  const bia = { nome: 'Bia Souza', cpf: '98765432100' };
  it('busca vazia passa todos', () => {
    expect(matchesElencoSearch(ana, '')).toBe(true);
  });
  it('busca por nome so devolve quem casa (bug do includes vazio)', () => {
    expect(matchesElencoSearch(ana, 'ana')).toBe(true);
    expect(matchesElencoSearch(bia, 'ana')).toBe(false);
  });
  it('busca por CPF ignora a mascara dos dois lados', () => {
    expect(matchesElencoSearch(ana, '12345678901')).toBe(true);
    expect(matchesElencoSearch(ana, '123.456')).toBe(true);
    expect(matchesElencoSearch(bia, '123.456')).toBe(false);
  });
  it('CPF ou nome nulos nao quebram', () => {
    expect(matchesElencoSearch({ nome: null, cpf: null }, 'ana')).toBe(false);
    expect(matchesElencoSearch({ nome: 'Ana', cpf: null }, '123')).toBe(false);
  });
});
