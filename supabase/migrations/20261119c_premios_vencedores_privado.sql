-- B1 (Lote 3): vencedor de premiação não pode ser legível antes da revelação.
--
-- Problema: configuracoes é legível por anon em evento público, então o
-- vencedor registrado dentro de premios_especiais (winner_nome/estudio/items)
-- ficava visível pela REST antes de winner_revealed. A trava era só de interface.
--
-- Solução: o vencedor REGISTRADO vive em premios_vencedores (sem acesso anon,
-- leitura só do dono do evento e do super admin). Só a REVELAÇÃO
-- (winner_revealed = true, via update_premios_winners) copia o vencedor para
-- configuracoes.premios_especiais, que continua público.
--
-- A assinatura de update_premios_winners(uuid, jsonb) NÃO muda: o front que já
-- existe continua funcionando; patches com winner_* vão para a tabela privada.
--
-- Reverter: docs/auditoria/lote3/passo5-b1-reverter.sql
-- Teste:    docs/auditoria/lote3/passo5-b1-teste.sql

-- ─── 1. Tabela privada ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS premios_vencedores (
  event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  award_id       TEXT NOT NULL,
  winner_nome    TEXT,
  winner_estudio TEXT,
  winner_items   JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, award_id)
);

-- ─── 2. Grants: nada para anon; escrita só pela RPC (SECURITY DEFINER) ───────
REVOKE ALL ON premios_vencedores FROM PUBLIC;
REVOKE ALL ON premios_vencedores FROM anon;
REVOKE ALL ON premios_vencedores FROM authenticated;
GRANT SELECT ON premios_vencedores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON premios_vencedores TO service_role;

-- ─── 3. RLS: dono do evento e super admin leem; ninguém escreve direto ───────
ALTER TABLE premios_vencedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS premios_vencedores_owner_select ON premios_vencedores;
CREATE POLICY premios_vencedores_owner_select
  ON premios_vencedores FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = premios_vencedores.event_id AND e.created_by = auth.uid())
    OR is_super_admin(auth.uid())
  );

-- ─── 4. RPC: registra em privado, revela copiando para o público ─────────────
CREATE OR REPLACE FUNCTION update_premios_winners(p_event_id uuid, p_patches jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner     uuid;
  v_cur       jsonb;
  v_new       jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_id        text;
  v_patch     jsonb;
  v_pub       jsonb;
  v_revealed  boolean;
  v_row       premios_vencedores%ROWTYPE;
  v_has_row   boolean;
  v_touch     boolean;
BEGIN
  -- Trava a linha de configuracoes: serializa abas concorrentes (Telão x Premiação).
  SELECT e.created_by, c.premios_especiais
    INTO v_owner, v_cur
    FROM configuracoes c
    JOIN events e ON e.id = c.event_id
   WHERE c.event_id = p_event_id
   LIMIT 1
     FOR UPDATE OF c;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_owner <> auth.uid() AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  IF v_cur IS NULL OR jsonb_typeof(v_cur) <> 'array' THEN
    RETURN;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_cur) WITH ORDINALITY AS t(value, ord) ORDER BY ord
  LOOP
    v_id    := v_item->>'id';
    v_patch := CASE WHEN v_id IS NOT NULL THEN p_patches -> v_id ELSE NULL END;

    IF v_patch IS NULL OR jsonb_typeof(v_patch) <> 'object' THEN
      v_new := v_new || jsonb_build_array(v_item);
      CONTINUE;
    END IF;

    v_revealed := coalesce((v_item->>'winner_revealed')::boolean, false);
    v_touch := (v_patch ? 'winner_nome') OR (v_patch ? 'winner_estudio') OR (v_patch ? 'winner_items');

    -- Registro privado. Semeia a linha com o que estiver no público (legado,
    -- prêmio já revelado antes desta migration) para não perder campos.
    IF v_touch THEN
      INSERT INTO premios_vencedores (event_id, award_id, winner_nome, winner_estudio, winner_items)
      VALUES (
        p_event_id, v_id,
        v_item->>'winner_nome',
        v_item->>'winner_estudio',
        CASE WHEN jsonb_typeof(v_item->'winner_items') = 'array' THEN v_item->'winner_items' ELSE NULL END
      )
      ON CONFLICT (event_id, award_id) DO NOTHING;

      UPDATE premios_vencedores
         SET winner_nome    = CASE WHEN v_patch ? 'winner_nome'    THEN v_patch->>'winner_nome'    ELSE winner_nome END,
             winner_estudio = CASE WHEN v_patch ? 'winner_estudio' THEN v_patch->>'winner_estudio' ELSE winner_estudio END,
             winner_items   = CASE WHEN v_patch ? 'winner_items'
                                   THEN CASE WHEN jsonb_typeof(v_patch->'winner_items') = 'array' THEN v_patch->'winner_items' ELSE NULL END
                                   ELSE winner_items END,
             updated_at     = now()
       WHERE event_id = p_event_id AND award_id = v_id;
    END IF;

    IF v_patch ? 'winner_revealed' THEN
      v_revealed := coalesce((v_patch->>'winner_revealed')::boolean, false);
    END IF;

    -- Parte pública: demais chaves do patch (inclusive winner_revealed), sem winner_*.
    v_pub := v_item || (v_patch - 'winner_nome' - 'winner_estudio' - 'winner_items');

    IF v_revealed THEN
      SELECT * INTO v_row FROM premios_vencedores WHERE event_id = p_event_id AND award_id = v_id;
      v_has_row := FOUND;
      IF v_has_row THEN
        v_pub := v_pub || jsonb_build_object(
          'winner_nome',    v_row.winner_nome,
          'winner_estudio', v_row.winner_estudio,
          'winner_items',   v_row.winner_items
        );
      END IF;
      -- sem linha privada: mantém o que já estava no público (legado revelado)
    ELSE
      v_pub := v_pub - 'winner_nome' - 'winner_estudio' - 'winner_items';
    END IF;

    v_new := v_new || jsonb_build_array(v_pub);
  END LOOP;

  UPDATE configuracoes SET premios_especiais = v_new WHERE event_id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_premios_winners(uuid, jsonb) TO authenticated;

-- ─── 5. Migração de dados: vencedor registrado e NÃO revelado sai do público ─
-- (conferido em 2026-11-19: 0 prêmios nessa situação; fica idempotente por segurança)
DO $$
DECLARE
  r record;
  v_new jsonb;
BEGIN
  FOR r IN
    SELECT c.event_id, c.premios_especiais AS pe
      FROM configuracoes c
     WHERE c.event_id IS NOT NULL
       AND jsonb_typeof(c.premios_especiais) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(c.premios_especiais) a
          WHERE coalesce(a->>'winner_revealed', '') <> 'true'
            AND (coalesce(a->>'winner_nome', '') <> ''
                 OR (jsonb_typeof(a->'winner_items') = 'array' AND jsonb_array_length(a->'winner_items') > 0))
       )
  LOOP
    INSERT INTO premios_vencedores (event_id, award_id, winner_nome, winner_estudio, winner_items)
    SELECT r.event_id, a->>'id', a->>'winner_nome', a->>'winner_estudio',
           CASE WHEN jsonb_typeof(a->'winner_items') = 'array' THEN a->'winner_items' ELSE NULL END
      FROM jsonb_array_elements(r.pe) a
     WHERE a->>'id' IS NOT NULL
       AND coalesce(a->>'winner_revealed', '') <> 'true'
       AND (coalesce(a->>'winner_nome', '') <> ''
            OR (jsonb_typeof(a->'winner_items') = 'array' AND jsonb_array_length(a->'winner_items') > 0))
    ON CONFLICT (event_id, award_id) DO NOTHING;

    SELECT jsonb_agg(
             CASE WHEN coalesce(a->>'winner_revealed', '') <> 'true'
                  THEN a - 'winner_nome' - 'winner_estudio' - 'winner_items'
                  ELSE a END
           )
      INTO v_new
      FROM jsonb_array_elements(r.pe) a;

    UPDATE configuracoes SET premios_especiais = v_new WHERE event_id = r.event_id;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
