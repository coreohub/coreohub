# Plano: tabela de custo ao comprador para cartão parcelado

Data: 2026-10-16. Sessão de planejamento. Nada foi implementado, commitado, deployado ou cobrado. `maxInstallments` segue 1; `events.processing_fee_enabled` e a antecipação automática da master seguem como estavam. Este arquivo não deve ser commitado.

Fontes internas: `memory/decisao_processamento_comprador_2026_10_02.md` (rodadas 4, 5, 22, 27, 28, 33, 40, 56 a 61), `docs/pesquisa-parcelamento-cartao.md` (6, 7, 9), `docs/pesquisa-troca-psp.md` (6), `supabase/functions/_shared/processing-fee.ts` e testes. Contas reproduzíveis em `scratchpad/calc.py` (fora do repo).

Nenhuma divergência relevante entre o prompt e o que li. Duas notas: (1) o agente de código sugeriu que o R$ 0,49 poderia ser N x 0,49; isso foi resolvido na 58a rodada (uma vez por cobrança) e não reabro; (2) o Termo do Produtor está na v1.8 (`pages/TermoProdutor.tsx`, `utils/termoVersion`).

---

## 1. Modelo de custo (conferido)

Fórmula pedida: `T = (base/(1-a) + 0,49)/(1-mdr)`, `a = r x (32 x (N+1)/2 / 30)`.

Premissas: parcela k credita em 32 x k dias; antecipação proporcional aos dias, calculada sobre o valor após o MDR; MDR 2,99% (1x), 3,49% (2-6x), 3,99% (7-12x); R$ 0,49 por cobrança.

Conferência: com base R$ 697 e r = 1,6% a.m., a linha total (que inclui o que hoje é a taxa de pagamento) dá R$ 51,24 em 3x (7,35%), R$ 71,59 em 6x (10,27%) e R$ 120,06 em 12x (17,2%). Bate com o prompt.

Calibragem contra o sandbox (r = 1,7%, R$ 697): 3x, minha fórmula dá R$ 24,38 e o sandbox cobrou R$ 24,63 (+1,0%); 12x, R$ 78,84 contra R$ 79,02 (+0,2%). A fórmula subestima levemente; recomendo calcular com 33 dias por parcela (ou +1% de folga) para nunca ficar abaixo do custo.

Dois desenhos de linha, que o prompt chama de "taxa de pagamento" e "taxa de parcelamento":

- **Modelo A, linha única sem margem:** o total cobrado cobre exatamente MDR + antecipação; a "taxa de pagamento" de 4% some no parcelado. Menor preço, mas a CoreoHub perde a margem de pagamento que ganha no 1x e o rótulo mistura duas coisas.
- **Modelo B (recomendado):** mantém a taxa de pagamento do cartão à vista (4% da base, igual ao 1x) e soma uma **taxa de parcelamento** que é só o custo incremental (MDR maior + antecipação), calculada para a CoreoHub ficar exatamente como no 1x (neutra). A margem da CoreoHub é a mesma do 1x; o produtor recebe o mesmo; a linha nova é custo puro, defensável como repasse sem margem.

Margem da CoreoHub no 1x (taxa de pagamento 4% menos MDR e R$ 0,49): R$ 0,04 em R$ 60; R$ 0,85 em R$ 150; R$ 5,72 em R$ 697; R$ 13,70 em R$ 1.597. Em ticket baixo é praticamente zero.

---

## 2. Decisões que você precisa tomar

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| a | Modelo de cobrança do parcelado | A: linha única = custo; B: taxa de pagamento 4% mantida + "taxa de parcelamento" = custo incremental; C: percentual fixo por faixa | **B, com o valor calculado no servidor pelo custo exato (arredondado para cima, folga de 1 dia).** Percentual fixo por faixa (C) só se quiser tabela pública simples; ver 3.3 |
| b | Antecipação | Automática global na master vs pedida por cobrança só no parcelado | **Por cobrança, só no parcelado, via API** (`/anticipations`), porque a automática antecipa todo cartão da master, inclusive 1x (custo 1,15% a.m. sobre todos os eventos, sem repasse ao comprador). Pré-requisito: confirmar que a API aceita pedir antecipação de uma cobrança específica e checar o limite antes de oferecer parcelas. Se a API não permitir, a automática só vale se o 1x também embutir o custo (hoje não embute) |
| c | Teto de parcelas e piso | 3x, 6x, 12x, por valor | **Teto 3x na v1** (CET ~27% a.a. contra ~26% em 6x e 12x, mas o custo para o comprador cresce de +4,1% para +13,6%, e a exposição de crédito também). Piso do pedido R$ 150 e parcela mínima R$ 50. 6x só para pedido a partir de R$ 500, numa 2a fase. 12x não |
| d | Quem paga a linha no preço fechado de inscrição | Comprador sempre; produtor pode absorver | **Comprador paga sempre na v1; sem opção de o produtor absorver.** Absorver 4,07% (3x) consome mais da metade da comissão de 7,9%; e o Pix fechado continua sem a linha. A linha de parcelamento aparece só no cartão parcelado, como hoje a taxa de pagamento do cartão |
| e | 1x e Pix | Seguem na tabela atual | **Sim: Pix 4% (teto R$ 15), cartão 1x 4%, sem mudança.** Remover as faixas `card2to6`/`card7to12` percentuais de `percent` e substituir pela função de custo exato |
| f | Ticket baixo (R$ 20 a R$ 90) | Parcelar ou não | **Não parcelar.** Em R$ 60 em 3x a linha é R$ 2,52 e a parcela R$ 21,64; o ganho de conversão não paga o risco e a complexidade. Piso de R$ 150 resolve |
| g (revisada em 2026-10-16, ver seção 9) | Plateia (Plano Espetáculo) | Parcelar ou não | **Parcelar plateia, com a taxa de parcelamento FORA do teto de 7% da taxa de pagamento, só 2x e 3x, e desligado nas UFs com regra própria (AC, RR, AL, RJ, PR).** O teto de 7% é política interna da CoreoHub inspirada no art. 9 (que só exige taxa proporcional ao preço), não número do Decreto; ver seção 9 |

---

## 3. Tabela nova proposta

### 3.1 Percentuais da taxa de parcelamento (modelo B, r = 1,6% a.m., base >= R$ 150)

| Parcelas | MDR | Taxa de parcelamento (% da base) | Juros efetivo a.m. | CET a.a. | Total vs à vista cartão |
|---|---|---|---|---|---|
| 2x | 3,49% | 3,16% | 2,10% | 28,3% | +3,16% |
| 3x | 3,49% | 4,07% | 2,02% | 27,1% | +4,07% |
| 6x | 3,49% | 6,90% | 1,94% | 25,9% | +6,90% |
| 12x | 3,99% | 13,64% | 2,02% | 27,2% | +13,64% |

(Juros efetivo = taxa interna de retorno de N parcelas iguais, a primeira em 30 dias, contra o preço à vista no cartão = base x 1,04. CET a.a. = (1+i)^12 - 1. Convenção do CDC art. 52 ainda a confirmar com o advogado; ver 6.)

### 3.2 Exemplos (modelo B, r = 1,6%)

| Base | À vista cartão | Parcelas | Total | Parcela | Taxa de parcelamento | Juros a.m. | CET a.a. |
|---|---|---|---|---|---|---|---|
| R$ 60 (não parcelar) | 62,40 | 3x | 64,92 | 21,64 | 2,52 | 2,01% | 26,9% |
| R$ 150 | 156,00 | 3x | 162,33 | 54,11 | 6,33 | 2,02% | 27,1% |
| R$ 150 | 156,00 | 6x | 166,74 | 27,79 | 10,74 | 1,94% | 25,9% |
| R$ 697 | 724,88 | 2x | 747,77 | 373,88 | 22,89 | 2,10% | 28,3% |
| R$ 697 | 724,88 | 3x | 754,37 | 251,46 | 29,49 | 2,02% | 27,1% |
| R$ 697 | 724,88 | 6x | 774,89 | 129,15 | 50,01 | 1,94% | 25,9% |
| R$ 697 | 724,88 | 12x | 823,76 | 68,65 | 98,88 | 2,02% | 27,2% |
| R$ 1.597 | 1.660,88 | 3x | 1.728,47 | 576,16 | 67,59 | 2,02% | 27,1% |
| R$ 1.597 | 1.660,88 | 6x | 1.775,51 | 295,92 | 114,63 | 1,94% | 25,9% |
| R$ 1.597 | 1.660,88 | 12x | 1.887,51 | 157,29 | 226,63 | 2,02% | 27,2% |

Modelo A (para comparação, R$ 697): 3x total R$ 748,24 (linha única R$ 51,24); 6x R$ 768,59; 12x R$ 817,06. A diferença para o B é exatamente a margem de pagamento do 1x (R$ 5,72).

### 3.3 Percentual fixo por faixa (alternativa C)

Se quiser tabela pública simples: 2x 3,3%, 3x 4,2%, 4-6x 7,2%, 7-12x 14,2% da base (arredondado para cima, com folga). Prós: copy e simulador triviais. Contras: perde exatidão em pedido baixo (R$ 0,49 pesa) e deixa de ser "custo sem margem" provável, o que enfraquece a defesa contra a Lei da Usura. Por isso recomendo o custo exato calculado no servidor, exibido como valor em reais e total.

### 3.4 Comparação com o mercado (mesma base, preço à vista R$ 724,88, parcelas pela Tabela Price)

| Quem | Taxa | 3x total | 6x total | 12x total | CET a.a. |
|---|---|---|---|---|---|
| CoreoHub (B) | ~2,0% a.m. efetivo | 754,37 | 774,89 | 823,76 | ~27% |
| Guichê Web / Ticketmaster | 1,99% a.m. | 753,92 | 776,20 | 822,03 | 26,7% |
| Sympla | 3,49% a.m. (texto oficial: "acrescido de juros de 3.49% ao mês, cobrados no regime composto") | 776,06 | 815,95 | 899,63 | 50,9% |
| Bilheteria Digital | 4,19% a.m. | 786,46 | 834,82 | 937,10 | 63,6% |

A CoreoHub fica praticamente igual ao Guichê/Ticketmaster e bem abaixo da Sympla. Taxas de Guichê, Ticketmaster e Bilheteria vêm das medições já registradas na memória; a da Sympla foi reconfirmada hoje em fonte primária.

### 3.5 Quem recebe o quê (R$ 697, 3x, modelo B)

- Comprador paga R$ 754,37.
- Produtor recebe o mesmo que receberia no 1x (base menos comissão), integral na antecipação, pelo split fixo. Custo de antecipação não sai dele.
- CoreoHub recebe a comissão de sempre + R$ 5,72 de margem de pagamento (igual ao 1x). A taxa de parcelamento (R$ 29,49) é integralmente consumida por MDR extra e antecipação; a conta da antecipação é paga pela principal e reposta pela linha.
- Se a antecipação não acontecer (limite esgotado), sobram R$ 24,83 que a CoreoHub NÃO pode guardar (seria margem). Por isso a verificação de limite antes de oferecer parcelas é obrigatória, e se a cobrança sair sem antecipar o excesso precisa ser devolvido ou creditado (regra a definir).

### 3.6 Risco de crédito da principal

- Estorno, chargeback e cancelamento de título antecipado recaem na principal, que pode ficar com saldo negativo (60a rodada). Termo Aditivo: recompra com multa 2% + juros 4% a.m. (cláusula 7.4, 4a rodada); coobrigação e cessão fiduciária da conta (cláusulas 13 e 1.1.5).
- Limite da master: R$ 70.000 (61a rodada, painel). Um único evento com 100 passes de R$ 697 em 3x antecipa ~R$ 69.700 e esgota o limite sozinho. Depois disso novas cobranças não antecipam e o produtor só recebe na compensação (32/64/96 dias), com o comprador já tendo pago a taxa.
- Exposição máxima por evento = volume parcelado antecipado e ainda dentro da janela de estorno/chargeback, multiplicado pela parte que já saiu da subconta. O `daily-release-funds` varre o líquido do produtor no D+7 (release_at); se o evento for cancelado depois disso, a subconta está vazia e o estorno cai na principal.
- Proposta de contenção (a decidir): teto de parcelado antecipado em aberto por evento (sugestão R$ 20.000 a R$ 25.000, ~1/3 do limite); para vendas parceladas, adiar a liberação do líquido ao produtor até a janela de arrependimento (7 dias) e idealmente até a data do evento; checar o limite via API antes de mostrar parcelas e cair para 1x se não couber; só 3x; piso de R$ 150.
- Perda esperada ilustrativa (não é dado medido): R$ 50.000 parcelados por mês com 0,5% a 1% de chargeback = R$ 250 a R$ 500 de principal exposto, mais multa de 2% e juros de 4% a.m. sobre o recomprado. Pequeno em condições normais; o cenário ruim é cancelamento em massa de um evento já pago, que não depende de taxa de chargeback.

### 3.7 Sensibilidade (R$ 697, modelo B, taxa de parcelamento em R$)

| Antecipação a.m. | 3x | 6x | 12x |
|---|---|---|---|
| 1,15% | 22,07 | 36,42 | 70,96 |
| 1,60% (automática, base) | 29,49 | 50,01 | 98,88 |
| 1,70% (manual) | 31,16 | 53,10 | 105,35 |
| 2,00% | 36,21 | 62,51 | 125,38 |
| 2,50% | 44,78 | 78,71 | 161,02 |

Prazo por parcela (3x / 12x): 30 dias R$ 27,83 / R$ 92,51; 32 dias (base) R$ 29,49 / R$ 98,88; 35 dias R$ 31,99 / R$ 108,62. Se a Asaas mudar a taxa de 1,6% para 2%, 3x sobe R$ 6,72 (0,96% da base). Por isso a taxa e os dias devem ficar em config única (`PROCESSING_FEE_CONFIG`), e cada cobrança deve gravar a taxa e o valor usados (auditoria do "sem margem").
O IOF incidente na antecipação não está nestas contas; depende do contador.

---

## 4. Pesquisa web (acesso em 2026-10-16)

| Item | Achado | Fonte | Confiança |
|---|---|---|---|
| Sympla, rótulo e texto | "Ao selecionar o parcelamento, o valor total da compra é acrescido de juros de 3.49% ao mês, cobrados no regime composto." "Sempre que uma das opções de parcelamento é selecionada, o valor total a ser pago em cada uma das parcelas é exibido já considerando os juros." "O valor mínimo por parcela é R$5,00." Também: "poderão incidir taxas de parcelamento, além da taxa de serviço e taxa de processamento". Rótulos: "juros" e "taxas de parcelamento". Aparece no seletor de parcelas (valor de cada parcela já com juros). Não vi se mostram total e CET no checkout | https://ajuda.sympla.com.br/hc/pt-br/articles/360001083203 (atualizado 2026-10-15) | Alta |
| Sympla, modelo "sem juros" | Organizador pode absorver o custo, descontado do repasse; repasse total independe do nº de parcelas (só resumo) | https://ajuda.produtor.sympla.com.br/hc/pt-br/articles/15445379181453 e blog Sympla | Média |
| Even3 | Sem texto sobre juros ao participante; "Aumente as possibilidades de compra com boleto, pix, cartão de crédito e parcelamentos"; taxa de 10% | https://plataforma.even3.com.br/como-funciona/pagamentos/ | Média |
| Demais ticketeiras (Ingresse, Uhuu, Eventbrite BR, Guichê, Ticketmaster, Bilheteria, Blueticket, Doity) | Nenhuma política publicada achada; checkout real não visto. Indício isolado de reclamação atribuindo a diferença a "juros aplicados pela operadora do cartão" | Reclame Aqui | Baixa |
| CDC art. 52 e 54-B | Art. 52: informar preço em moeda corrente, montante dos juros, taxa efetiva anual, número e periodicidade das prestações e soma total. Art. 54-B (Lei 14.181/2021): informar CET e taxa efetiva mensal na oferta. Planalto falhou (ECONNRESET), confirmado por sites secundários; texto literal do 54-B não conferido | modeloinicial.com.br, admdireito.com.br | Média |
| Decreto 7.962/2013 art. 2 IV | Não consegui abrir; não confirmado | n/a | n/a |
| Lei 13.455/2017 | Art. 1: "Fica autorizada a diferenciação de preços de bens e serviços oferecidos ao público em função do prazo ou do instrumento de pagamento utilizado." Dever de informar no art. 5-A da Lei 10.962/2004. Autoriza preço diferenciado, não autoriza expressamente cobrar juros de crédito | camara.leg.br, Migalhas, Procon | Média-alta |
| Senacon e "parcelado sem juros" | Jan/2024: Febraban denunciou PagSeguro, Stone, Mercado Pago e PicPay por embutir juros (até 2,99% a.m.) em parcelado "sem juros"; Senacon emitiu cautelar e nota técnica de 15/01/2024 (possível indução a erro) e REVOGOU a cautelar em 19/01/2024 após as empresas negarem (Stone invocou a Lei 13.455). Desfecho de mérito: não achei | convergenciadigital.com.br, mercadoeconsumo.com.br, poder360.com.br | Média |
| Lei da Usura e Súmula 596 | Súmula 596 STF afasta o Decreto 22.626/33 para instituições do sistema financeiro; STJ Súmula 283 estende a administradoras de cartão. Nenhuma decisão ou parecer sobre plataforma NÃO financeira repassando custo financeiro de terceiros. A própria Febraban levantou a dúvida contra não bancos, sem decisão | resumos jurídicos | Média |
| Estorno de parcelado antecipado | Even3: reembolso pela plataforma em até 6 meses (cartão), "Só será possível seguir com o reembolso se o evento possuir saldo disponível"; compras com menos de 7 dias não têm desconto de taxa. Sympla: cancelamento até 7 dias; Procon-MG multou a Sympla por reter taxa de conveniência no arrependimento (Sympla recorre). Inferência: no arrependimento, a taxa de parcelamento também deve ser devolvida | ajuda.even3.com.br/.../360041280312; itatiaia.com.br | Alta (Even3) / Média-baixa (Sympla) |

Implicações para o desenho: (1) rotular como "juros/taxa de parcelamento", nunca embutir; (2) mostrar parcela, total, juros a.m. e CET antes de confirmar; (3) devolver a taxa de parcelamento no estorno dentro dos 7 dias (e decidir o resto); (4) o CET de ~27% a.a. fica acima de 24% a.a. (dobro da taxa legal de 12%), que é a leitura mais comum do limite da Lei da Usura; a Sympla (51%) e outras ticketeiras estão acima disso há anos sem decisão achada, mas isso não é defesa jurídica. Sem conclusão: advogado.

---

## 5. Impacto no código (somente leitura; `F/` = `supabase/functions/`)

### 5.1 Só tabela (números, config, UI, texto)

- `F/_shared/processing-fee.ts:31,49` percentuais `card2to6`/`card7to12` (4/5/6) trocar por cálculo de custo exato; `:57` `maxInstallments` (1 para 3); `:60-61` custos Asaas; `:99-103` `cardBand`; `:125-148` `asaasCost`/`cardCostFloor`; `:158-165` `computeProcessingFee`. Adicionar: `installmentFee(base, n, config)` com `anticipationRatePerMonth`, `daysPerInstallment`, piso do pedido, piso da parcela, e saída separada `paymentFee` + `installmentFee`. Teto de plateia (`:171-177`) deixa de se aplicar porque plateia não parcela (decisão g).
- `tests/processing-fee.test.ts:20-22,24-27` (afirmam `maxInstallments === 1` e recusa de 2x) e as faixas `:63-71,88,117,263`; `tests/audience-checkout.test.ts:76`, `tests/inscricao-checkout.test.ts:177`, `tests/workshop-checkout.test.ts:101` (quatro asserts de recusa por padrão quebram). Testes novos: custo exato contra 3.4 e 3.7, piso/teto, folga de arredondamento, monotonicidade.
- `components/PaymentMethodPicker.tsx:4,40,59,67-69,72-84`: seletor já existe e aparece quando `max > 1`; faltam copy ("cada parcela é cobrada à parte"), exibir parcela + total + juros a.m. + CET, e separar "taxa de pagamento" de "taxa de parcelamento".
- Checkouts: `pages/CheckoutIngresso.tsx:153,597-628,662,1009-1038` (fora do escopo se plateia não parcela, mas o laço `cardTotals` precisa respeitar o tipo de produto), `pages/CheckoutWorkshop.tsx:93,313-325,426,731-733`, `pages/CheckoutWorkshopPass.tsx:89,258-270,333,545-547`, `pages/MinhasCoreografias.tsx` (usa o picker), `components/TaxasESimulador.tsx` (não li; conferir).
- `F/quote-audience-ticket/index.ts:77-144`: não trava parcelas nem a tabela; como plateia fica sem parcelado, pode ficar como está. Se plateia parcelar no futuro, travar tabela e config na cotação.
- `pages/Planos.tsx:68-69,177,457,636-652` (FAQ e JSON-LD), `F/send-email/index.ts:518,533,584,599,966,985,1036,1053,1084,1102,1140,1157` (adicionar parâmetro "Nx de R$" e linha de parcelamento), `pages/LandingPage.tsx`, `pages/LandingEspetaculo.tsx`, `api/og-marketing.ts` (copy "32 dias").
- Termo do Produtor v1.8 para versão nova (UMA vez só, depois das respostas externas): `pages/TermoProdutor.tsx` cláusula 11 (`:354-372`) e cartão (`:382-394`), `utils/termoVersion`, aceite em RPC (`:99,106`), leituras `AccountSettings.tsx:986,1008`, `CriarEventoGate.tsx:57`, `OnboardingWizard.tsx:102`.

### 5.2 Pré-requisitos (bloqueiam subir `maxInstallments`)

1. **Criação nas 4 funções que não mandam parcelamento**: `F/create-workshop-registration` (`:403-409,586,594-597,609,619`), `F/create-workshop-pass-registration` (`:327-333,478,485,492,501`), `F/create-aggregate-payment-asaas` (`:523-539,749,760,774,784`), `F/create-video-selection-payment` (`:216-239,297,303,310,320`). Hoje mandam só `billingType` e gravam `installments = N`: subir o limite sem corrigir cobra à vista com taxa de N. Risco silencioso. Enviar `installmentCount`, `totalValue` e `totalFixedValue`. `F/create-audience-ticket:651-671` já faz (molde). `F/create-payment-asaas:417` usa `billingType: 'UNDEFINED'` (parcelamento na fatura Asaas, fora do nosso controle): decidir se migra para o fluxo do carrinho ou fica à vista.
2. **Webhook por parcela** (`F/asaas-webhook/index.ts`): hoje 1 cobrança = 1 `payment.id`. Cada parcela chega com `payment.id` próprio e mesmo `externalReference` (`:1649-1687` anti-forja deve continuar funcionando). Precisa: resolver pedido por `payment.installment`/`externalReference` em vez de só `payment_id` (`:205-318` pagamento tardio, `:1735`); 1 linha de `platform_commissions` por parcela com `card_credit_at` próprio (`:37-55,412-414,614-616,800-802,1181-1183,1501-1503`; `F/_shared/card-credit-date.ts`: parcela k = confirmação + 32 x k, rolando fim de semana); idempotência por `asaas_payment_id` já existe (`:197,529,720,922,1375,1192`); efeitos únicos (e-mail, QR, estoque, cupom `used_count`) só na primeira parcela; `PAYMENT_REFUNDED`/`PAYMENT_DELETED` (`:1894-2022`) por parcela. Maior risco de regressão do projeto.
3. **Estorno de parcelado**: `F/refund-asaas-payment:62-146`, `F/_shared/audience-refund.ts:132` (usado também por `refund-audience-ticket` e pelo estorno automático do webhook `:260`), `F/process-video-refund:78,98`. Nenhuma chamada a `/installments/{id}/refund` existe; usar o estorno do carnê (sem `value` = total) e zerar comissões por parcela. Estorno parcial de parcelado: não suportar na v1.
4. **Expiração e cancelamento**: `F/expire-pending-payments:119-131` e `F/cancel-aggregate-payment:64-98` fazem `DELETE /payments/{id}`; no parcelado cancelam só a 1a parcela. Trocar por `DELETE /installments/{id}`.
5. **Persistência do carnê**: não há coluna para `installment` (id) nem parcela→comissão em produção. `supabase/migrations/20260915_pix_installments.sql` (não commitado) cria `payment_installments` e serve de molde; precisa revisão (é do projeto antigo de Pix parcelado). `20261005_processing_fee.sql` tem CHECK `installments BETWEEN 1 AND 12` (`:83-84`) e `installmentsFromPayment` aceita 1 a 12 (`processing-fee.ts:232-235`): suficiente para teto 3x.
6. **Pedido de antecipação via API** e **checagem de limite antes de mostrar parcelas**: nenhuma chamada a `/anticipations` no código. Confirmar na doc oficial (não verifiquei hoje) o endpoint de pedido por cobrança e o de consulta de limite.
7. **Liberação**: `F/daily-release-funds:91-93` e `F/manual-transfer-now:96-130` já respeitam `card_credit_at`/`release_at`, então funcionam com linhas por parcela. Falta decidir a regra de retenção maior para parcelado (3.6) e o rateio do split (quando a parcela é antecipada, o split cai integral na antecipação). `components/ProducerBalanceCard.tsx` mostra parcelas futuras se houver linhas por parcela.
8. **Exibição ao comprador**: parcela, total, juros a.m. e CET (CDC 52/54-B) em todas as telas e e-mails de confirmação.

---

## 6. Plano de testes

### Sandbox
Cartão `5162306219378829` 05/2030 CCV 318 com holder completo (o `5184019740373151` dá "não autorizada"). A wallet do sandbox é bloqueada para split; split só no teste real.

| Teste | Prova | Não prova |
|---|---|---|
| Unitários do custo exato (3.1, 3.7), piso, arredondamento | Matemática e config | Custo real da Asaas |
| Criação 3x pelas 5 funções, conferindo `installmentCount`, `totalValue`, valor da linha gravada | Que nenhuma função cobra à vista com taxa de N | Split |
| Webhook: pagar 1 parcela e depois as demais; reenvio duplicado | 1 linha por parcela, idempotência, e-mail uma vez, estoque uma vez, `card_credit_at` por parcela | Datas reais de crédito em produção |
| Estorno via `/installments/{id}/refund` (total) e antes/depois do pagamento | Zerar comissões por parcela | Estorno de título antecipado |
| Expiração/cancelamento via `DELETE /installments/{id}` | Cancela o carnê inteiro | n/a |
| Simulação de antecipação (`/anticipations/simulate`) para 3x/6x/12x | Calibra 33 dias/+1% e confirma a fórmula | Limite, carência, aceite do Termo |
| Sandbox aceita antecipar qualquer prazo | n/a: o sandbox não aplica limite nem carência (56a rodada), então NÃO prova produção | Limite R$ 70.000, carência 45/90 |

### Produção (combinado para outro momento; precisa do seu OK)
Alvo autorizado: subconta do Hemer/Usualdance. Cobrança de cartão ~R$ 60 em 3x, split fixo, antecipação pedida pela principal. Falta: cartão de quem paga, OK para função temporária `temp-*` com chave de produção, conferir o piso de R$ 20 do split (achado empírico anterior; Asaas fala em R$ 5). O arquivo `supabase/functions/temp-test-installment-split/` já existe, não commitado.

| Prova | Resultado esperado |
|---|---|
| R$ 0,49 uma vez ou por parcela | Fecha a conta da 58a rodada em dinheiro real |
| Split cai na data da antecipação | Confirma a resposta da Asaas (58a e 60a rodadas) |
| Taxa de antecipação abatida só da principal, fixo da subconta preservado | Confirma rota de custo ao comprador |
| Custo real vs fórmula | Valida a folga de 33 dias |
| Limite consumido e restituído | Mede exposição |
| Estorno de título antecipado dentro dos 7 dias (se você aceitar estornar o teste) | Prova quem fica negativo e se a taxa volta | 

Fica sem prova mesmo depois: carência 45/90, recompra (multa 2% + juros 4% a.m.) na prática, estorno após os 7 dias, comportamento com limite esgotado, chargeback real, 6x e 12x em dinheiro.

---

## 7. Pendências externas (listadas, não resolvidas)

1. **Contador:** receita bruta da linha de parcelamento (SC COSIT 5.007/2025 e 76/2026), IOF na antecipação, teto do MEI.
2. **Asaas:** resposta final sobre estorno na janela de arrependimento de 7 dias; carência 45/90 da principal; valor do limite efetivo e restituição; endpoint de pedido de antecipação por cobrança; blockedBalance do Pix; condição white-label.
3. **Recompra do Termo Aditivo:** multa 2% + juros 4% a.m. na prática (quem arca, quando).
4. **Termo do Produtor:** versão nova (1.9), uma vez só, depois das respostas acima, com cláusulas de parcelado, retenção e estorno.
5. **Advogado:** Decreto 13.108 art. 9 (inclusive a decisão g sobre plateia), CDC 52/54-B (convenção de cálculo de juros e CET), Lei da Usura e enquadramento da CoreoHub como não financeira cobrando juros, Res. Conjunta CMN/BCB 16/2025.

---

## 8. Próxima ação mais barata

Perguntar à Asaas (time de API/antecipação, por escrito) se existe endpoint para pedir a antecipação de UMA cobrança específica e para consultar o limite disponível antes de criar a cobrança; sem isso a decisão (b) fica travada na antecipação automática global, que encarece o 1x de todos os eventos.

---

## 9. PLANO ATUALIZADO (2026-10-16): Espetáculo e Vicenza

Decisões já tomadas e mantidas: parcelado de verdade (28a rodada), prova em dinheiro real (57a), antecipação repassada sem margem até advogado e Asaas (01/10), antecipação automática da master NÃO ligada, Termo do Produtor atualizado uma vez só.

### 9.1 Regras
- Taxa de pagamento mantida como hoje (Pix 4% teto R$ 15; cartão 1x 4%). Parcelado = taxa de pagamento 4% + "Taxa de parcelamento" em linha própria, calculada no servidor pelo custo (MDR extra + antecipação a 1,6% a.m., folga de 1 dia), sem margem.
- Só 2x e 3x. Pedido mínimo R$ 100; parcela mínima R$ 30. Passe de workshop também até 6x a partir de R$ 500 (fase 2).
- Plateia: taxa de parcelamento fora do teto interno de 7% (o Decreto 13.108 art. 9 só exige proporcionalidade; o 7% é política da CoreoHub). Desligado em AC, RR, AL, RJ, PR. Devolvida em estorno e arrependimento.
- Quem paga: segue `audience_processing_payer`; se o produtor assumir, a taxa de parcelamento sai do líquido dele como a linha de pagamento hoje.
- Antecipação pedida por cobrança, só no parcelado, depois de checar o limite; sem limite, cai para 1x.
- Teto de parcelado antecipado em aberto por evento: R$ 25.000 (sugestão).

### 9.2 Tabela que o comprador vê (taxa de pagamento + taxa de parcelamento; juros a.m. e CET a.a. de 3x ~2,0% e ~27%)
| Caso | À vista cartão | 2x | 3x | Taxa de parcelamento 3x |
|---|---|---|---|---|
| Espetáculo, 3 ingressos de R$ 32 (R$ 96, base R$ 103,58) | R$ 107,72 | 2x R$ 55,56 (R$ 111,12) | 3x R$ 37,36 (R$ 112,09) | R$ 4,37 |
| Espetáculo, 6 ingressos de R$ 32 (R$ 192) | R$ 215,4 | ver servidor | ver servidor | cerca de R$ 8,7 |
| Passe Vicenza R$ 697 | R$ 724,88 | 2x R$ 373,88 (R$ 747,77) | 3x R$ 251,46 (R$ 754,37) | R$ 29,49 |
| Passe Vicenza R$ 1.597 | R$ 1.660,88 | 2x R$ 856,67 (R$ 1.713,33) | 3x R$ 576,16 (R$ 1.728,47) | R$ 67,59 |
(Valores do pedido: a base já inclui a comissão repassada.)

### 9.3 Lucro da CoreoHub (Espetáculo 7,9%; Essencial 5% + R$ 250 por evento; margem de pagamento do Pix e do cartão; parcelamento 0)
Lucro por pedido: Espetáculo R$ 96: comissão R$ 7,58 + margem Pix R$ 2,15 ou cartão R$ 0,43; passe R$ 697: comissão R$ 51,03 + margem Pix R$ 13,01 ou cartão R$ 5,72.

Espetáculo (pedido de 3 ingressos de R$ 32; mix é hipótese):
| Vendas no mês | Mix Pix/cartão 1x/parcelado | Lucro | % |
|---|---|---|---|
| R$ 10.000 | 85/10/5 | R$ 987 | 9,87% |
| R$ 10.000 | 70/20/10 | R$ 961 | 9,61% |
| R$ 42.000 (1 espetáculo de 4 sessões) | 85/10/5 | R$ 4.147 | 9,87% |
| R$ 42.000 | 70/20/10 | R$ 4.034 | 9,61% |
| R$ 100.000 | 85/10/5 | R$ 9.874 | 9,87% |
| R$ 100.000 | 70/20/10 | R$ 9.605 | 9,61% |

Passes Vicenza (plano Essencial: R$ 250 fixos por evento + 5% de comissão; o fixo NÃO está nas contas abaixo; mix é hipótese). Por passe de R$ 697: comissão R$ 33,19 + margem Pix R$ 13,01 ou cartão R$ 5,72.
| Vendas no mês | Mix Pix/1x/parcelado | Lucro (sem os R$ 250) | % | Antecipado no mês |
|---|---|---|---|---|
| R$ 50.000 | 50/20/30 | R$ 3.053 | 6,1% | R$ 16.235 |
| R$ 50.000 | 30/20/50 | R$ 2.948 | 5,9% | R$ 27.058 |
| R$ 100.000 | 50/20/30 | R$ 6.106 | 6,1% | R$ 32.469 |
| R$ 100.000 | 30/20/50 | R$ 5.896 | 5,9% | R$ 54.115 |
| R$ 200.000 | 50/20/30 | R$ 12.212 | 6,1% | R$ 64.938 |
| R$ 200.000 | 30/20/50 | R$ 11.792 | 5,9% | R$ 108.231 (estoura o limite de R$ 70.000) |

Leituras: o lucro vem da comissão; parcelar não rende margem e troca a margem do Pix pela do cartão (cerca de 0,2 a 1,2 ponto percentual do valor vendido), compensada se o parcelado vender mais. Pedido de 1 ingresso de R$ 32 dá lucro de R$ 1,92 (Pix) a R$ 2,35 (cartão): a margem de pagamento é negativa (-R$ 0,61 no Pix), coberta pela comissão. Acima de ~R$ 70.000 antecipados o limite da master trava: teto por evento e checagem de limite são obrigatórios.

### 9.4 Ordem de execução
1. Pergunta à Asaas por escrito: endpoint de antecipação por cobrança, endpoint de limite, regra de renovação do limite.
2. Teste real em produção (~R$ 60 em 3x, subconta do Hemer, split fixo, antecipação pela principal): prova R$ 0,49 por cobrança, split na antecipação, custo real, limite.
3. Pré-requisitos técnicos (seção 5.2) em ordem: persistência do carnê (migration), criação nas 4 funções sem parcelamento, webhook por parcela, estorno e expiração do carnê, pedido de antecipação e checagem de limite.
4. `processing-fee.ts`: `installmentFee()` com config (taxa de antecipação, dias, pisos), saída separada de taxa de pagamento e de parcelamento; reescrever os 4 asserts de recusa; simulador (`TaxasESimulador.tsx`); picker com parcela, total, juros a.m. e CET.
5. Sandbox completo, depois staging na `dev`, depois ligar por evento (flag nova), começando pelo Espetáculo e por um passe da Vicenza, com OK seu.
6. Termo v1.9 (uma vez só), e-mails, Planos, landing.

### 9.5 Bloqueios externos (não resolvidos)
Contador (receita bruta da taxa de parcelamento, IOF), advogado (taxa fora do teto, CDC 52/54-B, Usura, art. 9), Asaas (estorno nos 7 dias, carência 45/90, renovação do limite, recompra).

---

## 10. Etapa 1 concluída: teste cru no sandbox Asaas (2026-10-16)

Cobrança de cartão R$ 60 em 3x pela API (sandbox, cartão 5162306219378829, sem split porque a wallet do sandbox é bloqueada). Função temporária deployada, usada e APAGADA (local e remota). Nada em produção.

| Item | Resultado |
|---|---|
| Estrutura | 1 cobrança de R$ 60 vira 3 cobranças de R$ 20 (um `installment` id), todas CONFIRMED na hora |
| Taxa | R$ 0,85 por parcela, R$ 2,55 no total = 3,49% x 60 (2,09) + R$ 0,49 UMA vez (rateado em 3). Confirma `cardFixedPerCharge` = 0,49 por cobrança |
| Datas de crédito | 17/11/2026 (32 dias), 21/12/2026 (66 dias; 19/12 caiu no sábado e rolou para segunda), 20/01/2027 (96 dias) |
| Simulação de antecipação do carnê inteiro | Valor após MDR R$ 57,45, taxa R$ 2,11 (3,67%), líquido R$ 55,34, prazo 96 dias. Minha fórmula (1,7% a.m. x 64 dias médios) dá 3,63%: erro de 1% |
| Pedido de antecipação por API | `POST /anticipations` com o id do carnê funciona (status PENDING). Responde a pergunta 1 do plano (por cobrança, sem ligar a automática) |
| Limite por API | `GET /anticipations/limits` existe e devolve `creditCard.total` e `creditCard.available`. Responde a pergunta 2 |
| Consumo do limite | A antecipação consumiu o valor de face (R$ 60,00) do limite, não o líquido |
| Estorno | `POST /installments/{id}/refund` estornou as 3 parcelas (status DONE, REFUNDED) mesmo com antecipação PENDING; a antecipação virou CANCELLED e o limite voltou integralmente (R$ 60) |
| Configuração | `GET /anticipations/configurations`: `creditCardAutomaticEnabled: false` (sandbox) |

Efeitos no plano: (1) a checagem de limite antes de oferecer parcelas é viável por API; (2) a antecipação por cobrança é viável; (3) estorno do carnê inteiro funciona e devolve o limite; (4) usar 33 dias por parcela na fórmula mantém a folga; (5) o consumo do limite pelo valor de face significa que R$ 70.000 de limite = R$ 70.000 de vendas parceladas antecipadas em aberto.
Não provado no sandbox: split, limite real e carência, renovação do limite quando as parcelas são compensadas, estorno após a antecipação aprovada, chargeback.

---

## 11. Etapa 2, partes 1 a 3: teste do webhook de plateia no sandbox (2026-10-16)

Evento sandbox `[TESTE SANDBOX] Espetáculo Nelson Camargo` (`f8d9451a`), 4 pedidos de 5 ingressos de R$ 20, cartão 3x, pagos no sandbox com o cartão de teste por função temporária (apagada). `create-audience-ticket` só libera 3x quando o ambiente é sandbox; produção segue 1x.

Resultado (pedido 4, após o ajuste de arredondamento): 3 linhas em `platform_commissions` (R$ 38,96 / 38,96 / 38,98), comissão 2,63 + 2,63 + 2,64 = 7,90, taxa 3,00 x 3 = 9,00, líquido 33,33 + 33,33 + 33,34 = 100,00, `card_credit_at` por parcela (17/11/2026, 21/12/2026, 20/01/2027), tickets APROVADOS, assentos vendidos. Estorno do carnê pela Asaas: tickets ESTORNADOS e as 3 linhas marcadas como reembolsadas pelo webhook existente.

Achados de implementação:
- A Asaas só avisa a 1a parcela na confirmação; as demais chegam no crédito (D+32...). Por isso a 1a parcela busca `GET /payments?installment=` e registra já as linhas das outras.
- Fila de webhooks da Asaas é SEQUENCIAL: um 500 trava tudo. Eventos de parcelas irmãs que não são pagamento respondem 200 na hora; a chave estrangeira de `audience_ticket_group_id` é id de ticket (vem do externalReference), não `group_id`.
- Reativar o webhook do sandbox (desligar e ligar) destravou a fila.
- Não testado no app: estorno pelo botão (precisa login do produtor), expiração por cron, e-mails em parcelado, workshop/passe, inscrição, pedido de antecipação, tela.

## 12. Antecipação por API no webhook (sandbox, 2026-10-16)

Pedido 5 (5 ingressos de R$ 20, 3x, R$ 116,90): o checkout consultou `GET /anticipations/limits` antes de aceitar o parcelado; depois da confirmação da 1a parcela o webhook registrou as 3 parcelas, consultou o limite de novo, pediu `POST /anticipations` pelo id do carnê e gravou `anticipation_status=PENDING`, `anticipation_id` e `anticipation_fee=4,12` nas 3 linhas. A taxa real do sandbox (R$ 4,12, 1,7% a.m.) ficou perto da prevista pelo modelo (R$ 3,95 a 1,6%).
Código novo: `_shared/asaas-anticipation.ts` (7 testes), migration `20261016b` (aplicada), tratamento de `RECEIVABLE_ANTICIPATION_*` no webhook (CREDITED muda `card_credit_at` das parcelas para hoje; DENIED/CANCELLED só registram status), checagem de limite no `create-audience-ticket`.
Não provado: evento CREDITED (o sandbox deixou a antecipação PENDING), limite real e renovação em produção, e-mails, comportamento com limite esgotado em produção. Nota: comissão de evento sandbox nasce com `release_at` NULL por desenho (migration 20260925b).

## 13. Workshop avulso e passe em cartão parcelado (sandbox, 2026-10-16)

Passe de R$ 200 (2 workshops, R$ 100 e R$ 120 de referência), 3x, total R$ 238,36 (taxa de pagamento R$ 8,80 + taxa de parcelamento R$ 9,56): 6 linhas de comissão (2 workshops x 3 parcelas), cada inscrição com comissão, taxa e líquido do produtor somando exatamente o pedido (fechamento de centavos na última parcela por inscrição), antecipação PENDING gravada nas 6 linhas. Workshop avulso usa o mesmo molde (1 linha por parcela) mas não foi pago no sandbox.
Mudanças: criação com `installmentCount`/`totalValue`/`totalFixedValue` e `asaas_installment_id` nas duas funções, checagem de limite antes de aceitar, 3x só em sandbox; webhook por parcela, parcelas irmãs e antecipação; e-mails mostram o pedido inteiro. Dados de teste no sandbox: evento `f8d9451a` (2 workshops, 1 passe, inscrições e comissões `[TESTE SANDBOX]`).
Não existe função de estorno nem de expiração de workshop no repositório (estorno é pelo painel da Asaas; o webhook marca cada parcela como reembolsada).

## 14. Respostas da Asaas (chat interno, 2026-10-16/17) e efeitos no plano

| # | Pergunta | Resposta da Asaas | Efeito |
|---|---|---|---|
| 1 | Quando o limite volta | Rotativo: cada parcela antecipada libera o valor dela quando chega a data original de compensação (D+32, D+64...) e é liquidada. Não precisa quitar o carnê todo | O limite de R$ 70.000 é "antecipado em aberto": um passe de R$ 697 em 3x ocupa R$ 697 por até 96 dias, liberando em 3 etapas |
| 2 | Estorno/cancelamento de carnê antecipado | O sistema quita o adiantamento usando o SALDO DA CONTA PRINCIPAL; o limite é restabelecido de imediato, mediante análise interna | A master precisa ter caixa para cobrir o adiantamento de um carnê estornado (hoje saldo da master é da ordem de R$ 200): reserva de caixa, teto por evento e retenção do repasse dessas vendas passam a ser requisito, não opção |
| 3 | Limite insuficiente | Antecipação é sempre pelo valor integral de cada parcela, sem antecipação parcial de um título. Com a automática ativa, o sistema prioriza o que cabe e o restante segue o fluxo padrão, sendo reenviado quando o limite voltar | Nosso desenho (pedir pelo carnê só se o limite cobrir tudo, senão fluxo normal) é compatível. Antecipar só as primeiras parcelas é possível, mas não implementado |
| 4 | Reanálise do limite | Revisões periódicas automáticas (histórico de vendas, tempo de relacionamento); pode ser solicitada reavaliação a qualquer momento, com análise e eventual chamado de aumento | Pedir reavaliação quando o volume parcelado crescer |
| 5 | Carência | Cartão de crédito NÃO tem carência de tempo de conta (basta cadastro/identidade validados e limite). A carência de 45 dias (PJ) / 90 dias (PF) e a janela de vencimento de 8 dias úteis a 90 dias são de boleto e Pix | Pendência de carência fechada para cartão |
| 6 | Estorno em 7 dias de carnê antecipado | "Não há regra especial"; o contrato de antecipação é da principal e o débito do adiantamento ocorre só nela | A pergunta sobre multa de 2% e juros de 4% a.m. (recompra do Termo Aditivo) NÃO foi respondida; manter como pendência |
| 7 | Split na antecipação | O valor destinado à subconta é creditado integralmente no momento da antecipação (após análise e aprovação interna); a taxa é debitada da principal | Confirma por escrito a premissa do plano e das cláusulas 11.11 do Termo v1.9 |

Pendências que restam: multa e juros em recompra, retenção/caixa da master para estornos de carnê antecipado, contador (receita bruta, IOF), advogado (taxa fora do teto de 7%, CDC 52/54-B, Usura, art. 9 do Decreto 13.108), e o teste real em produção.

## 15. Segunda resposta da Asaas (2026-10-17) e efeitos

| # | Resposta | Efeito |
|---|---|---|
| 1 | Cancelamento, estorno ou contestação de cobrança antecipada obriga a devolução imediata do adiantamento. Com saldo na conta, quita na hora; sem saldo e com pendência aberta, incide multa moratória (e juros). O arrependimento de 7 dias é relação de consumo entre comprador e produtor; para a Asaas o serviço de antecipação foi prestado e a taxa de antecipação NÃO é devolvida | Em estorno de venda parcelada a CoreoHub perde também a taxa de antecipação (além do MDR e do R$ 0,49, que já não voltavam). A taxa de parcelamento é devolvida ao comprador (Decreto art. 20, Procon-MG). Custo esperado = taxa de reembolso x ~4% do valor; reservar caixa |
| 2 | Sem saldo, a conta principal fica negativa e deve ser regularizada logo para cessar encargos | Reserva de caixa na master é requisito |
| 3 | POST /anticipations é pedido manual: vale a taxa MANUAL da conta (1,70% a.m.); a de 1,60% é só da esteira automática. Sem IOF discriminado | `anticipationPercentPerMonth` passou de 1,6 para 1,7 (taxa de parcelamento de R$ 697 em 3x sobe de R$ 29,49 para ~R$ 32; ver sensibilidade da seção 3.7) |
| 4 | Análise interna de até 2 dias úteis (cartão); aprovada, o valor cai em até 4 horas úteis | O split da subconta chega ~2 a 3 dias úteis após a confirmação, não "na hora" |
| 5 | Sem mínimo exclusivo de split; vale o mínimo geral de R$ 5,00 por parcela/cobrança e a soma dos splits não pode passar do líquido | Nosso piso de R$ 30 por parcela cobre |
| 6 | É possível estornar uma parcela ou valor parcial de cobrança parcelada já antecipada, com débito proporcional | Hoje o código recusa estorno parcial de carnê; liberar é melhoria possível |
| 7 | Dá para repassar o custo por acréscimo de juros na condição da cobrança ou embutido no preço. NÃO é possível exibir uma linha destacada chamada "taxa de antecipação" (a antecipação é serviço entre o produtor e a plataforma, não o consumidor) | O rótulo ao comprador é "Taxa de parcelamento" (com juros a.m. e CET), nunca "antecipação": conferido nas telas; o Termo 11.10 foi ajustado para não citar antecipação ao comprador |

## 16. Teste real em produção, cartão 3x (2026-10-16): resultado parcial

Carnê de R$ 60 em 3x (CREDIT_CARD), split fixo de R$ 40 para a subconta do Hemer, pagador = cliente de teste com CPF de sócio da empresa, cartão nacional (Mastercard). Função temporária `temp-real-card-3x` criada, usada e APAGADA (local e remota). Estornado no mesmo dia. Custo real: R$ 2,55 (MDR).

| Item | Esperado | Medido |
|---|---|---|
| 1. R$ 0,49 por cobrança | taxa ~R$ 2,58 | **Confirmado:** taxa total R$ 2,55 (R$ 0,85 por parcela, netValue R$ 19,15 cada, R$ 57,45 no total). Se fosse por parcela seria ~R$ 3,57 |
| Estrutura | 3 cobranças de R$ 20 | Cartão cobrou o carnê inteiro na hora: 3 parcelas CONFIRMED em 16/10; crédito em 17/11, 21/12, 20/01/2027 |
| Split | R$ 40 distribuído | R$ 13,33 + 13,33 + 13,34 = R$ 40,00, status AWAITING_CREDIT; mínimo de R$ 5 por parcela atendido |
| 5. Elegibilidade/POST | `anticipable` true, POST aceito | **`anticipable: false` nas 3 parcelas. POST /anticipations recusado (HTTP 400 `cannotAnticipate`): "Não é possível antecipar cobranças em que o CPF do pagador pertence ao quadro societário da empresa"** |
| Estorno do carnê (sem antecipação) | estorna 3 parcelas | POST /installments/{id}/refund: 3 refunds DONE de R$ 20, parcelas REFUNDED, splits CANCELLED (`refundedSplits` null); saldo da master (R$ 194,18) e limite (R$ 70.000) inalterados |
| 2, 3, 4, 6 | split na antecipação, custo, limite, estorno de carnê antecipado | **Sem prova**: a antecipação foi barrada pela regra do quadro societário |

Estado antes do teste: limite de cartão R$ 70.000 disponível, antecipação automática da master desativada, saldo da master R$ 194,18 (R$ 115 devidos ao Tamoios em `low_value_transfers`, saldo livre estimado R$ 79,18).

Efeitos: (1) o pagador do teste não pode ser sócio da empresa, nem o cliente "Cultural Estúdio" com CPF de sócio; vale também como regra de produção (sócio comprando da própria empresa não antecipa); (2) para provar os itens 2, 3, 4 e 6 falta uma cobrança com pagador sem vínculo societário (pessoa que concorde, de preferência com cartão próprio, estornada depois); (3) antes do estorno de carnê antecipado, conferir saldo livre da master (adiantamento ~R$ 55 + R$ 10 de folga).
Sem prova até aqui: chargeback real, multa e juros da recompra, liberação do limite na data de compensação, estorno depois de 7 dias.

## 17. Teste real em produção, cartão 3x COMPLETO (2026-10-18/19)

Carnê de R$ 60 em 3x (CREDIT_CARD), split fixo R$ 40 ao Hemer, pagador sem vínculo societário (Vitória Gabriela Rapassi Martin, cartão próprio), antecipação pedida por API (POST /anticipations pelo id do carnê, 18/10), creditada em 19/10, estornada em 19/10 (POST /installments/{id}/refund). Função temporária apagada (local e remota). Custo real total do teste: R$ 2,05.

| Item | Esperado | Medido (extrato da master, GET /financialTransactions) |
|---|---|---|
| 1. R$ 0,49 por cobrança | taxa ~R$ 2,58 | Taxa de cartão R$ 0,85 x 3 = R$ 2,55 (uma vez, não por parcela) |
| 2. Custo da antecipação | ~R$ 2,10 (1,70% a.m.) | Pedido simulou R$ 2,08; debitado R$ 2,05, só da master (RECEIVABLE_ANTICIPATION_FEE) |
| 3. Split na subconta | integral, até ~2 dias úteis + 4h | R$ 13,33 + 13,33 + 13,34 = R$ 40 transferidos no MESMO dia do crédito da antecipação (19/10); subconta de −2,00 para 38,00 |
| 4. Limite | consome R$ 60 e volta | R$ 70.000 para R$ 69.940 no pedido; voltou a R$ 70.000 na hora do estorno (sem análise perceptível) |
| 5. Elegibilidade/POST | anticipable true | `anticipable` true e POST aceito com pagador fora do quadro societário; com CPF de sócio: HTTP 400 `cannotAnticipate` (16/10) |
| 6. Estorno do carnê antecipado | master debitada | Por parcela na master: −R$ 20 (baixa da antecipação, RECEIVABLE_ANTICIPATION_DEBIT), +R$ 13,33/13,34 (estorno da comissão, o split foi revertido da SUBCONTA para a master) e +R$ 0,85 (PAYMENT_FEE_REVERSAL). Efeito na master: −R$ 60 + R$ 40 + R$ 2,55 = −R$ 17,45. Subconta voltou a −R$ 2,00 |

Achados novos:
- **Taxa de cartão É devolvida no estorno de carnê antecipado** (PAYMENT_FEE_REVERSAL, +R$ 2,55), contrariando a resposta anterior da Asaas. Só a taxa de antecipação (R$ 2,05) NÃO volta, como a Asaas disse.
- **Nenhuma linha de multa ou juros de recompra** apareceu no extrato do estorno (dentro de 1 dia). Percentuais do Termo Aditivo seguem não respondidos; não houve cobrança na prática.
- **O estorno reverte o split da subconta, não da master**: com o split já creditado, o produtor devolve o valor; sem saldo, a subconta fica negativa (voltou a −R$ 2,00, o resíduo anterior de um estorno do Hemer). O risco de caixa da master é só a parte dela (R$ 20 de R$ 60 aqui) mais a taxa de antecipação (R$ 2,05, perdida).
- Prazos: pedido no domingo 18/10, crédito na segunda 19/10 (mais rápido que "2 dias úteis + 4h").
- Regra de produção: pagador sócio da empresa não antecipa (`cannotAnticipate`).
- Sem prova: chargeback real, percentuais da multa/juros de recompra, liberação rotativa do limite na data de compensação (D+32...), estorno depois dos 7 dias, estorno parcial de carnê antecipado.
