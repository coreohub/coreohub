// Setup de autenticação pro Playwright — multi-conta.
// Loga uma vez por role (admin / produtor), salva storage state em arquivo
// separado. Próximas runs de screenshot.mjs reusam o state da role escolhida.
//
// SEGURANÇA: este script faz mutation (POST /auth/login). Todos os outros
// scripts são read-only (goto + screenshot apenas).
//
// Uso:
//   node scripts/playwright.auth.mjs                # default: produtor
//   node scripts/playwright.auth.mjs --as=produtor
//   node scripts/playwright.auth.mjs --as=admin
//
// .env.local precisa ter as vars do role escolhido:
//   PLAYWRIGHT_ADMIN_EMAIL / PLAYWRIGHT_ADMIN_PASSWORD
//   PLAYWRIGHT_PRODUTOR_EMAIL / PLAYWRIGHT_PRODUTOR_PASSWORD
//
// Storage state expira quando a sessão Supabase invalida (geralmente 7d).
// Se screenshot.mjs der "redirect pra /auth", roda esse script de novo
// pra role afetada.

import { chromium } from '@playwright/test';
import { config } from 'dotenv';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });

// Parse --as=role do CLI. Default = produtor (uso mais comum, sem bypass de RLS).
const asArg = process.argv.find(a => a.startsWith('--as='));
const role = (asArg ? asArg.slice(5) : 'produtor').toLowerCase();
const validRoles = ['admin', 'produtor', 'inscrito', 'equipe'];
if (!validRoles.includes(role)) {
  console.error(`❌ Role "${role}" inválido. Use: --as=${validRoles.join(' | --as=')}`);
  process.exit(1);
}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.coreohub.com';
const EMAIL = process.env[`PLAYWRIGHT_${role.toUpperCase()}_EMAIL`];
const PASSWORD = process.env[`PLAYWRIGHT_${role.toUpperCase()}_PASSWORD`];
const STATE_PATH = resolve(__dirname, '.playwright-auth', `storage-${role}.json`);

if (!EMAIL || !PASSWORD) {
  console.error(`❌ Faltando PLAYWRIGHT_${role.toUpperCase()}_EMAIL ou PLAYWRIGHT_${role.toUpperCase()}_PASSWORD em .env.local`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  console.log(`→ Role: ${role} (${EMAIL})`);
  console.log(`→ Abrindo ${BASE_URL}/auth`);
  await page.goto(`${BASE_URL}/auth`, { waitUntil: 'networkidle' });

  console.log('→ Preenchendo credenciais');
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);

  console.log('→ Submetendo login');
  await page.click('button[type="submit"]');

  // Auth.tsx tem aliases /auth e /login — race condition no waitForURL pode
  // sair antes do token Supabase aparecer. Aguarda o token de verdade no
  // localStorage como sinal autoritativo de "logado".
  console.log('→ Aguardando token Supabase no localStorage');
  await page.waitForFunction(() => {
    const keys = Object.keys(localStorage);
    return keys.some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  }, { timeout: 15000 });

  // Espera mais um tick pra navegação após token settle (idle network).
  await page.waitForLoadState('networkidle', { timeout: 10000 });

  console.log(`✓ Logado, URL atual: ${page.url()}`);

  await mkdir(dirname(STATE_PATH), { recursive: true });
  await context.storageState({ path: STATE_PATH });
  console.log(`✓ Storage state salvo em ${STATE_PATH}`);
} catch (err) {
  console.error('❌ Erro no setup de auth:', err.message);
  await page.screenshot({ path: resolve(__dirname, '.playwright-auth', `auth-error-${role}.png`) });
  process.exit(1);
} finally {
  await browser.close();
}
