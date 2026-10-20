# Pesquisa: parcelamento no cartão e recebimento do produtor

Data: 2026-10-04. Somente pesquisa: nenhum código, migration, deploy, commit ou dado foi alterado. Pesquisa feita por IA (Claude), não é parecer jurídico. Não commitar.

Legenda de confiança: alta = texto primário lido nesta sessão; média = resumo de busca de página oficial, segunda fonte séria ou "regra prática" do Ian; baixa = blog, revenda ou inferência minha. "Não verifiquei" significa exatamente isso.

Como li as fontes: docs da Asaas pelo `.md` de cada página (`docs.asaas.com/docs/<slug>.md`) e central da Asaas pela API Zendesk (`central.ajuda.asaas.com/api/v2/help_center/pt-br/articles/<id>.json`, que contorna o 403). Três subagentes pesquisaram PSPs, Pix parcelado/BNPL e ticketeiras; o que eles trouxeram vem de resumo de busca em boa parte e está marcado.

---

## 1. Resumo executivo

1. **Ninguém no mercado de ingressos que li faz o produtor receber parcela a parcela como regra.** Sympla, Even3, Mercado Pago e o parcelado "emissor" (Cielo/Stone) pagam o total de uma vez; todos financiam com caixa próprio ou com custo repassado. A CoreoHub não tem caixa, então a pergunta real é quem paga a antecipação e com que dinheiro.
2. **A única rota já integrada que não exige caixa da CoreoHub é antecipar na Asaas** (1,15% a.m. automática / 1,25% manual no cartão à vista; 1,6% / 1,7% no parcelado; crédito em até 2 dias úteis). Custo medido para o produtor (cenário B): 3x = 3,3% a 3,5% do valor; 6x = 5,9% a 6,2%; 12x = 11,0% a 11,7% (R$ 76 a R$ 81 em R$ 697; R$ 175 a R$ 186 em R$ 1.597). Em 12x o custo passa da comissão de 5%.
3. **Achado novo e crítico:** a central da Asaas diz que a antecipação não vale para cobrança "gerada com a opção Pergunte ao cliente". O Ian confirmou que isso "costuma corresponder a `billingType: UNDEFINED`", que é o que o checkout usa hoje. Ou seja, a fatura de hoje provavelmente nem é elegível à antecipação. Parcelar com antecipação exige criar a cobrança como `CREDIT_CARD` + `installmentCount` (a CoreoHub precisa perguntar a forma antes, o que o P3 já faz).
3b. **Limite de 90 dias por parcela** (doc oficial + Ian): em 12x, as parcelas além da janela ficam de fora e só são antecipadas quando entram nela. Antecipar "tudo de uma vez" só funciona de forma segura em 2x ou 3x.
4. **A doc oficial de split em cobrança antecipada diz** que o split é validado/calculado sobre o líquido final após a taxa de antecipação, que o `fixedValue` precisa caber nesse líquido e que, se estourar, o valor bloqueia por 2 dias úteis. O Ian respondeu de forma mais cautelosa (não presumir D+2 para a subconta; a taxa sai de quem antecipa). **Quem paga a taxa quando a principal antecipa e o split é fixo para a subconta continua sem resposta oficial.** É o ponto que decide se a rota é viável.
5. **Se a CoreoHub repassar o custo ao comprador sem margem (cenário C):** 3x = +4,1% sobre o valor à vista (R$ 748,35 em R$ 697 contra R$ 718,99 à vista; juros efetivo 2,0% a.m.), 6x = +7,0% (R$ 769,49), 12x = +14,1% (R$ 820,35). A Sympla, medida em tela em 03/10, cobra juros efetivos de 3,5% a.m. (3x +7,0%; 6x +12,5%; 10x +20,2%). Ou seja, o custo exato fica abaixo da Sympla.
6. **Rotas sem juros e sem financiamento existem:** boleto parcelado (até 60x, com QR Pix no boleto) ou sinal + saldo em cobranças Pix separadas. O produtor recebe cada uma quando paga e assume a inadimplência. Custo R$ 1,99 por cobrança. Não achei nenhuma ticketeira BR que ofereça isso como produto.
7. **Regulatório:** se houver juros ao comprador, o CDC art. 52 exige destacar preço à vista, juros, taxa efetiva anual, número e periodicidade das parcelas e soma total; embutir o custo no preço e chamar de "sem juros" é exatamente o "parcelado sem juros pirata" que a Senacon notificou em 2024. Há também um risco que nenhuma rodada anterior tratou (Lei da Usura para quem não é instituição financeira, seção 6).
8. **Recomendação:** para o Vicenza, tentar a rota "cartão até 3x + antecipação automática na conta principal + custo ao comprador sem margem", mas só depois de a Asaas responder por escrito os pontos da seção 8. Enquanto isso, manter 1x e oferecer boleto/Pix em etapas se a Lorrayne precisar de parcelamento já. Para ingresso barato, não parcelar.

---

## 2. Asaas, a fundo (item 1)

### 2.1 Link de pagamento e Checkout hospedado (item 1a)
- **Link de pagamento** (`docs.asaas.com/docs/link-de-pagamentos`, lido): tem `chargeType` DETACHED/INSTALLMENT/RECURRENT e deixa o pagador escolher parcelas, mas a doc diz que o **split só existe via API de cobrança**, não no link. Não serve para a CoreoHub.
- **Asaas Checkout** (`POST /v3/checkouts`, `docs/checkout-para-cartão-de-crédito.md`, lido): página hospedada pela Asaas; aceita só `PIX` e `CREDIT_CARD`; `chargeTypes` DETACHED e/ou INSTALLMENT; `installment.maxInstallmentCount` de 1 a 21; **aceita `splits`** (`docs/checkout-com-split-de-pagamento.md`); eventos `CHECKOUT_PAID`/`CHECKOUT_CANCELED`/`CHECKOUT_EXPIRED` e `PAYMENT_SPLIT_DONE` por split. A criação não confirma pagamento. É o único caminho documentado em que o comprador escolhe o número de parcelas dentro da Asaas. A doc não diz como o Checkout liquida: como `INSTALLMENT` cria parcelamento, a inferência (média) é que cada parcela liquida no seu prazo, igual ao parcelamento comum.
- Cobrança avulsa `UNDEFINED` com `maxInstallmentCount`: aceita e ignora (provado no sandbox na 23ª rodada); não há seletor de parcelas na fatura (32ª rodada).

### 2.2 Liquidação e antecipação (item 1b)
- Cartão parcelado: "a compensação também ocorre parceladamente"; sandbox 3x creditou 05/11, 07/12 e 08/01 (28ª e 27ª rodadas).
- Antecipação (docs `antecipacoes`, `split-em-cobrancas-antecipadas`; central; página de preços):
  - API manual: `POST /v3/anticipations/simulate` e `POST /v3/anticipations`; "parcelamento no cartão pode ser antecipado integralmente ou por parcela"; usar `installment` para o parcelamento inteiro.
  - **Automática por API:** `GET/PUT /v3/anticipations/configurations` com `creditCardAutomaticEnabled`. "A ativação não garante a antecipação de todas as cobranças; a execução continua sujeita às regras de elegibilidade e ao valor disponível" e, quando o valor disponível se esgota, novas cobranças deixam de ser antecipadas até haver limite de novo. Existe um **limite de antecipação** por conta (menu "Simular antecipação").
  - Taxas (página de preços): cartão a partir de 1,25% a.m.; automática 1,15%; boleto 5,79%. Promoção: ativar a automática dá 0,10 p.p. de desconto (Regulamento, central). Taxas parceladas 1,6%/1,7% vêm da rodada 4 (painel da master).
  - Elegibilidade (central, atualizada 03/10/2026): cadastro aprovado; selfie aprovada OU primeira transferência externa concluída; pagador com nome e CPF/CNPJ; vencimento com pelo menos 8 dias úteis (para parcelado, 8 dias úteis antes do vencimento da última parcela); **pagador diferente do titular da conta**; **cobrança não pode ter sido gerada com "Pergunte ao cliente"**; pagamento definido como cartão. Página institucional diz janela de 8 dias úteis a 90 dias e carência de 45 dias (PJ) / 90 dias (PF) após a primeira transferência. **As duas fontes divergem** (a central de 03/10 não menciona dias de carência); o Ian disse que a carência tende a valer para a subconta.
  - Crédito: "em até 2 dias úteis", "sujeita a análise de crédito, perfil cadastral e condições gerais". O valor creditado é o total menos taxa de cobrança, taxa de antecipação e descontos; se o cliente não pagar, o valor devido é debitado do saldo.
  - Estorno/chargeback após antecipação: o Termo Aditivo (lido na 4ª rodada) prevê recompra pelo cedente com multa de 2% e juros de 4% a.m., cessão fiduciária de 100% da conta e coobrigação solidária. Quem assina é o titular da conta que antecipa.
- **Split em cobrança antecipada** (`split-em-cobrancas-antecipadas.md`, lido): o split é calculado sobre o líquido final pós-antecipação; `fixedValue` tem de caber nesse líquido; bloqueio de 2 dias úteis em divergência; "na antecipação automática com split fixo definido na emissão, o cálculo considera a **maior taxa aplicável ao cartão utilizado**". Cobranças dadas em garantia de crédito não executam split.

### 2.3 ISVs que usam Asaas (item 1c)
- **Doity** (ajuda "Principais dúvidas sobre o Asaas", lida): cartão 14 dias + 1 dia útil para contas verificadas (32 dias abaixo de R$ 6); Pix na hora; boleto no dia; "recebimento no fluxo" até 6x sem juros só sob pedido e aprovação; custos de processamento dentro dos 10%. O prazo de 14+1 é diferente do D+32 da Asaas pública: **inferência (média)** de que ISV pode ter condição negociada. Pergunta para a Asaas.
- **InPeace** (plataforma para igrejas; ajuda lida): até 12x; "com antecipação (D+2) o valor parcelado será recebido à vista" a 1% a 1,05% a.m.; a igreja escolhe se repassa a taxa ao comprador. Não dá para saber se é conta do próprio organizador ou subconta.
- **XTAGE** (rodada anterior): taxa retida do valor pago e o resto repassado à conta Asaas do organizador. **Even3**: não achei uso de Asaas.
- Não achei caso público de ISV white-label com split + parcelado antecipado.

### 2.4 Cartão para ISV e condições (item 1d)
Não achei página pública de condições para ISV/marketplace (taxa reduzida, prazo menor, antecipação em lote). "Regulamento 3 meses de taxas reduzidas" existe (central), sem leitura do conteúdo. Pergunta para o suporte humano (seção 8).

### 2.5 Repasse de taxas (item 1e)
- Painel/simulador (5ª rodada): com "Repassar taxas do cartão" o comprador paga R$ 311,34 em 3x de R$ 300 e o produtor recebe R$ 300,00; central confirma "o valor da taxa será adicionado ao valor total" (só com cartão como única forma).
- **Antecipar cobrança com repasse de taxas é permitido; a antecipação considera apenas o valor original, a taxa repassada não entra** (central 39311400852891, lida). Ou seja, o repasse da Asaas cobre o MDR, não a antecipação. Para a antecipação cair no comprador, a CoreoHub teria de fazer a conta inversa no servidor (cenário C) e criar a cobrança já com o valor final.
- A API de cobrança não tem campo de repasse (rodadas 5 e 18).

### 2.6 Estorno de parcelado (item 1f)
`POST /installments/{id}/refund` (sem `value` = total); com split, "os repasses também são estornados"; cartão: devolução total ou parcial pelo painel, até 5 dias úteis para aparecer na fatura. Sobre parcelas já liquidadas ou antecipadas, a doc é silenciosa. O Ian (rodada 31): o Asaas tende a recompor buscando a parte de cada recebedor que participou; ordem e proporção não são regra formal; sem saldo na subconta o estorno pode falhar.

### 2.7 O que o Ian respondeu hoje (WhatsApp Web, 16:56, "regra prática", não oficial)
Pergunta 1 (texto enviado): "Cobranca de cartao parcelada criada na conta principal com split fixo para uma subconta. Se a principal ativar antecipacao automatica, o split da subconta e liberado na antecipacao (D+2) ou so no credito de cada parcela? E a taxa de antecipacao sai de quem?"
Resposta: "Em regra prática, não presuma que a parte da subconta será liberada toda em D+2 só porque a conta principal ativou a antecipação automática. A tendência é: cada recebedor segue a própria liquidação/antecipação da sua parte; então o split da subconta pode ficar no crédito de cada parcela, salvo se a subconta também estiver apta/habilitada para antecipar. Sobre a taxa, ela tende a sair de quem antecipa/recebe antecipado, ou seja, a principal arca sobre a parte dela, e a subconta só sobre a parte dela se essa parte também entrar na antecipação."
Leitura: contradiz a doc de split antecipado (que calcula o split sobre o líquido pós-antecipação) e sugere que a subconta só recebe antecipado se ela própria antecipar. Sem prova, esse é o ponto que mais pesa.

Pergunta 2 (texto enviado): "A central diz que cobranca gerada com a opcao "Pergunte ao cliente" nao pode ser antecipada. Na API isso e billingType UNDEFINED? E uma cobranca criada com billingType CREDIT_CARD e installmentCount e elegivel?"
Resposta: "Em regra prática, "Pergunte ao cliente" na API costuma corresponder a billingType: UNDEFINED, e esse tipo não deve ser presumido como elegível à antecipação. Já uma cobrança criada com billingType: CREDIT_CARD e parcelamento (installmentCount) tende a ser a candidata correta para antecipação, desde que atenda às regras de elegibilidade da conta/subconta. Se isso for regra crítica, valide no Asaas se toda cobrança CREDIT_CARD parcelada entra na antecipação ou se há filtros adicionais do produto contratado."

Respostas anteriores do Ian (rodadas 30 e 31) seguem valendo: antecipação automática por API em subconta white-label não é presumida; carência tende a valer para a subconta; taxa recai sobre quem antecipa; 90 dias por parcela.

---

## 3. Outros PSPs com split/subconta (item 2)

Subagente de PSPs, mais conferência minha onde indicado. Quase tudo é resumo de busca; nada de contrato.

| PSP | Produtor recebe quando | Quem paga antecipação | Juros ao comprador, produtor líquido cheio? | Exige caixa da plataforma? | Habilitação/carência | Evidência | Confiança |
|---|---|---|---|---|---|---|---|
| Pagar.me | Parcela a parcela (~30, 61, 91 dias); antecipação por recebedor | Quem pede; desconto simples a.m. (2,31% a.m. vem de revenda, não oficial) | Não verifiquei | Não: marketplace define taxa/prazo da antecipação do recebedor | Automática exige autorização do Pagar.me; manual 60 dias transacionando + análise | docs.pagar.me (guia de antecipações; automatic-anticipation-settings) | Alta (liquidação), baixa (2,31%) |
| Mercado Pago | Total de uma vez no prazo da conta (D0/D14/D30 no link) | Vendedor (taxa de parcelamento sem juros e taxa maior por receber antes) | Parcelado "cliente" existe; repasse integral não confirmado | Pela fonte, não | Não verifiquei | Blog oficial via busca (fetch deu 403) | Média |
| Stripe Connect BR | 30 dias (cartão doméstico) | Não verifiquei | Parcelamento no Brasil: doc de Installments não lista o Brasil | Não verifiquei | Não verifiquei | support.stripe.com | Alta (30 dias), baixa (parcelado BR) |
| iugu | Não verifiquei | Antecipação manual/automática; taxas não confirmadas | Não verifiquei | Não verifiquei | Não verifiquei | iugu.com/split-pagamentos | Média |
| Vindi | 30 dias (a partir de 2,75%) ou 14 dias (3,25%) | Quem escolhe o prazo | Não verifiquei | Não verifiquei | Não verifiquei | Resumo de busca | Média-baixa |
| Cielo / Stone | Parcelado lojista: mês a mês; parcelado emissor: total em 30 dias | Lojista paga MDR (lojista) ou antecipação | **Emissor: comprador paga o juro, lojista recebe o total** | Não (o emissor financia) | Stone: 60 dias transacionando | Blogs/centrais via busca | Média |
| Zoop, Rede | Não consegui verificar | | | | | | Baixa / não verificado |

Leitura: o único modelo achado em que o comprador paga o juro e o recebedor recebe o total é o **parcelado emissor** (Cielo/Stone) e o parcelado "cliente" do Mercado Pago (este sem texto oficial). Migrar de PSP para isso é outro projeto (KYC white-label, split, estorno), sem prova de que o ISV tenha acesso. Nenhum PSP trouxe evidência de exigir que a plataforma financie.

---

## 4. Parcelar sem a plataforma financiar (item 3)

| Solução | Comprador parcela até | Juros ao comprador | Produtor recebe quando | Split/subconta | Exige caixa da CoreoHub? | Confiança |
|---|---|---|---|---|---|---|
| Pix Parcelado regulado pelo BCB | Não existe | n/a | n/a | n/a | n/a | Média: regulamentação adiada três vezes, sem nova data; Fórum Pix de mar/2026 disse que cada instituição desenha o seu (segundas fontes) |
| Pix no crédito (bancos) | Varia (blogs citam 18x a 24x) | Sim, definidos pelo banco do comprador | À vista, "como um Pix comum", sem MDR | Não aplicável (é um Pix) | Não | Média/baixa; é recurso do app do banco do comprador, a CoreoHub não controla nem cobra |
| Pagaleve (Pix parcelado) | 4x quinzenal sem juros; até 12x mensal | Multa por atraso | À vista via Pix: D+1 útil; no parcelado "de acordo com o plano contratado" (não garante à vista) | Tem "Split de liquidações", exige cadastro como Marketplace | Não (Pagaleve assume fraude e inadimplência) | Alta (prazo e risco), baixa (taxa e ticket) |
| Koin | Até 12x | "Taxa baixa" | "Lojista recebe à vista" (segunda fonte) | Não verifiquei | Não | Baixa |
| Parcelex | Até 24x | Taxa por consumidor | De 2 a 15 dias ou até 30 dias após aprovação (não é à vista) | Não verifiquei | Não | Alta (prazo) |
| Pix Automático (Asaas) | Não é parcelamento (recorrência com autorização) | Não | Cada Pix quando pago | Não verifiquei | Não | Alta |
| Boleto parcelado Asaas (até 60x; QR Pix no boleto) | Até 60x | Sem juros por padrão (configurável) | Cada boleto quando pago (compensação no dia útil) | Split funciona em parcelamento | Não | Média (doc de WooCommerce descreve o limite; Pix parcelado não existe na Asaas) |
| Sinal + saldo em cobranças Pix separadas | 2 a 3 cobranças | Não | Cada Pix, D+7 na janela de retenção | Sim, cobranças avulsas com split | Não | Alta (é o que a CoreoHub já faz, só repetido); não achei ticketeira BR que ofereça |

Nenhum BNPL tem integração provada com subconta de plataforma. Parcelado "sem juros" do emissor: sem texto primário.

---

## 5. Ticketeiras e plataformas de eventos (item 4)

Já tínhamos Sympla (parcelado de uma vez no prazo do à vista; juros 3,49% a.m. ao comprador; adiantamento até 80% a 3,49%), Even3 (de uma vez em 10 dias; juros 1,79%), Doity, Eventbrite (5 dias úteis após o evento), Bilheteria Digital (4,19% a.m.), Ticketmaster BR (1,99% a.m.). O que o subagente acrescentou:

| Plataforma | Parcelas | Juros | Organizador recebe | Antecipação | Evidência | Confiança |
|---|---|---|---|---|---|---|
| Sympla (adiantamento) | n/d | Sem juros é opção do organizador (absorve) | De uma vez no prazo do à vista | 3,49% sobre o valor pedido, até 80% (20/40/60/80%), mínimo R$ 300 em vendas, pedido até 4 dias antes do evento, evento não privado, crédito em até 1 dia útil se aprovado | ajuda.produtor.sympla.com.br artigo 33630645675149 (resumo de busca) | Média |
| Ticket Sports (inscrições esportivas) | Até 12x | "Juros abaixo da média" (sem número) | Por solicitação no painel, com análise; prazo não publicado | "Dá para negociar", sem taxa | hub.ticketsports.com.br | Alta (12x), baixa (resto) |
| Guichê Web | Depende da bandeira | 1,99% a.m. (resumo de busca do FAQ) | n/d | n/d | ajuda.guicheweb.com.br | Média |
| Ingresse / formaturas | 12x "estendido" | Com juros, comprador paga | Cobrança no cartão após o baile | n/d | pixelsolutions.ingresse.com | Alta, só formaturas |
| Even3 (adiantamento) | n/d | n/d | Pós-evento | "Mediante aprovação", vendas acumuladas acima de R$ 1.000 | Blog de terceiro | Baixa |
| Blueticket | Decisão do organizador | n/d | n/d | n/d | movidesk (resultado de busca) | Média |
| Catraca Virtual | n/d | n/d | 85% imediato por venda, 15% em 7 dias | n/d | blog comparativo | Baixa |
| Hotmart (referência, ticket alto) | 12x | n/d | Antecipação automática em até 30 dias | Taxa publicada | blog Hotmart (resumo) | Média |
| CompetitionSuite / DanceBug (EUA) | n/d | n/d | n/d | n/d | Cobra do organizador US$ 2 a 10 por performance; regulamentos de competições citam depósito + saldo | Alta (preço), média (depósito+saldo) |

Conclusões (só do que as fontes dizem): para ticket alto, o que achei é cartão em 12x com juros ao comprador (Ticket Sports, Guichê Web, Ingresse/formaturas) e decisão do organizador sobre assumir (Sympla, Blueticket). **Não achei ticketeira BR com "payment plan" (sinal + saldo) como produto.** Nenhuma fonte justifica chamar nenhum modelo de padrão. Não verifiquei: Ingresse (prazo exato), Uhuu, Doity (parcelado além do que já tínhamos), Ingresso.com, Eventim, XTAGE, Zig, Minha Inscrição, Sportsplace, parcela mínima de qualquer plataforma.

---

## 6. Regulatório e contábil (item 5)

Não é parecer. O produtor decidiu em 03/10 (19ª rodada) não voltar a listar perguntas para advogado; abaixo ficam só riscos e como cada rota os trata.

- **Sem juros ao comprador** (boleto parcelado, Pix em etapas, parcelado "no fluxo"): fora do CDC art. 52. Risco só de informação.
- **Com juros ao comprador (cenário C):**
  - **CDC art. 52** (Planalto, lido): quando há "outorga de crédito ou concessão de financiamento", informar prévia e adequadamente preço em moeda corrente, montante dos juros e **taxa efetiva anual**, acréscimos, número e periodicidade das prestações e soma total a pagar com e sem financiamento. §1 limita multa de mora a 2%; §2 assegura liquidação antecipada com redução proporcional dos juros. Para a CoreoHub: mostrar "à vista R$ X ou 3x de R$ Y (total R$ Z, juros 2,03% a.m. / 27,3% a.a.)". O §2 é de difícil aplicação em parcela de cartão (quem controla é o emissor); fica como ponto aberto.
  - **Senacon, janeiro de 2024** (notícias de Agência Gov/InfoMoney/Agência Brasil; a nota técnica em si exige login): acolheu denúncia da Febraban contra PagBank, Mercado Pago, Stone e PicPay por "parcelado sem juros pirata", ou seja, embutir acréscimo no preço e registrar como "sem juros". Desfecho: não verifiquei. Lição: o custo do parcelado nunca pode ir escondido no preço; destacar como "taxa de parcelamento/juros".
  - **Decreto 13.108 art. 7**: em ingresso de plateia, a linha precisa estar discriminada desde a publicidade até o fim da compra. Vale para o juro do parcelado; para passe/inscrição, CDC e Decreto 7.962 art. 2º IV.
  - **Lei 13.455/2017**: autoriza preço diferente por prazo ou instrumento de pagamento, desde que informado (já usada nas pesquisas anteriores).
  - **Lei da Usura (Decreto 22.626/1933 art. 1º, lido)**: veda juros acima do dobro da taxa legal; a Súmula 596 do STF afasta o decreto só para instituições do Sistema Financeiro Nacional (confirmado por busca). **Risco novo, não tratado nas rodadas anteriores:** a CoreoHub não é instituição financeira; juros de ~2% a.m. (~27% a.a.) cobrados por ela poderiam ser questionados por esse ângulo. Contra: a prática é repassar custo financeiro de terceiro (MDR + antecipação da Asaas), sem margem, igual a Sympla (3,49%), Guichê Web e Ticketmaster (1,99%), Bilheteria Digital (4,19%) que cobram "taxa de parcelamento". Não achei decisão que trate essas ticketeiras sob a Lei da Usura (busca limitada). Confiança: baixa; trato como risco do mesmo tipo que o produtor já aceitou no art. 9º.
- **Enquadramento como instituição financeira** (Lei 4.595/1964 art. 17; não li o texto nesta sessão): o risco cresce se a CoreoHub (a) financiar com dinheiro próprio, (b) cobrar acima do custo, (c) assumir inadimplência. A rota C evita (a) e (c) para o comprador (o risco de crédito do cartão é do emissor), mas a CoreoHub, como titular da conta que antecipa, assume recompra/estorno perante o FIDC da Asaas (Termo Aditivo, 4ª rodada). **Sem margem e com ledger por transação** (juros cobrado = custo debitado pela Asaas, diferença só arredondamento) é a defesa.
- **Repassar a taxa de antecipação ao produtor pelo split**: a Asaas disse por escrito (suporte humano, 9ª rodada) que não dá para definir taxa própria de antecipação para os produtores; só dá para repassar o custo exato via valor do split, o que o Ian disse que "não presuma fixo preservado". Seguro só se a Asaas confirmar quem paga e o fixo couber no líquido.
- **MEI** (blogs, confiança baixa; não achei texto da Receita): limite de R$ 81.000 por ano-calendário e receita bruta inclui venda parcelada no cartão; os blogs descrevem o cálculo como por competência. Se for isso, parcelar "no fluxo" não tira receita do ano; a taxa de antecipação é custo, não reduz a receita bruta. Em 12x o MEI pagaria a taxa mais alta e continuaria somando o valor cheio. Confirmar com o contador (já combinado na 22ª rodada).

---

## 7. Números (item 6)

Convenções (conta em `$TEMP/calc.py`, reproduzível): parcela k do parcelado cai em 32 x k dias depois do pagamento (bate com o sandbox); antecipação do valor da parcela com desconto de taxa a.m. proporcional aos dias, crédito em D+2; prazo médio das parcelas até o crédito = 32 x (N+1)/2 dias (3x: 64 dias, 6x: 112, 12x: 208); taxa de antecipação do parcelado: automática 1,6% a.m., manual 1,7% a.m. (rodada 4, painel da master); MDR parcelado 3,49% (2-6x) e 3,99% (7-12x) + R$ 0,49 uma vez; à vista 2,99% + R$ 0,49. P = valor líquido que o produtor e a CoreoHub precisam receber (preço base, sem a comissão; a comissão escala na mesma proporção). **A fórmula de desconto linear por dia é hipótese minha** (a Asaas só diz "a.m."); o simulador (`/anticipations/simulate`) vai dar o número exato. A restrição de 90 dias por parcela não está aplicada (otimista para 6x e 12x).

### 7.1 Passe de R$ 697 (comprador à vista no cartão: R$ 718,99)

| | 3x | 6x | 12x |
|---|---|---|---|
| **A** no fluxo: custo extra ao produtor | zero | zero | zero |
| A: última parcela / prazo médio | 96 dias / 64 dias | 192 / 112 | 384 / 208 |
| **B** antecipação auto 1,6%: taxa / produtor líquido | R$ 23,05 (3,31%) / R$ 673,95 | R$ 40,89 (5,87%) / R$ 656,11 | R$ 76,58 (10,99%) / R$ 620,42 |
| B manual 1,7% | R$ 24,49 (3,51%) | R$ 43,45 (6,23%) | R$ 81,36 (11,67%) |
| B Pagar.me 2,31% (revenda, baixa conf.) | R$ 33,27 (4,77%) | R$ 59,04 (8,47%) | R$ 110,56 (15,86%) |
| **C** comprador cobre MDR parcelado + antecipação auto: total / sobre o à vista / juros a.m. efetivo | R$ 748,35 / +4,08% / 2,03% | R$ 769,49 / +7,02% / 1,97% | R$ 820,35 / +14,10% / 2,09% |
| C manual 1,7% | R$ 750,02 / +4,32% / 2,14% | R$ 772,61 / +7,46% / 2,09% | R$ 827,03 / +15,03% / 2,22% |
| **D1** CoreoHub absorve antecipação (auto 1,6%): custo vs comissão 5% (R$ 34,85) / 7,9% (R$ 55,06) / 10% (R$ 69,70) | R$ 23,05: consome 66% / 42% / 33% | R$ 40,89: passa de 5%, 74% de 7,9% | R$ 76,58: passa de todas |
| D2 sinal + saldo em 2 Pix: custo | R$ 3,98 (0,57%) | n/a | n/a |

### 7.2 Passe de R$ 1.597 (à vista no cartão: R$ 1.646,73)

| | 3x | 6x | 12x |
|---|---|---|---|
| B auto 1,6% | R$ 52,81 (3,31%) / líquido R$ 1.544,19 | R$ 93,69 (5,87%) / R$ 1.503,31 | R$ 175,46 (10,99%) / R$ 1.421,54 |
| B manual 1,7% | R$ 56,11 | R$ 99,55 | R$ 186,42 |
| C auto 1,6%: total / +% / a.m. | R$ 1.713,98 / +4,08% / 2,03% | R$ 1.762,39 / +7,02% / 1,97% | R$ 1.878,88 / +14,10% / 2,09% |
| D1 vs comissão 5% (R$ 79,85) / 7,9% (R$ 126,16) / 10% (R$ 159,70) | R$ 52,81: 66% / 42% / 33% | R$ 93,69: passa de 5%, 74% de 7,9% | R$ 175,46: passa de todas |
| D2 sinal + saldo em 2 Pix | R$ 3,98 (0,25%) | n/a | n/a |

### 7.3 Ingresso de R$ 60 em 3x (à vista no cartão: R$ 62,35)
- B auto: R$ 1,98; manual R$ 2,11 (produtor líquido R$ 58,02 / R$ 57,89).
- C auto: comprador paga R$ 64,90 (+R$ 2,55 sobre o à vista, +4,08%); manual R$ 65,05.
- D1: custo R$ 1,98 contra comissão de 5% = R$ 3,00 / 7,9% = R$ 4,74 / 10% = R$ 6,00.
- D2 (sinal + saldo em 2 Pix): R$ 3,98 = 6,6% do valor, inviável.
- Parcela de cada uma: 3 x R$ 21,63. Não compensa criar parcelamento para ingresso barato.

### 7.4 Comparação com o mercado (mesma fórmula, em cima do à vista do passe de R$ 697)
Juros efetivos medidos em tela na Sympla em 03/10 (R$ 44,88 à vista): 3x +7,04% (3,48% a.m.), 6x +12,5% (3,47% a.m.), 10x +20,2% (3,50% a.m.), ou seja, 3,49% a.m. fixo, como a ajuda diz. Aplicado a R$ 718,99: 3x R$ 769,75 (+7,1%), 6x R$ 809,32 (+12,6%), 12x R$ 892,32 (+24,1%). Guichê Web / Ticketmaster (1,99% a.m.): 3x R$ 747,79, 6x R$ 769,89, 12x R$ 815,35. Bilheteria Digital (4,19%): 3x R$ 780,06, 6x R$ 828,03, 12x R$ 929,48. O cenário C (custo exato) fica perto do 1,99% a.m. e bem abaixo da Sympla.

Leitura:
- 3x é onde a rota fecha: custo baixo (3,3% a 3,5% do valor), cabe na janela de 90 dias, comprador paga +4,1%, e o custo cabe na comissão se a CoreoHub preferir absorver (mas 42% a 66% da comissão de 7,9% e 5% é muito).
- 6x: a CoreoHub não deve absorver (passa da comissão de 5%); ao comprador +7%.
- 12x: custo de 11% a 11,7% do valor, +14% ao comprador, e parcelas além de 90 dias ficam fora da antecipação. Não recomendado.

---

## 8. Rascunho de mensagem para o suporte humano da Asaas (o produtor envia)

> Olá, sou do CoreoHub (conta principal com subcontas white-label; cada produtor tem a própria subconta e as cobranças são criadas na conta principal com split para a subconta). Queremos oferecer cartão parcelado até 3x sem que o produtor espere 32 dias por parcela. Precisamos de resposta por escrito, com base nas regras vigentes do nosso contrato:
>
> 1. A conta principal pode ativar a antecipação automática por API (`PUT /v3/anticipations/configurations`, `creditCardAutomaticEnabled`) hoje, sem carência e sem habilitação específica por subconta? Qual é o limite de antecipação disponível para a principal, como é definido e como aumenta? O que acontece com as cobranças quando o limite acaba?
> 2. Cobrança `CREDIT_CARD` com `installmentCount` 3 e split `totalFixedValue` para a subconta, criada na principal e antecipada automaticamente pela principal: o split da subconta é liquidado na data da antecipação (D+2) ou só no crédito de cada parcela? A taxa de antecipação é debitada de quem (principal, subconta ou proporcional)? O valor fixo da subconta é preservado ou reduzido?
> 3. Parcelas com vencimento além de 90 dias: o que acontece com o split dessas parcelas e a partir de quando elas entram na antecipação automática?
> 4. Estorno total (`POST /installments/{id}/refund`) de parcelamento já antecipado com split fixo: qual a ordem do débito (subconta, principal), em que proporção, e o que ocorre se a subconta estiver sem saldo disponível? A recompra prevista no Termo Aditivo (multa de 2% e juros de 4% a.m.) recai sobre a conta principal, titular da antecipação?
> 5. Existe cobrança parcelada em que o recebedor receba o valor integral em uma única data (por exemplo, "parcelado sem juros recebendo à vista"), para ISV/marketplace?
> 6. Cobrança criada com `billingType UNDEFINED` ("Pergunte ao cliente") é realmente inelegível para antecipação? Há outro filtro de produto para cobranças `CREDIT_CARD` parceladas?
> 7. Existe condição comercial para ISV/marketplace: taxa de antecipação negociada, MDR de parcelado reduzido ou prazo de crédito do cartão menor que D+32? (Plataformas como a Doity informam prazo de 14 dias + 1 dia útil de cartão com a Asaas.)
> 8. A taxa de cartão e o R$ 1,99 do Pix são devolvidos à conta principal quando a cobrança é estornada?
> 9. Em cobrança com split antecipada, a taxa de antecipação é cobrada da conta que antecipa ou rateada entre os recebedores? A subconta precisa assinar o Termo Aditivo mesmo quando quem antecipa é a principal?

---

## 9. Opções ranqueadas

### 9.1 Vicenza (passes de R$ 697 a R$ 1.597)

1. **Cartão em 2x/3x com antecipação automática na conta principal, juros ao comprador sem margem (C).** Prós: produtor recebe o líquido cheio em D+2, a CoreoHub não usa caixa, o comprador paga menos que na Sympla (+4,1% em 3x), cabe nos 90 dias. Contras: depende de a Asaas confirmar os pontos 1, 2, 4 e 6 da seção 8; a CoreoHub assume recompra por estorno/chargeback e a cessão fiduciária da conta principal; risco da Lei da Usura/art. 52; esforço alto (webhook por parcela, estorno de parcelamento, expiração, `billingType` `CREDIT_CARD` com forma escolhida antes, recibo com CET). Limite de antecipação da conta é desconhecido.
2. **Boleto parcelado ou sinal + saldo em Pix (sem juros, sem antecipação).** Prós: custo de R$ 1,99 por cobrança (R$ 3,98 a R$ 5,97 em 2 a 3 cobranças), sem regulação de crédito, produtor recebe cada parte na hora; esforço médio (cobranças separadas já existem). Contras: inadimplência do saldo é do produtor (a CoreoHub precisa de regra de bloqueio/cobrança); UX pior que cartão; sem precedente em ticketeira BR.
3. **Cartão "no fluxo" até 3x, opt-in do produtor, sem antecipação.** Prós: custo zero, produtor decide e fica claro que recebe em 32/64/96 dias. Contras: webhook por parcela e estorno de parcelamento continuam necessários (esforço igual ao da opção 1 sem o ganho do prazo); chargeback pós-liberação.
4. **Manter 1x (status quo).** Prós: nada a fazer; sem risco novo. Contras: perde venda de passe caro; o produtor pode migrar para quem parcela.
5. **BNPL (Pagaleve ou similar) como botão extra.** Prós: sem caixa, risco de crédito do BNPL. Contras: integração com subconta não provada (Pagaleve só com cadastro Marketplace), taxa e prazo de parcelado não públicos, contrato por produtor. Só como sondagem comercial.

Não recomendado: 6x ou 12x com antecipação (custo 5,9% a 11,7% do valor, +7% a +14% ao comprador, parcelas além de 90 dias ficam de fora); a CoreoHub absorver a antecipação (consome de 33% a 66% da comissão em 3x, passa dela em 6x+); migrar de PSP.

### 9.2 Evento de ticket barato (ingresso até R$ 90, inscrição R$ 100 a R$ 300)
1. **Pix e cartão à vista (status quo, parcelado 1x).** Em R$ 60 o custo fixo de qualquer outra rota (R$ 1,98 a R$ 3,98) é de 3,3% a 6,6% do valor.
2. **Cartão em 2x/3x só para pedido acima de um piso** (sugestão minha, não pesquisada: R$ 150), com C, depois de a opção 1 do Vicenza dar certo.
3. Qualquer outra rota: não recomendada.

---

## 10. Plano em 5 bullets (se o produtor aprovar a opção 1; NADA foi implementado)

1. Enviar a mensagem da seção 8 e esperar resposta escrita antes de qualquer código. Respostas que derrubam a rota: subconta precisa antecipar sozinha; fixo da subconta é reduzido; recompra cai sem limite sobre a principal; limite de antecipação pequeno.
2. Sandbox: `GET/PUT /anticipations/configurations` na conta de teste e `POST /anticipations/simulate` numa cobrança `CREDIT_CARD` parcelada, para pegar o número real de taxa e prazo. A wallet de teste do sandbox é bloqueada para split; split + antecipação só no teste real de R$ 20 (decisão já tomada).
3. Código (sessão nova, atrás de flag por evento, só Vicenza): criar a cobrança como `CREDIT_CARD` + `installmentCount` (1x continua como está); campo de custo de antecipação no módulo de taxa; webhook por parcela (1 linha de comissão por parcela, `installments` gravado); estorno via `/installments/{id}/refund`; expiração cancela o parcelamento; limite de 3x e piso de pedido por configuração.
4. Tela de checkout com "à vista R$ X, ou 3x de R$ Y (total R$ Z, juros 2,0% a.m. / 27% a.a.)", rotulado "taxa de parcelamento", sem pré-seleção do parcelado e sem embutir no preço; ledger com custo debitado pela Asaas por transação.
5. Atualizar o Termo do Produtor uma vez só (v1.7) quando a Asaas responder; contador sobre MEI; piloto no Vicenza e revisão dos números reais depois do primeiro mês.

---

## 11. Riscos e pontos não verificados

- Quem arca a taxa de antecipação quando a principal antecipa e o split é fixo para a subconta: Doc e Ian divergem; sem resposta oficial.
- Carência de 45/90 dias: a página institucional diz que existe; a central de 03/10/2026 não menciona. O Ian disse que tende a valer. Não sei se vale para a conta principal.
- Limite de antecipação da conta principal: desconhecido; a doc diz que, quando acaba, novas cobranças deixam de ser antecipadas.
- Fórmula de desconto da taxa (linear por dia) é hipótese; o simulador da Asaas dá o número exato.
- Janela de 90 dias: não sei como o vencimento de cada parcela de cartão é contado (a doc fala em vencimento da cobrança); em 3x provavelmente cabe, em 6x e 12x há risco de ficar de fora.
- Se `UNDEFINED` é inelegível: a central fala em "Pergunte ao cliente", o Ian disse "costuma corresponder"; falta confirmação formal.
- Checkout hospedado da Asaas liquida como parcelamento comum? Doc silenciosa; não testei.
- Doity 14+1 com Asaas: inferência de prazo negociado para ISV, não confirmada.
- Parcelado emissor e Mercado Pago "total de uma vez": só segunda fonte e blog oficial via busca (fetch deu 403).
- Lei da Usura sobre repasse de juros por plataforma: nenhuma decisão achada; risco classificado por mim com confiança baixa.
- Nota técnica da Senacon de 2024: só notícias; o PDF exige login. Desfecho não verificado.
- MEI: só blogs.
- Não verifiquei: Zoop, Rede, Koin (taxa), Pagaleve (taxa e ticket), iugu (prazo), Uhuu, Ingresso.com, Eventim, XTAGE (parcelado), Minha Inscrição, Sportsplace, Pix garantido/parcelado da Asaas (blog 403).
