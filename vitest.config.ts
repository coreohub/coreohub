import { defineConfig } from 'vitest/config';

// Config de testes separada do vite.config.ts (build de produção) pra não
// arrastar plugins de PWA/React pro runner. Testa só lógica pura (utils +
// _shared do edge). Sem jsdom — nenhum teste toca DOM/React por enquanto.
//
// A19 Parte A (2026-05-30): cobertura de cálculo/regras que tocam dinheiro
// (lotes, comissão, PIX, status de pagamento, máscaras/validação BR). A Parte B
// (integração Asaas sandbox) fica pro futuro — alto atrito, baixo valor com 1 produtor.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // esbuild transpila os .ts do Deno (_shared) sem type-check — testamos
    // comportamento, não tipos (tipos já cobertos por `npm run lint`).
  },
});
