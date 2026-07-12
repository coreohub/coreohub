-- RPC atômica pra gravar vencedor(es) de prêmio em configuracoes.premios_especiais.
--
-- Antes, 3 pontos diferentes (Deliberacoes.tsx saveWinners, TelaoControle.tsx
-- persistAwardWinner) faziam SELECT + UPDATE separados desse array JSONB no
-- client — 2 round-trips com uma janela de corrida real entre eles (produtor
-- usa Telão numa aba e Premiação em outra no mesmo evento ao vivo; a escrita
-- que termina por último sobrescreve o array inteiro, descartando a mudança
-- concorrente da outra aba pra um prêmio diferente). Fazer o read-modify-write
-- dentro de 1 único UPDATE no Postgres fecha a corrida na fonte (o lock de
-- linha do UPDATE serializa as duas transações).
--
-- p_patches: objeto JSONB { "<award_id>": { "winner_nome": ..., ... }, ... }
-- Cada patch é mesclado (jsonb ||) só nas chaves presentes — não mexe nas
-- demais chaves do prêmio (nome, valor, description, enabled, etc.), e uma
-- chave explicitamente `null` no patch limpa o campo (ex: zera winner_items
-- ao gravar um vencedor manual por cima de um prêmio que antes era faixa).

CREATE OR REPLACE FUNCTION update_premios_winners(p_event_id uuid, p_patches jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT e.created_by INTO v_owner
    FROM configuracoes c
    JOIN events e ON e.id = c.event_id
   WHERE c.event_id = p_event_id
   LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_owner <> auth.uid() AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  UPDATE configuracoes
     SET premios_especiais = (
       SELECT coalesce(jsonb_agg(
                CASE WHEN p_patches ? (item->>'id')
                     THEN item || (p_patches -> (item->>'id'))
                     ELSE item
                END
              ), '[]'::jsonb)
         FROM jsonb_array_elements(coalesce(premios_especiais, '[]'::jsonb)) AS item
     )
   WHERE event_id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_premios_winners(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
