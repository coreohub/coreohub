-- Linha "Taxa de pagamento" paga pelo comprador (P2, decisão 2026-10-02/04).
--
-- Tudo atrás da chave events.processing_fee_enabled:
--   - eventos EXISTENTES ficam false (ADD COLUMN ... DEFAULT false backfilla sem UPDATE,
--     então nenhum trigger de events dispara e nenhuma linha existente muda);
--   - eventos NOVOS nascem true (default trocado logo depois);
--   - Tamoios (flag absorve_taxa_baixo_valor, combinado próprio) e Vicenza ficam false.
-- O net do produtor NUNCA inclui a linha: ela é gravada à parte (processing_fee_amount).
--
-- Bypass dos triggers novos: service_role, super admin/COREOHUB_ADMIN ou auth.uid() IS NULL
-- (SQL Editor/CLI/cron). NUNCA current_user dentro de SECURITY DEFINER (lição 2026-09-25).

-- 1) events: chave + modos escolhidos pelo produtor ------------------------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS processing_fee_enabled    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audience_processing_payer TEXT    NOT NULL DEFAULT 'comprador',
  ADD COLUMN IF NOT EXISTS inscricao_processing_mode TEXT    NOT NULL DEFAULT 'pix_fechado_cartao_taxa';

-- Eventos novos nascem com a regra ligada (os existentes já foram preenchidos com false acima).
ALTER TABLE events ALTER COLUMN processing_fee_enabled SET DEFAULT true;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_audience_processing_payer_check;
ALTER TABLE events ADD CONSTRAINT events_audience_processing_payer_check
  CHECK (audience_processing_payer IN ('comprador', 'produtor'));

-- fechado_total = preço fechado, produtor absorve tudo;
-- pix_fechado_cartao_taxa = padrão Essencial/Escala (CoreoHub absorve o Pix, cartão com taxa ao inscrito);
-- taxa_todas = linha também no Pix (repassar o Pix ao inscrito; desligado por padrão).
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_inscricao_processing_mode_check;
ALTER TABLE events ADD CONSTRAINT events_inscricao_processing_mode_check
  CHECK (inscricao_processing_mode IN ('fechado_total', 'pix_fechado_cartao_taxa', 'taxa_todas'));

-- 2) workshops e passes: quem paga a linha (produtor pode optar por absorver) -----------------
ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS processing_payer TEXT NOT NULL DEFAULT 'comprador';
ALTER TABLE workshops DROP CONSTRAINT IF EXISTS workshops_processing_payer_check;
ALTER TABLE workshops ADD CONSTRAINT workshops_processing_payer_check
  CHECK (processing_payer IN ('comprador', 'produtor'));

ALTER TABLE workshop_passes
  ADD COLUMN IF NOT EXISTS processing_payer TEXT NOT NULL DEFAULT 'comprador';
ALTER TABLE workshop_passes DROP CONSTRAINT IF EXISTS workshop_passes_processing_payer_check;
ALTER TABLE workshop_passes ADD CONSTRAINT workshop_passes_processing_payer_check
  CHECK (processing_payer IN ('comprador', 'produtor'));

-- 3) colunas financeiras por transação ---------------------------------------------------------
-- processing_fee_amount: linha cobrada do comprador (0/NULL = sem linha)
-- payment_method_chosen: forma escolhida no checkout da CoreoHub ('pix' | 'card')
-- installments: parcelas (1 a 12); o webhook confirma com payment.installmentCount
ALTER TABLE audience_tickets
  ADD COLUMN IF NOT EXISTS processing_fee_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_method_chosen TEXT,
  ADD COLUMN IF NOT EXISTS installments          INT;
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS processing_fee_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_method_chosen TEXT,
  ADD COLUMN IF NOT EXISTS installments          INT;
ALTER TABLE workshop_registrations
  ADD COLUMN IF NOT EXISTS processing_fee_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_method_chosen TEXT,
  ADD COLUMN IF NOT EXISTS installments          INT;
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS processing_fee_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_method_chosen TEXT,
  ADD COLUMN IF NOT EXISTS installments          INT;
ALTER TABLE audience_price_quotes
  ADD COLUMN IF NOT EXISTS processing_fee_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_fee_amount  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_method_chosen  TEXT,
  ADD COLUMN IF NOT EXISTS installments           INT;

-- linha gravada à parte do net do produtor (comissão: gross/net seguem como hoje)
ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS processing_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['audience_tickets','registrations','workshop_registrations','payments','audience_price_quotes']
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_payment_method_chosen_check');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (payment_method_chosen IS NULL OR payment_method_chosen IN (''pix'',''card''))', t, t || '_payment_method_chosen_check');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_installments_check');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (installments IS NULL OR installments BETWEEN 1 AND 12)', t, t || '_installments_check');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_processing_fee_amount_check');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (processing_fee_amount IS NULL OR processing_fee_amount >= 0)', t, t || '_processing_fee_amount_check');
  END LOOP;
END $$;

-- 4) protect triggers --------------------------------------------------------------------------
-- 4a) events.processing_fee_enabled: só admin liga/desliga. No INSERT por produtor, sempre true
--     (evento novo nasce com a regra; produtor não consegue nascer com ela desligada).
CREATE OR REPLACE FUNCTION public.protect_processing_fee_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN') THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.processing_fee_enabled := true;
  ELSE
    NEW.processing_fee_enabled := OLD.processing_fee_enabled;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_processing_fee_enabled_trigger ON events;
CREATE TRIGGER protect_processing_fee_enabled_trigger
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION public.protect_processing_fee_enabled();

-- 4b) colunas financeiras nas 3 tabelas com escrita de cliente (payments, platform_commissions
--     e audience_price_quotes não têm policy de escrita: só service_role). Trigger separado
--     dos protect_* existentes pra não reescrever as funções grandes deles.
CREATE OR REPLACE FUNCTION public.protect_processing_fee_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      'processing_fee_amount', NULL, 'payment_method_chosen', NULL, 'installments', NULL));
  ELSE
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      'processing_fee_amount', to_jsonb(OLD.processing_fee_amount),
      'payment_method_chosen', to_jsonb(OLD.payment_method_chosen),
      'installments',          to_jsonb(OLD.installments)));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_processing_fee_columns_trigger ON audience_tickets;
CREATE TRIGGER protect_processing_fee_columns_trigger
  BEFORE INSERT OR UPDATE ON audience_tickets
  FOR EACH ROW EXECUTE FUNCTION public.protect_processing_fee_columns();

DROP TRIGGER IF EXISTS protect_processing_fee_columns_trigger ON registrations;
CREATE TRIGGER protect_processing_fee_columns_trigger
  BEFORE INSERT OR UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.protect_processing_fee_columns();

DROP TRIGGER IF EXISTS protect_processing_fee_columns_trigger ON workshop_registrations;
CREATE TRIGGER protect_processing_fee_columns_trigger
  BEFORE INSERT OR UPDATE ON workshop_registrations
  FOR EACH ROW EXECUTE FUNCTION public.protect_processing_fee_columns();

-- 5) invariante: nenhum evento que já existia pode estar ligado (Tamoios, Vicenza, Usualdance...)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM events WHERE processing_fee_enabled AND created_at < now() - interval '1 minute') THEN
    RAISE EXCEPTION 'processing_fee_enabled ligado em evento pre-existente: abortando';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
