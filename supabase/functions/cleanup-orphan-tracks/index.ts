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
    // Apenas autenticação por service role — função é chamada via cron, não user-facing.
    const authHeader = req.headers.get('Authorization') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    if (!authHeader.includes(serviceKey) && !authHeader.includes(Deno.env.get('CRON_SECRET') ?? 'cron-secret-not-set')) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceKey,
    )

    // 1) Lista paths em uso (registrations.trilha_url que NÃO começam com http)
    const { data: regs, error: regErr } = await supabase
      .from('registrations')
      .select('trilha_url')
      .not('trilha_url', 'is', null)
    if (regErr) throw new Error('Erro ao listar registrations: ' + regErr.message)

    const inUse = new Set<string>(
      (regs ?? [])
        .map(r => r.trilha_url)
        .filter((u: string | null): u is string => !!u && !u.startsWith('http'))
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
