# Modelo de Preços CoreoHub — Plano Espetáculo (spec para implementação)

> Última atualização: 2026-09-19. Fonte: sessão de pesquisa de mercado (nicho US de recital ticketing + concorrentes BR) + análise do mapa de assentos real do Centro de Convenções Jornalista Nelson Camargo (Votuporanga-SP, capacidade oficial 373 lugares), usado pelo concorrente direto Guichê Web + pesquisa cross-platform 2026-09-19 (Sympla, Eventbrite, Diversos Ingressos) pra fechar % de taxa, ticket médio e modelagem de sessões/elencos. Companheiro deste doc: [pricing-model-spec.md](pricing-model-spec.md) (planos de Festival — Começo/Essencial/Escala), que **não muda** com esta spec. São dois produtos comerciais distintos dentro da mesma plataforma.
>
> **Nome do plano — decidido 2026-09-18: "Plano Espetáculo"** (nome de trabalho anterior "Mostra" mantido no corpo deste doc onde já escrito, trocar na revisão final antes de codar/publicar — evita colidir com "Mostra Competitiva"/"Mostra Avaliada", terminologia já usada no Terminal de Júri).

## Status

**🟡 Não implementado.** Esta spec formaliza decisões de precificação e escopo tomadas em sessão de planejamento (2026-09-18). Nenhum código, migration ou UI foi criado ainda. Landing/vertical de marketing fica para depois, só quando o resto estiver fechado (decisão explícita do produtor).

## Por que existe um plano separado do Festival

A vertical de Festival (Começo/Essencial/Escala, ver `pricing-model-spec.md`) foi desenhada em torno de gestão de **competição**: júri, apuração, cronograma, premiação. O público de "espetáculo/mostra de fim de ano" (estúdio de dança apresentando o trabalho do ano todo pra plateia de pais/família, sem julgamento) não usa nada disso — usa só bilheteria de plateia (ver "Escopo confirmado" abaixo pro que entra e o que fica de fora). Forçar esse cliente a entender/escolher entre 3 planos pensados pra festival é fricção desnecessária e gera cobrança desalinhada do valor real entregue.

## Concorrente de referência: Guichê Web

Concorrente direto identificado pelo produtor. Roda a bilheteria do Centro de Convenções Jornalista Nelson Camargo (Votuporanga-SP) — mesma praça do Usualdance Festival, o que torna esse mapa um ativo estratégico real (ver seção "Assento numerado" abaixo).

- **Taxa cobrada do produtor**: não divulgada publicamente (nem no site institucional, nem no FAQ do comprador). Prática comum do setor de vender sob consulta comercial — sugere negociação caso a caso, provavelmente por porte de evento.
- **Taxa cobrada do comprador**: "+ taxa" explícito no checkout (ver print de referência: ingresso R$ 35,00 + taxa), modelo de conveniência repassada, igual Sympla.
- **Preço real observado**: espetáculo "29º Espetáculo de Dança — Um Universo de Emoções", ingresso Plateia R$ 35,00 (3º lote), com Plateia PCD no mesmo valor.
- **UX de compra**: ao clicar no ingresso, abre modal flutuante listando as sessões/elencos (ex: "1º Elenco 19.09 — 18h07", "1º Elenco 20.09 — 20h27"), cada uma com seus tipos de ingresso e botão "Escolher lugar" que abre o mapa de assentos daquela sessão especificamente (mapa e disponibilidade são por sessão, não por evento inteiro — faz sentido, pessoas diferentes ocupam os mesmos assentos em sessões diferentes).
- **Ponto de venda**: como não divulga preço/comissão, a CoreoHub pode competir de forma honesta anunciando taxa transparente publicamente — isso já é uma vantagem de posicionamento, independente do número escolhido.

## O plano: único, só percentual (decisão fechada 2026-09-18)

**Decisão do produtor**: ao contrário do Festival (3 planos com fixo+%), a vertical Mostra tem **1 único plano, só percentual sobre o GMV vendido, sem componente fixo** — alinhado à prática universal do setor (Sympla, Lets.events, Guichê Web e concorrentes internacionais todos cobram só %, nenhum usa fixo+% pra bilheteria de plateia simples).

**Por que 1 plano só (não 2-3 como o Festival) — recomendação aplicada:**
O Festival tem 3 planos porque o componente FIXO (R$250/R$1.490) cria quebras de equilíbrio matemático que só fazem sentido com faixas diferentes (ver `pricing-model-spec.md`, seção "Por que a faixa do Escala é..."). Sem componente fixo, não existe essa dinâmica — uma % flat já escala proporcionalmente sozinha (evento pequeno paga pouco, evento grande paga proporcionalmente mais, sem precisar de faixa nenhuma pra isso funcionar). Múltiplos planos só percentuais viraria só "escolha entre 8% ou 6%", que é a mesma decisão que um teto resolveria com menos fricção de escolha pro cliente. **Sem teto de faturamento nesta v1** — nenhum concorrente mapeado (BR ou EUA) usa teto pra bilheteria de espetáculo simples; o teto do Escala existe por causa da dinâmica específica do componente fixo do Festival, que não existe aqui. Revisitar só se aparecer um caso real de evento gigante (tipo o próprio Nelson Camargo lotado, ~500+ lugares) onde a % linear pareça desproporcional na prática.

### Tabela de mercado (referência pra fechar o número)

| Plataforma | Modelo | Taxa efetiva |
|---|---|---|
| Sympla | % + processamento repassado | 10% + 2–2,5% ≈ **12–12,5%** |
| Lets.events | % tudo incluso | **7,99%** |
| Digital Manager Guru | Mensalidade fixa, sem % | 0% comissão + assinatura |
| **Guichê Web (concorrente direto)** | % não divulgada + taxa de conveniência ao comprador | Não público — comentário de mercado de terceiros situa entre **7,99% e 15%**, sem confirmação oficial |
| Plataformas genéricas grandes (Eventim, Ticketmaster, Tickets For Fun) — pesquisa 2026-09-19 | Taxa de serviço + entrega/retirada, várias linhas separadas | Artigos de mercado (Festivalando) citam faixa geral **10% a 20%** — não é o nicho de dança, mas ancora o teto que o mercado brasileiro tolera |
| CoreoHub Festival Começo (referência interna) | % sobre GMV, absorve 100% do processamento | 10% "tudo incluso" |

**✅ 1. FECHADO 2026-09-19 — % da taxa: 7,9% sobre o GMV, sem mínimo, tudo incluso** (mesma política do Festival — CoreoHub absorve 100% do processamento PIX/cartão/boleto). Número final ajustado de 8% pra **7,9%** por decisão explícita do produtor 2026-09-19 — mesmo truque de ancoragem psicológica que o Lets.events já usa (7,99%), efeito quase nulo em receita real mas fica visualmente "abaixo de 8" na cabeça de quem compara preços. Continua **abaixo de toda a faixa de mercado mapeada** (Sympla ~12-12,5%, faixa geral de plataformas grandes 10-20%, estimativa não-oficial do Guichê Web a partir de 7,99%) e **abaixo, ainda que por pouco, do próprio Lets.events**. Contra o Guichê Web (concorrente direto sem preço público), a CoreoHub pode liderar com **transparência de taxa** como argumento de venda, além do número em si — nenhum concorrente mapeado divulga taxa publicamente, isso já é diferencial de posicionamento independente do valor escolhido.

**Negociação individual — decisão fechada 2026-09-19: 7,9% é o número público e fixo na comunicação** (site, calculadora, contrato, onboarding), não abrir negociação caso a caso publicamente — abrir exceção pública mataria exatamente o argumento de "transparência de taxa" que diferencia a CoreoHub do Guichê Web, e reintroduziria a complexidade de faixa que o plano único foi desenhado pra evitar. **Tecnicamente já fica editável por evento sem esforço de engenharia extra**: o Plano Espetáculo reaproveita a mesma coluna que o Festival já usa pra comissão de ingresso de plateia (`events.audience_commission_percent`, protegida por trigger, editável hoje pelo super admin em `/super-admin`) — então o campo de edição já existe de graça, não é feature nova a construir. Uso recomendado: tratar como válvula de escape **interna e excepcional** (ex: estúdio grande tipo Nelson Camargo com múltiplas sessões/ano ameaçando ir pro concorrente, ou parceria estratégica), nunca oferecida como prática padrão pro produtor comum — mesmo padrão de uso que já existe hoje pro Festival.

## `fee_mode` — repassar como default, decisão fechada 2026-09-18

**Confirmado: `fee_mode = 'repassar'` pré-selecionado** (taxa embutida no preço final pago pelo comprador), configurável pelo produtor caso queira absorver — mesmo mecanismo já existente no Festival, sem mudança de arquitetura.

**Por quê (não é só "o mercado faz assim"):** o comprador de ingresso de espetáculo escolar é cativo — vai assistir de qualquer jeito porque o filho está no palco, então uns R$3 de taxa numa entrada de R$35-45 não muda decisão de compra. Já **absorver corta direto na margem do estúdio**, tipicamente pequeno e dependente dessa receita anual pra cobrir custo de figurino/aluguel de espaço/festa de encerramento. Repassar protege o cliente mais vulnerável (o estúdio pequeno) sem gerar fricção real no comprador.

**Nuance de UX a decidir na implementação**: o Guichê Web mostra "+ taxa" como linha separada e visível no checkout — pode soar como "cobrando em cima da apresentação do seu filho", indelicado pra esse contexto. Avaliar embutir a taxa no preço final mostrado (1 número limpo, sem linha "+taxa" à parte) mesmo usando o mecanismo de repasse por trás — diferencial de UX sem mudar quem paga. Confirmar como `repassar` já se comporta hoje no audience ticket do Festival antes de decidir se replica ou melhora esse ponto especificamente pro Plano Espetáculo.

## ✅ 2. FECHADO 2026-09-19 — Ticket médio de referência

Pesquisa em eventos reais de espetáculo de fim de ano de escola/estúdio de dança no Brasil (não existe dado consolidado de mercado — mesma limitação documentada na spec do Festival, mas agora com **2 pontos da mesma praça/mesmo concorrente**, o dado mais forte disponível):

| Referência | Preço observado |
|---|---|
| Espetáculo Escola Livre de Dança (Santos-SP) | R$ 20 (meia/antecipado) – R$ 40 (inteira) |
| Espetáculo "A Calçada da Fama" (Mauá-SP) | R$ 40 (meia) – R$ 80 (inteira) |
| Santa Catarina Dança (mostras diversas) | R$ 20 – R$ 90 (varia por setor/lote) |
| Guichê Web — 29º Espetáculo de Dança "Um Universo de Emoções" (Votuporanga-SP) | R$ 35 (Plateia, 3º lote) |
| **Guichê Web — 27º Espetáculo Academia Almagêmea (Votuporanga-SP, mesma escola/local/plataforma, 27ª edição = prática consolidada, não promocional)** | **R$ 28** |

**Revisão pra baixo em relação à recomendação anterior (R$45)**: os 2 pontos mais fortes que temos — mesma cidade, mesmo concorrente direto, mesmo Centro de Convenções Nelson Camargo (373 lugares, capacidade oficial confirmada via Prefeitura de Votuporanga) — ficam em **R$28 e R$35**, ambos abaixo do que eu tinha recomendado antes de aprofundar a pesquisa. A faixa nacional mais ampla (R$20-90) inclui espetáculos de porte/produção maior (teatro municipal, cenografia mais cara) que não representam o cliente típico do Plano Espetáculo neste momento.

**Decisão: usar R$32 (média simples dos 2 pontos de Votuporanga) como ticket médio interno de referência**, não R$45. Mais conservador, mais defensável (fonte real e recorrente, não estimativa de 1 print isolado), e mais alinhado ao perfil de estúdio pequeno/médio que é o alvo inicial — mesmo padrão de rigor aplicado ao Festival (ticket médio R$50 ali foi calibrado com caso real, Usualdance Festival). Qualquer calculadora pública ou projeção de receita deve usar R$32, ajustável depois que a CoreoHub tiver histórico de venda real próprio.

**Bônus da mesma pesquisa — dado útil pra dimensionar o produto**: o 27º Espetáculo da Almagêmea teve **6 sessões no total** (4 num fim de semana + 2 no seguinte) pra vender a capacidade toda do local (373 lugares/sessão). Isso é um dado real de quantas sessões um estúdio médio-grande precisa pra escoar o público de 1 espetáculo — relevante tanto pra dimensionar a UX de "múltiplos elencos" (pendência 3, resolvida) quanto pra qualquer projeção de receita: 6 sessões × 373 lugares × ocupação realista (não 100%) × R$32 dá uma faixa de GMV bem mais concreta que assumir só 1 sessão.

## Assento numerado — feature de produto compartilhada (não exclusiva do Plano Espetáculo), decisão fechada 2026-09-18

**Confirmado com o produtor**: não faz sentido gatear assento numerado atrás de um tier mais caro — a CoreoHub não compete escondendo feature atrás de paywall (mesmo princípio já registrado na spec do Festival: "vitória vem de transparência + proporcionalidade + features, não de undercut ou gatekeeping"). **Feature disponível pra qualquer evento, sem custo adicional — inclusive eventos nos planos de Festival (Começo/Essencial/Escala), não só no Plano Espetáculo.**

**Escopo ampliado 2026-09-18**: a engenharia (gerador de grade + biblioteca de locais) deve viver na infraestrutura compartilhada de carrinho de ingresso (`CheckoutIngresso.tsx`/`create-audience-ticket`), não presa a nenhum plano comercial específico. Um festival grande (Escala) vendendo ingresso de plateia num teatro/auditório se beneficia igual a um estúdio fazendo mostra própria. Feature de produto, não de comissão.

**Nuance de implementação (não contradiz a decisão acima — é sobre COMO construir, não SE oferecer):** "obrigatório pra todo mundo" quer dizer que a FEATURE fica sempre disponível, mas o uso continua **opcional por evento** — um estúdio que aluga um salão sem cadeiras numeradas fisicamente (ex: tatame, plateia em pé, cadeiras soltas de escola) simplesmente não configura mapa nenhum e vende por setor/quantidade, como já funciona hoje. Quem tem local com poltronas numeradas de verdade (teatro, auditório, centro de convenções) ativa o mapa.

### Avaliação de complexidade (a partir do print real do Guichê Web/Nelson Camargo)

O mapa mostrado é a planta de um **local físico fixo** (fileiras A–N, ~40 poltronas por ala em 2 alas + setor inferior com fileiras A–F, marcação de assento PCD) — não é desenhado do zero por evento, é reaproveitado por qualquer evento que rode naquele espaço.

**Recomendação de arquitetura (não implementar ainda, só a direção técnica):**
1. **Gerador de grade estruturado**, não editor de mapa livre/arrastável. Formulário: nº de fileiras, nomenclatura (A-Z ou 1-N), assentos por fileira (fixo ou variável por fileira), corredor central (opcional, define ala esquerda/direita), assentos marcados como PCD/acompanhante. Cobre o padrão de praticamente todo teatro/auditório/centro de convenções (sempre poltronas em fileira — diferente de festival de música, que tem formatos irregulares).
2. **Biblioteca de locais reutilizável** (entidade `venue`/`local`, não atrelada a 1 evento só): produtor cadastra "Centro de Convenções Jornalista Nelson Camargo" uma vez, com a planta gerada; qualquer evento (do mesmo produtor ou de outro produtor CoreoHub, se abrirmos pra biblioteca compartilhada) que rode nesse local reaproveita o mapa sem recriar. **Valor estratégico real**: Votuporanga é a praça de origem do Usualdance — o primeiro cliente que cadastrar esse local "doa" o mapa pra qualquer próximo estúdio da região que rode lá, virando vantagem competitiva local difícil do Guichê Web replicar (eles vendem o mapa como serviço manual, não como ativo reutilizável entre clientes).
3. **UX de seleção de assento no checkout**: mesma lógica da janela flutuante do Guichê Web (sessão → tipo de ingresso → "Escolher lugar" abre o mapa) — extensão natural do carrinho multi-tipo que a CoreoHub já tem (`CheckoutIngresso.tsx`), adicionando 1 passo de escolha de assento específico em vez de só quantidade.
4. **Disponibilidade por evento, não compartilhada entre elencos** — atualizado 2026-09-18 após confirmar que cada elenco/sessão é seu próprio evento CoreoHub (ver pendência 3, resolvida): mesmo assento físico pode estar livre no evento "1º Elenco sábado" e ocupado no evento "2º Elenco domingo". Como cada elenco já é um `event_id` distinto, a reserva de assento amarra normalmente em `(event_id, seat_id)` — não precisa de chave de sessão nova, o `event_id` já cumpre esse papel.

**Veredito**: moderadamente complexo, mas tratável — o esforço real está na biblioteca de locais + gerador de grade, não num editor visual livre (que seria o caminho caro, tipo Sympla Bileto com suporte humano).

### 🗺️ Fase 2 — Plano técnico detalhado (registrado 2026-09-19, não implementar ainda)

Isto é plano, não implementação — segue o workflow obrigatório do `CLAUDE.md` (feature grande = apresentar abordagem antes de codar). Só entra em execução quando a Fase 1 (bilheteria simples) estiver rodando e aparecer o primeiro cliente real que precise de mapa de assento.

**Pesquisa de mercado/técnica feita em 2026-09-19** (antes só era arquitetura por analogia, sem validar contra padrão da indústria):
- **Seats.io** (líder de mercado em mapa de assento white-label, usado por várias plataformas de ingresso) confirma a separação conceitual do plano: "chart" = planta física reutilizável, "event" = instância que rastreia status separadamente — valida o design `venues` (mapa) vs. ocupação por evento. Modelo de status deles (`free` / `reservedByToken` com hold temporário / `booked` / status customizado) bate com o mapeamento `PENDENTE`/`APROVADO`/`CORTESIA` já usado no resto do CoreoHub.
- **Padrão real de concorrência pra reserva de assento** (não confundir com reserva de estoque por tipo, que é outro problema): o padrão estabelecido em sistemas de reserva de assento é `SELECT ... FOR UPDATE SKIP LOCKED` sobre **linhas físicas de assento**, com um worker agendado liberando holds expirados via `FOR UPDATE SKIP LOCKED` (permite múltiplas instâncias do worker rodarem em paralelo sem processar a mesma linha 2x) — mesmo princípio do cron `expire-pending-payments` que o CoreoHub já roda hoje pra pagamento pendente vencido, só que aplicado a assento.
- **Isso corrige uma decisão do rascunho anterior**: eu tinha evitado criar uma tabela de inventário de assento separada, pra "economizar schema" reaproveitando `audience_tickets` + advisory lock por hash. A pesquisa mostra que o padrão real da indústria prefere **ter mesmo a linha física do assento** pra usar `FOR UPDATE SKIP LOCKED` (mais simples, testado, sem precisar calcular ordem determinística de lock feito à mão). Como a escala aqui é pequena (373 lugares por evento, não milhões como Ticketmaster), o custo de ter essa tabela extra é irrelevante — não é uma otimização prematura, é o caminho mais simples de implementar corretamente.

**Decisão de arquitetura revisada: materializar `event_seats` (1 linha por assento por evento) em vez de derivar de `audience_tickets`.** Gerada automaticamente a partir do `rows_config` do venue no momento em que o produtor liga `seat_map_enabled=true` num evento (ou preenchida sob demanda no 1º acesso ao checkout, tanto faz — é barato, no máximo ~1.000 linhas por evento). Cada linha carrega `status` (`livre`/`reservado`/`vendido`/`cortesia`), `held_until` (timestamp do hold temporário) e `audience_ticket_id` (preenchido quando vira venda de verdade).

**1. Modelo de dados (4 mudanças de schema, todas aditivas)**
- **`venues` (tabela nova)**: `id`, `created_by` (produtor dono), `name` (ex: "Centro de Convenções Jornalista Nelson Camargo"), `city`/`state`, `rows_config JSONB` (array de fileiras: `{codigo: "A", assentos: 40, pcd: [12,13], corredor_apos: 20}` — a mesma estrutura cobre corredor central, ala PCD, fileiras com contagem diferente; refinamento a considerar — ver ponto 6 abaixo), `total_seats` (denormalizado, calculado no insert/update), `is_shared BOOLEAN default false` (produtor pode abrir o local pra outros da mesma praça reaproveitarem — é o "ativo estratégico" já registrado na seção anterior), `created_at`/`updated_at`.
- **`events`**: `venue_id UUID REFERENCES venues(id)` nullable + `seat_map_enabled BOOLEAN DEFAULT FALSE`. Evento comum (Fase 1, setor/quantidade) não toca essas colunas. Evento com mapa liga o toggle e escolhe o venue.
- **`event_seats` (tabela nova, gerada a partir do venue)**: `id`, `event_id`, `seat_id TEXT` (ex: `"A-12"`), `status TEXT` (`livre`/`reservado`/`vendido`/`cortesia`), `held_until TIMESTAMPTZ` nullable, `audience_ticket_id UUID` nullable (FK pra `audience_tickets`, preenchido quando a venda confirma) — **índice único** `(event_id, seat_id)` trava duplicidade de assento na origem.
- **`audience_tickets`**: `seat_id TEXT` nullable — mantido como snapshot legível no ticket (pro QR/PDF/painel mostrarem "Fileira A, Assento 12" sem precisar de join), mas a fonte de verdade da disponibilidade passa a ser `event_seats`, não mais essa coluna.

**2. Fluxo de reserva (padrão `FOR UPDATE SKIP LOCKED`, validado contra a indústria)**
RPC nova (ou extensão da `try_reserve_audience_tickets_v2`) recebe `p_seat_ids TEXT[]` (1 por ticket do carrinho): `SELECT * FROM event_seats WHERE event_id = X AND seat_id = ANY(p_seat_ids) AND status = 'livre' FOR UPDATE SKIP LOCKED` — se o número de linhas retornadas for menor que o pedido, algum assento já foi pego por outro comprador nesse instante exato; a RPC devolve erro específico "assento já reservado" listando quais, pro frontend re-renderizar só esses como ocupados, sem derrubar o carrinho inteiro. Assentos confirmados na query viram `status='reservado'` + `held_until = now() + audience_reservation_minutes` (mesma janela de reserva que já existe hoje pro carrinho comum). Novo cron (irmão do `expire-pending-payments` já existente) libera assentos com `held_until` vencido de volta pra `status='livre'`, usando o mesmo padrão `FOR UPDATE SKIP LOCKED` pra rodar com segurança mesmo se disparar 2x em paralelo.

**3. UX de checkout (extensão do carrinho multi-tipo já existente, não um fluxo novo)**
`CheckoutIngresso.tsx` ganha 1 passo condicional: se `event.seat_map_enabled`, depois de escolher tipo+quantidade aparece "Escolher lugar" (mesmo texto do Guichê Web) que abre um modal com a grade renderizada a partir do `rows_config` do venue — cinza/disponível, rosa/selecionado, cinza-escuro/ocupado, ícone de cadeira de rodas nos assentos PCD. Comprador clica N assentos = a quantidade do carrinho. Sem mapa (Fase 1, maioria dos eventos), esse passo simplesmente não aparece — zero mudança de UX pra quem não usa.

**4. UI de gestão (2 telas novas, produtor/super admin)**
- **Gerador de grade**: formulário (não editor livre) — nº de fileiras, nomenclatura (A-Z ou 1-N), assentos por fileira (padrão único ou por fileira), corredor central opcional, marcar assentos PCD clicando na prévia gerada. Salva como `rows_config` de um `venue`.
- **Biblioteca de locais**: lista dos venues do produtor (+ venues `is_shared=true` de outros produtores, se abrirmos o compartilhamento entre CoreoHub inteiro) — "Usar neste evento" liga `events.venue_id` + `seat_map_enabled=true`.
- **Painel do produtor** (extensão de `VendasIngressos.tsx`): mini-mapa mostrando vendido/disponível por assento, útil pro dia do evento (conferir lotação visualmente) e pra venda no balcão (`create-pdv-ticket` ganha o mesmo seletor de assento).

**5. Esforço estimado (ordem de grandeza, não orçamento fechado)**
Maior que qualquer feature "bundle" recente do changelog, mas não da magnitude de um produto novo inteiro — mais parecido com o carrinho multi-tipo de 2026-05-30 (que levou algumas sessões, incluindo RPC nova + UI de checkout) somado à complexidade extra do gerador de grade + biblioteca de locais. Ordem sugerida de implementação, cada etapa testável isoladamente:
1. Migration (`venues` + `event_seats` + colunas em `events`/`audience_tickets`) + RPC de reserva seat-aware (`FOR UPDATE SKIP LOCKED`) + cron de expiração de hold — sem UI ainda, validável via SQL/curl direto, mesmo padrão de smoke transacional (BEGIN/ROLLBACK) já usado no projeto.
2. Gerador de grade + biblioteca de locais (telas do produtor) — permite cadastrar o Nelson Camargo de verdade e visualizar a grade gerada batendo com o mapa real do Guichê Web (373 lugares, fileiras A-N).
3. UX de checkout (seleção de assento) — último passo, é o que o comprador final vê.
4. Painel/PDV de produtor com mini-mapa — pode ficar pra uma iteração seguinte, não bloqueia lançamento do checkout.

**6. Riscos/pontos em aberto pra quando formos implementar de verdade**
- Biblioteca compartilhada entre produtores diferentes (`is_shared`) é decisão de produto, não só técnica — precisa decidir se o 1º produtor que cadastra o Nelson Camargo "doa" o mapa pra qualquer estúdio da região automaticamente, ou se fica restrito ao próprio produtor por padrão (mais seguro, menos "efeito de rede" imediato). Recomendo nascer restrito (`is_shared=false` default) e abrir manualmente depois — mais fácil abrir depois do que fechar uma feature que já rodou aberta.
- Reembolso/troca de assento (comprador quer trocar de lugar) não tem fluxo desenhado ainda — com `event_seats` como fonte de verdade, `refund-audience-ticket` precisa ganhar 1 passo a mais (voltar a linha correspondente em `event_seats` pra `status='livre'`, não só cancelar o ticket) — não é automático de graça como seria no design anterior baseado em `audience_tickets`, é 1 UPDATE a mais no mesmo fluxo. Troca de assento sem cancelar-e-recomprar continua não coberta.
- Check-in por QR (`CheckIn.tsx`) já existe e não precisa mudar — o QR aponta pro ticket, que já carrega o `seat_id` (snapshot em `audience_tickets`); só a exibição na tela do porteiro ganha "Fileira A, Assento 12" como informação extra.
- **Refinamento de modelagem a considerar** (achado da pesquisa Seats.io): eles distinguem `ROWS_WITH_SECTIONS` (mapa com setores nomeados, ex: "Ala Esquerda"/"Ala Direita"/"Setor Inferior", cada um com sua própria lista de fileiras) de `MIXED` (sem setores). O `rows_config` do plano atual cobre corredor central via `corredor_apos`, mas não nomeia os 2 lados como setores distintos — suficiente pro caso do Nelson Camargo (2 alas + setor inferior, como já descrito no print de referência), mas vale revisitar se aparecer um local com 3+ setores desconectados entre si (ex: mezanino separado do chão) antes de fechar o formulário do gerador de grade.

## Certificado de participação — excluído do escopo, decisão fechada 2026-09-18

**Confirmado pelo produtor: espetáculos de fim de ano não usam certificado de participação.** O modelo real observado é diferente: o **próprio estúdio já dá convite/ingresso gratuito pra família do bailarino**, incluído na mensalidade — não é um documento de participação, é acesso gratuito ao evento.

**Pesquisa feita pra confirmar (2026-09-18):** o padrão existe no mercado americano (várias fontes confirmam "2 convites grátis por bailarino" como prática comum em dance studios), mas lá geralmente vem de uma **"recital fee" separada** (taxa própria do espetáculo, não a mensalidade em si) que já inclui os convites — extras além disso são vendidos à parte (ex: US$20/ingresso adicional). No Brasil não achei confirmação direta de que isso vem embutido na mensalidade — o único exemplo real encontrado (Escola Municipal de Dança de Londrina) vende R$15/R$30 sem menção de cortesia familiar. **Tratar como hipótese a confirmar com um estúdio real, não como prática de mercado brasileira fechada.**

**Implicação pra roadmap (não é decisão, é observação registrada)**: se esse padrão se confirmar no Brasil, pode fazer sentido o Plano Espetáculo ter uma **"taxa de participação do bailarino"** como fonte de receita separada da bilheteria de plateia (paralelo à inscrição do Festival, mas sem competição) — cobrada do bailarino/família, já incluindo N convites grátis, com ingresso pago só pra além disso. Isso reaproveitaria o mesmo padrão de engenharia já usado em `detect_workshop_combo` (detectar que um comprador está vinculado a uma inscrição/participação) pra automatizar cortesia por elenco. **Não implementar sem validar primeiro com um estúdio real.**

## Escopo confirmado (decisão fechada 2026-09-18)

**Fora do escopo do Plano Espetáculo** (funcionalidade de festival competitivo, não se aplica):
- Júri / Terminal de Júri
- Apuração / classificação / medalhas
- Cronograma competitivo (ordem de apresentação com intervalo de segurança por bailarino)
- Telão de palco (nota ao vivo / premiação)
- Seletiva por vídeo
- **Certificado de participação** (ver seção acima)
- **Workshops** — confirmado 2026-09-18: workshop pago vinculado a um espetáculo de fim de ano é **outro produto/evento**, não faz parte do Plano Espetáculo. Estúdio que também vende workshop usa a infraestrutura de workshop do Festival, fora do escopo desta spec.

**Dentro do escopo:**
- Bilheteria de plateia multi-tipo (inteira/meia/solidária), com ou sem assento numerado
- Múltiplas sessões/elencos do mesmo espetáculo (ver pendência de modelagem abaixo)
- Cupom de desconto, cortesia direta (convite gratuito pro elenco/patrocinador — ver nota acima sobre possível automação)
- Credenciamento por QR, PWA instalável
- **Narração IA — confirmado, só pra abertura/transição do espetáculo** (sem a função de "identificar próxima apresentação pra avaliação", que não existe nesse contexto)

## Onboarding — página/fluxo dedicado, fora de `/planos`, decisão fechada 2026-09-18

**Confirmado: o Plano Espetáculo não aparece em `/planos`** (a página de preços do Festival). Vive numa página/fluxo próprio, específico pra estúdio de dança. Razões:
- Mantém `/planos` focado no público de festival — não confunde quem faz mostra sem competição com linguagem de júri/apuração/premiação.
- Separa os dois funis de aquisição já mapeados (estúdio adquirindo do zero vs. produtor de festival existente) — cada um com porta de entrada própria, sem competir por atenção.

**Não implementado ainda** — nome da rota, se reaproveita ou substitui a antiga `LandingEstudios.tsx` (removida do repo, provavelmente na auditoria de código morto de 10/09 — confirmar com o produtor se foi decisão consciente), e onde no `OnboardingWizard`/`CreateEvent.tsx` esse fluxo diverge do de Festival, tudo fica pra quando a landing for desenhada (ver pendência 5 abaixo).

## Pendências em aberto

1. ✅ **RESOLVIDO 2026-09-19 — % da taxa fechada em 7,9%** sobre o GMV, sem mínimo, tudo incluso. Ver tabela de mercado ampliada acima (seção "O plano: único, só percentual").
2. ✅ **RESOLVIDO 2026-09-19 — Ticket médio de referência fechado em R$32** (revisado pra baixo dos R$45 iniciais, com base nos 2 pontos reais da mesma praça/mesmo concorrente — R$28 e R$35). Ver seção "Ticket médio" acima.
3. ✅ **RESOLVIDO 2026-09-18 — Modelagem de múltiplas sessões/elencos do mesmo espetáculo.** Pesquisa de mercado ampliada (não só Guichê Web — foi checado se a limitação era exclusiva de uma plataforma sem foco em dança) cobrindo 4 plataformas reais: Guichê Web, Sympla, Eventbrite e Diversos Ingressos.

   **Rodada 1 — Guichê Web (3 fichas ao vivo, mesma praça de Votuporanga, 2 escolas diferentes)**:
   - `guicheweb.com.br/1º-elenco-luz-camera-acao-e-emocao_15219` e `.../2º-elenco-luz-camera-acao-e-emocao_15279` (Almagêmea, mesma data 20/11, mesmo local Centro de Convenções Nelson Camargo, só o elenco/horário muda)
   - `guicheweb.com.br/circo-dos-sonhos-elenco-3_35787` (Mariana Maricato, mesma praça — confirma o padrão generaliza pra 3+ elencos)
   - Achado: cada elenco/sessão é uma **página de evento inteiramente separada**, URL própria, mapa de assentos próprio, sem link cruzado visível entre os elencos.

   **Rodada 2 — confirmação cross-platform (pra descartar "é só limitação do Guichê Web")**: mesmo em plataforma **com suporte nativo a multi-sessão dentro de 1 evento só**, o padrão observado na prática pra dança continua sendo evento separado por sessão:
   - **Sympla tem feature nativa "Grupos de Ingressos"** (agrupa por data/turno dentro do mesmo evento, até 10 sessões, intervalo mín. 2h entre sessões no mesmo dia) — ou seja, a Sympla OFERECE a alternativa de sessão-dentro-de-1-evento. Mesmo assim, o evento real "1º Cuiabá em Dança (**1ª Sessão**)" (mostra de dança em Cuiabá-MT, sympla.com.br/evento/1-cuiaba-em-danca-1-sessao/2451301) foi cadastrado como evento PRÓPRIO, sessão no nome do evento, não como sub-grupo.
   - **Diversos Ingressos**: "The Dance Show 2025 - Alice no País das Maravilhas - **2º Sessão - Elenco 2**" (evento próprio, `diversosingressos.com`) — a ficha confirma que existem outros elencos/sessões ("Elenco 1" etc.) mas **sem nenhum link cruzado na própria página**, mesmo padrão do Guichê Web.
   - **Eventbrite documenta oficialmente um 3º padrão**, diferente dos dois acima: "se seu evento tiver várias datas/horários com ofertas diferentes, crie **um evento único** com um tipo de ingresso pra cada data (ex: título 'Admissão — Sábado 19h'), especificando a data no título do tipo de ingresso, e ajuste a capacidade de cada tipo pra corresponder ao número de vagas daquela data." Estoque controlado por tipo, não por sub-entidade de sessão.

   **Conclusão — 3 padrões reais coexistem no mercado, e os 3 já cabem no CoreoHub hoje sem schema novo**:
   1. **Evento separado por elenco/sessão** (Guichê Web, Diversos Ingressos, Cuiabá em Dança na Sympla) — é o padrão dos ÚNICOS 2 exemplos reais encontrados que envolvem mapa de assentos físico. Já funciona 100% hoje na CoreoHub, zero migration.
   2. **Sessão como tipo de ingresso nomeado, dentro de 1 evento** (padrão documentado oficialmente pelo Eventbrite) — estruturalmente **idêntico** ao que a CoreoHub já tem hoje: `events.ingressos_config[]` já é um array de tipos, cada um com `quantidade_total` (estoque) e `lotes` próprios. Produtor já pode nomear um tipo "Inteira — 1º Elenco Sáb 19h" e outro "Inteira — 2º Elenco Dom 20h" e o carrinho multi-tipo já existente resolve — zero código novo.
   3. **Sessão como sub-grupo nativo dentro do evento** (Sympla "Grupos de Ingressos") — a CoreoHub não tem esse mecanismo, e a evidência real mostra que nem quem tem essa feature (Sympla) usa muito pra dança na prática, então não é prioridade replicar.

   **Implicação pra Fase 2 (assento numerado)**: como os 2 únicos exemplos reais com mapa de assentos físico encontrados (Guichê Web, Diversos Ingressos) usam o padrão 1 (evento separado), recomendo essa ser a via oficial pra qualquer evento que ative assento numerado — reserva de assento amarra em `(event_id, seat_id)` normalmente, sem precisar de sub-entidade de sessão (ver ponto 4 da seção "Avaliação de complexidade" acima, já atualizado). O padrão 2 (tipo de ingresso nomeado) fica reservado pra quem NÃO usa assento numerado (setor/quantidade simples) — onde já funciona sem nenhuma mudança.

   **Recorte remanescente (baixo esforço, não bloqueante)**: se o produtor quiser 1 vitrine pública única "Espetáculo X" com seletor levando pra cada elenco (UX melhor que os 3 concorrentes pesquisados, nenhum deles oferece isso), isso vira um agrupamento leve e cosmético de eventos relacionados — não obrigatório pro MVP, dá pra lançar sem isso e adicionar depois se algum produtor pedir.
4. 🟡 **AGUARDANDO VALIDAÇÃO COM ESTÚDIO PARCEIRO** — hipótese de "convite grátis pro elenco incluído já no espetáculo" (ver seção Certificado de participação acima). Não dá pra fechar por pesquisa de mercado (já esgotada, sem confirmação direta no Brasil) — precisa de conversa com um estúdio real que rode espetáculo de fim de ano pra confirmar se o convite vem embutido na mensalidade ou é cobrado à parte. Se confirmado, avaliar a feature "taxa de participação do bailarino" com cota de convites automática (ver nota de engenharia já registrada acima, reaproveitando o padrão de `detect_workshop_combo`).
5. **Landing/vertical de marketing** — explicitamente adiada pelo produtor até o resto (plano + escopo + assento numerado) estar fechado. Não iniciar antes disso. Quando começar: confirmar se recria a `LandingEstudios.tsx` (removida) ou é rota nova, dado que "Estúdio" já é termo genérico do segmento de cliente inteiro no produto — não necessariamente o mesmo ângulo do Plano Espetáculo.

   **Nota operacional registrada 2026-09-19**: o produtor vai implementar a landing depois, direto pelo Claude Code desktop (não nesta sessão web). Quando chegar a hora, ele vai pedir um **prompt completo** pra entregar pro Claude Code — que deve instruir explicitamente a ler esta spec (`docs/mostra-pricing-spec.md`) inteira **e** a memória do projeto (`~/.claude/projects/.../memory/`, especialmente `MEMORY.md` + `_operating_manual.md` + `session_resume.md`, seguindo a mesma ordem de leitura obrigatória já descrita no `CLAUDE.md`) antes de desenhar qualquer coisa — pra herdar as decisões de negócio (7,9%, R$32 ticket médio, escopo confirmado, padrão de sessão/elenco) sem precisar redescobri-las. Esta spec já está sendo mantida atualizada exatamente pra servir de fonte única quando esse prompt for escrito.
6. **Nenhuma migration/edge function/UI criada ainda** — esta spec é só o documento de decisão, seguindo o mesmo padrão do `pricing-model-spec.md` do Festival (spec primeiro, implementação depois de aprovação explícita, feature grande = plano em 3-5 bullets antes de codar, conforme workflow obrigatório do `CLAUDE.md`).
7. ✅ **RESOLVIDO 2026-09-19 — Sequenciamento de lançamento confirmado pelo produtor**: o modelo comercial + bilheteria simples (setor/quantidade, sem assento numerado — já pronta hoje, zero migration) vai ao ar primeiro, sem esperar o assento numerado ficar pronto. Assento numerado (item mais caro desta spec, ver "Avaliação de complexidade" acima) vira **Fase 2 explícita**, a ser planejada em detalhe ("quero plano pra assento numerado" — pedido do produtor 2026-09-19) só depois do lançamento inicial estar rodando. Essa confirmação também fechou a pendência 3 (modelagem de sessão): como o lançamento inicial é sem assento numerado, a via recomendada pro MVP é o **Padrão 2** (sessão como tipo de ingresso nomeado dentro de 1 evento, zero código novo) — o Padrão 1 (evento separado por elenco) só entra como recomendação quando a Fase 2 (assento numerado) for implementada.
