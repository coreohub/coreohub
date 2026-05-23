-- Índices em notifications.metadata pra acelerar idempotency checks do tipo:
--   .filter('metadata->>registration_id', 'eq', ...)
--   .filter('metadata->>reminder_type',   'eq', ...)
--
-- Sem isso, send-trilha-reminders + send-incomplete-data-reminders viram
-- table scan a cada loop. Sem dor enquanto a tabela é pequena, vira gargalo
-- quando passa de ~10k notifs.
--
-- O operador `->>` (texto) NÃO usa GIN com jsonb_path_ops nem jsonb_ops. A
-- forma direta de acelerar `metadata->>'key' = 'value'` é btree de expressão.
-- O GIN extra (jsonb_ops, default) cobre buscas futuras via `@>` / `?`.

CREATE INDEX IF NOT EXISTS notifications_metadata_reminder_type_idx
  ON notifications ((metadata->>'reminder_type'))
  WHERE metadata ? 'reminder_type';

CREATE INDEX IF NOT EXISTS notifications_metadata_registration_id_idx
  ON notifications ((metadata->>'registration_id'))
  WHERE metadata ? 'registration_id';

CREATE INDEX IF NOT EXISTS notifications_metadata_gin
  ON notifications USING GIN (metadata);

NOTIFY pgrst, 'reload schema';
