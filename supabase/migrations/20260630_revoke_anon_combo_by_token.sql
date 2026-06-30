-- Achado da revisão: detect_workshop_combo_by_token foi liberada pra
-- anon/authenticated na migration anterior (20260630), mas só a edge
-- function create-workshop-registration chama essa RPC (sempre como
-- service_role). Liberar pra anon reabre a mesma brecha de enumeração que
-- detect_workshop_combo teve fechada em 20260520_audit_hardening.sql —
-- alguém com 1 token vazado/repassado poderia chamar a RPC direto via
-- PostgREST testando bailarino_id à força bruta.

REVOKE ALL ON FUNCTION detect_workshop_combo_by_token(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION detect_workshop_combo_by_token(UUID, UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
