# Playwright screenshot runner

Workflow obrigatório do CoreoHub: depois de qualquer mudança visual estrutural (componente novo, layout, página inteira), rodar este runner em 1440x900 e 375x812 e auditar.

## Setup inicial (1x)

1. **Credenciais** — copia `.env.local.example` pra `.env.local` na raiz e preenche:
   ```
   PLAYWRIGHT_BASE_URL=https://app.coreohub.com
   PLAYWRIGHT_EMAIL=seuemail@dominio.com
   PLAYWRIGHT_PASSWORD=...
   ```
   `.env.local` está no `.gitignore` — nunca comitado.

2. **Storage state** — gera 1x, reusa em todas as runs (até a sessão Supabase expirar, ~7d):
   ```powershell
   node scripts/playwright.auth.mjs
   ```
   Saída: `scripts/.playwright-auth/storage.json` (também ignorado).

## Screenshot 1 rota

```powershell
node scripts/screenshot.mjs /registrations
```

Saída em `screenshots/`:
- `registrations-desktop.png` (1440×900)
- `registrations-mobile.png` (375×812)
- `registrations.report.json` (console errors + overflow check)

## Múltiplas rotas

```powershell
node scripts/screenshot.mjs /registrations,/qg-organizador,/configuracoes
```

## Definition of Done — leitura do report

O `report.json` traz pra cada viewport:
- `console_errors`: array. **Vazio = ✓ DoD critério "sem erros no console"**.
- `overflow.hasOverflow`: boolean. **false = ✓ DoD critério "sem overflow horizontal"**.

Os screenshots cobrem visualmente os critérios "funciona em desktop e mobile" + "segue design system" (revisão manual).

## Segurança — read-only

`screenshot.mjs` **NÃO clica em botões de mutation**. Só `page.goto` + `page.screenshot` + `page.evaluate` pra checks defensivos. Pode rodar contra prod com contas reais sem alterar dados.

`playwright.auth.mjs` é a única exceção (faz login). Roda 1x e reusa state.

## Quando re-rodar `playwright.auth.mjs`

- Se `screenshot.mjs` redireciona pra `/auth` (sessão expirou).
- Se trocar de conta de teste.
- Se o login flow do app mudar.
