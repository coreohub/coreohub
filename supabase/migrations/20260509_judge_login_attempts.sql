-- Vuln 4 (security review 2026-05-02): brute-force de PIN de 4 digitos
-- na action `validate` de judge-login. Memoria afirmava "5 tentativas
-- -> 5min lockout" mas isso nao existia no codigo. PIN tem 10.000
-- possibilidades — ~10s pra brute-force com 100 paralelos.
--
-- Tabela de tentativas falhas por judge_id. Edge Function judge-login
-- consulta antes de validar e incrementa em cada falha. Apos 5 falhas
-- consecutivas o jurado fica bloqueado por 5 minutos. Sucesso reseta.
--
-- Trade-off: lock e por judge_id (nao por IP). Atacante que conheca
-- o token pode triggar bloqueio simultaneo dos jurados (DoS leve), mas
-- nao ganha acesso. Festival tem 3-10 jurados — DoS de 50 PIN-fails
-- e bem visivel + produtor pode regenerar o token instantaneamente.

CREATE TABLE IF NOT EXISTS judge_login_attempts (
  judge_id      uuid PRIMARY KEY REFERENCES judges(id) ON DELETE CASCADE,
  failed_count  integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS habilitado sem policies: so service_role acessa (Edge Function).
-- Frontend nunca ve essa tabela.
ALTER TABLE judge_login_attempts ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
