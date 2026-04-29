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
