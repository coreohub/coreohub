-- Página pública do produtor (/produtor/<slug>) — backlog P2 do CLAUDE.md,
-- disparado pelo espaço vazio no hero de 2 colunas da vitrine (2026-08-19).
-- Campos no nível de PROFILES (produtor), nunca do evento — um produtor
-- recorrente (Usualdance, Ecodança) tem 1 bio/rede social só, não 1 por evento.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS public_slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS instagram_producer TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_producer TEXT,
  ADD COLUMN IF NOT EXISTS website_producer TEXT,
  ADD COLUMN IF NOT EXISTS public_page_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_public_slug ON profiles(public_slug) WHERE public_slug IS NOT NULL;

-- `profiles` não tem (e não deve ganhar) policy de leitura pública — a row
-- carrega cpf_cnpj/pix_key/whatsapp pessoal/etc, e RLS do Postgres não
-- restringe COLUNA, só LINHA. Uma policy "USING (public_page_enabled)"
-- vazaria a row inteira pro anon. Em vez disso, RPC SECURITY DEFINER
-- devolve só os campos seguros — mesmo padrão já usado em
-- get_public_judges_for_event/get_telao_state.
CREATE OR REPLACE FUNCTION get_public_producer(p_id UUID DEFAULT NULL, p_slug TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  public_slug TEXT,
  instagram_producer TEXT,
  whatsapp_producer TEXT,
  website_producer TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.full_name, p.avatar_url, p.bio, p.public_slug,
         p.instagram_producer, p.whatsapp_producer, p.website_producer
  FROM profiles p
  WHERE p.public_page_enabled = TRUE
    AND ((p_id IS NOT NULL AND p.id = p_id) OR (p_slug IS NOT NULL AND p.public_slug = p_slug))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_public_producer(UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
