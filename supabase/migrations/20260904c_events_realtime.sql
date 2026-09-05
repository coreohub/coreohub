-- Habilita Realtime na tabela events — CreateEvent.tsx assina
-- postgres_changes (filter id=eq.<event>) pra detectar sozinho quando o
-- webhook confirma o pagamento do componente fixo do plano (billing_plan
-- promovido de 'comeco' pro plano pago) e navegar sem o produtor precisar
-- clicar em nada. Confirmado via pg_publication_tables que a tabela nunca
-- tinha sido habilitada (só configuracoes/destaques_votacao estavam, via
-- toggle manual no Dashboard — nunca versionado em migration).
ALTER PUBLICATION supabase_realtime ADD TABLE events;
