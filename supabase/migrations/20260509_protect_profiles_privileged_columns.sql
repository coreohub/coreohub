-- Vuln 2 (security review 2026-05-02): policies legacy de `profiles`
-- permitiam UPDATE em qualquer coluna pelo proprio dono. Faltava a
-- protecao em nivel de coluna pras colunas privilegiadas.
--
-- Atacante autenticado podia fazer pelo console do browser:
--   supabase.from('profiles').update({ is_super_admin: true }).eq('id', user.id)
-- e virar super admin instantaneamente. Tambem podia mudar
-- asaas_wallet_id pra redirecionar splits de pagamento.
--
-- Este trigger restaura valores antigos pras colunas privilegiadas
-- quando o caller nao e service_role nem super admin.

CREATE OR REPLACE FUNCTION protect_profiles_privileged_columns() RETURNS trigger AS $$
BEGIN
  -- Edge Functions internas usam service_role e devem passar.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Super admin pode editar livremente.
  IF is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Caller comum: restaura valores antigos das colunas protegidas.
  --
  -- Categoria 1 — privilegio/role: deixa user mudar role/admin so via
  -- service_role (convite por Edge Function) ou super admin.
  NEW.is_super_admin            := OLD.is_super_admin;
  NEW.is_blocked                := OLD.is_blocked;
  NEW.role                      := OLD.role;
  NEW.is_coordenador_juri       := OLD.is_coordenador_juri;

  -- Categoria 2 — comissao da plataforma.
  NEW.default_commission_percent := OLD.default_commission_percent;

  -- Categoria 3 — financeiro Asaas: troca de carteira/key precisa
  -- passar pela Edge Function (que valida ownership Asaas-side).
  NEW.asaas_wallet_id           := OLD.asaas_wallet_id;
  NEW.asaas_subconta_id         := OLD.asaas_subconta_id;
  NEW.asaas_api_key             := OLD.asaas_api_key;

  -- Categoria 4 — token de acesso de jurados.
  -- Vaza-lo permite atacante listar PIN candidatos. Re-gerar precisa
  -- ser explicito via Edge Function dedicada (futuro).
  NEW.judge_access_token        := OLD.judge_access_token;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_profiles_privileged_columns_trigger ON profiles;
CREATE TRIGGER protect_profiles_privileged_columns_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_profiles_privileged_columns();

NOTIFY pgrst, 'reload schema';
