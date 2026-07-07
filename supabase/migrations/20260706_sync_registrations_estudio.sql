-- Backfill + sync automático de registrations.estudio a partir de
-- event_data->>'estudio_nome'.
--
-- Causa raiz: o Wizard atual (InscricaoWizard.tsx) grava o nome do estúdio
-- só em event_data.estudio_nome (JSONB), nunca na coluna top-level
-- `estudio`. Isso deixava a coluna vazia pra praticamente toda inscrição
-- recente, e cada tela que lia reg.estudio direto mostrava em branco
-- (certificados, credenciais, terminal do júri, cronograma, etc) — um
-- helper JS (resolveEstudio) tapava o buraco só nos lugares que lembravam
-- de chamá-lo. Esta migration corrige na origem: 1x backfill dos dados
-- existentes + trigger que mantém a coluna sincronizada em todo INSERT/
-- UPDATE futuro, sem depender de nenhum código de app lembrar de nada.

-- 1) Backfill: preenche `estudio` onde está vazio e existe estudio_nome no JSONB.
UPDATE registrations
SET estudio = event_data->>'estudio_nome'
WHERE (estudio IS NULL OR estudio = '')
  AND event_data ? 'estudio_nome'
  AND COALESCE(event_data->>'estudio_nome', '') <> '';

-- 2) Trigger: qualquer INSERT/UPDATE futuro que deixe `estudio` vazio mas
-- tenha event_data.estudio_nome preenchido sincroniza automaticamente.
-- Não sobrescreve `estudio` quando já vem preenchido (edição manual do
-- produtor no painel continua tendo prioridade).
CREATE OR REPLACE FUNCTION sync_registrations_estudio()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.estudio IS NULL OR NEW.estudio = '')
     AND NEW.event_data ? 'estudio_nome'
     AND COALESCE(NEW.event_data->>'estudio_nome', '') <> '' THEN
    NEW.estudio := NEW.event_data->>'estudio_nome';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_registrations_estudio ON registrations;
CREATE TRIGGER trg_sync_registrations_estudio
  BEFORE INSERT OR UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION sync_registrations_estudio();
