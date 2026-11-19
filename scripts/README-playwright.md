# Playwright screenshot runner

Workflow obrigatório da CoreoHub: depois de qualquer mudança visual estrutural (componente novo, layout, página inteira), rodar este runner em 1440×900 e 375×812 e auditar.

## Setup inicial (1x por conta)

1. **Credenciais** — copia `.env.local.example` pra `.env.local` na raiz e preenche **as duas contas**:
   ```
   PLAYWRIGHT_BASE_URL=https://app.coreohub.com

   # Super admin (vê /super-admin, bypass de RLS — útil pra testes admin)
   PLAYWRIGHT_ADMIN_EMAIL=coreohub@gmail.com
   PLAYWRIGHT_ADMIN_PASSWORD=...

   # Produtor real (sem bypass RLS — flagra bugs que o admin esconde)
   PLAYWRIGHT_PRODUTOR_EMAIL=festival@usualdance.com
   PLAYWRIGHT_PRODUTOR_PASSWORD=...
   ```
   `.env.local` está no `.gitignore` — nunca comitado.

2. **Storage state** — gera 1x por role (válido ~7d cada):
   ```powershell
   node scripts/playwright.auth.mjs                # default: produtor
   node scripts/playwright.auth.mjs --as=admin     # super admin
   ```
   Saída: `scripts/.playwright-auth/storage-{role}.json` (ignorado).

## Screenshot 1 rota

```powershell
node scripts/screenshot.mjs registrations              # default: produtor
node scripts/screenshot.mjs registrations --as=admin   # super admin
```

⚠ **Sem barra inicial em Git Bash no Windows** — MSYS converte `/registrations` em `C:\Program Files\Git\registrations` (path mangling). O script normaliza ambos os formatos, mas o seguro é passar sem barra.

Saída em `screenshots/`:
- `registrations-desktop.png` (1440×900)
- `registrations-mobile.png` (375×812)
- `registrations.report.json` (console errors + overflow check)

## Múltiplas rotas

```powershell
node scripts/screenshot.mjs registrations,qg-organizador,configuracoes
```

## Qual role usar?

**Default = produtor** porque:
- A maioria das telas com bug fica visível apenas pra produtor (super_admin bypassa RLS em várias). Bug RLS UPDATE descoberto em 2026-05-22 é exemplo — só apareceu testando como produtor real.
- Cobre 80% das telas do app (`/registrations`, `/qg-organizador`, `/configuracoes`, `/cronograma`, `/credenciais`...).

**Use `--as=admin`** quando:
- Testar `/super-admin` (página exclusiva).
- Validar dropdown "VISÃO" no header (só super_admin vê).
- Confirmar que features funcionam tanto pra admin (com bypass) quanto pra produtor (sem bypass) — vale rodar com os 2 roles e diffar.

## Definition of Done — leitura do report

O `report.json` traz pra cada viewport:
- `console_errors`: array. **Vazio = ✓ DoD critério "sem erros no console"**.
- `overflow.hasOverflow`: boolean. **false = ✓ DoD critério "sem overflow horizontal"**.

Os screenshots cobrem visualmente os critérios "funciona em desktop e mobile" + "segue design system" (revisão manual dos PNGs).

## Segurança — read-only

`screenshot.mjs` **NÃO clica em botões de mutation**. Só `page.goto` + `page.screenshot` + `page.evaluate` pra checks defensivos. Pode rodar contra prod com contas reais sem alterar dados.

`playwright.auth.mjs` é a única exceção (faz login). Roda 1x por role e reusa state.

## Quando re-rodar `playwright.auth.mjs`

- Se `screenshot.mjs` redireciona pra `/auth` (sessão Supabase expirou, ~7d).
- Se trocar de conta de teste pra um role.
- Se o login flow do app mudar.

Re-roda apenas pra role afetada — os storage states são independentes.

## Testar mudança que só existe na `dev` (localhost)

Staging (`staging.coreohub.com`) fica atrás do SSO da Vercel, então o Playwright não entra. O caminho é o
servidor local, que fala com o MESMO Supabase de produção (só leitura, não clique em mutation):

```powershell
npm run dev                                                         # http://localhost:3000
$env:PLAYWRIGHT_BASE_URL = "http://localhost:3000"
node scripts/playwright.auth.mjs --as=produtor                      # gera storage-produtor-localhost.json
node scripts/screenshot.mjs "account-settings?tab=Pagamentos"       # query string funciona (aspas)
```

O estado de sessão é por origem (localStorage), por isso localhost tem arquivo próprio
(`storage-<role>-localhost.json`) e não mexe no de produção.

## Sessão expirada

Se a sessão vencer o app redireciona pra `/auth` e a tela de login passa em "errors=0 overflow=false".
Desde 2026-11-19 o `screenshot.mjs` detecta isso: marca `auth_redirect` no report, imprime
`SESSAO EXPIRADA` e sai com código 1. Resolver: `node scripts/playwright.auth.mjs --as=<role>`.

## Login Google (OAuth)

Não precisa passar pelo Google. As contas de teste entram por e-mail e senha (o botão do Google é só uma
das opções da tela `/auth`). Telas com 2FA (`/super-admin`, `/cotacoes-terminal-juri`) continuam
bloqueadas sem o código TOTP ao vivo.
