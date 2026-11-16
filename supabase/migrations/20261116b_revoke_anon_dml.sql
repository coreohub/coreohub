-- Auditoria 2026-11-16 (Lote 2, C-N4): o papel anon tinha INSERT/UPDATE/DELETE em 63 de 65 tabelas do
-- schema public por ACL padrão; só a RLS segurava. Conferido: nenhuma policy de escrita vale para anon
-- sem exigir auth.uid()/service_role/admin, então nada legítimo depende desse grant.
-- Leitura (SELECT) do anon NÃO muda. Edge functions usam service_role. Idempotente.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;

-- Tabelas futuras não nascem com escrita para anon (o _template.sql já concede só o necessário).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

NOTIFY pgrst, 'reload schema';
