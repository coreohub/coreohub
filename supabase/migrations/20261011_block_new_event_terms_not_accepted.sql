-- Bloqueia criar evento novo enquanto o produtor não aceitou a versão mínima do Termo de Adesão
-- (1.8: taxa de pagamento, venda exclusivamente pela plataforma). Motivo: todo evento novo nasce com
-- events.processing_fee_enabled = true (migration 20261005), então a taxa não pode ser ligada pra quem
-- ainda não aceitou o Termo que a prevê.
--
-- NÃO APLICAR antes de o Termo v1.8 estar no ar em main: ninguém aceitou a 1.8 ainda e todos os
-- produtores ficariam sem poder criar evento até o merge sair e eles aceitarem.
--
-- Comparação numérica ("1.10" > "1.8"), mesma regra de _shared/terms-version.ts. Versão ausente ou
-- ilegível nunca conta como aceite. Não bloqueia: service_role / SQL (auth.uid() NULL — seed demo,
-- edge functions), super admin e evento demo. Mensagem no formato TERMS_NOT_ACCEPTED|<versão mínima>.

CREATE OR REPLACE FUNCTION block_new_event_when_terms_not_accepted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_min      CONSTANT text := '1.8';
  v_accepted text;
  v_ok       boolean := false;
  a int[];
  b int[];
  i int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_demo, false) THEN RETURN NEW; END IF;
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  SELECT producer_terms_version INTO v_accepted FROM profiles WHERE id = NEW.created_by;

  IF v_accepted IS NOT NULL AND v_accepted ~ '^[0-9]+(\.[0-9]+)*$' THEN
    a := string_to_array(v_accepted, '.')::int[];
    b := string_to_array(v_min, '.')::int[];
    v_ok := true;
    FOR i IN 1..GREATEST(array_length(a, 1), array_length(b, 1)) LOOP
      IF COALESCE(a[i], 0) <> COALESCE(b[i], 0) THEN
        v_ok := COALESCE(a[i], 0) > COALESCE(b[i], 0);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'TERMS_NOT_ACCEPTED|%', v_min USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_new_event_terms_not_accepted_trigger ON events;
CREATE TRIGGER block_new_event_terms_not_accepted_trigger
  BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION block_new_event_when_terms_not_accepted();

NOTIFY pgrst, 'reload schema';
