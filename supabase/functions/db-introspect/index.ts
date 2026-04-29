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
