-- "Último acesso" precisa ignorar o impersonate do super admin ("Ver como"),
-- que dispara um login real (verifyOtp magiclink) e sobrescreve
-- auth.users.last_sign_in_at do PRODUTOR — indistinguível de acesso real
-- dela. Como é 1 timestamp só, não dá pra "marcar" a origem sem perder o
-- valor anterior. Solução: parar de depender do campo do Supabase pra essa
-- exibição, e controlar nosso próprio timestamp — que o fluxo de
-- impersonate explicitamente NUNCA escreve (ver Auth.tsx).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS producer_last_login_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.producer_last_login_at IS
  'Timestamp do último login REAL do usuário (gravado por Auth.tsx no SIGNED_IN, pulando quando isImpersonating() está ativo). Diferente de auth.users.last_sign_in_at, que também é tocado pelo impersonate do super admin.';

-- RLS: o próprio user pode gravar seu login (self, via client normal), e
-- super admin lê todo mundo pro /super-admin. Não precisa de policy de
-- UPDATE ampla — segue o padrão de profiles: cada um só edita a própria row.
-- A policy de self-update já existente (auth.uid() = id) cobre esse UPDATE.

-- Aposenta a RPC criada mais cedo hoje (get_producers_last_sign_in) — não
-- é mais usada, essa coluna substitui de forma mais confiável.
DROP FUNCTION IF EXISTS get_producers_last_sign_in();
