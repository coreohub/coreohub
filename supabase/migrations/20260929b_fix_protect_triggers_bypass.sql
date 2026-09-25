-- SEGURANCA: os triggers protect_* usavam `current_user IN ('postgres', ...)` como bypass pra
-- SQL Editor/migrations. Só que as funções são SECURITY DEFINER com dono postgres, e dentro de
-- uma função definer current_user é SEMPRE o dono — o bypass valia pra qualquer chamador e a
-- proteção ficou inoperante (profiles desde 20260702_team_event_scoping).
-- Prova (2026-09-29, rollback): usuário comum se promoveu a is_super_admin=true por UPDATE direto
-- no próprio perfil; produtor mudou coupons.used_count.
--
-- Novo bypass: `auth.uid() IS NULL` (SQL Editor, CLI, pg_cron e migrations não têm JWT) além de
-- service_role e super admin. Quem chega pela API com JWT de usuário nunca tem uid nulo.
--
-- Escopo desta migration: profiles, coupons, notifications (o frontend só grava colunas NÃO
-- protegidas nelas). NÃO mexe em registrations/workshop_registrations/audience_tickets: o app
-- ainda depende de UPDATE direto do cliente em status/status_pagamento (ver docs/HISTORICO).

CREATE OR REPLACE FUNCTION public.protect_profiles_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_coupons_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.used_count := 0;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.event_id    := OLD.event_id;
    NEW.created_at  := OLD.created_at;
    NEW.used_count  := OLD.used_count;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_notifications_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.event_id := OLD.event_id;
    NEW.type := OLD.type; NEW.severity := OLD.severity;
    NEW.title := OLD.title; NEW.body := OLD.body;
    NEW.cta_url := OLD.cta_url; NEW.cta_label := OLD.cta_label;
    NEW.metadata := OLD.metadata; NEW.created_at := OLD.created_at;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
