-- IP real do aceite (Termo do Produtor e autorização do responsável por menor).
--
-- Bug: as duas RPCs gravavam inet_client_addr(), que devolve o endereço de quem fala com o banco (o servidor
-- da API do Supabase, sempre ::1), e não o do usuário. Em produção, 11 de 11 aceites do Termo e 111 de 111
-- autorizações de menor ficaram com IP ::1: o log guardava versão, data e navegador, sem o IP.
--
-- Correção: ler o IP do cabeçalho que o PostgREST expõe em request.headers. Medido em produção (2026-10-20):
--   * cf-connecting-ip traz o IP real e NÃO é forjável (a Cloudflare recusa com 403 quando o cliente o envia);
--   * x-forwarded-for é forjável à esquerda (o cliente consegue prefixar), o IP real fica por ÚLTIMO.
-- Ordem: cf-connecting-ip, depois o último item de x-forwarded-for. Sem cabeçalho confiável grava NULL
-- (melhor que um ::1 que parece um IP e não é). Linhas antigas ficam como estão (o IP real não foi guardado).
BEGIN;

CREATE OR REPLACE FUNCTION public.request_client_ip()
RETURNS inet
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_headers json;
  v_raw     text;
  v_parts   text[];
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v_headers IS NULL THEN RETURN NULL; END IF;

  v_raw := NULLIF(trim(v_headers ->> 'cf-connecting-ip'), '');
  IF v_raw IS NULL THEN
    -- Último item da lista: o que o proxy do Supabase acrescentou (os da esquerda o cliente consegue forjar).
    v_parts := string_to_array(coalesce(v_headers ->> 'x-forwarded-for', ''), ',');
    IF array_length(v_parts, 1) IS NOT NULL THEN
      v_raw := NULLIF(trim(v_parts[array_length(v_parts, 1)]), '');
    END IF;
  END IF;
  IF v_raw IS NULL THEN RETURN NULL; END IF;

  BEGIN
    RETURN v_raw::inet;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.request_client_ip() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.accept_producer_terms(
  p_version    text,
  p_user_agent text DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_ip          inet := public.request_client_ip();
  v_accepted_at timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_version IS NULL OR length(trim(p_version)) = 0 THEN
    RAISE EXCEPTION 'Versão do termo é obrigatória.';
  END IF;

  UPDATE profiles
     SET producer_terms_accepted_at = v_accepted_at,
         producer_terms_version     = p_version
   WHERE id = v_user_id;

  INSERT INTO producer_terms_acceptances (user_id, version, ip_address, user_agent, accepted_at)
  VALUES (v_user_id, p_version, v_ip, p_user_agent, v_accepted_at);

  RETURN v_accepted_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_minor_guardian_consent(p_elenco_id uuid, p_guardian_full_name text, p_guardian_cpf text, p_guardian_relationship text, p_user_agent text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_ip          INET := public.request_client_ip();
  v_accepted_at TIMESTAMPTZ := now();
  v_owner_id    UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NÃ£o autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_guardian_full_name IS NULL OR length(trim(p_guardian_full_name)) = 0 THEN
    RAISE EXCEPTION 'Nome do responsÃ¡vel Ã© obrigatÃ³rio.';
  END IF;
  IF p_guardian_cpf IS NULL OR length(trim(p_guardian_cpf)) = 0 THEN
    RAISE EXCEPTION 'CPF do responsÃ¡vel Ã© obrigatÃ³rio.';
  END IF;
  IF p_guardian_relationship IS NULL OR length(trim(p_guardian_relationship)) = 0 THEN
    RAISE EXCEPTION 'Grau de parentesco Ã© obrigatÃ³rio.';
  END IF;

  SELECT user_id INTO v_owner_id FROM elenco WHERE id = p_elenco_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Bailarino nÃ£o encontrado.' USING ERRCODE = '42501';
  END IF;
  IF v_owner_id <> v_user_id THEN
    RAISE EXCEPTION 'Sem permissÃ£o pra autorizar este bailarino.' USING ERRCODE = '42501';
  END IF;

  UPDATE elenco
     SET guardian_full_name           = trim(p_guardian_full_name),
         guardian_cpf                 = regexp_replace(p_guardian_cpf, '\D', '', 'g'),
         guardian_relationship         = trim(p_guardian_relationship),
         guardian_consent_accepted_at = v_accepted_at
   WHERE id = p_elenco_id;

  INSERT INTO minor_guardian_consents (
    elenco_id, user_id, guardian_full_name, guardian_cpf, guardian_relationship, ip_address, user_agent, accepted_at
  ) VALUES (
    p_elenco_id, v_user_id, trim(p_guardian_full_name),
    regexp_replace(p_guardian_cpf, '\D', '', 'g'), trim(p_guardian_relationship),
    v_ip, p_user_agent, v_accepted_at
  );

  RETURN v_accepted_at;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
