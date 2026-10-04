# Contexto de negócio: CoreoHub (usado pelo comando /mentores)

> Atualizado em 2026-10-04. Convenções: **[DADO]** = veio do banco/código/documento do projeto; **[ESTIMATIVA]** = cálculo ou suposição; **[CONFIRMAR]** = só o dono sabe, não assumir; **[DECISÃO ABERTA]** = em discussão.
> Antes de usar um número com mais de 30 dias, conferir se não envelheceu (especialmente custos, taxas do Asaas e regras tributárias).

## 1. Empresa e dono
- CoreoHub: SaaS de gestão de festivais de dança no Brasil (inscrição, pagamento, júri em tablet offline, cronograma, apuração, telão, certificados, ingresso de plateia, workshops, seletiva por vídeo). **[DADO]**
- Estrutura: MEI, um único dono que é também o único desenvolvedor, atendimento e vendedor. Tem outro negócio (Cultural Estúdio, marketing para empresas locais) e produz o Usualdance Festival. **[DADO]**
- Estrutura jurídica ideal, CNAE atual, regime e quem emite NF da comissão: **[CONFIRMAR]** (nunca consultou contador sobre repasse de taxa de processamento).
- Marca: sempre "a CoreoHub" (feminino). Posicionamento declarado: **não competir por ser a mais barata**; vender preço proporcional ao que o evento fatura, com transparência. **[DADO]**

## 2. Meta do dono
- **R$ 8.000/mês de receita da CoreoHub em 12 meses, líquida de imposto e custos fixos.** **[DADO, informado pelo dono em 2026-10-04]**
- Isso exige ~R$ 8.250/mês de receita bruta (~R$ 100 mil/ano), acima do teto do MEI (R$ 81 mil/ano). **[ESTIMATIVA]**
- Se a CoreoHub é negócio principal ou complemento: **[CONFIRMAR]**.
- O dono diz que "o modelo atual não se sustenta no longo prazo" e está redesenhando preços e taxas em sessão paralela. **[DADO]**

## 3. Como ganha dinheiro hoje

**Importante (fluxo de dinheiro):** em venda normal o Asaas faz split na hora. A comissão vai para a conta master da CoreoHub e o resto vai direto para a subconta do produtor. **O valor vendido (GMV) é faturamento do produtor, não da CoreoHub.** Receita da CoreoHub = comissão + taxas fixas + serviços avulsos. **[DADO]**
Exceção: eventos com a flag `absorve_taxa_baixo_valor` (hoje só a Tamoios) geram cobrança sem split; o valor entra inteiro na master e é transferido depois. Risco tributário a validar com contador. **[DADO / CONFIRMAR com contador]**

| Plano | Cobrança | Observações |
|---|---|---|
| Começo | 10% sobre a venda, sem fixo | Plano padrão |
| Essencial | R$ 250 adiantado por evento + 5% | Cruza com o Começo em R$ 5.000 de faturamento (só com inscrição de ~R$ 50; ver pendência de recálculo) |
| Escala | R$ 1.490 adiantado + 4,5% provisório no split, com acerto no fechamento: R$ 2/participante, teto 4,5% | Para eventos acima de ~2.500 participantes; ainda sem cliente real |
| Espetáculo (recital de estúdio) | 7,9% sobre ingresso de plateia, sem fixo | Com assento numerado; ticket médio de referência R$ 32 |
| Evento gratuito | Taxa de ativação por faixa de inscrições | Validada com PIX real |
| Terminal de Júri avulso + Operador | Faixas por nº de apresentações (R$ 500–700 até 50; R$ 900–1.200 de 51 a 100; R$ 1.500–2.000 de 101 a 300) + setup R$ 300–500 + operador remoto R$ 300–500/dia ou presencial R$ 800–1.200/dia | Ferramenta de cotação em `/cotacoes-terminal-juri` |

- Plano trava no evento, sem troca self-service. Se o evento crescer demais, negociação manual. **[DADO]**
- `fee_mode`: `repassar` (default, taxa embutida no preço do inscrito) ou `absorver`. **[DADO]**
- Toda a taxa de processamento (Pix/boleto R$ 1,99; cartão à vista 2,99% + R$ 0,49; 2–6x 3,49% + R$ 0,49; 7–12x 3,99% + R$ 0,49) hoje é **absorvida pela CoreoHub**. Taxa de cartão e Pix **não voltam** no estorno. **[DADO, painel Asaas 2026-10-02 + suporte]**
- Prazos: Pix cai em D+7, cartão em ~D+32. Estorno com split pode falhar na janela de retenção (saldo bloqueado). **[DADO]**

## 4. Receita real até hoje (2026-10-04)

Fonte: banco de produção, `platform_commissions` (sem sandbox) e `standalone_quotes`. **[DADO]**

| Origem | Valor | Observações |
|---|---|---|
| Usualdance Festival (Começo, 10%) | comissão R$ 508,70 sobre R$ 5.087 vendidos | mai–jul/2026; estornos R$ 80; evento é do próprio dono |
| Vicenza Dance Camp 2027 (Lorrayne, Essencial 5%) | comissão R$ 34,85 sobre R$ 731,85 | taxa fixa R$ 250 gerada em 18/09, **não paga** (tolerância de 7 dias do gate); venda de cartão libera em 19/10 |
| II Mostra de Tamoios (Danielle, Essencial 5%) | comissão R$ 11,75 sobre R$ 235 | taxa fixa R$ 250 **paga**; absorve taxa de baixo valor (sem split) |
| Terminal de Júri avulso, Ecodança (Bheto) | R$ 600 | pago por PIX em 31/07; operador como cortesia; cobra diferença se passar de 50 apresentações; Bheto quer migrar o evento inteiro |
| **Total aproximado desde o início** | **~R$ 1.400** | R$ 555 de comissão + R$ 250 de taxa fixa + R$ 600 de avulso |

- Por mês (comissão): mai R$ 177, jun R$ 318, jul R$ 14, set R$ 35, out R$ 12. Receita é concentrada num único evento. **[DADO]**
- Linhas de ingresso de plateia em `platform_commissions`: **zero**. **[DADO]**
- Método de pagamento (amostra ~48 pagamentos, quase tudo Usualdance com ticket R$ 50–100): Pix ~92%, boleto 2, cartão 2. Ticket alto tende a cartão (n=1). **[DADO, amostra pequena]**
- Pipeline: Princess Dance Festival (Déborah, Osasco) recebeu cotação de R$ 1.100 (Terminal R$ 600 + operador R$ 500). **Não fechou**; não contar como receita. **[DADO / informado pelo dono]**
- Lyris Dance Competition (Lorrayne) migrou da CPL Cloud (R$ 1.000 fixo); evento Vicenza ainda tem receita pequena registrada. **[DADO]**

## 5. Custos fixos mensais (informados pelo dono em 2026-10-04)
- Supabase Pro: R$ 130. Vercel: plano gratuito. ElevenLabs: não assina. Domínios + Hostinger: ~R$ 20. DAS MEI: R$ 76. **Total ~R$ 226/mês.** **[DADO]**
- Custo do dono (tempo): R$ 0 de pró-labore hoje; custo de oportunidade ~R$ 8.000/mês. **[ESTIMATIVA]**
- Gemini e outros custos variáveis: baixos hoje; **[CONFIRMAR]** valor real de fatura.
- Risco de egress/Supabase: janela de carência venceu em 12/08 sem novo alerta. **[DADO]**

## 6. Público e mercado
- Clientes: produtores de festivais e mostras de dança, estúdios que fazem recital, e (expansão) editais públicos (landing `/governo`). **[DADO]**
- Mercado dimensionado por estimativa própria (sem censo): ~2.000 eventos/ano, 55% com ingresso pago, 380 ingressos × R$ 32 → TAM R$ 1,34M/ano de receita a 10%; SAM R$ 535 mil; **SOM ~R$ 64 mil/ano em 3–5 anos** a 10% sobre bilheteria. **[ESTIMATIVA, 2026-08-18; número de eventos/ano é o mais incerto]**
- Canal de aquisição: 100% contato direto por WhatsApp, pesquisa via Claude Code e Instagram da CoreoHub. Sem orçamento de marketing. **[DADO]**
- Capacidade de atender mais clientes sozinho: **[CONFIRMAR]**.

## 7. Concorrentes (conferidos pelo dono)
| Concorrente | Modelo |
|---|---|
| Festival Online | R$ 3/pessoa, mínimo R$ 1.200 |
| Sistema Dance | R$ 3/pessoa até 800, R$ 2,50 acima, mínimo R$ 600 |
| Dança Digital | 10% flat |
| CPL Cloud | R$ 1.000 fixo |
| Ideal Sistemas | R$ 6/pessoa (não confirmado) |
| Cadastro de Festivais | preço não divulgado; produto forte (IA, central de músicas, jurado por áudio) |
| Sympla (ingresso) | ~12–12,5% (10% + 2–2,5% processamento); piso R$ 3,99 até R$ 39,90 |
| Guichê Web (ingresso/espetáculo) | taxa não divulgada, estimada 7,99–15%; cobra processamento do comprador |
| Eventbrite | ~6,5% + taxa fixa (referência antiga) |
| DanceBug / CompetitionSuite (EUA) | comissão 4–7% / SaaS mensal US$ 99–499; CompetitionSuite cobra por performance (US$ 2–10) |

Pesquisa de mercado de ingressos: Sympla e Eventbrite repassam ao produtor 3–5 dias úteis **depois** do evento; a CoreoHub repassa antes (Pix D+7, cartão ~D+32), o que gera risco de caixa em estornos. **[DADO]**

## 8. Decisões abertas ou frágeis (o que mais interessa ao conselho)
1. **Modelo de taxas e processamento em redefinição** **[DECISÃO ABERTA]**: fórmula proposta e aprovada em linhas gerais: linha de processamento paga pelo comprador = `min( max(custo real Asaas, p% × base), 7% × base )`, com p = Pix 4% / cartão à vista 4% / 2–6x 5% / 7–12x 6% (propostas variaram; ver memória `decisao_processamento_comprador_2026_10_02`). Inscrição de festival: Pix com preço fechado e cartão com taxa (Essencial/Escala), com a CoreoHub absorvendo o Pix; Começo segue 10% tudo incluso. Nada implementado ainda; depende de Asaas (taxas em split, estorno) e de revisão do Termo do Produtor (atualizar uma vez só).
2. **Margem nula em alguns cenários** **[ESTIMATIVA]**: Escala (R$ 2/participante) ≈ zero de margem variável em cartão de R$ 50; Espetáculo 7,9% perde dinheiro em Pix abaixo de ~R$ 25; Essencial em Pix de R$ 40 fica ~zero.
3. **Competitividade**: inscrição acima de ~R$ 39/pessoa fica mais cara que Festival Online e Sistema Dance. Teto por participante no Começo (R$ 4–5) segue em aberto desde 08/09.
4. **Seleção adversa Começo × Essencial**: o Essencial não tem acerto de fechamento; produtor que escolhe Essencial e fatura muito paga menos que no Começo; não há qualificação antes. Observando antes de mudar.
5. **Regulatório**: Decreto 13.108/2026 (meia-entrada, art. 7 discriminação de taxas, art. 9 proporcionalidade), CDC art. 49 (arrependimento de 7 dias dentro da retenção do repasse), leis estaduais (AC e RR proíbem taxa online; ES exige canal sem taxa; AL e RJ teto 10% do valor de face; PR teto 20%). O dono aceitou o risco do art. 9º sem parecer jurídico. **[DECISÃO ABERTA / CONFIRMAR com advogado]**
6. **Risco de caixa**: estorno de venda dentro da retenção pode falhar; taxa de cartão não devolvida fica com a CoreoHub; sem caixa próprio para antecipar cartão. Retenção parcial do repasse de produtor novo está pendente de decisão.
7. **Tributário**: MEI estoura com a meta; CNAE de intermediação não é permitido ao MEI; repasse sem split da Tamoios.
8. **Dependência de uma pessoa** (dono = dev, vendedor, suporte): triggers de segurança inoperantes foram corrigidos em set/2026; testes de integração Asaas ainda manuais.
9. **Conflito de papéis**: o dono é fornecedor e produtor do Usualdance; paga o mesmo plano dos demais. Hoje o Essencial compensa mais que o Começo que ele usou em jul/2026.
10. **Terminal de Júri avulso** rende mais por venda que a comissão do Usualdance inteiro, mas exige tempo do dono e há gap de cadastro manual sem Wizard.

## 9. Restrições
- Um desenvolvedor; qualquer feature nova compete com atendimento e vendas. Evento de produtor não tem staging de backend (staging usa o mesmo Supabase e Asaas de produção).
- Termo do Produtor só pode ser atualizado uma vez (obriga reaceite). Alterações de preço precisam respeitar "preço em equilíbrio" e transparência públicas.
- Regra interna: Plano Espetáculo tem preço público fixo (7,9%), sem negociação pública.

## 10. Lacunas ainda abertas (os mentores devem listar quando forem relevantes)
- Receita mensal de que o dono precisa para virar negócio principal e prazo de decisão: **[CONFIRMAR]**
- Regime tributário alvo, contador, CNAE: **[CONFIRMAR]**
- Capacidade de atendimento e meta de nº de produtores em 12 meses: **[CONFIRMAR]**
- Valor real de faturas de Supabase/Gemini no último mês, e pagamento da taxa fixa da Vicenza: **[CONFIRMAR]**
- Resposta final do Asaas sobre taxa de cartão/Pix no estorno e antecipação por subconta: **[CONFIRMAR]**
- Opinião real de Lorrayne, Danielle e Bheto sobre preço: **[CONFIRMAR]**
