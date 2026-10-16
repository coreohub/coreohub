import { describe, it, expect } from 'vitest';
import {
  fetchCardAnticipationLimit,
  limitCovers,
  requestInstallmentAnticipation,
  type FetchLike,
} from '../supabase/functions/_shared/asaas-anticipation';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const mockFetch = (routes: Record<string, (init?: RequestInit) => Response>): { fn: FetchLike; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    fn: async (url, init) => {
      const key = `${init?.method ?? 'GET'} ${new URL(url).pathname.replace('/api/v3', '')}`;
      calls.push(key);
      const h = routes[key];
      if (!h) throw new Error(`rota inesperada ${key}`);
      return h(init);
    },
  };
};

describe('limite de antecipação', () => {
  it('lê total e disponível do cartão', async () => {
    const m = mockFetch({ 'GET /anticipations/limits': () => json({ creditCard: { total: 70000, available: 65000.5 } }) });
    expect(await fetchCardAnticipationLimit('https://x/api/v3', 'k', m.fn)).toEqual({ total: 70000, available: 65000.5 });
  });

  it('falha de rede, HTTP de erro ou corpo estranho viram null (parcelado fecha por segurança)', async () => {
    expect(await fetchCardAnticipationLimit('https://x/api/v3', 'k', async () => { throw new Error('rede'); })).toBeNull();
    expect(await fetchCardAnticipationLimit('https://x/api/v3', 'k', async () => json({}, 500))).toBeNull();
    expect(await fetchCardAnticipationLimit('https://x/api/v3', 'k', async () => json({ creditCard: {} }))).toBeNull();
  });

  it('limitCovers: disponível >= bruto; null não cobre', () => {
    expect(limitCovers({ total: 100, available: 60 }, 60)).toBe(true);
    expect(limitCovers({ total: 100, available: 59.99 }, 60)).toBe(false);
    expect(limitCovers(null, 1)).toBe(false);
  });
});

describe('requestInstallmentAnticipation', () => {
  it('limite cobre: pede a antecipação do carnê e devolve o resultado', async () => {
    const m = mockFetch({
      'GET /anticipations/limits': () => json({ creditCard: { total: 70000, available: 1000 } }),
      'POST /anticipations': (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ installment: 'carne-1' });
        return json({ id: 'ant-1', status: 'PENDING', fee: 2.11 });
      },
    });
    const r = await requestInstallmentAnticipation({ baseUrl: 'https://x/api/v3', apiKey: 'k', installmentId: 'carne-1', grossTotal: 116.9, fetchFn: m.fn });
    expect(r.status).toBe('requested');
    expect(m.calls).toEqual(['GET /anticipations/limits', 'POST /anticipations']);
  });

  it('sem limite: NÃO chama POST /anticipations', async () => {
    const m = mockFetch({ 'GET /anticipations/limits': () => json({ creditCard: { total: 70000, available: 50 } }) });
    const r = await requestInstallmentAnticipation({ baseUrl: 'https://x/api/v3', apiKey: 'k', installmentId: 'carne-1', grossTotal: 116.9, fetchFn: m.fn });
    expect(r).toEqual({ status: 'no_limit', available: 50 });
    expect(m.calls).toEqual(['GET /anticipations/limits']);
  });

  it('consulta de limite falhou: trata como sem limite', async () => {
    const r = await requestInstallmentAnticipation({ baseUrl: 'https://x/api/v3', apiKey: 'k', installmentId: 'c', grossTotal: 10, fetchFn: async () => json({}, 500) });
    expect(r).toEqual({ status: 'no_limit', available: null });
  });

  it('Asaas recusa o pedido: status error com a descrição, sem lançar', async () => {
    const m = mockFetch({
      'GET /anticipations/limits': () => json({ creditCard: { total: 70000, available: 1000 } }),
      'POST /anticipations': () => json({ errors: [{ description: 'Cobrança não elegível' }] }, 400),
    });
    const r = await requestInstallmentAnticipation({ baseUrl: 'https://x/api/v3', apiKey: 'k', installmentId: 'c', grossTotal: 10, fetchFn: m.fn });
    expect(r).toEqual({ status: 'error', message: 'Cobrança não elegível' });
  });
});
