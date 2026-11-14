-- Evento da Tamoios terminou em 17/10/2026; a regra exclusiva de absorção de
-- taxa de baixo valor (cobrança sem split + repasse integral depois) volta ao
-- normal, como combinado com o produtor em 2026-11-14.
-- Verificado antes: 0 repasses de baixo valor sem PIX enviado, 0 abertos,
-- 0 cobranças pendentes (a etapa de PIX do cron release-low-value-transfers só
-- olha eventos com a flag ligada, então não pode sobrar repasse pendente).
UPDATE events
   SET absorve_taxa_baixo_valor = false
 WHERE id = 'e328a377-4285-4766-b9b0-38bf39515f84'
   AND absorve_taxa_baixo_valor IS TRUE;
