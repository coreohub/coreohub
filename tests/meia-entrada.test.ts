import { describe, it, expect } from 'vitest';
import { ticketCategory, summarizeMeia, LEI_12933_ART1 } from '../utils/meiaEntrada';

const t = (nome: string, extra: Record<string, unknown> = {}) => ({ nome, preco: 20, ...extra });

describe('ticketCategory', () => {
  it('meia por nome ou kind', () => {
    expect(ticketCategory(t('Meia-entrada'))).toBe('meia');
    expect(ticketCategory(t('Estudante', { kind: 'meia' }))).toBe('meia');
  });
  it('promocional pela flag do produtor tem prioridade sobre o nome', () => {
    expect(ticketCategory(t('Meia promo', { promocional: true }))).toBe('promocional');
  });
  it('solidária e cortesia são promocionais; o resto é comum', () => {
    expect(ticketCategory(t('Solidária'))).toBe('promocional');
    expect(ticketCategory(t('Cortesia'))).toBe('promocional');
    expect(ticketCategory(t('Inteira'))).toBe('comum');
  });
});

describe('summarizeMeia', () => {
  const ing = [t('Inteira', { quantidade_total: 200 }), t('Meia', { quantidade_total: 150 }), t('Solidária', { quantidade_total: 23 })];
  it('total, meia e cota mínima (promocional fora da base dos 40%)', () => {
    const s = summarizeMeia(ing, { '1': { remaining: 120, sold_out: false } });
    expect(s.totalKnown).toBe(true);
    expect(s.total).toBe(373);
    expect(s.meiaTotal).toBe(150);
    expect(s.meiaRemaining).toBe(120);
    expect(s.cotaMinima).toBe(140); // 40% de (200+150) = 140
    expect(s.abaixoDaCota).toBe(false);
  });
  it('avisa esgotamento só quando todos os tipos de meia esgotaram', () => {
    expect(summarizeMeia(ing, { '1': { remaining: 0, sold_out: true } }).meiaExhausted).toBe(true);
    expect(summarizeMeia(ing, { '1': { remaining: 3, sold_out: false } }).meiaExhausted).toBe(false);
  });
  it('tipo sem limite deixa o total desconhecido', () => {
    const s = summarizeMeia([t('Inteira'), t('Meia', { quantidade_total: 10 })]);
    expect(s.totalKnown).toBe(false);
    expect(s.cotaMinima).toBeNull();
  });
  it('sem meia à venda: hasMeia falso e abaixo da cota', () => {
    const s = summarizeMeia([t('Inteira', { quantidade_total: 100 })]);
    expect(s.hasMeia).toBe(false);
    expect(s.abaixoDaCota).toBe(true);
  });
  it('ignora tipos sem preço vigente', () => {
    expect(summarizeMeia([{ nome: 'Grátis', preco: 0 }]).rows).toHaveLength(0);
  });
});

describe('texto da Lei 12.933', () => {
  it('traz o art. 1º com a cota de 40% e os beneficiários', () => {
    const txt = LEI_12933_ART1.join(' ');
    expect(txt).toContain('metade do preço do ingresso');
    expect(txt).toContain('40% (quarenta por cento)');
    expect(txt).toContain('pessoas com deficiência');
  });
});
