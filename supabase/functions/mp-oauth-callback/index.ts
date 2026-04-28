import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── HMAC-SHA256 helper ───────────────────────────────────────────────────────

async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── State validation ─────────────────────────────────────────────────────────
// State format: base64url(<producerId>:<timestamp>:<hmac>)
// Timestamp em segundos — válido por 15 minutos.

async function verifyOAuthState(
  stateParam: string,
  secret: string
): Promise<string> {
  let decoded: string
  try {
    decoded = atob(stateParam.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    throw new Error('state inválido')
  }

  const parts = decoded.split(':')
  if (parts.length < 3) throw new Error('state malformado')

  const [producerId, tsStr, receivedHmac] = parts
  const ts = parseInt(tsStr, 10)
  const now = Math.floor(Date.now() / 1000)

  if (isNaN(ts) || now - ts > 900) throw new Error('state expirado ou timestamp inválido')

  const expected = await hmacSha256(secret, `${producerId}:${tsStr}`)
  if (expected !== receivedHmac) throw new Error('state com assinatura inválida (CSRF)')

  return producerId
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const frontendUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'

  try {
    const url   = new URL(req.url)
    const code  = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (!code || !state) {
      throw new Error('Código ou estado não fornecido pelo Mercado Pago.')
    }

    // Valida CSRF via HMAC antes de usar o state
    const stateSecret = Deno.env.get('OAUTH_STATE_SECRET') ?? ''
    if (!stateSecret) throw new Error('OAUTH_STATE_SECRET não configurado')

    const producerId = await verifyOAuthState(state, stateSecret)

    const clientId     = Deno.env.get('MP_CLIENT_ID')
    const clientSecret = Deno.env.get('MP_CLIENT_SECRET')
    const redirectUri  = `${url.origin}/functions/v1/mp-oauth-callback`

    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
      }),
    })

    const mpData = await response.json()
    if (!response.ok) throw new Error(`Falha na autenticação do MP: ${mpData.message ?? 'Erro desconhecido'}`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        mp_access_token:  mpData.access_token,
        mp_refresh_token: mpData.refresh_token,
        mp_user_id:       String(mpData.user_id),
        mp_connected_at:  new Date().toISOString(),
      })
      .eq('id', producerId)

    if (updateError) throw updateError

    return Response.redirect(`${frontendUrl}/account-settings?mp_status=success`, 303)

  } catch (error: any) {
    console.error('[mp-oauth-callback] erro:', error.message)
    return Response.redirect(
      `${frontendUrl}/account-settings?mp_status=error&message=${encodeURIComponent(error.message)}`,
      303
    )
  }
})
