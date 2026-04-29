import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) throw new Error('Não autorizado')

    const { cpf_cnpj, pix_key, company_type, income_value } = await req.json()
    if (!cpf_cnpj) throw new Error('CPF/CNPJ é obrigatório')
    if (!pix_key)  throw new Error('Chave PIX é obrigatória')
    if (!income_value || Number(income_value) <= 0) throw new Error('Renda/faturamento é obrigatório')

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()

    // email vem de auth.users (user.email), não de profiles
    const email = user.email ?? ''
    if (!profile?.full_name || !email) {
      throw new Error('Perfil incompleto. Preencha nome e email antes de continuar.')
    }

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'
    const cpfLimpo = cpf_cnpj.replace(/\D/g, '')

    const subcontaRes = await fetch(`${ASAAS_BASE_URL}/accounts`, {
      method: 'POST',
      headers: {
        'access_token': ASAAS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name:        profile.full_name,
        email:       email,
        cpfCnpj:     cpfLimpo,
        incomeValue: Number(income_value),
        ...(cpfLimpo.length === 14 && company_type ? { companyType: company_type } : {}),
      }),
    })

    const subcontaData = await subcontaRes.json()

    if (!subcontaRes.ok) {
      console.error('[create-asaas-subconta] erro Asaas:', subcontaData)
      const msg = subcontaData.errors?.[0]?.description ?? 'Erro ao criar subconta no Asaas'
      throw new Error(msg)
    }

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        asaas_subconta_id:  subcontaData.id,
        asaas_wallet_id:    subcontaData.walletId,
        asaas_api_key:      subcontaData.apiKey ?? null,
        asaas_access_token: subcontaData.accessToken ?? null,
        cpf_cnpj:           cpfLimpo,
        pix_key:            pix_key.trim(),
      })
      .eq('id', user.id)

    if (updateErr) throw new Error(`Erro ao salvar dados: ${updateErr.message}`)

    // ── Registra a chave PIX na subconta usando a apiKey dela ─────────────
    // Sem isso o Asaas não oferece PIX como método na cobrança.
    // Falha aqui não bloqueia o cadastro — o produtor pode registrar depois.
    if (subcontaData.apiKey) {
      try {
        const key = pix_key.trim()
        const onlyDigits = key.replace(/\D/g, '')
        let pixType = 'EVP'
        let pixKey: string | undefined
        if (key.includes('@')) {
          pixType = 'EMAIL'
          pixKey = key
        } else if (onlyDigits.length === 14) {
          pixType = 'CNPJ'
          pixKey = onlyDigits
        } else if (onlyDigits.length === 11) {
          // Heurística: 11 dígitos pode ser CPF ou celular. Se começa com DDD comum (1-9), é celular.
          pixType = 'PHONE'
          pixKey = `+55${onlyDigits}`
        } else if (onlyDigits.length === 13 && onlyDigits.startsWith('55')) {
          pixType = 'PHONE'
          pixKey = `+${onlyDigits}`
        }

        const pixRes = await fetch(`${ASAAS_BASE_URL}/pix/addressKeys`, {
          method: 'POST',
          headers: {
            'access_token': subcontaData.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(pixType === 'EVP' ? { type: pixType } : { type: pixType, key: pixKey }),
        })
        if (!pixRes.ok) {
          const pixErr = await pixRes.json().catch(() => ({}))
          console.warn(`[create-asaas-subconta] PIX não registrado (${pixRes.status}):`, pixErr)
        } else {
          console.log(`[create-asaas-subconta] PIX ${pixType} registrado pra subconta ${subcontaData.id}`)
        }
      } catch (pixErr) {
        console.warn('[create-asaas-subconta] erro ao registrar PIX:', (pixErr as Error).message)
      }
    } else {
      console.warn('[create-asaas-subconta] subconta criada sem apiKey — PIX não registrado automaticamente')
    }

    console.log(`[create-asaas-subconta] subconta criada para ${user.id}: ${subcontaData.id}`)

    return new Response(
      JSON.stringify({
        success:    true,
        subconta_id: subcontaData.id,
        wallet_id:  subcontaData.walletId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[create-asaas-subconta] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
