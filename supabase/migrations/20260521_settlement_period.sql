-- ─────────────────────────────────────────────────────────────────────────────
-- 20260521 — Settlement period D+7 (substitui auto-saque imediato)
-- ─────────────────────────────────────────────────────────────────────────────
-- Padrão Sympla/Stripe Connect: dinheiro fica retido na subconta do produtor
-- por 7 dias após o pagamento APROVADO. Resolve bug real descoberto em
-- 2026-05-20 (refund após sweep imediato falha com "Valor da cobrança
-- insuficiente" porque a subconta já foi varrida pro PIX externo).
--
-- Janela:
--   D+0 a D+7  → saldo retido (refund automático funciona, dinheiro tá lá)
--   D+7+       → cron daily-release-funds dispara sweep automático
--   qualquer hora → produtor pode antecipar via botão "Transferir agora"
--                   (sob risco de precisar repor pra cobrir refund)
--
-- Plano completo: memory/backlog_settlement_period_d7.md
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE platform_commissions
  ADD COLUMN IF NOT EXISTS release_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_amount    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS release_transfer_id TEXT,
  ADD COLUMN IF NOT EXISTS released_manually  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN platform_commissions.release_at IS
  'Quando o net_amount fica disponível pra sweep automático (paid_at + 7 dias). NULL = ainda não pago.';
COMMENT ON COLUMN platform_commissions.released_at IS
  'Quando o sweep efetivo aconteceu (cron diário OU antecipação manual). NULL = ainda retido.';
COMMENT ON COLUMN platform_commissions.released_amount IS
  'Valor efetivamente transferido pro PIX externo. Pode ser < net_amount em caso de saldo insuficiente (refund antes do release).';
COMMENT ON COLUMN platform_commissions.release_transfer_id IS
  'ID da transferência Asaas (/transfers) que efetivou o release. Usado pra debug + auditoria.';
COMMENT ON COLUMN platform_commissions.released_manually IS
  'TRUE quando produtor antecipou via botão "Transferir agora". FALSE quando liberou pelo cron diário (D+7+).';

-- Backfill: comissões já registradas antes desta migration foram sweepadas
-- imediatamente pelo webhook antigo (auto-saque on receipt). Marca como
-- released_at = paid_at pra elas não entrarem no cron. paid_at vive em
-- payments (fluxo agregado) ou registrations (fluxo legacy single).
-- Como join é caro e os valores já saíram da subconta, marcamos pela
-- data de inserção da row, que aproxima paid_at em todos os fluxos.
UPDATE platform_commissions
SET released_at      = COALESCE(created_at, NOW()),
    release_at       = COALESCE(created_at, NOW()),
    released_amount  = net_amount,
    released_manually = FALSE
WHERE released_at IS NULL;

-- Índice pro cron diário: pega só as commissions elegíveis (release_at já
-- passou AND ainda não liberadas). Partial index mantém pequeno em base
-- grande — só as "pendentes de release" entram.
CREATE INDEX IF NOT EXISTS idx_platform_commissions_release_pending
  ON platform_commissions(release_at, producer_id)
  WHERE released_at IS NULL;

-- Índice por producer pra UI ler "saldo retido" rapidinho.
CREATE INDEX IF NOT EXISTS idx_platform_commissions_producer_unreleased
  ON platform_commissions(producer_id)
  WHERE released_at IS NULL;

NOTIFY pgrst, 'reload schema';
