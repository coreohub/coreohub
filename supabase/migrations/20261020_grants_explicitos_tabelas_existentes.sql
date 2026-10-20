-- Grants explicitos nas tabelas existentes de `public`.
--
-- Por que: a partir de 30/10/2026 o Supabase deixa de conceder grants
-- automaticamente a tabelas novas. As migrations anteriores a esta data nunca
-- escreveram GRANT (dependiam do default). Em producao nada muda, os grants ja
-- existem; mas `supabase db reset`, branch de preview ou projeto novo recriariam
-- as tabelas antigas sem acesso (erro 42501, inclusive pro service_role).
--
-- Esta migration so CONCEDE (nunca revoga) e e idempotente. Em producao e
-- funcionalmente um no-op: os grants atuais (auditados em 2026-10-20) ja sao
-- um superconjunto deste (anon/authenticated/service_role tinham tambem
-- TRUNCATE, REFERENCES e TRIGGER; aqui ficam so os 4 privilegios de dados).
--
-- Seguranca: GRANT libera o acesso, quem filtra as linhas e o RLS (ligado em
-- todas as tabelas de `public`). Tabelas novas continuam seguindo o
-- `_template.sql`, com grants propositais (anon so onde a leitura e publica).
--
-- Deve ser a ULTIMA migration aplicada antes de 30/10 (ordem por timestamp).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    IF r.relkind IN ('r', 'p') THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated, service_role',
        r.relname);
    ELSE
      EXECUTE format(
        'GRANT SELECT ON public.%I TO anon, authenticated, service_role',
        r.relname);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
