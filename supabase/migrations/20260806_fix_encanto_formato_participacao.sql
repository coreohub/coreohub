-- Coreografia "Encanto-(obs trio infantil)" (Escola de Dança Lailton Reis,
-- evento 19° Festival Ecodança do Bheto) estava salva como Duo, mas o
-- documento oficial de apuração do produtor lista ela no grupo
-- "Estilo Livre | Trio Infantil" — e o próprio nome da coreografia já traz a
-- observação "(obs trio infantil)". Corrige a formação real.

UPDATE registrations
SET formato_participacao = 'Trio'
WHERE id = 'c3241b9b-4fe9-4d3f-9a00-8a24586c3cef'
  AND event_id = '7a77993c-fad0-4938-8d7d-cf2d9f0f5e05';

NOTIFY pgrst, 'reload schema';
