-- Adiciona campo Facebook aos contatos/identidade do evento (paralelo a
-- instagram_event/tiktok_event/youtube_event/whatsapp_event/website_event).
-- Gap real: vários festivais (ex. Ecodança) têm página do Facebook mas a
-- tela de Configurações → Identidade & Contato não tinha onde salvar isso.
ALTER TABLE events ADD COLUMN IF NOT EXISTS facebook_event TEXT;

NOTIFY pgrst, 'reload schema';
