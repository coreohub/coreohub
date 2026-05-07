-- Adiciona coluna `cargo` em profiles. Coluna era referenciada por
-- pages/EquipeProdutor.tsx (.select('cargo'), member.cargo no Member
-- type) e pelo seed-demo-event ({ cargo: s.cargo } no UPDATE), mas
-- nunca foi criada via migration.
--
-- Efeitos:
-- 1. EquipeProdutor passa a listar membros corretamente (antes a query
--    inteira falhava silently — daí "0 membros" mesmo em prod).
-- 2. seed-demo-event consegue UPDATE staff demo com cargo + role
--    (antes o UPDATE caía com 'column cargo does not exist' silently
--    e os profiles ficavam com role=USER).
-- 3. /credenciais aba Equipe passa a mostrar os 3 staff demo.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cargo TEXT;

NOTIFY pgrst, 'reload schema';
