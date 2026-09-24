# CoreoHub — Contexto pra Claude

Gestão inteligente pra festivais de dança (BR). SaaS multi-tenant onde produtor cadastra evento, recebe inscrições, vende ingressos, roda júri/cronograma/premiação, gera certificados, e o público compra ingresso e baixa material.

Em produção: 78 arquivos em `pages/`, 42 componentes compartilhados, 63 edge functions Supabase, 210 migrations SQL (reconferido 2026-09-19 via `git ls-files`, não `ls` — evita contar arquivo local não commitado de outra sessão em paralelo). Números corrigidos e mantidos atualizados após a auditoria de código morto de 2026-09-10 (ver Histórico recente) — a versão anterior desta linha (~71/~30/31/90+, depois 82/43/61/192) ficou defasada 2x na mesma sessão só de rodar a limpeza.

## Produto

**Slogan:** "CoreoHub — Gestão Inteligente para Festivais de Dança"
**Gênero da marca:** sempre "**a** CoreoHub" (feminino) — nunca "o CoreoHub", "do CoreoHub". Vale no copy do produto (telas, emails) e na fala do Claude com o produtor.

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

### Landing page
- **Copy reescrita com PAS (2026-07-02):** `pages/LandingPage.tsx` reescrita com framework Problema → Agitação → Solução. Hero "Seu festival inteiro rodando sozinho. Você só cuida da arte."
- **Pendente:** substituir os 3 cards de Prova Social (placeholder) por depoimentos reais de jurados e produtores. Considerar adicionar `aggregateRating` ao JSON-LD quando houver avaliações reais.
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
| `pages/` (78 arquivos flat) | Telas. Sem subpasta. Roteadas em `App.tsx` via React Router 7. |
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
- `delete-event`, `delete-registration` — exclusão com validação de zero movimento real (nunca confiam em RLS pra ownership, sempre via service role).

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
- **Nunca usar `.upsert(rows, { onConflict })` em lote quando o role só tem policy de UPDATE (não INSERT) na tabela.** Supabase monta isso como `INSERT ... ON CONFLICT DO UPDATE` — mesmo que toda linha já exista e vá só ser atualizada, o comando ainda é um INSERT por baixo, e pode falhar sob RLS pro produtor (que em `registrations`, por exemplo, só tem UPDATE desde 2026-05-22, não INSERT). Preferir `UPDATE` direto por linha (`Promise.all` se for lote). Bug real: "Salvar Ordem"/"Publicar" do Cronograma sempre falhando (2026-07-08).
- **`select()` amplo sem checar `error` mascara coluna ausente como "não encontrado".** Se qualquer coluna do select não existir no schema (migration commitada mas nunca colada no SQL Editor), Supabase retorna erro PGRST204 e `data` vem `null` — indistinguível de "row realmente não existe". Sempre destruturar e logar `error` também, mesmo mantendo o mesmo fallback de UX pro usuário final. Bug real: vitrine pública + Configurações→Identidade quebradas ao mesmo tempo por `documentos_extras`/`destaque_link_*` nunca migrados (2026-07-08).

## Convenções de edge function

- **Gate de service-role**: NÃO usar `auth.includes(envKey)`. Decode JWT + check `role === 'service_role'`. Veja `daily-release-funds/index.ts` linha ~52. Lição [feedback-jwt-role-check].
- **Env vars auto-injetadas:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`. Padrão: `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''`.
- **Asaas:** `ASAAS_API_KEY`, `ASAAS_BASE_URL` (prod: `https://www.asaas.com/api/v3`; sandbox: `https://sandbox.asaas.com/api/v3`), `ASAAS_WEBHOOK_TOKEN`.
- **Resend:** `RESEND_API_KEY`, `EMAIL_FROM`.
- **CORS:** sempre devolver `corsHeaders` (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`).
- **Idempotência de webhook:** ler `platform_commissions.asaas_payment_id` antes de inserir; UPSERT com `onConflict: 'asaas_payment_id,registration_id', ignoreDuplicates: true` em fluxos com N rows.

## Workflow do produtor (user real do repo)

- **Ambiente de staging (desde 2026-08-11):** branch `dev` (não a `main`) é o fluxo padrão de trabalho — commitar na `dev`, nunca direto na `main`. Merge `dev` → `main` só quando o produtor pedir ou aprovar explicitamente (nunca autônomo, mesmo com a regra de "commit autônomo ao concluir etapa funcional" — essa regra vale pro commit na `dev`, não pro merge). `staging.coreohub.com` aponta (via Vercel) pra branch `dev`, atrás de SSO do time Vercel (não é público). Se um push na `dev` não gerar deploy novo em staging em alguns minutos, rodar `vercel deploy` manualmente na branch (mesmo problema de webhook silencioso já visto no Usualdance Festival).
- **🚨 Staging NÃO isola backend.** `dev`/staging usa o MESMO projeto Supabase (`ghpltzzijlvykiytwslu`) e a MESMA config Asaas de produção — sem banco/pagamento separados. Só é seguro testar layout/copy/SEO/comportamento visual na `dev`. Qualquer teste de inscrição/pagamento real (mesmo a partir de staging) grava dado real em produção — avisar o produtor antes de rodar esse tipo de teste.
- **🚨 Edge functions não têm staging.** São deployadas manualmente via CLI (`supabase functions deploy <name>`), sem relação nenhuma com a branch do frontend. Deployar uma edge function enquanto se trabalha na `dev` afeta produção na hora — não existe "edge function de dev". Tratar com o mesmo cuidado de sempre, independente de qual branch de frontend está ativa.
- **Migrations:** Claude aplica direto via `npx supabase db query --linked --file <path>` (CLI já linkado ao projeto `ghpltzzijlvykiytwslu`) quando é o autor da correção — decisão do produtor 2026-08-03, ver [[feedback-aplicar-sql-direto-via-cli]]. Sempre versionar em `supabase/migrations/` (o arquivo aplicado é a própria migration). User ainda pode colar manualmente no Dashboard quando preferir esse caminho.
- **Deploys frontend:** push em `dev` → Vercel auto-deploya `staging.coreohub.com` (~1-2 min, atrás de SSO). Push/merge em `main` → Vercel auto-deploya `app.coreohub.com` (produção real).
- **Deploys edge functions:** sempre via CLI manual (`supabase functions deploy ...`), independente de branch — ver nota acima.
- **PWA cache:** quando deploy não aparece no front, **primeira hipótese é SW cacheando JS antigo**. Solução: DevTools → Application → Service Workers → Unregister + Storage → Clear site data + nova aba. Hard refresh NÃO basta (SW intercepta).
- **Validação visual (`scripts/screenshot.mjs`)** continua mirando produção (`app.coreohub.com`) por padrão — rodar contra staging exigiria lidar com o SSO do Vercel, então só fazer isso se pedido explicitamente.

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
- **Modo Terminal (kiosk)** — `localStorage.coreohub_tablet_kiosk_mode = 'true'`. Tablet vira terminal isolado, app redireciona pra `/judge-login/<UUID>`. Auth via PIN 4 dígitos (aceita teclado físico desde 2026-06-11). **Navegação manual** (2026-06-11): menu `⋮` do `JudgeTerminal.tsx` abre painel com a fila inteira rolável (nº + coreografia + estúdio + status ✓avaliada/●atual/○pendente, toque pra ir) + botões "Anterior"/"Próximo" + atalho "pular pra #N/busca por nome" (busca por nome de coreografia/estúdio adicionada 2026-07-10, unificada no mesmo campo do número). `goToIndex`/`requestGoToIndex` centraliza o reset; guard de unsaved (modal) só dispara com avaliação não submetida. `evaluatedSet` offline-aware (`fetchPreviousEvaluationsSWR` + adição otimista no submit). Tudo state local. **Acesso do jurado unificado** (SHIPADO 2026-07-10, `JudgesManagement.tsx`): só existe "Código de acesso" (6 dígitos) — QR aponta pra `/entrar-juri?code=XXXXXX` (autosubmit ao escanear), botão "Copiar convite" gera mensagem de WhatsApp pronta com link+código. O link cru assinado `/judge-login/:token` nunca mais é exposto ao produtor, só é destino interno do redirect (padrão Kahoot: 1 link + 1 PIN, QR é só atalho).
- **Phase 5 offline-first do júri** — terminal tem IndexedDB outbox (`services/offlineStore.ts`) + drainer com backoff. Submits queue local, sync quando volta online. Idempotência via `evaluations.client_uuid` (UNIQUE INDEX parcial).
- **Demo mode** — `events.is_demo = true`. Edge function `seed-demo-event` (actions create/delete/status) popula 50 coreografias + 3 jurados + 3 staff fakes + 6 prêmios + 1 evento [DEMO] + 20 vídeos de seletiva (solo) + 3 tipos de ingresso com estoque variado (Inteira 200 / Meia 14 = badge "Últimos N" / Solidária ilimitada) + 4 cupons multi-scope (`scopes[]` + `scope` legacy em sync; CHEGAJUNTO demonstra inscription+audience). Banner amarelo sticky em todas telas internas do evento demo. Princípio: cada feature aparece em estado "interessante", não vazio (boa prática Stripe Test Mode). **Multi-jurado seletiva fica SOLO no demo** de propósito — banca ≥2 tornaria `/seletiva-video` read-only e confundiria quem explora.
- **Telão de palco** (SHIPADO 2026-07-07, Voto Popular automático SHIPADO 2026-07-10, **Premiação virou fonte única de verdade SHIPADO 2026-07-11/12**) — fonte única e passiva pra LED/projetor. Rota pública `/telao` (entrada por código estilo Kahoot) + `/telao/:code`, fullscreen, qualquer proporção (3:1/16:9/4:3). Controle em `pages/TelaoControle.tsx` (menu Operação, rota protegida por permissão `controle_telao`): gerar/regenerar código, ligar/desligar, trocar modo, testar. Display em `pages/TelaoDisplay.tsx`. RPC única `get_telao_state(p_code)` (SECURITY DEFINER, anon) resolve tudo — sem auth no LED. 2 modos trocáveis sem o computador do LED mudar nada (`events.telao_modo`): **Ao vivo** (`events.telao_ativo` + `live_registration_id`, mostra jurados esperados ✓/pendente + média final quando o último fecha nota, nunca medalha ao vivo) e **Premiação** (`events.telao_premiacao`, produtor revela item por item pela cerimônia — 4 tipos auto-detectados pelo nome/descrição do prêmio: `faixa` = medal_thresholds do evento tipo Ouro≥9/Prata≥8/Bronze≥7 festival inteiro, `maior_nota` = maior média, `premio` = vencedor por deliberation_aggregate, `manual` = produtor escolhe a coreografia na mão, ex. Voto Popular externo). Migrations `20260707_telao_palco.sql` → `20260707_telao_premiacao.sql` → `20260708_telao_premiacao_v2.sql` (v2 substituiu pódio-por-grupo da v1 por faixa de média festival-wide, mais fiel à config real de premiação) → `20260712_update_premios_winners_rpc.sql` (RPC atômica). Setup completo em `docs/telao-setup.md`. **Troféu Voto Popular (tipo `manual`) auto-preenche** desde 2026-07-10: edge `get-voto-popular-winner` chama `get-winner` no repo isolado do Voto Popular (`D:\Documentos\Voto Popular`, projeto Supabase `aghmjmqrkwuxmrctslkf`) e resolve nome/estúdio do vencedor da urna — busca manual continua como fallback (votação aberta/empate/integração falha). **Registra-primeiro-revela-depois (2026-07-11/12, pós-mortem do evento real)**: `pages/Deliberacoes.tsx` (rota `/deliberacoes`, menu Resultados → Premiação) virou a **ÚNICA tela onde se edita/registra vencedor** — Ouro/Prata/Bronze/Maior Nota calculados das médias (read-only), prêmio de pessoa/Voto Popular vira campo editável + botão "Salvar vencedores" (grava em `configuracoes.premios_especiais`, nunca revela sozinho). `TelaoControle.tsx` virou **só leitura**: revela o que já está registrado via RPC atômica `update_premios_winners` (read-modify-write num único UPDATE — fecha a corrida real de 2 abas simultâneas editando prêmios diferentes ao mesmo tempo), campo `winner_revealed` trava a vitrine pública de mostrar vencedor antes do produtor clicar revelar no Telão (vazamento real encontrado: salvar em Premiação já deixava visível na vitrine sem trava nenhuma). Classificação de tipo de prêmio (faixa/maior_nota/premio/manual) extraída pra `utils/awardClassification.ts` compartilhado entre Telão/Apuração/PDF (antes copiada à mão em 3 lugares, cada cópia podia divergir). PDF de Apuração e a aba Apuração (`ResultsPanel.tsx`) leem a MESMA fonte salva. **Telão validado ao vivo com LED físico no Usualdance Festival (11/07)**. **Pendente**: fluxo de Premiação (registra-primeiro-revela-depois) shipado logo após esse evento, no pós-mortem — ainda sem confirmação de uso numa cerimônia real desde então.
- **Avisos do produtor + ordem de apresentação** (SHIPADO 2026-07-07) — `pages/Avisos.tsx` (CRUD do produtor, menu Operação, tabela `event_announcements`, v1 sem segmentação — aviso vale pro evento inteiro) + `components/InicioAvisos.tsx`/`hooks/useInicioAvisos.ts` no Dashboard do inscrito (logo após o GuiaDeInscricao) mostrando avisos ativos + card "Ordem de apresentação" (posição relativa, não horário — cronograma ao vivo atrasa e prometer hora exata gera mais reclamação que não mostrar). Fetch único no mount, sem realtime (decisão: é só informativo). RLS nova em `cronograma_blocos` permite leitura por qualquer `authenticated` (só nome/ordem/cor) pro inscrito ver o nome do bloco da própria coreografia. `event_id` do inscrito é derivado de `coreografias[0].event_id` (fonte real), NUNCA da config legacy `id='1'` (`fetchActiveEventConfig` sem hint cai nela pra quem não é produtor e o `event_id` não bate necessariamente com o evento real do inscrito — 2 bugs de race/derivação corrigidos no mesmo dia, `a83328e` + `5bcc952`).

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

## Histórico recente

**Novas entradas de histórico vão em `docs/HISTORICO.md`, nunca aqui.** O histórico detalhado de sessões (2026-06 a 2026-09) vive em [docs/HISTORICO.md](docs/HISTORICO.md) e em `memory/`. **Não é lido automaticamente** — abrir só quando precisar do contexto de uma feature ou incidente específico (grep por nome/data). Estado atual e pendências: `memory/session_resume.md` e a seção "O que falta fazer" abaixo.

## O que falta fazer

Priorização cronológica detalhada em `memory/MEMORY.md` + cada item tem sua memória dedicada.

### 🟧 P1 — Alta prioridade, baixo esforço, destravado

**🚨 ABERTO 2026-09-24 — ingresso de plateia: 4 correções pendentes + conta/estratégia de teste ponta a ponta** (ver entrada 2026-09-23/24 do Histórico): (1) página do ingresso sem data/horário/local completo/assento (RPC `get_audience_ticket_by_token` usa `events.event_date` legado NULL); (2) erro genérico "Edge Function returned a non-2xx" no `CheckoutIngresso.tsx` (mostrar o corpo real do erro; conferir a causa real do erro que o produtor viu); (3) preview de WhatsApp/SEO/AEO/GEO das páginas de compra e do evento novo; (4) conta de teste própria (NUNCA `is_demo=true` numa conta com "Recriar demo") + sandbox Asaas por evento + eventos por sessão. **Estorno do ingresso A-1 só no painel da Asaas** (ticket foi apagado), a partir de ~2026-09-26; bug de "saldo insuficiente" do `refund-audience-ticket` segue sem chamado aberto na Asaas.

**✅ RESOLVIDO 2026-09-20 — comissão zerava sozinha ao salvar modal do SuperAdmin (bug de case-sensitivity)**: `EventCommissionModal` (`pages/SuperAdmin.tsx`) comparava `type === 'PERCENT'` (maiúsculo) contra `commission_type` do banco (sempre `"percent"` minúsculo) — qualquer save do modal sem trocar o Plano de cobrança junto zerava `commission_percent` silenciosamente. Corrigido (literais normalizados pra minúsculo nas 5 ocorrências), `commission_percent=5` restaurado na Tamoios (única afetada, confirmado por auditoria dos 8 eventos), e — achado na mesma sessão de correção — portada a mesma absorção de taxa de baixo valor que faltava no fluxo "Pagar Tudo" (`create-aggregate-payment-asaas`), que travava com erro de split da Asaas mesmo com a comissão certa. Detalhes em `memory/commission_case_bug_e_low_value_split_aggregate_shipado_2026_09_20.md`.

**🟡 Pendência — duplicação de elenco por CPF é bug de plataforma inteira, fix só previne casos NOVOS (2026-09-20)**: `InscricaoWizard.tsx` sempre criava um `elenco` novo mesmo com CPF repetido (corrigido — agora reaproveita por CPF antes de inserir), mas dezenas de contas já têm 4-5 `elenco` duplicados pro mesmo CPF na produção (achado via `GROUP BY user_id, cpf HAVING count(*)>1`). Nenhum merge retroativo foi feito — qualquer feature que dependa de "mesmo bailarino across registrations" (Pacote Progressivo pra inscrições antigas, futura reutilização de "Meu Elenco") continua fragmentada pra essas contas até alguém rodar uma limpeza confirmada caso a caso. Detalhes em `memory/pacote_progressivo_bugs_reais_shipado_2026_09_20.md`.

**🚧 EM ANDAMENTO 2026-09-19 — Plano Espetáculo: Fase 1 completa, Fase 2 (assento numerado) Stage 1-4 shipadas, refund real pendente de reteste** (spec: `docs/mostra-pricing-spec.md`; ver Histórico recente 2026-09-19 pra detalhe completo de cada commit):
- **✅ Fase 1 (Partes A+B) shipada** — self-service (`/criar-espetaculo`) + menu do produtor (Sidebar + BottomNavBar) escondendo itens de festival competitivo quando `billing_plan='espetaculo'`.
- **✅ Fase 2 Stage 1 (schema+RPC+cron) e Stage 2 (biblioteca de locais + gerador de grade, `/locais`) shipados** — validados com smoke transacional e Playwright interativo, sem tocar nenhum caminho de pagamento real.
- **✅ Fase 2 Stage 3 (checkout público escolhe assento) e Stage 4 (mini-mapa + PDV do produtor + assento no check-in) shipadas** — `/code-review` nível high achou 6 problemas, todos os 6 corrigidos (5 antes do smoke com dinheiro real, o 6º — grade de assento duplicada entre `CheckoutIngresso.tsx`/`VendasIngressos.tsx` — extraído em `hooks/useSeatMap.ts` + `components/SeatGrid.tsx` na sessão seguinte). Compra real ponta a ponta validada (R$20 é o piso mínimo de valor pro split, achado empírico).
- **🟡 Pendente — retestar refund real** do ticket `b529da11-5a89-4670-8837-ab0b25177a10` (payment `pay_j8cui5x2z02xprlq`) depois que a janela de retenção D+7 liberar (~2026-09-26) — Asaas recusou "saldo insuficiente" mesmo com saldo real disponível na subconta, hipótese não confirmada é a retenção. Se continuar falhando após a liquidação, investigar `splitRefunds` explícito (ver [[bundle_fluxo_pagamento_refund_polido]]).
- **🟡 Pendente — limpar evento/venue de teste** (`SMOKE E2E Event`/`Venue`, marcados `[DEMO]` no seletor do Usualdance) — só depois do refund estar resolvido (tem ticket pago + comissão real vinculados).
- **🟡 Pendente de validação — Stage 4 nunca clicada ao vivo na UI** (mini-mapa/PDV em `VendasIngressos.tsx`, assento no `CheckIn.tsx`) — validada no nível de servidor via `create-pdv-ticket` (`cartao_tap`, zero cobrança), mas a tela não tem seletor de evento (sempre resolve o evento real, nunca o demo), então a UI em si só foi conferida por tipagem/build. Precisa de um evento real com `seat_map_enabled` pra clicar de verdade.
- Produtor pediu fluxo de continuação por prompt (cada parte termina com um prompt pronto pra colar numa sessão nova) — não assumir que a próxima sessão tem contexto sem o prompt.

**✅ RESOLVIDO 2026-09-16 — Cobrança dos R$250 da Lorrayne**: fatura enviada diretamente pelo produtor (fora do fluxo `create-plan-fixed-fee-payment`), vencimento 2026-09-17. Confirmar quando pagar se `billing_plan_fixed_fee_paid_at` foi preenchido manualmente ou se precisa de ajuste no banco pra refletir o pagamento. Detalhes em `memory/billing_plan_sync_workshop_audience_shipado.md`.

**✅ RESOLVIDO 2026-09-16 — PWA: `autoUpdate` silencioso trocado por prompt "Nova versão disponível"**: banner + polling de update a cada 3min + failsafe de reload, 3 fixes achados testando em staging (polling, reload manual, cursor). Ver Histórico recente 2026-09-16. Detalhes em `memory/backlog_pwa_update_prompt_forcar_reload.md`.

**🟡 BACKLOG — auditoria ampla de `delete-event` pra outras tabelas órfãs (2026-09-10)**: achado real hoje — `event_styles.event_id` nunca teve FK `ON DELETE CASCADE` pra `events(id)` (diferente de `configuracoes`, que já tinha certo), então apagar um evento nunca limpava os gêneros dele. Corrigido (migration `20260910b_event_styles_cascade_delete.sql` — limpou 50+ linhas órfãs + adicionou a FK que faltava; `services/genreService.ts` também tinha um branch de fallback que reincluía qualquer gênero `created_by = userId` sem checar se o evento ainda existia, corrigido). **Não auditado**: se outras tabelas auxiliares (fora `registrations`/`configuracoes`/tickets/pagamentos, que `delete-event` já valida como bloqueio) também ficam órfãs do mesmo jeito ao apagar um evento — ex: `notifications`, `stage_timings`, `event_announcements`, `certificate_templates` (se algum dia ficar por evento), qualquer coisa com `event_id` sem FK. Vale rodar a mesma query de diagnóstico (`pg_constraint` + `confdeltype`) em todas as tabelas com coluna `event_id` numa sessão futura.

**🚨 AVISAR Hemer (Usualdance) e Bheto (Ecodança) antes de republicarem resultados (2026-08-06/07)**: fix do agrupamento de Apuração (estilo+categoria+formação+subgênero, ver Histórico recente) deixa correto o que estava errado, mas ~19 registrations do Usualdance + as do Ecodança já têm `classificacao_final` (posição numérica) calculado com o agrupamento ANTIGO. Se qualquer um dos dois clicar "Publicar Resultados" de novo, os números de posição mudam (pra melhor). Medalhas (Ouro/Prata/Bronze) não mudam — ambos são THRESHOLD. Verificado: nenhum certificado com número errado foi baixado ainda. Só precisa de um aviso, não é bloqueante.

**🟧 Pendência de validação — upgrade de faixa da taxa de evento gratuito nunca testado com pagamento real (2026-08-02)**: lógica existe e foi revisada (mesma edge function `create-setup-fee-payment` com `is_upgrade:true`, branch `SETUPUP:` no webhook), mas só a ativação inicial foi validada ponta a ponta com PIX real. Testar quando um evento gratuito real passar de 50 inscrições (ou forçar via SQL pra simular o cenário) — confirmar que a cobrança da diferença é gerada certa e o gate libera sozinho.

**🟡 Pendência de validação — `/super-admin` e `/cotacoes-terminal-juri` sem confirmação visual da coluna "Taxa Setup"/faixa nova (2026-08-02)**: ambas ficam atrás do gate de MFA (2FA), Playwright não consegue passar sem o código TOTP ao vivo do produtor. Só revisão de código, nunca vistas renderizadas de verdade. Conferir na próxima vez que alguém logar manualmente nessas telas.

**🟡 Pendência de validação (reduzida) — cron `revoke-expired-team-access` (2026-07-19, reconferido 2026-09-16)**: o prazo de teste (Usualdance +30d) já passou há mais de um mês. Chequei o banco hoje — **nenhum profile está com `team_event_id` apontando pro Usualdance atualmente**, o que bate com o cron ter revogado sozinho, mas não achei log de auditoria explícito confirmando a revogação automática (tabela `audit_log` não existe com esse nome). Indício forte de que funcionou, sem prova 100% definitiva — considerar fechado a menos que apareça reclamação de acesso indevido.

**🟡 Pendência — certificado da Mostra não usa a mesma fonte de classificação do Telão/Premiação (2026-07-18, atualizado 2026-08-06)**: certificado mostra `classificacao_final` cru (número de posição, ex. "obtendo 1") em vez da faixa Ouro/Prata/Bronze que `utils/awardClassification.ts` já centraliza pro Telão/Apuração/Premiação desde 11-12/07 — e também não lê `configuracoes.medal_labels` (nome de faixa configurável, shipado 2026-08-06), então um evento como o Ecodança que renomeou pra "1º/2º/3º Lugar" continua vendo só o número cru no certificado, sem o nome da faixa nenhum dos dois jeitos. São sistemas historicamente desconectados — produtor pediu pra deixar pra depois (fechar a moldura do certificado primeiro). Quando retomar: unificar pra usar `resolveMedalLabel()` (mesma fonte do Apuração), e revisar `resolveTag` CORPO em `get-certificate-pdf/index.ts` (hoje concatena o valor cru sem sufixo "º lugar").

**🟡 Pendência de validação — certificados Oficial Dourado sem smoke em evento ao vivo (2026-07-18)**: moldura nova (Mostra + Workshop) só testada via preview com dados fictícios/evento real selecionado — nunca emitida em lote de verdade pro público de um evento acontecendo. Testar no próximo evento: emitir de verdade, inscrito baixar, conferir posições/QR/data no PDF final (não só preview).

**✅ EXPIRADO/PROVAVELMENTE RESOLVIDO — Egress do Supabase (janela de checagem terminou 12/08/2026, sem follow-up desde então)**: a carência da Fair Use Policy dada pelo Supabase venceu em 12/08/2026 (hoje é 09/16, mais de um mês depois) e nenhuma sessão registrou bloqueio 402 nem novo alerta de Egress desde então — sinal de que o fix de `cacheControl` (commit `ea75ff3`, 2026-07-15) resolveu de fato. Não fechado formalmente por ninguém ter voltado a checar o Dashboard de Usage. Se quiser 100% de certeza, 1 clique em `https://supabase.com/dashboard/org/nkfhcqcgfraolffbiusg/usage` confirma; do contrário, tratar como resolvido.

**✅ RESOLVIDO — checagem de áudio pré-entrada do júri validada em hardware físico real**: `JudgeMicCheck.tsx` (ver Histórico recente 2026-07-16) testado várias vezes pelo produtor em tablet físico real, já validado há tempo.

**✅ RESOLVIDO 2026-07-19 — varredura completa de policy "Acesso Total X" fantasma**: rodei `SELECT * FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true')` em TODO o schema (não mais tabela por tabela). Achou 1 real: `stage_timings` (INSERT liberado pra role `public` — qualquer um, nem logado, podia inserir duração de apresentação arbitrária; tabela alimenta Marcador de Palco + é a fonte cogitada pra "penalidade por tempo excedido"). Corrigido com policy escopada por evento (migration `20260719c_stage_timings_scoped_policy.sql`), mesmo padrão do check-in de equipe. As outras 5 policies com `qual=true` encontradas (`categories`/`subcategories`/`event_short_codes`/`event_slug_history`/`cronograma_blocos`) são leitura pública intencional (dado de referência ou já documentado como tal), sem ação necessária. Essa era a 4ª ocorrência dessa classe de bug (`registrations` 2026-05-22, `events` 2026-07-17, `profiles` e `stage_timings` 2026-07-19).

**🟢 Pendência — Regulamento IA: gap arquitetural de `registration_lots` (2026-07-17)**: durante o fix de colunas fantasma, `tiebreaker_rules` e `registration_lots` foram removidos do write do parser por nunca terem tido destino real em lugar nenhum do sistema — preço de inscrição vive por formação (`events.formacoes_config`), não como lista global de lotes. Se o produtor pedir "lotes de inscrição" (like ingressos/workshops já têm), é feature nova, não bug a destravar.

**✅ RESOLVIDO 2026-07-10 — Link morto no rodapé de `/entrar-juri` (era pendência de 2026-07-09)**: fixado em `e3928d3` (removido o link morto) e depois superado por completo em `83300c9` (acesso do jurado virou 1 único fluxo — Código de acesso + QR `?code=` autosubmit, sem mais link cru exposto). Ver Histórico recente 2026-07-10.

**✅ SUPERADO 2026-07-11/12 — Usualdance Festival aconteceu em 11/07**: as 4 validações pendentes da véspera (Voto Popular automático, trava de deliberação, Súmula PDF, QR do jurado) foram exercitadas ao vivo. O evento real revelou vários bugs reais de premiação (vazamento antes da revelação, corrida entre abas Telão/Premiação, recálculo quebrado) — todos corrigidos na sessão de pós-mortem 2026-07-11/12 (ver Histórico recente "Premiação: fonte única de verdade"). Não há registro de falha na Súmula PDF/QR do jurado nesta sessão.

**✅ RESOLVIDO 2026-07-12/15 — evento DEMO sombreava evento real** (era pendência desde 2026-07-12): fix de raiz shipado em 3 rodadas — `974da22`/`56635f6` (mesmo dia, `resolveActiveEventId()`, `AccountSettings.tsx`, `DemoBanner.tsx`, `ProducerAlerts.tsx`) e `5eac3c3` (2026-07-15, `Schedule.tsx` + 3 pontos remanescentes em `AccountSettings.tsx`). Todos os resolvedores "sem hint" agora usam `order('is_demo', ascending)` antes de `created_at` — evento real sempre vence um demo mais recente na mesma query. Ver Histórico recente.

**🟡 Pendência — certificado de Workshop nunca confirmado com o produtor (2026-07-15)**: durante a correção do incidente "certificado Mostra sobrescrito pelo demo" (ver Histórico recente), restaurei o preset Ouro Real + assinatura do certificado de **Mostra** (confirmado pelo produtor), mas perguntei se o certificado de **Workshop** também tinha sido customizado e a pergunta ficou sem resposta na sessão. Hoje ele está com o placeholder do demo ("Modelo padrão Workshop (DEMO)", assinatura "Coordenação Pedagógica") — se o produtor nunca mexeu nele, tudo bem deixar; se customizou, precisa restaurar manualmente em `/certificados` → aba Workshop.

**🟡 Pendência — crons de limpeza de Storage ainda não reativados (2026-07-15)**: `cleanup-orphan-tracks-daily` e `cleanup-orphan-narrations-daily` foram pausados (`cron.unschedule`) depois do incidente das 36 trilhas apagadas, corrigidos, e o produtor autorizou reativar — mas até o fim da sessão o SQL de reagendamento (mandado pro produtor colar no SQL Editor, carrega a `service_role_key`) ainda não tinha sido confirmado como rodado. Conferir `SELECT jobname, active FROM cron.job WHERE jobname LIKE 'cleanup-%'` — só `cleanup-audio-feedbacks-weekly` estava ativo no fim da sessão.

**🟡 Pendência de validação — `event_judges` sem uso real em evento ao vivo (2026-07-15)**: o vínculo jurado↔evento (migration `20260715_event_judges.sql`) foi validado via API + screenshot estático, mas nunca testado com um produtor operando a tela de verdade num evento em andamento (vincular/desvincular jurado durante a semana de preparação, terminal puxando a lista certa no dia). Testar no próximo evento real.

**🟡 Pendência de validação — fluxo novo de Premiação sem cerimônia real ao vivo (2026-07-11/12)**: arquitetura "registra primeiro, revela depois" (Deliberações registra, Telão só revela, RPC atômica `update_premios_winners`, gate `winner_revealed`) foi toda shipada DEPOIS do Usualdance já ter acontecido — só validada por smoke transacional (BEGIN/ROLLBACK) em prod, nunca com o produtor operando de verdade numa cerimônia de premiação ao vivo. Testar no próximo evento: registrar vencedor em `/deliberacoes`, confirmar que a vitrine NÃO mostra nada até clicar revelar no Telão, revelar e confirmar LED + vitrine batem.

**🟡 Pendência de validação — player do Cronograma + refresh do Marcador de Palco sem smoke ao vivo (2026-07-12)**: seek de trilha (±10s, barra arrastável), player sticky, badge "última tocada", e o botão "Atualizar"/realtime do Marcador de Palco (commit `958a9ea`) nunca foram testados durante um evento real rodando — só build/lint/testes automatizados. Testar no próximo evento com sonoplasta operando ao vivo.

**🟢 Auditar outras edge functions recém-criadas pelo mesmo erro de `verify_jwt` default (2026-07-10)**: o bug real do dia foi `get-winner` (repo Voto Popular) deployada sem `--no-verify-jwt`, deixando a integração automática do Telão morta desde 07/07 sem ninguém notar (gateway do Supabase rejeita antes do código rodar). Toda função nova que reusa um padrão de segredo compartilhado (`x-vote-token`, `x-*-token`) precisa do flag explícito no deploy — vale um grep rápido comparando `supabase functions list` (coluna JWT) com o padrão esperado da família de funções, tanto no projeto CoreoHub quanto no do Voto Popular.

**🟡 Migration commitada ≠ migration aplicada — auditar outras colunas recentes (2026-07-08 noite)**: `20260709_docs_voto_juri_short_code.sql` ficou meses sem rodar em prod (nunca colada no SQL Editor) e quebrou 2 telas ao mesmo tempo antes de alguém notar (vitrine pública em domínio custom + Configurações→Identidade), porque nenhum dos dois `select()` checava `error` — só `data`, que vem `null` tanto pra "não existe" quanto pra "coluna não existe no schema" (PGRST204). `PublicEventPage.tsx` já ganhou log defensivo; `AccountSettings.tsx` (linha ~1750, mesmo padrão de select amplo) ainda não. Vale: (1) replicar o log de erro lá, (2) considerar uma rotina de checar `information_schema.columns` vs. migrations commitadas não aplicadas antes de fechar sessão, já que o workflow do produtor é sempre colar SQL manual (nunca CLI/CI automatizado).

**🟡 Botão de login da vitrine — 2 achados do `/revisar` não corrigidos (2026-07-08)**: (1) `isLoggedIn === null` (checando sessão) é tratado igual a `false` no ternário — o botão mostra "Entrar" e pode trocar pra "Minha conta" alguns ms depois, quando o comentário no código promete evitar exatamente esse flash; (2) "Minha conta" sempre manda pra `/dashboard` sem checar `profile.role` — produtor testando a própria vitrine cai na tela do inscrito em vez de `/qg-organizador`. Ambos em `pages/PublicEventPage.tsx` (bloco do `EventAnchorNav`/`cta`). Detalhes em [[botao_login_vitrine_shipado]].

**✅ RESOLVIDO 2026-07-11 — Telão de palco validado com LED físico no Usualdance Festival**: confirmado pelo produtor com live/gravação real mostrando o LED em uso no evento (não só `?teste=1`/`ROLLBACK`). Modo Ao vivo (média aparecendo sozinha) validado em produção real.

**🟢 Pendência — Avisos do produtor sem segmentação (2026-07-07)**: v1 é "vale pro evento inteiro" — sem filtro por categoria/formação/bloco. Se o produtor quiser avisar só um grupo específico (ex: "Juvenil Jazz, apresentação adiantada"), hoje não dá. Considerar campo opcional de segmentação se aparecer esse pedido.

**🟧 Pendência de validação — modo SISTEMA do Cronograma (2026-07-06)**: robustez (failsafe timers + listeners de erro) shipada, mas sem confirmação do produtor em produção real ainda. Testar com o Console (F12) aberto — se travar de novo depois da narração de entrada, deve aparecer um `console.warn`/`console.error` explicando o motivo exato (sem `trilha_url` / erro de carregamento / timeout de segurança acionado). Detalhes na entrada de 2026-07-06 do Histórico recente.

**✅ Workshop Pass — deploy finalizado em 2026-06-28**: migration `20260628_workshop_passes.sql` aplicada em prod via CLI (tabelas `workshop_passes`/`workshop_pass_items` + colunas `pass_id`/`pass_group_id` em `workshop_registrations` + RPC `try_reserve_workshop_pass`, confirmadas existentes via query). Edge functions `create-workshop-pass-registration` e `detect-workshop-pass-combo` deployadas (1ª versão cada). `send-email` redeployado (pega os templates `workshop_pass_confirmed`/`workshop_pass_confirmed_producer`). Branch `WSP:` do `asaas-webhook` (já em prod desde 2026-06-27) agora encontra as tabelas. **Pendente**: smoke E2E real (compra de um Pass com PIX real) — feature nunca foi testada ponta-a-ponta, só os componentes individuais foram verificados como deployados/existentes.

**🟧 Auditar outras edge functions pelo mesmo erro `events.status` (coluna não existe, é `events.state`)**: o bug raiz do terminal de júri (2026-06-21) só foi conferido em `judge-login`. Vale grep rápido em `supabase/functions/*/index.ts` por `.select(...status...)` em queries de `events` — se existir o mesmo erro em outra function, ela está silenciosamente retornando dados vazios/null igual o terminal estava. Detalhes em [[terminal-juri-bugs-criticos-e-fila-shipado]].

**🟢 Pendência cosmética — popover "⋮" do terminal de júri redundante com a tela de fila nova**: desde 2026-06-21, o terminal tem uma tela de fila cheia (`showQueueScreen`) como entrada, mas o menu overflow "⋮" no header ainda mostra uma 2ª lista rolável menor (a navegação manual de 2026-06-11) com Anterior/Próximo/pular-pra-#N. Funciona, mas duplica a lista visualmente. Avaliar simplificar removendo a lista de dentro do popover (mantendo Anterior/Próximo/jump-to, que seguem úteis durante a avaliação) se aparecer reclamação de confusão.

**🟢 Pendência de validação — tela de fila do terminal**: testada só com 1 jurado por vez (Jonathan Lupe/Daniela Morais) sem cronograma "ao vivo" ativo de verdade. Falta smoke com múltiplos jurados simultâneos + Mesa de Som marcando "AO VIVO" de fato durante o teste (cenário real do dia do evento).

**✅ Adoção do `PageHeader.tsx` COMPLETA — SHIPADO 2026-06-20 (madrugada)**: as 10 páginas pendentes (`Schedule`, `Certificates`, `SuperAdmin`, `RegulationAIParser`, `TermoProdutor`, `JudgeManagement`, `JudgePractice`, `CheckIn`, `Credenciais`, `AccountSettings`) migradas pro componente (commit `38cc6cb`). Headers com badge/eyebrow acima do h1 (SuperAdmin "Painel da Plataforma", JudgePractice "Modo Treinamento", TermoProdutor "Aceito em") mantêm esses elementos como siblings fora do `PageHeader` — ele só encapsula `icon`+`title`+`subtitle`+`actions`. Validado com Playwright (8 rotas, 0 erros/sem overflow) + print real do `/super-admin` confirmando o painel pós-MFA. Detalhes em [[pageheader-adocao-completa-shipado]].

**✅ Bundle Workshops 2026-06-18 — 3 fixes do `/revisar` SHIPADO 2026-06-20** (commit `5f86f21`): upload de capa saiu do `<Field>`/`<label>` (evitava abrir o seletor de arquivo 2x), capa comprimida 0.3MB→0.15MB (mesmo budget do avatar do professor), `rounded-xl`→`rounded-2xl` no preview. Detalhes em [[pageheader-adocao-completa-shipado]].

**✅ Hub de Vendas: tab "Visão Geral" consolidada — SHIPADO 2026-06-19 (noite)**: `pages/VendasOverview.tsx` (rota `/vendas`, 1ª aba do hub) traz Total Geral + receita/contagem por fonte (Inscrições/Ingressos/Workshops/Seletiva), clicável pra cada aba detalhada. Ver "Histórico recente" acima. **Decisão 2026-06-20**: receita de Seletiva continua estimada (`video_fee_status='paid'` × taxa fixa do evento) — `registrations.charged_amount` não serve de fonte real porque a mesma coluna é sobrescrita entre o pagamento da inscrição e o da taxa de seletiva (precisão exigiria coluna dedicada). Baixo ROI pra escala atual (1 produtor) — não implementado, comentário inline documenta o motivo.

**🟢 Pendência — Cortesia (2026-06-19)**: `create-courtesy-entry` não decrementa estoque/capacidade do tipo de ingresso ou workshop (decisão v1: cortesia fica fora da contagem de vendas pagas, "convite da casa"). Se o produtor quiser que cortesias contem contra o limite de vagas, precisa de ajuste futuro. Também sem smoke E2E real em evento ao vivo ainda (testar "Marcar AO VIVO" + cortesia em produção real). Detalhes em [[hub-vendas-cortesia-voto-mobile-shipado]].

**🟢 Pendência cosmética — Vitrine lote de workshop (2026-06-18 noite)**: lógica de "achar próximo lote com preço maior" + JSX do aviso "Sobe pra R$X em [data]" duplicada em 4 lugares (ingressos/inscrições em `PublicEventPage.tsx`, card de workshop, detalhe `PublicWorkshopPage.tsx`) — cada um com uma variação de busca. Extrair helper `resolveProximoLote()` + componente `<AvisoViradaLote>` compartilhado se aparecer um 5º caso. Detalhes em [[workshop-lote-vigente-vitrine-shipado]].

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
- **Página pública do produtor** (pedido 2026-08-19, backlog — NÃO implementar sem aprovação explícita do plano). Confirmado em 2 plataformas reais (não suposição): Luma tem `/user/<handle>` com foto, bio, redes sociais, contagem de "hospedados/participou", lista "Organizando" (eventos futuros do organizador) — Sympla tem "Página do Organizador" equivalente (URL customizada, logo/banner, descrição, redes sociais, abas eventos futuros/passados). Ambas resolvem o mesmo problema: divulgar todos os eventos de um produtor recorrente (ex: Usualdance, que já fez múltiplas edições) num link só, em vez de cada evento viver isolado.
  - **Plano de implementação (esboço, não detalhado)**: nova rota pública `/produtor/<slug-ou-id>` — header com nome/logo do produtor (já existe em `profiles`) + bio curta (campo novo) + redes sociais (já existem os campos `instagram_event` etc, mas esses são POR EVENTO — precisaria de um novo conjunto de campos no nível do `profiles`/produtor, não do evento) + grid de eventos públicos do produtor (`events WHERE created_by = X AND is_public = true`, mesma query já usada em `Festivais.tsx`, só filtrada por criador) + toggle "mostrar eventos passados". Link da página do produtor apareceria na vitrine de cada evento dele (ex: no card "Produzido por X" da coluna da foto, se a página de hero em 2 colunas for implementada).
  - **Esforço estimado**: ~1 dia (nova rota + query + campos novos em profiles + UI). Trigger pra implementar: produtor recorrente (2+ edições reais) pedir ou aprovar o plano.
- **Programação — UX de edição em blocos** (pedido 2026-08-18): produtor questionou se a edição em blocos (1 linha por horário+atividade em Configurações → Programação) é boa prática — pesquisa de mercado confirmou que a **exibição pública em blocos cronológicos (hora + atividade) É o padrão de conferências/festivais** (Whova, Eventbrite Schedule etc — "attendees check it to figure out where to go next"), não deve virar texto livre. A dúvida real é sobre a *edição*: hoje é 1 bloco por vez com "+ Adicionar bloco". Ideia levantada, não aprovada: campo de "colar tudo de uma vez" (textarea) que interpreta linhas tipo `08:00 - Abertura` e gera os blocos automaticamente, reduzindo atrito de montar programação longa. Não implementar sem validar com o produtor se esse é de fato o incômodo.
- ✅ **Modo claro como padrão — SHIPADO 2026-08-16 (Opção B: só app interno)**: os 5 bloqueadores corrigidos (`AIAnalysis.tsx`, `/equipe-jurados-config`, `/telao-palco`, `BattleConfig.tsx`, `RegistrationGradeConfig.tsx`) + padrão sistêmico de botão/ícone de baixo contraste corrigido na raiz (`disabled:opacity-XX` sobre fundo saturado lavava pra pastel em claro — trocado por cores explícitas de estado desabilitado em `ProducerBalanceCard.tsx`, `OnboardingWizard.tsx`, `VendasIngressos.tsx`, `ValidarCertificado.tsx`, `Coupons.tsx`, `Avisos.tsx`) + default de `localStorage.theme` em `App.tsx` trocado de `'dark'` pra `'light'`. Vitrine pública e telas de palco (Marcação de Palco, Telão preview/Display, Battle Arena Live) **permanecem escuras sem nenhuma mudança de código** — confirmado que todas as 4 já usavam fundo hardcoded (sem `dark:` prefix), nunca dependeram do toggle global, então a virada do default não as afeta. 3 bugs funcionais achados no caminho e corrigidos junto (fora do escopo de tema, mas pedido explícito): tabela de Cupons ganhou indicador de scroll horizontal via `mask-image` (mesmo padrão já usado no anchor nav da vitrine); bio duplicada do professor no workshop `jazz-funk-com-jonathan-lupe` corrigida direto no banco (`professor_bio_short` quase idêntico ao `professor_bio`, nulado); ícone sobrepondo título no Battle Arena mobile corrigido com tamanhos/gaps responsivos. **Não corrigidos** (fora do orçamento da sessão, precisam reprodução ao vivo pra diagnosticar com segurança): 35 console errors em `/manage-schedule` mobile, 1 console error cada em `/evento/:slug` e `/ingressos`, e o item vago "abas cortadas/badge quebrando linha" do painel do inscrito (nunca localizado em arquivo/linha específica). Validado via Playwright local (desktop+mobile, tema claro) nas 11 rotas tocadas — 0 overflow, os únicos console errors capturados são pré-existentes e não relacionados (404 de asset em dev, bug de realtime subscription já existente em `VendasIngressos.tsx`). Relatório original da auditoria em [[modo_claro_auditoria_2026_08_08]].
- **Penalidade por tempo excedido configurável + extração via IA** — plano aprovado 2026-07-17, NÃO implementado. Produtor define regra de desconto (unidade + valor) por modalidade **na mesma aba de Critérios de Avaliação** (Configurações → Avaliação, decisão confirmada — não existe valor universal de mercado, tem que ser configurável por evento igual comissão/tolerância de idade); `gemini-analysis` tenta extrair do PDF do regulamento (maioria dos festivais BR já tem essa cláusula). Desconto calculado na apuração (nota bruta vs ajustada), aplicação continua exigindo confirmação explícita da produção — nunca automático/silencioso. Curto prazo (mesma sessão): Wizard só sinaliza "⚠ Tempo excedido" sem bloquear inscrição, sem calcular desconto ainda. Detalhes em [[backlog-penalidade-tempo-excedido]].
- **B4 Push Web (notificações)** — ~4h. Cobertura 15-30% (taxa típica de aceitar permissão). Faz sentido só depois do inbox virar baseline + algum produtor demandar. VAPID keys + permission UX + send-push edge function. Service Worker já existe via workbox.
- **Phase 6 — Mesa de Som offline-first: PARCIALMENTE IMPLEMENTADO (achado 2026-08-16, não documentado antes)** (`#37`) — commit `04409cc` (2026-07-09, "modo Trilha + pré-cache offline das trilhas") já shipou pré-cache real via Cache API em `Schedule.tsx`: `caches.open('coreohub-trilhas-<eventId>')` baixa as trilhas pro dispositivo + indicador visual "X trilhas prontas offline neste dispositivo" / "X não baixaram (toca da rede se houver conexão)". **O que falta pra fechar 100%**: outbox de `live_registration_id` (sincronizar marcação AO VIVO feita offline quando a rede voltar) + invalidação de cache quando trilha é reenviada. Sem evidência de que essas 2 partes existam ainda — confirmar com o produtor se já usou o modo Trilha offline de verdade num evento antes de assumir concluído.
- ✅ **A19 Parte A — Testes automatizados SHIPADO 2026-05-30** (commit `2f5181a`): Vitest + 81 testes de lógica pura + GitHub Actions CI. Detalhes em [[backlog-testes-automatizados-a19]]. **Parte B (integração Asaas sandbox)** segue deferida — precisa credencial sandbox + secret no GitHub; trigger: ~5 produtores ativos OU primeira regressão cara de integração.
- **Fix permanente partial refund (`GET /payments/{id}` pra walletId real)** — ~30min. Defer até produtor demandar partial refund frequente. Workaround atual: full refund (deixa campo vazio no modal) funciona sempre.
- ✅ **Carrinho de ingressos multi-tipo na vitrine — SHIPADO 2026-05-30** (commits `0b726c7` + `aab5ddd`, migration `20260619` aplicada). Ver "Features chave" + Histórico recente acima e [[carrinho-ingressos-multi-tipo-shipado]]. Pendente só smoke E2E ponta-a-ponta (sem evento INTERNO com venda ativa em prod pra testar com PIX real).
- **Cupom com produtos específicos (Stripe-style)** — defer 2026-05-28. Hoje cupom aplica em "setor" (Inscrição/Plateia/Workshop/Seletiva). Granularidade fina seria 4 colunas opcionais em `coupons`: `applies_to_formations TEXT[]` (Solo/Duo), `applies_to_categories TEXT[]` (Junior/Adulto), `applies_to_workshops UUID[]` (FK), `applies_to_ticket_types TEXT[]` (Meia/Inteira). Vazio = aplica em qualquer. Padrão Stripe/Sympla/Hotmart, mas overkill pra v1 — produtores hoje criam cupons que aplicam no setor inteiro. ~3h. Trigger: produtor pedir granularidade ("quero cupom só pra Solo, não pra Grupo").
- **Modelo comercial pra evento privado 100% grátis** — gap identificado 2026-05-28. Hoje produtor pode criar evento Privado com taxa R$ 0 + workshops grátis + ingressos grátis → usa toda a infra da CoreoHub (IA regulamento, narração ElevenLabs, Júri Terminal offline, certificados) sem gerar receita. Decisão pendente entre 4 modelos de mercado: A) Sympla-style (subsidia, aposta no funil), B) Setup fee por evento grátis (~R$ 297-997, **recomendado**: alinha com Bizzabo/Cvent, implementação pequena via Asaas single payment + `events.setup_fee_paid_at`), C) Subscription mensal opcional (estilo CompetitionSuite), D) Freemium com feature gating. Decisão é comercial, não técnica. Esforço técnico ~3h depois da decisão. Detalhes em [[backlog-modelo-comercial-evento-gratis]].

### 🟩 P3 — Aguardando trigger externo
- **TED como payout alternativo** — plano + taxas pronto, congelado até alguém pedir.
- **Vitrine na home + nome do festival na URL raiz** — GA/pixels JÁ implementados (`services/analytics.ts`, `producerAnalytics.ts`, `utmTracking.ts`, `ProducerPixels.tsx`, gtag no `index.html`). Landing existe em `/lp`. O que falta: rota `/` mostra `RootRedirect` (vai pra login/kiosk), não a vitrine; migrar `coreohub.com` → vitrine na home + nome do festival na URL raiz depende de config de domínio no Cloudflare + Vercel (não há Hostinger envolvida — correção 2026-08-23, a nota antiga citando "decisão DNS Hostinger→Cloudflare" estava desatualizada). Vitrine pública já vive em `/festivais`, hoje servida sob `app.coreohub.com` — pesquisa de mercado real (2026-08-23) mostrou que os concorrentes BR mais próximos (Sympla, Even3) fazem o oposto: vitrine no domínio raiz, painel do organizador isolado em subdomínio (`organizador.sympla.com.br`, `plataforma.even3.com.br`). Investigação de Cloudflare/Vercel em andamento antes de migrar.
- ✅ **Multi-jurado seletiva v1.1 — SHIPADO 2026-05-30** (commit `98f0b94`). Página `/jurado-seletiva` blind + config no produtor + escolha pós-PIN. Ver "Features chave" + Histórico recente acima e [[plano-multi-jurado-seletiva-v1-1]]. Pendente só E2E real do jurado (sem evento com banca configurado em prod). Regra `unanimous` testada via trigger, não via UI.

### 🪶 Cosméticos / pequenos achados de auditoria 2026-05-22
Resolvidos em 2026-05-23 (`f7d605c`+`81d2d0f`+`87cc593`) + 2026-05-24 (aplicação): NotificationBell `formatRelative` re-renderiza via `setInterval` 60s; `send-trilha-reminders` agora bulk fetch (2 queries por evento); `notifications.metadata` indexes aplicadas em prod 2026-05-24 (2 btree expression + 1 GIN); contraste cyan no card Funil de Leads corrigido pro light mode (`text-cyan-700 dark:text-[#1de7f2]`). Resolvido em 2026-06-20 (`57d5bd5`): NotificationBell ganhou paginação "Ver mais" via `.range()` por offset — quem recebe 51+ não perde mais as antigas.

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
