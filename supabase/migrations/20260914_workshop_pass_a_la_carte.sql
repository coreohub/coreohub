-- ════════════════════════════════════════════════════════════════════════════
-- Workshop Pass — modo "à la carte" (aula avulsa / single class).
--
-- Disparado por pedido real da Lorrayne (Vicenza Dance Camp 2027, áudio
-- 2026-09-14): ela cadastrou 4-5 "aulas avulsas" como workshops individuais e
-- queria agrupá-las num único card na vitrine onde o ALUNO escolhe quais
-- quer fazer (múltipla escolha) — o preço soma conforme a seleção, em vez do
-- pacote fechado (tudo incluso, 1 preço fixo) que o Pass já suportava.
--
-- selection_mode='fixed'      → comportamento 100% preservado (todos os
--                                workshop_pass_items entram, preço = preco).
-- selection_mode='a_la_carte' → workshop_pass_items vira o POOL de opções;
--                                comprador escolhe um subconjunto (respeitando
--                                min/max_selecionaveis); preço = soma do preço
--                                vigente de cada workshop escolhido (não usa
--                                a coluna preco do pass).
--
-- try_reserve_workshop_pass já é genérica o bastante (aceita p_items com
-- QUALQUER subconjunto) — nenhuma mudança necessária nela nem em
-- get_workshop_pass_stock/detect_workshop_pass_combo/validate_workshop_pass_coupon.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE workshop_passes
  ADD COLUMN IF NOT EXISTS selection_mode TEXT NOT NULL DEFAULT 'fixed'
    CHECK (selection_mode IN ('fixed', 'a_la_carte')),
  ADD COLUMN IF NOT EXISTS min_selecionaveis INT
    CHECK (min_selecionaveis IS NULL OR min_selecionaveis >= 1),
  ADD COLUMN IF NOT EXISTS max_selecionaveis INT
    CHECK (max_selecionaveis IS NULL OR max_selecionaveis >= 1);

NOTIFY pgrst, 'reload schema';
