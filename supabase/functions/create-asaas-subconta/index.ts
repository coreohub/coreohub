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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) throw new Error('Não autorizado')

    const { cpf_cnpj, pix_key, company_type, income_value, birth_date } = await req.json()
    if (!cpf_cnpj) throw new Error('CPF/CNPJ é obrigatório')
    if (!pix_key)  throw new Error('Chave PIX é obrigatória')
    if (!income_value || Number(income_value) <= 0) throw new Error('Renda/faturamento é obrigatório')

    const cpfLimpoCheck = String(cpf_cnpj).replace(/\D/g, '')
    if (cpfLimpoCheck.length === 11 && !birth_date) {
      throw new Error('Data de nascimento é obrigatória para CPF (exigência KYC do Asaas)')
    }
    if (birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(birth_date)) {
      throw new Error('Data de nascimento deve estar no formato YYYY-MM-DD')
    }

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
        // birthDate: YYYY-MM-DD — obrigatório pra CPF (KYC Asaas/BCB).
        ...(cpfLimpo.length === 11 && birth_date ? { birthDate: birth_date } : {}),
      }),
    })

    let subcontaData = await subcontaRes.json()
    let isRecovered = false

    if (!subcontaRes.ok) {
      // Detecta caso de "email/CPF já em uso" — significa que o produtor já tinha
      // subconta criada anteriormente (ex.: desconectou pelo /account-settings e
      // tá tentando reconectar). Em vez de falhar, recupera os IDs via GET.
      const errMsg = subcontaData.errors?.[0]?.description ?? ''
      const isDuplicate = /j[áa]\s*est[áa]\s*em\s*uso|already.*in\s*use|duplicat/i.test(errMsg)

      if (!isDuplicate) {
        console.error('[create-asaas-subconta] erro Asaas:', subcontaData)
        throw new Error(errMsg || 'Erro ao criar subconta no Asaas')
      }

      console.log(`[create-asaas-subconta] subconta duplicada detectada (${errMsg}) — tentando recuperar via GET`)

      // Busca por CPF/CNPJ — mais único que email
      const listUrl = `${ASAAS_BASE_URL}/accounts?cpfCnpj=${cpfLimpo}&limit=1`
      const listRes = await fetch(listUrl, {
        method: 'GET',
        headers: { 'access_token': ASAAS_API_KEY },
      })
      const listData = await listRes.json()

      if (!listRes.ok || !Array.isArray(listData.data) || listData.data.length === 0) {
        console.error('[create-asaas-subconta] subconta duplicada mas não recuperável:', listData)
        throw new Error(
          'Você já tem uma subconta cadastrada com esse CPF/CNPJ, mas não conseguimos recuperá-la automaticamente. Entre em contato com o suporte: contato@coreohub.com'
        )
      }

      const existing = listData.data[0]
      // GET /accounts não retorna apiKey/accessToken — vai recorrer ao que estiver
      // no Supabase. Se também estiver null lá, registro de PIX vai falhar (warn).
      subcontaData = {
        id:           existing.id,
        walletId:     existing.walletId,
        apiKey:       null,        // não vem via GET
        accessToken:  null,        // não vem via GET
      }
      isRecovered = true
      console.log(`[create-asaas-subconta] subconta recuperada: ${existing.id}`)
    }

    // Em caso de recuperação, busca apiKey/accessToken antigos do Supabase
    // (foram salvos quando o produtor criou a subconta originalmente). Se já
    // foram limpos, vão ficar null — registro de PIX falha mas subconta volta.
    let preservedApiKey: string | null = subcontaData.apiKey ?? null
    let preservedAccessToken: string | null = subcontaData.accessToken ?? null
    if (isRecovered) {
      const { data: oldProfile } = await supabase
        .from('profiles')
        .select('asaas_api_key, asaas_access_token')
        .eq('id', user.id)
        .single()
      preservedApiKey      = oldProfile?.asaas_api_key      ?? null
      preservedAccessToken = oldProfile?.asaas_access_token ?? null
    }

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        asaas_subconta_id:  subcontaData.id,
        asaas_wallet_id:    subcontaData.walletId,
        asaas_api_key:      preservedApiKey,
        asaas_access_token: preservedAccessToken,
        cpf_cnpj:           cpfLimpo,
        pix_key:            pix_key.trim(),
      })
      .eq('id', user.id)

    if (updateErr) throw new Error(`Erro ao salvar dados: ${updateErr.message}`)

    // ── Registra a chave PIX na subconta usando a apiKey dela ─────────────
    // Sem isso o Asaas não oferece PIX como método na cobrança.
    // Falha aqui não bloqueia o cadastro — o produtor pode registrar depois.
    const apiKeyParaPix = preservedApiKey
    if (apiKeyParaPix) {
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
            'access_token': apiKeyParaPix,
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
      console.warn('[create-asaas-subconta] subconta sem apiKey — PIX não registrado automaticamente (caso comum em recuperação)')
    }

    console.log(`[create-asaas-subconta] subconta ${isRecovered ? 'recuperada' : 'criada'} para ${user.id}: ${subcontaData.id}`)

    return new Response(
      JSON.stringify({
        success:     true,
        recovered:   isRecovered,
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
