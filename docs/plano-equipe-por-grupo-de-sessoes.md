# Plano C — Equipe (operadores) valendo para todas as sessões do mesmo espetáculo

> Status: PLANO, nada implementado. Levantamento feito em 2026-09-25. Implementar em sessão nova (prompt no fim).
> Regra do fluxo: apresentar o plano em 3-5 bullets ao produtor e aguardar OK antes de mexer em RLS/edge functions.

## Problema

Cada sessão do espetáculo é um evento próprio (`events.session_group_id`, etapa 4 da Fase 3). Só que a equipe (bilheteria, check-in, marcação de palco) é presa a UM evento por `profiles.team_event_id`. Um espetáculo com 5 sessões exigiria 5 convites/vínculos por operador. Comprovado no sandbox (2026-09-25): operador vinculado à sessão 2 vendeu no PDV da sessão 2 e foi recusado na sessão 3 ("Sem permissão pra vender ingressos deste evento"); na tela `/vendas-ingressos` ele só enxerga a sessão vinculada e não tem seletor.

## Proposta

O vínculo continua sendo a UM evento (`team_event_id`), mas o ACESSO passa a valer para todas as sessões do mesmo grupo **e do mesmo produtor**. Sem nova coluna de vínculo; convites, `manage-team-member` e `permissoes_custom` não mudam.

Regra única (fonte de verdade no banco):

```
team_event_ids(uid) = eventos e2 tais que
  e1.id = profiles.team_event_id do uid
  AND (e2.id = e1.id
       OR (e1.session_group_id IS NOT NULL
           AND e2.session_group_id = e1.session_group_id
           AND e2.created_by = e1.created_by))
```

`created_by` igual é obrigatório: `events.session_group_id` é coluna comum, e sem essa trava um produtor B poderia colocar o evento dele no grupo do produtor A e expor dados à equipe de A. Além disso, proteger `session_group_id` contra UPDATE direto de quem não é service_role/`duplicate_event_session` (mesmo padrão dos triggers `protect_*`).

## O que muda (levantamento completo, conferido no banco em 2026-09-25)

**SQL (policies e funções vivas que usam `team_event_id`):**
- Funções: `get_team_event_id`, `is_team_member_of_event`, `caller_can_checkin_teammate`, `protect_profiles_privileged_columns` (essa só protege a coluna, provavelmente não muda).
- Policies em `events` (`team_reads_linked_event`, `team_updates_linked_event`), `audience_tickets` (`team_reads_linked_audience_tickets`, `team_updates_linked_audience_tickets`), `workshop_registrations` (`team_reads_linked_workshop_registrations`, `team_updates_linked_workshop_registrations`), `stage_timings` (`equipe_marcacao_palco_inserts_timings`, faz `caller.team_event_id = e.id` direto), `profiles` (`authenticated_reads_team_profiles`, `equipe_checkin_updates_teammate_profile`).
- Estratégia: criar `team_event_ids(uid) RETURNS uuid[]` (SECURITY DEFINER, STABLE) e trocar `= get_team_event_id(auth.uid())` por `= ANY(team_event_ids(auth.uid()))`; `is_team_member_of_event(p_event_id)` passa a usar a mesma lista; a policy de `stage_timings` e as de `profiles` precisam de reescrita própria. Cuidado com recursão de RLS em `profiles` (incidentes 2026-07 e 2026-08-03: usar funções SECURITY DEFINER, nunca subselect em `profiles` dentro de policy de `profiles`).
- Migration idempotente (`DROP POLICY IF EXISTS` antes), aplicar via `npx supabase db query --linked --file`, smoke em `BEGIN/ROLLBACK`.

**Edge functions (comparação `profile.team_event_id === event_id`):**
- `create-pdv-ticket` (linha ~169), `delete-registration` (linha ~80): trocar por checagem "event_id ∈ eventos do grupo". Criar helper em `_shared/` (ex.: `team-access.ts` com `teamEventIds(supabase, userId)` chamando o RPC) para as duas.
- `manage-team-member`, `promote-to-organizer`, `apply-team-invite`: só leem/gravam `team_event_id` do próprio vínculo; provavelmente sem mudança (conferir `manage-team-member` linha ~67: checa se o produtor é dono do evento do membro; com grupo, dono de qualquer sessão do grupo já basta, pois `created_by` é o mesmo).
- `revoke-expired-team-access`: expira pela data do evento vinculado + `equipe_access_days_after`. **Decisão pendente:** com grupo, expirar pela ÚLTIMA sessão do grupo (recomendado, senão o operador perde acesso às sessões que ainda vão acontecer).

**Frontend:**
- `services/supabase.ts:357` (`resolveActiveEventId`), `pages/Schedule.tsx:764-783` e `pages/StageMarker.tsx:105-113` montam a lista de eventos com `id.eq.<team_event_id>`; trocar por "todos os eventos do grupo" (RPC/`in`).
- `VendasIngressos.tsx` lista `allEvents` só por `created_by = user.id`: o operador precisa ver o seletor com as sessões do grupo (o `EventPickerSheet` já acrescenta data/hora quando o nome se repete). Auditar as demais telas com `EventPickerSheet` acessíveis a equipe (Registrations, CheckIn, Credenciais…).
- Menu/permissões (`permMenu.ts`, `RequirePermission`) não mudam.

## Validação (sandbox, alvo travado)

1. Smoke SQL `BEGIN/ROLLBACK`: perfil de teste com `team_event_id` = sessão 2 enxerga/atualiza `audience_tickets` das sessões 2, 3, 4, 5; NÃO enxerga evento de outro produtor nem evento do mesmo produtor fora do grupo; produtor B não consegue puxar evento próprio para o grupo do produtor A.
2. Operador real por magic link (`teste.comprador@coreohub.com`, conta de teste; vincular via SQL como service e REVERTER no fim — `role='STAFF'`, `permissoes_custom={"vendas_ingressos":true,"checkin_ingressos":true}`): PDV vende na sessão 3 e 5 (antes recusado), seletor mostra as 5 sessões, check-in por QR em sessão irmã, NÃO acessa eventos reais (Usualdance etc.).
3. Regressão: operador vinculado a evento SEM grupo continua igual (acesso só ao próprio evento); revogação (`manage-team-member` e cron) ainda derruba o acesso de todas as sessões.
4. Baseline de produção antes/depois (comm 49, pay 21, regs 125, eventos reais 6, tickets reais 0 em 2026-09-25 — reconferir na hora).

## Riscos e cuidados

- É RLS de tabelas sensíveis (`events`, `audience_tickets`, `profiles`): mudança errada vaza dado entre produtores. Fazer smoke com 2 produtores + 1 operador antes de aplicar em produção; nunca em evento real (só leitura).
- Aplicar a migration ANTES de deployar as edge functions (as functions usam o RPC novo). Deploy de function de pagamento (`create-pdv-ticket`) só com evento real sem venda no dia, conferir calendário (Extreme 26/09, Tamoios 17/10).
- Equipe atual em produção: 0 membros vinculados (2026-09-25), então não há operador real a quebrar.

## Prompt para colar na sessão nova

```
Continuação (CoreoHub, 2026-09-25): implementar o PLANO C — equipe por grupo de sessões.
Leia: CLAUDE.md, memory/_operating_manual.md, memory/session_resume.md, docs/plano-equipe-por-grupo-de-sessoes.md
(plano + levantamento completo), memory/sessoes_mesmo_local_etapa4_2026_09_25.md e
memory/fase3_testes_sandbox_sessoes_2026_09_25.md (como logar como operador de teste por magic link).
Fluxo: apresente o plano em 3-5 bullets e aguarde meu OK; PT-BR; "a CoreoHub" feminino; branch dev, merge em main só quando eu pedir;
nunca git add -A (há arquivos meus não commitados: Eventos/, docs/mercado-tam-sam-som.md e o que mais aparecer em git status);
o claude-mem está sem cota: registre memória manualmente (memory/ + MEMORY.md); novas entradas de histórico no TOPO de docs/HISTORICO.md, nunca no CLAUDE.md.
Regras de segurança: evento real = só leitura; testes só no sandbox (evento 41d933c9-76e2-41fe-93bd-cebbee3fa25d e sessões irmãs, slugs teste-sandbox-espetaculo-*);
conta de teste operador: teste.comprador@coreohub.com (vincular e REVERTER); produtor de teste: teste.produtor@coreohub.com.
Decisão pendente para eu confirmar antes: o acesso da equipe expira pela ÚLTIMA sessão do grupo?
```
