-- Permite ao produtor remover uma coreografia do CRONOGRAMA sem reprovar a
-- inscrição nem estornar o pagamento.
--
-- Contexto: o cronograma passou a mostrar automaticamente toda inscrição PAGA
-- (status_pagamento APROVADO/CONFIRMADO — cobre eventos gratuitos também) ou
-- já aprovada manualmente (status='APROVADA'), sem o produtor precisar aprovar
-- uma a uma. Pra ele tirar uma da grade do dia (mantendo inscrição/pagamento/
-- certificado válidos), usa este flag — e pode reincluir depois.
--
-- IMPORTANTE: esta coluna NÃO entra no trigger protect_registrations_status_columns
-- de propósito — o produtor precisa conseguir alterá-la via a policy de UPDATE
-- dele (producer_updates_event_registrations, de 20260525). Não é coluna
-- financeira nem de status de pagamento.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS excluded_from_schedule boolean NOT NULL DEFAULT false;

-- Índice parcial: a query do cronograma filtra as NÃO-excluídas; o índice só
-- precisa cobrir as poucas excluídas pra acelerar a seção "Removidas".
CREATE INDEX IF NOT EXISTS idx_registrations_excluded_from_schedule
  ON registrations (event_id)
  WHERE excluded_from_schedule = true;

NOTIFY pgrst, 'reload schema';
