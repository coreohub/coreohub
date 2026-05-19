-- Seletiva por vídeo — Modelo 3 configurável (Modelos 1+2+3 numa mesma impl)
--
-- Pré-existente em events: video_selection_enabled, video_selection_fee,
-- video_selection_fee_required, video_fee_refund_policy, video_submission_deadline.
-- Pré-existente em registrations: video_url, video_status, video_feedback,
-- video_submitted_at, video_fee_status, video_fee_payment_id.
--
-- Esta migration completa o schema com:
--  - Aprovação rastreável (quem/quando)
--  - Multi-jurado opcional (v1: majority rule; produtor solo se count=1)
--  - Refund parcial configurável (50% default)
--  - Cupom aplicável em taxa de seletiva
--  - Index pra produtor encontrar rápido o que tá aguardando análise

-- ── 1) Aprovação rastreável (Modelo 3 dispara 2ª cobrança) ─────────────────
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS video_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS video_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN registrations.video_approved_at IS
  'Timestamp da aprovação final do vídeo. NULL = ainda não avaliado/rejeitado/conditional. Usado pra idempotência da 2ª cobrança (não cria se já aprovou).';

-- status_pagamento ganha valor lógico AGUARDANDO_VIDEO (não há check constraint
-- na coluna então só documentamos).
COMMENT ON COLUMN registrations.status_pagamento IS
  'PENDENTE | APROVADO | VENCIDO | ESTORNADO | AGUARDANDO_VIDEO. AGUARDANDO_VIDEO entra quando event.video_selection_fee_required=true: registration espera taxa A + avaliação antes de gerar cobrança da inscrição cheia.';

-- ── 2) Configuração de avaliação em events ─────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS video_evaluators_count        INT     DEFAULT 1,
  ADD COLUMN IF NOT EXISTS video_evaluation_rule         TEXT    DEFAULT 'majority',
  ADD COLUMN IF NOT EXISTS video_fee_partial_refund_percent NUMERIC(5,2) DEFAULT 50;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_video_evaluators_count_chk;
ALTER TABLE events
  ADD CONSTRAINT events_video_evaluators_count_chk
  CHECK (video_evaluators_count IS NULL OR video_evaluators_count >= 1);

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_video_evaluation_rule_chk;
ALTER TABLE events
  ADD CONSTRAINT events_video_evaluation_rule_chk
  CHECK (video_evaluation_rule IS NULL OR video_evaluation_rule IN ('majority', 'unanimous'));

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_video_fee_partial_refund_chk;
ALTER TABLE events
  ADD CONSTRAINT events_video_fee_partial_refund_chk
  CHECK (video_fee_partial_refund_percent IS NULL OR (video_fee_partial_refund_percent >= 0 AND video_fee_partial_refund_percent <= 100));

COMMENT ON COLUMN events.video_evaluators_count IS
  'Quantos jurados precisam avaliar o vídeo antes de definir aprovação. 1 (default) = produtor decide solo via VideoSelection.tsx, ignora video_evaluations. >=2 = multi-jurado via /jurado-seletiva (blind), regra agregada em video_evaluation_rule.';

COMMENT ON COLUMN events.video_evaluation_rule IS
  'majority (default) = mais da metade dos jurados aprova. unanimous = todos aprovam. Qualquer voto conditional override pra conditional (espera re-envio).';

COMMENT ON COLUMN events.video_fee_partial_refund_percent IS
  'Quando video_fee_refund_policy = partial_refund, qual % da taxa A é estornado em caso de reprovação. Default 50.';

-- ── 3) Flag em judges pra elegibilidade na seletiva ────────────────────────
ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS can_evaluate_video BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN judges.can_evaluate_video IS
  'TRUE (default) = jurado tem acesso à fila de seletiva de vídeo do evento. Produtor desmarca em JudgesManagement pra restringir avaliação de vídeo a um subset dos jurados de palco.';

-- ── 4) Tabela video_evaluations (multi-jurado, opcional) ───────────────────
-- Usada apenas quando events.video_evaluators_count >= 2. Modo solo (count=1)
-- mantém VideoSelection.tsx escrevendo direto em registrations.video_status.
CREATE TABLE IF NOT EXISTS video_evaluations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  judge_id        UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  decision        TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'conditional')),
  feedback        TEXT,
  score           NUMERIC(4,2) CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Um jurado avalia cada registration 1x. Re-avaliação = UPDATE.
  UNIQUE (registration_id, judge_id)
);

CREATE INDEX IF NOT EXISTS idx_video_evaluations_registration
  ON video_evaluations (registration_id);

CREATE INDEX IF NOT EXISTS idx_video_evaluations_judge
  ON video_evaluations (judge_id);

-- RLS — jurados leem só as próprias avaliações; produtor lê tudo do evento dele
ALTER TABLE video_evaluations ENABLE ROW LEVEL SECURITY;

-- Service role tem bypass automático (não precisa de policy). Policies abaixo
-- são pra acesso authenticated (produtor logado via Supabase auth).
DROP POLICY IF EXISTS video_evaluations_producer_select ON video_evaluations;
CREATE POLICY video_evaluations_producer_select ON video_evaluations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM registrations r
      JOIN events e ON e.id = r.event_id
      WHERE r.id = video_evaluations.registration_id
        AND e.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS video_evaluations_producer_modify ON video_evaluations;
CREATE POLICY video_evaluations_producer_modify ON video_evaluations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM registrations r
      JOIN events e ON e.id = r.event_id
      WHERE r.id = video_evaluations.registration_id
        AND e.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM registrations r
      JOIN events e ON e.id = r.event_id
      WHERE r.id = video_evaluations.registration_id
        AND e.created_by = auth.uid()
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION trg_video_evaluations_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS video_evaluations_updated_at ON video_evaluations;
CREATE TRIGGER video_evaluations_updated_at
  BEFORE UPDATE ON video_evaluations
  FOR EACH ROW EXECUTE FUNCTION trg_video_evaluations_set_updated_at();

-- ── 5) Cupom em taxa de seletiva ───────────────────────────────────────────
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_scope_check;
ALTER TABLE coupons
  ADD CONSTRAINT coupons_scope_check
  CHECK (scope IN ('inscription', 'audience', 'workshop', 'video_selection', 'both', 'all'));

COMMENT ON COLUMN coupons.scope IS
  'inscription = só inscrições. audience = só plateia. workshop = só workshops. video_selection = só taxa de seletiva de vídeo. both = inscrição+plateia (legacy). all = todos (inscrição+plateia+workshop+video_selection).';

-- ── 6) Index pra produtor encontrar rápido o que aguarda análise ───────────
CREATE INDEX IF NOT EXISTS idx_registrations_aguardando_video
  ON registrations(event_id)
  WHERE status_pagamento = 'AGUARDANDO_VIDEO' AND video_status = 'submitted';

-- ── 6b) Trigger SQL agregador: video_evaluations → registrations.video_status
-- Quando jurado insere/atualiza avaliação, recomputa status agregado da reg.
-- Regras (events.video_evaluation_rule):
--   - Qualquer voto 'conditional' override pra 'conditional' (aguarda re-envio)
--   - Majority: approves > rejects → approved; rejects > approves → rejected; tie/incompleto → submitted
--   - Unanimous: todos approve → approved; qualquer reject → rejected; senão submitted
-- Threshold: só decide quando count(evaluations) >= event.video_evaluators_count.
-- video_approved_at é setado quando vira approved (idempotente — só seta se ainda NULL).

CREATE OR REPLACE FUNCTION fn_aggregate_video_evaluations()
RETURNS TRIGGER AS $$
DECLARE
  v_registration_id UUID;
  v_event_id        UUID;
  v_required_count  INT;
  v_rule            TEXT;
  v_total           INT;
  v_approves        INT;
  v_rejects         INT;
  v_conditionals    INT;
  v_new_status      TEXT;
BEGIN
  v_registration_id := COALESCE(NEW.registration_id, OLD.registration_id);

  -- Lê evento via registration
  SELECT r.event_id INTO v_event_id
  FROM registrations r WHERE r.id = v_registration_id;
  IF v_event_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(video_evaluators_count, 1), COALESCE(video_evaluation_rule, 'majority')
    INTO v_required_count, v_rule
    FROM events WHERE id = v_event_id;

  -- Modo solo (count=1) usa fluxo direto via VideoSelection.tsx — não passa por
  -- video_evaluations. Trigger é no-op nesse caso (defesa em profundidade).
  IF v_required_count <= 1 THEN RETURN NEW; END IF;

  -- Contadores
  SELECT
    COUNT(*) FILTER (WHERE decision IS NOT NULL),
    COUNT(*) FILTER (WHERE decision = 'approve'),
    COUNT(*) FILTER (WHERE decision = 'reject'),
    COUNT(*) FILTER (WHERE decision = 'conditional')
    INTO v_total, v_approves, v_rejects, v_conditionals
    FROM video_evaluations WHERE registration_id = v_registration_id;

  -- Conditional override (qualquer jurado pediu re-envio)
  IF v_conditionals > 0 THEN
    v_new_status := 'conditional';
  ELSIF v_total >= v_required_count THEN
    IF v_rule = 'unanimous' THEN
      IF v_approves = v_total THEN v_new_status := 'approved';
      ELSIF v_rejects >= 1   THEN v_new_status := 'rejected';
      ELSE                        v_new_status := 'submitted';
      END IF;
    ELSE  -- majority (default)
      IF v_approves > v_rejects THEN v_new_status := 'approved';
      ELSIF v_rejects > v_approves THEN v_new_status := 'rejected';
      ELSE v_new_status := 'submitted';  -- empate
      END IF;
    END IF;
  ELSE
    v_new_status := 'submitted';  -- ainda aguarda mais avaliações
  END IF;

  -- Atualiza registration. video_approved_at só é setado uma vez na 1ª approved.
  UPDATE registrations
     SET video_status      = v_new_status,
         video_approved_at = CASE
           WHEN v_new_status = 'approved' AND video_approved_at IS NULL
             THEN NOW()
           WHEN v_new_status != 'approved'
             THEN NULL  -- revogou aprovação (caso jurado mude voto)
           ELSE video_approved_at
         END
   WHERE id = v_registration_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS video_evaluations_aggregate ON video_evaluations;
CREATE TRIGGER video_evaluations_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON video_evaluations
  FOR EACH ROW EXECUTE FUNCTION fn_aggregate_video_evaluations();

-- ── 6c) RPC validate_video_coupon (callable por authenticated) ─────────────
-- Mesma shape do validate_audience_coupon (20260516_audience_tier2.sql) mas
-- filtra scope IN ('video_selection', 'all'). Usado no SeletivaInscrito pra
-- mostrar desconto antes de criar a cobrança da taxa A.
CREATE OR REPLACE FUNCTION validate_video_coupon(
  p_event_id UUID,
  p_code TEXT,
  p_base_value NUMERIC
)
RETURNS TABLE (
  coupon_id UUID,
  code TEXT,
  discount_type TEXT,
  discount_value NUMERIC,
  discount NUMERIC,
  final_value NUMERIC,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon coupons%ROWTYPE;
  v_normalized TEXT := upper(trim(p_code));
  v_discount NUMERIC;
  v_final NUMERIC;
BEGIN
  IF v_normalized = '' OR v_normalized IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Informe o código do cupom'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_coupon
  FROM coupons
  WHERE event_id = p_event_id
    AND coupons.code = v_normalized
    AND is_active = TRUE
    AND scope IN ('video_selection', 'all')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom inválido ou inativo'::TEXT;
    RETURN;
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < CURRENT_DATE THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom expirado'::TEXT;
    RETURN;
  END IF;

  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Cupom esgotado'::TEXT;
    RETURN;
  END IF;

  v_discount := CASE
    WHEN v_coupon.discount_type = 'percent' THEN ROUND(p_base_value * (v_coupon.discount_value / 100.0), 2)
    ELSE LEAST(v_coupon.discount_value, p_base_value)
  END;
  v_final := GREATEST(0, p_base_value - v_discount);

  RETURN QUERY SELECT v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, v_discount, v_final, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_video_coupon(UUID, TEXT, NUMERIC) TO authenticated;

-- ── 7) Discriminador em platform_commissions ───────────────────────────────
-- Modelo 3 gera 2 commissions pro mesmo registration_id: taxa A (video_selection)
-- + taxa B (registration). Sem discriminador, relatórios duplicam receita.
ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'registration';

ALTER TABLE platform_commissions DROP CONSTRAINT IF EXISTS platform_commissions_kind_chk;
ALTER TABLE platform_commissions
  ADD CONSTRAINT platform_commissions_kind_chk
  CHECK (kind IN ('registration', 'audience', 'workshop', 'video_selection'));

COMMENT ON COLUMN platform_commissions.kind IS
  'Tipo da comissão: registration (inscrição cheia, default), audience (plateia), workshop (workshop), video_selection (taxa de seletiva — Modelo 3). Filtre por kind nos relatórios pra evitar dupla contagem em Modelo 3.';

CREATE INDEX IF NOT EXISTS idx_platform_commissions_kind
  ON platform_commissions(kind) WHERE kind != 'registration';

NOTIFY pgrst, 'reload schema';
