-- Evento 19° Festival Ecodança (Bheto, event_id 7a77993c-fad0-4938-8d7d-cf2d9f0f5e05):
-- produtor usa "Estilo Livre" / "Jazz" / "Danças Urbanas" sem o sufixo "e suas
-- vertentes" no documento oficial de apuração dele — renomeia na fonte (event_styles
-- + registrations.estilo_danca) pra badge/filtro/Apuração/PDF/Certificados baterem
-- sem precisar de tratamento espalhado pelo código. Escopado só a este evento.

UPDATE event_styles
SET name = regexp_replace(name, '\s+e\s+suas\s+vertentes\s*$', '', 'i')
WHERE event_id = '7a77993c-fad0-4938-8d7d-cf2d9f0f5e05'
  AND name ~* '\s+e\s+suas\s+vertentes\s*$';

UPDATE registrations
SET estilo_danca = regexp_replace(estilo_danca, '\s+e\s+suas\s+vertentes\s*$', '', 'i')
WHERE event_id = '7a77993c-fad0-4938-8d7d-cf2d9f0f5e05'
  AND estilo_danca ~* '\s+e\s+suas\s+vertentes\s*$';

NOTIFY pgrst, 'reload schema';
