# Plano: páginas públicas dos eventos em modo claro

Criado em 2026-11-16. Status: PLANO, nada implementado. Só executar com OK explícito.
Substitui a recomendação "vitrine fica escura" da auditoria de 2026-08-08 (`modo_claro_auditoria_2026_08_08.md`).

## 1. Estado atual (medido no código hoje)

O app interno já nasce claro (`App.tsx`: `localStorage.theme`, padrão `'light'`, classe `.dark` no `<html>`). As páginas públicas ignoram isso: têm cor fixa e nenhuma variante `dark:`.

| Arquivo | Linhas | Cores `[#hex]` | `text-white`/`bg-white/N`/`border-white/N` | `dark:` |
|---|---|---|---|---|
| `pages/PublicEventPage.tsx` (vitrine) | 2486 | 123 | 98 | 0 |
| `pages/CheckoutIngresso.tsx` | 1261 | 26 | 28 | 0 |
| `pages/PublicWorkshopPage.tsx` | 536 | 25 | 24 | 0 |
| `pages/Festivais.tsx` | 555 | 26 | 34 | 0 |
| `components/SeatGrid.tsx` | 440 | 5 | 19 | 14 (já tem variante clara) |

Também fazem parte do fluxo público e não estavam na auditoria: `MeuIngresso` (678), `MeuWorkshop`, `PagamentoSucesso` (228), `LandingEspetaculo` (525), `EventAnchorNav`, `CookieBanner`, `CheckoutLegalNotice`, `SeatLegend`, `SeatZoneSelection`, `SwapSeatModal`, `Leaderboard`, `TermosDeUso`, `PoliticaDePrivacidade`, `EntrarJuri`.

## 2. O que a pesquisa trouxe

**Mercado brasileiro (observado nas capturas de 16/11, não em documentação):**
- Sympla Bileto e Ticket360 usam fundo branco, texto escuro e a cor da marca só no botão principal (Ticket360: laranja). O mapa fica num cartão cinza-claro.
- Estado do assento: Sympla usa verde (livre), cinza (ocupado), azul (selecionado). Ticket360 destaca o selecionado com marca de verificação.
- Cookie banner e rodapé de compra também são claros.
- Não achei documentação da Sympla sobre personalizar tema claro/escuro na página do evento. Não afirmo que ela ofereça isso.

**Técnica:**
- Tailwind v4: variáveis CSS semânticas em `:root` e `.dark`, expostas por `@theme`. Troca `bg-white dark:bg-slate-900` por um único `bg-surface`. Cuidado: `@theme inline` pode congelar a cor e quebrar a troca de tema. Fontes secundárias, confirmar na doc oficial do Tailwind antes de codar.
- WCAG 1.4.3: 4,5:1 para texto normal, 3:1 para texto grande. Texto sobre imagem do produtor: o contraste vale no pior ponto da imagem. Solução comum: camada de sombra (scrim) cobrindo o texto e cor sólida de reserva.
- Cor sozinha não pode ser a única diferença entre assento livre/ocupado/acessível (daltonismo): somar ícone, forma ou rótulo. O GitHub Primer tem temas próprios para daltonismo e reescreveu o contraste do claro.
- Conversão claro x escuro em ingresso: **não encontrei dado nenhum** (nem no Reddit). Não dá pra afirmar que claro vende mais; a decisão se apoia em o mercado brasileiro ser claro, não em dado de conversão.

## 3. Decisões (fechadas em 2026-11-16)

1. **Sempre claro.** Sem botão de alternar para o comprador e sem seguir o tema do aparelho. Motivo: teste feito em 16/11/2026 (Playwright, aparelho em modo escuro e claro) em Sympla, Ingresso.com, Ticket360, Uhuu, Blueticket, Bilheteria Express, Bilheteria Digital e Even3. Nenhuma tem botão de tema na página pública e nenhuma muda de cor com o modo do aparelho. Só a Ingresso.com é fixa escura (marca de cinema). Eventim não carregou no teste. Limite do teste: só a página inicial, sem área logada; busca na web não achou documentação de nenhuma delas oferecendo isso.
2. **Sem tema escolhido pelo produtor.** Não é padrão de mercado.
3. **Sem teste de conversão claro x escuro.** O escuro deixa de existir nas páginas públicas.
4. **Virada do padrão:** subir o código na `dev`, validar na staging e na vitrine do Level Up, e só então levar à `main` com OK (ver 6).
5. **Landings** (`LandingPage`, `LandingGoverno`): ainda em aberto, ver seção 7.

Consequência técnica: como o escuro sai das páginas públicas, não precisa de pares `dark:`. As páginas públicas passam a usar a paleta clara que o app interno já usa (mesmos tons de botão, cartão e borda), via tokens. O `.dark` do app interno continua intacto para quem usa o painel.

## 4. Abordagem técnica

Tokens semânticos em `index.css` (`--surface`, `--surface-2`, `--fg`, `--fg-muted`, `--line`, `--accent`, `--accent-fg`) com valores para `:root` e `.dark`, expostos como utilitários (`bg-surface`, `text-fg`, `text-fg-muted`, `border-line`). Um script de troca mecânica converte os ~300 usos de `text-white`, `bg-white/N`, `border-white/N` e `bg-[#050505]`, depois revisão manual por seção. Não duplicar cada classe com `dark:` à mão em 2.500 linhas: é lento e deixa arquivos com os dois jeitos misturados.

Cores da marca no fundo claro (calculado por mim, validar em ferramenta):
- Magenta `#FF0068` sobre branco dá ~3,9:1. Passa em botão/título grande, **reprova em texto pequeno**. Os 44 `text-[#ff0068]` da vitrine precisam de um magenta mais escuro para texto (algo perto de `#D4005A`, ~5,3:1) e o `#FF0068` fica para botões e fundos.
- Lima `#E3FF0A` e ciano `#1DE7F2` somem no branco. Já existe o padrão `text-[#a8b800] dark:text-[#e3ff0a]`; criar equivalente para o ciano.

## 5. Fases

**Fase 0 — preparação (~1h).** Capturar a vitrine, checkout e workshop atuais (escuro) como linha de base. Decidir os 4 pontos acima. Medir contraste das cores da marca.

**Fase 1 — base (~2h).**
- Tokens e utilitários.
- Travar o claro nas rotas públicas: hoje o `.dark` é aplicado pelo React depois do carregamento e vem do `localStorage.theme`, então um visitante que já usou o painel em escuro veria a vitrine escura. As rotas públicas devem ignorar o tema salvo e a classe `.dark`, sem piscar na cor errada.
- `color-scheme: light` para campos nativos e barra de rolagem.

**Fase 2 — `PublicEventPage` por seção (~4–5h).** Hero com scrim e cor de reserva (banners do produtor são imprevisíveis), `EventAnchorNav`, ingressos e barra do carrinho, inscrição, workshops, programação, info/FAQ, rodapé, modais. Aqui está 70% do risco.

**Fase 3 — checkout e mapa (~3h).** `CheckoutIngresso`, `SeatGrid` (já aceita variante clara, falta casar com os tokens), `SeatLegend`, `SeatZoneSelection`, `SwapSeatModal`. Tipos de assento (PCD, obeso, bloqueado, selecionado) distintos por ícone e forma além da cor. Palco no topo já foi entregue hoje, conferir no claro.

**Fase 4 — demais páginas (~4h).** `PublicWorkshopPage`, `Festivais`, `Leaderboard`, `MeuIngresso`, `MeuWorkshop`, `PagamentoSucesso`, `LandingEspetaculo`, `CookieBanner`, `CheckoutLegalNotice`, `Termos`, `Política`, `EntrarJuri`. Landings (`LandingPage`, `LandingGoverno`) ficam por último e podem sair do escopo se você preferir manter a marca escura nelas.

**Fase 5 — verificação (~3h).** Playwright em 1440x900 e 375x812, sem estouro horizontal e sem erro no console. Verificação automática de contraste (axe). Teste com imagens de capa claras e escuras. Teste com um navegador que tenha `theme=dark` salvo no `localStorage` (a vitrine tem que continuar clara).

**Total: ~15–19h (2 dias).** Versão enxuta (vitrine, checkout, mapa, workshop, Festivais, MeuIngresso, PagamentoSucesso): ~10–12h.

## 6. O que você não perguntou e entra no plano

1. **Visitante com tema escuro salvo** (travar o claro nas rotas públicas, fase 1).
2. **Logos do produtor em PNG branco transparente** somem no fundo branco. Risco real para qualquer produtor que enviou logo clara. Solução: logo dentro de um cartão neutro, ou aviso no upload. Verificar quais logos existem hoje nos eventos reais.
3. **Banners com texto embutido na imagem**: ficam bem num fundo claro ao redor, mas o texto sobreposto da vitrine precisa do scrim.
4. **QR do ingresso** (`MeuIngresso`): precisa continuar com fundo branco e margem. No claro a página inteira passa a ajudar a leitura com o brilho da tela.
5. **Pré-visualização de WhatsApp/redes** (`api/og.ts`): não verifiquei se a imagem gerada depende do tema. Conferir.
6. **Domínio próprio por evento**: mesma vitrine, mesmos tokens. Testar um evento com domínio custom.
7. **Segurança da entrega**: o Level Up vende até 20/12. Validar tudo na `dev`/staging e na vitrine do Level Up antes de levar à `main`, de preferência em horário de pouca venda. Como não há alternância, não dá para subir "desligado": a troca é de uma vez, então a validação precisa ser completa antes do merge.
8. **Staging não isola backend**: testar só layout e leitura. Nenhum teste de compra real.
9. **Telas de palco** (Telão, Marcação, Battle Arena Live) continuam escuras, sem tocar.

## 7. Perguntas em aberto

- Landings (`LandingPage`, `LandingGoverno`) entram agora ou ficam escuras (são páginas de marketing da CoreoHub, não vitrine de evento)? Padrão sugerido: ficam fora desta entrega.

## Fontes

- Tailwind v4 e tokens (guias da comunidade, confirmar na doc oficial): https://playbooks.com/skills/secondsky/claude-skills/tailwind-v4-shadcn · https://openskillindex.com/skills/jezweb-claude-skills-tailwind-theme-builder · https://sharedcontext.ai/skills/external/lohnim/tailwind-v4-dark-mode
- Contraste WCAG e texto sobre imagem: https://webaim.org/articles/contrast/ · https://www.w3.org/TR/WCAG22/
- Primer (GitHub), cor e contraste: https://github.blog/engineering/user-experience/unlocking-inclusive-design-how-primers-color-system-is-making-github-com-more-inclusive/ · https://primer.style/guides/accessibility/color-considerations
- Mapa de assentos e cor: https://seatmap.pro/blog/interactive-seating-charts-for-theaters-and-performing-arts-venues/
- Mercado BR: capturas locais de Sympla Bileto e Ticket360 (16/11/2026, pasta temporária da sessão 5e210432, `scratchpad\pesquisa-mapas\`).
