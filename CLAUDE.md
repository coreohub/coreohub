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
- **Inter** — fonte única oficial (pesos 300-700 via Google Fonts no `index.html`). Cobre títulos, corpo e labels. Estética "esportiva/festival" alcançada com `font-black uppercase tracking-tighter italic` nos títulos.

**Catálogo completo de tokens, componentes e padrões em [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)** — fonte canônica pra "Segue o design system" da Definition of Done.

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

**Testes (A19 Parte A, shipado 2026-05-30):** Vitest com 81 testes de lógica pura que toca dinheiro (`tests/`, rodam em ~340ms). `npm test` (run único) ou `npm run test:watch`. Cobre lotes/preço, máscaras+validação CPF/CNPJ, status de pagamento, PIX/payout (`detectPixType`, `isKycPendingError`), e distribuição de comissão/cupom do carrinho multi-tipo (`_shared/audience-pricing.ts`). GitHub Actions (`.github/workflows/ci.yml`) roda lint + test em cada push/PR pra main. **Parte B (integração Asaas sandbox) deferida** — alto atrito com 1 produtor. `npm run lint` (tsc) agora só checa o frontend (tsconfig exclui `supabase/functions`/`api`/`scripts` — edge Deno tem runtime próprio).

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
| `supabase/migrations/` (95+) | SQL versionado, formato `YYYYMMDD_descricao.sql`. |
| `supabase/functions/` (32) | Edge Deno, 1 pasta por function. Compartilhado em `_shared/`. |
| `api/` | Endpoints Vercel (raros — preferir edge function Supabase). |
| `scripts/` | Utilitários ad-hoc de manutenção. |
| `docs/` | Documentação operacional (asaas-setup, phase5-offline-testing, carrinho-sessao3-rollout). |
| `public/` | Estáticos do PWA (avatar, robots.txt). |
| `dist/` | Build output (não commitar). |

**Import alias:** `@/` → raiz do projeto (configurado em `vite.config.ts` + `tsconfig.json`). Ex: `import { supabase } from '@/services/supabase'`.

## Edge functions principais (31 totais)

Pagamentos:
- `asaas-webhook` — fonte da verdade. Branches: AT (audience ticket), WS (workshop), AGG (carrinho agregado), VS (taxa seletiva vídeo), legacy single registration. Branch AGG incrementa `coupons.used_count` idempotente via marker `payments.coupon_redeemed_at` (refator 2026-06-01).
- `create-asaas-subconta`, `create-payment-asaas`, `create-aggregate-payment-asaas`, `create-audience-ticket`, `create-workshop-registration`, `create-video-selection-payment`
- `cancel-aggregate-payment` — cancela fatura PENDENTE no Asaas (DELETE /payments/{id}) + zera local. Diferencia 4xx/5xx Asaas (response `partial_cancel` quando 5xx). Usado pelo "X Remover cupom" em /minhas-coreografias.
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
- **Cupom no aggregate** — input "Tem cupom?" no card "PAGAR TODAS" → botão "Aplicar" valida client-side via `validateCoupon` → linha verde + X "Remover cupom" (padrão Stripe/Sympla). `coupon_code` no body de `create-aggregate-payment-asaas` distribui desconto linearmente nos `baseFee` de cada registration. `used_count` incrementa SÓ no webhook PAYMENT_RECEIVED via marker `payments.coupon_redeemed_at` (idempotente). Limite por inscrito via `coupons.max_uses_per_user`. Refator completo em 2026-06-01.
- **Carrinho de ingressos multi-tipo (plateia)** — comprador mistura tipos (ex: 2 Inteira + 1 Meia) num só checkout/pagamento. Vitrine (`PublicEventPage.tsx`) tem +/− por tipo + sticky bar com total → "Ir pro carrinho" navega pra `/checkout-ingresso/<slug>` passando `cart` via `location.state` (React state, não localStorage — zera ao sair, padrão Sympla). Checkout (`CheckoutIngresso.tsx`) tem resumo editável inline. Rota legada `/checkout-ingresso/<slug>/<idx>` vira `cart {idx:1}` no mount (cobre links antigos). Edge `create-audience-ticket` aceita `items: [{ticket_type_idx, quantity}]` (OU legado `ticket_type_idx + quantity`), chama RPC `try_reserve_audience_tickets_v2(p_items JSONB)` que reserva N tipos sob 1 `group_id` com advisory locks determinísticos (sem deadlock) + valida estoque/max_per_cpf/Lei 12.933 por tipo. Cupom é cart-level (1 por sessão, distribuído proporcional). Prefixo `AT:` no externalReference. v1 `try_reserve_audience_tickets` (monotipo) fica viva pra fallback. Webhook branch AT + email `audience_ticket_confirmed` já agrupavam por `payment_id`/iteram `tickets[]` — funcionam pra tipos misturados sem mudança. SHIPADO 2026-05-30 (commits `0b726c7` + `aab5ddd`), migration `20260619` aplicada. Smoke E2E ponta-a-ponta pendente (sem evento INTERNO com venda ativa em prod).
- **Seletiva por vídeo** — 3 modelos (regulamento aberto / taxa única / taxa A análise + taxa B inscrição). Prefixo `VS:` no externalReference. **Single-judge** (default): produtor decide solo em `/seletiva-video`. **Multi-jurado v1.1** (SHIPADO 2026-05-30): `events.video_evaluators_count >= 2` ativa banca blind — jurados avaliam em `/jurado-seletiva` (página standalone, login por PIN, esconde estúdio/coreógrafo), trigger `fn_aggregate_video_evaluations` agrega (maioria/unânime + conditional override). Config em `VideoSelection.tsx` (painel vira read-only quando banca ativa). Edge `judge-login` actions `get-video-queue`+`submit-video-evaluation`. Score opcional 0-10. Aviso de número ímpar pra evitar empate. Produtor que queira julgar se cadastra como jurado normal (PIN).
- **Modo Terminal (kiosk)** — `localStorage.coreohub_tablet_kiosk_mode = 'true'`. Tablet vira terminal isolado, app redireciona pra `/judge-login/<UUID>`. Auth via PIN 4 dígitos (aceita teclado físico desde 2026-06-11). **Navegação manual** (2026-06-11): menu `⋮` do `JudgeTerminal.tsx` abre painel com a fila inteira rolável (nº + coreografia + estúdio + status ✓avaliada/●atual/○pendente, toque pra ir) + botões "Anterior"/"Próximo" + atalho "pular pra #N". `goToIndex`/`requestGoToIndex` centraliza o reset; guard de unsaved (modal) só dispara com avaliação não submetida. `evaluatedSet` offline-aware (`fetchPreviousEvaluationsSWR` + adição otimista no submit). Tudo state local.
- **Phase 5 offline-first do júri** — terminal tem IndexedDB outbox (`services/offlineStore.ts`) + drainer com backoff. Submits queue local, sync quando volta online. Idempotência via `evaluations.client_uuid` (UNIQUE INDEX parcial).
- **Demo mode** — `events.is_demo = true`. Edge function `seed-demo-event` (actions create/delete/status) popula 50 coreografias + 3 jurados + 3 staff fakes + 6 prêmios + 1 evento [DEMO] + 20 vídeos de seletiva (solo) + 3 tipos de ingresso com estoque variado (Inteira 200 / Meia 14 = badge "Últimos N" / Solidária ilimitada) + 4 cupons multi-scope (`scopes[]` + `scope` legacy em sync; CHEGAJUNTO demonstra inscription+audience). Banner amarelo sticky em todas telas internas do evento demo. Princípio: cada feature aparece em estado "interessante", não vazio (boa prática Stripe Test Mode). **Multi-jurado seletiva fica SOLO no demo** de propósito — banca ≥2 tornaria `/seletiva-video` read-only e confundiria quem explora.

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

## Workflow obrigatório (decretado 2026-05-22)

1. **Plano antes de feature grande** — apresentar abordagem em 3-5 bullets e aguardar OK. Feature grande = > 1h estimada OU mexe em múltiplos arquivos/sistemas. Microchange (label/ícone/padding) segue direto.
2. **Playwright screenshot após mudança visual estrutural** — `node scripts/screenshot.mjs /rota` em 1440×900 (desktop) + 375×812 (mobile). Aplica a: componente novo, mudança estrutural, página com >20 linhas alteradas. NÃO aplica a microchange.
3. **Validar contra Definition of Done** — funciona em desktop+mobile (screenshots cobrem), sem erros no console (`report.json` checa), segue design system (paleta `#FF0068`/`#E3FF0A`/`#1DE7F2`, Barlow+Inter, rounded-2xl/3xl), sem overflow horizontal (`report.json` checa).
4. **Commit autônomo ao concluir etapa funcional** — sobrescreve default "only when requested". Commitar sem pedir confirmação.

Setup técnico em `scripts/README-playwright.md`. Read-only enforced (só `goto`+`screenshot`, nunca `click` em mutation). Detalhes operacionais em [[feedback-workflow-obrigatorio-dod]].

## Histórico recente (últimas ~2 semanas)

Cronológico inverso. Detalhes individuais em `memory/`.

### 2026-06-11 — Terminal júri navegação manual + voz narração + teclado PIN + frase LGPD ✅ SHIPADO
6 commits (`04c91a1` → `e211d9b`). Só frontend — nenhuma migration/edge function. Tudo em prod (Vercel).

- **Teclado do PIN do login** (`04c91a1`): `JudgeLogin.tsx` só tinha numpad on-screen (onClick); faltava listener de keydown. No desktop digitar não fazia nada. Agora aceita 0-9/Backspace/Esc (guard de 4 dígitos dentro do updater pra robustez contra closure velha).
- **Voz da narração no cronograma** (`6b1fc39`): bug multi-tenant. `/narracao-ia` salva `voice_id` na row do evento (só grava legacy `id='1'` se super admin); `Schedule.tsx` lia de `id='1'` → narração com voz velha/default ("aleatória"). Fix: lê/grava config por `event_id` (fallback legacy). `handleSaveSettings` (tempo_entrada/intervalo) idem (era `id='1'` compartilhada = vazamento). Lição: `.eq('id',1)` direto em `configuracoes` = bug latente multi-tenant. Detalhes em [[cronograma-voz-narracao-event-row-fix]].
- **Navegação manual no terminal** (`0a50ee7` + `967b44f` + `6aed319` + `e211d9b`): jurado não decora número. Menu `⋮` vira painel com fila inteira rolável (toque pra ir) + "Anterior"/"Próximo" + atalho #N. `evaluatedSet` offline-aware alimenta ✓avaliada. `goToIndex` centraliza reset. Guard de unsaved (modal `role=dialog`). Click-outside via `pointerdown` (touch tablet) + Esc. Rolagem com momentum (`-webkit-overflow-scrolling` + `touch-action: pan-y` + `overscroll-contain`). i18n PT/EN/ES. Detalhes em [[terminal-juri-navegacao-manual-shipado]].
- **Frase de áudio/LGPD** (`89dab5d`): bloco "Condições de participação" no Resumo do `InscricaoWizard` (step 3, cobre inscrição + seletiva). Transparência (não consentimento) — bailarino é terceiro, inscrito aceita ao confirmar. Frase única pra todos os eventos. Jurado é coberto por contrato (sem popup). Antes NÃO existia no código (TermoProdutor não tinha, não há regulamento-base).
- **Pendência de teste (user):** validar terminal em prod (lista/Anterior/Próximo/scroll no tablet) limpando o Service Worker antes. Backlog [[backlog-politica-audio-juri]] (config de política de áudio) segue aberto.

### 2026-06-10/11 — Terminal júri + Cronograma + Narração IA + Integrações de Marketing ✅ SHIPADO
Sessão grande (~6 commits). Tudo em prod, migrations `20260620`/`20260621` aplicadas, edge `judge-login` redeployada.

- **Terminal de júri** (`bec7b75` + `c2f1688`, migration `20260620`): fix numpad — dígito `1` não trava mais (digitar `1` depois `4` vira `1.4` automático; auto-decimal deixou de excluir o `1`) + bloqueia avanço de quesito com dígito solto (`isCurrentFieldReady`: BASE_10 exige nota completa, Enter/numpad físico era a causa). **Comentário escrito opcional** colapsável abaixo do ⭐ (não mexe no layout) → `evaluations.feedback_text` + `audit_log`. **Download pro inscrito** em `/meus-resultados`: botão "Baixar áudio" (fetch blob + objectURL) + comentário escrito + "Baixar folha de avaliação (PDF)" (jspdf, gated por publicado). **Spellcheck nativo** (`spellCheck`/`lang=pt-BR`/`autoCapitalize`/`autoCorrect`) nos 3 textareas de feedback. Edge `judge-login` persiste `feedback_text` no caminho do jurado por PIN. Detalhes em [[terminal-juri-comentario-numpad-download-shipado]].
- **Cronograma** (`77d0e20` + `819696e`, migration `20260621`): fix picker de eventos (não filtrava `created_by` → vazava eventos de OUTROS produtores, pois `events` é público). **Inscrições pagas aparecem automaticamente** — query filtra por PAGAMENTO (`status_pagamento` APROVADO/CONFIRMADO, setado pelo webhook via service_role; cobre gratuitos) OU `status='APROVADA'`, em vez de só `APROVADA` (que o trigger `protect_registrations_status_columns` impede o produtor de setar). **Remover/reincluir do cronograma** via coluna nova `excluded_from_schedule` (fora do trigger de proteção) — botão X na row + seção colapsável "Removidas (N)" com "Reincluir". Remover ≠ reprovar/estornar. Detalhes em [[cronograma-auto-aparecer-remover-shipado]].
- **Narração IA — voz** (`f3c200c`): `▶` de cada voz agora **também seleciona** (era só tocar sample, com `stopPropagation`) + botão "Testar com {voz}". NÃO era bug de save — SQL confirmou `voice_id='Kore'` salvo certo; era armadilha de UX. Detalhes em [[narracao-ia-voz-selecao-fix-shipado]].
- **Integrações de Marketing** (`a31cbe9` + `4950178`): reorganizado por plataforma (cards Meta/Google, era IDs-em-cima/tokens-embaixo que dava estado órfão) + Avançado colapsável (CAPI) + token travado até o ID existir. **Selo de status honesto** — "● Salvo" só quando bate com o snapshot do banco (`savedMarketing`), não "Conectado" ao digitar (não verificamos conexão real; verificação real só no server-side via webhook). Inclui nota GA4 cross-domain (mesmo Measurement ID nos 2 domínios `festival.usualdance.com` + `app.coreohub.com`, não precisa criar novo ID). Detalhes em [[integracoes-marketing-reorg-shipado]].
- **Backlog aberto:** política de áudio do júri (opcional/obrigatório/sem áudio + consentimento LGPD) em [[backlog-politica-audio-juri]] — NÃO implementar ainda.
- **Próximo passo combinado (#4):** terminal de júri em produção (hoje só aparece modo demo; garantir que coreografias do cronograma cheguem no terminal do jurado no dia do evento). Fluxo do dia do evento documentado em [[cronograma-auto-aparecer-remover-shipado]].
- **Pendência de teste (user):** validar tudo em prod limpando o Service Worker antes (PWA serve bundle antigo).

### 2026-06-07 — Login OTP no webview do Instagram + CPF do pagador no Solo ✅ SHIPADO
2 commits (`cab069d` + `7117d27`) pushados pra main. Só frontend — nenhuma edge function/migration.

- **Login por e-mail (OTP) dentro de in-app browser** (`7117d27`): o OAuth do Google quebra no webview do Instagram/Facebook/TikTok (Google bloqueia WebView, erro 403 `disallowed_useragent`). Solução opção 1 (só no webview): `utils/inAppBrowser.ts` (detector puro por user-agent + 7 testes) detecta o webview e `Auth.tsx` esconde o Google + mostra fluxo OTP (email → `signInWithOtp` com `shouldCreateUser` → código 6 dígitos → `verifyOtp({type:'email'})`). Fora do webview NADA muda. Descobertas-chave: cliente em **flow implícito** → link mágico funciona cross-browser; `auth-email-hook` JÁ manda link+código no mesmo e-mail (não tocou no e-mail). **Pré-req:** "Email OTP" habilitado no Supabase Auth. Opção 2 (passwordless pra todos) = futuro. Detalhes em [[otp-login-webview-instagram-shipado]].
- **CPF do pagador capturado no Solo** (`cab069d`): são 2 CPFs diferentes — bailarino (certificado, `elenco`) vs pagador (`profiles.cpf_cnpj`, fatura Asaas). Pagador é quase sempre o coreógrafo → auto-captura SÓ em Solo (1 bailarino); duo/trio/grupo coleta no pagamento. Modal de pagamento vira pré-preenchido + editável pra confirmar na 1ª cobrança (flag local `coreohub_cpf_confirmado_<id>`). Nunca cobra com CPF errado silenciosamente. Detalhes em [[cpf-captura-pagador-solo-shipado]].
- **Memória nova:** [[terminal-juri-offline-vs-navegador]] — pauta aberta (não implementar): terminal de júri nativo offline vs navegador/PWA.

### 2026-05-30 — A19 Parte A: testes automatizados ✅ SHIPADO
1 commit (`2f5181a`) + edge `create-audience-ticket` redeployada. Primeira rede de segurança automatizada do projeto. Detalhes em [[backlog-testes-automatizados-a19]].

- **Vitest 2.1.9** + **81 testes** (`tests/`, ~340ms) cobrindo lógica pura que toca dinheiro: lotes/preço, máscaras+CPF/CNPJ, status pagamento (regressão APROVADO vs CONFIRMADO), PIX/payout (`detectPixType`/`isKycPendingError`), distribuição comissão/cupom do carrinho.
- **Extração**: matemática de comissão/split saiu de inline na edge pra `_shared/audience-pricing.ts` (`computeAudienceCart`) — testável + não diverge do CheckoutIngresso. Edge importa de lá.
- **CI** `.github/workflows/ci.yml`: lint + test em cada push/PR (free tier).
- **Fix colateral**: `npm run lint` estava QUEBRADO (tsc varria edge Deno → centenas de erros). `tsconfig` agora exclui `supabase/functions`/`api`/`scripts`. Pegou 1 type error real no CheckoutIngresso (`lote.nome`).
- **Decisão**: só Parte A (lógica pura). Parte B (integração Asaas sandbox) deferida — atrito de credencial sandbox + secret não compensa com 1 produtor.

### 2026-05-30 — Multi-jurado seletiva de vídeo v1.1 ✅ SHIPADO
1 commit (`98f0b94`, +701 linhas) + edge `judge-login` redeployada. Backend de agregação já existia (migration `20260604`); faltava só o lado do jurado. Detalhes em [[plano-multi-jurado-seletiva-v1-1]].

- **Página `/jurado-seletiva`** (nova, `JuradoSeletiva.tsx`, standalone via JudgeStandaloneRoute) — fila blind: esconde estúdio/coreógrafo, mostra nº + estilo/categoria/formação + player. Aprovar/Reprovar/Condicional + feedback opcional + score opcional 0-10.
- **Edge `judge-login`** ganhou 2 actions (`get-video-queue` + `submit-video-evaluation`) + flag `video_selection_available` no validate. Reusa verifyJudge + token público + `judges.can_evaluate_video`.
- **`VideoSelection.tsx`** — config `video_evaluators_count`/`video_evaluation_rule` + aviso de número ímpar (evita empate) + painel read-only quando banca ≥2 (jurados decidem, não o produtor).
- **`JudgeLogin.tsx`** — pós-PIN oferece escolha "Seletiva de Vídeo" vs "Terminal de Palco" quando há banca ativa.
- **Decisões de produto**: score opcional; recomenda nº ímpar de jurados; produtor que queira julgar se cadastra como jurado normal (PIN) — reusa todo o fluxo de jurado, zero auth novo.
- **Smoke do trigger `fn_aggregate_video_evaluations` em prod** (BEGIN/ROLLBACK, 4/4 ✅): 2 approve+1 reject→approved; 1 approve+2 reject→rejected; qualquer conditional→conditional; empate 1-1 com voto faltando→submitted. E2E real do fluxo do jurado pendente (sem evento com banca configurado em prod).

### 2026-05-30 — Carrinho de ingressos multi-tipo na vitrine ✅ SHIPADO
2 commits (`0b726c7` feature + `aab5ddd` fix a11y) + migration `20260619_audience_cart_multi_type.sql` aplicada em prod + 2 edge functions redeployadas (`create-audience-ticket`, `send-email`).

Resolve gap vs Sympla/Eventbrite/Ticketmaster (que aceitam misturar tipos num só carrinho). Antes monotipo: comprador escolhia 1 tipo e finalizava; pra 2 Inteira + 1 Meia precisava de 2 compras separadas (2 PIX, 2 emails). Conversão (Baymard: cada checkout extra derruba ~15-25%). Plano fechado 2026-05-28 em [[backlog-carrinho-ingressos-multi-tipo]], implementação em [[carrinho-ingressos-multi-tipo-shipado]].

- **RPC v2** `try_reserve_audience_tickets_v2(p_items JSONB)` — reserva N tipos sob 1 `group_id`, advisory locks de estoque (por evento+tipo) + CPF adquiridos em ordem numérica determinística (impossível deadlock mesmo com carrinhos sobrepostos). Valida Lei 12.933 (máx 1 meia no cart), max_per_cpf (cart inteiro), estoque por tipo. Cupom cart-level incrementa `used_count` por total de tickets. v1 monotipo intacta pra fallback (não-breaking).
- **Edge `create-audience-ticket`** retro-compat: `items[]` (preferido) OU `ticket_type_idx + quantity` (legado). Resolve preço/kind/estoque por tipo, distribui desconto proporcional, 1 cobrança Asaas "2x Inteira, 1x Meia - Evento".
- **Vitrine + checkout** — +/− por tipo + sticky bar; checkout `/checkout-ingresso/<slug>` com resumo editável (decisão de produto: editável, padrão Sympla). Rota legada `/<idx>` ainda funciona.
- **Webhook AT + email** — zero/quase-zero mudança (já agrupavam por `payment_id`).
- **Smoke RPC v2 validado em prod** (3 cenários em BEGIN/ROLLBACK): cart misto → 3 tickets sob 1 group_id; 2 meia → erro Lei 12.933; 8 ingressos limite 6 → erro de limite. E2E ponta-a-ponta com PIX real pendente (precisa evento INTERNO com `audience_sales_enabled=true` — nenhum em prod hoje).
- **Incidente git paralelo**: sessão de `/revisar` simultânea arrastou 3 arquivos do WIP via `git add -A` (commit `77721bf`). Reconciliado sem perda. Lição em [[feedback-git-add-paralelo]] — nunca `git add -A` em projeto com sessões paralelas.

### 2026-05-28 (noite) — Cupom multi-scope + Funil 5 etapas + Drill-down + UTM + Recovery ✅ SHIPADO
1 commit (`b2ff5a7`) + 4 migrations (`20260615`–`20260618`) aplicadas em prod + cron `send-abandoned-reminders` agendado (job_id 33).

Sessão grande (~6h) consolidando 8 blocos tematicamente coesos sobre **conversão e cupom**. Pesquisa de mercado em cada bloco (Stripe/Sympla/Eventbrite/Mixpanel/Bizzabo). Detalhes em [[bundle-conversao-cupom-shipado]].

**Bloco 1 — Super-admin "Signups sem atribuição"**: card no `/super-admin` agrega `profiles WHERE entry_event_id IS NULL`. Total + 30d + breakdown por `entry_source`. Padrão Sympla/Eventbrite: plataforma é dona dos leads não-atribuídos.

**Bloco 2 — Funil 5 etapas (Visitas → Leads → Iniciadas → Pagas → Compareceu)**:
- Migration `20260618` + RPC `increment_event_view_count` (service_role only).
- Edge function `track-event-view` deployada — dedup client via localStorage TTL 30min (cookies cross-origin entre coreohub.com e supabase.co não funcionam).
- `PublicEventPage.tsx` dispara fire-and-forget no useEffect de view_event.
- `ProducerDashboard.tsx` card antigo 3 → 5 etapas. Padrão Stripe Checkout / Eventbrite Insights.

**Bloco 3 — Cupom multi-scope estrutural**: migra `coupons.scope TEXT` enum (6 valores) → `coupons.scopes TEXT[]` array (15 combinações). Backfill: `'both'` → `[inscription, audience]`, `'all'` → 4 surfaces, else `[scope]`. Índice GIN + CHECK constraint cardinality>=1. Coluna legacy `scope` mantida durante transição (~2 semanas pra rolar PWA cache) — edge functions filtram com `OR`. UI Coupons.tsx aceita qualquer combinação 1-4; mensagem "Combinação não suportada" sumiu. RPCs `validate_audience_coupon` + `validate_workshop_coupon` v2 com filtro `ANY(scopes)`. 5 edge functions redeployadas. types.ts: `Coupon.scopes?` array; `scope` deprecated.

**Bloco 4+7 — Drill-down "Quem usou" + Performance R$**: hook `refresh` em [Coupons.tsx](pages/Coupons.tsx) agrega counter+revenue+discount por `coupon_id` em 4 fontes (payments aggregate, registrations, audience_tickets, workshop_registrations). Inline na coluna: `7 usos · R$ 1.260 · -R$ 252`. Click no contador abre Drawer via `createPortal(document.body)` — lição [[licao-createPortal-stacking-context]] aplicada. `Registrations.tsx fetchData` agora hidrata `couponCodeById` (1 query). Side panel mostra código real (`SARAHTINEL · R$ 20,00 de desconto`) — antes era genérico "Cupom".

**Bloco 5 — UTM source no signup** (migration `20260617`): `profiles.entry_source TEXT` + índice partial. `Auth.tsx` captura UTM param ou infere de `document.referrer` (instagram/facebook/whatsapp/google/youtube/tiktok/bing/referral) ou `'direct'`. `persistLeadEntrySource` separado do `persistLeadEntryEventId` — captura mesmo signups direct (sem evento). Padrão GA4 default channel grouping.

**Bloco 6 — Coorte temporal no funil**: seletor "Todo período / 30d / 7d" no header do card. Aplica `gte('created_at')` em todas as queries do funil. Visitas só aparecem em "Todo período" (view_count é acumulado, não tem cohort por design — mostra "—" nas janelas). Padrão Mixpanel/Amplitude.

**Bloco 8 — Email "Você esqueceu de finalizar sua inscrição?"**:
- Template `buildAbandonedRegistration` + case `'abandoned_registration'` em send-email. Subject: `[Evento] Você esqueceu de finalizar sua inscrição?`.
- Edge function `send-abandoned-reminders` deployada (JWT decode + role check). Critério: `status_pagamento=PENDENTE` + `payment_id IS NULL` + `payment_group_id IS NULL` + `created_at` em [24h, 7d] + `user_id NOT NULL`. Agrupa por (user_id, event_id). Idempotência single-shot via notif type `abandoned_registration`. Skip se `prazo_inscricao < today`. Limit 500 por execução.
- Cron `send-abandoned-reminders` agendado job_id 33 (10:30 BRT diário). Vai disparar vazio até houver inscrições abandonadas reais.
- Recovery rate típico Sympla/Hotmart: 15-25%.

**Decisão registrada (não implementada)**: cupom com produtos específicos (Stripe-style por modalidade/categoria/workshop/ticket_type) defer no P2 até produtor pedir granularidade.

### 2026-05-28 — Blindagem do label governo + workshop gratuito ✅ SHIPADO
1 commit (`2af8c21`) + migration `20260613_protect_event_type.sql` aplicada em prod.

**Brecha identificada**: qualquer produtor podia marcar o próprio evento como "Governamental" no [CreateEvent.tsx:291](pages/CreateEvent.tsx#L291), escapando da etiqueta oficial CoreoHub-tem-contrato e poluindo o filtro Governo do super-admin. Inscrição vira grátis (já tinha [create-payment-asaas:58](supabase/functions/create-payment-asaas/index.ts#L58) bloqueando cobrança em governo), mas integridade da classificação fica corrompida. Coluna `event_type` também não estava no trigger `protect_commission_columns`, então dava pra mudar via curl direto.

**Fix em 3 frentes**:
- **CreateEvent.tsx**: remove o card "Governamental" do self-service. Produtor só cria "Privado". Substitui pelo helper card emerald explicando como rodar evento gratuito sem governo: taxa R$ 0 nas formações → Checkout detecta + mostra "GRATUITO" + APROVADO sem Asaas (fluxo já existia em [Checkout.tsx:213-226](pages/Checkout.tsx#L213-L226)).
- **Migration `20260613_protect_event_type.sql`**: estende trigger pra cobrir `event_type`. Padrão idêntico ao das outras colunas financeiras desde [20260429](supabase/migrations/20260429_protect_commission_columns.sql). Super-admin (COREOHUB_ADMIN) e service_role continuam podendo (seed-demo-event precisa setar event_type ao criar demo).
- **SuperAdmin.tsx**: quando super-admin troca `event_type` pra `government` no EventCommissionModal, aplica default `politica_ingressos='GRATUITO'` (boa prática BR: editais públicos quase sempre têm entrada franca). Espelha em events + configuracoes. Best-effort.

**Polimento workshop** (mesmo commit):
- Badge "Gratuito" emerald em [WorkshopsManagement.tsx:443](pages/WorkshopsManagement.tsx#L443) quando preço efetivo (`activeLot.preco ?? preco_padrao`) é 0 E não tem `gratis_para_inscritos`. Antes ficava só "R$ 0,00" ambíguo. Paraleliza com a política "Gratuito" dos ingressos.

**Decisões registradas** (não implementadas — viraram backlog):
- **"Vendas de Ingressos" mantém o nome**: colisão com `/ingressos` da página de comprador (MyTickets em [Ingressos.tsx](pages/Ingressos.tsx)). Padrão Sympla/Eventbrite: produtor vê "vendas", comprador vê "meus ingressos". Renomear quebraria a semântica.
- **Tipos de ingresso continuam na aba GERAL**: sem o rename, migrar criação pra página de Vendas perderia coerência semântica (página fica focada em sales).
- **Gap "produtor 100% grátis"** [[backlog-modelo-comercial-evento-gratis]]: produtor pode rodar evento Privado com taxa 0 + workshops grátis + ingressos grátis usando toda infra (IA Gemini, narração ElevenLabs, Júri Terminal, certificados) sem gerar receita. 4 modelos de mercado mapeados — recomendação Setup fee por evento grátis (~R$ 297-997, padrão Bizzabo/Cvent, ~3h implementação). Decisão comercial pendente.
- **Painel de contrato governo**: user vai pensar se modela dentro da CoreoHub ou usa ERP separado. Plano técnico (tabela `government_contracts` + super admin section) escrito em `~/.claude/plans/modular-forging-scroll.md` mas NÃO implementado.

### 2026-05-27 — Prêmios com valor R$ + DEMO/Regulamento IA atualizados ✅ SHIPADO
3 commits (`ae0e4f4` → `0752eda`).

**Premiação valor R$ + template Coreógrafo(a) (`ae0e4f4`, `74e3be3`, `d2d0284`)**:
- Campo `valor?: number` em `SpecialAward` ([AccountSettings.tsx:236](pages/AccountSettings.tsx#L236), JudgeTerminal TS-only, vitrine pública em emerald quando >0).
- Descrições padrão dos templates **limpadas** (poluíam — só nome + descrição opcional + valor).
- Novo template **"Melhor Coreógrafo(a)"** (id `tpl_coreografo_pessoa`) — premia a pessoa, separado de "Melhor Coreografia" (a obra). ID do template original `tpl_coreografo` preservado pra não quebrar premios já salvos (merge por id).
- Templates **NÃO editáveis no nome** (decisão de produto: template = sugestão consistente de mercado, custom = liberdade). Descrição/valor editáveis dão flexibilidade.
- 6 `aria-label` adicionados nos inputs de prêmio.
- **Incidente**: durante refactor removi declaração do state `editingAwardId` por engano → tab Prêmios quebrou com ReferenceError em prod (~10min). Fix em `74e3be3`. Lição [[feedback-smoke-tabs]]: smoke do Playwright só carrega URL default, NÃO navega tabs — mudança em tab específica precisa validação manual da tab.

**DEMO + Regulamento IA cobrindo features novas (`0752eda`)**:
- **seed-demo-event**: 6 prêmios (com Coreógrafo(a)) + 3 com valor R$; bailarinos com **CPF válido (módulo 11) + data_nascimento** inseridos em `elenco` real (IDs em bailarinos_detalhes) — elimina banner falso "dados pendentes" no Dashboard do demo; cleanup deleta só elenco do demo (preserva real); cupons com `max_uses_per_user`.
- **gemini-analysis**: schema ganha `prizes[].valor` (instrução forte anti-alucinação "só se PDF citar explícito"), `formacoes[].min/max_performers`, `bonifications[]` (bolsas/intercâmbios textuais).
- **RegulationAIParser + geminiService**: propaga `valor` no merge (preserva existentes via dedup por nome).
- 2 edge functions redeployadas. Build OK.
- **NF emission**: decisão de NÃO implementar agora (produtor MEI Hemer não emite NF automática; demanda vira WhatsApp manual).

### 2026-05-22 (noite — maratona cupom UX + idempotência + cleanup) ✅ SHIPADO
16+ commits (`e66ca37` → `b6c8031`). Sessão mais longa registrada. Cobriu refator dados-pendentes (top1 da sessão anterior), cupom no fluxo agregado/single/seletiva ponta-a-ponta, UX padrão Stripe/Sympla, idempotência via webhook, +3 pendências separadas resolvidas no fim. Detalhes em [[refactor-elenco-dados-pendentes-shipado]] + [[cupom-aggregate-shipado]].

**Refator dados-pendentes (6 commits `e66ca37` → `f57a9cb`)**: helper `hasIncompleteBailarinos` antes lia `bailarinos_detalhes` (JSONB com só id+nome+@) procurando CPF/data_nascimento que ficam na tabela `elenco`. Refator: migrations RLS pro produtor ler `elenco` filtrado por subquery LATERAL nos bailarinos_detalhes das inscrições do evento dele (não vaza elenco entre produtores). 3 frontends + edge function `send-incomplete-data-reminders` agora consultam `elencoById` hidratado em batch. Editor inline em Registrations + MinhasCoreografias faz UPSERT em elenco (não no JSONB). Falso positivo "10 com dados incompletos" eliminado em prod.

**checkViolation (`d5f8488`)**: mesmo bug do dados-pendentes — triagem etária lia `b.data_nascimento` do JSONB (sempre undefined) → outOfRange sempre vazio → aba TRIAGEM nunca funcionou. Fix: lê via elencoById (deps atualizadas).

**Cupom no fluxo agregado (10 commits `b5c2be4` → `b6c8031`)**: o refator do carrinho de 2026-05-19 deixou cupom órfão no `Checkout.tsx` — Wizard navega direto pra `/minhas-coreografias` sem passar por lá. Implementado fim-a-fim:
- Edge `create-aggregate-payment-asaas` aceita `coupon_code`, distribui desconto linearmente nos baseFee, persiste `coupon_id` em payments+registrations
- Edge `create-payment-asaas` (single) aceita `coupon_code` além de `coupon_id`
- Edge `cancel-aggregate-payment` nova — cancela fatura PENDENTE no Asaas (DELETE /payments/{id}) + zera local. Diferencia 4xx/5xx (response `partial_cancel` quando 5xx)
- Webhook (branches AGG, single, video_selection) incrementa `used_count` idempotente via markers `payments.coupon_redeemed_at` + `registrations.coupon_redeemed_at`. Retry de webhook vira noop. Cancelar antes de pagar não infla used_count.
- UI padrão Stripe/Sympla: "Tem cupom?" sempre visível → botão Aplicar (validateCoupon client) → linha verde com X "Remover cupom" unificado pros 2 estados (applied client + fatura PENDENTE com cupom). Click X dispara cancel silencioso se há fatura. UX padrão Sympla — vocabulário do user, não interno.
- `coupons.max_uses_per_user` (limite por inscrito) — boa prática Sympla/MP. Validado client+server (dupla checagem).
- Edge function aggregate detecta "ghost pointer" (registration.payment_group_id apontando pra payment morto): zera silenciosamente e segue. Resolve race condition do user que clica PAGAR TUDO → PAGAR SÓ ESTA → PAGAR TUDO em sequência.
- Spinner travado pós-bfcache fixado (listener `pageshow`).

**3 pendências separadas resolvidas (`b6c8031`)**:
1. Idempotência seletiva — `create-video-selection-payment` + webhook branch VS espelha o que foi feito no aggregate/single.
2. DROP policies fantasmas em `registrations` — "Acesso Total Registrations" + "Permitir Atualização" (ambas com `true/true`, criadas via Dashboard manual, esquecidas). Risco de segurança alto (qualquer authenticated UPDATE qualquer registration).
3. Crons 401 — `app.settings.service_role_key` NULL em prod fazia 5 crons retornarem 401. Reagendados via `cron.schedule` com chave hardcoded em texto (visível só pra superuser). 6 crons HARDCODED OK. Pendência: se rotacionar service_role, rodar `DO $$` block de novo (anotado em [[feedback-cron-app-settings-null]]).

**Migrations aplicadas em prod (7)**: 20260601 (RLS produtor lê elenco) → 20260602 (RLS produtor UPDATE elenco) → 20260603 (payments.coupon_id) → 20260604 (payments.coupon_redeemed_at) → 20260605 (coupons.max_uses_per_user) → 20260606 (registrations.coupon_redeemed_at) → 20260607 (DROP policies fantasmas).

**Lições dolorosas anotadas**: vocabulário do user > implementação ("Cancelar fatura" → "Remover cupom"), pesquisar boas práticas ANTES de propor UI, sempre unificar UI pelo gesto não pela complexidade interna, bfcache preserva React state (listener `pageshow` resolve), SQL diagnóstico antes de hipótese.

### 2026-05-22 (madrugada — virou de quinta) — 🚨 Sessão A DESABILITADA em prod por bug grosso

Commit `4602573`. Após shipping da Sessão A (~6h antes), Grazieli avisou que cadastrou os 40 CPFs sim. Auditoria via SQL confirmou: **61 bailarinos em `elenco`, 61 com CPF, 61 com data_nascimento**. Tudo completo. Helper meu lia o lugar errado.

**Bug**: helper `hasIncompleteBailarinos` em 3 lugares (`Registrations.tsx`, `Dashboard.tsx`, edge function) procurava `cpf`/`data_nascimento`/`nome` em `registrations.bailarinos_detalhes` — JSONB que SÓ tem `{id, nome, instagram_handle}` (referência leve). CPF/data ficam na tabela **`elenco` separada**, código `pages/InscricaoWizard.tsx:826-835` mostra isso explicitamente. Eu deveria ter aberto o INSERT antes de codar o helper.

**Impactos em prod** (antes do disable):
1. Cron rodou 09:30 BRT e inseriu notif falsa pra TODOS os inscritos pagos
2. Banner amber no `/dashboard` aparecia pra todos
3. Chip "X com dados incompletos" no painel `/registrations` sempre não-zero
4. Badge "DADOS PENDENTES" + fundo amber por bailarino — idem
5. User passou vergonha com cliente real

**Fix temporário (`4602573`)**:
- Edge function retorna 200 com `sent=0` cedo (no-op)
- `hasIncompleteBailarinos` retorna `false` constante
- Banner amber removido do Dashboard
- Notif falsas deletadas via SQL no Dashboard

**Mantido (não dão dano sozinhos)**: editor inline de bailarinos em `/minhas-coreografias`, componente `BailarinosEditor.tsx`, conta `inscrito@coreohub.com`, storage Playwright inscrito.

**Top 1 próxima sessão**: refator com `elenco` JOIN (`plano_refactor_elenco_dados_pendentes.md`). Migration RLS elenco pro produtor + refator helper x3 + hidratar elencoById + refator editor pra UPSERT em elenco + re-habilitar edge function. ~5h.

**Lição capturada**: antes de escrever helper que LÊ um campo, abrir o INSERT que ESCREVE nesse campo + confirmar shape exato. TS type permite shape vago `any[]`, mas conteúdo real é definido no INSERT. Reforço em [[feedback-consultar-memoria-antes-implementar]].

### 2026-05-22 (tarde/noite) — Sessão A (notificação Grazieli) ⚠️ SHIPADO mas DESABILITADO mesma noite
6 commits (`b6e4444` → `0c9af1a`). Objetivo: garantir que quando a Grazieli abrir o app (via notificação in-app + WhatsApp manual), ela tem pra onde ir e como completar os 40 CPFs faltando em 10 inscrições do Usualdance. Sem A1+A2+A3, WhatsApp dela cairia em beco sem saída.

**A2 — Edge function `send-incomplete-data-reminders`** (`b6e4444`): cron diário 09:30 BRT que varre registrations APROVADAS/CONFIRMADAS com bailarinos incompletos (CPF/nome/data_nascimento vazios) e insere notif in-app pro user. Idempotência por dia via `metadata->>'reminder_type' = 'dados_pendentes_YYYY-MM-DD'`. Sem email — WhatsApp manual é o canal de pressão. Texto da notif diferenciado pra zumbi (sem array de bailarinos) vs incompleto parcial. Cron agendado job_id 13.

**A1 — Editor inline de bailarinos em `/minhas-coreografias`** (`ef818ae`): inscrito edita CPF/nome/data/Instagram dos próprios bailarinos sem precisar pedir pro produtor. Botão "Editar dados" em cada card (PENDENTE ou APROVADO/CONFIRMADO). Modal centralizado com novo componente compartilhado `components/BailarinosEditor.tsx` (refactor — `pages/Registrations.tsx` também passou a usar, removendo ~120 linhas de Tailwind inline). Decisão 1B locked: edita perene quando `prazo_inscricao` está vazio; trava com mensagem clara após expirar. Validação CPF + data ISO + Instagram lowercase. RLS `inscrito_own_registrations` cobre. `.select('id')` no `.update()` detecta bloqueio silencioso (mesmo hardening do painel do produtor).

**A3 — Banner "dados pendentes" no `/dashboard`** (`4846055`): card amber sticky no topo quando inscrito tem ≥1 coreografia paga com bailarinos incompletos. CTA "Completar →" navega pra `/minhas-coreografias`. Helper `hasIncompleteBailarinos` replicado inline (mesma lógica do painel + edge function).

**A4 — Storage state Playwright pra inscrito**: `scripts/playwright.auth.mjs` + `scripts/screenshot.mjs` ganham `--as=inscrito` no `validRoles`. `.env.local.example` agora documenta 3 contas (admin/produtor/inscrito). Conta `inscrito@coreohub.com` criada via Dashboard > Add User (signup endpoint do app retornou 500 — bug separado anotado em pendência operacional).

**Fix crítico JWT decode anti-pattern** (`0c9af1a`): smoke E2E descobriu que `send-incomplete-data-reminders` + `send-trilha-reminders` usavam `authHeader === \`Bearer \${env.SUPABASE_SERVICE_ROLE_KEY}\`` — exatamente o anti-pattern documentado em [[feedback-jwt-role-check]] desde 2026-05-20. Causa: pg_cron envia JWT válido mas que pode ser de geração diferente do env (caso de rotação histórica). String não bate, retorna 401. Fix: decodifica payload do JWT + valida `role === 'service_role'` (Supabase platform já valida assinatura via verify_jwt=true antes da function rodar). Pattern já aplicado em `daily-release-funds/index.ts:63` desde 2026-05-20 — só não tinha sido replicado nas 2 funções novas. Ambas re-deployadas via CLI.

**Conta `inscrito@coreohub.com` criada via Dashboard Add User** porque o signup endpoint do app está retornando 500 em prod. Bug crítico em produção (qualquer inscrito novo não consegue se cadastrar via app). Pendente investigar em `Authentication → Logs` ou Auth Hooks. Workaround: produtor cria conta manualmente pelo Dashboard.

**Smoke E2E validado end-to-end**:
- Como inscrito → `/dashboard` mostra banner amber "1 coreografia com dados pendentes" + Guia de Inscrição + cards do evento
- `/minhas-coreografias` mostra card da inscrição mock com botão "EDITAR DADOS" + chips COMPETITIVA/JUNIOR/JAZZ + status CONFIRMADA
- Cron invocado via `net.http_post` → status 200, `total_scanned: 11, total_pending: 11, sent: 11`
- Sininho com badge "1" aparece no header em tempo real (realtime postgres_changes)

**Decisões da sessão**:
- Grazieli vai receber **1 notif consolidada** ("Você tem 10 coreografias com bailarinos sem CPF") em vez de 10 spammando o sino. Inserida manualmente via SQL (delete das 10 que o cron tinha inserido + insert da agregada). Em sessão futura vale agregar por user no próprio cron.
- 10 outras contas no Auth são leads (logaram via Google/Email mas zero inscrições). Vale virar feature "Funil de leads" no painel produtor (P3 backlog).

**Achados de auditoria**:
- 11 users em `auth.users`, apenas Grazieli (10) e `inscrito@coreohub.com` (1 mock — agora deletado) tinham inscrição no Usualdance. Resto é signup sem follow-through. Não é bug, é funil de conversão.
- Erro de console **400** em `/minhas-coreografias` quando user sem inscrição abre a página. Cosmético — UI renderiza empty state OK. Suspeita: query Supabase com IN ([]) vazio.
- **5 crons agendados em prod** (`send-payment-reminders`, `expire-pending-payments`, `cleanup-orphan-tracks`, `send-trilha-reminders`, `send-incomplete-data-reminders`). 2 deles (`send-trilha-reminders` e a nova) tinham o anti-pattern JWT — agora corrigido. Os 3 antigos provavelmente já estavam OK (memória cita que `daily-release-funds` usa o pattern correto desde 2026-05-20).

### 2026-05-22 (madrugada — virou de domingo) — Bundle Sessão 4 + Opção B notificações ✅ SHIPADO
Madrugada 21→22, 13 commits + 2 migrations + 3 edge function deploys. Maior sessão registrada nessa janela. Estrutura em 4 grandes blocos:

**Bloco 1 — Bundle Sessão 4.1 painel /registrations** (`415877b` + audit `5140051`):
- **P5 comparativo edição anterior** — banner "vs edição 2025" com delta % de receita + inscrições quando produtor tem evento com `edition_year < atual` no dropdown. Mesmo princípio do `ResultsPanel.tsx:259`.
- **P8 banner alertas inteligentes** — 3 chips no topo (vencendo 24h / trilhas pendentes / fora da faixa). Click filtra a lista direto ou pula pra aba TRIAGEM. Heurística "vencendo 24h" usa `created_at` entre 48-72h (default dueDate Asaas = +3d).
- **Sort header** — click em Coreografia/Data/Valor/Pagamento alterna asc/desc. Default data desc.
- **Paginação 50 rows** — só renderiza quando passa de 50; reset auto pra página 1 quando filtros/sort mudam.
- **Audit fixes pós-shipping**: "Limpar filtros" não zerava `quickAlert`/`tipoApresentacaoFilter`/`dateFilter`; CSV exportava em ordem de banco ignorando sort visível.

**Bloco 2 — UX review sequencial baseado em screenshots do user** (commits `1f9b9e5` → `b2f9649`, 5 commits):
- **Item 1+4 (`1f9b9e5`)**: "Abrir no Asaas" → "Abrir fatura" no modal. Chip persistente "Filtrando: X (N resultados) [×]" quando quickAlert ativo — fix do bug visual em que todas as 10 inscrições do user matchavam o filtro de trilhas pendentes e nada parecia mudar.
- **Item 3 (`f59d5f0`)**: alerta "X com dados incompletos" no banner P8 + badge "DADOS PENDENTES" no header da seção Bailarinos + fundo amber em cards individuais. Helper `hasIncompleteBailarinos` detecta 3 cenários (array ausente / array vazio com modalidade declarada / qualquer bailarino sem CPF/nome/nasc).
- **Item 2 v1 (`30bb8da`)**: editor inline de bailarinos no modal — nome/CPF (`maskCpfCnpj`)/data/instagram. Botão "+ Adicionar bailarino" + "Remover" por linha.
- **Item 6 (`f2abaa8`)**: drawer único de filtros estilo Sympla/Linear. Search + botão "Filtros (N)" no canto + chips rosa dos filtros ativos abaixo (com X individual + "Limpar tudo"). Modal centralizado com 7 selects empilhados.
- **Item 2 v2 (`b2f9649`)**: revisão do editor de bailarino seguindo regra do Wizard público — Instagram per-bailarino só em Solo/Duo/Trio (`maxMembers <= 3`), 1 campo único `instagram_principal` no rodapé pra Grupo/Conjunto. Data nasc trocada de `<input type="date">` (calendário lento pra ano antigo) por input mascarado DD/MM/AAAA (`maskData` + `parseDataISO`). Save normaliza handles obsoletos quando muda modalidade.

**Bloco 3 — Bug crítico RLS produtor UPDATE em registrations** (`ded2e3e` + migration `20260525`):
Auditoria descobriu que a edit inline (modalidade/categoria/estilo/mostra desde sessão Grazieli + editor de bailarinos agora) **NUNCA funcionou pra produtor não-super-admin desde 2026-04-28**. Só existia policy `producer_reads_event_registrations` FOR SELECT + bypass de super_admin. PostgREST retornava 0 rows sem erro, modal fechava, React atualizava state, banco continuava intacto. F5 perdia tudo.
- Migration `20260525_producer_updates_registrations.sql` aplicada em prod via Dashboard: nova policy FOR UPDATE com USING + WITH CHECK = produtor é `created_by` do evento; trigger `protect_registrations_status_columns` estendido pra também reverter `user_id`, `event_id`, `created_at` (impede produtor "roubar" inscrição mudando dono ou movendo entre eventos).
- Hardening em `handleSaveEdit`: `.select('id')` no `.update()` força PostgREST a devolver as rows afetadas. Se RLS bloqueia, throw com mensagem clara em vez de bug silencioso.
- **Validado em prod**: user logado como **produtor real do Usualdance** (não super_admin) editou CPF de bailarino DESERT FIRE → persistiu após F5 ✅.
- **Benefício colateral importante**: outras 2 telas que faziam UPDATE em registrations também estavam silently broken: [pages/CheckIn.tsx:125](pages/CheckIn.tsx#L125) (check-in QR não persistia) e [pages/ResultsPanel.tsx:207-218](pages/ResultsPanel.tsx#L207-L218) (publicar resultados não publicava). Ambas agora funcionam pra produtor real. Validar em smoke quando rolar evento presencial.

**Bloco 4 — Opção B notificações multi-canal** (commits `85310ea`, `681d275`, `0437548`):
- **B5 PWA install tracking** (`85310ea`): plugou `trackEvent` no `usePWAInstall` hook. 5 eventos custom em GA4 + Meta Pixel paralelo via `fbq('trackCustom', ...)`: `pwa_install_available`, `pwa_install_prompt_shown`, `pwa_install_accepted/dismissed`, `pwa_installed`. Cada um carrega `display_mode` (browser/standalone). Try/catch defensivo — pixel bloqueado nunca quebra a feature.
- **B1 schema in-app inbox** (`681d275`): migration `20260526_notifications_inbox.sql` aplicada em prod. Tabela `notifications` (12 cols: id/user_id/event_id/type/severity/title/body/cta_url/cta_label/metadata JSONB/read_at/created_at). RLS: user lê e atualiza próprias (trigger `protect_notifications_columns` impede mexer em tudo exceto `read_at`); super_admin bypass; INSERT/DELETE deliberadamente sem policy = só service_role e super_admin podem criar. 2 indices (partial em unread + full em created_at desc). RPC `mark_all_notifications_read()` SECURITY DEFINER pra bulk update.
- **B2 NotificationBell** (`0437548`): componente novo `components/NotificationBell.tsx` plugado no Header entre toggle theme e user menu. Bell + badge rosa "1"→"9+" com contagem de não lidas. Dropdown popover (max 50 itens) com card por notif (ícone colorido por severity, título bold quando não lida, body line-clamp-2, tempo relativo "agora/há 5 min/há 2h/há 3d", CTA inline rosa). Realtime via `postgres_changes` filter `user_id=eq.${userId}` — inserts/updates aparecem sem refetch. Click marca lido optimistic + navega (URL relativa via React Router, absoluta abre nova aba). Botão "Tudo lido" usa o RPC. Empty state amigável.
- **B3 send-trilha-reminders** (`0437548`): nova edge function deployed (`supabase functions deploy ...` rodado direto). Lê `configuracoes.prazo_trilhas` (TEXT YYYY-MM-DD) de todos eventos. Classifica em 2 janelas catch-up: '15d' (13-16d) e '5d' (3-6d). Pra cada evento na janela, pega registrations APROVADO sem trilha_url + user_id NOT NULL. Idempotência via tabela `notifications`: query filter por `metadata->>'registration_id'` + `metadata->>'reminder_type'`. Sem marker em registrations precisar de migration extra. Insere notif in-app primeiro + send-email best-effort (template novo `trilha_reminder` em send-email com 2 tons — last chance quando ≤5d). Hoje em America/Sao_Paulo via `Intl.DateTimeFormat({ timeZone: 'America/Sao_Paulo' })` pra evitar off-by-one do Deno UTC.
- **Cron diário 09:00 BRT** agendado via `cron.schedule` (job_id 10). Mesmo padrão dos crons `send-payment-reminders`, `expire-pending-payments`, `cleanup-orphan-tracks` — usa `current_setting('app.settings.service_role_key', true)`.

**Smoke validado**: INSERT manual de notif `severity=warning` → badge "1" apareceu no sino do user logado **sem F5** (realtime), dropdown abriu com card amarelo, click marcou lido (bolinha some) + navegou pra `/registrations`. End-to-end OK.

**Decisões locked pra próxima sessão**:
- Email "trilha faltando" usa `configuracoes.prazo_trilhas` (não data do evento). ✅ Já implementado em B3.
- In-app inbox aprovado. ✅ B1+B2.
- PWA install tracking conecta nos analytics existentes (GA4 master + Meta Pixel master) — sem novo provider. ✅ B5.
- **B4 Push Web defer** — ~4h de esforço pra cobertura 15-30% (taxa típica de aceitar permissão). Faz sentido só depois do inbox virar baseline + algum produtor demandar.

**Achados de auditoria pendentes** (não bloqueiam, anotados):
- `audience_tickets`, `workshop_registrations`, `video_selections`, `aggregate_payments`, `coupons` — mesmo padrão "produtor só SELECT" pode estar silently broken. Auditoria sistemática ~2h numa sessão futura.
- Performance: `send-trilha-reminders` faz 1 query de count por registration (otimizar pra bulk `IN`). `notifications.metadata` sem GIN index (criar quando crescer).
- Cosméticos: `formatRelative` no Bell não atualiza com tempo passando (notif fica "agora" indefinidamente); limit 50 sem paginação no dropdown.

### 2026-05-21 (tarde) — Bundle P1-4 (residuais destravados) ✅ SHIPADO
Commit `9463e66`. 4 itens da fila "destravados pra próxima sessão" — autorizados em bloco pelo user:
- **Checkout.tsx** — UPDATE direto pra `'APROVADO'` (remove duplo CONFIRMADO→APROVADO legacy do cupom 100%). 1 query a menos por checkout gratuito.
- **Schedule drag fade** — `animate-pulse` → keyframe `dropIn` (fade 0→1 + translateY -4px→0 em 240ms) declarado em `index.css`. Mascara o "pop" visual do dnd-kit quando linha cruza SortableContext. Solução A (CSS-only) — não precisou refatorar pra B (delay setState) nem C (mover update pro onDragOver).
- **Wizard rascunho localStorage** — `coreohub:wizard:<eventId>`, TTL 24h, debounce 300ms. Helpers `readWizardDraft/writeWizardDraft/clearWizardDraft` em `pages/InscricaoWizard.tsx`. Hidrata após `setEvent(ev)` (sobrescreve defaults de `coreografo_nome`/`bailarinos`). Limpa logo após registration commitada — cobre 4 caminhos de saída (demo bypass / Asaas redirect / minha-seletiva / minhas-coreografias).
- **Email "Repasse liberado"** — novo template `payout_released` em `send-email/index.ts` (cifrão 36px verde + PIX mascarado `•••• XXXX` + count de comissões + CTA pro /qg-organizador). Disparado em `daily-release-funds` após cada `result.swept`, best-effort (falha não reverte). Idempotência natural via `released_at` IS NULL filtro da query — cron rodando 2x no mesmo dia não duplica email.

Edge functions deployadas via CLI: `send-email` + `daily-release-funds`.

**Smoke E2E executado 2026-05-21 (noite):** 2 PIX taxa de seletiva R$ 33 cada pagos pela conta Cultural Estúdio → 2 platform_commissions criadas (R$ 30 net cada) → forçado `release_at = NOW() - 1h` na TESTE 2 → invocado cron via curl → sweep transferiu R$ 30 pro PIX do Hemer + chamou send-email (`released_at` + `release_transfer_id` preenchidos) ✅. Refund via painel também coberto: TESTE 1 reprovada em /seletiva-video → `process-video-refund` aplicou `partial_refund 50%` = R$ 16,50 (policy default do evento Usualdance). Email `payout_released` foi enviado pra `festival@usualdance.com` (email do profile do Hemer) — não conferido visualmente porque user não tem acesso ao webmail desse domínio. Funcionalmente OK.

**Bug pré-existente descoberto + corrigido**: faltava policy RLS `producer_reads_own_commissions` em `platform_commissions`. ProducerBalanceCard ficava com R$ 0 pra qualquer produtor não-super-admin (só policy de super_admin existia desde 20260428). Policy aplicada em prod via SQL Editor (versionar a migration ainda pendente — user pediu pra deixar pra depois).

**Cuidado operacional 2026-05-21:** durante o smoke, a `SUPABASE_SERVICE_ROLE_KEY` vazou no transcript por erro do bash (`source .env` quando faltava `=` no arquivo, linha virou comando, chave foi printada no stderr). User vai rotacionar quando puder. Lição em [[feedback-secret-vazou-source-env]] — usar `awk -F=` no lugar de `source` pra extrair secret de .env.

### 2026-05-21 (noite) — Fixes pós-smoke + saldo Asaas em tempo real
Continuação do smoke. 5 commits:

- **`51c3046` fix(refund) — reflete estorno em platform_commissions + saldo bate com Asaas** — bug descoberto no smoke (TESTE 1 estornada R$ 16,50 mas `platform_commissions` ficava intacta, ProducerBalanceCard mostrava R$ 30 fantasma). Fix em 3 arquivos: `asaas-webhook` ganha branch genérico após `statusInterno` mapping que detecta `PAYMENT_REFUNDED`/`PAYMENT_PARTIALLY_REFUNDED`/`ESTORNADO`, busca total via `GET /payments/{id}/refunds` e marca `refund_amount` + `refunded_at` (refunded_at só em refund 100% — parcial deixa NULL pra comissão seguir válida pela diferença). `daily-release-funds` filtra `refunded_at IS NULL` e subtrai `refund_amount` do `net_amount` sweepável. `ProducerBalanceCard` espelha a mesma lógica. Bonus: ícone gigante cinza claro de fundo dos MetricCards do ProducerDashboard removido. Detalhes em [[bug-refund-nao-atualiza-platform-commissions]].

- **`67f2853` chore(migrations) — versiona policy `producer_reads_own_commissions`** — RLS aplicada em prod durante o smoke, agora versionada em `supabase/migrations/20260524_producer_reads_own_commissions.sql` pra não perder em `db reset`.

- **`b242ded` feat(saldo) — botão 'Conferir saldo Asaas'** — nova edge function `get-producer-asaas-balance` (JWT do produtor, lê `asaas_api_key` do profile, chama `GET /finance/balance` da Asaas). UI no card mostra divergência em âmbar quando |asaas − coreohub| > 0,01. Padrão Stripe Connect/Mercado Pago: carteira local + reconciliação sob demanda.

- **`0f147c8` refactor(saldo) — unifica refresh + Asaas em 1 botão + fix manual-transfer-now** — produtor achou redundante ter 2 botões. Refresh manual agora consulta saldo Asaas em paralelo (mount inicial + realtime continuam só local pra não martelar API). E corrigi um bug encontrado na auditoria pós-fix do refund: `manual-transfer-now` tinha o mesmo problema que `daily-release-funds` tinha antes (não filtrava `refunded_at` nem descontava `refund_amount`) — botão "Transferir agora" tentaria sacar comissão já estornada e Asaas rejeitaria.

- **`ff1b6d2` fix(auth) — produtor cai no /qg-organizador após login** — antes todo user ia pro `/dashboard` (tela do inscrito). Produtor via tela vazia "Sem inscrições" antes de achar o painel no sidebar. Auth.tsx agora lê `profiles.role` pós-SIGNED_IN: `ORGANIZER` → `/qg-organizador`, demais → `/dashboard`. Lookup fora do callback de `onAuthStateChange` (dentro de `setTimeout`) pra não deadlockar o lock interno do auth-js (issue supabase/auth-js#762).

**Validação retroativa:** corrigi a comissão da TESTE 1 (`de563afd-...`) com `PATCH /rest/v1/platform_commissions` setando `refund_amount=16.50`. Card desceu de R$ 30 → R$ 13,50 = bate com a realidade (net 30 − refund 16,50). Asaas mostra subconta R$ 0 (já foi sacado o R$ 30 da TESTE 2 + Asaas reteve o R$ 13,50 da TESTE 1 em pasta "a liberar" que não aparece na view "Saldo" padrão).

**Auditoria pós-fixes:** revisei os 5 commits. Achei o bug do `manual-transfer-now` (já fixado em `0f147c8`). Resto OK. Único finding cosmético sobrando: `pages/ProducerDashboard.tsx:197` faz query de `platform_commissions` sem filtrar refunds — usado pra gráficos históricos, não bloqueia faturamento total (que vem de `registrations.valor_pago`). Anotado pra polir depois.

### 2026-05-21 — Bundle P1 pós-auditoria + bugs P0 reportados
Detalhes em [[bundle-p1-pos-auditoria-2026-05-21]]. 7 commits, todos em prod:

- **Schedule cronograma — 3 bugs críticos**
  - Drag entre blocos persiste imediato no DB (handleAssignBloco + handleDragEnd). Toast verde "Movida pra Bloco X" + highlight pulsante 2s. Sem isso produtor movia, fechava sem clicar "Salvar Ordem", perdia.
  - Filtro `is_demo` no picker do Schedule: em demo só mostra demos, em real só reais. Não mistura.
  - Campo de busca no header destaca rows com ring âmbar (não filtra, só sinaliza).
- **EventPickerSheet — badge DEMO + fix mobile**
  - Badge âmbar "DEMO" no trigger + bottom-sheet mobile + dropdown desktop quando `ev.is_demo`.
  - Fix BottomNav cobrindo bottom-sheet: `z-[60]` + `bottom-16` + backdrop `z-[55]`. Lista inteira agora visível acima do nav.
- **ProducerBalanceCard — refresh + realtime**
  - Botão refresh manual no header do card.
  - Realtime subscription em `platform_commissions` (filter `producer_id`). Cron `daily-release-funds` libera silenciosamente — card recarrega sozinho via `postgres_changes`.
- **AccountSettings KYC — botão "Verificar agora"**
  - Edge function `check-producer-kyc` estendida pra PERSISTIR `asaas_kyc_status` + `asaas_onboarding_url` no profile (antes só lia).
  - `refreshKycStatus` re-lê o profile após invoke. Banner amarelo some sozinho quando Asaas aprovar — sem produtor recarregar a tela inteira.
- **Header switch VISÃO — redirect**
  - Trocar role no dropdown redireciona pra `/`. Antes super admin trocando pra "Inscrito" ficava em rota órfã (/registrations é só produtor → tela vazia).
- **Cupom no checkout da Seletiva**
  - `create-video-selection-payment` aceita `coupon_code` (texto) além do `coupon_id` (UUID). Lookup ILIKE em coupons.
  - MinhasCoreografias ganha UI inline "Tem cupom?" abaixo de cada row de seletiva com taxa pendente.
  - Workshop já tinha cupom completo (CheckoutWorkshop.tsx verificado).
- **Validação playlist YouTube**
  - URL de vídeo seletiva rejeita playlists. Regex `[?&]list=` ou `youtube.com/playlist`. Padrão de mercado (Joinville, Catanduva, SESI): jurado precisa de 1 vídeo único.
  - Aplicado em 2 pontos: validateStep do Wizard + handleSaveVideoLink em /minhas-coreografias.
- **Demo bypass Asaas — corrigido em 2 commits**
  - Wizard pula Asaas e marca `video_fee_status='waived'` se `event.is_demo === true`. Modo demo agora é gratuito end-to-end.
  - Pegadinha: `event.is_demo` era `undefined` porque o SELECT na linha 421 do InscricaoWizard não incluía `is_demo`. Adicionado.
- **Instagram input lowercase**
  - 2 inputs do Wizard (bailarino solo/duo/trio + grupo/coreógrafo) forçam `.toLowerCase()` no onChange. Evita duplicatas (@USUARIO vs @usuario tratados como bailarinos diferentes).
- **Z-index sweep preemptivo**
  - 3 modais bumpados de `z-50` → `z-[60]` antes de aparecer bug: Schedule.tsx:1657 (bloco picker), VendasIngressos.tsx:521 (drawer comprador), WorkshopsManagement.tsx (3 modais).
- **EventPickerSheet em mais telas**: Coupons, Credenciais, VideoSelection (`<select>` nativo Android era horrível).

### 2026-05-20 (madrugada) — Bundle P1 (7 polimentos)
Commit `5077112`. Sequência rápida de melhorias pós-D+7:
- **#40 Exceções de validação agrupadas** — modal de subgênero em AccountSettings ganha header explícito "Exceções de validação (opcional)" agrupando Categoria Livre + Trilha de Repertório.
- **Sweep `status_pagamento`** — novo `utils/registrationStatus.ts` com helper `isRegistrationPaid()`. Aplicado em `CheckIn.tsx` (3 lugares) que ainda usava só `'CONFIRMADO'` (bloqueava check-in de quem pagou via fluxo novo `APROVADO`).
- **Guia "Esconder por 14 dias"** — botão "Esconder" no header do guia incompleto. Volta a aparecer em 14d se ainda incompleto, ou some permanente se chegou em 100% (padrão Stripe/Linear/Slack).
- **#35 Polimento selo Asaas no login** — variante `mono` (oficial Asaas) + 100×30 (proporção 3.3:1 preservada) + microcopy "Pagamentos via". 100% dentro do Playbook BaaS.
- **#36 Auditoria selo Asaas** — verificação confirmou que está OK em todos os lugares. ProducerDashboard já removido em 2026-05-13. VendasIngressos mantém (listagem de cobrança = obrigatório). Template base de email já carrega selo.
- **#42 KYC banner "Complete sua verificação"** — migration `20260523` (`profiles.asaas_onboarding_url` + `asaas_kyc_status` + `asaas_kyc_checked_at`). `create-asaas-subconta` consulta `GET /myAccount/documents` após criar subconta e captura `onboardingUrl` + status. Banner amarelo em `/account-settings → Pagamentos` quando `kyc_status != 'APPROVED'` (NOT_SENT/PENDING/REJECTED distinguidos). CTA "Completar agora" abre `onboardingUrl` em nova aba.
- **EventPickerSheet custom** — novo `components/EventPickerSheet.tsx` substitui `<select>` nativo do Android (que vira bottom sheet ruim sem controle). Bottom sheet em mobile (handle visual + backdrop blur + Esc fecha) + dropdown ancorado em desktop. Search automática quando ≥6 eventos (Baymard Institute). Aplicado em `Registrations.tsx` e `ProducerDashboard.tsx`.

### 2026-05-20 (noite) — Bundle de bug fixes pós-smoke
Commit `25261dc`. 5 bugs reportados pelo user durante exploração do painel:
- **Filtros Inscrições mobile** — `MOSTRA` agora ao lado de `ESTILO` (par lógico "estilo+mostra"). `INSCRITO` move pro final em col-span-2.
- **Cupom — campo %** aceitava valores >100 (print mostrou `06494949494`). Clamp 0-100 no `onChange` quando `type=percent`.
- **Cupom — botão Salvar** ficava escondido atrás do teclado mobile. Troca `max-h-[92vh]` por `max-h-[92dvh]` (dynamic viewport).
- **Cupom — scope** expandido pra 6 opções via dropdown (Inscrição/Plateia/Workshop/Seletiva/Insc+Plat/Todos). Banco/RPCs já suportavam desde 2026-05-19/20, só faltava UI. `couponService.createCoupon` type estendido.
- **Sidebar mobile** — primeiro item (Painel) ficava escondido atrás do Header sticky `h-16`. Nav ganhou `pt-20` mobile.
- **Receita Usualdance zerada** (R$ 0 + 0 inscrições no dashboard) — bug do enum `status_pagamento`: `ProducerDashboard` filtrava `=== 'CONFIRMADO'` mas o valor real é `'APROVADO'`. `'CONFIRMADO'` é legacy. Fixado em 3 lugares: `ProducerDashboard.tsx`, `StageMarker.tsx`, `ProducerAlerts.tsx`. Lição: sempre usar helper `isPago(s) = s === 'APROVADO' || s === 'CONFIRMADO'` ao filtrar.

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

**✅ Bundle P1-4 SHIPADO em 2026-05-21 (tarde)** (commit `9463e66`) — 4 residuais destravados: Checkout `APROVADO` direto, Schedule drag fade (`dropIn` keyframe), Wizard rascunho localStorage TTL 24h, Email `payout_released` no cron `daily-release-funds`.

**✅ Bundle P1 pós-auditoria SHIPADO em 2026-05-21** (`061738c` → `bbb43a6`, 7 commits): Schedule drag cross-bloco + filtro demo + busca, Badge DEMO no picker, refresh Saldo + realtime, Verificar KYC agora, VISÃO redirect, cupom seletiva, validação playlist YouTube, Instagram lowercase, demo bypass Asaas. Detalhes em [[bundle-p1-pos-auditoria-2026-05-21]].

**✅ Bundle P1 SHIPADO em 2026-05-20** (commit `5077112`) — 7 itens: #40 Exceções validação, Sweep status_pagamento + helper, Guia "Esconder 14d", #35 Selo Asaas mono, #36 Auditoria selo, #42 KYC banner, EventPickerSheet custom.

**✅ Bundle Sessão 4 + Opção B SHIPADO em 2026-05-22 (madrugada)** — 13 commits cobrindo Sessão 4.1 (P5+P8+sort+paginação) + UX review 5 commits (rename/chip/dados incompletos/editor bailarinos/drawer filtros) + fix crítico RLS UPDATE + B1/B2/B3/B5 do roadmap notificações. Detalhes em [[bundle-sessao-4-2-opcao-b-shipado]].

**⚠️ Sessão A SHIPADA + DESABILITADA mesma noite 2026-05-22** — 6 commits (b6e4444→0c9af1a) + reverter `4602573`. Bug grosso: helper lia bailarinos_detalhes (id+nome+instagram) procurando CPF/data_nascimento que ficam em `elenco`. Feature "dados pendentes" desligada em prod. Detalhes em [[sessao-a-grazieli-shipado]].

### ✅ Bundle fluxo pagamento + refund polido SHIPADO 2026-05-25

6 itens descobertos durante smoke D+7 cenário 3:

1. **Callback Asaas (`successUrl` + `autoRedirect`)** — 5 edge functions de create-payment passam callback pra `/pagamento-sucesso`. Inscrito não fica preso na tela da fatura Asaas após pagar.
2. **refund-asaas-payment**: atualiza `status='CANCELADA'` junto com `status_pagamento='ESTORNADO'` (antes `status` ficava em AGUARDANDO_PAGAMENTO gerando incoerência) + dispara 2 emails best-effort.
3. **Templates `refund_confirmed_registrant` + `refund_confirmed_producer`** em send-email — inscrito recebe valor estornado + prazo, produtor recebe valor + comissão estornada + nota sobre mecanismo BaaS (master absorve gap, sem PIX manual).
4. **Guard refund duplicado** em `Registrations.tsx:handleOpenRefund` — alert se `status_pagamento === 'ESTORNADO'` ou `refunded_at` presente. Resolve bug `40000000000000` no input quando state local stale renderizou botão indevido.
5. **Copy "Antecipação sob risco" reescrita** em ProducerBalanceCard — alinhada com Stripe/MP (sem warning amber, foco em "imediata + sem taxa"). Remove menção falsa de "precisará repor via PIX" (Asaas BaaS master absorve automaticamente).
6. **Termo do Produtor v1.2 → v1.3** — 6.3 reescrito (antecipação não é "sob risco", master absorve gap) + 7-bis novo (refunds obrigatoriamente pelo painel, refund out-of-band não dispensa comissão).

7 edge functions redeployadas. Build OK. Smoke Playwright 6/6 OK. Detalhes em [[bundle-fluxo-pagamento-refund-polido]].

### ✅ Fix CPF (coluna canônica + modal contextual) SHIPADO 2026-05-25

Commit `8357e1d`. Resolve bug histórico desde 2026-04-24 (~1 mês em prod).

**Causa**: `Profile.tsx` escrevia/lia da coluna legada `document` enquanto **todo o sistema** (4 edge functions de pagamento + Checkout + Wizard + MinhasCoreografias + AccountSettings) usa `cpf_cnpj` (canônica desde a integração Asaas). Inscrito completava perfil, banner "CPF NECESSÁRIO PRA PAGAR" nunca sumia, fluxo travado. User passou vergonha frente a cliente real.

**Fix em 3 camadas**:
1. **Schema** — `Profile.tsx` dual-write em `cpf_cnpj` + `document` (leitura prefere canônica, fallback legada)
2. **UX modal contextual** — Banner em `/minhas-coreografias` agora abre modal com 1 campo só (padrão Stripe/Sympla). Save inline → state local atualiza → banner some sem refetch. `requireCpf()` também abre o modal em vez de navegar. A11y completo (role=dialog, aria-modal, label, autoFocus, ESC fecha).
3. **`?return=<path>`** — Profile aceita deep link com whitelist de paths internos. Após save, navega de volta automaticamente. Aplicável a qualquer fluxo futuro.

**Backfill SQL** aplicado em prod (idempotente): `UPDATE profiles SET cpf_cnpj = document WHERE cpf_cnpj IS NULL AND document IS NOT NULL`.

Smoke E2E validado: CPF `340.014.208-56` salvo via modal → SQL confirma `cpf_cnpj = '34001420856'` + `document = '34001420856'` → F5 → banner sumiu → fluxo destravado.

Detalhes em [[fix-cpf-modal-contextual-2026-05-25]].

### ✅ Funil de leads + reengajamento SHIPADO 2026-05-24

Commit `59c5eb8`. Resolve [[plano-leads-reengajamento]] aprovado em 2026-05-22.

1. **Migration** `20260609_profiles_entry_event_id.sql` — coluna `entry_event_id UUID REFERENCES events(id)` + índice partial. Aplicada em prod.
2. **Captura no signup** — `Auth.tsx` ao resolver `eventContext` do redirectTo, grava `event.id` em localStorage. No callback `SIGNED_IN`, se user é "primeira sessão" (created_at < 10min) E profile.entry_event_id IS NULL, faz UPDATE. Idempotente, não sobrescreve em re-logins.
3. **Template `lead_reengagement`** no send-email — branded CoreoHub com cover + badge urgência âmbar (<= 3 dias) + CTA "Inscrever agora". Subject `[Nome] Faltam X dias pra fechar inscrição`.
4. **Edge function `send-lead-reengagement-emails`** — cron candidate filtrando por email confirmado + age >= 7d + zero registrations + zero notif anterior `lead_reengagement` (single-shot via tabela notifications). JWT role check (lição [[feedback-jwt-role-check]]). Deployed.
5. **Card "Funil de Conversão"** no ProducerDashboard — 3 números por evento (Leads/Iniciadas/Pagas) + 2 taxas. Sem expor emails (LGPD). Aparece só quando há dados.

Migration aplicada, backfill rodado e cron agendado. Funil 100% operacional.

### ✅ Bundle 6 polimentos solo SHIPADO 2026-05-23

Commits `f7d605c` + `81d2d0f`. Sessão curta (~2h), zero SQL no Dashboard pedido ao user:

1. **400 em /minhas-coreografias** — embed `workshops(...)` trocado por 2 queries (`workshop_registrations` + `.in()` dos workshop_ids). Espelha padrão `registrations → events` na mesma página.
2. **ProducerDashboard refund_amount** — filtro `.is('refunded_at', null)` + subtrai `refund_amount` em `monthlyRevenue`. Receita histórica não infla mais com comissões estornadas.
3. **NotificationBell formatRelative tick** — `setInterval(setMinuteTick, 60_000)` força re-render. Notif não fica "agora" indefinidamente.
4. **Migration 20260608 — índices em notifications.metadata** — 2 btree expression (`->>'reminder_type'`, `->>'registration_id'`) + 1 GIN default. Aplicada em prod 2026-05-25 (commit `6cbc038`). Lição: `->>` NÃO usa GIN com `jsonb_path_ops` nem `jsonb_ops`.
5. **send-trilha-reminders bulk** — `.in('user_id', regUserIds)` por evento em vez de 2 queries por registration. Evento com 200 inscritos: 400 round-trips → 2. Deployed via CLI.

Detalhes em [[bundle-polimentos-solo-2026-05-23]].

### ⚠️ Anteriormente TOP 1 — Refator com `elenco` JOIN (~5h) ✅ SHIPADO em 2026-05-22 (noite)

Plano completo em [[plano-refactor-elenco-dados-pendentes]]:
- Migration RLS pro produtor ler `elenco` dos users das inscrições do evento dele
- Refator helper `hasIncompleteBailarinos` em 3 lugares pra fazer JOIN com elenco
- Hidratar `elencoById` no fetchData de Registrations.tsx + Dashboard.tsx + edge function
- Refator render do modal pra mostrar CPF/data reais (não `—`)
- Refator editor inline em `BailarinosEditor.tsx` pra UPSERT em `elenco`
- Re-habilitar edge function `send-incomplete-data-reminders`
- Smoke E2E como produtor + inscrito

**Após essa sessão, todos os achados ficam corretos**: painel produtor mostra CPF real da Grazieli, editor edita o lugar certo, cron detecta inscrições REALMENTE incompletas (não falso positivo).



#### ✅ Hardening .select('id') CheckIn + ResultsPanel SHIPADO 2026-05-25

Commit `b86d524`. Cobre o beneficio colateral do fix `ded2e3e` 2026-05-22: 2 telas que faziam UPDATE em `registrations` ficaram silently broken pra produtor não-super-admin até a migration `20260525` ser aplicada — e nunca tinham hardening contra regressão futura. Agora `.select('id')` + throw se 0 rows.

- `pages/CheckIn.tsx:125` (QR scan registration) — antes modal mostrava "Check-in realizado!" mesmo com RLS bloqueando, banco ficava intacto.
- `pages/ResultsPanel.tsx:202-226` (Publicar resultados) — hardening na primeira iteração do loop, aborta cedo se bloqueado em vez de marchar pelo loop inteiro.

Smoke Playwright 4/4 OK. Validação E2E de mutation real (smoke manual ~30min) ainda pendente do user — opcional, comportamento já validado em `/registrations` no smoke 2026-05-21.

### ✅ Auditoria RLS protect triggers SHIPADA 2026-05-25

3 migrations + hardening. Diagnóstico revelou que 4 das 5 tabelas JÁ tinham policy UPDATE pro produtor — o gap real era FALTA de trigger de proteção de colunas sensíveis. Produtor podia editar `preco_pago`/`payment_id`/`refund_amount` em audience_tickets/workshop_registrations + `used_count` em coupons direto via UPDATE.

- `20260610_protect_audience_tickets_columns.sql` — bloqueia financeiro, refund, snapshot do tipo; permite check-in + nome/telefone.
- `20260611_protect_workshop_registrations_columns.sql` — mesmo padrão; permite `attended` + correção de nome.
- `20260612_protect_coupons_columns.sql` — bloqueia `used_count` (só webhook); permite código/valor/limite/status/escopo.
- Hardening `.select('id')` em CheckIn.tsx (2 UPDATEs) + WorkshopsManagement.tsx (toggleAttended) — throw se 0 rows.

Smoke Playwright 6/6 OK (errors=0, overflow=false). Migrations aplicadas em prod 2026-05-25. Detalhes em [[auditoria-rls-protect-triggers-shipado]].

### ✅ Sessão 4.2 painel /registrations COMPLETA SHIPADA 2026-05-26

Item P2 mais aguardado do backlog. 7 commits totais entregando 3 features grandes + 4 correções de revisão + 1 fix arquitetural de stacking context.

| Hash | Tema |
|---|---|
| `31f17fb` | **PR1 — Análise Financeira** colapsável (Top 5 estúdios + Modalidade % + Receita por categoria + Cupons aplicados) |
| `30cc858` | **PR2 — Drill-down side panel** (slide-in desktop + nav prev/next `←` `→` + indicador `X/Y` + Esc fecha) |
| `74437fc` | **PR3 — Bulk actions** (checkboxes + action bar flutuante: Exportar CSV/Copiar e-mails/Copiar WhatsApps) |
| `12e4035` | Fix revisão: Instagram→MessageCircle icon + role=dialog + z-[60] |
| `203c560` | Refactor header em 2 linhas (toolbar fixa garantindo EDITAR + X sempre visíveis) |
| `ac5ae4f` | **Fix crítico**: `createPortal` pra escapar stacking context de `<main relative z-10>` do PrivateLayout |
| `52f07de` | Remove `AnimatePresence` ao redor do portal (incompatível com Framer Motion) |

**Lição arquitetural registrada em [[licao-createPortal-stacking-context]]**: modais/side panels em páginas dentro do PrivateLayout SEMPRE precisam de `createPortal(panel, document.body)`. z-index direto não basta — fica preso no stacking context do `<main z-10>`.

Detalhes em [[bundle-sessao-4-2-completa-shipado]].

### ✅ Refactor cupom: só em PAGAR TUDO (aggregate) SHIPADO 2026-05-26

Decisão de produto baseada em pesquisa de mercado universal (Stripe/Sympla/iFood/Hotmart/Eventbrite — todos cupom único por sessão de checkout). Resolve exploit identificado: cupom valor fixo + `max_uses_per_user > 1` permitia inscrito ganhar desconto MAIOR usando "PAGAR SÓ ESTA" em cada inscrição individualmente.

Commits:
- `5ec7f41` — Frontend: cupom UI volta pra dentro do card PAGAR TUDO. `handlePagarSingle` deixa de enviar `coupon_code`.
- `b6b4f2a` — Copy alinhado (header "CUPOM DE DESCONTO", padrão Sympla/Hotmart/Magalu).
- `8af3eaa` — Backend defesa em profundidade: `create-payment-asaas` bloqueia request com cupom se user tem múltiplas pendentes no evento. Preserva caso Checkout.tsx (pós-wizard com 1 inscrição).

Detalhes em [[decisao-cupom-so-pagar-tudo]].

### ✅ Auth.tsx copy alinhada mercado BR SHIPADO 2026-05-26

Commit `95b4843` (feito pelo user durante a sessão). Pesquisa de mercado: BR SaaS usa "Acesse sua conta" / "Entrar" / "Cadastre-se" como padrão (Sympla/iFood/Nubank/Hotmart/Spotify).

- "BEM-VINDO DE VOLTA" → "ACESSE SUA CONTA" (mais neutro pra primeira vez)
- Subtítulo: "Entre com seu e-mail e senha" (instrução)
- Botão "ENTRAR NO PALCO" → "ENTRAR" (padrão BR)
- "Não tem conta? Criar Nova Conta" → "Cadastre-se" (sem redundância)

### ✅ Bundle refund partial com splitRefunds SHIPADO 2026-05-25/26

Continuação do bundle fluxo pagamento+refund. Logs do Supabase Edge Function revelaram a causa exata do erro "Valor da cobrança insuficiente" no refund de BREAK NÃO PARA:

```json
{ "errors": [{ "code": "invalid_action",
  "description": "Valor da cobrança insuficiente para o estorno solicitado." }] }
```

Asaas API: em partial refund de payment com split, **sem `splitRefunds` Asaas tenta deduzir o valor INTEIRO do main charge (master, que só tem comissão)**. Doc oficial: "When both value and splitRefunds are informed, total refund equals value, with part coming from splits and remaining balance deducted from main charge."

Commit `a9036d5` — `refund-asaas-payment` calcula `producerShareRatio = net/gross` e envia `splitRefunds: [{ walletId, value: producerRefundShare }]`.

Commit `49b1d33` — fallback robusto:
1. Query `platform_commissions` por `registration_id` (não `asaas_payment_id`) pra evitar ambiguidade em AGG flow com N rows.
2. Try-and-fallback: se Asaas devolver erro com "split" na descrição, retry sem `splitRefunds`. Asaas deduz tudo do main charge (pode falhar com "insuficiente" se valor parcial > master charge).

**Workaround conhecido**: **full refund (sem `value` no body)** funciona sempre — Asaas distribui proporcional automaticamente. Validado em prod 2026-05-26: refund de NOVINHO R$ 50 via painel CoreoHub passou; Mercado Pago confirmou crédito de R$ 40 pra Cultural Estúdio; Asaas marcou cobrança como estornada; CoreoHub painel atualizou `status='CANCELADA'` + `status_pagamento='ESTORNADO'`.

**Pendência**: fix permanente partial refund precisa buscar `walletId` direto do payment Asaas via `GET /payments/{id}` (em vez de usar `profiles.asaas_wallet_id` que pode divergir do walletId original do split). ~30min — defer pra quando produtor demandar partial refund frequente.

## 🟨 P2 — Alto valor, esforço maior
- **B4 Push Web (notificações)** — ~4h. Cobertura 15-30% (taxa típica de aceitar permissão). Faz sentido só depois do inbox virar baseline + algum produtor demandar. VAPID keys + permission UX + send-push edge function. Service Worker já existe via workbox.
- **Phase 6 — Mesa de Som offline-first** (`#37`) — botão "Baixar pacote do evento" pré-cacheia trilhas + narrações no Cache API. Outbox de live_status. ~1-2 sprints.
- ✅ **A19 Parte A — Testes automatizados SHIPADO 2026-05-30** (commit `2f5181a`): Vitest + 81 testes de lógica pura + GitHub Actions CI. Detalhes em [[backlog-testes-automatizados-a19]]. **Parte B (integração Asaas sandbox)** segue deferida — precisa credencial sandbox + secret no GitHub; trigger: ~5 produtores ativos OU primeira regressão cara de integração.
- **Fix permanente partial refund (`GET /payments/{id}` pra walletId real)** — ~30min. Defer até produtor demandar partial refund frequente. Workaround atual: full refund (deixa campo vazio no modal) funciona sempre.
- ✅ **Carrinho de ingressos multi-tipo na vitrine — SHIPADO 2026-05-30** (commits `0b726c7` + `aab5ddd`, migration `20260619` aplicada). Ver "Features chave" + Histórico recente acima e [[carrinho-ingressos-multi-tipo-shipado]]. Pendente só smoke E2E ponta-a-ponta (sem evento INTERNO com venda ativa em prod pra testar com PIX real).
- **Cupom com produtos específicos (Stripe-style)** — defer 2026-05-28. Hoje cupom aplica em "setor" (Inscrição/Plateia/Workshop/Seletiva). Granularidade fina seria 4 colunas opcionais em `coupons`: `applies_to_formations TEXT[]` (Solo/Duo), `applies_to_categories TEXT[]` (Junior/Adulto), `applies_to_workshops UUID[]` (FK), `applies_to_ticket_types TEXT[]` (Meia/Inteira). Vazio = aplica em qualquer. Padrão Stripe/Sympla/Hotmart, mas overkill pra v1 — produtores hoje criam cupons que aplicam no setor inteiro. ~3h. Trigger: produtor pedir granularidade ("quero cupom só pra Solo, não pra Grupo").
- **Modelo comercial pra evento privado 100% grátis** — gap identificado 2026-05-28. Hoje produtor pode criar evento Privado com taxa R$ 0 + workshops grátis + ingressos grátis → usa toda a infra da CoreoHub (IA regulamento, narração ElevenLabs, Júri Terminal offline, certificados) sem gerar receita. Decisão pendente entre 4 modelos de mercado: A) Sympla-style (subsidia, aposta no funil), B) Setup fee por evento grátis (~R$ 297-997, **recomendado**: alinha com Bizzabo/Cvent, implementação pequena via Asaas single payment + `events.setup_fee_paid_at`), C) Subscription mensal opcional (estilo CompetitionSuite), D) Freemium com feature gating. Decisão é comercial, não técnica. Esforço técnico ~3h depois da decisão. Detalhes em [[backlog-modelo-comercial-evento-gratis]].

### 🟩 P3 — Aguardando trigger externo
- **TED como payout alternativo** — plano + taxas pronto, congelado até alguém pedir.
- **Vitrine na home + nome do festival na URL raiz** — GA/pixels JÁ implementados (`services/analytics.ts`, `producerAnalytics.ts`, `utmTracking.ts`, `ProducerPixels.tsx`, gtag no `index.html`). Landing existe em `/lp`. O que falta: rota `/` mostra `RootRedirect` (vai pra login/kiosk), não a vitrine; migrar `coreohub.com` → vitrine na home + nome do festival na URL raiz segue **bloqueado por decisão DNS** (Hostinger → Cloudflare). Vitrine pública já vive em `/festivais`.
- ✅ **Multi-jurado seletiva v1.1 — SHIPADO 2026-05-30** (commit `98f0b94`). Página `/jurado-seletiva` blind + config no produtor + escolha pós-PIN. Ver "Features chave" + Histórico recente acima e [[plano-multi-jurado-seletiva-v1-1]]. Pendente só E2E real do jurado (sem evento com banca configurado em prod). Regra `unanimous` testada via trigger, não via UI.

### 🪶 Cosméticos / pequenos achados de auditoria 2026-05-22
- **NotificationBell sem paginação** — limit 50 hard. Quem receber 51+ perde as mais antigas. v1 acceptable. Adicionar "ver mais" quando necessário.

Resolvidos em 2026-05-23 (`f7d605c`+`81d2d0f`+`87cc593`) + 2026-05-24 (aplicação): NotificationBell `formatRelative` re-renderiza via `setInterval` 60s; `send-trilha-reminders` agora bulk fetch (2 queries por evento); `notifications.metadata` indexes aplicadas em prod 2026-05-24 (2 btree expression + 1 GIN); contraste cyan no card Funil de Leads corrigido pro light mode (`text-cyan-700 dark:text-[#1de7f2]`).

### ⚠️ Pendência operacional
- **Service_role_key precisa ser rotacionada** — vazou no transcript durante smoke 2026-05-21 (erro do bash com `source .env` malformado). User vai rotacionar quando puder. Edge functions usam JWT decode pra auth, então rotação não quebra crons.
- **Cron `send-trilha-reminders` agendado mas sem dados** — preparado pro futuro. Dispara vazio até produtor configurar `prazo_trilhas` em `/configuracoes`.
- **NF emission** — produtor MEI Hemer não emite NF automática. Caso surgir demanda (cliente pediu), responder via WhatsApp manual. Plataforma fica como está. Decisão 2026-05-26: NÃO implementar agora.

## Não fazer

- ✅ Testes existem agora (A19 Parte A): rodar `npm test` (81 testes lógica pura) + `npm run lint` + `npm run build` antes de commit não-trivial. Integração com Asaas ainda valida manual em prod (Parte B deferida).
- ❌ Sem `--no-verify` em commits sem motivo explícito.
- ❌ Sem service role no frontend (vai vazar em bundle).
- ❌ Sem `auth.includes(serviceKey)` em edge function (usar decode + role check).
- ❌ Sem `return null` silencioso em componente novo (empty state visível).
- ❌ Sem placeholder SQL pra user substituir (`<COLA_AQUI>`) — ele cola literal. Usar `DO $$` ou extrair do próprio banco.
- ❌ Sem instruções de DevTools acrobacia quando dá pra investigar via SQL.
