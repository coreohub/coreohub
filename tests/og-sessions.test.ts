import { describe, it, expect } from 'vitest';
import { sessionsPreview, sessionFullLabel } from '../api/og';

const s = (d: string, t: string | null = null) => ({ start_date: d, event_time: t });

describe('sessionFullLabel', () => {
  it('data e hora completas', () => expect(sessionFullLabel(s('2026-12-20', '15:30:00'))).toBe('20/12/2026 às 15:30'));
  it('sem horario so a data', () => expect(sessionFullLabel(s('2026-12-20'))).toBe('20/12/2026'));
  it('sem data = null', () => expect(sessionFullLabel(s('', '15:30'))).toBeNull());
  it('hora de 1 digito', () => expect(sessionFullLabel(s('2026-12-20', '9:05'))).toBe('20/12/2026 às 09:05'));
});

describe('sessionsPreview', () => {
  it('menos de 2 sessoes = null', () => {
    expect(sessionsPreview([])).toBeNull();
    expect(sessionsPreview([s('2026-12-20', '15:30')])).toBeNull();
  });
  it('1 dia, 2 horarios', () =>
    expect(sessionsPreview([s('2026-12-20', '19:30'), s('2026-12-20', '15:30')])).toBe('20/12/2026 às 15:30 e 19:30'));
  it('1 dia, 3 horarios', () =>
    expect(sessionsPreview([s('2026-12-20', '10:00'), s('2026-12-20', '15:30'), s('2026-12-20', '19:30')])).toBe('20/12/2026 às 10:00, 15:30 e 19:30'));
  it('2 dias, ano uma vez so', () =>
    expect(sessionsPreview([s('2026-12-20', '15:30'), s('2026-12-20', '19:30'), s('2026-12-21', '19:30')])).toBe('20/12 às 15:30 e 19:30 · 21/12 às 19:30 (2026)'));
  it('3 dias curtos', () =>
    expect(sessionsPreview([s('2026-12-19', '20:00'), s('2026-12-20', '20:00'), s('2026-12-21', '20:00')])).toBe('19/12 às 20:00 · 20/12 às 20:00 · 21/12 às 20:00 (2026)'));
  it('10 dias cai no texto de periodo', () => {
    const slots = Array.from({ length: 10 }, (_, i) => s(`2026-12-${String(10 + i).padStart(2, '0')}`, '20:00'));
    expect(sessionsPreview(slots)).toBe('10 sessões de 10/12/2026 a 19/12/2026. Escolha o dia e o horário na página');
  });
  it('sessao sem horario: so dias', () =>
    expect(sessionsPreview([s('2026-12-20'), s('2026-12-21')])).toBe('20/12 · 21/12 (2026)'));
  it('anos diferentes mantem ano em cada dia', () =>
    expect(sessionsPreview([s('2026-12-31', '20:00'), s('2027-01-01', '20:00')])).toBe('31/12/2026 às 20:00 · 01/01/2027 às 20:00'));
  it('texto longo demais cai no periodo (mesmo dia)', () => {
    const slots = Array.from({ length: 9 }, (_, i) => s('2026-12-20', `${String(8 + i).padStart(2, '0')}:00`));
    expect(sessionsPreview(slots)).toBe('9 sessões em 20/12/2026. Escolha o dia e o horário na página');
  });
  it('ignora datas invalidas', () =>
    expect(sessionsPreview([s('2026-12-20', '15:30'), { start_date: null, event_time: '10:00' }])).toBeNull());
});
