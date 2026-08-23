-- Marca profiles de demonstração (ex: persona pública "Camila Andrade DEMO"),
-- espelhando o padrão já usado em events.is_demo. Evita que uma conta demo
-- seja confundida com produtor real em métricas do super-admin ou em
-- qualquer query que resolva "produtor mais recente" sem filtro explícito
-- (mesma classe de bug de sombreamento já documentada pra events.is_demo).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_is_demo ON profiles (is_demo) WHERE is_demo = true;

NOTIFY pgrst, 'reload schema';
