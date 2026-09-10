-- ═══════════════════════════════════════════════════════════════════════════
-- 20260910b_event_styles_cascade_delete.sql
--
-- `event_styles.event_id` nunca teve FK pra `events(id)` — diferente de
-- `configuracoes.event_id`, que já tem ON DELETE CASCADE corretamente desde
-- sempre. Sem a constraint, apagar um evento (delete-event edge function,
-- ou qualquer DELETE manual em `events`) nunca limpava os gêneros
-- (`event_styles`) daquele evento — ficavam órfãos pra sempre.
--
-- Achado 2026-09-10: conta que cria/apaga muitos eventos de teste (super
-- admin) acumulou 50+ linhas órfãs (ex: "Dança do Ventre" repetida em
-- dezenas de event_id que não existem mais). `getAllGenres()`
-- (services/genreService.ts) tinha um branch de fallback que mantinha
-- qualquer linha `created_by = userId` sem checar se o evento ainda
-- existia — os órfãos vazavam pra dentro de QUALQUER evento real
-- configurado depois (achado configurando o Ecodança real do Bheto).
-- O branch de fallback já foi corrigido no código (genreService.ts);
-- esta migration fecha a causa raiz no banco.
--
-- Ordem obrigatória: 1) limpar órfãos existentes, 2) só então adicionar a
-- FK — senão a constraint falha contra os dados órfãos já presentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Limpa órfãos (event_id aponta pra evento que não existe mais) ───────
-- Preserva event_id IS NULL (catálogo global, legítimo).
DELETE FROM event_styles es
WHERE es.event_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = es.event_id);

-- ─── 2. FK com CASCADE — mesmo padrão já usado em configuracoes_event_id_fkey ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_styles_event_id_fkey'
  ) THEN
    ALTER TABLE event_styles
      ADD CONSTRAINT event_styles_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
