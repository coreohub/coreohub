// Retorna o status KYC da subconta Asaas do produtor autenticado.
//
// Sessão 3 do carrinho — usado pelo /account-settings pra mostrar banner
// quando KYC outbound não está APPROVED. Sem essa validação, produtor cadastra
// PIX, começa a receber inscrições, e descobre só depois que não consegue
// sacar (caso real do Hemer em 2026-05-19).
//
// Retorna:
//   - status.commercialInfo (APPROVED = pode receber)
//   - status.documentation  (APPROVED = pode enviar PIX outbound)
//   - status.general
//   - status.bankAccountInfo
//   - pendingDocuments[]: docs ainda não enviados (com onboardingUrl)
//   - canReceive: boolean — comercial OK, dá pra cobrar
//   - canPayout:  boolean — documentation OK, dá pra sacar pro PIX

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return respond(401, { error: 'Não autorizado' })

    // Carrega o asaas_api_key do produtor autenticado.
    const { data: profile } = await supabase
      .from('profiles')
      .select('asaas_subconta_id, asaas_api_key, full_name')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.asaas_subconta_id) {
      return respond(200, {
        hasSubconta:  false,
        canReceive:   false,
        canPayout:    false,
        message:      'Subconta Asaas não configurada. Cadastre seu PIX em Configurações → Pagamentos.',
      })
    }
    if (!profile.asaas_api_key) {
      // Subconta existe mas perdemos a apiKey (recuperação parcial). Não dá
      // pra consultar status sem ela.
      return respond(200, {
        hasSubconta:    true,
        canReceive:     true,  // assume optimist — split funciona via wallet_id, não precisa apiKey
        canPayout:      false, // sem apiKey, não dá pra sacar
        unrecoverable: true,
        message: 'Sua subconta Asaas precisa ser regenerada. Entre em contato com o suporte.',
      })
    }

    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? ''
    if (!ASAAS_BASE_URL) return respond(500, { error: 'ASAAS_BASE_URL não configurada' })

    const headers = {
      'access_token': profile.asaas_api_key,
      'Content-Type': 'application/json',
    }

    // 1) Status macro do KYC
    const statusRes = await fetch(`${ASAAS_BASE_URL}/myAccount/status`, { headers })
    const status: any = await statusRes.json().catch(() => null)

    // 2) Lista de documentos pendentes (pra mostrar link de onboarding)
    const docsRes = await fetch(`${ASAAS_BASE_URL}/myAccount/documents`, { headers })
    const docs: any = await docsRes.json().catch(() => null)

    const pendingDocuments = (docs?.data ?? [])
      .filter((d: any) => d.status === 'NOT_SENT' || d.status === 'REJECTED')
      .map((d: any) => ({
        type:                       d.type,
        title:                      d.title,
        status:                     d.status,
        onboardingUrl:              d.onboardingUrl ?? null,
        onboardingUrlExpirationDate: d.onboardingUrlExpirationDate ?? null,
      }))

    const canReceive = status?.commercialInfo === 'APPROVED'
    const canPayout  = status?.documentation === 'APPROVED' && status?.general === 'APPROVED'

    // Persiste status/url frescos no profile pra banner /account-settings refletir
    // sem o produtor ter que recarregar. Status raiz (NOT_SENT/PENDING/APPROVED/REJECTED)
    // vem da resposta de /myAccount/documents (campo `status`).
    try {
      const rootKycStatus = docs?.status
        ?? (canPayout ? 'APPROVED' : (pendingDocuments.length > 0 ? 'PENDING' : 'NOT_SENT'))
      const onboardingUrlAgg = pendingDocuments.find((d: any) => d.onboardingUrl)?.onboardingUrl ?? null
      await supabase
        .from('profiles')
        .update({
          asaas_kyc_status:     rootKycStatus,
          asaas_onboarding_url: onboardingUrlAgg,
          asaas_kyc_checked_at: new Date().toISOString(),
        })
        .eq('id', user.id)
    } catch (persistErr) {
      console.warn('[check-producer-kyc] falha ao persistir status no profile:', (persistErr as Error).message)
    }

    return respond(200, {
      hasSubconta:   true,
      canReceive,
      canPayout,
      status: {
        commercialInfo:  status?.commercialInfo ?? null,
        documentation:   status?.documentation ?? null,
        general:         status?.general ?? null,
        bankAccountInfo: status?.bankAccountInfo ?? null,
      },
      pendingDocuments,
      // Pega o onboardingUrl do primeiro doc pendente (geralmente é o mesmo
      // pra todos — link único de upload no app Asaas).
      onboardingUrl: pendingDocuments.find((d: any) => d.onboardingUrl)?.onboardingUrl ?? null,
      // A9 auditoria Sessão 3: expor expiração do link agregado pra frontend
      // poder esconder botão e pedir novo link quando expirar.
      onboardingUrlExpirationDate: pendingDocuments.find((d: any) => d.onboardingUrl)?.onboardingUrlExpirationDate ?? null,
    })
  } catch (e: any) {
    return respond(500, { error: e.message })
  }
})
