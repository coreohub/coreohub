-- GIN index em notifications.metadata pra acelerar idempotency checks do tipo:
--   .filter('metadata->>registration_id', 'eq', ...)
--   .filter('metadata->>reminder_type',   'eq', ...)
--
-- Sem o índice, send-trilha-reminders + send-incomplete-data-reminders fazem
-- table scan a cada loop. Sem dor enquanto a tabela é pequena, vira gargalo
-- quando passa de ~10k notifs.
--
-- jsonb_path_ops cobre os operadores `@>` e `?` mas NÃO `->>` direto. Pra
-- queries do tipo `metadata->>'key' = 'value'` PostgREST/PG reescreve pra
-- `metadata @> '{"key": "value"}'` quando há índice GIN com jsonb_path_ops.
-- Operacionalmente isso resolve o N+1 do idempotency check.

CREATE INDEX IF NOT EXISTS notifications_metadata_gin
  ON notifications USING GIN (metadata jsonb_path_ops);

NOTIFY pgrst, 'reload schema';
