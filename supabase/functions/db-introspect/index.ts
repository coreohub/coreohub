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
