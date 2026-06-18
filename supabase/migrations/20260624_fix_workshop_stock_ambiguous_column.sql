-- Fix: get_workshop_stock sempre falhava com "column reference capacidade_max
-- is ambiguous" (42702) — a coluna de saida da RETURNS TABLE tem o MESMO NOME
-- da coluna workshops.capacidade_max, e o Postgres trata colunas de saida como
-- variaveis dentro da funcao. Isso existia desde a migration original
-- (20260519_workshops.sql) e nunca foi pego porque o frontend so loga um
-- console.warn e cai no fallback workshop.preco_padrao -- por isso a vitrine
-- NUNCA mostrava o preco do lote, so o preco padrao do workshop, mesmo com a
-- ordenacao ASC/DESC corrigida na migration anterior (20260623).
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
  SELECT w.capacidade_max INTO v_cap FROM workshops w WHERE w.id = p_workshop_id;

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
  ORDER BY ordem DESC
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
