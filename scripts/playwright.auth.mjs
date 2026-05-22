// Setup de autenticação pro Playwright. Roda 1x: loga com credenciais do
// .env.local, salva storage state em scripts/.playwright-auth/storage.json.
// Próximas runs de screenshot.mjs reusam esse state — sem precisar logar a
// cada execução.
//
// SEGURANÇA: este script faz mutation (POST /auth/login). Todos os outros
// scripts são read-only (goto + screenshot apenas).
//
// Uso:
//   node scripts/playwright.auth.mjs
//
// .env.local precisa ter:
//   PLAYWRIGHT_BASE_URL=https://app.coreohub.com
//   PLAYWRIGHT_EMAIL=email@exemplo.com
//   PLAYWRIGHT_PASSWORD=...
//
// Storage state expira quando a sessão Supabase invalida (geralmente 7d).
// Se screenshot.mjs der "redirect pra /auth", roda esse script de novo.

import { chromium } from '@playwright/test';
import { config } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.coreohub.com';
const EMAIL = process.env.PLAYWRIGHT_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_PASSWORD;
const STATE_PATH = resolve(__dirname, '.playwright-auth', 'storage.json');

if (!EMAIL || !PASSWORD) {
  console.error('❌ Faltando PLAYWRIGHT_EMAIL ou PLAYWRIGHT_PASSWORD em .env.local');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  console.log(`→ Abrindo ${BASE_URL}/auth`);
  await page.goto(`${BASE_URL}/auth`, { waitUntil: 'networkidle' });

  console.log('→ Preenchendo credenciais');
  // Auth.tsx tem 2 inputs (email + senha) e um botão "Entrar".
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);

  console.log('→ Submetendo login');
  await Promise.all([
    page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 15000 }),
    page.click('button[type="submit"], button:has-text("Entrar")'),
  ]);

  console.log(`✓ Logado, URL atual: ${page.url()}`);

  await mkdir(dirname(STATE_PATH), { recursive: true });
  await context.storageState({ path: STATE_PATH });
  console.log(`✓ Storage state salvo em ${STATE_PATH}`);
} catch (err) {
  console.error('❌ Erro no setup de auth:', err.message);
  await page.screenshot({ path: resolve(__dirname, '.playwright-auth', 'auth-error.png') });
  process.exit(1);
} finally {
  await browser.close();
}
