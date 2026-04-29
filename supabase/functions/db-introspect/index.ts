// Edge Function diagnóstica TEMPORÁRIA — schema + test-insert.
// REMOVER após uso.

import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const dbUrl = Deno.env.get('SUPABASE_DB_URL') ?? ''
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: 'SUPABASE_DB_URL ausente' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'schema'
  const table = url.searchParams.get('table') ?? 'events'

  let sql
  try {
    sql = postgres(dbUrl, { max: 1, prepare: false })

    if (action === 'schema') {
      const cols = await sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
        ORDER BY ordinal_position
      `
      return new Response(JSON.stringify({ table, columns: cols }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'update-slug') {
      const eventId = url.searchParams.get('event_id') ?? ''
      const newSlug = url.searchParams.get('slug') ?? ''
      if (!eventId || !newSlug) {
        return new Response(JSON.stringify({ error: 'event_id e slug obrigatórios' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const updated = await sql`
        UPDATE events SET slug = ${newSlug} WHERE id = ${eventId}::uuid
        RETURNING id, slug, name
      `
      return new Response(JSON.stringify({ ok: true, updated: updated[0] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'apply-configuracoes-multi-tenant') {
      // 1. Trigger que cria row de configuracoes automaticamente quando evento é criado.
      await sql`
        CREATE OR REPLACE FUNCTION ensure_configuracoes_for_event() RETURNS trigger AS $func$
        BEGIN
          INSERT INTO configuracoes (id, event_id)
          VALUES (NEW.id::text, NEW.id)
          ON CONFLICT (id) DO NOTHING;
          RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql SECURITY DEFINER;
      `
      await sql`DROP TRIGGER IF EXISTS auto_create_configuracoes ON events`
      await sql`
        CREATE TRIGGER auto_create_configuracoes
          AFTER INSERT ON events
          FOR EACH ROW
          EXECUTE FUNCTION ensure_configuracoes_for_event()
      `

      // 2. Backfill: pra cada evento sem config, cria uma. Se a row legacy id='1'
      // aponta pra esse evento, clona seus dados; senão fica vazia (defaults).
      const result = await sql`
        INSERT INTO configuracoes (
          id, event_id,
          nome_evento, local_evento, cidade_estado, data_evento,
          prazo_inscricao, prazo_trilhas, tipos_apresentacao, escala_notas,
          pin_inactivity_minutes, medal_thresholds, estilos, formatos, categorias,
          tolerancia, age_reference, age_reference_date, tempo_entrada,
          intervalo_seguranca, texto_ia, marcar_palco_ativo, tempo_marcacao_palco,
          gatilho_marcacao, links, regras_avaliacao, premios_especiais,
          atualizado_em, hora_evento, programacao, ingressos_audiencia,
          patrocinadores, cover_url, descricao
        )
        SELECT
          e.id::text, e.id,
          legacy.nome_evento, legacy.local_evento, legacy.cidade_estado, legacy.data_evento,
          legacy.prazo_inscricao, legacy.prazo_trilhas, legacy.tipos_apresentacao, legacy.escala_notas,
          legacy.pin_inactivity_minutes, legacy.medal_thresholds, legacy.estilos, legacy.formatos, legacy.categorias,
          legacy.tolerancia, legacy.age_reference, legacy.age_reference_date, legacy.tempo_entrada,
          legacy.intervalo_seguranca, legacy.texto_ia, legacy.marcar_palco_ativo, legacy.tempo_marcacao_palco,
          legacy.gatilho_marcacao, legacy.links, legacy.regras_avaliacao, legacy.premios_especiais,
          legacy.atualizado_em, legacy.hora_evento, legacy.programacao, legacy.ingressos_audiencia,
          legacy.patrocinadores, legacy.cover_url, legacy.descricao
        FROM events e
        LEFT JOIN configuracoes existing ON existing.id = e.id::text
        LEFT JOIN configuracoes legacy   ON legacy.id = '1' AND legacy.event_id = e.id
        WHERE existing.id IS NULL
        RETURNING id, event_id
      `
      return new Response(JSON.stringify({ ok: true, backfilled: result }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'apply-public-configuracoes-policy') {
      // Permite ANÔNIMOS lerem configuracoes que pertencem a eventos públicos.
      // Sem isso, vitrine pública (PublicEventPage) não consegue ler prazos,
      // prêmios, descrição etc.
      await sql`DROP POLICY IF EXISTS "anyone_reads_public_event_configuracoes" ON configuracoes`
      await sql`
        CREATE POLICY "anyone_reads_public_event_configuracoes" ON configuracoes
          FOR SELECT
          USING (
            EXISTS (
              SELECT 1 FROM events e
              WHERE e.id = configuracoes.event_id AND e.is_public = TRUE
            )
          )
      `
      // Caso especial: row legacy id='1' que aponta pra evento público também
      // precisa ser lida por anon (algumas telas leem por id=1 ainda).
      await sql`DROP POLICY IF EXISTS "anyone_reads_legacy_singleton_for_public_event" ON configuracoes`
      await sql`
        CREATE POLICY "anyone_reads_legacy_singleton_for_public_event" ON configuracoes
          FOR SELECT
          USING (
            id = '1' AND EXISTS (
              SELECT 1 FROM events e
              WHERE e.id = configuracoes.event_id AND e.is_public = TRUE
            )
          )
      `
      await sql`NOTIFY pgrst, 'reload schema'`
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'apply-protect-commission') {
      await sql`
        CREATE OR REPLACE FUNCTION protect_commission_columns() RETURNS trigger AS $func$
        BEGIN
          IF auth.role() = 'service_role' THEN
            RETURN NEW;
          END IF;
          IF EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN'
          ) THEN
            RETURN NEW;
          END IF;
          NEW.commission_type    := OLD.commission_type;
          NEW.commission_percent := OLD.commission_percent;
          NEW.commission_fixed   := OLD.commission_fixed;
          RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql SECURITY DEFINER;
      `
      await sql`DROP TRIGGER IF EXISTS protect_commission_columns_trigger ON events`
      await sql`
        CREATE TRIGGER protect_commission_columns_trigger
          BEFORE UPDATE ON events
          FOR EACH ROW
          EXECUTE FUNCTION protect_commission_columns()
      `
      await sql`NOTIFY pgrst, 'reload schema'`
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'apply-events-cover-url') {
      await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_url TEXT`
      const updated = await sql`
        UPDATE events e
        SET cover_url = c.cover_url
        FROM configuracoes c
        WHERE c.id = '1' AND c.event_id = e.id AND c.cover_url IS NOT NULL AND e.cover_url IS NULL
        RETURNING e.id, e.name, e.cover_url
      `
      await sql`NOTIFY pgrst, 'reload schema'`
      return new Response(JSON.stringify({ ok: true, backfilled: updated }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'registration-detail') {
      const regId = url.searchParams.get('id') ?? ''
      const rows = await sql`SELECT * FROM registrations WHERE id = ${regId}::uuid`
      return new Response(JSON.stringify({ row: rows[0] ?? null }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'event-detail') {
      const eventId = url.searchParams.get('id') ?? ''
      const rows = await sql`
        SELECT * FROM events WHERE id = ${eventId}::uuid
      `
      return new Response(JSON.stringify({ event: rows[0] ?? null }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list-public-events') {
      const evs = await sql`
        SELECT id, name, is_public, start_date, slug, city, state
        FROM events WHERE is_public = true
        ORDER BY start_date DESC
      `
      return new Response(JSON.stringify({ events: evs }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'apply-rls-fix') {
      // Habilita RLS em todas as tabelas que estavam desligadas.
      // events e profiles JÁ tinham policies mas RLS estava off — policies ignoradas.
      // Outras (categories, subcategories, event_styles, destaques_votacao) ganham
      // policies básicas: leitura pra autenticados, escrita só super admin.
      const results: any = {}

      // ── events: habilita RLS (policies já existem) ─────────────────────────
      await sql`ALTER TABLE events ENABLE ROW LEVEL SECURITY`
      results.events = 'RLS enabled (policies preserved)'

      // ── profiles: habilita RLS (policies já existem) ───────────────────────
      await sql`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY`
      results.profiles = 'RLS enabled (policies preserved)'

      // ── event_styles: catálogo de gêneros, leitura autenticada, escrita admin
      await sql`ALTER TABLE event_styles ENABLE ROW LEVEL SECURITY`
      await sql`DROP POLICY IF EXISTS "authenticated_reads_event_styles" ON event_styles`
      await sql`
        CREATE POLICY "authenticated_reads_event_styles" ON event_styles
        FOR SELECT USING (auth.uid() IS NOT NULL)
      `
      await sql`DROP POLICY IF EXISTS "admin_writes_event_styles" ON event_styles`
      await sql`
        CREATE POLICY "admin_writes_event_styles" ON event_styles
        FOR ALL USING (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
        ) WITH CHECK (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
        )
      `
      results.event_styles = 'RLS enabled + policies created'

      // ── categories / subcategories: catálogo público (read-only pra todos) ──
      await sql`ALTER TABLE categories ENABLE ROW LEVEL SECURITY`
      await sql`DROP POLICY IF EXISTS "public_reads_categories" ON categories`
      await sql`
        CREATE POLICY "public_reads_categories" ON categories
        FOR SELECT USING (true)
      `
      await sql`DROP POLICY IF EXISTS "admin_writes_categories" ON categories`
      await sql`
        CREATE POLICY "admin_writes_categories" ON categories
        FOR ALL USING (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
        ) WITH CHECK (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
        )
      `
      results.categories = 'RLS enabled + policies created'

      await sql`ALTER TABLE subcategories ENABLE ROW LEVEL SECURITY`
      await sql`DROP POLICY IF EXISTS "public_reads_subcategories" ON subcategories`
      await sql`
        CREATE POLICY "public_reads_subcategories" ON subcategories
        FOR SELECT USING (true)
      `
      await sql`DROP POLICY IF EXISTS "admin_writes_subcategories" ON subcategories`
      await sql`
        CREATE POLICY "admin_writes_subcategories" ON subcategories
        FOR ALL USING (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
        ) WITH CHECK (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
        )
      `
      results.subcategories = 'RLS enabled + policies created'

      // ── destaques_votacao: voto popular, autenticado lê e insere o seu ──────
      await sql`ALTER TABLE destaques_votacao ENABLE ROW LEVEL SECURITY`
      await sql`DROP POLICY IF EXISTS "authenticated_reads_destaques" ON destaques_votacao`
      await sql`
        CREATE POLICY "authenticated_reads_destaques" ON destaques_votacao
        FOR SELECT USING (auth.uid() IS NOT NULL)
      `
      await sql`DROP POLICY IF EXISTS "user_inserts_own_vote" ON destaques_votacao`
      await sql`
        CREATE POLICY "user_inserts_own_vote" ON destaques_votacao
        FOR INSERT WITH CHECK (auth.uid() IS NOT NULL)
      `
      results.destaques_votacao = 'RLS enabled + policies created'

      // ── equipe_convites: schema simples (id, email, cargo, permissoes, status)
      // Sem FK pra evento ou user. Só super admin gerencia por enquanto.
      await sql`DROP POLICY IF EXISTS "admin_manages_team_invites" ON equipe_convites`
      await sql`
        CREATE POLICY "admin_manages_team_invites" ON equipe_convites
        FOR ALL USING (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
        ) WITH CHECK (
          EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'COREOHUB_ADMIN')
        )
      `
      // Convidado pode ler o próprio convite pelo email do JWT.
      await sql`DROP POLICY IF EXISTS "invitee_reads_own" ON equipe_convites`
      await sql`
        CREATE POLICY "invitee_reads_own" ON equipe_convites
        FOR SELECT USING (
          email = (SELECT email FROM auth.users WHERE id = auth.uid())
        )
      `
      results.equipe_convites = 'policies added (admin manage + invitee reads own)'

      // ── popular_votes: votação por registration. Autenticado lê e vota. ───
      await sql`DROP POLICY IF EXISTS "authenticated_reads_popular_votes" ON popular_votes`
      await sql`
        CREATE POLICY "authenticated_reads_popular_votes" ON popular_votes
        FOR SELECT USING (auth.uid() IS NOT NULL)
      `
      await sql`DROP POLICY IF EXISTS "authenticated_writes_popular_votes" ON popular_votes`
      await sql`
        CREATE POLICY "authenticated_writes_popular_votes" ON popular_votes
        FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)
      `
      results.popular_votes = 'policies added (RLS already on)'

      await sql`NOTIFY pgrst, 'reload schema'`
      return new Response(JSON.stringify({ ok: true, results }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list-producer-asaas') {
      const rows = await sql`
        SELECT p.id, p.email, p.full_name, p.role, p.asaas_subconta_id, p.asaas_wallet_id, p.cpf_cnpj, p.pix_key
        FROM profiles p
        WHERE p.asaas_subconta_id IS NOT NULL
        ORDER BY p.full_name
      `
      return new Response(JSON.stringify({ producers: rows }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'add-asaas-api-key-column') {
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS asaas_api_key TEXT`
      await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS asaas_access_token TEXT`
      await sql`NOTIFY pgrst, 'reload schema'`
      return new Response(JSON.stringify({ ok: true, columns: ['asaas_api_key', 'asaas_access_token'] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'set-producer-asaas-api-key') {
      // Pra subcontas existentes que foram criadas sem salvar a apiKey.
      const subcontaId = url.searchParams.get('subconta_id') ?? ''
      const apiKey = url.searchParams.get('api_key') ?? ''
      if (!subcontaId || !apiKey) {
        return new Response(JSON.stringify({ error: 'subconta_id e api_key obrigatórios' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const result = await sql`
        UPDATE profiles SET asaas_api_key = ${apiKey}
        WHERE asaas_subconta_id = ${subcontaId}
        RETURNING id, full_name
      `
      return new Response(JSON.stringify({ ok: true, updated: result[0] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'register-pix-on-subconta') {
      // Registra a chave PIX de um produtor na subconta dele no Asaas.
      // Usa a apiKey DA SUBCONTA (já salva no profile).
      const subcontaId = url.searchParams.get('subconta_id') ?? ''
      if (!subcontaId) {
        return new Response(JSON.stringify({ error: 'subconta_id obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const profile = await sql`
        SELECT asaas_api_key, pix_key, full_name
        FROM profiles WHERE asaas_subconta_id = ${subcontaId}
      `
      const p = profile[0]
      if (!p?.asaas_api_key) {
        return new Response(JSON.stringify({ error: 'apiKey da subconta ainda não salva. Use action=set-producer-asaas-api-key primeiro.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!p?.pix_key) {
        return new Response(JSON.stringify({ error: 'pix_key não cadastrada no profile do produtor.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

      // Detecta tipo de chave PIX heuristicamente
      const key = String(p.pix_key).trim()
      const onlyDigits = key.replace(/\D/g, '')
      let pixType = 'EVP' // chave aleatória
      if (key.includes('@')) pixType = 'EMAIL'
      else if (onlyDigits.length === 11 && !/^\d{11}$/.test(key)) pixType = 'CPF'
      else if (onlyDigits.length === 14) pixType = 'CNPJ'
      else if (onlyDigits.length === 11) pixType = 'PHONE' // celular brasileiro DDD+9 dígitos
      else if (onlyDigits.length === 13 && onlyDigits.startsWith('55')) pixType = 'PHONE'

      const body: any = { type: pixType }
      // Asaas aceita 'EVP' sem 'key' (gera aleatória). Pra outros tipos, precisa enviar a chave.
      if (pixType !== 'EVP') {
        body.key = pixType === 'PHONE' && !key.startsWith('+')
          ? `+55${onlyDigits.slice(-11)}`
          : (pixType === 'PHONE' ? key : (pixType === 'CPF' || pixType === 'CNPJ' ? onlyDigits : key))
      }

      const pixRes = await fetch(`${ASAAS_BASE_URL}/pix/addressKeys`, {
        method: 'POST',
        headers: {
          'access_token': p.asaas_api_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const pixData = await pixRes.json()

      return new Response(JSON.stringify({
        ok: pixRes.ok,
        status: pixRes.status,
        body_sent: body,
        response: pixData,
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'add-refund-columns-to-registrations') {
      // Adiciona colunas de reembolso/cupom que existiam em coreografias mas
      // não em registrations. Faz parte do #12 do backlog (unificação).
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2)`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refund_reason TEXT`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2)`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS duracao_trilha_segundos INTEGER`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS subgenero TEXT`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS mod_fee NUMERIC(10,2)`
      await sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS tolerance_violation JSONB`
      await sql`NOTIFY pgrst, 'reload schema'`
      return new Response(JSON.stringify({ ok: true, columns_added: ['refunded_at','refund_amount','refund_reason','coupon_id','discount_amount','paid_at','duracao_trilha_segundos','subgenero','mod_fee','tolerance_violation'] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'count-tables') {
      const tables = url.searchParams.get('tables')?.split(',') ?? ['coreografias', 'registrations']
      const counts: any = {}
      for (const t of tables) {
        try {
          const r = await sql.unsafe(`SELECT COUNT(*) AS c FROM "${t}"`)
          counts[t] = Number(r[0].c)
        } catch (e) { counts[t] = `erro: ${(e as Error).message}` }
      }
      return new Response(JSON.stringify({ counts }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'validate-apikey') {
      // Testa apiKey em sandbox e produção pra descobrir onde funciona.
      const apiKey = url.searchParams.get('api_key') ?? ''
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'api_key obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const tries = [
        { env: 'sandbox', base: 'https://sandbox.asaas.com/api/v3' },
        { env: 'production', base: 'https://api.asaas.com/v3' },
      ]

      const results: any[] = []
      for (const t of tries) {
        try {
          const res = await fetch(`${t.base}/myAccount/account`, {
            headers: { 'access_token': apiKey },
          })
          const body = await res.json().catch(() => ({}))
          results.push({
            env: t.env,
            status: res.status,
            ok: res.ok,
            account_name: body?.name,
            account_email: body?.email,
            account_id: body?.id,
          })
        } catch (e) {
          results.push({ env: t.env, error: (e as Error).message })
        }
      }

      return new Response(JSON.stringify({ results }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list-and-create-subconta-tokens') {
      // Endpoint correto: /accounts/{id}/accessTokens
      // Doc: https://docs.asaas.com/reference/listar-chaves-de-api-de-uma-subconta
      const subcontaId = url.searchParams.get('subconta_id') ?? ''
      const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
      const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

      // 1. Lista tokens existentes da subconta
      const listRes = await fetch(`${ASAAS_BASE_URL}/accounts/${subcontaId}/accessTokens`, {
        headers: { 'access_token': ASAAS_API_KEY },
      })
      const listText = await listRes.text()
      let listBody: any
      try { listBody = JSON.parse(listText) } catch { listBody = listText.substring(0, 300) }

      // 2. Cria novo token
      const createRes = await fetch(`${ASAAS_BASE_URL}/accounts/${subcontaId}/accessTokens`, {
        method: 'POST',
        headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CoreoHub-PIX-Setup' }),
      })
      const createText = await createRes.text()
      let createBody: any
      try { createBody = JSON.parse(createText) } catch { createBody = createText.substring(0, 300) }

      // 3. Se a criação retornou apiKey, salva no profile
      let saved = false
      if (createRes.ok && createBody?.apiKey) {
        await sql`
          UPDATE profiles SET asaas_api_key = ${createBody.apiKey}
          WHERE asaas_subconta_id = ${subcontaId}
        `
        saved = true
      }

      return new Response(JSON.stringify({
        list: { status: listRes.status, body: listBody },
        create: { status: createRes.status, body: createBody },
        saved_to_profile: saved,
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'try-multiple-apikey-endpoints') {
      const subcontaId = url.searchParams.get('subconta_id') ?? ''
      const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
      const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

      const tries: { method: string, url: string, body?: any }[] = [
        { method: 'POST', url: `/accounts/${subcontaId}/apiKey`, body: { name: 'CoreoHub' } },
        { method: 'POST', url: `/customerApiAccessToken`, body: { customer: subcontaId, name: 'CoreoHub' } },
        { method: 'POST', url: `/customerApiAccessToken`, body: { account: subcontaId } },
        { method: 'GET',  url: `/accounts/${subcontaId}/apiKeys` },
        { method: 'GET',  url: `/customerApiAccessToken?customer=${subcontaId}` },
        { method: 'POST', url: `/myAccount/apiKey`, body: { account: subcontaId } },
      ]

      const results: any[] = []
      for (const t of tries) {
        try {
          const opts: any = {
            method: t.method,
            headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
          }
          if (t.body) opts.body = JSON.stringify(t.body)
          const res = await fetch(`${ASAAS_BASE_URL}${t.url}`, opts)
          const text = await res.text()
          let body: any
          try { body = JSON.parse(text) } catch { body = text.substring(0, 200) }
          results.push({ try: `${t.method} ${t.url}`, status: res.status, body })
        } catch (e) {
          results.push({ try: `${t.method} ${t.url}`, error: (e as Error).message })
        }
      }

      return new Response(JSON.stringify({ results }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'create-apikey-for-subconta') {
      // Cria uma apiKey nova pra subconta filha usando o endpoint do master
      // que só funciona com "Gerenciamento de Chaves de API de Subcontas" habilitado.
      const subcontaId = url.searchParams.get('subconta_id') ?? ''
      if (!subcontaId) {
        return new Response(JSON.stringify({ error: 'subconta_id obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
      const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

      // Endpoint Asaas: POST /accounts/{id}/apiKeys com nome da chave
      const res = await fetch(`${ASAAS_BASE_URL}/accounts/${subcontaId}/apiKeys`, {
        method: 'POST',
        headers: {
          'access_token': ASAAS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'CoreoHub-Auto-Generated' }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.ok && data.apiKey) {
        // Salva no profile
        await sql`
          UPDATE profiles SET asaas_api_key = ${data.apiKey}
          WHERE asaas_subconta_id = ${subcontaId}
        `
      }

      return new Response(JSON.stringify({
        ok: res.ok,
        status: res.status,
        response: data,
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'try-get-subconta-apikey') {
      // Tenta vários endpoints conhecidos do Asaas pra obter a apiKey de uma
      // subconta filha usando a apiKey da master.
      const subcontaId = url.searchParams.get('subconta_id') ?? ''
      if (!subcontaId) {
        return new Response(JSON.stringify({ error: 'subconta_id obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
      const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

      const attempts: any[] = []

      // Tentativa 1: GET /accounts/{id}/apiKey
      const a1 = await fetch(`${ASAAS_BASE_URL}/accounts/${subcontaId}/apiKey`, {
        headers: { 'access_token': ASAAS_API_KEY },
      }).then(r => r.json().then(b => ({ url: 'GET /accounts/{id}/apiKey', status: r.status, body: b })))
        .catch(e => ({ url: 'GET /accounts/{id}/apiKey', error: (e as Error).message }))
      attempts.push(a1)

      // Tentativa 2: POST /accounts/{id}/apiKey
      const a2 = await fetch(`${ASAAS_BASE_URL}/accounts/${subcontaId}/apiKey`, {
        method: 'POST',
        headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
        body: '{}',
      }).then(r => r.json().then(b => ({ url: 'POST /accounts/{id}/apiKey', status: r.status, body: b })))
        .catch(e => ({ url: 'POST /accounts/{id}/apiKey', error: (e as Error).message }))
      attempts.push(a2)

      // Tentativa 3: GET /accounts/{id} já vimos que retorna apiKey: null. Skip.
      // Tentativa 4: GET /myAccount/apiKeys com header da master + ?accountId=
      const a4 = await fetch(`${ASAAS_BASE_URL}/myAccount/apiKeys?accountId=${subcontaId}`, {
        headers: { 'access_token': ASAAS_API_KEY },
      }).then(r => r.json().then(b => ({ url: 'GET /myAccount/apiKeys', status: r.status, body: b })))
        .catch(e => ({ url: 'GET /myAccount/apiKeys', error: (e as Error).message }))
      attempts.push(a4)

      return new Response(JSON.stringify({ attempts }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'inspect-asaas-account') {
      // Busca dados reais da subconta no Asaas + lista chaves PIX cadastradas.
      const subcontaId = url.searchParams.get('subconta_id') ?? ''
      if (!subcontaId) {
        return new Response(JSON.stringify({ error: 'subconta_id obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
      const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'

      // 1. Busca dados da subconta (master pode listar filhas)
      const accountRes = await fetch(`${ASAAS_BASE_URL}/accounts/${subcontaId}`, {
        headers: { 'access_token': ASAAS_API_KEY },
      })
      const accountData = await accountRes.json()

      // 2. Lista chaves PIX da subconta (precisa do apiKey dela ou query no master)
      // Tenta via accounts/{id}/pix/addressKeys (algumas variantes do Asaas suportam)
      let pixKeys: any = null
      try {
        const pixRes = await fetch(`${ASAAS_BASE_URL}/accounts/${subcontaId}/pix/addressKeys`, {
          headers: { 'access_token': ASAAS_API_KEY },
        })
        pixKeys = await pixRes.json()
      } catch (e) {
        pixKeys = { note: `Endpoint não disponível: ${(e as Error).message}` }
      }

      return new Response(JSON.stringify({
        account_status: accountRes.status,
        account: accountData,
        pix_keys: pixKeys,
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'check-rls') {
      // Lista todas as tabelas em public com status de RLS.
      const rows = await sql`
        SELECT
          c.relname AS table_name,
          c.relrowsecurity AS rls_enabled,
          c.relforcerowsecurity AS rls_forced,
          (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relrowsecurity ASC, c.relname ASC
      `
      return new Response(JSON.stringify({ tables: rows }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list-recent-events') {
      const evs = await sql`
        SELECT e.id, e.name, e.created_by, e.created_at, p.email, p.full_name
        FROM events e
        LEFT JOIN profiles p ON p.id = e.created_by
        ORDER BY e.created_at DESC LIMIT 10
      `
      return new Response(JSON.stringify({ events: evs }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'dump-configuracoes') {
      const rows = await sql`SELECT * FROM configuracoes WHERE id = '1'`
      return new Response(JSON.stringify({ row: rows[0] }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'inspect-configuracoes') {
      const rows = await sql`
        SELECT c.id, c.event_id, e.name AS event_name, e.created_by
        FROM configuracoes c
        LEFT JOIN events e ON e.id = c.event_id
        ORDER BY c.id
      `
      return new Response(JSON.stringify({ rows }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'fix-configuracoes-event-id') {
      const userId = url.searchParams.get('user_id') ?? ''
      if (!userId) {
        return new Response(JSON.stringify({ error: 'user_id obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // Pega evento mais recente do user
      const evs = await sql`
        SELECT id, name FROM events WHERE created_by = ${userId}::uuid
        ORDER BY created_at DESC LIMIT 1
      `
      if (evs.length === 0) {
        return new Response(JSON.stringify({ error: 'Nenhum evento encontrado pra esse user' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const eventId = evs[0].id
      await sql`
        UPDATE configuracoes SET event_id = ${eventId}::uuid WHERE id = '1'
      `
      return new Response(JSON.stringify({ ok: true, event_id: eventId, event_name: evs[0].name }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'test-insert') {
      const payload = await req.json()
      try {
        // Testa INSERT com transação imediatamente revertida — não polui o banco
        await sql.begin(async (s) => {
          const cols = Object.keys(payload).filter(k => payload[k] !== undefined)
          const vals = cols.map(k => payload[k])
          const colsList = cols.map(c => `"${c}"`).join(', ')
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
          await s.unsafe(
            `INSERT INTO public.events (${colsList}) VALUES (${placeholders}) RETURNING id`,
            vals
          )
          // Força rollback
          throw new Error('__rollback_intentional__')
        })
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (e: any) {
        if (e?.message === '__rollback_intentional__') {
          return new Response(JSON.stringify({ ok: true, note: 'INSERT funcionou (rollback aplicado)' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({
          ok: false,
          error: e?.message ?? 'unknown',
          detail: e?.detail,
          column: e?.column,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response(JSON.stringify({ error: 'action inválida' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } finally {
    if (sql) await sql.end()
  }
})
