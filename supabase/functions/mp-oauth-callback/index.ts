import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Lidar com requisições CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') // Este é o producer_id que passamos no link

    if (!code || !state) {
      throw new Error('Código ou estado não fornecido pelo Mercado Pago.')
    }

    const clientId = Deno.env.get('MP_CLIENT_ID')
    const clientSecret = Deno.env.get('MP_CLIENT_SECRET')
    
    // O redirect_uri deve ser EXATAMENTE o mesmo que você configurou no painel do MP
    const redirectUri = `${url.origin}/functions/v1/mp-oauth-callback`

    console.log('Trocando código por tokens no Mercado Pago...')

    // 1. Trocar o código por tokens na API do Mercado Pago
    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    })

    const mpData = await response.json()

    if (!response.ok) {
      console.error('Erro na resposta do Mercado Pago:', mpData)
      throw new Error(`Falha na autenticação do Mercado Pago: ${mpData.message || 'Erro desconhecido'}`)
    }

    // 2. Inicializar o cliente Supabase com a Service Role Key para poder atualizar o profile
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // 3. Salvar os tokens no profile do produtor
    console.log(`Atualizando tokens para o produtor ${state}...`)
    const { error: updateError } = await supabaseClient
      .from('profiles')
      .update({
        mp_access_token: mpData.access_token,
        mp_refresh_token: mpData.refresh_token,
        mp_user_id: String(mpData.user_id), // Este é o ID do vendedor no MP
        mp_connected_at: new Date().toISOString()
      })
      .eq('id', state)

    if (updateError) {
      console.error('Erro ao atualizar perfil no Supabase:', updateError)
      throw updateError
    }

    // 4. Redirecionar o produtor de volta para a aplicação frontend
    // Ajuste as URLs de redirecionamento conforme necessário
    const isLocalhost = url.origin.includes('localhost') || url.origin.includes('127.0.0.1')
    const frontendBaseUrl = isLocalhost ? 'http://localhost:5173' : 'https://dance-pro-festival.vercel.app'
    
    return Response.redirect(`${frontendBaseUrl}/account-settings?mp_status=success`, 303)

  } catch (error) {
    console.error('Erro na função mp-oauth-callback:', error.message)
    return Response.redirect(`http://localhost:5173/account-settings?mp_status=error&message=${encodeURIComponent(error.message)}`, 303)
  }
})
