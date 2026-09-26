# Pauta de consulta com advogado — ingressos, Termo do Produtor e privacidade

**Para quem é:** advogado(a) de direito do consumidor / plataformas / LGPD que vai revisar o Termo do Produtor v1.7 e a Política de Privacidade da CoreoHub. **Como usar:** enviar junto os documentos listados no fim. Nada aqui é parecer; são perguntas para fechar pontos que a pesquisa por IA deixou em aberto.

## O que é a CoreoHub (resumo de 5 linhas)
Plataforma brasileira (SaaS/marketplace) de gestão de festivais e espetáculos de dança. Sem mensalidade; comissão de 10% (configurável) sobre as vendas, cobrada do produtor ou repassada ao comprador como "taxa de serviço". Pagamentos pela Asaas (subconta white label por produtor, split automático, repasse com retenção de 7 dias). Vende ingressos de plateia (assento numerado, meia-entrada, PCD), com transferência gratuita, crédito e arrependimento pelo próprio site. O produtor é pequeno/médio (escolas de dança, festivais).

## Perguntas prioritárias (com o que já sabemos)
1. **O produtor pode ser tratado como consumidor?** (CDC art. 51 e teoria da vulnerabilidade) Se sim, as cláusulas de desconto/regresso e multa precisam de outro tratamento. Pesquisa: não achamos jurisprudência.
2. **Regresso e débito automático.** A cláusula 4-quater (desconto do saldo, dos repasses do evento e, opcionalmente, de outros eventos do mesmo produtor) é válida e exequível? O desconto "de outros eventos" e de CNPJs relacionados é proporcional? (A Sympla usa; parece arriscado.)
3. **Cobrar do produtor** (a) o custo de processamento que a Asaas não devolve no estorno e (b) a comissão de evento que não aconteceu. Isso é lícito perante o art. 20-22 do Decreto 13.108 (que protege o consumidor) ou vira cláusula penal desproporcional (CC 412/413)?
4. **Reposição de saldo.** Prazo de 10 dias corridos, suspensão de vendas desde o aviso, multa de 2% + juros de 1% ao mês + IPCA, protesto/negativação após notificação: esse pacote é seguro? Quais requisitos para protesto/negativação? O aceite eletrônico do Termo serve como título executivo (CPC 784)?
5. **Definição de "alteração relevante"** (arts. 20-22 do decreto não definem). A definição proposta (data, horário, local, atração principal, formato) serve?
6. **Retenção de dados.** 5 anos com acesso restrito para dados pessoais de compra e de transferência (2 anos por obrigação legal + o restante por exercício regular de direitos), depois anonimizar; IP por 6 meses. É proporcional? O IP da transferência é "registro de acesso a aplicações" (Marco Civil art. 15)? Como registrar a base legal na política?
7. **Papéis LGPD** entre CoreoHub e produtor (controlador/operador ou controladores conjuntos) para os dados dos compradores e dos titulares de ingresso.
8. **Arrependimento.** Adotamos 7 dias corridos do pagamento e até o início do evento, sem o corte de "48 h antes". Correto? Devolução integral da taxa de serviço: confirmar. (O Procon-MG multou a Sympla em fev/2026 por reter a taxa.)
9. **Transferência de meia-entrada e de assento PCD.** Exigir comprovação do novo titular na portaria (meia) e apenas avisar (PCD) está adequado?
10. **Reaceite do Termo.** Exigir novo aceite antes da próxima ação relevante (criar evento, receber pagamento) e manter a versão antiga em eventos com vendas abertas é defensável?
11. **Perante o consumidor**, confirmar que a CoreoHub responde solidariamente (Decreto 13.108 art. 4º §1º; STJ REsp 1.985.198) e que não pode recusar restituição por culpa do produtor.
12. **Cota de 40% da meia-entrada e "ingresso promocional":** como documentar o cálculo e o que conta como promocional?

## Já decidido pelo produtor (não precisa reabrir, salvo risco)
- Transferência gratuita ingresso a ingresso, sem limite, com antiabuso por IP.
- Arrependimento de 7 dias sem corte de 48 h.
- Limite de 1 meia por CPF do comprador, com exceção de PCD e acompanhante (tipos próprios de ingresso).
- Crédito de sessão com saldo e validade de 12 meses (validade escolhida pela CoreoHub, sem base legal específica; validar).

## Documentos para anexar
- `docs/termo-produtor-v1.7-rascunho.md` (proposta de cláusulas, com pontos marcados [ADVOGADO])
- `docs/pesquisa-juridica-decreto-13108.md` e `docs/pesquisa-juridica-termo-produtor-regresso-prazo-retencao.md` (pesquisas por IA, com fontes e o que não foi verificado)
- Termo do Produtor v1.6 atual (`pages/TermoProdutor.tsx`), Termos de Uso e Política de Privacidade atuais
- `docs/retencao-dados-ingressos.md` (o que é guardado e por quanto tempo)
