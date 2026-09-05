# Modelo de Preços CoreoHub — Spec para implementação

> Última atualização: 2026-09-04. Fonte: sessão de mapeamento de concorrentes + análise do caso real "Usualdance Festival 2026". Documentos de trabalho relacionados (Word, não versionados no repo): `\\SERVIDOR\Cultural Estudio\Cultural Estúdio (Driver)\CoreoHub\Concorrentes Coreohub.docx` e `Planos CoreoHub.docx`.

## Status de implementação

**✅ Fase 1 — Fundação (escolha de plano + cobrança adiantada) SHIPADO e validado com pagamento real em 2026-09-04.**

- Migration `20260904_billing_plan.sql` (+ correções `20260904b`/`20260904c`): `events.billing_plan` (comeco/essencial/escala, default comeco) + trigger que deriva `commission_percent` automático do plano (10%/5%/4,5%) — reaproveita 100% do split contínuo já existente (`create-payment-asaas` e afins não precisaram mudar). Coluna travada contra troca self-service via `protect_commission_columns`.
- Edge function `create-plan-fixed-fee-payment`: cobra o componente fixo (Essencial R$250 / Escala R$1.490) **adiantado**, na escolha do plano — mesmo padrão sem-split da taxa de evento gratuito. Gate correto: só roda enquanto `billing_plan = 'comeco'` (cobre inclusive evento antigo que nunca escolheu plano, ex: migração de cliente vindo de outra plataforma).
- Branch `PLANFEE:` no `asaas-webhook` confirma o pagamento e promove o evento sozinho, sem ação manual.
- UI real fica em `components/OnboardingWizard.tsx` (Step 2, "Formato") — **não** em `pages/CreateEvent.tsx`, que é código órfão (importado no `App.tsx` mas nunca roteado; achado testando o fluxo de ponta a ponta). Seletor de plano não pergunta de novo quando já veio definido por `?plano=` (CTA de `/planos`, ou link direto de Escala pós-negociação). Modal de cobrança fecha sozinho via Supabase Realtime (precisou habilitar Realtime na tabela `events`, nunca tinha sido habilitada) quando o webhook confirma — sem clique manual.
- **Validado end-to-end com pagamento real**: evento de teste descartável, plano Essencial temporariamente rebaixado pra R$5 (mínimo Asaas) só pro smoke test, pago de verdade, webhook promoveu `billing_plan`/`commission_percent` sozinho, evento de teste apagado, valor restaurado pra R$250 depois.
- Cliente real aguardando Escala: produtora do **Lyris Dance Competition** (migração da CPL Cloud já feita) — motivou priorizar as Fases 2/3 em seguida.

**✅ Fase 2 — RPC de contagem de participante (Escala) SHIPADO em 2026-09-04.**

- Migration `20260905_event_participant_count.sql`: `get_event_participant_count(p_event_id)` soma `jsonb_array_length(bailarinos_detalhes)` de toda registration paga (competidor, sem dedupe por CPF — ver correção na seção "Regra de contagem de participante") + `workshop_registrations` válidas (cursista, categoria separada). Ingresso de plateia nunca entra. Sem UI própria — só camada de dado, consumida pela Fase 3.
- Validado contra o Usualdance Festival real (42 registrations pagas → 130 competidores + 9 cursistas = 139 participantes) — soma bate exatamente com o esperado.

**✅ Fase 3 — Acerto de fechamento do componente variável (Escala) SHIPADO em 2026-09-04 — ainda sem validação com pagamento real (sem cliente Escala ativo até agora).**

- Migration `20260905b_event_billing_settlement.sql`: colunas `billing_settlement_*` em `events` + RPC `get_event_billing_settlement_preview` (devido real = `LEAST(2×participantes, 4,5%×GMV líquido)` vs. já coletado via split contínuo, usando `platform_commissions`). Corrigiu também um bug nas RPCs da Fase 2/3: faltava liberar `service_role`, sem isso a edge function nunca conseguiria chamá-las.
- Edge function `close-event-billing-settlement` (admin-only): modo preview (sem side-effect) e modo confirm — diferença ≤0 fecha na hora, sem cobrança (crédito eventual vira negociação manual, nunca estorno automático); diferença >0 gera cobrança complementar (sem split, mesmo padrão do componente fixo).
- Branch `PLANSETTLE:` no `asaas-webhook` fecha o acerto sozinho quando a Asaas confirma o pagamento.
- Botão **"Calcular acerto"** no `/super-admin` (só aparece pra evento em Escala) — mostra a prévia antes de qualquer cobrança, fecha sozinho via Realtime quando o pagamento confirma.
- **Pendente**: nunca testado com pagamento real (sem cliente Escala ativo pra gerar dado de verdade). Validar ponta a ponta quando o primeiro evento Escala real (ex: Lyris Dance Competition) tiver dados suficientes de venda pra fechar.

## Posicionamento (decisão do produto, não só de marketing)

A CoreoHub **não compete para ser a mais barata do mercado**. Compete para ser a plataforma com **preço em equilíbrio** — proporcional ao que o evento realmente fatura, sem truques de cobrança (ex: o concorrente Sistema Dance conta em dobro quem dança e também faz curso; a CoreoHub não deve fazer isso). Nenhuma recomendação de preço deve partir de "cortar pra vencer a concorrência por valor" — a vitória vem de transparência + proporcionalidade + features, não de undercut.

## Os 3 planos (o cliente escolhe)

O cliente escolhe um dos 3 planos abaixo — não é um cálculo automático decidindo por trás (ver seção "Mecanismo de cobrança" para o que acontece se o evento crescer além da faixa escolhida).

| Faixa | Fórmula | Faixa de participantes (referência, ticket médio R$50) |
|---|---|---|
| **Começo** | 10% sobre o valor vendido. Taxa mínima R$ 0,00 — só paga se vender. | até 100 participantes (até R$ 5.000 de faturamento) |
| **Essencial** | R$ 250,00 fixo por evento + 5% sobre o valor vendido. | 100 a 2.500 participantes |
| **Escala** | R$ 1.490,00 fixo por evento + R$ 2,00 por participante, **com teto de 4,5% do faturamento total** (nunca paga mais que isso). | acima de 2.500 participantes (a partir de R$ 124 mil de faturamento) |

**Nota de copy (não usar números aproximados com "~" na interface):** os valores acima são referência interna pra engenharia calibrar as faixas — na UI (calculadora, cards de plano), exibir os números redondos e sem til (ex: "100 a 2.500 participantes", "Compensa a partir de R$ 5.000 em vendas"), não "~100" nem "~R$5 mil". Símbolo "~" não é prática comum de copy no Brasil e gera confusão. Ver protótipo visual publicado (mockup HTML da seção de planos, revisado nesta sessão) pro copy final aplicado nos 3 cards.

**Nota de copy (chips "compensa a partir de"):** padronizados em **R$ (faturamento/vendas)**, não em participantes — é a base real da cobrança (% sobre venda), enquanto "participantes" só faz sentido pro leitor se ele souber do ticket médio assumido (R$50), que é uma suposição interna. Essencial: "Compensa a partir de R$ 5.000 em vendas". Escala: "Compensa a partir de R$ 124 mil em vendas".

**Nota de copy (removida):** blocos de copy com cabeçalho tipo "Por que vence [a concorrência]" foram removidos do texto de vendas dos planos — não é vocabulário/prática comum no Brasil. O argumento competitivo de cada plano deve ficar embutido na prosa do "para quem é", não isolado num bloco com esse rótulo.

### Por que o teto do Escala é 4,5% (não 6%)

Com ticket médio de R$50/participante, o componente "R$2,00 por participante" do Escala já equivale a 4% do faturamento. Um teto de 6% (valor usado numa iteração anterior desta spec) fica **acima** da taxa do Essencial (5%), o que quebra a lógica "quanto maior o evento, menor a taxa efetiva" — nenhum evento grande teria motivo real para preferir o Escala. **O teto precisa ficar sempre abaixo da taxa da faixa anterior (5%)** para a progressão fazer sentido. 4,5% garante isso com margem, considerando variação de ticket médio real (eventos podem ter ticket menor que R$50, o que reduziria ainda mais o % efetivo do componente por participante).

**Atenção:** se o ticket médio assumido (R$50) mudar no futuro, este teto precisa ser recalculado — ele não é um número absoluto, é derivado da relação entre as 3 fórmulas.

### Por que a faixa do Escala é "acima de 2.500 participantes" (não 600) — decisão fechada, não reabrir (2026-09-04)

Cálculo de cruzamento entre Essencial e Escala (com ticket médio R$50, `p` = participantes, GMV = 50·p):

```
Essencial = 250 + 2,5·p
Escala    = 1490 + 2·p
```

Igualando: `250 + 2,5p = 1490 + 2p → 0,5p = 1240 → p = 2.480` (R$ 124 mil de faturamento). **O Escala só fica mais barato que o Essencial a partir de 2.480 participantes — não 600.** Conferindo em 600 participantes: Essencial = R$ 1.750, Escala = R$ 2.690 (54% mais caro). Qualquer produtor de 600 a 2.480 participantes que escolhesse o Escala pagaria a mais por engano.

O teto de 4,5% também não resolve a faixa intermediária: ele só passa a valer (fica abaixo da fórmula) acima de 5.960 participantes (`1490+2p = 0,045·50p → p ≈ 5.960`), bem depois do próprio cruzamento com o Essencial.

**Decisão: corrigir a faixa de referência para "acima de 2.500 participantes", não forçar a fórmula do Escala pra caber em 600.** Não existe buraco competitivo real na faixa 600–2.480 que o Escala precise tapar — o Essencial já vence a proposta real do concorrente Sistema Dance nessa faixa (validado no caso Usualdance Festival, ver seção de análise abaixo: Essencial bate o Sistema Dance até R$43/pessoa de ticket médio). Forçar o cruzamento pra 600 (baixando o fixo pra R$550 ou o variável pra R$0,43/pessoa) cortaria receita sem ganhar cliente nenhum, e contradiz o posicionamento "a CoreoHub não compete pra ser a mais barata do mercado" (ver seção Posicionamento). O caso de referência real pro Escala é um festival do porte do Joinville (maior do mundo, 50 mil+ bailarinos), não um evento de porte médio como o Usualdance (300).

## Mecanismo de cobrança: o cliente escolhe o plano, sem troca depois

**Correção importante (2026-09-04):** o cliente escolhe o plano (Começo/Essencial/Escala) — não é um cálculo automático que decide por trás. A ideia de "cobrar sempre a menor das três fórmulas" foi uma iteração descartada nesta spec; não implementar.

**Forma de cobrança: componente fixo cobrado adiantado + split contínuo por transação + acerto no fechamento só do componente variável (decisão fechada, 2026-09-04, revisada com pesquisa de mercado) — não é fatura única pós-evento.**

Uma versão anterior desta spec propunha calcular e cobrar o valor final de uma vez só no fechamento das inscrições, sem cobrar nada por transação em tempo real. **Essa versão foi descartada**: ela reabre o risco de calote que a arquitetura atual (split automático via Asaas, comissão descontada antes do dinheiro chegar ao produtor) foi desenhada pra eliminar — durante todo o período de vendas o produtor receberia 100% na subconta dele, e só depois a CoreoHub tentaria cobrar uma fatura avulsa direto do produtor, sem nenhum valor retido pra garantir o recebimento.

**Correção 2026-09-04 (pesquisa de mercado — modelos híbridos fixo+% de SaaS/marketplace, ex. Chargebee, Flexprice):** uma iteração anterior desta seção ainda deixava o componente FIXO do plano (R$250 Essencial / R$1.490 Escala) só sendo cobrado no fechamento, junto com o acerto do componente variável. Isso reabre exatamente o mesmo risco de calote que a decisão acima já tinha descartado — só que num valor menor: o produtor podia rodar o evento inteiro nesse plano e não ter de onde cobrar o fixo no final. A prática de mercado em cobrança híbrida (fixo + uso) é cobrar o **componente fixo adiantado** (dá o piso de receita previsível e filtra quem não é sério) e deixar só o componente variável pra ser coletado conforme o uso acontece — que no nosso caso já é resolvido pelo split contínuo, com risco baixíssimo porque o dinheiro é descontado antes de chegar ao produtor.

O mecanismo correto é:

1. **Na escolha do plano** (criação do evento): Começo não tem componente fixo (R$0), nada é cobrado do produtor nesse momento. Essencial (R$250) e Escala (R$1.490) cobram o componente fixo **na hora**, via cobrança direta Asaas na carteira do produtor — reaproveitando o mesmo mecanismo de gate já existente pra taxa de ativação de evento gratuito (bloqueia seguir enquanto não pagar).
2. **Durante o período de vendas**, cada transação já sofre split automático via Asaas, igual ao modelo atual — usando a taxa percentual do plano escolhido (Começo = 10%, Essencial = 5%, Escala = taxa provisória, ver pendência abaixo). Isso garante que o componente variável já está sendo coletado sem risco, transação a transação.
3. **No fechamento das inscrições**, quando a contagem real de participantes já é conhecida, o sistema recalcula só o **componente variável** real do plano (relevante sobretudo pro Escala: taxa provisória coletada via split vs. R$2,00/participante real, respeitando o teto de 4,5%) e compara com o que já foi coletado. Começo e Essencial não precisam de acerto nenhum no fechamento — o % já cobriu exatamente o devido, transação a transação, e o fixo do Essencial já foi cobrado no passo 1.
4. A diferença (só no caso do Escala, tipicamente pequena perto do total já coletado) vira um **acerto final** — cobrança complementar (mesmo mecanismo do passo 1) se o valor coletado via split ficou abaixo do devido, ou crédito/estorno se ficou acima.

**Sem troca de plano self-service (correção 2026-09-04 — pesquisa de mercado + decisão comercial).** Uma iteração anterior desta spec permitia o cliente pedir troca de plano a qualquer momento antes do fechamento, com o acerto final reconciliando pelo "plano vigente na data do fechamento" — ou seja, re-tarifando retroativamente o evento inteiro pelo plano novo, mesmo vendas feitas há meses sob o plano antigo. **Essa ideia foi descartada**: não é assim que o mercado trata plan switching. Pesquisa em billing por uso/tier (AWS, Stripe e afins) mostra que a progressão entre faixas é automática dentro de uma mesma tabela de preço (sem o cliente "escolher trocar" nada), e mesmo em planos nomeados de SaaS (Starter/Pro/Enterprise, mais parecido com o nosso caso de 3 planos com fórmulas distintas) a troca — quando existe — vale só **daqui pra frente**, nunca re-tarifa retroativamente o que já foi consumido/vendido sob o plano anterior. Como cada evento é um engajamento único e finito (não uma assinatura recorrente), o desenho mais correto e mais simples de implementar é: **o plano é travado na escolha, vale pro evento inteiro, sem botão de trocar**. Se o evento crescer muito além do esperado, isso vira **negociação manual, caso a caso, com a equipe da CoreoHub** (WhatsApp/admin) — nunca uma feature self-service.

Isso também protege a CoreoHub comercialmente: foi o produtor quem escolheu o plano, não a plataforma decidindo por trás — se ele escolheu Começo, paga 10% até o fim do evento; não há "me arrependi, quero recalcular pra trás" embutido no produto.

Isso resolve a objeção comercial "se meu festival crescer mais do que eu esperava, fico preso no plano errado?" de forma honesta: sim, a escolha vale pro evento inteiro — mas isso é o que protege a CoreoHub de qualquer disputa, e casos excepcionais sempre podem ser negociados manualmente, fora do fluxo automático.

**Pendência de implementação (ver seção "Pendências em aberto"):** o Escala não é naturalmente uma %, então precisa de uma taxa percentual **aproximada** pra aplicar no split contínuo durante o período de vendas (antes do fechamento saber o número real de participantes). Definir esse número (ex: usar o teto de 4,5% como taxa provisória, ou outro valor) antes de implementar o split do Escala.

## Regra de contagem de participante

**Correção 2026-09-04 (achado numa pergunta do produtor — reabre e substitui a regra de dedupe por CPF que estava aqui antes, marcada como "fechada" mais cedo no mesmo dia):**

A versão anterior desta seção dizia que uma mesma pessoa inscrita em várias coreografias contava **1 vez** como participante, com dedupe por CPF — inspirada na proposta do Sistema Dance. **Essa regra foi descartada.** O motivo: o modelo do Sistema Dance é "R$3 por pessoa" — pra eles, dedupe faz sentido, porque a cobrança em si é "por pessoa". O componente do Escala não é assim: é um proxy de porte/uso da plataforma, e:

1. **O produtor já cobra o inscrito por coreografia** — uma 2ª coreografia da mesma pessoa é receita nova de verdade, não uma repetição.
2. **O custo operacional da CoreoHub escala por coreografia**, não por pessoa única — cada coreografia passa pelo júri, cronograma e certificado, independente de quantas outras aquele bailarino também está.
3. **A própria matemática do teto/cruzamento** (seção "Por que a faixa do Escala é...") assume `GMV = 50 × participantes` — só bate com o ticket médio de R$50 se "participantes" for a contagem **crua** (cada vaga em cada coreografia). Aplicar dedupe de verdade quebraria essa calibração pra qualquer evento com muita gente em Duo/Trio/Grupo.
4. Dedupe por CPF também é frágil de implementar (mesma classe de bug de identidade já documentada no Cronograma) e deixa de ser necessário nesse desenho.

**Regra atual**: o componente "R$2,00 por participante" do Escala conta cada **participação** — bailarino × coreografia, soma direta pelo elenco das inscrições do evento, sem dedupe nenhum. Cursista de workshop conta como categoria separada (um segundo serviço, contabilizado à parte, também sem dedupe). **Ingresso de plateia (público geral que compra pra assistir, não compete) continua fora dessa contagem** (decisão fechada, 2026-09-04) — essa receita é cobrada por percentual, dentro do faturamento usado pra aplicar o teto de 4,5%, nunca vira parte do componente fixo "R$2,00 por participante". Motivo: sem essa exclusão, um festival grande que vende muito ingresso de plateia (ex: porte Joinville) poderia escolher o Escala especificamente pra escapar da comissão proporcional sobre a bilheteria — isso cortaria receita justamente nos maiores clientes, o oposto do que o Escala deveria fazer.

Essa regra é irrelevante para Começo/Essencial (cobrança é % sobre o valor vendido, já reflete a realidade financeira automaticamente, plateia incluída, sem precisar contar pessoa nenhuma).

## Calculadora pública (site CoreoHub)

### Objetivo
Lead capture + transparência de preço. Fica na página de planos (ver seção "Hero e página de planos" abaixo).

### Inputs do formulário
1. **Nome do festival** (texto, obrigatório)
2. **Número de coreografias** (número, obrigatório)
3. **Média de bailarinos por coreografia** (número, editável pelo usuário — default sugerido: 5. Não travar em um valor fixo: a mistura solo/duo/trio/grupo varia muito por festival, e travar prejudicaria a precisão da estimativa mostrada ao lead)
4. **WhatsApp** (telefone, com máscara BR, obrigatório)

### Cálculo (client-side, em tempo real conforme o usuário digita)
```
participantes_estimados = numero_coreografias × media_bailarinos_por_coreografia
faturamento_estimado   = participantes_estimados × TICKET_MEDIO   // TICKET_MEDIO = R$ 50 (constante interna, não exposta/editável pelo lead)
```
Selecionar a faixa pela tabela de participantes acima (Começo/Essencial/Escala) — essa é a faixa recomendada, mostrada como rótulo ("seu festival se encaixa no plano Essencial"). O valor mostrado ("quanto você paga") é calculado aplicando a **fórmula dessa faixa recomendada** sobre `faturamento_estimado`/`participantes_estimados` — **não** o mínimo entre as três fórmulas (essa ideia foi descartada, ver seção "Mecanismo de cobrança": o cliente escolhe o plano, o cálculo não decide sozinho por trás). Deixar claro na UI que é uma estimativa pro plano recomendado, e que o cliente pode escolher outro plano se preferir.

### Resultado exibido
Mostrar lado a lado, de forma transparente (reforça positioning de equilíbrio, não desconto):
- **"Seu festival fatura (estimado): R$ X"**
- **"Você paga à CoreoHub: R$ Y"** (fórmula do plano recomendado pelo tamanho estimado)
- Opcional: margem líquida estimada = X − Y
- CTA: "Quero essa proposta" → dispara o submit/salvamento do lead

### Onde salvar o lead
Fonte de verdade: **Supabase** (já é o backend da CoreoHub — usar o Table Editor nativo para visualização interna, sem precisar construir painel novo agora). Tabela sugerida: `calculator_leads`.

Campos sugeridos:
| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid | PK |
| `created_at` | timestamp | default now() |
| `nome_festival` | text | |
| `whatsapp` | text | normalizar formato (só dígitos + DDI) |
| `numero_coreografias` | int | |
| `media_bailarinos_coreografia` | numeric | valor que o usuário ajustou no form |
| `participantes_estimados` | int | calculado |
| `faturamento_estimado` | numeric | calculado |
| `faixa_recomendada` | text | "Começo" / "Essencial" / "Escala" (recomendação pelo tamanho estimado — cliente pode escolher outro plano) |
| `valor_estimado` | numeric | fórmula da faixa recomendada aplicada ao faturamento estimado |
| `origem` | text | utm/referrer, se houver |

**Espelhamento opcional em Google Sheets:** o usuário já disponibilizou uma planilha como editor para acompanhamento manual/comercial (fora do Supabase):
`https://docs.google.com/spreadsheets/d/14TwSppk1kXhCVbbh9Feh8syDhSw8ZNFppbt2o4Tyhb0/edit?usp=sharing`
Sugestão de implementação: Supabase Edge Function (trigger no insert de `calculator_leads`) que também faz um append na planilha via Google Sheets API — Supabase continua sendo a fonte de verdade; a planilha é só espelho pra quem não usa o Supabase no dia a dia. Não usar a planilha como armazenamento primário.

## Hero e página de planos (site)

- **Remover a menção fixa "10%" do hero** — não faz mais sentido isolar um número de uma faixa só, já que existem 3 planos com fórmulas diferentes e o cliente escolhe o que serve pro porte do evento dele. Substituir por mensagem alinhada ao posicionamento de equilíbrio (ex: algo como "você paga proporcional ao que o seu festival fatura, sempre a taxa mais justa pro seu tamanho" — copy final ainda em aberto).
- **Seção "Modelo transparente — Você só paga quando vende"** (decisão desta sessão): a calculadora pública mora numa seção própria, separada dos cards de plano — não duplicar o CTA "Simular meu evento" dentro de cada card. Essa seção mostra o pitch de transparência + um preview da calculadora (inputs: nome do festival, nº de coreografias, média de bailarinos por coreografia, WhatsApp) com o único CTA "Simular meu evento" da página.
- **Seção de planos ao final da página**, mostrando as 3 faixas (Começo/Essencial/Escala) como cards, cada um com CTA próprio: **"Quero esse plano"** pro Começo e Essencial (venda self-service), **"Falar com o time"** pro Escala (venda consultiva, porte grande). Nenhum card usa "Simular meu evento" como CTA — isso fica só na seção da calculadora.
- **Protótipo visual já produzido** (artifact HTML desta sessão, referência de copy/layout final): 3 cards com nome do plano, faixa de participantes, fórmula, chip "compensa a partir de R$X em vendas", "para quem é", frase de venda entre aspas, e o CTA. Sem blocos "Por que vence" (não é prática de copy no Brasil — argumento competitivo fica embutido na prosa).

## Referência: caso real usado para validar os números

Evento real: **Usualdance Festival 2026** (11/jul/2026, Votuporanga-SP, ~300 participantes). Tabela real de inscrição do regulamento oficial (`festival.usualdance.com`):

| Formação | Lote 1 (até 11/mai) | Lote 2 (até 30/jun) |
|---|---|---|
| Solo | R$ 50,00 | R$ 60,00 |
| Duo | R$ 90,00 (R$45/pessoa) | R$ 108,00 (R$54/pessoa) |
| Trio | R$ 120,00 (R$40/pessoa) | R$ 144,00 (R$48/pessoa) |
| Grupo (4+) | R$ 35,00/pessoa | R$ 42,00/pessoa |

Concorrente **Sistema Dance** enviou proposta real para esse mesmo evento (cliente: Hemer Roger Martin): R$ 3,00/pessoa até 800 pessoas, R$ 2,50/pessoa acima de 800, mínimo R$ 600,00/evento — cobrança 100% por pessoa, sem relação com o valor da inscrição. Ponto de equilíbrio calculado contra o Essencial da CoreoHub: os dois empatam quando o faturamento do evento é ~R$ 13.000 (ticket médio ~R$ 43,33/pessoa). Como a maioria das inscrições de festival é em Grupo (R$35–42/pessoa, abaixo do equilíbrio), o Essencial tende a sair mais barato para esse tipo de evento — mas a margem é apertada; a mistura real de solo/duo/trio/grupo pode inverter o resultado eventos a evento (por isso a calculadora usa a mistura real informada pelo usuário, não um número fixo).

**Requisito operacional descoberto no regulamento do Usualdance Festival (não é feature opcional, é pré-requisito pra rodar esse tipo de evento):**
- Tolerância de até 20% dos integrantes de um grupo fora da faixa etária da categoria (arredondando frações para cima) — a categoria do grupo é definida pela idade do integrante mais velho.
- Sistema de lotes de inscrição com datas de corte (Lote 1 / Lote 2).

Confirmar com o time técnico se o produto CoreoHub já suporta essas duas regras exatas antes de prometer a um cliente com esse tipo de regulamento.

**Ponto fraco real do Sistema Dance a explorar em propostas comerciais:** exclusão de arquivos (fotos, músicas, documentos) apenas 10 dias após o evento — agressivo. Eventos com premiação paga em até 30 dias e/ou voto popular com apuração ao vivo (como o Usualdance Festival) ficam em risco de perder mídia relevante antes mesmo do ciclo comercial do evento terminar.

## Mapeamento de concorrentes (resumo — detalhe completo no .docx)

| Concorrente | Modelo | Observação |
|---|---|---|
| Festival Online | R$3/pessoa, mínimo R$1.200 | Maior base instalada do mercado |
| Dança Digital | 10% flat, sem teto | Mesmo % do Começo da CoreoHub hoje |
| CPL Cloud | R$1.000 fixo | Não escala pra baixo em eventos pequenos |
| Sistema Dance | R$3/pessoa até 800, R$2,50 acima, mínimo R$600 | Ver seção de contagem de participante acima |
| Ideal Sistemas | R$6/pessoa (não confirmado publicamente) | Sem presença digital própria localizada |
| Festivalize | Preço não divulgado | Site raso, baixa maturidade digital |
| Cadastro de Festivais | Preço não divulgado ("de acordo com o plano") | Concorrente com produto mais forte: IA de criação de evento, central de músicas, jurado por áudio |
| Danceplace (referência internacional, não atua no BR) | 2% com teto ("fee cap") + Stripe, cashback para +US$50k/ano | Benchmark do modelo de teto usado no Escala |
| Get Dance / WebDança / SisDança / DigiDança | Mensalidade de escola | Concorrência indireta (gestão de escola, não de festival) |

Documento completo com fraquezas/pontos fortes de cada um: `\\SERVIDOR\Cultural Estudio\Cultural Estúdio (Driver)\CoreoHub\Concorrentes Coreohub.docx`.

## Pendências em aberto

1. Confirmar se o produto CoreoHub já suporta tolerância de faixa etária (20%, arredondar pra cima) e sistema de lotes — requisito para o caso Usualdance Festival.
2. Pedir ao Usualdance Festival o número real de inscritos por formação (solo/duo/trio/grupo) para trocar a estimativa por valor exato, se for usado como caso de venda real.
3. Copy final do hero (remover "10%") ainda não escrita — depende de decisão de tom/mensagem.
4. Validar o teto de 4,5% do Escala se o ticket médio assumido (R$50) mudar no futuro — é um valor derivado, não fixo.
5. Fase 1 de implementação: confirmar se a cobrança adiantada do componente fixo (Essencial/Escala) reaproveita literalmente a mesma edge function/gate da taxa de ativação de evento gratuito, ou se precisa de uma variante própria (motivo: valores diferentes, e o gate hoje trava a inscrição do bailarino — aqui precisa travar o próprio fluxo de criação/confirmação do evento pelo produtor).
