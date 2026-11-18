-- Lote 3, D1: is_event_fully_free era executavel por anon/PUBLIC. Usos reais: ProducerDashboard
-- (authenticated), edge create-setup-fee-payment (service_role) e o trigger enforce_free_event_setup_fee
-- (SECURITY DEFINER). Nenhuma tela anonima usa.
-- Reverter: docs/auditoria/lote3/passo4-reverter.sql

REVOKE EXECUTE ON FUNCTION public.is_event_fully_free(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_event_fully_free(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
