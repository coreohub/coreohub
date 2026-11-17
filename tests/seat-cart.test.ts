import { describe, it, expect } from 'vitest';
import { commonTypeOrder, countSeatTypes, pickDefaultType, seatTypeChangeError, orderSeatsByType } from '../utils/seatCart';

const ing = [
  { nome: 'Meia' },            // 0
  { nome: 'Inteira' },         // 1
  { nome: 'PCD' },             // 2 (especial)
  { nome: 'Acompanhante de PCD' }, // 3
  { nome: 'Promocional' },     // 4
];
const isMeia = (i: number) => /meia/i.test(String(ing[i].nome));
const all = { sellable: () => true, isMeia };

describe('seatCart', () => {
  it('ordem: inteira primeiro, meia por último, sem tipos especiais', () => {
    expect(commonTypeOrder(ing, all)).toEqual([1, 4, 0]);
  });
  it('tipo sem preço vigente fica de fora', () => {
    expect(commonTypeOrder(ing, { sellable: i => i !== 4, isMeia })).toEqual([1, 0]);
  });
  it('conta lugares por tipo, ignorando lugares sem tipo', () => {
    expect(countSeatTypes(['A-1', 'A-2', 'A-3'], { 'A-1': 1, 'A-2': 1, 'A-3': 0, 'Z-9': 1 })).toEqual({ 1: 2, 0: 1 });
  });
  it('padrão é Inteira; esgotada cai pro próximo; meia só 1', () => {
    const order = [1, 4, 0];
    expect(pickDefaultType(order, {}, { remaining: () => 99, isMeia })).toBe(1);
    expect(pickDefaultType(order, { 1: 2 }, { remaining: i => (i === 1 ? 2 : 99), isMeia })).toBe(4);
    expect(pickDefaultType([0], { 0: 1 }, { remaining: () => 99, isMeia })).toBeNull();
    expect(pickDefaultType(order, {}, { remaining: () => 0, isMeia })).toBeNull();
  });
  it('trocar pra meia: bloqueia a segunda, libera se a outra mudar', () => {
    const base = { selectedSeats: ['A-1', 'A-2'], remaining: () => 99, isMeia };
    expect(seatTypeChangeError({ ...base, seatTypes: { 'A-1': 0, 'A-2': 1 }, seatId: 'A-2', nextIdx: 0 })).toMatch(/Lei 12.933/);
    expect(seatTypeChangeError({ ...base, seatTypes: { 'A-1': 1, 'A-2': 1 }, seatId: 'A-2', nextIdx: 0 })).toBeNull();
  });
  it('trocar de tipo respeita o estoque do tipo novo', () => {
    const base = { selectedSeats: ['A-1', 'A-2'], seatTypes: { 'A-1': 4, 'A-2': 1 }, isMeia };
    expect(seatTypeChangeError({ ...base, seatId: 'A-2', nextIdx: 4, remaining: () => 1 })).toMatch(/Não há mais/);
    expect(seatTypeChangeError({ ...base, seatId: 'A-2', nextIdx: 4, remaining: () => 2 })).toBeNull();
  });
  it('mesmo tipo não é mudança', () => {
    expect(seatTypeChangeError({ selectedSeats: ['A-1'], seatTypes: { 'A-1': 0 }, seatId: 'A-1', nextIdx: 0, remaining: () => 0, isMeia })).toBeNull();
  });
  it('lugares seguem a ordem dos ingressos (tipo crescente, estável)', () => {
    expect(orderSeatsByType([
      { seat_id: 'C-1', ticket_type_idx: 1 }, { seat_id: 'A-1', ticket_type_idx: 0 }, { seat_id: 'B-1', ticket_type_idx: 1 },
    ])).toEqual(['A-1', 'C-1', 'B-1']);
  });
});
