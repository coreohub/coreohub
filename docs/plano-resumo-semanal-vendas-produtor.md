# Plano: aviso de venda ao produtor, "a cada venda" ou "resumo semanal" (padrão)

Status: PLANO, nada implementado. Escrito em 2026-11-19 para ser executado em sessão nova.

## Por que
- Hoje o asaas-webhook manda 1 e-mail "Nova venda" por venda ao produtor, sempre, sem opção de desligar. Na semana do Level Up a Monique recebeu 28 e-mails em 3 dias.
- Pesquisa de mercado (18/11, só plataformas estrangeiras de ingresso; nada achado de Sympla/Even3/Ingresso.com/Blueticket): o padrão é resumo como padrão e e-mail por venda como opção (Ticket Spot, SoundCloud/Universe, Peatix, Oveit, TicketSource).
- Evidência no nosso caso: desde 18/11 19:14 UTC, os 4 e-mails seguidos para o Hotmail da Monique ficaram em `delivery_delayed` (17 h+), depois de 28 entregues. Throttling do Hotmail diante do volume é a hipótese (não provada). Menos e-mail ajuda.

## Decisão de produto (confirmar antes de codar)
- Modo `each` (a cada venda, comportamento de hoje) e `weekly` (resumo semanal, padrão).
- Atenção: semanal é lento em semana de pico de venda. Por isso o `each` fica disponível e o seletor explica isso. Se o produtor quiser, adicionar `daily` depois sem refazer nada (a função de resumo já recebe a janela como parâmetro).
- Padrão para produtores atuais: DECIDIDO em 2026-11-19, `weekly` para todos, SEM aviso por e-mail aos produtores (decidido pelo dono; `each` continua fácil de escolher no seletor).
- Envio: DECIDIDO em 2026-11-19, sexta-feira 12:00 UTC (09:00 BRT), cobre os 7 dias anteriores (sexta a quinta). Sem venda na janela, não manda e-mail. Motivo: o produtor decide ações de venda perto do fim de semana e os eventos acontecem sáb/dom; raciocínio nosso, não achei padrão brasileiro documentado (Sympla/Even3/Blueticket/Ingresso.com não documentam resumo por e-mail). Horário é só o cron, fácil de mudar.

## O que existe hoje (conferido em 19/11)
- `supabase/functions/asaas-webhook/index.ts`: `dispararEmail()` linha ~332 chama a send-email com a chave do ambiente. Envios ao produtor:
  - `audience_ticket_producer` linha ~1063
  - `workshop_registration_producer` linha ~1291
  - `workshop_pass_confirmed_producer` linha ~1530
  - `payment_confirmed_producer` linhas ~1914 e ~3204
  - `audience_ticket_late_refund_producer` linha ~824 (estorno): continua SEMPRE imediato.
- `send-email` (v108): gate de service por igualdade em tempo constante com `SUPABASE_SERVICE_ROLE_KEY`/`SERVICE_ROLE_KEY`. Qualquer função nova que a chame deve enviar a chave do ambiente (mesmo padrão do `dispararEmail`).
- Padrão de cron a copiar: `supabase/migrations/20261117c_notify_sales_open_cron.sql` (`net.http_post` com Bearer).
- Não existe preferência de notificação do produtor no banco. `profiles.email` e `profiles.full_name` já são lidos pelo webhook.

## Etapas e tempo (cerca de 6 h 30 + 1 semana de observação)
| # | Etapa | Tempo |
|---|---|---|
| 1 | Migration: `profiles.producer_sales_email_mode text not null default 'weekly' check in ('each','weekly')` e `producer_sales_digest_last_at timestamptz`. Partir de `supabase/migrations/_template.sql` (GRANT + RLS), `NOTIFY pgrst`. Produtor só edita o próprio modo (cuidado com trigger `protect_profiles_privileged_columns`: liberar só essas colunas). | 30 min |
| 2 | Template `producer_sales_digest` na send-email: tabela por evento (ingressos, inscrições, workshops: quantidade, bruto, comissão, líquido) + total, no visual dos outros. | 45 min |
| 3 | Edge function `send-producer-sales-digest`: agrega vendas aprovadas (`is_sandbox=false`) por produtor/evento na janela, gate de service por igualdade com a chave do ambiente, `last_digest_at` evita repetir/pular, modo `PRODUCER_DIGEST_MODE` (off/dry/on, nasce `off`). Lógica pura de agrupamento em `_shared/` com vitest. | 1 h 30 |
| 4 | Webhook: nos 5 pontos, ler `producer_sales_email_mode`; só envia se `each`. Falha na leitura do modo = enviar (falha segura, nunca perder aviso). Estorno intacto. Atrás do mesmo `PRODUCER_DIGEST_MODE` (off = comportamento de hoje). | 45 min |
| 5 | Tela: seletor em Configurações da conta ("Avisos de venda por e-mail: Resumo semanal (recomendado) / A cada venda"), estado visível, screenshots desktop+mobile (`node scripts/screenshot.mjs`). | 45 min |
| 6 | Testes: `tsc`, `vitest`, `build`; sandbox do webhook nos 2 modos; envio real do resumo só para o dono antes de ligar para todos. | 1 h |
| 7 | Deploy: `send-email`, `send-producer-sales-digest`, `asaas-webhook`, nessa ordem, cada um com `node scripts/pre-deploy-check.mjs --strict` na janela 1h-6h BRT; agendar cron (sexta 12:00 UTC); frontend na `dev`. | 45 min |
| 8 | Ligar `PRODUCER_DIGEST_MODE=on` com OK do dono; conferir no Resend o 1º resumo real (1ª sexta-feira). | 30 min + 1 semana |

Sugestão de divisão: sessão 1 = etapas 1-3 (tudo desligado, sem efeito); sessão 2 = 4-6 (na `dev`); sessão 3 = 7-8 (madrugada).

## Regras do repo a respeitar
- Trabalhar na `dev`; `main` só por merge/fast-forward da `dev` inteira, nunca cherry-pick.
- Venda ativa bloqueia deploy de edge function, migration e push na `main`; `pre-deploy-check --strict` antes (0 = pode, 2 = esperar, 3 = modo inesperado).
- Código que mexe em dinheiro nasce atrás de modo (off/dry/on) e liga só na janela calma.
- Gate de service-role sempre por igualdade com a chave do ambiente (NUNCA por claim de JWT; lição do incidente de 17-18/11, `docs/HISTORICO.md`).
- Migration idempotente, com GRANT explícito, aplicada via `npx supabase db query --linked --file`.
- Não rodar teste de pagamento real sem avisar (staging usa o mesmo backend de produção).

## Riscos
- Webhook é o ponto mais sensível: erro nele derruba o aviso (ou a venda). Mitigação: modo `off`, falha segura (enviar), teste em sandbox.
- Produtor que já se acostumou com o aviso por venda: sem aviso prévio (decisão do dono); deixar `each` fácil de escolher no seletor.
- Hotmail com atraso pode atrasar também o resumo: o resumo é 1 e-mail, não 28.

## Prompt para colar na sessão nova
> Leia `docs/plano-resumo-semanal-vendas-produtor.md` e execute a SESSÃO 1 (etapas 1 a 3), tudo desligado (`PRODUCER_DIGEST_MODE=off`), na branch `dev`, sem deploy de edge function nem migration em produção sem rodar `node scripts/pre-deploy-check.mjs --strict` e sem meu OK. Decisões já tomadas: padrão `weekly` para todos os produtores e envio na sexta 12:00 UTC (09:00 BRT). Responda em português, curto.
