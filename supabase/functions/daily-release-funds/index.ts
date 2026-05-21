// Cron diário (00:00 BRT / 03:00 UTC) — libera o saldo retido na subconta
// dos produtores cujas comissões já passaram da janela D+7.
//
// Settlement period D+7 — substitui o auto-saque imediato do webhook.
// Para cada produtor com platform_commissions elegíveis (release_at <= NOW()
// AND released_at IS NULL), agrega o net_amount total e dispara 1
// transferência PIX da subconta do produtor pra chave dele.
//
// Best-effort: falha de 1 produtor NUNCA bloqueia os demais. Comissões
// que falham (sem saldo, sem PIX, KYC pendente) ficam pra próximo ciclo.
//
// Trigger: pg_cron `SELECT cron.schedule('daily-release-funds', '0 3 * * *',
//   $$SELECT net.http_post(url:='https://<proj>.supabase.co/functions/v1/daily-release-funds',
//     headers:='{"Authorization":"Bearer <service-role>"}'::jsonb)$$);`
// Manual run pra debug: POST direto com service-role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sweepProducerBalance } from '../_shared/asaas-payouts.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ProducerBucket {
  producerId:    string
  apiKey:        string | null
  pixKey:        string | null
  fullName:      string
  email:         string | null
  totalAmount:   number
  commissionIds: string[]
}

/** Mascara PIX key mostrando só os últimos 4 chars. Cobre todos os formatos
 *  (CPF, CNPJ, email, telefone, chave aleatória) sem expor o dado completo
 *  no email transacional. Pode rodar sem alocar — só slice. */
function maskPixKey(pix: string | null | undefined): string | undefined {
  if (!pix) return undefined
  const trimmed = String(pix).trim()
  if (trimmed.length <= 4) return trimmed
  return trimmed.slice(-4)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const asaasBaseUrl = Deno.env.get('ASAAS_BASE_URL') ?? ''
  if (!supabaseUrl || !serviceKey || !asaasBaseUrl) {
    console.error('[daily-release-funds] env faltando')
    return jsonResp({ status: 'error', reason: 'misconfigured' }, 500)
  }

  // Gate: aceita qualquer JWT com role=service_role no payload. A Supabase
  // platform já valida assinatura/expiração antes da function rodar
  // (verify_jwt=true default), então aqui só checamos o claim "role" pra
  // garantir que não é JWT de inscrito autenticado disparando o cron.
  // Robusto a rotação da service_role key (não compara string com env).
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let jwtRole = ''
  try {
    const payloadB64 = token.split('.')[1] ?? ''
    if (payloadB64) {
      const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
      const payload = JSON.parse(atob(padded))
      jwtRole = String(payload?.role ?? '')
    }
  } catch { /* JWT malformado — cai no 401 abaixo */ }
  if (jwtRole !== 'service_role') {
    return jsonResp({ status: 'error', reason: 'unauthorized', detail: 'service_role required' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    // Pega TODAS as comissões elegíveis. Join manual com profiles em batch
    // pra evitar N queries.
    //
    // Filtra `refunded_at IS NULL` pra ignorar comissões totalmente
    // estornadas — sem isso, cron tentaria sweep de valor que não está mais
    // na subconta Asaas e ficaria em loop com insufficient_balance.
    const { data: commissions, error: cErr } = await supabase
      .from('platform_commissions')
      .select('id, producer_id, net_amount, refund_amount, release_at, asaas_payment_id, kind')
      .lte('release_at', new Date().toISOString())
      .is('released_at', null)
      .is('refunded_at', null)
      .not('producer_id', 'is', null)
      .gt('net_amount', 0)

    if (cErr) {
      console.error('[daily-release-funds] erro query commissions:', cErr.message)
      return jsonResp({ status: 'error', reason: 'query_failed', error: cErr.message }, 500)
    }
    if (!commissions || commissions.length === 0) {
      console.log('[daily-release-funds] nenhuma comissão elegível')
      return jsonResp({ status: 'ok', released: 0, producers: 0 })
    }

    // Agrupa por producer_id
    const buckets = new Map<string, ProducerBucket>()
    const producerIds = new Set<string>()
    for (const c of commissions) {
      producerIds.add(c.producer_id as string)
    }

    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, asaas_api_key, pix_key, full_name, email')
      .in('id', Array.from(producerIds))
    if (pErr) {
      console.error('[daily-release-funds] erro query profiles:', pErr.message)
      return jsonResp({ status: 'error', reason: 'profiles_query_failed' }, 500)
    }
    const profileById = new Map<string, any>((profiles ?? []).map((p: any) => [p.id, p]))

    for (const c of commissions) {
      const pid = c.producer_id as string
      const prof = profileById.get(pid)
      if (!buckets.has(pid)) {
        buckets.set(pid, {
          producerId:    pid,
          apiKey:        prof?.asaas_api_key ?? null,
          pixKey:        prof?.pix_key ?? null,
          fullName:      prof?.full_name ?? '?',
          email:         prof?.email ?? null,
          totalAmount:   0,
          commissionIds: [],
        })
      }
      const b = buckets.get(pid)!
      // Subtrai refund parcial (refund total foi filtrado na query). Em refund
      // parcial a comissão segue elegível pela diferença, não pelo bruto.
      const net = Number(c.net_amount ?? 0) - Number(c.refund_amount ?? 0)
      if (net <= 0) continue
      b.totalAmount += net
      b.commissionIds.push(c.id as string)
    }

    let producersOk = 0
    let producersSkip = 0
    let totalReleased = 0

    for (const bucket of buckets.values()) {
      const totalRounded = parseFloat(bucket.totalAmount.toFixed(2))
      if (!bucket.apiKey || !bucket.pixKey) {
        console.warn(`[daily-release-funds] produtor=${bucket.producerId} (${bucket.fullName}) sem api_key/pix — skip (${bucket.commissionIds.length} comissões R$${totalRounded})`)
        producersSkip++
        continue
      }

      const result = await sweepProducerBalance({
        producerApiKey: bucket.apiKey,
        producerPixKey: bucket.pixKey,
        asaasBaseUrl,
        description:    `CoreoHub — liberação automática D+7 (${bucket.commissionIds.length} comissões)`,
        amount:         totalRounded,
      })

      if (result.swept) {
        const nowIso = new Date().toISOString()
        const { error: updErr } = await supabase
          .from('platform_commissions')
          .update({
            released_at:         nowIso,
            released_amount:     result.value,
            release_transfer_id: result.transferId ?? null,
            released_manually:   false,
          })
          .in('id', bucket.commissionIds)
        if (updErr) {
          console.error(`[daily-release-funds] ERRO update produtor=${bucket.producerId}:`, updErr.message)
        }
        console.log(
          `[daily-release-funds] OK produtor=${bucket.producerId} (${bucket.fullName})` +
          ` valor=R$${result.value} commissions=${bucket.commissionIds.length} transfer=${result.transferId}`
        )
        producersOk++
        totalReleased += result.value

        // Notifica produtor por email — best-effort. Falha no email NUNCA reverte
        // o repasse (a transferência PIX já foi feita). Idempotência via
        // released_at — se o cron rodar 2x no mesmo dia, no segundo loop a query
        // não pega essas comissões e nenhum email duplicado sai.
        if (bucket.email) {
          try {
            const emailResp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${serviceKey}`,
                'Content-Type':  'application/json',
              },
              body: JSON.stringify({
                type: 'payout_released',
                payload: {
                  produtorNome:     bucket.fullName,
                  produtorEmail:    bucket.email,
                  releasedAmount:   result.value,
                  pixKeyPartial:    maskPixKey(bucket.pixKey),
                  commissionsCount: bucket.commissionIds.length,
                  appUrl:           'https://app.coreohub.com',
                },
              }),
            })
            if (!emailResp.ok) {
              const txt = await emailResp.text().catch(() => '')
              console.warn(`[daily-release-funds] email skip produtor=${bucket.producerId} status=${emailResp.status} body=${txt.slice(0, 200)}`)
            }
          } catch (e) {
            console.warn(`[daily-release-funds] email falhou produtor=${bucket.producerId}:`, (e as Error).message)
          }
        } else {
          console.warn(`[daily-release-funds] produtor=${bucket.producerId} sem email — skip notify`)
        }
      } else {
        console.warn(
          `[daily-release-funds] skip produtor=${bucket.producerId} (${bucket.fullName})` +
          ` reason=${result.reason} error=${result.error ?? ''}` +
          ` (${bucket.commissionIds.length} comissões pendentes R$${totalRounded})`
        )
        producersSkip++
        // Comissões NÃO são marcadas — entram no próximo ciclo. Asaas pode
        // estar retentando, KYC pode estar pendente, PIX inválido etc.
        // [ALERT] emitido se for falha técnica recorrente.
        const TECH_FAILS = new Set(['transfer_failed', 'pix_invalid', 'kyc_pending', 'exception'])
        if (result.reason && TECH_FAILS.has(result.reason)) {
          console.error(
            `[daily-release-funds][ALERT] produtor=${bucket.producerId} (${bucket.fullName})` +
            ` falha técnica reason=${result.reason} error=${result.error ?? ''}`
          )
        }
      }
    }

    console.log(
      `[daily-release-funds] FIM | produtores OK=${producersOk} skip=${producersSkip}` +
      ` total liberado=R$${totalReleased.toFixed(2)} comissões processadas=${commissions.length}`
    )
    return jsonResp({
      status:          'ok',
      producers_ok:    producersOk,
      producers_skip:  producersSkip,
      total_released:  parseFloat(totalReleased.toFixed(2)),
      commissions_seen: commissions.length,
    })
  } catch (e) {
    console.error('[daily-release-funds] exception:', (e as Error).message)
    return jsonResp({ status: 'error', reason: 'exception', error: (e as Error).message }, 500)
  }
})

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
