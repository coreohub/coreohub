import { describe, it, expect } from 'vitest';
import {
  buildProducerDigest, digestWindow, alreadySentThisCycle, parseDigestMode, periodLabel, type CommissionRow,
} from '../supabase/functions/_shared/producer-sales-digest';

const row = (over: Partial<CommissionRow> = {}): CommissionRow => ({
  event_id: 'e1', kind: 'audience', gross_amount: 100, commission_amount: 10, net_amount: 90,
  refund_amount: null, refunded_at: null, installment_number: null, ...over,
});
const names = { e1: 'Level Up', e2: 'Usualdance' };

describe('buildProducerDigest', () => {
  it('agrupa por evento e tipo, somando bruto, comissao e liquido', () => {
    const d = buildProducerDigest([row(), row(), row({ kind: 'workshop', gross_amount: 50, commission_amount: 5, net_amount: 45 })], names);
    expect(d.events).toHaveLength(1);
    const lines = d.events[0].lines;
    expect(lines.map((l) => l.kind)).toEqual(['audience', 'workshop']);
    expect(lines[0]).toMatchObject({ count: 2, gross: 200, commission: 20, net: 180 });
    expect(d.total).toMatchObject({ count: 3, gross: 250, commission: 25, net: 225 });
  });

  it('ignora estorno total e abate estorno parcial na mesma proporcao', () => {
    const d = buildProducerDigest([
      row({ refunded_at: '2026-11-18T00:00:00Z' }),
      row({ refund_amount: 50 }),
    ], names);
    expect(d.total).toMatchObject({ count: 1, gross: 50, commission: 5, net: 45 });
  });

  it('parcelado: conta a venda so na parcela 1, mas soma o dinheiro de todas', () => {
    const d = buildProducerDigest([
      row({ installment_number: 1, gross_amount: 30, commission_amount: 3, net_amount: 27 }),
      row({ installment_number: 2, gross_amount: 30, commission_amount: 3, net_amount: 27 }),
    ], names);
    expect(d.total).toMatchObject({ count: 1, gross: 60, net: 54 });
  });

  it('ordena eventos pelo liquido (maior primeiro) e usa nome de reserva', () => {
    const d = buildProducerDigest([
      row({ event_id: 'e2', net_amount: 10, gross_amount: 11, commission_amount: 1 }),
      row({ event_id: 'e1' }),
      row({ event_id: 'e3', net_amount: 5, gross_amount: 6, commission_amount: 1 }),
    ], names);
    expect(d.events.map((e) => e.eventName)).toEqual(['Level Up', 'Usualdance', 'Evento']);
  });

  it('sem linhas, resumo vazio; kind desconhecido e evento nulo sao ignorados', () => {
    expect(buildProducerDigest([], names).events).toEqual([]);
    const d = buildProducerDigest([row({ kind: 'plan_fee' }), row({ event_id: null })], names);
    expect(d.events).toEqual([]);
    expect(d.total.count).toBe(0);
  });

  it('arredonda a centavos sem erro de ponto flutuante', () => {
    const d = buildProducerDigest([
      row({ gross_amount: 0.1, commission_amount: 0.01, net_amount: 0.09 }),
      row({ gross_amount: 0.2, commission_amount: 0.02, net_amount: 0.18 }),
    ], names);
    expect(d.total.gross).toBe(0.3);
    expect(d.total.net).toBe(0.27);
  });
});

describe('janela e ciclo', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  it('sem envio anterior: 7 dias', () => {
    const w = digestWindow(null, now);
    expect(w.to).toEqual(now);
    expect(now.getTime() - w.from.getTime()).toBe(7 * 86_400_000);
  });
  it('com envio anterior: parte do ultimo envio', () => {
    expect(digestWindow('2026-11-20T12:00:00Z', now).from.toISOString()).toBe('2026-11-20T12:00:00.000Z');
  });
  it('cron parado ha semanas: limita a 14 dias', () => {
    expect(now.getTime() - digestWindow('2026-09-01T00:00:00Z', now).from.getTime()).toBe(14 * 86_400_000);
  });
  it('data invalida cai no padrao de 7 dias', () => {
    expect(now.getTime() - digestWindow('lixo', now).from.getTime()).toBe(7 * 86_400_000);
  });
  it('nao repete no mesmo ciclo (menos de 6 dias), repete na semana seguinte', () => {
    expect(alreadySentThisCycle('2026-11-27T11:00:00Z', now)).toBe(true);
    expect(alreadySentThisCycle('2026-11-20T12:00:00Z', now)).toBe(false);
    expect(alreadySentThisCycle(null, now)).toBe(false);
  });
});

describe('modo e rotulo', () => {
  it('modo desconhecido ou vazio = off (seguro)', () => {
    expect(parseDigestMode(undefined)).toBe('off');
    expect(parseDigestMode('ligado')).toBe('off');
    expect(parseDigestMode(' ON ')).toBe('on');
    expect(parseDigestMode('dry')).toBe('dry');
  });
  it('rotulo do periodo em dia/mes de Brasilia', () => {
    expect(periodLabel(new Date('2026-11-20T12:00:00Z'), new Date('2026-11-27T12:00:00Z'))).toBe('20/11 a 27/11');
  });
});
