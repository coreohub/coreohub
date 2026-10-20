-- Verificação de disponibilidade de slug na hora (campo de slug do workshop). SECURITY DEFINER porque o
-- produtor não enxerga workshops/passes de outros produtores (RLS), mas o slug é único globalmente.
-- Conta como ocupado: workshop, passe e slug antigo em histórico de OUTRO workshop (redirect vivo).
CREATE OR REPLACE FUNCTION workshop_slug_available(p_slug TEXT, p_exclude_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM workshops w WHERE w.slug = p_slug AND w.id IS DISTINCT FROM p_exclude_id)
     AND NOT EXISTS (SELECT 1 FROM workshop_passes p WHERE p.slug = p_slug)
     AND NOT EXISTS (SELECT 1 FROM workshop_slug_history h WHERE h.old_slug = p_slug AND h.workshop_id IS DISTINCT FROM p_exclude_id);
$$;

REVOKE ALL ON FUNCTION workshop_slug_available(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workshop_slug_available(TEXT, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
