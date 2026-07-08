-- 3 melhorias pedidas pelo produtor:
--  1) Documentos extras pra download na vitrine (além do regulamento).
--  2) Link do Voto Popular (ou qualquer link externo de destaque) na vitrine pública.
--  3) Código curto de acesso ao Terminal de Júri (/entrar-juri), mesmo padrão
--     Kahoot já usado no Telão de Palco (telao_code) — reutilizável pra
--     qualquer futuro "acesso sem login pesado".

-- ─── Documentos extras (array de {nome, url}) ─────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS documentos_extras JSONB DEFAULT '[]'::jsonb;

-- ─── Link de destaque na vitrine (Voto Popular, etc) ──────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS destaque_link_url   TEXT,
  ADD COLUMN IF NOT EXISTS destaque_link_label TEXT;

-- ─── Código curto do Terminal de Júri ──────────────────────────────────────
-- 1 código por produtor (não por evento) — judge_access_token já é por
-- profile e vale pra todos os eventos dele (JudgesManagement.tsx).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS judge_short_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_judge_short_code_uidx
  ON profiles (upper(judge_short_code))
  WHERE judge_short_code IS NOT NULL;

-- Resolve o código pro token de acesso (anon — chamado pela tela pública
-- /entrar-juri antes de qualquer login).
CREATE OR REPLACE FUNCTION resolve_judge_short_code(p_code text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT judge_access_token
    FROM profiles
   WHERE upper(judge_short_code) = upper(trim(p_code))
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION resolve_judge_short_code(text) TO anon, authenticated;

-- (Re)gera o código do produtor logado. Mesmo alfabeto sem 0/O/1/I do Telão.
CREATE OR REPLACE FUNCTION regenerate_judge_short_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code  text;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try   int  := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  LOOP
    v_try := v_try + 1;
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE upper(judge_short_code) = v_code);
    IF v_try > 30 THEN RAISE EXCEPTION 'code_generation_failed'; END IF;
  END LOOP;

  UPDATE profiles SET judge_short_code = v_code WHERE id = auth.uid();
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION regenerate_judge_short_code() TO authenticated;

NOTIFY pgrst, 'reload schema';
