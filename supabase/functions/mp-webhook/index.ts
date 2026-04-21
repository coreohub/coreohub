import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mapeamento dos status do Mercado Pago para o status interno da plataforma.
// Mantemos "APROVADO" para casar com o valor que o create-payment já usa.
const STATUS_MAP: Record<string, string> = {
  approved:     'APROVADO',
  pending:      'PENDENTE',
  in_process:   'PENDENTE',
  authorized:   'PENDENTE',
  rejected:     'RECUSADO',
  cancelled:    'CANCELADO',
  refunded:     'ESTORNADO',
  charged_back: 'ESTORNADO',
}

function calcularComissao(
  valorBruto: number,
  tipo: string,
  percentual: number,
  fixo: number
): number {
  switch (tipo) {
    case 'percent':  return parseFloat((valorBruto * (percentual / 100)).toFixed(2))
    case 'fixed':    return fixo
    case 'combined': return parseFloat(((valorBruto * (percentual / 100)) + fixo).toFixed(2))
    default:         return parseFloat((valorBruto * 0.10).toFixed(2))
  }
}

/**
 * Dispara um email transacional chamando a Edge Function `send-email`.
 * Nunca lança — logs em caso de falha, mas o webhook não deve quebrar
 * só porque o Resend está fora do ar.
 */
async function dispararEmail(
  type: 'payment_confirmed_registrant' | 'payment_confirmed_producer',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) {
      console.warn('[mp-webhook] SUPABASE_URL/SERVICE_ROLE_KEY ausentes — pulando email')
      return
    }

    const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type, payload }),
    })

    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      console.error(`[mp-webhook] send-email falhou (${resp.status}) type=${type}:`, data)
    } else {
      console.log(`[mp-webhook] email enviado type=${type} id=${data?.id ?? '?'}`)
    }
  } catch (e) {
    console.error(`[mp-webhook] exception ao chamar send-email type=${type}:`, (e as Error).message)
  }
}

/**
 * Extrai o ID do pagamento do payload do MP.
 * O MP envia em formatos diferentes dependendo do tipo de notificação:
 *  1. Notification v1 (antiga IPN):     ?id=123&topic=payment          (query string)
 *  2. Webhooks v2 (action-based):       { action: "payment.updated", data: { id: "123" } }
 *  3. Notification legada (type-based): { type: "payment", data: { id: "123" } }
 */
function extrairPaymentId(url: URL, body: any): { id: string | null; kind: string } {
  // Formato 1: query string
  const topic = url.searchParams.get('topic') ?? url.searchParams.get('type')
  const queryId = url.searchParams.get('id') ?? url.searchParams.get('data.id')
  if (queryId && (topic === 'payment' || !topic)) {
    return { id: queryId, kind: 'query' }
  }

  // Formato 2 e 3: body JSON
  const action: string | undefined = body?.action
  const type: string | undefined = body?.type
  const dataId: string | undefined = body?.data?.id

  const ehPagamento =
    action?.startsWith('payment.') ||
    type === 'payment' ||
    topic === 'payment'

  if (ehPagamento && dataId) {
    return { id: String(dataId), kind: 'body' }
  }

  return { id: null, kind: 'unknown' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // O MP pode retransmitir webhooks — sempre respondemos 200 para evitar flood.
  const ok = (payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const url = new URL(req.url)

    // Body pode vir vazio (IPN antigo) — precisa ser tolerante.
    let body: any = {}
    try {
      const raw = await req.text()
      if (raw) body = JSON.parse(raw)
    } catch {
      body = {}
    }

    console.log('[mp-webhook] query:', Object.fromEntries(url.searchParams))
    console.log('[mp-webhook] body:', JSON.stringify(body))

    const { id: paymentId, kind } = extrairPaymentId(url, body)

    if (!paymentId) {
      console.log('[mp-webhook] notificação sem paymentId, ignorando')
      return ok({ status: 'ignored', reason: 'no_payment_id' })
    }

    console.log(`[mp-webhook] paymentId=${paymentId} (origem=${kind})`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ─── 1. Idempotência: se já processamos este paymentId, encerra. ─────────
    const { data: comissaoExistente } = await supabase
      .from('platform_commissions')
      .select('id')
      .eq('mp_payment_id', String(paymentId))
      .maybeSingle()

    if (comissaoExistente) {
      console.log(`[mp-webhook] paymentId=${paymentId} já processado, ignorando`)
      return ok({ status: 'already_processed' })
    }

    // ─── 2. Descobrir o access_token do produtor ─────────────────────────────
    // Precisamos consultar a API do MP para saber external_reference e status.
    // O token correto é o do produtor que recebeu o pagamento.
    // Como o MP não diz "qual produtor" na notificação (só manda o payment_id),
    // tentamos 2 estratégias em ordem:
    //   a) Para cada produtor com mp_access_token, tentamos consultar o pagamento
    //      e o primeiro que autorizar é o dono do pagamento.
    //   b) Se só há um produtor configurado, usa direto.
    const { data: produtores, error: prodErr } = await supabase
      .from('profiles')
      .select('id, mp_access_token, mp_user_id')
      .not('mp_access_token', 'is', null)

    if (prodErr || !produtores || produtores.length === 0) {
      console.error('[mp-webhook] nenhum produtor com MP configurado')
      return ok({ status: 'error', reason: 'no_producer' })
    }

    let payment: any = null
    let tokenUsado: string | null = null
    let produtorId: string | null = null

    for (const p of produtores) {
      if (!p.mp_access_token) continue
      try {
        const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${p.mp_access_token}` },
        })
        if (resp.ok) {
          payment = await resp.json()
          tokenUsado = p.mp_access_token
          produtorId = p.id
          console.log(`[mp-webhook] pagamento encontrado na conta do produtor ${p.id}`)
          break
        }
      } catch (e) {
        console.warn(`[mp-webhook] falha ao consultar com produtor ${p.id}:`, (e as Error).message)
      }
    }

    if (!payment || !tokenUsado) {
      console.error(`[mp-webhook] paymentId=${paymentId} não foi encontrado em nenhum produtor`)
      return ok({ status: 'error', reason: 'payment_not_found' })
    }

    // ─── 3. Extrair dados do pagamento ───────────────────────────────────────
    const registrationId: string | undefined = payment.external_reference
    if (!registrationId) {
      console.error('[mp-webhook] external_reference vazio')
      return ok({ status: 'error', reason: 'no_external_reference' })
    }

    const statusInterno = STATUS_MAP[payment.status] ?? 'PENDENTE'
    console.log(
      `[mp-webhook] paymentId=${paymentId} mp_status=${payment.status} → ${statusInterno} | registration=${registrationId}`
    )

    // ─── 4. Atualizar a coreografia ──────────────────────────────────────────
    const { error: updErr } = await supabase
      .from('coreografias')
      .update({
        status_pagamento: statusInterno,
        payment_id: String(paymentId),
        payment_method: payment.payment_type_id ?? null,
      })
      .eq('id', registrationId)

    if (updErr) {
      console.error('[mp-webhook] erro ao atualizar coreografia:', updErr.message)
      // Segue o fluxo mesmo assim — pode ser que a tabela legada "registrations" ainda exista.
    }

    // Fallback: se a base antiga usava "registrations", atualiza também (não falha se a tabela não existir).
    try {
      await supabase
        .from('registrations')
        .update({
          status_pagamento: statusInterno,
          payment_id: String(paymentId),
          payment_method: payment.payment_type_id ?? null,
          ...(statusInterno === 'APROVADO' ? { status: 'APROVADA' } : {}),
        })
        .eq('id', registrationId)
    } catch (e) {
      // Silencioso — tabela pode não existir.
    }

    // ─── 5. Se aprovado, registrar comissão da plataforma + emails ──────────
    if (payment.status === 'approved') {
      const { data: coreo } = await supabase
        .from('coreografias')
        .select('event_id, user_id, nome, modalidade, tipo_apresentacao')
        .eq('id', registrationId)
        .single()

      const eventId = coreo?.event_id ?? null

      let eventData: any = null
      if (eventId) {
        const { data } = await supabase
          .from('events')
          .select('created_by, name, location, event_date, commission_type, commission_percent, commission_fixed')
          .eq('id', eventId)
          .single()
        eventData = data
      }

      const grossAmount = Number(payment.transaction_amount ?? 0)
      // marketplace_fee vem do MP se o split estiver via OAuth; hoje está desligado
      // então calculamos manualmente a partir do evento.
      const feeAmount =
        Number(payment.marketplace_fee ?? 0) ||
        calcularComissao(
          grossAmount,
          eventData?.commission_type ?? 'percent',
          Number(eventData?.commission_percent ?? 10),
          Number(eventData?.commission_fixed ?? 0)
        )
      const netAmount = parseFloat((grossAmount - feeAmount).toFixed(2))

      const { error: insErr } = await supabase
        .from('platform_commissions')
        .insert({
          registration_id: registrationId,
          event_id: eventId,
          producer_id: eventData?.created_by ?? produtorId,
          gross_amount: grossAmount,
          commission_amount: feeAmount,
          net_amount: netAmount,
          mp_payment_id: String(paymentId),
          commission_type: eventData?.commission_type ?? 'percent',
        })

      if (insErr) {
        console.error('[mp-webhook] erro ao inserir comissão:', insErr.message)
      } else {
        console.log(
          `[mp-webhook] APROVADO | bruto=R$${grossAmount} comissao=R$${feeAmount} liquido=R$${netAmount}`
        )
      }

      // ─── 6. Disparo de emails transacionais ────────────────────────────
      // Falhas aqui são silenciosas — não quebram o webhook nem o MP retentará.
      // O usuário sempre pode conferir o status em /minhas-coreografias.
      try {
        const [{ data: inscritoProfile }, produtorProfileRes] = await Promise.all([
          coreo?.user_id
            ? supabase
                .from('profiles')
                .select('full_name, email')
                .eq('id', coreo.user_id)
                .maybeSingle()
            : Promise.resolve({ data: null } as any),
          eventData?.created_by
            ? supabase
                .from('profiles')
                .select('full_name, email')
                .eq('id', eventData.created_by)
                .maybeSingle()
            : Promise.resolve({ data: null } as any),
        ])

        const produtorProfile: any = (produtorProfileRes as any)?.data ?? null
        const appUrl = Deno.env.get('FRONTEND_URL') ?? 'https://dancepro.com'
        const modalidade = coreo?.tipo_apresentacao ?? coreo?.modalidade ?? null
        const eventoData = eventData?.event_date
          ? new Date(eventData.event_date).toLocaleDateString('pt-BR', {
              day: '2-digit', month: 'long', year: 'numeric',
            })
          : null

        const emailJobs: Promise<void>[] = []

        if (inscritoProfile?.email) {
          emailJobs.push(
            dispararEmail('payment_confirmed_registrant', {
              inscritoNome: inscritoProfile.full_name,
              inscritoEmail: inscritoProfile.email,
              coreoNome: coreo?.nome,
              modalidade,
              eventoNome: eventData?.name,
              eventoLocal: eventData?.location,
              eventoData,
              valorPago: grossAmount,
              appUrl,
            })
          )
        } else {
          console.warn('[mp-webhook] inscrito sem email cadastrado, pulando notificação')
        }

        if (produtorProfile?.email) {
          emailJobs.push(
            dispararEmail('payment_confirmed_producer', {
              produtorNome: produtorProfile.full_name,
              produtorEmail: produtorProfile.email,
              coreoNome: coreo?.nome,
              modalidade,
              inscritoNome: inscritoProfile?.full_name,
              inscritoEmail: inscritoProfile?.email,
              eventoNome: eventData?.name,
              valorBruto: grossAmount,
              comissao: feeAmount,
              valorLiquido: netAmount,
              appUrl,
            })
          )
        } else {
          console.warn('[mp-webhook] produtor sem email cadastrado, pulando notificação')
        }

        await Promise.all(emailJobs)
      } catch (emailErr) {
        console.error('[mp-webhook] falha no bloco de emails:', (emailErr as Error).message)
      }
    }

    return ok({
      status: 'ok',
      payment_status: payment.status,
      internal_status: statusInterno,
      registration_id: registrationId,
    })
  } catch (error: any) {
    console.error('[mp-webhook] erro inesperado:', error?.message ?? error)
    // Sempre 200 para o MP não ficar reenviando eternamente.
    return new Response(
      JSON.stringify({ status: 'error', message: error?.message ?? 'unknown' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
