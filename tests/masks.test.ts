import { describe, it, expect } from 'vitest';
import {
  maskCpfCnpj, unmaskCpfCnpj, maskMoeda, parseMoeda, formatPrecoBR, parsePrecoBR,
  maskData, parseDataISO, maskTempo, parseTempoSegundos, formatTempo,
  validateCpf, validateCnpj, maskTelefoneBR, unmaskTelefoneBR, isValidTelefone, telefoneParaCobranca, telefoneParaSalvar,
} from '../utils/masks';

// CPF/CNPJ válidos batem na API Asaas — se a validação local deixar passar lixo,
// o checkout quebra no Asaas. parseMoeda/parsePrecoBR cobram o valor errado se
// interpretarem milhar/decimal errado.

describe('maskCpfCnpj', () => {
  it('formata CPF progressivamente', () => {
    expect(maskCpfCnpj('12345678901')).toBe('123.456.789-01');
  });
  it('formata CNPJ quando passa de 11 dígitos', () => {
    expect(maskCpfCnpj('12345678000190')).toBe('12.345.678/0001-90');
  });
  it('ignora não-dígitos e limita a 14', () => {
    expect(unmaskCpfCnpj('123.456.789-01')).toBe('12345678901');
  });
});

describe('maskTelefoneBR', () => {
  it('formata celular (11 dígitos) com o 9º dígito', () => {
    expect(maskTelefoneBR('17981264290')).toBe('(17) 98126-4290');
  });
  it('formata fixo (10 dígitos)', () => {
    expect(maskTelefoneBR('1738211234')).toBe('(17) 3821-1234');
  });
  it('ignora não-dígitos e limita a 11', () => {
    expect(maskTelefoneBR('(17) 98126-4290999')).toBe('(17) 98126-4290');
  });
  it('unmaskTelefoneBR extrai só os dígitos', () => {
    expect(unmaskTelefoneBR('(17) 98126-4290')).toBe('17981264290');
  });
});

describe('telefone com código do país', () => {
  // Digita um caractere por vez, como o input controlado
  const digitar = (s: string) => [...s].reduce((v, c) => maskTelefoneBR(v + c), '');

  it.each([
    '+5517991326034', '+55 17 99132-6034', '+55 (17) 99132-6034', '5517991326034', '017991326034',
  ])('colado ou preenchido "%s" não perde o fim do número', entrada => {
    expect(maskTelefoneBR(entrada)).toBe('(17) 99132-6034');
    expect(digitar(entrada)).toBe('(17) 99132-6034');
  });
  it('fixo com 55 na frente', () => {
    expect(maskTelefoneBR('551732221234')).toBe('(17) 3222-1234');
  });
  it('DDD 55 não é confundido com o código do país', () => {
    expect(maskTelefoneBR('55991234567')).toBe('(55) 99123-4567');
    expect(digitar('55991234567')).toBe('(55) 99123-4567');
    expect(maskTelefoneBR('5532221234')).toBe('(55) 3222-1234');
    expect(maskTelefoneBR('+5555991234567')).toBe('(55) 99123-4567');
  });
  it('dígito a mais em número com DDD 55 não troca o número', () => {
    expect(maskTelefoneBR('(55) 99312-34567')).toBe('(55) 99312-3456');
    expect(maskTelefoneBR('(55) 997312-3456')).toBe('(55) 99731-2345');
    expect(maskTelefoneBR('(55) 3222-12345')).toBe('(55) 32221-2345'); // inválido, bloqueado na tela
  });
  it.each(['0055 17 99132-6034', '055 17 99132-6034'])('prefixo de discagem "%s"', entrada => {
    expect(maskTelefoneBR(entrada)).toBe('(17) 99132-6034');
  });
  it('estrangeiro é gravado com o "+"', () => {
    expect(telefoneParaSalvar('+14155552671')).toBe('+14155552671');
    expect(telefoneParaSalvar('(17) 99132-6034')).toBe('17991326034');
    expect(telefoneParaSalvar('')).toBe('');
  });
  it('preserva número de outro país', () => {
    expect(maskTelefoneBR('+14155552671')).toBe('+14155552671');
    expect(digitar('+5491123456789')).toBe('+5491123456789');
    expect(digitar('+14155552671')).toBe('+14155552671');
    expect(isValidTelefone('+14155552671')).toBe(true);
  });
  it('recusa o número cortado e incompletos', () => {
    expect(isValidTelefone('(55) 17991-3260')).toBe(false);
    expect(isValidTelefone('(17) 9913-26')).toBe(false);
    expect(isValidTelefone('')).toBe(false);
  });
  it('aceita celular e fixo', () => {
    expect(isValidTelefone('(17) 99132-6034')).toBe(true);
    expect(isValidTelefone('(17) 3222-1234')).toBe(true);
  });
  it('só manda à cobrança número brasileiro válido', () => {
    expect(telefoneParaCobranca('(17) 99132-6034')).toBe('17991326034');
    expect(telefoneParaCobranca('+14155552671')).toBeUndefined();
    expect(telefoneParaCobranca('')).toBeUndefined();
  });
});

describe('validateCpf', () => {
  it('aceita CPF válido', () => {
    expect(validateCpf('340.014.208-56')).toBe(true);  // CPF de teste usado em prod
    expect(validateCpf('11144477735')).toBe(true);
  });
  it('rejeita dígito verificador errado', () => {
    expect(validateCpf('340.014.208-57')).toBe(false);
    expect(validateCpf('11144477734')).toBe(false);
  });
  it('rejeita sequências repetidas (passariam no módulo)', () => {
    expect(validateCpf('111.111.111-11')).toBe(false);
    expect(validateCpf('00000000000')).toBe(false);
  });
  it('rejeita comprimento errado', () => {
    expect(validateCpf('123')).toBe(false);
    expect(validateCpf('123456789012')).toBe(false);
  });
});

describe('validateCnpj', () => {
  it('aceita CNPJ válido', () => {
    expect(validateCnpj('11.222.333/0001-81')).toBe(true);
  });
  it('rejeita dígito errado', () => {
    expect(validateCnpj('11.222.333/0001-82')).toBe(false);
  });
  it('rejeita sequência repetida', () => {
    expect(validateCnpj('11.111.111/1111-11')).toBe(false);
  });
});

describe('maskMoeda / parseMoeda', () => {
  // Intl.NumberFormat BRL usa NBSP (U+00A0) entre "R$" e o número, não espaço comum.
  it('trata input como centavos', () => {
    expect(maskMoeda('5000')).toBe('R$ 50,00');
    expect(maskMoeda('500000')).toBe('R$ 5.000,00');
  });
  it('string vazia vira vazio', () => {
    expect(maskMoeda('')).toBe('');
  });
  it('parseMoeda reverte (só dígitos importam)', () => {
    expect(parseMoeda('R$ 50,00')).toBe(50);
    expect(parseMoeda('R$ 5.000,00')).toBe(5000);
    expect(parseMoeda('')).toBe(0);
  });
});

describe('formatPrecoBR', () => {
  it('formata sem prefixo', () => {
    expect(formatPrecoBR(1234.56)).toBe('1.234,56');
    expect(formatPrecoBR(0)).toBe('0,00');
  });
  it('NaN/null vira vazio', () => {
    expect(formatPrecoBR(NaN)).toBe('');
    expect(formatPrecoBR(null as any)).toBe('');
  });
});

describe('parsePrecoBR (parser tolerante)', () => {
  it('BR padrão com milhar e decimal', () => {
    expect(parsePrecoBR('1.234,56')).toBe(1234.56);
    expect(parsePrecoBR('1.234.567,89')).toBe(1234567.89);
  });
  it('vírgula decimal sem milhar', () => {
    expect(parsePrecoBR('1234,56')).toBe(1234.56);
  });
  it('ponto único de 3 dígitos = milhar BR', () => {
    expect(parsePrecoBR('1.234')).toBe(1234);
  });
  it('ponto único de 1-2 dígitos = decimal US', () => {
    expect(parsePrecoBR('1234.56')).toBe(1234.56);
  });
  it('inteiro puro', () => {
    expect(parsePrecoBR('1234')).toBe(1234);
  });
  it('vazio/lixo vira 0', () => {
    expect(parsePrecoBR('')).toBe(0);
    expect(parsePrecoBR('abc')).toBe(0);
  });
});

describe('maskData / parseDataISO', () => {
  it('mascara DD/MM/AAAA', () => {
    expect(maskData('01011990')).toBe('01/01/1990');
  });
  it('converte pra ISO', () => {
    expect(parseDataISO('01/01/1990')).toBe('1990-01-01');
  });
  it('rejeita data inexistente (31/02)', () => {
    expect(parseDataISO('31/02/2000')).toBeNull();
  });
  it('rejeita mês inválido', () => {
    expect(parseDataISO('01/13/2000')).toBeNull();
  });
  it('rejeita ano fora da faixa', () => {
    expect(parseDataISO('01/01/1800')).toBeNull();
    expect(parseDataISO('01/01/3000')).toBeNull();
  });
  it('rejeita formato incompleto', () => {
    expect(parseDataISO('1/1/90')).toBeNull();
  });
});

describe('maskTempo / parseTempoSegundos / formatTempo', () => {
  it('mascara MM:SS da direita pra esquerda', () => {
    expect(maskTempo('123')).toBe('1:23');
    expect(maskTempo('1234')).toBe('12:34');
  });
  it('cap nos segundos em 59', () => {
    expect(maskTempo('1599')).toBe('15:59');
  });
  it('parseTempoSegundos converte', () => {
    expect(parseTempoSegundos('03:54')).toBe(234);
    expect(parseTempoSegundos('3:54')).toBe(234);
  });
  it('rejeita segundos >= 60', () => {
    expect(parseTempoSegundos('01:60')).toBe(0);
  });
  it('formatTempo arredonda sem overflow de carry', () => {
    expect(formatTempo(234)).toBe('03:54');
    expect(formatTempo(119.5)).toBe('02:00');   // não vira "01:60"
    expect(formatTempo(0)).toBe('');
    expect(formatTempo(-5)).toBe('');
  });
});
