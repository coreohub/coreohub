-- profiles.instagram_consent (criada 2026-05-15, migration 20260515_instagram_marcacao.sql)
-- era pra ser um opt-in LGPD ("bailarino consentiu ser marcado em divulgações
-- do festival") mas nunca virou UI nenhuma — 0 de 66 perfis com valor true,
-- zero código no repo (frontend ou edge function) lê ou escreve nela.
-- Confirmado com o produtor que não é feature em uso, e sim intenção nunca
-- construída. profiles.instagram (o @ handle em si) continua intacto e vivo.

ALTER TABLE profiles DROP COLUMN IF EXISTS instagram_consent;
