-- Achado na auditoria de SEO 2026-09-28: festival.usualdance.com deixou de
-- apontar pra CoreoHub (produtor trocou de hospedagem, agora é um site Next.js
-- próprio dele). O campo events.custom_domain ficou órfão, fazendo o sitemap
-- (supabase/functions/sitemap-xml) publicar essa URL de terceiro como se fosse
-- a página canônica do evento na CoreoHub — por isso o evento nunca aparecia
-- no sitemap sob app.coreohub.com. Confirmado com o produtor (Ticko) que o
-- domínio deles "continua normal" (do lado deles, sim — só não é mais nosso).
UPDATE events
SET custom_domain = NULL
WHERE custom_domain = 'festival.usualdance.com';
