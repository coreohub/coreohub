-- ─────────────────────────────────────────────────────────────────────────────
-- Passo 3 do Lote 1 da auditoria (docs/auditoria/DESENHO-lote1.md, seção 2.4)
--
-- PROBLEMA: o gatilho protect_registrations_status_columns só protegia as colunas
-- de pagamento. Pela API, o inscrito (policy inscrito_own_registrations, ALL) e a
-- equipe do evento (policy producer_updates_event_registrations) conseguiam gravar
-- nota/classificação, check-in, penalidade, video_fee_status, mod_fee, payment_url
-- etc., e o inscrito conseguia APAGAR a própria inscrição já paga.
--
-- O QUE ESTA MIGRATION FAZ:
--   A. Estende o gatilho (INSERT e UPDATE) com regra por papel:
--        equipe do evento = events.created_by = auth.uid() OU is_team_member_of_event
--        inscrito         = qualquer outro caso que passe pela policy (user_id)
--      service_role, auth.uid() IS NULL e super admin continuam livres.
--   B. Trava o tamanho do elenco depois do pagamento (erro ELENCO_BLOQUEADO_APOS_PAGAMENTO).
--   C. Novo gatilho BEFORE DELETE: o inscrito só apaga inscrição PENDENTE, fora de
--      fatura agrupada e sem taxa de seletiva paga (erro INSCRICAO_PAGA_NAO_PODE_SER_APAGADA).
--
-- Verificado antes de escrever: o INSERT em video_evaluations (que dispara a
-- agregação de video_status) vem só de judge-login, com service key.
-- Reverter: docs/auditoria/passo3-reverter.sql. Testar: docs/auditoria/passo3-teste.sql.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_registrations_status_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team boolean;
  v_old_n int;
  v_new_n int;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  v_team := EXISTS (
              SELECT 1 FROM public.events e
               WHERE e.id = CASE WHEN TG_OP = 'UPDATE' THEN OLD.event_id ELSE NEW.event_id END
                 AND e.created_by = auth.uid())
            OR is_team_member_of_event(CASE WHEN TG_OP = 'UPDATE' THEN OLD.event_id ELSE NEW.event_id END);

  IF TG_OP = 'INSERT' THEN
    -- Já existia: pagamento nasce zerado.
    NEW.status := 'PENDENTE';
    NEW.status_pagamento := 'PENDENTE';
    NEW.valor_pago := NULL;
    NEW.paid_at := NULL;
    NEW.payment_id := NULL;
    NEW.payment_group_id := NULL;
    NEW.charged_amount := NULL;
    NEW.coupon_id := NULL;
    NEW.discount_amount := NULL;
    NEW.refunded_at := NULL;
    NEW.refund_amount := NULL;
    NEW.refund_reason := NULL;
    -- Novo: só serviço.
    NEW.mod_fee := NULL;
    NEW.payment_url := NULL;
    NEW.payment_preference_id := NULL;
    NEW.payment_method := NULL;
    NEW.coupon_redeemed_at := NULL;
    NEW.video_fee_payment_id := NULL;
    NEW.reminder_7d_at := NULL;
    NEW.reminder_1d_at := NULL;
    -- Novo: resultado e operação nascem no padrão da coluna.
    NEW.media_final := NULL;
    NEW.classificacao_final := NULL;
    NEW.resultado_publicado := false;
    NEW.penalty_points := 0;
    NEW.penalidade_status := NULL;
    NEW.penalidade_aplicada := NULL;
    NEW.age_infraction_status := 'regular';
    NEW.check_in_status := NULL;
    NEW.check_in_at := NULL;
    NEW.video_approved_at := NULL;
    NEW.video_approved_by := NULL;
    NEW.video_feedback := NULL;
    NEW.bloco_id := NULL;
    NEW.ordem_apresentacao := NULL;
    NEW.ordem_apresentacao_dia := NULL;
    NEW.ordem_apresentacao_publicado := NULL;
    NEW.ordem_apresentacao_dia_publicado := NULL;
    NEW.bloco_id_publicado := NULL;
    NEW.excluded_from_schedule := false;
    NEW.trilha_liberada_pos_prazo := false;
    -- Seletiva: taxa nasce sem exigência paga; vídeo só entra pendente ou enviado.
    NEW.video_fee_status := 'not_required';
    IF NEW.video_status IS NOT NULL AND NEW.video_status NOT IN ('pending', 'submitted') THEN
      NEW.video_status := 'pending';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Já existia.
    NEW.status := OLD.status;
    NEW.status_pagamento := OLD.status_pagamento;
    NEW.valor_pago := OLD.valor_pago;
    NEW.paid_at := OLD.paid_at;
    NEW.payment_id := OLD.payment_id;
    NEW.payment_group_id := OLD.payment_group_id;
    NEW.charged_amount := OLD.charged_amount;
    NEW.coupon_id := OLD.coupon_id;
    NEW.discount_amount := OLD.discount_amount;
    NEW.refunded_at := OLD.refunded_at;
    NEW.refund_amount := OLD.refund_amount;
    NEW.refund_reason := OLD.refund_reason;
    NEW.user_id := OLD.user_id;
    NEW.event_id := OLD.event_id;
    NEW.created_at := OLD.created_at;
    -- Novo: só serviço (equipe e inscrito).
    NEW.mod_fee := OLD.mod_fee;
    NEW.payment_url := OLD.payment_url;
    NEW.payment_preference_id := OLD.payment_preference_id;
    NEW.payment_method := OLD.payment_method;
    NEW.coupon_redeemed_at := OLD.coupon_redeemed_at;
    NEW.video_fee_payment_id := OLD.video_fee_payment_id;
    NEW.reminder_7d_at := OLD.reminder_7d_at;
    NEW.reminder_1d_at := OLD.reminder_1d_at;

    -- video_fee_status: equipe só dispensa ('waived'); inscrito nunca muda.
    IF NEW.video_fee_status IS DISTINCT FROM OLD.video_fee_status THEN
      IF NOT (v_team AND NEW.video_fee_status = 'waived') THEN
        NEW.video_fee_status := OLD.video_fee_status;
      END IF;
    END IF;

    IF NOT v_team THEN
      -- Inscrito: resultado, operação e insumo de preço voltam ao antigo.
      NEW.media_final := OLD.media_final;
      NEW.classificacao_final := OLD.classificacao_final;
      NEW.resultado_publicado := OLD.resultado_publicado;
      NEW.penalty_points := OLD.penalty_points;
      NEW.penalidade_status := OLD.penalidade_status;
      NEW.penalidade_aplicada := OLD.penalidade_aplicada;
      NEW.age_infraction_status := OLD.age_infraction_status;
      NEW.check_in_status := OLD.check_in_status;
      NEW.check_in_at := OLD.check_in_at;
      NEW.video_approved_at := OLD.video_approved_at;
      NEW.video_approved_by := OLD.video_approved_by;
      NEW.video_feedback := OLD.video_feedback;
      NEW.bloco_id := OLD.bloco_id;
      NEW.ordem_apresentacao := OLD.ordem_apresentacao;
      NEW.ordem_apresentacao_dia := OLD.ordem_apresentacao_dia;
      NEW.ordem_apresentacao_publicado := OLD.ordem_apresentacao_publicado;
      NEW.ordem_apresentacao_dia_publicado := OLD.ordem_apresentacao_dia_publicado;
      NEW.bloco_id_publicado := OLD.bloco_id_publicado;
      NEW.excluded_from_schedule := OLD.excluded_from_schedule;
      NEW.trilha_liberada_pos_prazo := OLD.trilha_liberada_pos_prazo;
      NEW.formato_participacao := OLD.formato_participacao;
      NEW.tipo_apresentacao := OLD.tipo_apresentacao;
      NEW.categoria := OLD.categoria;
      NEW.estilo_danca := OLD.estilo_danca;
      NEW.subgenero := OLD.subgenero;
      NEW.is_pcd := OLD.is_pcd;
      NEW.category_id := OLD.category_id;
      NEW.cat_min_age := OLD.cat_min_age;
      NEW.cat_max_age := OLD.cat_max_age;

      -- video_status: dois escritores (inscrito envia, equipe decide).
      IF OLD.video_status = 'approved' THEN
        NEW.video_status := OLD.video_status;
        NEW.video_url := OLD.video_url;
        NEW.video_submitted_at := OLD.video_submitted_at;
      ELSIF NEW.video_status IS DISTINCT FROM OLD.video_status
            AND COALESCE(NEW.video_status, '') <> 'submitted' THEN
        NEW.video_status := OLD.video_status;
      END IF;

      -- Elenco: depois de pago, o tamanho não muda (nome/CPF continuam editáveis).
      IF OLD.status_pagamento IN ('APROVADO', 'CONFIRMADO') THEN
        v_old_n := CASE WHEN jsonb_typeof(to_jsonb(OLD.bailarinos_detalhes)) = 'array'
                        THEN jsonb_array_length(to_jsonb(OLD.bailarinos_detalhes)) ELSE 0 END;
        v_new_n := CASE WHEN jsonb_typeof(to_jsonb(NEW.bailarinos_detalhes)) = 'array'
                        THEN jsonb_array_length(to_jsonb(NEW.bailarinos_detalhes)) ELSE 0 END;
        IF v_old_n <> v_new_n THEN
          RAISE EXCEPTION 'ELENCO_BLOQUEADO_APOS_PAGAMENTO: o elenco desta inscrição já foi pago. Fale com a organização para alterar a quantidade de bailarinos.'
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- O gatilho protect_registrations_status_trigger (BEFORE INSERT OR UPDATE) já existe
-- e passa a usar a função acima sem precisar ser recriado.


-- ─── C. DELETE: inscrito só apaga o que ainda não virou dinheiro ─────────────
CREATE OR REPLACE FUNCTION public.protect_registrations_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN OLD; END IF;
  IF auth.uid() IS NULL THEN RETURN OLD; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN OLD; END IF;

  IF OLD.status_pagamento IS DISTINCT FROM 'PENDENTE'
     OR OLD.payment_group_id IS NOT NULL
     OR OLD.video_fee_status = 'paid' THEN
    RAISE EXCEPTION 'INSCRICAO_PAGA_NAO_PODE_SER_APAGADA: esta inscrição tem pagamento ou fatura. Fale com a organização.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS protect_registrations_delete_trigger ON public.registrations;
CREATE TRIGGER protect_registrations_delete_trigger
  BEFORE DELETE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.protect_registrations_delete();

NOTIFY pgrst, 'reload schema';
