-- #12 Backlog: unificar `coreografias` e `registrations` em uma única tabela.
-- Decisão: registrations é a fonte da verdade (já era usada por 18 telas vs 5).
-- coreografias estava vazia em produção (0 rows), então não precisou migrar dados.
--
-- Adicionadas colunas em registrations que existiam só em coreografias:

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refunded_at             TIMESTAMPTZ;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refund_amount           NUMERIC(10,2);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refund_reason           TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS coupon_id               UUID REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS discount_amount         NUMERIC(10,2);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS paid_at                 TIMESTAMPTZ;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS duracao_trilha_segundos INTEGER;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS subgenero               TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS mod_fee                 NUMERIC(10,2);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS tolerance_violation     JSONB;

-- A tabela `coreografias` é mantida no schema temporariamente (caso alguma
-- query legada ainda referencie). Quando estável por algumas semanas,
-- remover via: DROP TABLE coreografias CASCADE;
COMMENT ON TABLE coreografias IS 'DEPRECATED 2026-04-30. Substituída por `registrations`. Não usar em código novo.';

NOTIFY pgrst, 'reload schema';
