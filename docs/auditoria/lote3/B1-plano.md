# B1: vencedores de premiação legíveis antes da revelação (plano, 2026-11-19, NÃO implementado)

## Achado (verificado em produção, só leitura)
- `configuracoes` tem 3 policies de leitura: `anyone_reads_public_event_configuracoes` (anon, evento `is_public`),
  `anyone_reads_legacy_singleton_for_public_event` (anon, id='1') e `inscrito_reads_configuracoes` (qualquer logado).
- Confirmado com a chave anon no evento de teste: a linha inteira de `configuracoes` volta por `/rest/v1/configuracoes`.
  Logo `premios_especiais` (inclui vencedor registrado) é legível por QUALQUER anônimo em evento público, antes de
  `winner_revealed`. A trava `winner_revealed` hoje é só de interface.
- Eventos: 15 públicos, 0 privados reais. O vazamento "config de evento privado legível por qualquer logado"
  (`inscrito_reads_configuracoes`) hoje não expõe nenhum evento real; tratar só quando houver evento privado real.
- Todo o resto de `configuracoes` (nomes, datas, escala, medalhas, links, programação) já é informação pública da vitrine.
  O único dado sensível antes do momento certo é o vencedor dentro de `premios_especiais`.

## Opção recomendada (1): tabela privada de vencedores
1. Nova tabela `premios_vencedores` (event_id, award_id, registration_id, winner_name, winner_studio, updated_at), RLS só
   dono do evento e super admin; GRANT explícito (regra de 30/10/2026); sem acesso anon.
2. "Registrar" (`pages/Deliberacoes.tsx`, "Salvar vencedores") passa a gravar nessa tabela, não em `premios_especiais`.
3. "Revelar" (Telão, RPC atômica `update_premios_winners`) copia o vencedor da tabela privada para `premios_especiais`
   com `winner_revealed=true`. Só a partir daí o dado fica público.
4. Leituras do dono do vencedor ainda não revelado (`TelaoControle`, `ResultsPanel`, PDF de Apuração, `get_telao_state`)
   passam a ler da tabela privada (dono) em vez de `premios_especiais`.
5. Migração de dados: copiar vencedores já registrados de eventos com cerimônia pendente para a tabela privada e,
   para eventos já revelados, manter como está.

## Como fazer com segurança
- Sessão dedicada, fora de dia de evento, com teste de cerimônia completa NO EVENTO DE TESTE: registrar, conferir que anon
  NÃO vê o vencedor (REST direto), revelar no Telão, conferir LED + vitrine + PDF.
- Antes: ler por completo `get_telao_state`, `update_premios_winners` e os 5 consumidores. Não lidos até aqui.
- Migration + front em janela parada; `pre-deploy-check --strict` em 0; `passoN-teste.sql` e `passoN-reverter.sql`.
- Risco principal: quebrar a revelação ao vivo (validada em 11/07 e no pós-mortem 11-12/07).

## Se aceitar o risco por ora
Só spoiler de vencedor entre "registrar" e "revelar", exige chamar a API direto. Fazer antes da próxima cerimônia real.

## Estado (2026-11-19, implementado)
- Migration `20261119c_premios_vencedores_privado.sql` aplicada em produção (tabela `premios_vencedores` sem anon; `update_premios_winners` com a mesma assinatura: `winner_*` grava no privado, `winner_revealed:true` copia para o público). 0 prêmios precisaram migrar (os 14 com vencedor já estavam revelados).
- `get_telao_state` não lia `premios_especiais` (usa `events.telao_premiacao`), então não mudou.
- Front: `utils/premiosVencedores.ts` mescla o privado em Deliberacoes, TelaoControle e ResultsPanel (tela e PDF).
- Testado no evento de teste: `passo5-b1-teste.sql` (9 verificações) e roteiro por API (anon não lê o vencedor antes de revelar; depois de revelar, Telão e configuracoes mostram). Reverter: `passo5-b1-reverter.sql`.
- NÃO testado: LED/vitrine/PDF no navegador, e cerimônia real. Janela de risco até o front ir à main: o front antigo não enxerga vencedor registrado e não revelado.

## Complemento (2026-11-19, noite)
- Vercel: deploy de `9677f84` com status success; `app.coreohub.com` responde 200.
- Achado: a view `deliberation_aggregate` (dono postgres, sem security_invoker) ignorava a RLS de `deliberations` e `anon` tinha SELECT, expondo o vencedor por deliberação antes da revelação. Migration `20261119e` tirou o acesso de anon (testado: anon 42501; dono e `get_telao_state` anon seguem funcionando). Tabela estava com 0 linhas, então nada vazou em dado real.
- Residual NÃO tratado: qualquer usuário LOGADO ainda lê a view (precisa desenho: security_invoker quebraria equipe e `get_telao_state`). Reverter: `GRANT SELECT ON public.deliberation_aggregate TO anon;`.
- PDF de Apuração gerado no navegador com resultado de teste: traz o vencedor manual e a faixa lidos da tabela privada (dados de teste apagados).
- Vitrine de evento NÃO espetáculo após revelar: não testada (só há eventos de teste de espetáculo; a vitrine não mudou e lê o público).
