-- Login facilitado por evento (2026-09-29): quando ligado, a tela de login do
-- evento abre direto no "entrar com e-mail, sem senha" (código + link) e mostra
-- o botão de ajuda por WhatsApp (events.whatsapp_event) no login e na inscrição.
-- Default false: nenhum outro evento muda. Ligado só na Tamoios.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS easy_login_enabled boolean NOT NULL DEFAULT false;

UPDATE public.events
   SET easy_login_enabled = true
 WHERE id = 'e328a377-4285-4766-b9b0-38bf39515f84';

NOTIFY pgrst, 'reload schema';
