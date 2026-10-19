# Plano: assento e ingresso para pessoa obesa (e nome na legenda)

Data: 2026-10-19. Branch: dev. Status: PLANO. Nada implementado, nada aplicado, nada deployado.
Nao commitar este arquivo sem o OK do produtor.

## 1. Por que existe

O mapa oficial da Secretaria de Cultura de Votuporanga ("Mapa auditorio-teatro C.Convencoes", PDF de 2010 segundo os metadados) marca com o rotulo "Obeso" os lugares L1, L34, E1, E26, C1 e C24. Isso confirma que o icone ⇔ do mapa da Guiche Web significa assento para pessoa obesa. No banco esses 6 lugares ja existem como `seat_tipo = 'pcd_largo'`.

Lacunas no sistema hoje:
1. O nome exibido e "Assento PCD (largo)" (`SEAT_TIPO_LABEL` em `utils/seatTipo.ts`, legenda em `components/SeatLegend.tsx`, `SeatGrid`, `Venues.tsx`, e-mails/ingresso/check-in). Para o comprador e para a portaria o nome correto e "Assento para pessoa obesa (largo)".
2. Esse lugar so abre com ingresso PCD (`ticketSeatKind` devolve `comum | pcd | acompanhante`; `validate_seat_cart` trata cadeirante e pcd_largo juntos como "especial"). Uma pessoa obesa que nao e PCD nao tem como comprar um lugar largo. Hoje o unico caminho seria comprar um ingresso "PCD".
3. Nao ha tipo de ingresso proprio, nem regra de acompanhante para o lugar largo (os vizinhos L2, L33, E2, E25, C2, C23 ja estao cadastrados como `acompanhante`).

## 2. Base legal e tecnica (o que a pesquisa sustenta, e o que nao)

Pesquisa de 2026-10-19 (fontes secundarias; os textos oficiais nao foram abertos por mim, so trechos de busca):
- Decreto 9.404/2018 (altera o art. 23 do Decreto 5.296/2004): em locais de ate mil lugares, 2% de espacos para cadeirantes e 2% de assentos para pessoas com deficiencia ou mobilidade reduzida; e 50% desses assentos reservados devem ter dimensao e estrutura para pessoa obesa conforme norma da ABNT. Se nao houver procura comprovada, podem ser ocupados por quem nao tem deficiencia/mobilidade reduzida (excepcionalmente). Fonte: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/decreto/d9404.htm (aparece em resultado de busca; nao abri o texto).
- STF validou lei do Parana que reserva 3% dos assentos de cinemas e teatros para pessoas obesas (obesidade nao e juridicamente deficiencia, mas e questao de saude publica). Lei estadual; nao substitui a federal. Fonte: https://portal.stf.jus.br/noticias/verNoticiaDetalhe.asp?idConteudo=496359&ori=1 e https://www.migalhas.com.br/quentes/375845/stf-valida-lei-do-pr-que-reserva-assentos-a-pessoas-obesas (trechos de busca).
- Meia-entrada (Lei 12.933/2013): nas fontes achadas, beneficiarios sao estudantes, PCD (e acompanhante) e jovens de baixa renda. Nenhum trecho inclui pessoa obesa. Nao encontrei norma que conceda nem que negue. NAO PROVADO; perguntar ao advogado.
- NBR 9050: peso de 250 kg e largura de 75 cm aparecem em editais, nao no texto da norma. O percentual e a largura minima precisam ser conferidos na norma (ABNT) ou com parecer tecnico.
- Contagem do mapa vs exigencia: o mapa tem 7 espacos de cadeirante (DF) e 6 lugares "Obeso" em 373 lugares. A pesquisa juridica anterior (memoria `pesquisa_juridica_decreto_13108_2026_09_25`) chegou a 8 espacos de cadeirante + 8 assentos PCD/MR (4 com dimensao para obeso). Pode haver diferenca com a exigencia; isso e para o advogado, nao se resolve em codigo.
- Mercado: nao achei como Sympla, Guiche Web, Ingresse ou Bilheteria Express vendem lugar para obeso (se ha tipo de ingresso proprio). Lacuna de pesquisa. Perguntar a Monique/producao o que ela ve na Bilheteria Express.

## 3. Proposta (a confirmar antes de codar)

A. Nome: manter o valor `pcd_largo` no banco (evita migrar dados e constraint) e mudar so o rotulo exibido para "Assento para pessoa obesa (largo)" em `SEAT_TIPO_LABEL`, `SeatLegend`, `SeatGrid` (title/aria), `Venues.tsx` (ferramenta de pintura), ingresso (`MeuIngresso`), lista de compradores e check-in. Avaliar se o valor interno deve virar `obeso` (mais limpo, exige migration do CHECK e dos dados dos venues) ou continuar `pcd_largo`.
B. Tipo de ingresso proprio: `ingressos_config[].assento_tipo` ganha `'obeso'` (alem de `comum | pcd | acompanhante`). `ticketSeatKind` (front e `_shared/seat-rules.ts`) reconhece `obeso` por campo explicito ou pelo nome ("obeso", "obesidade", "assento largo"). O ingresso `obeso` ocupa so lugar `pcd_largo`; o ingresso `pcd` passa a ocupar so `cadeirante` (a confirmar: PCD pode tambem sentar em lugar largo?).
C. Servidor: `validate_seat_cart` e `hold_event_seats` ganham `p_obeso_qty`; o lugar largo so com ingresso `obeso` (ou `pcd`, se a decisao 2 permitir) e passa a abrir para venda geral pela mesma regra de liberacao (24 h e sala esgotada). Acompanhante do lugar largo reaproveita o tipo de ingresso `acompanhante` e os vizinhos ja cadastrados.
D. Front: checkout e PDV oferecem o ingresso para obeso; o mapa trava lugar largo sem ingresso adequado com mensagem clara; legenda e texto explicativo ("assento com largura e estrutura reforcadas; comprovacao nao e exigida na compra") a validar com o advogado.
E. Meia-entrada: nenhuma automatica (o produtor define o preco do ingresso para obeso).

## 4. Decisoes para o produtor

1. Rotulo interno: manter `pcd_largo` (so mudar o texto) ou renomear para `obeso`?
2. Pessoa com deficiencia tambem pode comprar lugar largo? (hoje cadeirante e pcd_largo se misturam no `pcd`).
3. Haver ingresso `obeso` na venda publica sem comprovacao, so com texto de aviso? (padrao: nao exigir na compra; confirmar com advogado).
4. Esses lugares tem preco igual ao comum ou o produtor define (ex.: mesmo preco da plateia)?
5. Acompanhante de pessoa obesa: reutilizar o ingresso `acompanhante` e os vizinhos?

## 5. Impacto no codigo (levantamento por leitura; reconferir antes de codar)

- `supabase/functions/_shared/seat-rules.ts` (`ticketSeatKind`, `countPcdTickets`, `alignSeatsToItems`, `effectiveTicketKind`) e `tests/seat-rules.test.ts`.
- Migrations `20260927_seat_tipos.sql`, `20260927c_acompanhante_ticket.sql` (funcoes `validate_seat_cart`, `hold_event_seats`, `seat_general_release_open`) e a mais recente `20261016_seat_block.sql` (o bloqueio de lugares recusa especiais; nao muda).
- Edge: `create-audience-ticket`, `create-pdv-ticket` (mesmo arquivo que o bloqueio de lugares esta alterando: coordenar a ordem para nao sobrescrever deploys).
- Front: `utils/seatTipo.ts`, `utils/seatSelection.ts`, `components/SeatGrid.tsx`, `components/SeatLegend.tsx`, `pages/CheckoutIngresso.tsx`, `pages/VendasIngressos.tsx`, `pages/Venues.tsx`, `pages/MeuIngresso.tsx`, `pages/CheckIn.tsx`, `AccountSettings.tsx` (campo "Tipo de assento" do tipo de ingresso).

## 6. Testes e rollout (esboco)

Vitest para `ticketSeatKind` com `obeso`, `alignSeatsToItems`, selecao; smoke transacional (BEGIN/ROLLBACK, alvo travado no evento de teste `752366ed-6e90-44e7-bec5-1cee38031503`) para `validate_seat_cart`/`hold_event_seats` com `p_obeso_qty`; Playwright (1440x900 e 375x812) em evento de teste, id travado antes de qualquer clique. Ordem: migration, edge, front; edge nao tem staging; so com OK explicito por etapa.

## 7. Regras de trabalho

Plano em 3 a 5 bullets e aguardar OK antes de codigo; branch dev; nada em producao sem OK; `git add` por nome; nao tocar nos arquivos de outras sessoes; "a CoreoHub" no feminino; sem emojis em codigo.

## 8. Execucao (2026-10-19) e pesquisa

Status: IMPLEMENTADO na dev (commit abc8a37). Decisoes do produtor: 1 a 5 = recomendacao (manter pcd_largo no banco e mudar so o rotulo; PCD continua abrindo cadeirante e largo; ingresso obeso sem comprovacao na compra; preco definido pelo produtor; acompanhante reaproveita o ingresso Acompanhante e os vizinhos).

- Migration 20261019_seat_obeso_ticket.sql aplicada (validate_seat_cart e hold_event_seats com p_obeso_qty DEFAULT 0). Migration do bloqueio (20261016_seat_block.sql) aplicada depois, junto com as edges block-seats e create-pdv-ticket.
- Edges deployadas: create-audience-ticket, block-seats, create-pdv-ticket.
- Validado: smoke SQL em rollback (9 casos), Playwright no checkout (evento de teste 752366ed, desktop+mobile, 0 erros), PDV pelo servidor (obeso em cadeirante recusado; obeso L-1 + acompanhante L-2 aprovado, depois revertido). Falta: clicar o PDV na tela.
- Texto oficial do Decreto 9.404, art. 23 (planalto.gov.br, lido em 2026-10-19): par. 2 = 50% dos assentos reservados a PCD ou mobilidade reduzida (item b, 2%) devem ser para obeso, minimo 1; par. 3 = acompanhante ao lado. Lei 13.146, art. 3, IX inclui obeso em "mobilidade reduzida". O texto nao traz regra de arredondamento (2% de 373 = 7,46): a conta 8+8 da pesquisa anterior assume arredondar para cima; levar ao advogado junto com 7 cadeirantes / 6 obesos do mapa.
- Mercado (confianca baixa): so achei a Sala Sao Paulo/Osesp (14 lugares para obesos, venda so pelo site, telefone de apoio). Nao achei como Sympla, Guiche Web, Ingresse ou Bilheteria Digital tratam; nenhum projeto no GitHub (busca de codigo em 2026-10-19) modela assento de obeso; Reddit/Reclame Aqui sem resultado. Padrao de mercado para acompanhante (Wintix, ThunderTix, BAFTA): so junto do assento especial.
- Meia-entrada: obeso nao consta na Lei 12.933 nas fontes achadas; sem meia automatica.
