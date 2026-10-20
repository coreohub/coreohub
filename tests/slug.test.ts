import { describe, it, expect } from 'vitest';
import { slugify, suggestWorkshopSlug, slugAlternatives, slugValidity, yearOf, SLUG_MAX } from '../utils/slug';

describe('slugify', () => {
  it('tira acento, caixa e símbolos', () => {
    expect(slugify('Contemporâneo com Rayssa Francesconi')).toBe('contemporaneo-com-rayssa-francesconi');
    expect(slugify('Jazz com Lucas Maia (Aula Avulsa)')).toBe('jazz-com-lucas-maia-aula-avulsa');
    expect(slugify('Coração & São Paulo')).toBe('coracao-sao-paulo');
  });
  it('colapsa hífens e espaços, sem hífen nas pontas', () => {
    expect(slugify('  a  -  b  ')).toBe('a-b');
    expect(slugify('--x--')).toBe('x');
  });
  it('respeita o tamanho máximo sem terminar em hífen', () => {
    const s = slugify('palavra '.repeat(20));
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('suggestWorkshopSlug', () => {
  it('acrescenta o professor quando o nome não cita', () => {
    expect(suggestWorkshopSlug('Jazz Funk Intensivo', 'Maria Silva')).toBe('jazz-funk-intensivo-com-maria-silva');
  });
  it('não duplica o professor que já está no nome', () => {
    expect(suggestWorkshopSlug('Ballet Clássico com Marina Ricci', 'Marina Ricci')).toBe('ballet-classico-com-marina-ricci');
  });
  it('sem nome não sugere nada; sem professor usa só o nome', () => {
    expect(suggestWorkshopSlug('', 'Maria')).toBe('');
    expect(suggestWorkshopSlug('Hip Hop', '')).toBe('hip-hop');
  });
});

describe('slugAlternatives / slugValidity', () => {
  it('gera -2 e -3 dentro do limite', () => {
    expect(slugAlternatives('hip-hop')).toEqual(['hip-hop-2', 'hip-hop-3']);
    expect(slugAlternatives('jazz-com-lucas-maia', 2028)).toEqual(['jazz-com-lucas-maia-2028', 'jazz-com-lucas-maia-2', 'jazz-com-lucas-maia-3']);
    expect(slugAlternatives('jazz-2028', 2028)).toEqual(['jazz-2028-2', 'jazz-2028-3']);
    expect(yearOf('2028-03-05T14:00')).toBe(2028);
    expect(yearOf('')).toBeNull();
    expect(yearOf(null)).toBeNull();
    for (const a of slugAlternatives('x'.repeat(60), 2028)) expect(a.length).toBeLessThanOrEqual(SLUG_MAX);
  });
  it('valida formato e tamanho', () => {
    expect(slugValidity('')).toBe('vazio');
    expect(slugValidity('ab')).toBe('curto');
    expect(slugValidity('Jazz')).toBe('invalido');
    expect(slugValidity('jazz (aula)')).toBe('invalido');
    expect(slugValidity('jazz-funk')).toBe('ok');
  });
});
