-- Teste A1 sem tocar a tabela real: tabela TEMPORARIA com as 2 colunas e o MESMO indice/predicado.
-- Desfaz sozinho (ROLLBACK). Esperado: NOTICE 'ok: duplicado barrado (23505)' e 'ok: grupo NULL nao conflita'.
BEGIN;
CREATE TEMP TABLE t_pc (asaas_payment_id text, audience_ticket_group_id uuid) ON COMMIT DROP;
CREATE UNIQUE INDEX t_pc_uniq ON t_pc (asaas_payment_id, audience_ticket_group_id) WHERE audience_ticket_group_id IS NOT NULL;
DO $$
DECLARE g uuid := gen_random_uuid();
BEGIN
  INSERT INTO t_pc VALUES ('pay_teste_1', g);
  BEGIN
    INSERT INTO t_pc VALUES ('pay_teste_1', g);
    RAISE EXCEPTION 'FALHOU: duplicado entrou';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok: duplicado barrado (23505)';
  END;
  INSERT INTO t_pc VALUES ('pay_teste_2', g);   -- outra parcela, mesmo grupo: tem que passar
  INSERT INTO t_pc VALUES ('pay_x', NULL);
  INSERT INTO t_pc VALUES ('pay_x', NULL);      -- sem grupo (inscricao/workshop): nao conflita
  RAISE NOTICE 'ok: grupo NULL nao conflita';
END $$;
ROLLBACK;
