# Termo do Produtor v1.7 — PROPOSTA PARA REVISÃO (não aplicada)

> **Numeração final (2026-09-26):** o Termo publicado usa numeração sequencial (como as plataformas brasileiras), não "4-ter" etc. Correspondência deste rascunho → Termo: 4-bis→5, 4-ter→6, 4-quater→7, 4-quinquies→8, 4-sexies→9, 4-septies→10; cláusulas antigas 5→11, 6→12, 7→13, 8→14, 9→15, 10→16, 11→17, 12→18. **A fonte do texto é `pages/TermoProdutor.tsx`.**

**Status:** rascunho de texto. `TERMO_PRODUTOR_VERSION` continua em 1.6 e `pages/TermoProdutor.tsx` NÃO foi alterado. Subir a versão obriga todos os produtores a reaceitar. Base: `docs/pesquisa-juridica-termo-produtor-regresso-prazo-retencao.md` e `docs/pesquisa-juridica-decreto-13108.md` (pesquisa por IA, sem advogado: **não é parecer**). Versão anterior deste rascunho (2026-09-25) foi substituída por esta.

**Regra de trabalho:** nada aqui vira texto final sem o produtor aprovar; revisão de advogado recomendada, especialmente onde marcado **[ADVOGADO]**.

## ⚠️ Antes de publicar: o produto ainda não faz o que estas cláusulas prometem
| Promessa da cláusula | Situação hoje |
|---|---|
| Extrato por ingresso enviado ao produtor antes do desconto | Não existe |
| Contestação em 5 dias e prestação de contas | Não existe |
| Ordem de desconto (saldo → repasses do evento → outros eventos) | Não existe: o estorno sai da subconta pela Asaas; o que faltar vira custo da CoreoHub |
| Aviso de saldo insuficiente com PIX/boleto para repor em 10 dias | Não existe |
| Suspender novas vendas e reter repasses desde o aviso | Existe só o bloqueio por taxa de plano (`plan-fee-gate`); não por dívida de estorno |
| Cobrar do produtor o custo de processamento não devolvido | Não existe (hoje a CoreoHub absorve) |
| Publicação automática do relatório de meia; exportação sem dados pessoais | **Existe** (em produção) |
| Guarda mínima de 2 anos e histórico de transferência | **Existe** (trava no banco + tabela de auditoria) |
| IP da transferência guardado só 6 meses; dado pessoal 5 anos | IP: rotina proposta no passo 2; 5 anos: rotina proposta no passo 2 |

Recomendação: publicar as cláusulas 4-ter e 4-sexies (só o que já existe) primeiro; as de regresso/reposição (4-quater e 4-quinquies) só depois de construir o livro de débitos (item 4 da lista de próximos passos).

---

## 4-ter. Venda de ingressos ao público (Decreto nº 13.108/2026)

4-ter.1. Nas vendas de ingressos feitas pela Plataforma, o Produtor reconhece que a CoreoHub atua como comercializadora primária e cumpre, no ambiente de venda, as regras do Decreto nº 13.108/2026: preço e taxa de serviço discriminados desde a oferta; reserva temporária de lugares com preço e taxa travados; informação dos totais e da quantidade de meia-entrada; transferência gratuita de titularidade; canal de arrependimento.

4-ter.2. O Produtor define corretamente cada tipo de ingresso. Meia-entrada é a prevista em lei (estudante, pessoa com deficiência e acompanhante, jovem de baixa renda, idoso). Cupom, convênio, ingresso solidário e lote promocional são "promocionais" e devem ser marcados como tal no cadastro, porque não entram na cota de 40% da meia-entrada.

4-ter.3. O Produtor confere, na portaria, o documento que comprova o direito à meia-entrada e cobra a diferença de quem não comprovar. Se o ingresso for transferido, a comprovação passa a ser exigida do novo titular.

## 4-quater. Cancelamento, adiamento ou alteração relevante do evento (destaque)

4-quater.1. Se o Produtor cancelar, adiar ou alterar de forma relevante o evento ou a sessão (data, horário, local, atração principal ou formato, ou outra mudança que reduza o que foi anunciado na compra), deve registrar a mudança na Plataforma, que avisará os compradores. O comprador escolhe entre manter o ingresso na nova data, receber crédito ou ser reembolsado. A CoreoHub devolve ao comprador **o valor total pago, incluindo a taxa de serviço**, como a lei exige (arts. 20 a 22 do Decreto nº 13.108/2026). **[ADVOGADO: definição de "alteração relevante"]**

4-quater.2. O Produtor reembolsa a CoreoHub por tudo que ela devolver ao comprador por esse motivo, inclusive valores que o Produtor já recebeu e o **custo de processamento do pagamento que o parceiro financeiro não devolver**, com o valor de cada custo demonstrado. A CoreoHub não cobra multa por isso. **[ADVOGADO: repassar o custo de processamento; cobrar comissão de evento que não ocorreu]**

4-quater.3. O Produtor **autoriza expressamente** a CoreoHub a descontar esse valor, nesta ordem: (a) do saldo da sua conta na Plataforma; (b) dos repasses futuros do mesmo evento; (c) **[decisão do produtor + ADVOGADO: dos repasses de outros eventos do mesmo Produtor, se ainda faltar]**.

4-quater.4. Antes do desconto, a CoreoHub envia por e-mail o **extrato** com cada ingresso devolvido, o valor e o motivo. O Produtor pode contestar por escrito em até **5 dias**; enquanto a contestação é analisada, o valor contestado não é descontado, salvo o que já foi devolvido ao comprador.

4-quater.5. Depois do desconto, a CoreoHub presta contas por e-mail e devolve qualquer excesso.

## 4-quinquies. Reposição de saldo (destaque)

4-quinquies.1. Se, ao devolver dinheiro ao comprador por causa do evento do Produtor, o saldo da conta dele não for suficiente, a CoreoHub avisa por e-mail com o extrato do valor devido.

4-quinquies.2. O Produtor repõe o valor em até **10 dias corridos** do aviso, por PIX ou boleto gerado pela CoreoHub.

4-quinquies.3. **Desde o aviso**, a CoreoHub pode suspender novas vendas e novos eventos e reter os repasses futuros até o valor ser coberto. Isso não gera multa.

4-quinquies.4. Vencido o prazo sem pagamento, o valor tem **correção pelo IPCA, juros de 1% ao mês e multa de 2%**, contados do vencimento.

4-quinquies.5. Depois de aviso por escrito com prazo adicional de 10 dias, a CoreoHub pode cobrar por meios extrajudiciais e judiciais e, cumpridos os requisitos legais, registrar a dívida em cadastro de inadimplentes e protestá-la. **[ADVOGADO: procedimento de protesto/negativação; título executivo]**

Motivo do prazo curto (para o produtor entender): pelos Termos da Asaas (cláusulas 5.1.4 e 5.1.5), a CoreoHub, como conta principal, responde pelo saldo negativo das subcontas. Referência de mercado verificada: a Sympla dá 10 dias úteis (cl. 10.10.1).

## 4-sexies. Relatório de meia-entrada e guarda de dados

4-sexies.1. Encerrado o evento, a Plataforma publica automaticamente, na página do evento, o relatório da venda com o total de ingressos vendidos, a quantidade e o percentual de meia-entrada, sem dados pessoais. O Produtor autoriza essa publicação, que também atende ao dever de manter o relatório da venda (Decreto nº 8.537/2015, art. 12).

4-sexies.2. A CoreoHub guarda por, no mínimo, dois anos os dados desagregados de venda (por categoria e transação, sem dados pessoais) e o histórico de transferência de titularidade de cada ingresso, e pode disponibilizá-los aos órgãos do Sistema Nacional de Defesa do Consumidor mediante requisição fundamentada. O Produtor pode exportar os dados desagregados do seu evento pelo painel.

4-sexies.3. Os dados pessoais de compras e transferências são guardados por até **5 anos** com acesso restrito (obrigação legal e defesa em reclamações e processos) e, depois, eliminados ou anonimizados; o IP registrado na transferência é guardado por **6 meses**. **[ADVOGADO: proporcionalidade dos 5 anos; se o IP é "registro de acesso" do Marco Civil]**

4-sexies.4. Ingressos com venda concluída não são excluídos antes desse prazo, ainda que o Produtor peça a exclusão do evento.

## 4-septies. Arrependimento do comprador

4-septies.1. O comprador pode desistir da compra em até 7 dias corridos do pagamento e até o início do evento, com devolução integral, incluindo a taxa de serviço (CDC, art. 49; Decreto nº 13.108/2026, art. 16). A CoreoHub processa a devolução pela Plataforma.

4-septies.2. O valor devolvido é descontado do repasse do Produtor. Como o prazo de arrependimento coincide com a janela de retenção de 7 dias dos repasses (cláusula 6), em regra o valor ainda está retido e não gera saldo negativo.

## Ajuste no aceite (rodapé do Termo)
Incluir na lista de cláusulas destacadas: 4-ter.2 (marcar corretamente meia-entrada e promocional), 4-quater (regresso e desconto), 4-quinquies (reposição de saldo) e 4-sexies (relatório e guarda de dados).

## Estratégia de reaceite (proposta, confiança baixa) **[ADVOGADO]**
Exigir o novo aceite **antes da próxima ação relevante** (criar evento, receber pagamento) em vez de reaceite imediato de todos, mantendo a versão anterior nos eventos com vendas já abertas, e guardar prova do aceite (data, hora, versão e IP).

## Pontos que precisam de advogado (resumo)
1. O produtor pode ser tratado como consumidor (CDC art. 51)?
2. Cobrar comissão de evento cancelado e repassar o custo de processamento.
3. Alcance do desconto a outros eventos e CNPJs relacionados.
4. Procedimento de protesto e negativação; teto de multa entre empresas.
5. Definição de "alteração relevante".
6. 5 anos de retenção é proporcional? IP é "registro de acesso"?
7. Estratégia de reaceite do Termo.
