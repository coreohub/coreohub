// Cron diário — cria a transferência interna (Asaas-a-Asaas, gratuita) pra
// itens de baixo valor que a Asaas não aceitou dar split (comissão abaixo da
// margem mínima do split, ver create-payment-asaas ── 6a), e reconcilia o
// status das transferências já criadas mas ainda pendentes de aprovação
// manual no app da Asaas (toda transferência via API sai como
// PENDING/authorized:false — confirmado 2026-09-16, não existe hoje um
// jeito de pular a aprovação manual sem configurar "Validação de saque via
// Webhook", que não foi implementado por decisão de produto: volume baixo
// não justifica o endpoint novo que autoriza saque sozinho).
//
// Fluxo por linha de low_value_transfers:
//   aguardando_janela  (safety_release_at <= NOW) → chama /transfers,
//                        marca transferencia_pedida
//   transferencia_pedida → confere GET /transfers/{id}, marca transferido
//                        quando status vira DONE
//
// A aprovação em si (digitar o código no app da Asaas) continua manual —
// esse cron só prepara a transferência e reconcilia o resultado depois que
// alguém aprova.
//
// Trigger: pg_cron diário, mesmo horário do daily-release-funds:
//   SELECT cron.schedule('release-low-value-transfers', '0 3 * * *',
//     $$SELECT net.http_post(url:='https://<proj>.supabase.co/functions/v1/release-low-value-transfers',
//       headers:='{"Authorization":"Bearer <service-role>"}'::jsonb)$$);

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { transferToWallet, getTransferStatus } from '../_shared/asaas-payouts.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl        = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey         = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const asaasBaseUrl       = Deno.env.get('ASAAS_BASE_URL') ?? ''
  const transferApiKey     = Deno.env.get('ASAAS_TRANSFER_API_KEY') ?? ''
  if (!supabaseUrl || !serviceKey || !asaasBaseUrl) {
    console.error('[release-low-value-transfers] env faltando')
    return jsonResp({ status: 'error', reason: 'misconfigured' }, 500)
  }

  // Mesmo gate de daily-release-funds — decode JWT, checa role=service_role.
  // Nunca comparar string com env (feedback_jwt_role_check).
  const auth  = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let jwtRole = ''
  try {
    const payloadB64 = token.split('.')[1] ?? ''
    if (payloadB64) {
      const base64  = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
      const padded  = base64 + '='.repeat((4 - base64.length % 4) % 4)
      const payload = JSON.parse(atob(padded))
      jwtRole = String(payload?.role ?? '')
    }
  } catch { /* JWT malformado — cai no 401 abaixo */ }
  if (jwtRole !== 'service_role') {
    return jsonResp({ status: 'error', reason: 'unauthorized', detail: 'service_role required' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    let created = 0
    let reconciled = 0
    let skipped = 0

    // ── 1) Reconcilia transferências já pedidas (pode ter sido aprovada
    //       manualmente desde o último ciclo) ────────────────────────────
    const { data: pending, error: pendErr } = await supabase
      .from('low_value_transfers')
      .select('id, asaas_transfer_id')
      .eq('status', 'transferencia_pedida')
      .not('asaas_transfer_id', 'is', null)

    if (pendErr) {
      console.error('[release-low-value-transfers] erro query pending:', pendErr.message)
    } else if (pending && pending.length > 0) {
      if (!transferApiKey) {
        console.warn('[release-low-value-transfers] ASAAS_TRANSFER_API_KEY ausente — pulando reconciliação')
      } else {
        for (const row of pending) {
          const check = await getTransferStatus({
            transferApiKey, asaasBaseUrl, transferId: row.asaas_transfer_id as string,
          })
          if (!check.ok) {
            console.warn(`[release-low-value-transfers] falha ao checar transfer=${row.asaas_transfer_id}: ${check.error}`)
            continue
          }
          if (check.status === 'DONE') {
            await supabase
              .from('low_value_transfers')
              .update({ status: 'transferido', transferred_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq('id', row.id)
            reconciled++
            console.log(`[release-low-value-transfers] reconciliado id=${row.id} transfer=${row.asaas_transfer_id} → transferido`)
          }
          // PENDING/authorized:false continua aguardando aprovação manual —
          // nada a fazer, próximo ciclo confere de novo.
        }
      }
    }

    // ── 2) Cria transferência pra linhas que já passaram da janela ──────
    const { data: ready, error: readyErr } = await supabase
      .from('low_value_transfers')
      .select('id, value, producer_wallet_id, registration_id')
      .eq('status', 'aguardando_janela')
      .lte('safety_release_at', new Date().toISOString())

    if (readyErr) {
      console.error('[release-low-value-transfers] erro query ready:', readyErr.message)
      return jsonResp({ status: 'error', reason: 'query_failed', error: readyErr.message }, 500)
    }

    if (ready && ready.length > 0) {
      if (!transferApiKey) {
        console.warn(`[release-low-value-transfers] ASAAS_TRANSFER_API_KEY ausente — ${ready.length} transferências pendentes de config`)
      } else {
        for (const row of ready) {
          const result = await transferToWallet({
            transferApiKey,
            asaasBaseUrl,
            walletId:    row.producer_wallet_id as string,
            value:       Number(row.value),
            description: `CoreoHub — repasse integral (inscrição ${row.registration_id})`,
          })

          if (result.ok) {
            await supabase
              .from('low_value_transfers')
              .update({
                status:            'transferencia_pedida',
                asaas_transfer_id: result.transferId ?? null,
                updated_at:        new Date().toISOString(),
              })
              .eq('id', row.id)
            created++
            console.log(
              `[release-low-value-transfers] transferência pedida id=${row.id} valor=R$${row.value}` +
              ` transfer=${result.transferId} authorized=${result.authorized}` +
              (result.authorized ? '' : ' (aguardando aprovação manual no app Asaas)')
            )
          } else {
            skipped++
            console.error(`[release-low-value-transfers] falha ao criar transferência id=${row.id}: ${result.error}`)
          }
        }
      }
    }

    console.log(`[release-low-value-transfers] FIM | criadas=${created} reconciliadas=${reconciled} falhas=${skipped}`)
    return jsonResp({ status: 'ok', created, reconciled, skipped })
  } catch (e) {
    console.error('[release-low-value-transfers] exception:', (e as Error).message)
    return jsonResp({ status: 'error', reason: 'exception', error: (e as Error).message }, 500)
  }
})

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
