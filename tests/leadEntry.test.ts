import { describe, it, expect, vi, beforeEach } from 'vitest';

const update = vi.fn();
vi.mock('../services/supabase', () => ({
  supabase: { from: () => ({ update: (v: any) => { update(v); return { eq: () => ({ is: () => Promise.resolve(updateResult) }) }; } }) },
}));
let updateResult: { error: { message: string } | null } = { error: null };

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

import { rememberEntryEvent, claimEntryEvent } from '../utils/leadEntry';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

describe('leadEntry', () => {
  beforeEach(() => { store.clear(); update.mockClear(); updateResult = { error: null }; });

  it('grava o evento lembrado pra conta recente e limpa a chave', async () => {
    rememberEntryEvent('ev-1');
    await claimEntryEvent('u1', daysAgo(0));
    expect(update).toHaveBeenCalledWith({ entry_event_id: 'ev-1' });
    expect(store.size).toBe(0);
  });

  it('sem evento lembrado não faz nada', async () => {
    await claimEntryEvent('u1', daysAgo(0));
    expect(update).not.toHaveBeenCalled();
  });

  it('conta com mais de 7 dias não é rotulada (e a chave some)', async () => {
    rememberEntryEvent('ev-1');
    await claimEntryEvent('u1', daysAgo(8));
    expect(update).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('evento lembrado há mais de 7 dias é descartado', async () => {
    rememberEntryEvent('ev-1');
    store.set('coreohub_lead_entry_at', String(Date.now() - 8 * 86400000));
    await claimEntryEvent('u1', daysAgo(0));
    expect(update).not.toHaveBeenCalled();
  });

  it('se a gravação falhar, mantém a chave pra tentar de novo', async () => {
    rememberEntryEvent('ev-1');
    updateResult = { error: { message: 'boom' } };
    await claimEntryEvent('u1', daysAgo(0));
    expect(store.get('coreohub_lead_entry_event_id')).toBe('ev-1');
  });

  it('sem id de evento, rememberEntryEvent ignora', () => {
    rememberEntryEvent(null);
    expect(store.size).toBe(0);
  });
});
