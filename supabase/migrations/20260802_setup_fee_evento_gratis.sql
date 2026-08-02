-- Taxa única de ativação (setup fee) pra evento 100% gratuito (sem nenhuma
-- venda: inscrição, workshop, ingresso de audiência, taxa de seletiva de
-- vídeo). Decisão de produto 2026-08-02 (Modelo B, ver conversa com o CEO):
-- reaproveita a mesma tabela `standalone_pricing_config` já usada pela
-- ferramenta de cotação do Terminal de Júri avulso (faixas editáveis sem
-- deploy). Faixas por nº de inscrições ESTIMADO pelo produtor (só inscrição
-- conta pro tier — workshop/ingresso não entram na contagem).

-- ── 1. Novas colunas em events ──────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS setup_fee_paid_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_fee_grandfathered         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS setup_fee_tier_chave            TEXT,
  ADD COLUMN IF NOT EXISTS setup_fee_amount_paid           NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS setup_fee_estimated_inscricoes  INTEGER,
  ADD COLUMN IF NOT EXISTS setup_fee_asaas_payment_id      TEXT;

COMMENT ON COLUMN events.setup_fee_paid_at IS 'Quando a taxa de ativação do evento gratuito foi confirmada (webhook Asaas). NULL = pendente.';
COMMENT ON COLUMN events.setup_fee_grandfathered IS 'true = isento retroativo (evento já existia antes do lançamento da feature, ou isenção manual via Super Admin).';
COMMENT ON COLUMN events.setup_fee_tier_chave IS 'chave de standalone_pricing_config (categoria setup_gratis) referente à faixa paga/vigente.';
COMMENT ON COLUMN events.setup_fee_estimated_inscricoes IS 'Estimativa que o produtor declarou ao ativar — usada só pra escolher a faixa inicial, sem fiscalização automática.';

-- ── 2. Grandfather — todo evento que já existe fica isento retroativo ───
-- Safe mesmo pra eventos pagos (a condição de gate nunca se aplica a eles).
UPDATE events SET setup_fee_grandfathered = true WHERE setup_fee_grandfathered = false;

-- ── 3. Categoria nova em standalone_pricing_config ──────────────────────
ALTER TABLE standalone_pricing_config DROP CONSTRAINT IF EXISTS standalone_pricing_config_categoria_check;
ALTER TABLE standalone_pricing_config ADD CONSTRAINT standalone_pricing_config_categoria_check
  CHECK (categoria IN ('terminal', 'operador', 'setup', 'setup_gratis'));

-- `chave` não tem UNIQUE constraint (schema original de 20260727b) — usa
-- INSERT ... WHERE NOT EXISTS em vez de ON CONFLICT (que aqui só recairia
-- no PK `id`, sempre novo via gen_random_uuid(), duplicando as 3 faixas
-- silenciosamente se este arquivo rodar 2x).
INSERT INTO standalone_pricing_config (categoria, chave, label, qty_min, qty_max, valor_min, valor_max, unidade, ordem)
SELECT * FROM (VALUES
  ('setup_gratis', 'setup_gratis_tier_0', 'Até 50 inscrições',        0,   50,  297.00, 297.00, 'evento', 1),
  ('setup_gratis', 'setup_gratis_tier_1', '51 a 150 inscrições',     51,  150,  497.00, 497.00, 'evento', 2),
  ('setup_gratis', 'setup_gratis_tier_2', '151+ inscrições',        151, NULL,  797.00, 797.00, 'evento', 3)
) AS v(categoria, chave, label, qty_min, qty_max, valor_min, valor_max, unidade, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM standalone_pricing_config existing WHERE existing.chave = v.chave
);

-- ── 3b. Produtor precisa ler as faixas (qty_max/label) no próprio Dashboard
-- pra saber quando está perto do teto — RLS de standalone_pricing_config
-- hoje é só is_super_admin (ferramenta de cotação interna). Libera SELECT
-- pra authenticated (é só tabela de preço público, sem dado sensível).
DROP POLICY IF EXISTS "authenticated_reads_pricing_config" ON standalone_pricing_config;
CREATE POLICY "authenticated_reads_pricing_config" ON standalone_pricing_config
  FOR SELECT TO authenticated USING (true);

-- ── 4. Helper: evento é 100% gratuito? ──────────────────────────────────
-- Checa as 4 fontes de receita possíveis: formações (inscrição), ingressos
-- de audiência, workshops, taxa de seletiva de vídeo. Qualquer uma com
-- preço > 0 já tira o evento da regra (comissão normal assume).
CREATE OR REPLACE FUNCTION is_event_fully_free(p_event_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  v_event RECORD;
  v_has_paid_formacao BOOLEAN;
  v_has_paid_ingresso  BOOLEAN;
  v_has_paid_workshop  BOOLEAN;
BEGIN
  SELECT formacoes_config, audience_sales_enabled, ingressos_config, video_selection_fee
    INTO v_event
    FROM events WHERE id = p_event_id;

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_event.formacoes_config, '[]'::jsonb)) elem
    WHERE COALESCE((elem->>'fee')::numeric, 0) > 0
  ) INTO v_has_paid_formacao;

  SELECT (
    v_event.audience_sales_enabled IS TRUE
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_event.ingressos_config, '[]'::jsonb)) elem
      WHERE COALESCE((elem->>'preco')::numeric, 0) > 0
    )
  ) INTO v_has_paid_ingresso;

  SELECT EXISTS (
    SELECT 1 FROM workshops w
    WHERE w.event_id = p_event_id AND COALESCE(w.preco_padrao, 0) > 0
  ) INTO v_has_paid_workshop;

  RETURN NOT v_has_paid_formacao
    AND NOT v_has_paid_ingresso
    AND NOT v_has_paid_workshop
    AND COALESCE(v_event.video_selection_fee, 0) = 0;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION is_event_fully_free(UUID) TO authenticated;

-- ── 5. Protege colunas de setup fee (só service_role/super admin escrevem) ──
-- Estende a mesma função já usada pra commission_type/percent/fixed/event_type
-- (supabase/migrations/20260613_protect_event_type.sql) — produtor não pode
-- setar a própria taxa como paga via UPDATE direto.
CREATE OR REPLACE FUNCTION protect_commission_columns() RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'
  ) THEN
    RETURN NEW;
  END IF;

  NEW.commission_type    := OLD.commission_type;
  NEW.commission_percent := OLD.commission_percent;
  NEW.commission_fixed   := OLD.commission_fixed;
  NEW.event_type         := OLD.event_type;
  NEW.setup_fee_paid_at         := OLD.setup_fee_paid_at;
  NEW.setup_fee_grandfathered   := OLD.setup_fee_grandfathered;
  NEW.setup_fee_tier_chave      := OLD.setup_fee_tier_chave;
  NEW.setup_fee_amount_paid     := OLD.setup_fee_amount_paid;
  NEW.setup_fee_asaas_payment_id := OLD.setup_fee_asaas_payment_id;
  -- setup_fee_estimated_inscricoes NÃO é protegida — o próprio produtor
  -- declara a estimativa ao ativar (edge function grava via service_role,
  -- mas nada impede o produtor de também editar via UPDATE direto; não é
  -- campo sensível, só direciona a faixa inicial sugerida).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- (trigger já existe, CREATE OR REPLACE FUNCTION acima é suficiente)

-- ── 6. Trigger: bloqueia inscrição além do teto da faixa paga ───────────
-- Só se aplica quando o evento é 100% gratuito (is_event_fully_free). Se
-- ainda não pagou (setup_fee_paid_at IS NULL, sem grandfather/demo/governo),
-- bloqueia QUALQUER inscrição nova. Se já pagou, bloqueia só quando o nº de
-- inscrições atuais alcança o teto (qty_max) da faixa vigente — aguardando
-- upgrade automático (nova cobrança, libera sozinho no webhook).
CREATE OR REPLACE FUNCTION enforce_free_event_setup_fee() RETURNS trigger AS $$
DECLARE
  v_event RECORD;
  v_tier  RECORD;
  v_count INTEGER;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN') THEN
    RETURN NEW;
  END IF;

  SELECT id, is_demo, event_type, setup_fee_paid_at, setup_fee_grandfathered, setup_fee_tier_chave
    INTO v_event FROM events WHERE id = NEW.event_id;

  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_event.is_demo THEN RETURN NEW; END IF;
  IF v_event.event_type = 'government' THEN RETURN NEW; END IF;
  IF v_event.setup_fee_grandfathered THEN RETURN NEW; END IF;
  IF NOT is_event_fully_free(v_event.id) THEN RETURN NEW; END IF;

  IF v_event.setup_fee_paid_at IS NULL THEN
    RAISE EXCEPTION 'FREE_EVENT_SETUP_FEE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT qty_max INTO v_tier FROM standalone_pricing_config
    WHERE chave = v_event.setup_fee_tier_chave AND categoria = 'setup_gratis';

  IF v_tier.qty_max IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM registrations
      WHERE event_id = v_event.id AND status_pagamento <> 'ESTORNADO';
    IF v_count >= v_tier.qty_max THEN
      RAISE EXCEPTION 'FREE_EVENT_TIER_EXCEEDED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_free_event_setup_fee_trigger ON registrations;
CREATE TRIGGER enforce_free_event_setup_fee_trigger
  BEFORE INSERT ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_free_event_setup_fee();

NOTIFY pgrst, 'reload schema';
