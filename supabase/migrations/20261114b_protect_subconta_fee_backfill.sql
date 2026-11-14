-- Protege profiles.subconta_fee_charged_at contra edição pelo próprio usuário
-- (senão o produtor preencheria a coluna e escaparia da taxa de abertura da
-- subconta) e faz o backfill dos produtores antigos.
-- Mesma função de antes; só ganhou a linha da coluna nova.

CREATE OR REPLACE FUNCTION public.protect_profiles_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Sem JWT = acesso direto ao banco (SQL Editor, CLI, cron). NÃO usar current_user aqui:
  -- em SECURITY DEFINER ele vira o dono da função.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  NEW.is_super_admin            := OLD.is_super_admin;
  NEW.is_blocked                := OLD.is_blocked;
  NEW.role                      := OLD.role;
  NEW.team_event_id             := OLD.team_event_id;
  NEW.permissoes_custom         := OLD.permissoes_custom;
  NEW.is_test_account           := OLD.is_test_account;

  NEW.default_commission_percent := OLD.default_commission_percent;

  NEW.asaas_wallet_id           := OLD.asaas_wallet_id;
  NEW.asaas_subconta_id         := OLD.asaas_subconta_id;
  NEW.asaas_api_key             := OLD.asaas_api_key;

  NEW.judge_access_token        := OLD.judge_access_token;

  NEW.subconta_fee_charged_at   := OLD.subconta_fee_charged_at;

  RETURN NEW;
END;
$function$;

-- Backfill (decidido com o produtor em 2026-11-14): quem já tem subconta é
-- marcado como "já cobrado", EXCETO Academia New Ritmo (Level Up) e Compete'art,
-- cujas subcontas foram abertas em 08 e 09/11 e entram na cobrança da próxima
-- venda que comportar a taxa. Idempotente.
UPDATE profiles
   SET subconta_fee_charged_at = now()
 WHERE asaas_wallet_id IS NOT NULL
   AND subconta_fee_charged_at IS NULL
   AND email NOT IN ('nickmoni1@hotmail.com', 'competeartfestival@gmail.com');

NOTIFY pgrst, 'reload schema';
