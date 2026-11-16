import { describe, it, expect } from 'vitest';
import { isPublicLightPath } from '../utils/publicLightRoutes';

describe('isPublicLightPath', () => {
  it('vitrine, checkout, ingresso e workshop ficam sempre claros', () => {
    for (const p of [
      '/evento/festival-level-up-2026',
      '/festivais',
      '/produtor/usualdance',
      '/checkout-ingresso/festival-level-up-2026',
      '/checkout-ingresso/festival-level-up-2026/1',
      '/meu-ingresso/abc123',
      '/workshop/jazz-funk',
      '/checkout-workshop/jazz-funk',
      '/checkout-workshop-pass/jazz-funk',
      '/meu-workshop/tok',
      '/validar-certificado',
      '/validar-certificado/hash',
      '/festival/meu-festival/leaderboard',
    ]) {
      expect(isPublicLightPath(p), p).toBe(true);
    }
  });

  it('painel, landings e palco seguem o tema salvo', () => {
    for (const p of [
      '/', '/lp', '/governo', '/planos', '/dashboard', '/qg-organizador',
      '/telao', '/telao/ABC123', '/festival/meu-festival/inscrever',
      '/festival/meu-festival/checkout', '/vendas-ingressos', '/evento',
    ]) {
      expect(isPublicLightPath(p), p).toBe(false);
    }
  });

  it('domínio próprio de evento: toda rota é pública e clara', () => {
    expect(isPublicLightPath('/', true)).toBe(true);
    expect(isPublicLightPath('/checkout-ingresso/x', true)).toBe(true);
  });
});
