-- Fase 5, item 4b: status 'CREDITO' = ingresso convertido em crédito (cupom de uso único).
-- Não é CANCELADO/VENCIDO de propósito: o webhook tardio do Asaas só religa esses dois
-- (audience_payment_expiry), então um ingresso já convertido nunca volta a APROVADO.
-- Idempotente: recria o CHECK com o valor novo.
ALTER TABLE audience_tickets DROP CONSTRAINT IF EXISTS audience_tickets_status_pagamento_check;
ALTER TABLE audience_tickets ADD CONSTRAINT audience_tickets_status_pagamento_check
  CHECK (status_pagamento = ANY (ARRAY['PENDENTE', 'APROVADO', 'CANCELADO', 'VENCIDO', 'ESTORNADO', 'CORTESIA', 'CREDITO']));

NOTIFY pgrst, 'reload schema';
