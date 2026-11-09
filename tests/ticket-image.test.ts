import { describe, it, expect } from 'vitest';
import { wrapLines } from '../utils/ticketImage';

const measure = (s: string) => s.length * 10;

describe('wrapLines', () => {
  it('cabe numa linha', () => expect(wrapLines(measure, 'Festival Level Up', 400)).toEqual(['Festival Level Up']));
  it('quebra em palavras inteiras', () =>
    expect(wrapLines(measure, 'TESTE SANDBOX ESPETACULO NELSON CAMARGO', 200)).toEqual(['TESTE SANDBOX', 'ESPETACULO NELSON', 'CAMARGO']));
  it('palavra maior que a largura fica sozinha', () =>
    expect(wrapLines(measure, 'a supercalifragilistico b', 100)).toEqual(['a', 'supercalifragilistico', 'b']));
  it('espacos extras e vazio', () => {
    expect(wrapLines(measure, '  a   b  ', 400)).toEqual(['a b']);
    expect(wrapLines(measure, '   ', 400)).toEqual([]);
  });
});
