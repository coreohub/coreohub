-- Migra o flag único `permissoes_custom.credenciamento` (aposentado nesta
-- mesma sessão) pros 5 escopos novos por tipo de QR
-- (checkin_inscritos/ingressos/workshops/equipe/jurados). Sem isso, membros
-- de equipe reais que já tinham credenciamento=true perderiam acesso ao
-- Credenciamento/QR silenciosamente assim que o frontend passar a ler só
-- as chaves novas — validado em prod: 2 dos 3 membros reais do Hemer
-- (Will Nunes, Cultural Estúdio) tinham credenciamento=true.
--
-- Idempotente: só toca linhas que ainda têm a chave antiga e não têm a
-- nova (não reprocessa quem já foi migrado nem invade quem nunca teve
-- credenciamento configurado).

UPDATE profiles
SET permissoes_custom = permissoes_custom || jsonb_build_object(
  'checkin_inscritos', COALESCE((permissoes_custom->>'credenciamento')::boolean, false),
  'checkin_ingressos', COALESCE((permissoes_custom->>'credenciamento')::boolean, false),
  'checkin_workshops', COALESCE((permissoes_custom->>'credenciamento')::boolean, false),
  'checkin_equipe',    COALESCE((permissoes_custom->>'credenciamento')::boolean, false),
  'checkin_jurados',   COALESCE((permissoes_custom->>'credenciamento')::boolean, false)
)
WHERE permissoes_custom ? 'credenciamento'
  AND NOT (permissoes_custom ? 'checkin_inscritos');

-- Mesmo backfill pra convites ainda pendentes (não aceitos) com o shape antigo.
UPDATE team_invites
SET permissoes_custom = permissoes_custom || jsonb_build_object(
  'checkin_inscritos', COALESCE((permissoes_custom->>'credenciamento')::boolean, false),
  'checkin_ingressos', COALESCE((permissoes_custom->>'credenciamento')::boolean, false),
  'checkin_workshops', COALESCE((permissoes_custom->>'credenciamento')::boolean, false),
  'checkin_equipe',    COALESCE((permissoes_custom->>'credenciamento')::boolean, false),
  'checkin_jurados',   COALESCE((permissoes_custom->>'credenciamento')::boolean, false)
)
WHERE used_at IS NULL
  AND permissoes_custom ? 'credenciamento'
  AND NOT (permissoes_custom ? 'checkin_inscritos');
