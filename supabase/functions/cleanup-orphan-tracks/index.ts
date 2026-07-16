/**
 * Cleanup de trilhas órfãs no bucket 'trilhas'.
 *
 * Quando um inscrito faz upload mas abandona o wizard sem completar a inscrição,
 * o arquivo fica no storage sem referência em registrations.trilha_url. Mesmo
 * pattern ao trocar trilha múltiplas vezes — embora handleTrilhaUpload tente
 * remover o antigo, falhas de rede deixam arquivos pendurados.
 *
 * Esta função:
 *   1. Lista todos os arquivos do bucket 'trilhas' (recursivo por pasta de user)
 *   2. Pra cada arquivo, checa se alguma registration aponta pra ele
 *   3. Se NÃO há referência E o arquivo tem >24h de idade, deleta
 *
 * Agendamento recomendado: pg_cron diário às 03:00 BRT (06:00 UTC).
 *   SELECT cron.schedule('cleanup-orphan-tracks-daily', '0 6 * * *',
 *     $$ SELECT net.http_post(
 *       url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/cleanup-orphan-tracks',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))
 *     ); $$);
 *
 * OU executar manualmente via cURL pra testar:
 *   curl -X POST https://...supabase.co/functions/v1/cleanup-orphan-tracks \
 *     -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MIN_AGE_HOURS = 24 // arquivos com menos de 24h são preservados (uploads em andamento)

Deno.serve(async (req) => {
  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

    // Gate: decodifica o JWT e checa o claim "role" — NÃO comparar string
    // com a env var (anti-padrão documentado, lição feedback_jwt_role_check).
    // A Supabase platform já valida assinatura/expiração antes da function
    // rodar (verify_jwt=true default); aqui só garantimos que não é JWT de
    // usuário comum disparando o cleanup. Função é chamada só via cron.
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
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
      return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceKey,
    )

    // 1) Lista paths em uso (registrations.trilha_url).
    //
    // BUG REAL 2026-07-15: essa checagem excluía qualquer trilha_url em
    // formato de URL completa (`!u.startsWith('http')`) — mas 100% das
    // trilha_url salvas no banco são URLs completas (getPublicUrl), não
    // paths relativos. Ou seja, essa checagem NUNCA reconheceu nenhuma
    // trilha como "em uso", pra nenhum evento, desde que essa function
    // existe. Rodada manual em produção apagou 36 trilhas reais do
    // Usualdance Festival (coreografias com status_trilha='ENVIADA' de
    // verdade) antes de alguém notar. Fix: extrai o path de dentro da URL
    // completa em vez de descartá-la.
    const { data: regs, error: regErr } = await supabase
      .from('registrations')
      .select('trilha_url')
      .not('trilha_url', 'is', null)
    if (regErr) throw new Error('Erro ao listar registrations: ' + regErr.message)

    const inUse = new Set<string>(
      (regs ?? [])
        .map(r => r.trilha_url)
        .filter((u: string | null): u is string => !!u)
        .map(u => (u.startsWith('http') ? (u.split('/trilhas/')[1] ?? '') : u))
        .filter(p => p.length > 0)
    )

    // 2) Lista todas as "pastas" (cada pasta = userId) do bucket
    const { data: rootFolders, error: rootErr } = await supabase.storage
      .from('trilhas')
      .list('', { limit: 1000, offset: 0 })
    if (rootErr) throw new Error('Erro ao listar bucket: ' + rootErr.message)

    const cutoff = Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000
    const toDelete: string[] = []
    let scanned = 0

    // 3) Pra cada pasta-user, lista arquivos e marca órfãos antigos pra deletar
    for (const folder of rootFolders ?? []) {
      if (!folder.name || folder.id) continue // folder = entry sem id; arquivo direto = ignora
      const { data: files } = await supabase.storage
        .from('trilhas')
        .list(folder.name, { limit: 1000, offset: 0 })
      for (const f of files ?? []) {
        if (!f.name) continue
        const path = `${folder.name}/${f.name}`
        scanned++
        if (inUse.has(path)) continue
        const created = f.created_at ? new Date(f.created_at).getTime() : 0
        if (created && created < cutoff) toDelete.push(path)
      }
    }

    // 4) Deleta em batch (Supabase aceita até 1000 paths por request)
    let deleted = 0
    if (toDelete.length > 0) {
      const { data: removed, error: rmErr } = await supabase.storage
        .from('trilhas')
        .remove(toDelete)
      if (rmErr) console.error('[cleanup-orphan-tracks] erro ao deletar:', rmErr)
      deleted = removed?.length ?? toDelete.length
    }

    console.log(`[cleanup-orphan-tracks] scanned=${scanned} orphaned=${toDelete.length} deleted=${deleted}`)

    return new Response(
      JSON.stringify({ success: true, scanned, deleted, in_use: inUse.size }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[cleanup-orphan-tracks] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
