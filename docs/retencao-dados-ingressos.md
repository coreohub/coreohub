# Guarda de dados de ingressos (Decreto 13.108/2026, art. 15 e arts. 17-18)

Situação em 2026-09-25. Levantamento do que a plataforma guarda hoje e o que foi feito.

| Dado | Onde | Prazo exigido | Situação |
|---|---|---|---|
| Vendas desagregadas, por categoria e transação, sem dado pessoal | `audience_tickets` (preço, taxa, tipo, status, método, datas, estorno) | 2 anos | Guardado. Exportação sem dado pessoal: RPC `export_audience_sales_anonymized` (botão "Dados sem identificação" em Vendas de ingressos; vale para dono do evento e super admin). |
| Ingresso com movimento (aprovado, estornado, crédito, cortesia) | `audience_tickets` | 2 anos | Trava de exclusão no banco (`audience_tickets_retention_guard`, migration `20260930g`): não apaga antes de 2 anos. Sandbox, demo e ingressos sem venda concluída continuam apagáveis. `delete-event` já bloqueia evento com ingresso. |
| Histórico de titulares por ingresso, com data e hora | `audience_ticket_transfers` | 2 anos (mínimo) | Guardado (migration `20260930f`); só apaga junto com o ingresso, que agora tem a trava acima. Anonimizado aos 5 anos; IP zerado aos 6 meses (ver abaixo). |
| Reserva temporária (preço, taxa e validade travados) | `audience_price_quotes` | Auditabilidade do art. 13 | Guardado, sem rotina de expurgo (a tabela só cresce). |
| Relatório de meia | `get_meia_report` (calculado sobre `audience_tickets`) | Publicar em até 30 dias do evento | Publicado automaticamente desde o dia seguinte ao fim do evento, sem prazo para sair. |

## Rotina de retenção (migration `20260930h`, aplicada em 2026-09-26)
Proposta da pesquisa jurídica `docs/pesquisa-juridica-termo-produtor-regresso-prazo-retencao.md` (confiança média, advogado a validar). Função `apply_ticket_data_retention(p_dry_run)` + job diário `ticket-data-retention-daily` (03:30 de Brasília):
- **IP da transferência:** vira NULL depois de **6 meses** (Marco Civil, art. 15).
- **Dados pessoais de compra e transferência** (nome, e-mail, CPF, telefone; titulares anterior e novo): **anonimizados depois de 5 anos**. Os dados desagregados de venda (preço, tipo, status, datas, taxa) ficam.
- Idempotente; `select * from apply_ticket_data_retention(true)` só conta. Hoje o resultado é 0/0/0 (nenhum dado tão antigo). Testado em transação com dados antigos e recentes (rollback).
- **Cuidado:** a rotina não sabe de processo em andamento. Se houver disputa envolvendo ingresso com mais de 5 anos, suspender o job (`select cron.unschedule('ticket-data-retention-daily')`) antes.
- Os prazos (6 meses e 5 anos) estão escritos na função; mudar exige nova migration.

## Ainda pendente (decisão ou trabalho)
- **Validar os 5 anos com advogado** (proporcionalidade) e se o IP é "registro de acesso".
- **Purga de `audience_price_quotes`:** definir prazo (2 anos) com o mesmo critério.
- **Exclusão em cascata:** `audience_tickets.event_id` apaga junto com o evento (`ON DELETE CASCADE`), mas `events.created_by` referencia `profiles(id)` sem cascata: não existe caminho no app nem no banco que apague um evento com venda por exclusão de conta (só `delete-event`, que já bloqueia evento com ingresso, e a limpeza de demo). Conferido em 2026-09-25.
