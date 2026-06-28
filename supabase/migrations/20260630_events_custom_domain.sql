-- Domínio próprio por evento (ex: festival.usualdance.com), em vez de
-- app.coreohub.com/evento/<slug>. Plano em [[backlog-dominio-custom-evento]].
-- App.tsx resolve window.location.hostname → busca aqui pra decidir o que
-- renderizar na raiz "/". 1 domínio por evento (UNIQUE).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS events_custom_domain_idx
  ON events(custom_domain) WHERE custom_domain IS NOT NULL;

NOTIFY pgrst, 'reload schema';
