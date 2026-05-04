-- ════════════════════════════════════════════════════════════════════════════
-- Certificados PDF auto-gerados (Etapa 2)
-- (backlog_workshops_certificados.md, decidido em 2026-05-13)
--
-- Modelo de geração: HÍBRIDO LAZY-CACHE (pesquisa de mercado + validado com user)
--   • Produtor "Publica" certificados → cria 1 row em certificates_issued
--     com pdf_url = NULL (zero compute, só linha no banco).
--   • Inscrito clica "Baixar" → Edge Function gera o PDF na hora, faz upload
--     pro bucket privado e popula pdf_url + retorna signed URL.
--   • Próximas requests do mesmo certificado: instantâneas (cache).
--   • Reemissão (correção de nome): produtor seta pdf_url = NULL → próxima
--     request gera fresh.
--
-- Padrão Even3/Sympla/Doity: produtor publica → inscrito acessa quando quer.
-- Sem email automático em massa (economiza Resend quota).
--
-- 1 template por (producer, type) onde type = 'mostra' | 'workshop'.
-- Vínculo XOR: certificate_issued referencia OU registration_id (mostra) OU
-- workshop_registration_id (workshop), nunca os dois.
--
-- APLICAÇÃO: cole as 5 seções no SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) certificate_templates (template global do produtor) ─────────────────
CREATE TABLE IF NOT EXISTS certificate_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  template_type   TEXT NOT NULL CHECK (template_type IN ('mostra', 'workshop')),
  name            TEXT,                       -- "Modelo padrão Mostra Cia X"

  -- Background: imagem A4 landscape ou um dos modelos pré-prontos do CoreoHub
  background_url   TEXT,                      -- Storage URL ou external (modelos pré-prontos)
  preset_template  TEXT,                      -- 'mostra-classico' | 'workshop-minimalista' | 'mostra-premium' | 'custom'

  -- Layout: array de elementos JSON com posicionamento percentual
  -- Schema: [{ tag, x_pct, y_pct, font_size, font_family, color, align, weight, italic, max_width_pct }]
  layout_json      JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Tipografia + cores padrão
  font_family_default  TEXT DEFAULT 'helvetica',
  primary_color        TEXT DEFAULT '#0b0b0f',
  accent_color         TEXT DEFAULT '#ff0068',

  -- Assinaturas embaixo (até 3)
  signature_urls       TEXT[] DEFAULT ARRAY[]::TEXT[],
  signature_names      TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (producer_id, template_type)
);

CREATE INDEX IF NOT EXISTS certificate_templates_producer_idx ON certificate_templates(producer_id);

CREATE OR REPLACE FUNCTION certificate_templates_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS certificate_templates_updated_at ON certificate_templates;
CREATE TRIGGER certificate_templates_updated_at
  BEFORE UPDATE ON certificate_templates
  FOR EACH ROW EXECUTE FUNCTION certificate_templates_set_updated_at();


-- ── 2) certificates_issued (1 row por certificado emitido) ─────────────────
-- Modelo lazy-cache: pdf_url começa NULL, é populado na primeira request
-- do inscrito. validation_hash é gerado upfront (acesso público pra /validar).

CREATE TABLE IF NOT EXISTS certificates_issued (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID REFERENCES certificate_templates(id) ON DELETE SET NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('mostra', 'workshop')),

  -- Vínculo XOR (1 dos 2 obrigatório, nunca os dois juntos)
  registration_id           UUID REFERENCES registrations(id) ON DELETE CASCADE,
  workshop_registration_id  UUID REFERENCES workshop_registrations(id) ON DELETE CASCADE,

  -- Snapshot pra histórico imune a edição posterior
  recipient_name    TEXT NOT NULL,            -- nome do grupo OU bailarinos
  certificate_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- ex: { evento_nome, evento_data, modalidade, classificacao, professor_nome, etc }

  -- Vínculo opcional ao evento (pra dashboard do produtor / RLS)
  event_id      UUID REFERENCES events(id) ON DELETE SET NULL,
  producer_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Cache do PDF (lazy-cache pattern)
  pdf_url           TEXT,                     -- NULL = ainda não gerado; populado na 1ª request
  pdf_storage_path  TEXT,                     -- caminho dentro do bucket pra invalidar/regerar
  pdf_generated_at  TIMESTAMPTZ,

  -- Hash público pra /validar-certificado/<hash> (UUID v4)
  validation_hash   UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

  -- Auditoria
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  downloaded_at     TIMESTAMPTZ,
  download_count    INT NOT NULL DEFAULT 0,
  last_validated_at TIMESTAMPTZ,
  validation_count  INT NOT NULL DEFAULT 0,

  CONSTRAINT certificates_issued_link_xor CHECK (
    (registration_id IS NOT NULL AND workshop_registration_id IS NULL)
    OR (registration_id IS NULL AND workshop_registration_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS certificates_event_idx
  ON certificates_issued(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS certificates_producer_idx
  ON certificates_issued(producer_id);
CREATE INDEX IF NOT EXISTS certificates_reg_idx
  ON certificates_issued(registration_id) WHERE registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS certificates_ws_idx
  ON certificates_issued(workshop_registration_id) WHERE workshop_registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS certificates_type_idx
  ON certificates_issued(template_type);

-- Idempotência: 1 certificado por (registration_id, template_type) e por (workshop_reg, template_type)
CREATE UNIQUE INDEX IF NOT EXISTS certificates_unique_per_reg
  ON certificates_issued(registration_id, template_type)
  WHERE registration_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS certificates_unique_per_ws_reg
  ON certificates_issued(workshop_registration_id, template_type)
  WHERE workshop_registration_id IS NOT NULL;


-- ── 3) RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE certificate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates_issued   ENABLE ROW LEVEL SECURITY;

-- Templates: producer CRUD seus próprios
DROP POLICY IF EXISTS certificate_templates_producer_all ON certificate_templates;
CREATE POLICY certificate_templates_producer_all
  ON certificate_templates FOR ALL TO authenticated
  USING (producer_id = auth.uid())
  WITH CHECK (producer_id = auth.uid());

-- Certificates: producer lê os próprios (do seu evento)
DROP POLICY IF EXISTS certificates_issued_producer_read ON certificates_issued;
CREATE POLICY certificates_issued_producer_read
  ON certificates_issued FOR SELECT TO authenticated
  USING (
    producer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM registrations r WHERE r.id = certificates_issued.registration_id AND r.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM workshop_registrations wr WHERE wr.id = certificates_issued.workshop_registration_id AND wr.user_id = auth.uid()
    )
  );

-- Producer pode atualizar (pra invalidar cache via reemissão)
DROP POLICY IF EXISTS certificates_issued_producer_update ON certificates_issued;
CREATE POLICY certificates_issued_producer_update
  ON certificates_issued FOR UPDATE TO authenticated
  USING (producer_id = auth.uid());

DROP POLICY IF EXISTS certificates_issued_producer_delete ON certificates_issued;
CREATE POLICY certificates_issued_producer_delete
  ON certificates_issued FOR DELETE TO authenticated
  USING (producer_id = auth.uid());

-- INSERT só via service_role (edge function emit-certificates-batch)


-- ── 4) Storage bucket: certificates ────────────────────────────────────────
-- Bucket privado (signed URLs com TTL). Path scoping: certificates/{producer_id}/{cert_id}.pdf
-- RLS de storage.objects garante que producer só acessa próprios certificados.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificates', 'certificates', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['application/pdf'];

-- Política: producer lê os PDFs em certificates/{seu_user_id}/*
DROP POLICY IF EXISTS certificates_producer_select ON storage.objects;
CREATE POLICY certificates_producer_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'certificates'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- INSERT/UPDATE/DELETE no bucket: só service_role (edge function)
-- (sem policy = anon/authenticated bloqueado por default em buckets RLS-enabled)


-- ── 5) RPCs públicas ────────────────────────────────────────────────────────

-- 5.1) Validate certificate by hash (público, sem login)
-- Retorna apenas dados não-sensíveis pra página /validar-certificado/<hash>.
-- Incrementa validation_count + last_validated_at em cada request.
CREATE OR REPLACE FUNCTION validate_certificate(p_hash UUID)
RETURNS TABLE (
  found BOOLEAN,
  recipient_name TEXT,
  template_type TEXT,
  evento_nome TEXT,
  evento_data DATE,
  modalidade TEXT,
  classificacao TEXT,
  professor_nome TEXT,
  workshop_nome TEXT,
  issued_at TIMESTAMPTZ,
  validation_hash UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cert certificates_issued%ROWTYPE;
BEGIN
  SELECT * INTO v_cert FROM certificates_issued WHERE certificates_issued.validation_hash = p_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::DATE, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::UUID;
    RETURN;
  END IF;

  -- Telemetria de validação (sem PII)
  UPDATE certificates_issued
     SET last_validated_at = now(),
         validation_count = validation_count + 1
   WHERE id = v_cert.id;

  RETURN QUERY SELECT
    TRUE,
    v_cert.recipient_name,
    v_cert.template_type,
    (v_cert.certificate_data->>'evento_nome')::TEXT,
    NULLIF(v_cert.certificate_data->>'evento_data', '')::DATE,
    (v_cert.certificate_data->>'modalidade')::TEXT,
    (v_cert.certificate_data->>'classificacao')::TEXT,
    (v_cert.certificate_data->>'professor_nome')::TEXT,
    (v_cert.certificate_data->>'workshop_nome')::TEXT,
    v_cert.issued_at,
    v_cert.validation_hash;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_certificate(UUID) TO anon, authenticated;


-- 5.2) Bump download count (chamada pelo frontend após download bem-sucedido)
-- Inscrito pode ver os próprios certificados (RLS já garante), mas RPC simplifica
-- a contagem atômica.
CREATE OR REPLACE FUNCTION bump_certificate_download(p_cert_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner UUID;
BEGIN
  SELECT producer_id INTO v_owner FROM certificates_issued WHERE id = p_cert_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE certificates_issued
     SET downloaded_at = now(),
         download_count = download_count + 1
   WHERE id = p_cert_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION bump_certificate_download(UUID) TO authenticated;


-- 5.3) List certificates do inscrito (logado) — usado em /meus-certificados
CREATE OR REPLACE FUNCTION list_my_certificates()
RETURNS TABLE (
  id UUID,
  template_type TEXT,
  recipient_name TEXT,
  evento_nome TEXT,
  evento_data DATE,
  modalidade TEXT,
  classificacao TEXT,
  workshop_nome TEXT,
  has_pdf BOOLEAN,
  validation_hash UUID,
  issued_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    c.id, c.template_type, c.recipient_name,
    (c.certificate_data->>'evento_nome')::TEXT,
    NULLIF(c.certificate_data->>'evento_data', '')::DATE,
    (c.certificate_data->>'modalidade')::TEXT,
    (c.certificate_data->>'classificacao')::TEXT,
    (c.certificate_data->>'workshop_nome')::TEXT,
    (c.pdf_url IS NOT NULL),
    c.validation_hash,
    c.issued_at
  FROM certificates_issued c
  LEFT JOIN registrations r          ON r.id = c.registration_id
  LEFT JOIN workshop_registrations wr ON wr.id = c.workshop_registration_id
  WHERE r.user_id = v_uid OR wr.user_id = v_uid
  ORDER BY c.issued_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION list_my_certificates() TO authenticated;


NOTIFY pgrst, 'reload schema';
