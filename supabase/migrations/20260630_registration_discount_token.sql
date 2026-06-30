-- Link de desconto por coreografia (sem CPF, sem login) — caso real: mãe de
-- aluno (Carolina Mellin) comprando workshop pros filhos sem nunca ter
-- cadastrado conta no CoreoHub. O fluxo de combo via CPF+login (anti-fraude
-- 2026-06-17/28) continua existindo; este é um canal A MAIS: coreógrafo
-- gera 1 link por coreografia (não por bailarino — evita 75 links em vez de
-- 5) e compartilha manualmente por WhatsApp com as famílias.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS discount_token UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_discount_token
  ON registrations (discount_token)
  WHERE discount_token IS NOT NULL;

-- Backfill: só inscrições pagas (token sem inscrição aprovada nunca é
-- aceito mesmo assim, mas evita gerar token pra lixo/abandonado).
UPDATE registrations
  SET discount_token = gen_random_uuid()
  WHERE discount_token IS NULL
    AND status_pagamento IN ('APROVADO', 'CONFIRMADO');

-- Gera token automaticamente quando a inscrição vira paga (cobre o fluxo
-- normal daqui pra frente — webhook marca status_pagamento, trigger cuida
-- do token sem precisar tocar em código de pagamento).
CREATE OR REPLACE FUNCTION public.fn_assign_discount_token()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status_pagamento IN ('APROVADO', 'CONFIRMADO') AND NEW.discount_token IS NULL THEN
    NEW.discount_token := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assign_discount_token ON registrations;
CREATE TRIGGER trg_assign_discount_token
  BEFORE INSERT OR UPDATE OF status_pagamento ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_assign_discount_token();

NOTIFY pgrst, 'reload schema';
