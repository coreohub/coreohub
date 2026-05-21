# CoreoHub — Contexto pra Claude

Gestão inteligente pra festivais de dança (BR). SaaS multi-tenant onde produtor cadastra evento, recebe inscrições, vende ingressos, roda júri/cronograma/premiação, gera certificados, e o público compra ingresso e baixa material.

Em produção: ~71 telas, ~30 componentes compartilhados, 31 edge functions Supabase, 90+ migrations SQL.

## Produto

**Slogan:** "CoreoHub — Gestão Inteligente para Festivais de Dança"

### Modelo comercial
- **Sem mensalidade.** Receita 100% por comissão sobre venda.
- Comissão padrão: **10% sobre cada venda** (configurável por evento via `events.commission_percent`). Modo padrão `fee_mode = 'repassar'` (taxa embutida no preço pro inscrito), opção `'absorver'` (produtor absorve).
- Fluxo: inscrito paga → Asaas faz split automático → comissão CoreoHub vai pra master, líquido pro produtor.
- CoreoHub absorve todas as taxas de processamento de pagamento (PIX, boleto, cartão). Produtor paga só a comissão.
- Asaas cobra **R$ 12,90 única vez** pela abertura da subconta digital do produtor (debitado no primeiro recebimento). Coberto pela cláusula 5 do Termo do Produtor v1.2.

### Pagamentos
- **Asaas BaaS** — cada produtor tem subconta digital white-label sob a master CoreoHub. Aprovado em 2026-05-15.
- Métodos: **PIX nativo, cartão (crédito/débito), boleto, Pix do boleto**.
- Repasse com janela **D+7** (Settlement period — padrão Sympla/Stripe). Produtor pode antecipar via botão "Transferir agora" no painel.
- Termo do Produtor v1.2 cobre: comissão, taxas Asaas, janela D+7, autorização de débito automático pra chargebacks/estornos.

### Design system

**Paleta:**
- **Fundo:** `#000` (preto) — base de todas as telas internas, dark mode é o default.
- **Brand primary (magenta):** `#FF0068` — CTAs, badges ativos, foco. Hover: `#FF1A7D`.
- **Brand lime:** `#E3FF0A` — secundária pra destaques.
- **Brand cyan:** `#1DE7F2` — secundária pra info.
- **Status semânticos:** verde `#emerald-500` (success/disponível), âmbar `#amber-500` (atenção/retido), vermelho `#rose-500` (erro/destrutivo), azul céu `#sky-500` (info).

**Tipografia:**
- **Barlow Condensed** — títulos, headers, números grandes (estética esportiva/festival).
- **Inter** — corpo, formulários, labels, texto secundário.

**Estética visual:**
- Bordas arredondadas generosas (`rounded-2xl`, `rounded-3xl`).
- Cards com `border` sutil + `bg-white/5` (transparência) no dark mode.
- Uppercase + tracking widest pra labels secundárias (`text-[10px] font-black uppercase tracking-widest`).
- Itálico em títulos pra dar movimento (`font-black uppercase tracking-tighter italic`).
- Sem emojis em código — só se user pedir explícito.

### Landing page (em desenvolvimento)
- **Design system concluído** (paleta + tipografia + componentes base já definidos no app).
- **Próximo passo:** estruturar HTML da landing.
- **Páginas atuais relacionadas:** `pages/LandingPage.tsx` (geral), `pages/LandingGoverno.tsx` (vertical edital público), `pages/LandingEstudios.tsx` (vertical estúdio de dança), `pages/PropostaGoverno.tsx`. Todas lazy-loaded.

### Produtos relacionados (referências)
- **Festivais BR:** Joinville (maior do mundo, 50+ mil bailarinos), Catanduva, SESI, Cacon Dance, Usualdance.
- **Concorrentes/inspirações:** Sympla (carteira/repasse), Eventbrite (público amplo), DanceBug + CompetitionSuite (gestão de júri em festivais de dança US).

## Stack

- **Frontend:** React 19 + Vite 6 + TypeScript 5.8 + Tailwind v4 + Framer Motion. PWA via `vite-plugin-pwa` (`registerType: 'autoUpdate'`, workbox). Lazy loading agressivo em rotas (só Auth/LandingPage/MinhasCoreografias/Dashboard são eager).
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime + Edge Functions Deno). Sem servidor próprio.
- **Pagamentos:** Asaas (modelo BaaS — cada produtor tem subconta white-label sob a master CoreoHub).
- **Email:** Resend (`coreohub.com` verificado, `EMAIL_FROM=contato@coreohub.com`). Aliases @coreohub.com forwardam pra Gmail via Cloudflare Routing.
- **IA:** Gemini (Google GenAI SDK) pra extração de regulamento PDF; ElevenLabs pra narração de palco.
- **PDFs:** jspdf + jspdf-autotable pra certificados e exportações.
- **DnD:** @dnd-kit pra cronograma.
- **Drag estado offline:** IndexedDB via `idb` (terminal do júri, Phase 5).
- **Deploy:** Vercel (auto-deploy do branch `main`, projeto `coreohub`).
- **DNS/Edge:** Cloudflare proxy. Redirect `coreohub.com/{festivais,festival/,evento/}` → `app.coreohub.com/$path`.

## Setup local

```bash
npm install
npm run dev           # vite dev em http://localhost:3000 (porta override em vite.config)
npm run build         # produção (sempre rodar antes de commit não-trivial)
npm run preview       # serve dist/ localmente pra testar
npm run lint          # tsc --noEmit (type check, não tem ESLint configurado)
```

**Não tem testes automatizados.** A19 do backlog é montar Vitest + GitHub Actions, ainda em aberto.

`.env.local` exige:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Service role + chaves de provider ficam em **Supabase Functions Secrets** (Dashboard → Project Settings → Edge Functions → Secrets), nunca no frontend.

## Estrutura de pastas

| Path | Conteúdo |
|---|---|
| `pages/` (71 arquivos flat) | Telas. Sem subpasta. Roteadas em `App.tsx` via React Router 7. |
| `components/` (30 arquivos) | Componentes reutilizáveis (cards, modais, badges, banners). |
| `services/` | Wrappers + APIs: `supabase.ts` (cliente + helpers), `narrationApi.ts`, `geminiService.ts`, `offlineStore.ts`, `outboxDrainer.ts`, `judgeApi.ts`, `judgeApiOffline.ts`, `profileService.ts`, `demoApi.ts`. |
| `hooks/` | Hooks custom (`useT.ts` i18n do terminal). |
| `i18n/` | Dicionários PT/EN/ES (só terminal do júri, 130+ chaves). |
| `utils/` | Masks, formatters, error humanizer (`humanizeSupabaseError`). |
| `supabase/migrations/` (90+) | SQL versionado, formato `YYYYMMDD_descricao.sql`. |
| `supabase/functions/` (31) | Edge Deno, 1 pasta por function. Compartilhado em `_shared/`. |
| `api/` | Endpoints Vercel (raros — preferir edge function Supabase). |
| `scripts/` | Utilitários ad-hoc de manutenção. |
| `docs/` | Documentação operacional (asaas-setup, phase5-offline-testing, carrinho-sessao3-rollout). |
| `public/` | Estáticos do PWA (avatar, robots.txt). |
| `dist/` | Build output (não commitar). |

**Import alias:** `@/` → raiz do projeto (configurado em `vite.config.ts` + `tsconfig.json`). Ex: `import { supabase } from '@/services/supabase'`.

## Edge functions principais (31 totais)

Pagamentos:
- `asaas-webhook` — fonte da verdade. Branches: AT (audience ticket), WS (workshop), AGG (carrinho agregado), VS (taxa seletiva vídeo), legacy single registration.
- `create-asaas-subconta`, `create-payment-asaas`, `create-aggregate-payment-asaas`, `create-audience-ticket`, `create-workshop-registration`, `create-video-selection-payment`
- `refund-asaas-payment`, `refund-audience-ticket`, `process-video-refund`
- `daily-release-funds` (cron 03:00 UTC — Settlement D+7), `manual-transfer-now` (botão "Transferir agora")
- `expire-pending-payments`, `send-payment-reminders`

Operacional:
- `judge-login` (PIN + offline-aware), `seed-demo-event`, `seed-voice-samples`, `check-producer-kyc`, `disable-asaas-notifications`, `admin-impersonate`
- `gemini-analysis` (PDF regulamento → JSON), `generate-narration` (ElevenLabs)
- `send-email` (Resend, 8+ templates), `emit-certificates-batch`, `get-certificate-pdf`
- `cleanup-orphan-tracks`, `detect-workshop-combo`, `trigger-registration-payment`, `validate-audience-coupon`, `sitemap-xml`

**Deploy:** sempre via CLI local:
```powershell
supabase functions deploy <name> --project-ref ghpltzzijlvykiytwslu
```

## Convenções de código

### TypeScript
- `tsconfig.json`: `target: ES2022`, `module: ESNext`, `jsx: react-jsx`, `moduleResolution: bundler`, `allowJs: true`, `noEmit: true` (Vite faz transpile).
- **Sem `strict: true` ativado** — mas evitar `any` solto. Tipos centralizados em `types.ts` (raiz).
- Use `?? '' / ?? null` em vez de `||` pra defaults (evita coalescing de 0/falso).

### React
- Function components + hooks. Sem classes.
- Lazy loading via `React.lazy()` + `Suspense` pra rotas secundárias (padrão visto em `App.tsx`).
- State local com `useState`/`useReducer`. Sem Redux/Zustand global (cada tela é self-contained, sessão vem do Supabase Auth).
- **Não esconder componente novo via `return null`** — preferir empty state visível (ex: "Sem repasses ainda", "R$ 0,00"). Lição do dia 2026-05-20.

### Styling
- Tailwind v4 com `@theme` em `index.css`. Cores brand:
  - `brand-primary` = `#FF0068` (rosa CoreoHub)
  - `brand-lime` = `#E3FF0A`
  - `brand-cyan` = `#1DE7F2`
- Dark mode via `.dark` class (variant custom: `@variant dark (&:where(.dark, .dark *))`).
- Padrão de modal: Framer Motion + AnimatePresence (ver `ProducerBalanceCard.tsx`, `GuiaDoProdutor.tsx`).

### Datas
- Datas públicas (vitrine, ingresso, programação) sempre com weekday: `Sáb, 03 de junho de 2026`. Helper em `utils/formatters`.
- Timezone Brasil: usar `'T12:00:00'` ao construir Date de YYYY-MM-DD pra não cruzar fronteira UTC.

### Estado de pagamento
- Enum em `registrations.status_pagamento`: `PENDENTE`, `APROVADO` (NÃO `CONFIRMADO` — `CONFIRMADO` é legacy), `VENCIDO`, `ESTORNADO`, `AGUARDANDO_VIDEO`.
- `video_status`: `pending`, `submitted`, `approved`, `rejected`, `conditional`, `review_later`.
- `video_fee_status`: `not_required`, `pending`, `paid`, `waived`.

## Convenções de banco

- `event_id UUID` em todas as tabelas multi-tenant.
- **`configuracoes.id TEXT`** (não UUID) — uma row por evento com `id = event_id::text`. Trigger AFTER INSERT em `events` cria row vazia. Row legacy `id='1'` ainda usada por algumas telas — usar helpers `resolveActiveEventId()` e `fetchActiveEventConfig()` em `services/supabase.ts` em vez de `eq('id', 1)` direto.
- RLS habilitado em tabelas sensíveis. Super admin via `profiles.is_super_admin = true` + função `is_super_admin(uuid)`.
- Migrations idempotentes: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de criar.
- `NOTIFY pgrst, 'reload schema';` no fim de migrations que alteram colunas.
- Triggers de proteção: `protect_registrations_status_columns`, `protect_profiles_privileged_columns`, `protect_commission_columns_trigger` (bypassam pra service_role e roles administrativas).

## Convenções de edge function

- **Gate de service-role**: NÃO usar `auth.includes(envKey)`. Decode JWT + check `role === 'service_role'`. Veja `daily-release-funds/index.ts` linha ~52. Lição [feedback-jwt-role-check].
- **Env vars auto-injetadas:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`. Padrão: `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''`.
- **Asaas:** `ASAAS_API_KEY`, `ASAAS_BASE_URL` (prod: `https://www.asaas.com/api/v3`; sandbox: `https://sandbox.asaas.com/api/v3`), `ASAAS_WEBHOOK_TOKEN`.
- **Resend:** `RESEND_API_KEY`, `EMAIL_FROM`.
- **CORS:** sempre devolver `corsHeaders` (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`).
- **Idempotência de webhook:** ler `platform_commissions.asaas_payment_id` antes de inserir; UPSERT com `onConflict: 'asaas_payment_id,registration_id', ignoreDuplicates: true` em fluxos com N rows.

## Workflow do produtor (user real do repo)

- **Sem ambiente de staging.** Validação em produção real com PIX real (R$ ~33 da taxa de seletiva é o teste padrão).
- **Migrations:** user aplica colando no Supabase Dashboard → SQL Editor. Versionar em `supabase/migrations/` depois.
- **Deploys frontend:** push em `main` → Vercel auto-deploya (~1-2 min).
- **Deploys edge functions:** sempre via CLI manual (`supabase functions deploy ...`).
- **PWA cache:** quando deploy não aparece no front, **primeira hipótese é SW cacheando JS antigo**. Solução: DevTools → Application → Service Workers → Unregister + Storage → Clear site data + nova aba. Hard refresh NÃO basta (SW intercepta).

## Integrações em prod

| Serviço | Identificador |
|---|---|
| Supabase project ref | `ghpltzzijlvykiytwslu` |
| Supabase project URL | `https://ghpltzzijlvykiytwslu.supabase.co` |
| Asaas master wallet (CoreoHub) | `fb819422-c5c3-4abe-8f73-9bcc72ef894a` |
| Asaas webhook endpoint | `https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/asaas-webhook` |
| Vercel project | `coreohub` |
| App URL | `https://app.coreohub.com` |
| Marketing URL | `https://coreohub.com` |

## Features chave (não mexer sem ler antes)

- **Asaas BaaS** — subconta por produtor + split automático. Termo v1.2 cobre taxas + janela D+7. Em `pages/AccountSettings.tsx` (tab Pagamentos) + `pages/TermoProdutor.tsx`.
- **Settlement D+7** — repasse fica retido 7 dias na subconta pra cobrir refunds. Webhook insere `release_at = paid_at + 7d` em `platform_commissions`. Cron `daily-release-funds` libera no D+7. Botão "Transferir agora" antecipa. Sem D+7, Asaas deixa subconta negativa quando refund acontece pós-sweep (validado em smoke 2026-05-20).
- **Carrinho/fatura agregada** — Wizard cria registration PENDENTE, `/minhas-coreografias` agrupa, 1 PIX pra N inscrições. Prefixo `AGG:` no `externalReference` Asaas. Comissão distribuída proporcional via `charged_amount` snapshot.
- **Seletiva por vídeo** — 3 modelos (regulamento aberto / taxa única / taxa A análise + taxa B inscrição). Prefixo `VS:` no externalReference. Multi-jurado infra pronta no banco, UI v1 só single producer.
- **Modo Terminal (kiosk)** — `localStorage.coreohub_tablet_kiosk_mode = 'true'`. Tablet vira terminal isolado, app redireciona pra `/judge-login/<UUID>`. Auth via PIN 4 dígitos.
- **Phase 5 offline-first do júri** — terminal tem IndexedDB outbox (`services/offlineStore.ts`) + drainer com backoff. Submits queue local, sync quando volta online. Idempotência via `evaluations.client_uuid` (UNIQUE INDEX parcial).
- **Demo mode** — `events.is_demo = true`. Edge function `seed-demo-event` (actions create/delete/status) popula 50 coreografias + 3 jurados + 3 staff fakes + 5 prêmios + 1 evento [DEMO]. Banner amarelo sticky em todas telas internas do evento demo.

## Helpers úteis em `services/supabase.ts`

- `supabase` — cliente singleton.
- `supabaseUrl` — exportado pra outros lugares construírem URL de função.
- `resolveActiveEventId(hint?)` — resolve evento ativo (hint → mais recente do user → null).
- `fetchActiveEventConfig(columns, hint?)` — lê `configuracoes` do evento ativo, fallback id='1' legacy.
- `updateActiveEventConfig(updates, hint?)` — escreve em ambos (multi-tenant + legacy).
- `uploadEventCover`, `uploadEventRules`, `uploadMusic`, `uploadAudioFeedback`, `uploadRegulationPdf` — wrappers de Storage.
- `submitVideoForSelection`, `reviewVideoSubmission`, `updateVideoFeeStatus` — fluxo seletiva.
- `subscribeToRegistrations`, `subscribeToEvents`, `subscribeToVideoSelections` — Realtime.

## Identidades de teste em prod

- **Produtor (Hemer Roger dos Santos Martin)** — usa o sistema como produtor real. Subconta Asaas `833a8643-...`, wallet `51b3a044-...`.
- **Inscrito de teste (Cultural Estúdio)** — `contato.estudio.cla@gmail.com`. Cadastrado pela aba anônima, conta deletada a cada ciclo de teste.

## Memória persistente do Claude

Pasta `~/.claude/projects/.../memory/` tem contexto histórico denso. Em **toda conversa nova**, ler ANTES de agir:
1. `_operating_manual.md` — 10 erros recorrentes a evitar.
2. `session_resume.md` — estado atual + pendências + decisões recentes.
3. `MEMORY.md` — índice navegável.

## Histórico recente (últimas ~2 semanas)

Cronológico inverso. Detalhes individuais em `memory/`.

### 2026-05-20 — Settlement period D+7 ✅ SHIPADO + VALIDADO
Commits: `7fe91aa` → `08fdaa7` → `a13a164` (mais ajustes UX `afca00a`/`3893e49`/`021eb78`/`fae9c2a`). Mudança arquitetural grande:
- Webhook **deixou de fazer auto-saque imediato** (era o que causava o bug do refund pós-sweep).
- Saldo agora **fica retido 7 dias na subconta Asaas** (`platform_commissions.release_at = paid_at + 7d`).
- Cron diário `daily-release-funds` (00:00 BRT) libera no D+7+ via PIX.
- Botão "Transferir agora" no `/qg-organizador` antecipa via `manual-transfer-now` (modal de risco).
- Card `ProducerBalanceCard` unificado (padrão Stripe/Mercado Pago: 1 número grande + breakdown disponível/a-liberar).
- Termo do Produtor v1.1 → **v1.2** com cláusula 6 sobre janela D+7 e antecipação sob risco.
- Migrations: `20260521_settlement_period.sql` + `20260522_onboarding_dismissed.sql`.
- Guia do Produtor: etapa 4 "Compartilhar link" **removida** (redundante com header), etapas concluídas colapsam pra linha fina, card "Tudo pronto!" ganhou botão Fechar persistente.
- Smoke E2E em produção real: cenário 1 (settlement retém) + 1.5 (refund antes do D+7 funciona) + 2 (cron libera + refund pós-D+7 deixa subconta negativa) **TODOS PASSARAM**. Cenário 3 (botão) ainda pendente — opcional.
- **Insight descoberto:** Asaas não rejeita refund por saldo insuficiente — ele aceita e deixa a subconta negativa, debitando dos próximos créditos. Sem D+7, todo refund vira dívida não-consensual do produtor.

### 2026-05-19/20 — Carrinho fatura única (3 sessões)
Wizard cria registration PENDENTE, `/minhas-coreografias` agrupa, 1 PIX pra N inscrições. Sessão 1 = backend retro-compat, Sessão 2 = UI + Wizard refactor, Sessão 3 = auto-saque + banner KYC + fix timezone + send-payment-reminders + quick wins do painel. Todas validadas com PIX real.

### 2026-05-19 — Seletiva por vídeo v1
3 modelos cobertos (Modelo 1/2/3). Migration `20260604` + 3 edge functions novas (`create-video-selection-payment`, `process-video-refund`, `trigger-registration-payment`) + estendeu `asaas-webhook` com branch `VS:`. Multi-jurado tem infra de banco pronta, UI v1 só single producer (v1.1 backlog).

### 2026-05-18 — Aviso taxa subconta
Termo v1.0 → v1.1 com cláusula 5 (taxas Asaas, R$ 12,90 setup). 3 displays em `AccountSettings`.

### 2026-05-17 — 2FA super admin + Fase 4B pixels
MFA TOTP via Supabase Auth pro `/super-admin`. CAPI server-side Meta + GA4 MP, validação inline, fix bug duo.

### 2026-05-15 — Asaas em produção (marco BaaS)
BaaS aprovado, secrets prod configurados, webhook ativo, primeira subconta criada (Hemer KYC APPROVED). Pix nativo + boleto + cartão funcionando. Migrou 100% de Mercado Pago (legacy MP removido).

## O que falta fazer

Priorização cronológica detalhada em `memory/MEMORY.md` + cada item tem sua memória dedicada.

### 🟧 P1 — Alta prioridade, baixo esforço, destravado
- **KYC banner "Complete sua verificação"** (`#42` no `project_backlog.md`) — produtor novo cai na armadilha do Pix nativo. Edge function `create-asaas-subconta` precisa chamar `GET /myAccount/documents` e salvar `onboardingUrl` em `profiles`. UI banner amarelo em `/account-settings → Pagamentos`. ~1h mínimo.
- **Polimento selo Asaas** (`#35`) — login ganha variante mono + tamanho reduzido. ~15min.
- **Auditoria presença selo Asaas** (`#36`) — remover de 3 lugares (rodapé global, ProducerDashboard, VendasIngressos) + adicionar em 3 emails. ~30min.
- **Agrupar "Categoria Livre" + "Trilha Repertório"** (`#40`) — UI no modal de subgênero em `AccountSettings`. Header "Exceções de validação". ~10min.
- **Guia "Esconder por 14 dias"** — botão "Esconder por enquanto" pra produtor incompleto, persiste `onboarding_dismissed_at`, reaparece em 14d se ainda incompleto. ~30min.

### 🟨 P2 — Alto valor, esforço maior
- **Painel /registrations Sessão 4** — drill-down side panel + ações em massa + sort header + paginação. ~8-10h.
- **Phase 6 — Mesa de Som offline-first** (`#37`) — botão "Baixar pacote do evento" pré-cacheia trilhas + narrações no Cache API. Outbox de live_status. ~1-2 sprints.
- **A19 — Testes automatizados** — Vitest + GitHub Actions + mock Supabase client. 3 PRs (webhook → sweep/KYC/reminders → seletiva/pricing). ~4-6h. Trigger: ~5 produtores ativos OU primeira regressão cara.
- **Card Saldo: ler saldo real do Asaas via API** — hoje mostra `net_amount` esperado, pode divergir do saldo real se houver dívida pendente na subconta. UX a polir.

### 🟩 P3 — Aguardando trigger externo
- **TED como payout alternativo** — plano + taxas pronto, congelado até alguém pedir.
- **/LP nome festival + GA + vitrine na home** — bloqueado por decisão DNS (Hostinger → Cloudflare).
- **Multi-jurado seletiva v1.1** — página `/jurado-seletiva` dedicada (modo blind). Infra de DB pronta. Quando algum produtor demandar.
- **Cupom UI no `SeletivaInscrito`** — RPC `validate_video_coupon` existe, falta input no frontend. ~30min quando precisar.

### ⚠️ Pendência operacional
- **Subconta Hemer com saldo R$ -30,00 negativo** — sobra do smoke do D+7 (cron antecipou R$ 30 antes do refund debitar). Resolve sozinho no próximo PIX que cair (Asaas debita automaticamente) OU reposição manual via PIX (cláusula 6 do termo). Não bloqueia nada.

## Não fazer

- ❌ Sem testes ainda (A19 backlog) — validar manualmente em prod, com `npm run build` antes de commit.
- ❌ Sem `--no-verify` em commits sem motivo explícito.
- ❌ Sem service role no frontend (vai vazar em bundle).
- ❌ Sem `auth.includes(serviceKey)` em edge function (usar decode + role check).
- ❌ Sem `return null` silencioso em componente novo (empty state visível).
- ❌ Sem placeholder SQL pra user substituir (`<COLA_AQUI>`) — ele cola literal. Usar `DO $$` ou extrair do próprio banco.
- ❌ Sem instruções de DevTools acrobacia quando dá pra investigar via SQL.
