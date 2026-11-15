-- Passo 3b do Lote 1 (achados do /code-review de 2026-11-15). NAO APLICADA: escrita na dev,
-- aplicar so fora de janela de venda e depois de rodar docs/auditoria/passo3b-teste.sql.
--   Elenco antigo vazio/NULL em inscricao paga pode ser preenchido (so bloqueia se havia elenco e o tamanho mudou).
-- (Achado 'COREOHUB_ADMIN nao isento' descartado: nenhuma policy de registrations o alcanca, o RLS ja barra.)
-- Reverter: reaplicar a funcao de 20261115b_registrations_protect_columns.sql.

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
        -- Elenco antigo vazio/NULL (inscrição legada ou gratuita): nunca houve preço atrelado
        -- ao tamanho, então o preenchimento tardio é permitido.
        IF v_old_n > 0 AND v_old_n <> v_new_n THEN
          RAISE EXCEPTION 'ELENCO_BLOQUEADO_APOS_PAGAMENTO: o elenco desta inscrição já foi pago. Fale com a organização para alterar a quantidade de bailarinos.'
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
