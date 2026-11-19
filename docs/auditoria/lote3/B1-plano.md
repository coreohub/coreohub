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
