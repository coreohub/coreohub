import { describe, it, expect } from 'vitest';
import { salesByZone } from '../utils/salesByZone';

const zones = [{ key: 'meio', nome: 'Meio' }, { key: 'lat', nome: 'Laterais' }];
const zoneBySeat = { A1: 'meio', A2: 'meio', B1: 'lat', B2: 'lat', C1: 'lat' };
const st = (status: string) => ({ seat_id: '', status } as any);
const statuses = { A1: st('vendido'), A2: st('livre'), B1: st('livre'), B2: st('bloqueado'), C1: st('livre') };

describe('salesByZone', () => {
  it('soma venda paga por zona e conta lugares livres/à venda', () => {
    const r = salesByZone(zones, zoneBySeat, statuses, [
      { seat_id: 'A1', preco: 50, status_pagamento: 'APROVADO' },
    ]);
    expect(r.find(l => l.key === 'meio')).toMatchObject({ vendidos: 1, receita: 50, livres: 1, vendaveis: 2 });
    expect(r.find(l => l.key === 'lat')).toMatchObject({ vendidos: 0, receita: 0, livres: 2, vendaveis: 2 });
  });
  it('ignora pendente e estornado', () => {
    const r = salesByZone(zones, zoneBySeat, statuses, [
      { seat_id: 'A1', preco: 50, status_pagamento: 'PENDENTE' },
      { seat_id: 'A2', preco: 50, status_pagamento: 'APROVADO', refunded_at: '2026-11-01' },
    ]);
    expect(r.find(l => l.key === 'meio')!.vendidos).toBe(0);
  });
  it('ingresso sem lugar cai em "Sem zona" e a linha só aparece quando há algo', () => {
    expect(salesByZone(zones, zoneBySeat, statuses, []).some(l => l.nome === 'Sem zona')).toBe(false);
    const r = salesByZone(zones, zoneBySeat, statuses, [{ seat_id: null, preco: 40, status_pagamento: 'APROVADO' }]);
    expect(r.find(l => l.nome === 'Sem zona')).toMatchObject({ vendidos: 1, receita: 40 });
  });
});
