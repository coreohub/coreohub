-- Identidade do evento na vitrine: e-mail de contato + PDF do regulamento.
-- Hoje events já tem instagram_event, tiktok_event, youtube_event,
-- whatsapp_event, website_event. Faltava email_event (canal de suporte
-- direto) e regulation_pdf_url (download do regulamento oficial).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS email_event       TEXT,
  ADD COLUMN IF NOT EXISTS regulation_pdf_url TEXT;
