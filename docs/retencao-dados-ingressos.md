# Guarda de dados de ingressos (Decreto 13.108/2026, art. 15 e arts. 17-18)

Situação em 2026-09-25. Levantamento do que a plataforma guarda hoje e o que foi feito.

| Dado | Onde | Prazo exigido | Situação |
|---|---|---|---|
| Vendas desagregadas, por categoria e transação, sem dado pessoal | `audience_tickets` (preço, taxa, tipo, status, método, datas, estorno) | 2 anos | Guardado. Exportação sem dado pessoal: RPC `export_audience_sales_anonymized` (botão "Dados sem identificação" em Vendas de ingressos; vale para dono do evento e super admin). |
| Ingresso com movimento (aprovado, estornado, crédito, cortesia) | `audience_tickets` | 2 anos | Trava de exclusão no banco (`audience_tickets_retention_guard`, migration `20260930g`): não apaga antes de 2 anos. Sandbox, demo e ingressos sem venda concluída continuam apagáveis. `delete-event` já bloqueia evento com ingresso. |
| Histórico de titulares por ingresso, com data e hora | `audience_ticket_transfers` | 2 anos | Guardado (migration `20260930f`); só apaga junto com o ingresso, que agora tem a trava acima. |
| Reserva temporária (preço, taxa e validade travados) | `audience_price_quotes` | Auditabilidade do art. 13 | Guardado, sem rotina de expurgo (a tabela só cresce). |
| Relatório de meia | `get_meia_report` (calculado sobre `audience_tickets`) | Publicar em até 30 dias do evento | Publicado automaticamente desde o dia seguinte ao fim do evento, sem prazo para sair. |

## Não feito (decisão pendente)
- **Eliminação/anonimização depois do prazo:** nenhuma rotina apaga ou anonimiza dado pessoal (nome, e-mail, CPF do comprador e dos titulares) após 2 anos. A LGPD pede eliminar ao fim da finalidade, mas o relatório jurídico sugere manter 5 anos por defesa de direitos (prescrição do CDC). Decidir com advogado antes de criar a rotina.
- **Exclusão em cascata:** `audience_tickets.event_id` apaga junto com o evento (`ON DELETE CASCADE`). Qualquer caminho que apague um evento com venda com menos de 2 anos (por exemplo, exclusão da conta do produtor, se ela apagar eventos) agora falha no banco pela guarda legal. Verificar esse fluxo e, se existir, anonimizar em vez de apagar.
- **Purga de `audience_price_quotes`:** definir prazo (2 anos) com o mesmo critério.
- **Logs de acesso/IP:** o decreto não os exige; `audience_ticket_transfers.ip` guarda o IP da transferência como antiabuso. Confirmar o prazo com o advogado.
