import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function calcularComissao(
  valorInscricao: number,
  tipo: string,
  percentual: number,
  fixo: number
): number {
  switch (tipo) {
    case 'percent':  return parseFloat((valorInscricao * (percentual / 100)).toFixed(2))
    case 'fixed':    return fixo
    case 'combined': return parseFloat(((valorInscricao * (percentual / 100)) + fixo).toFixed(2))
    default:         return parseFloat((valorInscricao * 0.10).toFixed(2))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { registration_id, event_id } = await req.json()

    if (!registration_id || !event_id) {
      throw new Error('registration_id e event_id são obrigatórios.')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Buscar dados da coreografia (sem join — coreografias não tem FK para profiles)
    const { data: coreo, error: coreoError } = await supabase
      .from('coreografias')
      .select('*')
      .eq('id', registration_id)
      .single()

    if (coreoError || !coreo) {
      throw new Error(`Coreografia não encontrada: ${coreoError?.message}`)
    }

    // 1b. Buscar perfil do inscrito separadamente
    const { data: inscritoProfile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', coreo.user_id)
      .single()

    // 2. Buscar dados do evento
    const { data: event, error: evError } = await supabase
      .from('events')
      .select('id, name, created_by, commission_type, commission_percent, commission_fixed, modalities_config')
      .eq('id', event_id)
      .single()

    if (evError || !event) {
      throw new Error(`Evento não encontrado: ${evError?.message}`)
    }

    // 3. Buscar configurações do evento (preços das modalidades)
    const { data: config } = await supabase
      .from('configuracoes')
      .select('formatos_precos')
      .eq('event_id', event_id)
      .single()

    // 4. Calcular o valor da inscrição pela modalidade
    const formatos: any[] = config?.formatos_precos ?? []
    const eventModalities: any[] = (event as any).modalities_config ?? []
    const modalidadeNome: string = coreo.tipo_apresentacao ?? coreo.modalidade ?? ''

    // Fonte 1: configuracoes.formatos_precos
    const formatoEncontrado = modalidadeNome
      ? formatos.find((f: any) => f.nome?.toLowerCase() === modalidadeNome.toLowerCase())
      : undefined

    // Fonte 2: events.modalities_config
    const formatoDoEvento = modalidadeNome
      ? eventModalities.find((m: any) => m.name?.toLowerCase() === modalidadeNome.toLowerCase())
      : undefined

    // Fonte 3: primeira modalidade ativa do evento (fallback para coreografias sem modalidade)
    const primeiraModalidade = eventModalities.find((m: any) => m.is_active !== false)

    // Prioridade: mod_fee → configuracoes → events.modalities_config → primeira modalidade → erro
    const valorInscricao: number =
      (coreo.mod_fee && coreo.mod_fee > 0)
        ? coreo.mod_fee
        : formatoEncontrado?.preco
        ?? formatoDoEvento?.fee
        ?? formatoDoEvento?.base_fee
        ?? primeiraModalidade?.fee
        ?? primeiraModalidade?.base_fee
        ?? 0

    const modalidadeUsada = modalidadeNome || primeiraModalidade?.name || 'padrão'

    console.log(`[create-payment] modalidade="${modalidadeUsada}" valor=${valorInscricao} (mod_fee=${coreo.mod_fee}, configuracoes=${formatoEncontrado?.preco}, eventModality=${formatoDoEvento?.fee ?? formatoDoEvento?.base_fee}, fallback=${primeiraModalidade?.fee ?? primeiraModalidade?.base_fee})`)

    if (valorInscricao <= 0) {
      throw new Error(
        `Valor não configurado para a modalidade "${modalidadeUsada}". ` +
        `Configure os preços em Configurações do Evento.`
      )
    }

    // 5. Buscar o access_token do produtor
    const { data: producer, error: prodError } = await supabase
      .from('profiles')
      .select('mp_access_token, mp_user_id, full_name')
      .eq('id', event.created_by)
      .single()

    if (prodError || !producer) {
      throw new Error(`Produtor não encontrado: ${prodError?.message}`)
    }

    if (!producer.mp_access_token) {
      throw new Error(
        'O produtor ainda não conectou sua conta do Mercado Pago. ' +
        'Configure em Configurações → Pagamentos.'
      )
    }

    // 6. Calcular a comissão da plataforma
    const comissao = calcularComissao(
      valorInscricao,
      event.commission_type ?? 'percent',
      event.commission_percent ?? 10,
      event.commission_fixed ?? 0
    )

    const baseUrl = Deno.env.get('FRONTEND_URL') ?? 'http://localhost:3000'

    // 7. Criar a preferência de pagamento no Mercado Pago com split
    const preferenceBody = {
      items: [
        {
          id: registration_id,
          title: `Inscrição - ${coreo.nome ?? 'Coreografia'}`,
          description: `Evento: ${event.name} | Modalidade: ${modalidadeUsada}`,
          quantity: 1,
          unit_price: valorInscricao,
          currency_id: 'BRL',
        }
      ],
      payer: {
        name: inscritoProfile?.full_name ?? 'Inscrito',
        email: inscritoProfile?.email ?? '',
      },
      // marketplace_fee removido temporariamente — exige conexão OAuth do vendedor
      // marketplace_fee: comissao,
      back_urls: {
        success: `${baseUrl}/pagamento/sucesso?registration_id=${registration_id}`,
        failure: `${baseUrl}/pagamento/erro?registration_id=${registration_id}`,
        pending: `${baseUrl}/pagamento/pendente?registration_id=${registration_id}`,
      },
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
      external_reference: registration_id,
      metadata: {
        registration_id,
        event_id,
        producer_id: event.created_by,
        commission_amount: comissao,
        gross_amount: valorInscricao,
      }
    }

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${producer.mp_access_token}`,
      },
      body: JSON.stringify(preferenceBody),
    })

    const mpData = await mpResponse.json()

    if (!mpResponse.ok) {
      console.error('Erro Mercado Pago:', mpData)
      throw new Error(`Erro Mercado Pago: ${mpData.message ?? JSON.stringify(mpData)}`)
    }

    // 8. Atualizar a coreografia com o preference_id e URL de pagamento
    await supabase
      .from('coreografias')
      .update({
        payment_preference_id: mpData.id,
        payment_url: mpData.init_point,
        status_pagamento: 'PENDENTE',
      })
      .eq('id', registration_id)

    return new Response(
      JSON.stringify({
        preference_id:       mpData.id,
        init_point:          mpData.init_point,
        sandbox_init_point:  mpData.sandbox_init_point,
        commission_amount:   comissao,
        gross_amount:        valorInscricao,
        net_amount:          parseFloat((valorInscricao - comissao).toFixed(2)),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Erro em create-payment:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
