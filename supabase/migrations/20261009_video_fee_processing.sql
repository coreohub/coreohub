-- P5: linha "Taxa de pagamento" na taxa de seletiva (VS:). registrations.processing_fee_amount pertence a
-- inscricao cheia, entao a taxa A tem colunas proprias:
--   video_fee_processing_amount : linha paga pelo inscrito (fica fora da base da comissao e do liquido do produtor)
--   video_fee_producer_cost     : custo do cartao pago pelo produtor no modo fechado_total (soma a comissao)
-- Gravadas so pela edge function (service role). O trigger de protecao existente e estendido para
-- as duas colunas, no mesmo padrao das tres que ja protege (INSERT zera, UPDATE preserva o valor antigo).

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS video_fee_processing_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_fee_producer_cost numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.protect_processing_fee_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      'processing_fee_amount', NULL, 'payment_method_chosen', NULL, 'installments', NULL));
    IF TG_TABLE_NAME = 'registrations' THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(
        'video_fee_processing_amount', 0, 'video_fee_producer_cost', 0));
    END IF;
  ELSE
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      'processing_fee_amount', to_jsonb(OLD.processing_fee_amount),
      'payment_method_chosen', to_jsonb(OLD.payment_method_chosen),
      'installments',          to_jsonb(OLD.installments)));
    IF TG_TABLE_NAME = 'registrations' THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(
        'video_fee_processing_amount', to_jsonb(OLD.video_fee_processing_amount),
        'video_fee_producer_cost',     to_jsonb(OLD.video_fee_producer_cost)));
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
