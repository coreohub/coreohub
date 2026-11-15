-- ─────────────────────────────────────────────────────────────────────────────
-- Passo 4 do Lote 1 da auditoria (docs/auditoria/DESENHO-lote1.md, seção 2.5)
--
-- PROBLEMA: protect_commission_columns só rodava em UPDATE. No INSERT o produtor
-- escolhia comissão, plano, taxa de setup paga, is_demo etc. do próprio evento
-- (a API aceita qualquer coluna). No UPDATE faltavam colunas: acerto de plano
-- (billing_settlement_*), is_demo, acesso_liberado_nota, parcelamento, absorção.
-- Além disso, is_demo = true no INSERT fazia os gatilhos de Termo e de taxa de
-- plano vencida deixarem passar (eles rodam antes e confiam no valor recebido).
--
-- O QUE ESTA MIGRATION FAZ:
--   A. protect_commission_columns passa a cobrir INSERT e UPDATE.
--   B. O gatilho é recriado com o nome aa_protect_commission_columns_trigger para
--      rodar ANTES de block_new_event_*_trigger (ordem alfabética) e já entregar
--      is_demo = false a eles. Continua antes de sync_commission_percent_trigger.
--   C. Desvios: service_role, auth.uid() IS NULL (SQL Editor, cron), super admin,
--      role COREOHUB_ADMIN.
--   D. INSERT por usuário comum:
--        - duplicação de sessão (GUC app.session_clone_from, só definido por
--          duplicate_event_session, e só vale se a origem é do mesmo dono): copia
--          plano/comissão/tipo/parcelamento da origem;
--        - criação normal: plano 'espetaculo' se foi o enviado, senão 'comeco';
--          comissão padrão; event_type 'private'; sem grupo de sessão.
--        - nos dois casos: is_demo false e todo campo de cobrança/taxa zerado.
--
-- Não muda nenhuma tela: CreateEvent/OnboardingWizard/EspetaculoWizard não enviam
-- esses campos (exceto billing_plan 'espetaculo', que continua valendo).
-- Reverter: docs/auditoria/passo4-reverter.sql. Testar: docs/auditoria/passo4-teste.sql.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_commission_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clone text;
  v_src   public.events%ROWTYPE;
  v_has_src boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Duplicação de sessão: origem tem que ser do mesmo dono que está criando.
    v_clone := NULLIF(current_setting('app.session_clone_from', true), '');
    IF v_clone IS NOT NULL THEN
      SELECT * INTO v_src FROM public.events e
       WHERE e.id::text = v_clone
         AND e.created_by IS NOT DISTINCT FROM NEW.created_by
         AND e.created_by = auth.uid();
      v_has_src := FOUND;
    END IF;

    IF v_has_src THEN
      NEW.billing_plan                       := v_src.billing_plan;
      NEW.commission_type                    := v_src.commission_type;
      NEW.commission_percent                 := v_src.commission_percent;
      NEW.commission_fixed                   := v_src.commission_fixed;
      NEW.event_type                         := v_src.event_type;
      NEW.audience_commission_percent        := v_src.audience_commission_percent;
      NEW.audience_commission_percent_manual := v_src.audience_commission_percent_manual;
      NEW.absorve_taxa_baixo_valor           := v_src.absorve_taxa_baixo_valor;
      NEW.pix_installments_max               := v_src.pix_installments_max;
      -- session_group_id: mantém o valor recebido (a RPC já calculou o grupo).
    ELSE
      NEW.billing_plan                       := CASE WHEN NEW.billing_plan = 'espetaculo'
                                                     THEN 'espetaculo' ELSE 'comeco' END;
      NEW.commission_type                    := 'percent';
      NEW.commission_fixed                   := 0;
      NEW.commission_percent                 := 10;
      NEW.audience_commission_percent        := 10;
      NEW.audience_commission_percent_manual := false;
      NEW.event_type                         := 'private';
      NEW.absorve_taxa_baixo_valor           := false;
      NEW.pix_installments_max               := 1;
      NEW.session_group_id                   := NULL;
    END IF;

    NEW.is_demo                               := false;
    NEW.setup_fee_paid_at                     := NULL;
    NEW.setup_fee_grandfathered               := false;
    NEW.setup_fee_tier_chave                  := NULL;
    NEW.setup_fee_amount_paid                 := NULL;
    NEW.setup_fee_asaas_payment_id            := NULL;
    NEW.billing_plan_fixed_fee_paid_at        := NULL;
    NEW.billing_plan_asaas_payment_id         := NULL;
    NEW.billing_plan_fee_deduction_transfer_id := NULL;
    NEW.billing_plan_fee_due_at               := NULL;
    NEW.billing_settlement_closed_at          := NULL;
    NEW.billing_settlement_amount_due         := NULL;
    NEW.billing_settlement_amount_collected   := NULL;
    NEW.billing_settlement_asaas_payment_id   := NULL;
    NEW.max_installments                      := 1;
    NEW.view_count                            := 0;
    NEW.acesso_liberado_nota                  := NULL;
    -- setup_fee_estimated_inscricoes é do produtor (ver 20260802): não mexe.
    RETURN NEW;
  END IF;

  -- UPDATE por usuário comum: colunas de cobrança voltam ao valor antigo.
  NEW.commission_type    := OLD.commission_type;
  NEW.commission_percent := OLD.commission_percent;
  NEW.commission_fixed   := OLD.commission_fixed;
  NEW.event_type         := OLD.event_type;
  NEW.setup_fee_paid_at         := OLD.setup_fee_paid_at;
  NEW.setup_fee_grandfathered   := OLD.setup_fee_grandfathered;
  NEW.setup_fee_tier_chave      := OLD.setup_fee_tier_chave;
  NEW.setup_fee_amount_paid     := OLD.setup_fee_amount_paid;
  NEW.setup_fee_asaas_payment_id := OLD.setup_fee_asaas_payment_id;
  NEW.billing_plan                  := OLD.billing_plan;
  NEW.billing_plan_fixed_fee_paid_at := OLD.billing_plan_fixed_fee_paid_at;
  NEW.billing_plan_asaas_payment_id  := OLD.billing_plan_asaas_payment_id;
  NEW.audience_commission_percent        := OLD.audience_commission_percent;
  NEW.audience_commission_percent_manual := OLD.audience_commission_percent_manual;
  NEW.billing_plan_set_at            := OLD.billing_plan_set_at;
  NEW.billing_plan_fee_deduction_transfer_id := OLD.billing_plan_fee_deduction_transfer_id;
  NEW.billing_plan_fee_due_at        := OLD.billing_plan_fee_due_at;
  -- Novas neste passo:
  NEW.absorve_taxa_baixo_valor           := OLD.absorve_taxa_baixo_valor;
  NEW.pix_installments_max               := OLD.pix_installments_max;
  NEW.billing_settlement_closed_at       := OLD.billing_settlement_closed_at;
  NEW.billing_settlement_amount_due      := OLD.billing_settlement_amount_due;
  NEW.billing_settlement_amount_collected := OLD.billing_settlement_amount_collected;
  NEW.billing_settlement_asaas_payment_id := OLD.billing_settlement_asaas_payment_id;
  NEW.is_demo                            := OLD.is_demo;
  NEW.acesso_liberado_nota               := OLD.acesso_liberado_nota;
  -- setup_fee_estimated_inscricoes NÃO é protegida (ver 20260802).
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_commission_columns_trigger ON public.events;
DROP TRIGGER IF EXISTS aa_protect_commission_columns_trigger ON public.events;
CREATE TRIGGER aa_protect_commission_columns_trigger
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.protect_commission_columns();

NOTIFY pgrst, 'reload schema';
