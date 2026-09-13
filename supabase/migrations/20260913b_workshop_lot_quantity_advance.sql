-- ════════════════════════════════════════════════════════════════════════════
-- get_workshop_stock: lote ativo passa a considerar ESGOTAMENTO POR
-- QUANTIDADE, não só janela de data. Pedido real da Lorrayne (Vicenza
-- Dance Camp): vender 15 vagas de lançamento e, esgotando, seguir vendendo
-- automaticamente no lote seguinte, sem depender de nenhuma data.
--
-- Prática de mercado confirmada (Eventbrite "Set up automatic ticket price
-- changes", Ticket Tailor "tiered ticket pricing") — vira automático quando
-- a quantidade OU a data batem, o que vier primeiro. Sem UI nova: os campos
-- `data_fim`/`quantidade_maxima` já existem por lote — o produtor só deixa
-- em branco o que não quiser usar (só data / só quantidade / os dois).
--
-- Antes desta migration, a seleção de lote (fix de 2026-06-23) ignorava
-- `quantidade_maxima` na hora de ESCOLHER o lote ativo — só usava pra marcar
-- "esgotado" DEPOIS de já ter escolhido. Resultado: 2 lotes sem nenhuma data
-- configurada (caso comum de progressão só-por-quantidade) sempre mostravam
-- o de MAIOR ordem, mesmo com o lote 1 ainda com vagas — o lote 2 "vencia"
-- os 15 do lote 1 antes deles serem vendidos.
--
-- REGRA NOVA (2 estágios, preserva o fix de 2026-06-23 pro caso por data):
--   1) Entre os lotes com `data_inicio` EXPLÍCITO já alcançado (override
--      manual de data — comportamento antigo intacto): pega o de MAIOR
--      ordem ainda não fechado (nem por data_fim nem por quantidade). Um
--      lote com data_inicio explícita sempre pode "furar a fila" na frente
--      de um lote anterior ainda não esgotado — é a mesma semântica de
--      antes, só ganhou o filtro de quantidade.
--   2) Se não achar nenhum na etapa 1 (nenhum lote com data explícita
--      elegível), cai pros lotes SEM data_inicio (progressão automática só
--      por quantidade/ordem): pega o de MENOR ordem ainda não fechado —
--      consumo sequencial, lote 1 primeiro, lote 2 só quando o 1 esgotar.
-- ════════════════════════════════════════════════════════════════════════════

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

  -- Etapa 1: lotes com data_inicio explícita já alcançada, ainda não
  -- fechados (nem por data_fim nem por quantidade) — maior ordem vence
  -- (override manual, igual antes do fix de quantidade).
  SELECT wl.*, sub.sold_in_lot INTO v_lot
  FROM workshop_lots wl
  JOIN LATERAL (
    SELECT COALESCE(COUNT(*), 0) AS sold_in_lot
    FROM workshop_registrations wr
    WHERE wr.workshop_lot_id = wl.id
      AND (
        wr.status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
        OR (wr.status_pagamento = 'PENDENTE' AND (wr.reserved_until IS NULL OR wr.reserved_until > now()))
      )
  ) sub ON TRUE
  WHERE wl.workshop_id = p_workshop_id
    AND wl.is_active = TRUE
    AND wl.data_inicio IS NOT NULL AND wl.data_inicio <= now()
    AND (wl.data_fim IS NULL OR wl.data_fim >= now())
    AND (wl.quantidade_maxima IS NULL OR sub.sold_in_lot < wl.quantidade_maxima)
  ORDER BY wl.ordem DESC
  LIMIT 1;

  -- Etapa 2: se nada explícito elegível, cai pros lotes sem data_inicio
  -- (progressão automática só por quantidade) — menor ordem ainda aberto.
  IF v_lot.id IS NULL THEN
    SELECT wl.*, sub.sold_in_lot INTO v_lot
    FROM workshop_lots wl
    JOIN LATERAL (
      SELECT COALESCE(COUNT(*), 0) AS sold_in_lot
      FROM workshop_registrations wr
      WHERE wr.workshop_lot_id = wl.id
        AND (
          wr.status_pagamento IN ('APROVADO', 'GRATUITO', 'CORTESIA')
          OR (wr.status_pagamento = 'PENDENTE' AND (wr.reserved_until IS NULL OR wr.reserved_until > now()))
        )
    ) sub ON TRUE
    WHERE wl.workshop_id = p_workshop_id
      AND wl.is_active = TRUE
      AND wl.data_inicio IS NULL
      AND (wl.data_fim IS NULL OR wl.data_fim >= now())
      AND (wl.quantidade_maxima IS NULL OR sub.sold_in_lot < wl.quantidade_maxima)
    ORDER BY wl.ordem ASC
    LIMIT 1;
  END IF;

  v_lot_sold := COALESCE(v_lot.sold_in_lot, 0);

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

NOTIFY pgrst, 'reload schema';
