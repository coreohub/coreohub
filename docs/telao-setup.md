# Telão de Palco — setup no dia do evento

O Telão de Palco é uma **fonte única e passiva**: uma URL pública em tela cheia
que mostra a coreografia ao vivo e revela a **média final** assim que o último
jurado fecha a nota. O operador do LED corta pra essa tela quando quiser (no
mixer/HDMI dele). Ela roda em **qualquer proporção** (LED 3:1, projetor 16:9,
datashow 4:3) — o layout se ajusta sozinho.

## Padrão de equipamento (recomendado)

**Notebook ou mini-PC com Chrome → cabo HDMI → processador de LED (Novastar /
Colorlight) → painel.** O processador entrega o painel pro computador como se
fosse um monitor; a página preenche `100dvw × 100dvh` seja qual for a resolução.

- **Recomendado:** notebook/mini-PC + Chrome em tela cheia. Confiável, atualiza,
  não dorme.
- **Aceitável:** TV Box Android / Smart TV (navegador pode dormir/travar — evite
  em evento crítico).

## Passo a passo

1. No painel do produtor, abra **Operação → Telão de Palco** e clique
   **Ativar telão**. Um **código curto** aparece (ex: `USUAL7`).
2. No computador ligado ao LED, abra **`app.coreohub.com/telao`** e digite o
   código. Pressione **F11** (ou o botão "Tela cheia") pra ocupar o painel
   inteiro. Se o processador expõe o painel como um monitor 3:1, o F11 já
   encaixa; senão, redimensione a janela do navegador até casar com a área do LED.
3. Antes das portas abrirem, use **Testar telão** (no painel) pra jogar um
   scorecard de exemplo e **ajustar o tamanho da janela** ao painel (ex: 6×2 m).
4. Durante o evento: ao clicar **Iniciar** numa coreografia no **Cronograma**, o
   telão mostra "aguardando" com os jurados daquela apresentação. Quando o
   **último jurado fecha a nota**, a média aparece sozinha.

## Comportamento

- **Aguardando:** mostra os jurados esperados com ✓ em quem já fechou e o
  contador "N de M jurados". Nunca mostra média pela metade.
- **Resultado:** nota de cada jurado (nome neutro, sem foto) + **média final**
  grande. **Sem medalha ao vivo** — medalha/classificação dependem do ranking
  final da categoria e saem na premiação (evita antecipar resultado).
- **Jurados esperados** = jurados ativos do produtor cujas competências cobrem o
  estilo da coreografia (mesma regra do terminal do júri). Jurado com
  competências vazias avalia tudo.

## Modo Premiação (pódio + prêmios)

A **mesma URL/telão** tem dois modos, trocados no painel (**Operação → Telão de
Palco → Modo do telão**). O computador do LED não muda nada.

- **Ao vivo:** o placar nota/média por apresentação (acima).
- **Premiação:** a tela lista **os prêmios que você cadastrou** (Resultados →
  Premiação) e você **revela um por vez** pela cerimônia. Cada prêmio é resolvido
  automaticamente pelo tipo (detectado pelo nome/descrição):
  - **Faixa de medalha** (Troféu Ouro/Prata/Bronze) → lista as coreografias na
    faixa de média do evento (ex: Ouro ≥ 9,0), festival inteiro, por média.
  - **Maior Nota do Festival** → a coreografia de maior média.
  - **Deliberação** (Melhor Bailarino/Coreógrafo…) → o mais votado pelos jurados.
  - **✋ Escolher na mão** → você seleciona a coreografia vencedora (ex: Troféu
    Voto Popular, que vem de plataforma externa). Disponível em qualquer prêmio.
  - **Limpar telão** volta pra tela neutra.

Nada aparece na plateia até você clicar — você controla o ritmo. Faixas e Maior
Nota saem das notas dos jurados; deliberação, da votação — mesma fonte da
Apuração e da Premiação. As faixas usam o sistema de medalha do próprio evento
(`medal_thresholds`).

## Segurança / encerramento

- O telão mostra só **média agregada** (sem CPF ou dado sensível).
- **Desativar** ou **Gerar novo código** a qualquer momento no painel — o código
  antigo para de funcionar e a URL pública passa a mostrar "Telão encerrado".

## Técnico

- Rota pública: `/telao` (entrada por código) e `/telao/:code` (direto).
- Estado servido pela RPC `get_telao_state(p_code)` (SECURITY DEFINER, anon).
- Controle: RPCs `regenerate_telao_code(p_event_id)` e
  `set_telao_ativo(p_event_id, p_ativo)` (checam `auth.uid()` = dono do evento).
- Colunas: `events.telao_code`, `events.telao_ativo`. Migration
  `20260707_telao_palco.sql`.
- Sincronização: realtime em `events` (troca do ao-vivo) + poll de 4 s (rede de
  segurança pro fechamento das notas).
