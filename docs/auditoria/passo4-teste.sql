-- Teste do Passo 4 (rodar DEPOIS de aplicar 20261115c_events_protect_insert_columns.sql).
-- Desfaz sozinho (RAISE EXCEPTION no fim). Usa usuários e eventos falsos.
-- Rodar com: npx supabase db query --remote --yes --file docs/auditoria/passo4-teste.sql
--
-- Esperado:
--   forjado: plano=comeco pct=10 tipo=percent demo=false setup_gf=false et=private inst=1 views=0 nota=null
--   espetaculo: plano=espetaculo pct=7.9
--   update_bloqueado: pix=1 settle=null demo=false nota=null absorve=false pct=10     (colunas voltam)
--   update_legitimo: nome=Novo
--   clone_proprio: plano=essencial pix=3 absorve=true demo=false setup_pago=null      (copia da origem do mesmo dono)
--   clone_alheio: plano=comeco pix=1 absorve=false                                    (origem de outro dono é ignorada)
DO $$
DECLARE
  org uuid := '00000000-0000-4000-8000-0000000000d1';
  oth uuid := '00000000-0000-4000-8000-0000000000d2';
  e1  uuid := '00000000-0000-4000-8000-0000000000f1';
  e2  uuid := '00000000-0000-4000-8000-0000000000f2';
  esrc uuid := '00000000-0000-4000-8000-0000000000f3';
  eoth uuid := '00000000-0000-4000-8000-0000000000f4';
  e3  uuid := '00000000-0000-4000-8000-0000000000f5';
  e4  uuid := '00000000-0000-4000-8000-0000000000f6';
  r text := '';
  a text; b text; c text; d text; f text; g text; h text; i text; j text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (org, 'rb-org4@invalid.local', 'authenticated', 'authenticated'),
    (oth, 'rb-oth4@invalid.local', 'authenticated', 'authenticated');
  -- Termo aceito (gate de criação de evento), como serviço.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.profiles SET producer_terms_version = '1.11', producer_terms_accepted_at = now() WHERE id IN (org, oth);
  -- Origens preparadas como serviço: uma do produtor, uma de outro.
  INSERT INTO public.events (id, created_by, name, billing_plan, pix_installments_max, absorve_taxa_baixo_valor)
    VALUES (esrc, org, 'origem', 'essencial', 3, true),
           (eoth, oth, 'origem-alheia', 'escala', 4, true);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. INSERT forjado
  INSERT INTO public.events (id, created_by, name, billing_plan, commission_percent, commission_type,
                             is_demo, setup_fee_grandfathered, event_type, max_installments, view_count,
                             acesso_liberado_nota, pix_installments_max)
  VALUES (e1, org, 'forjado', 'escala', 0, 'fixed', true, true, 'government', 12, 99, 'x', 9)
  RETURNING billing_plan, commission_percent::text, commission_type, is_demo::text, setup_fee_grandfathered::text,
            event_type, max_installments::text, view_count::text, acesso_liberado_nota
  INTO a, b, c, d, f, g, h, i, j;
  r := r || 'forjado: plano=' || a || ' pct=' || b || ' tipo=' || c || ' demo=' || d || ' setup_gf=' || f
         || ' et=' || g || ' inst=' || h || ' views=' || i || ' nota=' || coalesce(j, 'null') || E'\n';

  -- 2. Espetáculo continua permitido
  INSERT INTO public.events (id, created_by, name, billing_plan) VALUES (e2, org, 'esp', 'espetaculo')
  RETURNING billing_plan, commission_percent::text INTO a, b;
  r := r || 'espetaculo: plano=' || a || ' pct=' || b || E'\n';

  -- 3. UPDATE das colunas protegidas
  UPDATE public.events SET pix_installments_max = 5, billing_settlement_closed_at = now(), is_demo = true,
         acesso_liberado_nota = 'y', absorve_taxa_baixo_valor = true, commission_percent = 0, name = 'Novo'
   WHERE id = e1;
  SELECT pix_installments_max::text, billing_settlement_closed_at::text, is_demo::text, acesso_liberado_nota,
         absorve_taxa_baixo_valor::text, commission_percent::text, name
    INTO a, b, c, d, f, g, h FROM public.events WHERE id = e1;
  r := r || 'update_bloqueado: pix=' || a || ' settle=' || coalesce(b, 'null') || ' demo=' || c || ' nota=' || coalesce(d, 'null')
         || ' absorve=' || f || ' pct=' || g || E'\n';
  r := r || 'update_legitimo: nome=' || h || E'\n';

  -- 4. Clone com origem própria (como a RPC faz) e com origem de outro dono
  PERFORM set_config('app.session_clone_from', esrc::text, true);
  INSERT INTO public.events (id, created_by, name, billing_plan, pix_installments_max, absorve_taxa_baixo_valor,
                             is_demo, setup_fee_paid_at)
  VALUES (e3, org, 'clone', 'comeco', 1, false, true, now())
  RETURNING billing_plan, pix_installments_max::text, absorve_taxa_baixo_valor::text, is_demo::text, setup_fee_paid_at::text
  INTO a, b, c, d, f;
  r := r || 'clone_proprio: plano=' || a || ' pix=' || b || ' absorve=' || c || ' demo=' || d || ' setup_pago=' || coalesce(f, 'null') || E'\n';

  PERFORM set_config('app.session_clone_from', eoth::text, true);
  INSERT INTO public.events (id, created_by, name, billing_plan, pix_installments_max, absorve_taxa_baixo_valor)
  VALUES (e4, org, 'clone-alheio', 'escala', 4, true)
  RETURNING billing_plan, pix_installments_max::text, absorve_taxa_baixo_valor::text INTO a, b, c;
  r := r || 'clone_alheio: plano=' || a || ' pix=' || b || ' absorve=' || c;

  RESET ROLE;
  RAISE EXCEPTION E'RESULTADO_DO_TESTE:\n%', r;
END
$$;
