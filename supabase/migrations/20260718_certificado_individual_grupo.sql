-- ════════════════════════════════════════════════════════════════════════════
-- Certificado individual por bailarino em inscrições de Grupo
--
-- Hoje: 1 certificado por registration_id, sempre — pra Grupo isso significa
-- 1 único certificado endereçado ao nome da coreografia, nunca aos bailarinos
-- individuais (nenhum deles consegue baixar o próprio certificado, e não
-- existe forma de emitir 1 avulso depois se alguém pedir).
--
-- Fix: adiciona elenco_id (nullable) — Solo/Duo/Trio/Workshop continuam com
-- elenco_id NULL (comportamento idêntico ao de hoje, 1 por registration_id).
-- Grupo passa a gerar 1 linha por bailarino, com elenco_id preenchido.
--
-- Postgres trata NULL como distinto em índice único por padrão — então
-- múltiplas linhas com elenco_id NULL continuam permitidas só se o índice
-- for parcial (WHERE registration_id IS NOT NULL, sem exigir elenco_id IS
-- NULL). Por isso trocamos pro índice composto abaixo: pra Solo/Duo/Trio
-- (elenco_id sempre NULL) o Postgres NÃO bloqueia duplicata via NULL — a
-- proteção contra duplicata deles continua vindo da idempotência da
-- aplicação (emit-certificates-batch já checa existingIds antes de inserir),
-- não do banco. Pra Grupo, elenco_id preenchido garante 1 certificado por
-- (bailarino, template) mesmo se a aplicação tentar inserir 2x.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE certificates_issued
  ADD COLUMN IF NOT EXISTS elenco_id UUID REFERENCES elenco(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS certificates_unique_per_reg;

CREATE UNIQUE INDEX IF NOT EXISTS certificates_unique_per_reg_elenco
  ON certificates_issued(registration_id, template_type, elenco_id)
  WHERE registration_id IS NOT NULL AND elenco_id IS NOT NULL;

-- Solo/Duo/Trio (elenco_id sempre NULL) mantém a proteção antiga —
-- 1 certificado por (registration_id, template_type) quando não há elenco_id.
CREATE UNIQUE INDEX IF NOT EXISTS certificates_unique_per_reg_sem_elenco
  ON certificates_issued(registration_id, template_type)
  WHERE registration_id IS NOT NULL AND elenco_id IS NULL;

CREATE INDEX IF NOT EXISTS certificates_elenco_idx
  ON certificates_issued(elenco_id) WHERE elenco_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
