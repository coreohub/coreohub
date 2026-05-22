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

## Workflow obrigatório (decretado 2026-05-22)

1. **Plano antes de feature grande** — apresentar abordagem em 3-5 bullets e aguardar OK. Feature grande = > 1h estimada OU mexe em múltiplos arquivos/sistemas. Microchange (label/ícone/padding) segue direto.
2. **Playwright screenshot após mudança visual estrutural** — `node scripts/screenshot.mjs /rota` em 1440×900 (desktop) + 375×812 (mobile). Aplica a: componente novo, mudança estrutural, página com >20 linhas alteradas. NÃO aplica a microchange.
3. **Validar contra Definition of Done** — funciona em desktop+mobile (screenshots cobrem), sem erros no console (`report.json` checa), segue design system (paleta `#FF0068`/`#E3FF0A`/`#1DE7F2`, Barlow+Inter, rounded-2xl/3xl), sem overflow horizontal (`report.json` checa).
4. **Commit autônomo ao concluir etapa funcional** — sobrescreve default "only when requested". Commitar sem pedir confirmação.

Setup técnico em `scripts/README-playwright.md`. Read-only enforced (só `goto`+`screenshot`, nunca `click` em mutation). Detalhes operacionais em [[feedback-workflow-obrigatorio-dod]].

## Histórico recente (últimas ~2 semanas)

Cronológico inverso. Detalhes individuais em `memory/`.

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

**Nenhum P1 destravado em aberto.** Próximos itens precisam de ação externa (smoke test) ou viraram P2 (esforço maior).

### 🟨 P2 — Alto valor, esforço maior
- **Auditoria RLS sistemática outras tabelas** — `audience_tickets`, `workshop_registrations`, `video_selections`, `aggregate_payments`, `coupons` podem ter mesmo padrão "produtor só SELECT, UPDATE silently broken" que descobrimos em registrations 2026-05-22. Heurística: UI tem "Editar" pro produtor + tabela só tem `*_reads_*` policy + `super_admin_all_*`. ~2h. Decorrência da auditoria do bug RLS em [[bug-rls-producer-update-registrations]].
- **Painel /registrations Sessão 4.2** — drill-down side panel + ações em massa + análise financeira (Top 5 estúdios, distribuição por modalidade). ~10h. Sessão 4.1 (quick wins) já shipada 2026-05-22.
- **B4 Push Web (notificações)** — ~4h. Cobertura 15-30% (taxa típica de aceitar permissão). Faz sentido só depois do inbox virar baseline + algum produtor demandar. VAPID keys + permission UX + send-push edge function. Service Worker já existe via workbox.
- **Phase 6 — Mesa de Som offline-first** (`#37`) — botão "Baixar pacote do evento" pré-cacheia trilhas + narrações no Cache API. Outbox de live_status. ~1-2 sprints.
- **A19 — Testes automatizados** — Vitest + GitHub Actions + mock Supabase client. 3 PRs (webhook → sweep/KYC/reminders → seletiva/pricing). ~4-6h. Trigger: ~5 produtores ativos OU primeira regressão cara.
- **Smoke pós-RLS fix em CheckIn + ResultsPanel** — produtor real testar QR check-in (persiste agora?) + "Publicar resultados" (atualiza banco agora?). Beneficio colateral do fix `ded2e3e` 2026-05-22. ~30min.
- **Card Saldo: ler saldo real do Asaas via API** — hoje mostra `net_amount` esperado, pode divergir do saldo real se houver dívida pendente na subconta. UX a polir.
- **Test E2E cenário 3 D+7** (botão Transferir agora) — defer pelo user em 2026-05-21. Cenários 1 + 1.5 + 2 passaram.
- **Bundle index 891 kB** — warning Vite > 500kB. Code-split BarChart + jspdf ajudaria. LCP em 3G.

### 🟩 P3 — Aguardando trigger externo
- **TED como payout alternativo** — plano + taxas pronto, congelado até alguém pedir.
- **/LP nome festival + GA + vitrine na home** — bloqueado por decisão DNS (Hostinger → Cloudflare).
- **Multi-jurado seletiva v1.1** — página `/jurado-seletiva` dedicada (modo blind). Infra de DB pronta. Quando algum produtor demandar.

### 🪶 Cosméticos / pequenos achados de auditoria 2026-05-22
- **NotificationBell `formatRelative` não re-renderiza** — notif fica "agora" mesmo passando 1h se dropdown ficar aberto. Fix futuro: `setInterval(forceUpdate, 60_000)`. Não bloqueia.
- **NotificationBell sem paginação** — limit 50 hard. Quem receber 51+ perde as mais antigas. v1 acceptable. Adicionar "ver mais" quando necessário.
- **`send-trilha-reminders` 1 query de count por registration** — pra evento com 200+ regs APROVADAS sem trilha, vira 200 round-trips. Otimizar pra bulk `IN` quando virar problema.
- **`notifications.metadata` sem GIN index** — query `metadata->>'registration_id'` no idempotency check vira table scan. Sem dor enquanto <10k notifs. Criar `CREATE INDEX notifications_metadata_gin ON notifications USING GIN (metadata)` quando crescer.

### ⚠️ Pendência operacional
- **Service_role_key precisa ser rotacionada** — vazou no transcript durante smoke 2026-05-21 (erro do bash com `source .env` malformado). User vai rotacionar quando puder. Atualizar 3 lugares depois: `.env` local, possível header de webhook no painel Asaas, secret no Supabase Functions (auto).
- **Subconta Hemer com saldo R$ ~0,00 (mais R$ 13,50 retidos no D+7 invisíveis na view padrão)** — sobra do smoke do D+7. A divergência saldo Asaas vs CoreoHub foi corrigida no fix `51c3046` (refund agora atualiza `platform_commissions`).
- **Cron `send-trilha-reminders` agendado mas sem dados** — primeira execução 2026-05-22 09:00 BRT. Provavelmente passa direto porque evento Usualdance 2026 não tem `prazo_trilhas` setado em `configuracoes`. Pra ver cron funcionar de verdade: produtor configura prazo em `/configuracoes` ou edita SQL direto. Aceitável — é cron preparado pro futuro.
- **Polimento residual:** `pages/ProducerDashboard.tsx:197` faz `select` em `platform_commissions` sem filtrar `refunded_at` (usado pra gráficos históricos). Não bloqueia, mas se algum chart derivar daí, mostra receita inflada. Anotado pra polir depois.
- **Grazieli 40 bailarinos sem CPF** — confirmado via SQL: 10 inscrições do `gra_503@hotmail.com` no Usualdance, total 40 bailarinos com CPF=NULL e data_nascimento=NULL. Bloqueia certificado + triagem etária. User vai mandar WhatsApp manual cobrando. Inscrição "Entre cordas e sonhos- Studio de dança Grazieli Baldan" é zumbi mais grave (Solo com array `bailarinos_detalhes` vazio).

## Não fazer

- ❌ Sem testes ainda (A19 backlog) — validar manualmente em prod, com `npm run build` antes de commit.
- ❌ Sem `--no-verify` em commits sem motivo explícito.
- ❌ Sem service role no frontend (vai vazar em bundle).
- ❌ Sem `auth.includes(serviceKey)` em edge function (usar decode + role check).
- ❌ Sem `return null` silencioso em componente novo (empty state visível).
- ❌ Sem placeholder SQL pra user substituir (`<COLA_AQUI>`) — ele cola literal. Usar `DO $$` ou extrair do próprio banco.
- ❌ Sem instruções de DevTools acrobacia quando dá pra investigar via SQL.
