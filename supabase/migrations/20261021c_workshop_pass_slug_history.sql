-- Histórico de slugs de passe de workshop (link antigo redireciona pro novo) + verificação de disponibilidade.
-- Mesmo molde de workshop_slug_history (20261021). O produtor passa a poder editar o endereço do passe.

CREATE TABLE IF NOT EXISTS workshop_pass_slug_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id     UUID NOT NULL REFERENCES workshop_passes(id) ON DELETE CASCADE,
  old_slug    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (old_slug, pass_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_pass_slug_history_old_slug ON workshop_pass_slug_history(old_slug);
CREATE INDEX IF NOT EXISTS idx_workshop_pass_slug_history_pass_id ON workshop_pass_slug_history(pass_id);

GRANT SELECT ON workshop_pass_slug_history TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON workshop_pass_slug_history TO service_role;

ALTER TABLE workshop_pass_slug_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone_reads_workshop_pass_slug_history" ON workshop_pass_slug_history;
CREATE POLICY "anyone_reads_workshop_pass_slug_history" ON workshop_pass_slug_history FOR SELECT USING (TRUE);

CREATE OR REPLACE FUNCTION record_workshop_pass_slug_history()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.slug IS DISTINCT FROM NEW.slug AND OLD.slug IS NOT NULL THEN
    INSERT INTO workshop_pass_slug_history (pass_id, old_slug)
    VALUES (OLD.id, OLD.slug)
    ON CONFLICT (old_slug, pass_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workshop_pass_slug_history ON workshop_passes;
CREATE TRIGGER trg_workshop_pass_slug_history
  AFTER UPDATE OF slug ON workshop_passes
  FOR EACH ROW
  EXECUTE FUNCTION record_workshop_pass_slug_history();

-- O passe só colide com outros passes (a rota é /checkout-workshop-pass/:slug, separada da do workshop).
CREATE OR REPLACE FUNCTION workshop_pass_slug_available(p_slug TEXT, p_exclude_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM workshop_passes p WHERE p.slug = p_slug AND p.id IS DISTINCT FROM p_exclude_id)
     AND NOT EXISTS (SELECT 1 FROM workshop_pass_slug_history h WHERE h.old_slug = p_slug AND h.pass_id IS DISTINCT FROM p_exclude_id);
$$;

REVOKE ALL ON FUNCTION workshop_pass_slug_available(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workshop_pass_slug_available(TEXT, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
