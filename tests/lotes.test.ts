import { describe, it, expect } from 'vitest';
import { resolveLote, precoVigente, diffDias, formatDataBR, formatDataBRComDia, type Lote } from '../utils/lotes';

// Lotes definem o preço vigente de inscrições E ingressos. Errar aqui cobra
// valor errado do inscrito. Regra: lote vigente = 1º com data_virada >= hoje.

describe('resolveLote', () => {
  it('retorna null sem lotes', () => {
    expect(resolveLote(null)).toBeNull();
    expect(resolveLote(undefined)).toBeNull();
    expect(resolveLote([])).toBeNull();
  });

  it('lote único sem virada é sempre o vigente', () => {
    const lotes: Lote[] = [{ data_virada: null, preco: 50 }];
    const r = resolveLote(lotes, '2026-06-01');
    expect(r?.lote.preco).toBe(50);
    expect(r?.idx).toBe(0);
    expect(r?.proximo).toBeNull();
  });

  it('escolhe o primeiro lote cuja virada >= hoje', () => {
    const lotes: Lote[] = [
      { data_virada: '2026-06-10', preco: 50 },  // 1º lote
      { data_virada: '2026-06-20', preco: 70 },  // 2º lote
      { data_virada: null,         preco: 90 },  // último
    ];
    // Antes da 1ª virada → 1º lote, próximo é o 2º
    const r = resolveLote(lotes, '2026-06-05');
    expect(r?.lote.preco).toBe(50);
    expect(r?.idx).toBe(0);
    expect(r?.proximo?.preco).toBe(70);
  });

  it('no dia exato da virada o lote ainda é vigente (>= inclusive)', () => {
    const lotes: Lote[] = [
      { data_virada: '2026-06-10', preco: 50 },
      { data_virada: null,         preco: 90 },
    ];
    const r = resolveLote(lotes, '2026-06-10');
    expect(r?.lote.preco).toBe(50);  // ainda no 1º lote
  });

  it('um dia após a virada entra o próximo lote', () => {
    const lotes: Lote[] = [
      { data_virada: '2026-06-10', preco: 50 },
      { data_virada: null,         preco: 90 },
    ];
    const r = resolveLote(lotes, '2026-06-11');
    expect(r?.lote.preco).toBe(90);
    expect(r?.idx).toBe(1);
    expect(r?.proximo).toBeNull();
  });

  it('todas as datas passadas → usa o último lote (fallback)', () => {
    const lotes: Lote[] = [
      { data_virada: '2026-01-01', preco: 50 },
      { data_virada: '2026-02-01', preco: 70 },
    ];
    const r = resolveLote(lotes, '2026-12-31');
    expect(r?.lote.preco).toBe(70);   // último
    expect(r?.idx).toBe(1);
    expect(r?.proximo).toBeNull();    // não há próximo após o último
  });
});

describe('precoVigente', () => {
  it('prefere o lote vigente quando há lotes', () => {
    expect(precoVigente({ preco: 999, lotes: [{ data_virada: null, preco: 40 }] }, '2026-06-01')).toBe(40);
  });
  it('cai pra preco quando não há lotes', () => {
    expect(precoVigente({ preco: 33 }, '2026-06-01')).toBe(33);
  });
  it('cai pra fee quando não há preco nem lotes', () => {
    expect(precoVigente({ fee: 25 }, '2026-06-01')).toBe(25);
  });
  it('retorna 0 quando nada definido', () => {
    expect(precoVigente({}, '2026-06-01')).toBe(0);
  });
});

describe('diffDias', () => {
  it('conta dias entre datas', () => {
    expect(diffDias('2026-06-01', '2026-06-10')).toBe(9);
  });
  it('zero no mesmo dia', () => {
    expect(diffDias('2026-06-10', '2026-06-10')).toBe(0);
  });
  it('negativo quando b < a', () => {
    expect(diffDias('2026-06-10', '2026-06-01')).toBe(-9);
  });
  it('atravessa virada de mês corretamente', () => {
    expect(diffDias('2026-05-30', '2026-06-02')).toBe(3);
  });
});

describe('formatDataBR / formatDataBRComDia', () => {
  it('formata DD/MM', () => {
    expect(formatDataBR('2026-06-30')).toBe('30/06');
  });
  it('prefixa weekday + mês abreviado', () => {
    // 2026-06-30 é uma terça
    expect(formatDataBRComDia('2026-06-30')).toBe('Ter, 30/jun');
  });
  it('retorna vazio pra ISO inválido (guard)', () => {
    expect(formatDataBRComDia('')).toBe('');
    expect(formatDataBRComDia('30/06/2026')).toBe('');
  });
});
