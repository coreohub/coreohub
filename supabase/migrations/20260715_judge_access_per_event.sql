-- Terminal de júri: código/link de acesso passa a ser por EVENTO, não por
-- produtor. Antes, profiles.judge_short_code + judge_access_token valiam
-- pra TODOS os eventos do produtor — com 2+ eventos (ex: evento demo criado
-- depois do real), o terminal resolvia "o evento ativo" como o mais recente
-- por created_at, o que já causou sombreamento real de dados/configuração
-- (ver CLAUDE.md 2026-07-12). Mesmo padrão já usado pelo Telão de Palco
-- (events.telao_code, migration 20260707_telao_palco.sql).
--
-- Corte seco (decisão do produtor 2026-07-15): sessões de jurado já logadas
-- (TTL 24h em localStorage) ficam sem event_id até relogar — aceitável dado
-- o uso real hoje, sem necessidade de fallback temporário.

-- ─── Código curto por evento ───────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS judge_short_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS events_judge_short_code_uidx
  ON events (upper(judge_short_code))
  WHERE judge_short_code IS NOT NULL;

-- Backfill best-effort: código atual do produtor migra pro evento real
-- (não-demo) mais recente dele — só continuidade, produtor pode regenerar
-- à vontade na tela de Jurados.
UPDATE events e
   SET judge_short_code = p.judge_short_code
  FROM profiles p
 WHERE e.created_by = p.id
   AND p.judge_short_code IS NOT NULL
   AND e.is_demo IS NOT TRUE
   AND e.id = (
     SELECT id FROM events e2
      WHERE e2.created_by = p.id AND e2.is_demo IS NOT TRUE
      ORDER BY created_at DESC LIMIT 1
   );

-- profiles.judge_short_code fica órfã (não usada mais) — cleanup numa
-- migration futura, sem pressa.

-- ─── RPC: resolve o código pro (token do produtor + evento) ────────────────
-- Chamada pela tela pública /entrar-juri antes de qualquer login (anon).
-- Assinatura muda de RETURNS uuid pra RETURNS TABLE — precisa dropar antes.
DROP FUNCTION IF EXISTS resolve_judge_short_code(text);

CREATE OR REPLACE FUNCTION resolve_judge_short_code(p_code text)
RETURNS TABLE(judge_access_token uuid, event_id uuid, event_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.judge_access_token, e.id, e.name
    FROM events e
    JOIN profiles p ON p.id = e.created_by
   WHERE upper(e.judge_short_code) = upper(trim(p_code))
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION resolve_judge_short_code(text) TO anon, authenticated;

-- ─── RPC: (re)gera o código de um evento específico ────────────────────────
-- Produtor dono do evento (ownership check via events.created_by = auth.uid(),
-- mesmo padrão de regenerate_telao_code). Assinatura muda de () pra
-- (p_event_id uuid) — precisa dropar a versão antiga (sem parâmetro).
DROP FUNCTION IF EXISTS regenerate_judge_short_code();

CREATE OR REPLACE FUNCTION regenerate_judge_short_code(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_code  text;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try   int  := 0;
BEGIN
  SELECT created_by INTO v_owner FROM events WHERE id = p_event_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  LOOP
    v_try := v_try + 1;
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM events WHERE upper(judge_short_code) = v_code);
    IF v_try > 30 THEN RAISE EXCEPTION 'code_generation_failed'; END IF;
  END LOOP;

  UPDATE events SET judge_short_code = v_code WHERE id = p_event_id;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION regenerate_judge_short_code(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
