-- ════════════════════════════════════════════════════════════════════════════
-- Workshops como entidade independente — Etapa 1 do plano
-- (backlog_workshops_certificados.md, decidido em 2026-05-13)
--
-- Workshop pode estar dentro de um festival (event_id preenchido) OU ser
-- standalone (event_id NULL — produtor vende workshop sozinho).
--
-- Suporta 3 modos de pricing combináveis:
--   1. Standalone   → preco_padrao
--   2. Combo c/ mostra → preco_inscritos_mostra (desconto pra quem está inscrito)
--   3. Grátis para inscritos → gratis_para_inscritos = TRUE
--
-- Toggle auto_detect_combo (decidido pelo produtor) cruza CPF do comprador
-- com registrations APROVADAS no event_id pra aplicar combo automaticamente.
--
-- Padrão de schema/RLS/RPC clonado do Tier 2 (audience_tickets) que já está
-- consolidado e validado E2E em produção.
--
-- APLICAÇÃO: cole as 7 seções no SQL Editor (pode rodar em pedaços ou tudo).
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) Estende coupons.scope: agora aceita 'workshop' e 'all' ──────────────
-- Mantém 'inscription'/'audience'/'both' (legacy) pra retrocompat.
-- 'workshop' = só workshop. 'all' = inscrição + plateia + workshop.

ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_scope_check;
ALTER TABLE coupons
  ADD CONSTRAINT coupons_scope_check
  CHECK (scope IN ('inscription', 'audience', 'workshop', 'both', 'all'));

COMMENT ON COLUMN coupons.scope IS
  'inscription = só inscrições (registrations). audience = só plateia (audience_tickets). workshop = só workshops. both = inscrição+plateia (legacy). all = inscrição+plateia+workshop.';


-- ── 2) Tabela workshops (atividade do produtor) ─────────────────────────────
CREATE TABLE IF NOT EXISTS workshops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vínculo opcional com festival. NULL = workshop standalone.
  event_id        UUID REFERENCES events(id) ON DELETE CASCADE,

  -- Dono (sempre obrigatório, mesmo standalone)
  created_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Identidade pública
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE,
  description     TEXT,
  cover_url       TEXT,

  -- Professor (alimenta o PersonCard da vitrine — Etapa 1.5)
  professor_name        TEXT NOT NULL,
  professor_bio         TEXT,
  professor_bio_short   TEXT,                 -- 140 chars (PersonCard nivel "Padrão")
  professor_photo_url   TEXT,
  professor_instagram   TEXT,
  professor_site_url    TEXT,
  professor_is_public   BOOLEAN NOT NULL DEFAULT TRUE,

  -- Atividade
  modalidade  TEXT,                           -- 'Jazz', 'Hip-Hop', 'Contemporâneo', 'Ballet'...
  nivel       TEXT NOT NULL DEFAULT 'todos'
    CHECK (nivel IN ('iniciante', 'intermediario', 'avancado', 'todos')),

  -- Logística
  data_inicio       TIMESTAMPTZ NOT NULL,
  data_fim          TIMESTAMPTZ,
  duracao_minutos   INT,
  local             TEXT,
  capacidade_max    INT,                      -- estoque (NULL = ilimitado)

  -- Pricing modos
  preco_padrao              NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (preco_padrao >= 0),
  preco_inscritos_mostra    NUMERIC(10,2)   CHECK (preco_inscritos_mostra IS NULL OR preco_inscritos_mostra >= 0),
  gratis_para_inscritos     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Produtor decide ligar/desligar a detecção automática de combo (item #3)
  auto_detect_combo         BOOLEAN NOT NULL DEFAULT TRUE,

  -- Comissão (espelha events.audience_*)
  workshop_commission_percent  NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  workshop_fee_mode            TEXT NOT NULL DEFAULT 'repassar'
    CHECK (workshop_fee_mode IN ('repassar', 'absorver')),
  workshop_max_per_cpf         INT NOT NULL DEFAULT 4,
  workshop_reservation_minutes INT NOT NULL DEFAULT 10
    CHECK (workshop_reservation_minutes BETWEEN 1 AND 60),

  -- Publicação
  is_published BOOLEAN NOT NULL DEFAULT FALSE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Coerência: gratis_para_inscritos exige event_id (sem mostra, não tem como ser grátis pra inscritos)
  CONSTRAINT workshops_gratis_requires_event
    CHECK (NOT gratis_para_inscritos OR event_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS workshops_event_idx       ON workshops(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workshops_owner_idx       ON workshops(created_by);
CREATE INDEX IF NOT EXISTS workshops_published_idx   ON workshops(is_published) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS workshops_data_inicio_idx ON workshops(data_inicio);

CREATE OR REPLACE FUNCTION workshops_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workshops_updated_at ON workshops;
CREATE TRIGGER workshops_updated_at
  BEFORE UPDATE ON workshops
  FOR EACH ROW EXECUTE FUNCTION workshops_set_updated_at();


-- ── 3) Tabela workshop_lots (lotes de preço do workshop) ───────────────────
-- Decisão item #1: lotes em workshop SIM (alinhar com Tier 2 de plateia).
-- Lote separado em tabela própria (não inline jsonb): permite estoque por lote
-- + histórico + facilita consulta no checkout.

CREATE TABLE IF NOT EXISTS workshop_lots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id     UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,

  ordem           INT NOT NULL DEFAULT 1,         -- 1, 2, 3... (ordem cronológica)
  nome            TEXT NOT NULL,                  -- "1º lote", "Pré-evento", "Last call"
  preco           NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
  preco_inscritos_mostra NUMERIC(10,2) CHECK (preco_inscritos_mostra IS NULL OR preco_inscritos_mostra >= 0),

  -- Janela de venda do lote (NULL = sem restrição)
  data_inicio     TIMESTAMPTZ,
  data_fim        TIMESTAMPTZ,

  -- Estoque do lote (NULL = sem limite)
  quantidade_maxima INT,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workshop_id, ordem)
);

CREATE INDEX IF NOT EXISTS workshop_lots_workshop_idx ON workshop_lots(workshop_id);

DROP TRIGGER IF EXISTS workshop_lots_updated_at ON workshop_lots;
CREATE TRIGGER workshop_lots_updated_at
  BEFORE UPDATE ON workshop_lots
  FOR EACH ROW EXECUTE FUNCTION workshops_set_updated_at();


-- ── 4) Tabela workshop_registrations (inscrições/compras) ──────────────────
-- Espelha audience_tickets em estrutura. Diferenças:
--   • registration_id pra family ticket → combo_registration_id (vínculo c/ mostra)
--   • check_in_status (portão) → attended (presença pra emitir certificado)
--   • novo status 'GRATUITO' (workshop com gratis_para_inscritos=TRUE não tem cobrança)

CREATE TABLE IF NOT EXISTS workshop_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id     UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  workshop_lot_id UUID REFERENCES workshop_lots(id) ON DELETE SET NULL,

  -- Snapshot do lote (igual ticket_type_*: histórico imune a edição posterior)
  lot_nome        TEXT,
  lot_ordem       INT,

  -- Comprador (guest checkout)
  buyer_name   TEXT NOT NULL,
  buyer_email  TEXT NOT NULL,
  buyer_cpf    TEXT NOT NULL,
  buyer_phone  TEXT,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- se logado

  -- Combo c/ mostra (item #3 — produtor decide auto detectar)
  combo_registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  is_combo              BOOLEAN NOT NULL DEFAULT FALSE,

  -- Pricing snapshot
  preco_base    NUMERIC(10,2) NOT NULL CHECK (preco_base >= 0),
  preco_pago    NUMERIC(10,2) NOT NULL CHECK (preco_pago >= 0),

  -- Cupom snapshot
  coupon_id        UUID REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_code      TEXT,
  discount_amount  NUMERIC(10,2),

  -- Pagamento
  status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status_pagamento IN ('PENDENTE','APROVADO','CANCELADO','VENCIDO','ESTORNADO','CORTESIA','GRATUITO')),
  payment_id        TEXT,
  payment_url       TEXT,
  payment_method    TEXT,
  paid_at           TIMESTAMPTZ,
  reserved_until    TIMESTAMPTZ,

  -- Comissão snapshot
  commission_amount NUMERIC(10,2),
  producer_amount   NUMERIC(10,2),
  fee_mode          TEXT,

  -- Acesso público sem login
  access_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

  -- Presença (pré-requisito pra emitir certificado — Etapa 2)
  attended       BOOLEAN NOT NULL DEFAULT FALSE,
  attended_at    TIMESTAMPTZ,
  attended_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Refund
  refunded_at    TIMESTAMPTZ,
  refund_amount  NUMERIC(10,2),
  refund_reason  TEXT,
  refund_id      TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workshop_regs_workshop_idx     ON workshop_registrations(workshop_id);
CREATE INDEX IF NOT EXISTS workshop_regs_email_idx        ON workshop_registrations(buyer_email);
CREATE INDEX IF NOT EXISTS workshop_regs_cpf_idx          ON workshop_registrations(buyer_cpf);
CREATE INDEX IF NOT EXISTS workshop_regs_payment_idx      ON workshop_registrations(payment_id);
CREATE INDEX IF NOT EXISTS workshop_regs_status_idx       ON workshop_registrations(status_pagamento);
CREATE INDEX IF NOT EXISTS workshop_regs_combo_idx        ON workshop_registrations(combo_registration_id) WHERE combo_registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workshop_regs_user_idx         ON workshop_registrations(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workshop_regs_reserved_idx     ON workshop_registrations(reserved_until)
  WHERE reserved_until IS NOT NULL AND status_pagamento = 'PENDENTE';

DROP TRIGGER IF EXISTS workshop_registrations_updated_at ON workshop_registrations;
CREATE TRIGGER workshop_registrations_updated_at
  BEFORE UPDATE ON workshop_registrations
  FOR EACH ROW EXECUTE FUNCTION workshops_set_updated_at();

-- Trigger simétrico de cupom (clone do audience_tickets — incrementa/decrementa
-- coupons.used_count em transições e revive em reverse-transition)
CREATE OR REPLACE FUNCTION workshop_regs_coupon_release_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.coupon_id IS NOT NULL THEN
    IF OLD.status_pagamento IN ('PENDENTE', 'APROVADO')
       AND NEW.status_pagamento IN ('CANCELADO', 'VENCIDO', 'ESTORNADO')
    THEN
      UPDATE coupons SET used_count = GREATEST(0, used_count - 1) WHERE id = OLD.coupon_id;
    END IF;
    IF OLD.status_pagamento IN ('CANCELADO', 'VENCIDO')
       AND NEW.status_pagamento IN ('PENDENTE', 'APROVADO')
    THEN
      UPDATE coupons SET used_count = used_count + 1 WHERE id = OLD.coupon_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workshop_regs_coupon_release ON workshop_registrations;
CREATE TRIGGER workshop_regs_coupon_release
  AFTER UPDATE OF status_pagamento ON workshop_registrations
  FOR EACH ROW
  WHEN (OLD.status_pagamento IS DISTINCT FROM NEW.status_pagamento)
  EXECUTE FUNCTION workshop_regs_coupon_release_fn();


-- ── 5) RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE workshops              ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_lots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_registrations ENABLE ROW LEVEL SECURITY;

-- Anon vê APENAS workshops publicados (vitrine)
DROP POLICY IF EXISTS workshops_anon_read_published ON workshops;
CREATE POLICY workshops_anon_read_published
  ON workshops FOR SELECT TO anon
  USING (is_published = TRUE);

-- Authenticated vê os próprios + os publicados de outros
DROP POLICY IF EXISTS workshops_auth_read ON workshops;
CREATE POLICY workshops_auth_read
  ON workshops FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR is_published = TRUE);

-- Producer CRUD seus workshops
DROP POLICY IF EXISTS workshops_producer_insert ON workshops;
CREATE POLICY workshops_producer_insert
  ON workshops FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS workshops_producer_update ON workshops;
CREATE POLICY workshops_producer_update
  ON workshops FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS workshops_producer_delete ON workshops;
CREATE POLICY workshops_producer_delete
  ON workshops FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- workshop_lots: anon lê lotes de workshops publicados (vitrine);
-- producer CRUD via FK do workshop dele
DROP POLICY IF EXISTS workshop_lots_anon_read ON workshop_lots;
CREATE POLICY workshop_lots_anon_read
  ON workshop_lots FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_lots.workshop_id AND w.is_published = TRUE
    )
  );

DROP POLICY IF EXISTS workshop_lots_auth_read ON workshop_lots;
CREATE POLICY workshop_lots_auth_read
  ON workshop_lots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_lots.workshop_id
        AND (w.created_by = auth.uid() OR w.is_published = TRUE)
    )
  );

DROP POLICY IF EXISTS workshop_lots_producer_write ON workshop_lots;
CREATE POLICY workshop_lots_producer_write
  ON workshop_lots FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM workshops w WHERE w.id = workshop_lots.workshop_id AND w.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM workshops w WHERE w.id = workshop_lots.workshop_id AND w.created_by = auth.uid())
  );

-- workshop_registrations: anon nunca acessa direto (RPC by_token); producer só lê dos próprios
DROP POLICY IF EXISTS workshop_regs_producer_read ON workshop_registrations;
CREATE POLICY workshop_regs_producer_read
  ON workshop_registrations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_registrations.workshop_id AND w.created_by = auth.uid()
    )
    OR user_id = auth.uid()  -- inscrito vê os próprios (pra /meus-workshops)
  );

DROP POLICY IF EXISTS workshop_regs_producer_update ON workshop_registrations;
CREATE POLICY workshop_regs_producer_update
  ON workshop_registrations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_registrations.workshop_id AND w.created_by = auth.uid()
    )
  );

-- INSERT só via service_role (try_reserve_workshop_registration)


-- ── 6) platform_commissions: vínculo opcional com workshop_registration ────
ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS workshop_registration_id UUID REFERENCES workshop_registrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_platform_commissions_workshop
  ON platform_commissions(workshop_registration_id)
  WHERE workshop_registration_id IS NOT NULL;


-- ── 7) RPCs públicas + transacionais ───────────────────────────────────────

-- 7.1) Validate workshop coupon (chamado pelo frontend antes do checkout)
CREATE OR REPLACE FUNCTION validate_workshop_coupon(
  p_workshop_id UUID,
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
  v_event UUID;
  v_discount NUMERIC;
  v_final NUMERIC;
BEGIN
  IF v_normalized = '' OR v_normalized IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, 'Informe o código do cupom'::TEXT;
    RETURN;
  END IF;

  SELECT event_id INTO v_event FROM workshops WHERE id = p_workshop_id;

  -- Cupom pode ter event_id atrelado (escopo do festival) OU event_id NULL (global do produtor).
  -- Workshop standalone (sem event_id) só aceita cupons globais.
  SELECT * INTO v_coupon
  FROM coupons
  WHERE coupons.code = v_normalized
    AND is_active = TRUE
    AND scope IN ('workshop', 'all')
    AND (
      (event_id IS NULL)                              -- cupom global
      OR (v_event IS NOT NULL AND event_id = v_event) -- ou casado com mesmo event
    )
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

GRANT EXECUTE ON FUNCTION validate_workshop_coupon(UUID, TEXT, NUMERIC) TO anon, authenticated;


-- 7.2) Get workshop stock (vitrine pública) — quanto resta no lote ativo
CREATE OR REPLACE FUNCTION get_workshop_stock(p_workshop_id UUID)
RETURNS TABLE (
  capacidade_max INT,
  vendidos INT,
  restantes INT,
  esgotado BOOLEAN,
  active_lot_id UUID,
  active_lot_nome TEXT,
  active_lot_preco NUMERIC,
  active_lot_preco_combo NUMERIC,
  active_lot_quantidade_max INT,
  active_lot_vendidos INT,
  active_lot_restantes INT,
  active_lot_esgotado BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_cap INT;
  v_total_sold INT;
  v_lot RECORD;
  v_lot_sold INT;
BEGIN
  SELECT capacidade_max INTO v_cap FROM workshops WHERE id = p_workshop_id;

  -- Total vendidos do workshop inteiro (todos os lotes)
  SELECT COUNT(*) INTO v_total_sold
  FROM workshop_registrations
  WHERE workshop_id = p_workshop_id
    AND (
      status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
      OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
    );

  -- Lote ativo: ordem mais alta com is_active e dentro da janela (data_inicio <= now <= data_fim)
  SELECT * INTO v_lot
  FROM workshop_lots
  WHERE workshop_id = p_workshop_id
    AND is_active = TRUE
    AND (data_inicio IS NULL OR data_inicio <= now())
    AND (data_fim IS NULL OR data_fim >= now())
  ORDER BY ordem ASC
  LIMIT 1;

  -- Vendidos no lote ativo
  IF v_lot.id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_lot_sold
    FROM workshop_registrations
    WHERE workshop_lot_id = v_lot.id
      AND (
        status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
      );
  ELSE
    v_lot_sold := 0;
  END IF;

  capacidade_max := v_cap;
  vendidos := v_total_sold;
  restantes := CASE WHEN v_cap IS NULL THEN NULL ELSE GREATEST(0, v_cap - v_total_sold) END;
  esgotado := CASE WHEN v_cap IS NULL THEN FALSE ELSE v_total_sold >= v_cap END;

  active_lot_id    := v_lot.id;
  active_lot_nome  := v_lot.nome;
  active_lot_preco := v_lot.preco;
  active_lot_preco_combo    := v_lot.preco_inscritos_mostra;
  active_lot_quantidade_max := v_lot.quantidade_maxima;
  active_lot_vendidos       := v_lot_sold;
  active_lot_restantes      := CASE WHEN v_lot.quantidade_maxima IS NULL THEN NULL ELSE GREATEST(0, v_lot.quantidade_maxima - v_lot_sold) END;
  active_lot_esgotado       := CASE WHEN v_lot.quantidade_maxima IS NULL THEN FALSE ELSE v_lot_sold >= v_lot.quantidade_maxima END;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION get_workshop_stock(UUID) TO anon, authenticated;


-- 7.3) try_reserve_workshop_registration (transacional com lock por CPF)
-- Cria 1 inscrição PENDENTE com reserva de N minutos. Se gratis_para_inscritos
-- + combo válido → status GRATUITO direto (sem Asaas).
-- Race condition resolvida via pg_advisory_xact_lock no hash(workshop_id||cpf).
CREATE OR REPLACE FUNCTION try_reserve_workshop_registration(
  p_workshop_id UUID,
  p_cpf TEXT,
  p_buyer_name TEXT,
  p_buyer_email TEXT,
  p_buyer_phone TEXT,
  p_user_id UUID,
  p_combo_registration_id UUID,
  p_is_combo BOOLEAN,
  p_workshop_lot_id UUID,
  p_lot_nome TEXT,
  p_lot_ordem INT,
  p_preco_base NUMERIC,
  p_preco_pago NUMERIC,
  p_commission_amount NUMERIC,
  p_producer_amount NUMERIC,
  p_fee_mode TEXT,
  p_status_inicial TEXT,           -- 'PENDENTE' (pago) ou 'GRATUITO' (combo grátis)
  p_reserved_minutes INT,
  p_coupon_id UUID,
  p_coupon_code TEXT,
  p_discount_amount NUMERIC
)
RETURNS TABLE (
  registration_id UUID,
  access_token UUID,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_workshop workshops%ROWTYPE;
  v_capacidade_atingida INT;
  v_lot_atingida INT;
  v_existing_count INT;
  v_one_hour_ago TIMESTAMPTZ := now() - interval '1 hour';
  v_reserved TIMESTAMPTZ;
  v_id UUID;
  v_tok UUID;
BEGIN
  -- Lock por workshop+cpf
  v_lock_key := abs(hashtext(p_workshop_id::text || ':' || p_cpf));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_workshop FROM workshops WHERE id = p_workshop_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Workshop não encontrado'::TEXT;
    RETURN;
  END IF;

  -- Estoque do workshop (capacidade_max)
  IF v_workshop.capacidade_max IS NOT NULL THEN
    SELECT COUNT(*) INTO v_capacidade_atingida
    FROM workshop_registrations
    WHERE workshop_id = p_workshop_id
      AND (
        status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
      );
    IF v_capacidade_atingida + 1 > v_workshop.capacidade_max THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID,
        format('Capacidade esgotada (%s vagas)', v_workshop.capacidade_max)::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Estoque do lote (se especificado)
  IF p_workshop_lot_id IS NOT NULL THEN
    DECLARE v_lote_max INT;
    BEGIN
      SELECT quantidade_maxima INTO v_lote_max FROM workshop_lots WHERE id = p_workshop_lot_id;
      IF v_lote_max IS NOT NULL THEN
        SELECT COUNT(*) INTO v_lot_atingida
        FROM workshop_registrations
        WHERE workshop_lot_id = p_workshop_lot_id
          AND (
            status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
            OR (status_pagamento = 'PENDENTE' AND (reserved_until IS NULL OR reserved_until > now()))
          );
        IF v_lot_atingida + 1 > v_lote_max THEN
          RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Lote esgotado — tente outro lote'::TEXT;
          RETURN;
        END IF;
      END IF;
    END;
  END IF;

  -- Limite por CPF
  SELECT COUNT(*) INTO v_existing_count
  FROM workshop_registrations
  WHERE workshop_id = p_workshop_id
    AND buyer_cpf = p_cpf
    AND (
      status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
      OR (status_pagamento = 'PENDENTE' AND created_at >= v_one_hour_ago)
    );

  IF v_existing_count + 1 > v_workshop.workshop_max_per_cpf THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID,
      format('Limite de %s inscrições por CPF atingido', v_workshop.workshop_max_per_cpf)::TEXT;
    RETURN;
  END IF;

  -- Cupom: incrementa atomicamente (consciente: usa max_uses guard)
  IF p_coupon_id IS NOT NULL THEN
    UPDATE coupons
       SET used_count = used_count + 1
     WHERE id = p_coupon_id
       AND is_active = TRUE
       AND (max_uses IS NULL OR used_count + 1 <= max_uses);
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Cupom esgotado ou inativo'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Reserva temporal só pra status PENDENTE (GRATUITO não precisa reservar — já tá pago)
  v_reserved := CASE WHEN p_status_inicial = 'PENDENTE'
                     THEN now() + make_interval(mins => p_reserved_minutes)
                     ELSE NULL END;

  INSERT INTO workshop_registrations (
    workshop_id, workshop_lot_id, lot_nome, lot_ordem,
    buyer_name, buyer_email, buyer_cpf, buyer_phone, user_id,
    combo_registration_id, is_combo,
    preco_base, preco_pago,
    coupon_id, coupon_code, discount_amount,
    status_pagamento, commission_amount, producer_amount, fee_mode,
    reserved_until, paid_at
  ) VALUES (
    p_workshop_id, p_workshop_lot_id, p_lot_nome, p_lot_ordem,
    p_buyer_name, p_buyer_email, p_cpf, p_buyer_phone, p_user_id,
    p_combo_registration_id, COALESCE(p_is_combo, FALSE),
    p_preco_base, p_preco_pago,
    p_coupon_id, p_coupon_code, NULLIF(p_discount_amount, 0),
    p_status_inicial, p_commission_amount, p_producer_amount, p_fee_mode,
    v_reserved,
    CASE WHEN p_status_inicial IN ('GRATUITO', 'CORTESIA') THEN now() ELSE NULL END
  )
  RETURNING id, workshop_registrations.access_token INTO v_id, v_tok;

  RETURN QUERY SELECT v_id, v_tok, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION try_reserve_workshop_registration FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_reserve_workshop_registration TO service_role;


-- 7.4) Get workshop registration by token (público — voucher)
CREATE OR REPLACE FUNCTION get_workshop_registration_by_token(p_token UUID)
RETURNS TABLE (
  id UUID,
  workshop_id UUID,
  workshop_name TEXT,
  workshop_slug TEXT,
  workshop_data_inicio TIMESTAMPTZ,
  workshop_data_fim TIMESTAMPTZ,
  workshop_local TEXT,
  workshop_modalidade TEXT,
  workshop_nivel TEXT,
  workshop_cover_url TEXT,
  workshop_professor_name TEXT,
  workshop_event_id UUID,
  buyer_name TEXT,
  buyer_email_masked TEXT,
  preco_pago NUMERIC,
  status_pagamento TEXT,
  payment_url TEXT,
  paid_at TIMESTAMPTZ,
  attended BOOLEAN,
  attended_at TIMESTAMPTZ,
  access_token UUID,
  is_combo BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.workshop_id,
    w.name, w.slug, w.data_inicio, w.data_fim, w.local, w.modalidade, w.nivel,
    w.cover_url, w.professor_name, w.event_id,
    r.buyer_name,
    regexp_replace(r.buyer_email, '^(.).+(@.+)$', '\1***\2'),
    r.preco_pago, r.status_pagamento, r.payment_url, r.paid_at,
    r.attended, r.attended_at, r.access_token, r.is_combo, r.created_at
  FROM workshop_registrations r
  JOIN workshops w ON w.id = r.workshop_id
  WHERE r.access_token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION get_workshop_registration_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_workshop_registration_by_token(UUID) TO anon, authenticated;


-- 7.5) Detect combo by CPF (item #3 — auto detect inscrição na mostra)
-- Busca registration APROVADA no event_id do workshop, casando o CPF em:
--   • bailarinos_detalhes (JSONB array com {full_name, cpf}) — qualquer bailarino
--   • OU profiles.cpf_cnpj via registrations.user_id (responsável que inscreveu)
-- status_pagamento aceita 'APROVADO' (novo) ou 'CONFIRMADO' (legacy do MP).
CREATE OR REPLACE FUNCTION detect_workshop_combo(
  p_workshop_id UUID,
  p_cpf TEXT
)
RETURNS TABLE (
  found BOOLEAN,
  registration_id UUID,
  coreografia TEXT,
  formato_participacao TEXT,
  estudio TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_event UUID;
  v_auto BOOLEAN;
  v_cpf_clean TEXT := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
BEGIN
  SELECT event_id, auto_detect_combo INTO v_event, v_auto
  FROM workshops WHERE id = p_workshop_id;

  -- Workshop sem event_id ou produtor desligou auto_detect → nunca aplica combo
  IF v_event IS NULL OR v_auto = FALSE OR v_cpf_clean = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT TRUE, r.id, r.nome_coreografia, r.formato_participacao, r.estudio
  FROM registrations r
  LEFT JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = v_event
    AND r.status = 'APROVADA'
    AND r.status_pagamento IN ('APROVADO', 'CONFIRMADO')
    AND (
      regexp_replace(coalesce(p.cpf_cnpj, ''), '\D', '', 'g') = v_cpf_clean
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(r.bailarinos_detalhes, '[]'::jsonb)) b
        WHERE regexp_replace(coalesce(b->>'cpf', ''), '\D', '', 'g') = v_cpf_clean
      )
    )
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION detect_workshop_combo(UUID, TEXT) TO anon, authenticated;


-- 7.6) Mark workshop registration refunded (chamado por edge function)
CREATE OR REPLACE FUNCTION mark_workshop_registration_refunded(
  p_registration_id UUID,
  p_refund_id TEXT,
  p_refund_amount NUMERIC,
  p_refund_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE workshop_registrations
     SET status_pagamento = 'ESTORNADO',
         refunded_at = now(),
         refund_amount = p_refund_amount,
         refund_reason = p_refund_reason,
         refund_id = p_refund_id
   WHERE id = p_registration_id
     AND status_pagamento = 'APROVADO';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION mark_workshop_registration_refunded FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_workshop_registration_refunded TO service_role;


-- 7.7) pg_cron: cancela PENDENTE com reserva expirada (a cada minuto)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-workshop-reservations')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-workshop-reservations');

    PERFORM cron.schedule(
      'expire-workshop-reservations',
      '* * * * *',
      $cron$
        UPDATE workshop_registrations
           SET status_pagamento = 'CANCELADO'
         WHERE status_pagamento = 'PENDENTE'
           AND reserved_until IS NOT NULL
           AND reserved_until < now();
      $cron$
    );
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
