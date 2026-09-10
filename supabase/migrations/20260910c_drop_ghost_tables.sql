-- Remove 2 tabelas fantasma achadas na auditoria de código morto de 2026-09-10:
-- ambas nunca tiveram CREATE TABLE versionado em nenhuma migration (criadas
-- manualmente no SQL Editor em algum momento antes de 20260429, que só
-- ajustou RLS delas), zero código no repo referencia (nem .from() nem RPC),
-- 0 linhas em produção. Confirmado com o produtor antes de apagar.
--
-- equipe_convites: tentativa antiga de convite de equipe em português,
-- superada por team_invites (tabela real e ativa).
-- popular_votes: tentativa antiga de votação popular dentro do banco da
-- CoreoHub, abandonada quando o Voto Popular virou produto em infra
-- isolada (projeto Supabase separado aghmjmqrkwuxmrctslkf).

DROP TABLE IF EXISTS equipe_convites;
DROP TABLE IF EXISTS popular_votes;
