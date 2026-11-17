/**
 * Edge Function: unsubscribe-sales-open
 *
 * Link de "Sair da lista" do e-mail de abertura de vendas. Público (verify_jwt=false):
 * GET ?token=<unsubscribe_token>. Marca unsubscribed_at e redireciona (302) para a
 * vitrine do evento com ?aviso=saiu. Token desconhecido: redireciona do mesmo jeito
 * (não revela se existe).
 *
 * Observação: o Supabase serve HTML de função como texto puro, por isso a confirmação
 * visual fica na vitrine, não nesta resposta.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_URL = 'https://app.coreohub.com'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const redirect = (path: string) => new Response(null, { status: 302, headers: { Location: `${APP_URL}${path}` } })

  try {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    if (!UUID_RE.test(token)) return redirect('/festivais')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const { data: sub } = await supabase
      .from('sales_open_subscribers')
      .select('id, event_id, unsubscribed_at')
      .eq('unsubscribe_token', token)
      .maybeSingle()
    if (!sub) return redirect('/festivais')

    if (!sub.unsubscribed_at) {
      await supabase
        .from('sales_open_subscribers')
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq('id', sub.id)
    }

    const { data: ev } = await supabase.from('events').select('slug').eq('id', sub.event_id).maybeSingle()
    return redirect(ev?.slug ? `/evento/${ev.slug}?aviso=saiu` : '/festivais')
  } catch (_e) {
    return redirect('/festivais')
  }
})
