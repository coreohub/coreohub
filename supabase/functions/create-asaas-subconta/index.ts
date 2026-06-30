import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('[create-asaas-subconta] STEP 1: criando supabase client')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    console.log('[create-asaas-subconta] STEP 2: lendo Authorization header')
    const authHeader = req.headers.get('Authorization') ?? ''
    console.log('[create-asaas-subconta] STEP 2.5: validando user via auth.getUser')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) {
      console.error('[create-asaas-subconta] STEP 2 FALHOU:', authErr?.message)
      throw new Error('Não autorizado')
    }
    console.log('[create-asaas-subconta] STEP 3: usuario autenticado:', user.id)

    console.log('[create-asaas-subconta] STEP 4: lendo body da request')
    let body: any
    try {
      const rawBody = await req.text()
      console.log('[create-asaas-subconta] STEP 4.1: body raw length=', rawBody.length, 'first200=', rawBody.slice(0, 200))
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch (bodyErr) {
      console.error('[create-asaas-subconta] STEP 4 FALHOU ao parsear body:', (bodyErr as Error).message)
      throw new Error('Body da requisição inválido: ' + (bodyErr as Error).message)
    }
    const { cpf_cnpj, pix_key, company_type, income_value, birth_date, action } = body
    console.log('[create-asaas-subconta] STEP 5: body parseado, action=', action, 'cpf_len=', String(cpf_cnpj ?? '').length)

    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY') ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? 'https://sandbox.asaas.com/api/v3'
    console.log('[create-asaas-subconta] STEP 6: env vars carregadas, base_url=', ASAAS_BASE_URL, 'api_key_len=', ASAAS_API_KEY.length)

    // ─── ACTION: update_pix — trocar apenas a chave PIX, sem mexer no KYC ───
    // Lê apiKey da subconta do profile, registra nova chave no Asaas e atualiza Supabase.
    if (action === 'update_pix') {
      if (!pix_key) throw new Error('Chave PIX é obrigatória')
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('asaas_subconta_id, asaas_api_key, asaas_wallet_id')
        .eq('id', user.id)
        .single()
      if (profErr || !prof?.asaas_subconta_id) {
        throw new Error('Você não tem subconta configurada. Configure uma primeiro.')
      }
      if (!prof.asaas_api_key) {
        throw new Error('Não conseguimos atualizar sua chave PIX automaticamente. Entre em contato com o suporte WhatsApp: https://wa.me/5517997936169')
      }
      const key = String(pix_key).trim()
      const onlyDigits = key.replace(/\D/g, '')
      let pixType = 'EVP'
      let pixKey: string | undefined
      if (key.includes('@'))                              { pixType = 'EMAIL'; pixKey = key }
      else if (onlyDigits.length === 14)                  { pixType = 'CNPJ';  pixKey = onlyDigits }
      else if (onlyDigits.length === 11)                  { pixType = 'PHONE'; pixKey = `+55${onlyDigits}` }
      else if (onlyDigits.length === 13 && onlyDigits.startsWith('55')) { pixType = 'PHONE'; pixKey = `+${onlyDigits}` }

      const pixRes = await fetch(`${ASAAS_BASE_URL}/pix/addressKeys`, {
        method: 'POST',
        headers: { 'access_token': prof.asaas_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify(pixType === 'EVP' ? { type: pixType } : { type: pixType, key: pixKey }),
      })
      if (!pixRes.ok) {
        const pixErr = await pixRes.json().catch(() => ({}))
        const msg = pixErr.errors?.[0]?.description ?? 'Erro ao registrar nova chave PIX no Asaas'
        throw new Error(msg)
      }

      await supabase.from('profiles').update({ pix_key: key }).eq('id', user.id)

      return new Response(
        JSON.stringify({ success: true, action: 'update_pix' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ─── ACTION default: criar subconta (ou recuperar se já existir) ────────
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

    // Endereço + celular — obrigatórios em produção (KYC Asaas). Sandbox aceitava sem.
    const { postal_code, address, address_number, complement, province, city, state, mobile_phone } = body
    if (!postal_code   || !/^\d{8}$/.test(String(postal_code).replace(/\D/g, ''))) throw new Error('CEP é obrigatório (8 dígitos)')
    if (!address)        throw new Error('Endereço (rua) é obrigatório')
    if (!address_number) throw new Error('Número do endereço é obrigatório')
    if (!province)       throw new Error('Bairro é obrigatório')
    if (!city)           throw new Error('Cidade é obrigatória')
    if (!state || String(state).length !== 2) throw new Error('UF (estado) é obrigatório (2 letras)')
    const phoneDigits = String(mobile_phone ?? '').replace(/\D/g, '')
    if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 11) throw new Error('Celular é obrigatório (DDD + número, 10 ou 11 dígitos)')

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

    const cpfLimpo = cpf_cnpj.replace(/\D/g, '')

    console.log('[create-asaas-subconta] STEP 7: POST', `${ASAAS_BASE_URL}/accounts`)
    const subcontaRes = await fetch(`${ASAAS_BASE_URL}/accounts`, {
      method: 'POST',
      headers: {
        'access_token': ASAAS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name:           profile.full_name,
        email:          email,
        cpfCnpj:        cpfLimpo,
        incomeValue:    Number(income_value),
        // Endereço + telefone obrigatórios em produção (KYC).
        postalCode:     String(postal_code).replace(/\D/g, ''),
        address:        address,
        addressNumber:  address_number,
        ...(complement ? { complement } : {}),
        province:       province,
        mobilePhone:    phoneDigits,
        ...(cpfLimpo.length === 14 && company_type ? { companyType: company_type } : {}),
        // birthDate: YYYY-MM-DD — obrigatório pra CPF (KYC Asaas/BCB).
        ...(cpfLimpo.length === 11 && birth_date ? { birthDate: birth_date } : {}),
      }),
    })

    console.log('[create-asaas-subconta] STEP 8: resposta Asaas status=', subcontaRes.status)
    const subcontaText = await subcontaRes.text()
    console.log('[create-asaas-subconta] STEP 8.1: body len=', subcontaText.length, 'full=', subcontaText.slice(0, 2000))
    let subcontaData: any
    try {
      subcontaData = subcontaText ? JSON.parse(subcontaText) : {}
    } catch (parseErr) {
      console.error('[create-asaas-subconta] STEP 8 FALHOU ao parsear resposta Asaas:', (parseErr as Error).message, 'body=', subcontaText)
      throw new Error(`Asaas retornou resposta inválida (status ${subcontaRes.status}): ${subcontaText.slice(0, 200)}`)
    }
    // Log explícito dos campos sensíveis pra debug futuro de KYC.
    // Se Asaas silenciar campo (ex.: mobilePhone "Não informado" no painel), aparece aqui.
    console.log('[create-asaas-subconta] STEP 8.2: campos retornados — mobilePhone=', subcontaData?.mobilePhone ?? '<null>', 'phone=', subcontaData?.phone ?? '<null>', 'address=', subcontaData?.address ?? '<null>')
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

      // Tenta 3 estratégias: por email, por CPF/CNPJ, e por busca geral (mais lenta).
      // O Asaas valida duplicidade em vários campos — qual deles bateu varia.
      const tryLookup = async (params: string, label: string): Promise<any | null> => {
        const url = `${ASAAS_BASE_URL}/accounts?${params}&limit=10`
        console.log(`[create-asaas-subconta] ${label}: GET ${url}`)
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'access_token': ASAAS_API_KEY },
        })
        const data = await res.json()
        console.log(`[create-asaas-subconta] ${label} resposta: status=${res.status} count=${Array.isArray(data?.data) ? data.data.length : 'N/A'}`)
        if (!res.ok || !Array.isArray(data.data) || data.data.length === 0) return null
        // Match exato por CPF ou email — em caso de múltiplas subcontas no resultado
        const match = data.data.find((a: any) =>
          (a.cpfCnpj && a.cpfCnpj.replace(/\D/g, '') === cpfLimpo) ||
          (a.email && a.email.toLowerCase() === email.toLowerCase())
        )
        return match ?? data.data[0]
      }

      let existing: any = null
      // 1) Por email (mais comum quando o erro é "email já em uso")
      existing = await tryLookup(`email=${encodeURIComponent(email)}`, 'lookup por email')
      // 2) Por CPF/CNPJ
      if (!existing) existing = await tryLookup(`cpfCnpj=${cpfLimpo}`, 'lookup por cpfCnpj')

      if (!existing) {
        console.error('[create-asaas-subconta] subconta duplicada mas não recuperável. email:', email, 'cpf:', cpfLimpo)
        throw new Error(
          `${errMsg || 'Conflito detectado'} Não conseguimos recuperar a subconta existente automaticamente. Entre em contato com o suporte WhatsApp: https://wa.me/5517997936169`
        )
      }
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
        postal_code:        String(postal_code).replace(/\D/g, ''),
        address:            address,
        address_number:     address_number,
        complement:         complement ?? null,
        province:           province,
        city:               city,
        state:              String(state).toUpperCase(),
        mobile_phone:       phoneDigits,
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

    // ── KYC status: GET /myAccount/documents pra obter onboardingUrl + status ─
    // Feature #42: sem isso o produtor descobre só DEPOIS que Pix nativo
    // exige KYC completo (RG/CNH + selfie + comprovante). Capturando aqui,
    // o banner em /account-settings → Pagamentos guia ele direto.
    // Best-effort: erro nunca bloqueia criação da subconta.
    if (apiKeyParaPix) {
      try {
        const docsRes = await fetch(`${ASAAS_BASE_URL}/myAccount/documents`, {
          headers: {
            'access_token': apiKeyParaPix,
            'Content-Type': 'application/json',
          },
        })
        if (docsRes.ok) {
          const docsData = await docsRes.json()
          // Resposta oficial Asaas (memória asaas_subconta_onboarding_kyc.md):
          //   { onboardingUrl, status, data: [{ type, status, ... }] }
          // Status raiz: NOT_SENT / PENDING / APPROVED / REJECTED
          const onboardingUrl = docsData?.onboardingUrl ?? null
          const kycStatus     = docsData?.status ?? 'NOT_SENT'
          await supabase
            .from('profiles')
            .update({
              asaas_onboarding_url: onboardingUrl,
              asaas_kyc_status:     kycStatus,
              asaas_kyc_checked_at: new Date().toISOString(),
            })
            .eq('id', user.id)
          console.log(`[create-asaas-subconta] KYC ${kycStatus} url=${onboardingUrl ? 'set' : 'null'}`)
        } else {
          const body = await docsRes.text().catch(() => '')
          console.warn(`[create-asaas-subconta] GET /myAccount/documents falhou (${docsRes.status}): ${body.slice(0, 200)}`)
        }
      } catch (kycErr) {
        console.warn('[create-asaas-subconta] erro consulta KYC:', (kycErr as Error).message)
      }
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
