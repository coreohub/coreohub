// Screenshot runner read-only pro workflow Definition of Done.
// Abre a URL passada em 1440x900 (desktop) e 375x812 (mobile iPhone) e salva
// PNGs em screenshots/{slug}-{viewport}.png. Também captura erros do console
// e overflow horizontal — os 2 critérios principais da DoD.
//
// READ-ONLY: só faz page.goto + page.screenshot + page.evaluate. NUNCA clica
// em botões de mutation. Single-source-of-truth de segurança pra rodar
// contra contas reais em prod.
//
// Uso:
//   node scripts/screenshot.mjs registrations                  # default: produtor
//   node scripts/screenshot.mjs registrations --as=admin
//   node scripts/screenshot.mjs registrations,qg-organizador --as=produtor
//
// Precisa rodar playwright.auth.mjs antes (gera storage state pro role).
//
// Saída:
//   screenshots/registrations-desktop.png
//   screenshots/registrations-mobile.png
//   screenshots/registrations.report.json (errors + overflow check)

import { chromium, devices } from '@playwright/test';
import { config } from 'dotenv';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });

// Parse --as=role do CLI. Default = produtor (uso mais comum, sem bypass RLS).
const asArg = process.argv.find(a => a.startsWith('--as='));
const role = (asArg ? asArg.slice(5) : 'produtor').toLowerCase();
const validRoles = ['admin', 'produtor', 'inscrito', 'equipe'];
if (!validRoles.includes(role)) {
  console.error(`❌ Role "${role}" inválido. Use: --as=${validRoles.join(' | --as=')}`);
  process.exit(1);
}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://app.coreohub.com';
const STATE_PATH = resolve(__dirname, '.playwright-auth', `storage-${role}.json`);
const OUT_DIR = resolve(__dirname, '..', 'screenshots');

// Primeiro arg posicional (que não comece com --) = rotas.
const arg = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!arg) {
  console.error('❌ Uso: node scripts/screenshot.mjs registrations[,qg-organizador,...] [--as=admin|produtor]');
  console.error('   (sem barra inicial — Git Bash no Windows converte /rota em path absoluto)');
  process.exit(1);
}

// Tolerante a 3 formatos pra UX no Windows + Mac:
//   - "registrations"      → /registrations (recomendado)
//   - "/registrations"     → /registrations (POSIX shells / cmd Windows)
//   - "C:/Program Files/Git/registrations" → /registrations (Git Bash mangling)
const stripWindowsMangling = (s) => {
  // Path absoluto Windows (C:\...\) → pega segmento final
  if (/^[a-zA-Z]:[\\/]/.test(s)) return '/' + s.split(/[\\/]/).pop();
  // Múltiplos slashes iniciais (workaround MSYS) → reduz pra 1
  if (s.startsWith('//')) return '/' + s.replace(/^\/+/, '');
  return s;
};

const routes = arg
  .split(',')
  .map(r => r.trim())
  .filter(Boolean)
  .map(stripWindowsMangling)
  .map(r => (r.startsWith('/') ? r : `/${r}`));

// Storage state opcional — se não existe, segue sem login (cobre rotas públicas).
let hasState = false;
try { await access(STATE_PATH); hasState = true; } catch {}
if (!hasState) {
  console.warn(`⚠ Sem storage state pra role "${role}". Rode "node scripts/playwright.auth.mjs --as=${role}" primeiro.`);
  console.warn('   Seguindo SEM login (só rotas públicas vão renderizar corretamente).');
} else {
  console.log(`→ Role: ${role} (storage: ${STATE_PATH.split(/[\\/]/).slice(-2).join('/')})`);
}

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile:  devices['iPhone 13'].viewport, // 390x844, mas user pediu 375x812 — sobrescreve abaixo
};
viewports.mobile = { width: 375, height: 812 };

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });

for (const route of routes) {
  // Slug pra nome de arquivo: /registrations → registrations; / → home; /a/b → a-b
  const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');

  const report = {
    route,
    base_url: BASE_URL,
    timestamp: new Date().toISOString(),
    viewports: {},
  };

  for (const [viewportName, viewport] of Object.entries(viewports)) {
    const context = await browser.newContext({
      ...(hasState ? { storageState: STATE_PATH } : {}),
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    const url = `${BASE_URL}${route}`;
    console.log(`→ [${viewportName}] ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      // Aguarda animações Framer Motion etc completarem.
      await page.waitForTimeout(800);

      // Overflow horizontal: documentElement.scrollWidth > viewport.width
      // indica scroll horizontal indesejado (DoD critério).
      const overflow = await page.evaluate(({ vw }) => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hasOverflow: document.documentElement.scrollWidth > vw + 1,
      }), { vw: viewport.width });

      const screenshotPath = resolve(OUT_DIR, `${slug}-${viewportName}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      report.viewports[viewportName] = {
        screenshot: screenshotPath.replace(resolve(__dirname, '..') + '\\', '').replace(/\\/g, '/'),
        console_errors: consoleErrors,
        overflow,
        final_url: page.url(),
      };

      const status = consoleErrors.length === 0 && !overflow.hasOverflow ? '✓' : '⚠';
      console.log(`  ${status} ${viewportName}: errors=${consoleErrors.length} overflow=${overflow.hasOverflow}`);
    } catch (err) {
      console.error(`  ❌ ${viewportName}: ${err.message}`);
      report.viewports[viewportName] = {
        error: err.message,
        console_errors: consoleErrors,
        final_url: page.url(),
      };
    } finally {
      await context.close();
    }
  }

  const reportPath = resolve(OUT_DIR, `${slug}.report.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}

await browser.close();

console.log(`\n✓ Screenshots em ${OUT_DIR}`);
console.log('   Reports JSON com console errors + overflow check em cada *.report.json');
