/**
 * Cleanup de narrações órfãs no bucket 'narrations'.
 *
 * generate-narration (ação "generate"/"generate-batch") cria um .wav novo a
 * cada regeneração (trocar voz, editar texto). Até 2026-07-15 o arquivo
 * antigo nunca era apagado do Storage — só a linha em narration_audios era
 * substituída. Esse fix parou a sangria pra frente (generate-narration/
 * index.ts agora apaga o antigo depois de confirmar o novo), mas os arquivos
 * órfãos que já se acumularam continuam lá. Essa função limpa esses.
 *
 * Diferente de cleanup-audio-feedbacks (retenção de 12 meses — regra de
 * negócio real), aqui não tem "guardar por um tempo": um .wav sem nenhuma
 * narration_audios apontando pra ele é sempre lixo puro, não serve pra nada.
 * Só a idade mínima de 24h protege upload em andamento (mesmo padrão do
 * cleanup-orphan-tracks).
 *
 * Esta função:
 *   1. Lista todos os arquivos do bucket 'narrations' (recursivo por pasta
 *      de event_id — fileName é `${event_id}/${registration_id}_${kind}_${ts}.wav`)
 *   2. Pra cada arquivo, checa se algum narration_audios.audio_url aponta pra ele
 *   3. Se NÃO há referência E o arquivo tem >24h de idade, deleta
 *
 * Agendamento recomendado: pg_cron diário às 03:00 BRT (06:00 UTC), junto
 * com cleanup-orphan-tracks.
 *   SELECT cron.schedule('cleanup-orphan-narrations-daily', '0 6 * * *',
 *     $$ SELECT net.http_post(
 *       url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/cleanup-orphan-narrations',
 *       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
 *     ); $$);
 *
 * OU executar manualmente via cURL pra testar:
 *   curl -X POST https://...supabase.co/functions/v1/cleanup-orphan-narrations \
 *     -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MIN_AGE_HOURS = 24 // arquivos com menos de 24h são preservados (geração em andamento)

Deno.serve(async (req) => {
  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

    // Gate: decodifica o JWT e checa o claim "role" — NÃO comparar string
    // com a env var (anti-padrão documentado, lição feedback_jwt_role_check).
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

    // 1) Lista paths em uso — narration_audios.audio_url é sempre a URL
    //    pública completa (.../storage/v1/object/public/narrations/<path>),
    //    diferente de registrations.trilha_url que às vezes já é o path cru.
    const { data: rows, error: rowsErr } = await supabase
      .from('narration_audios')
      .select('audio_url')
      .not('audio_url', 'is', null)
    if (rowsErr) throw new Error('Erro ao listar narration_audios: ' + rowsErr.message)

    const inUse = new Set<string>(
      (rows ?? [])
        .map(r => r.audio_url?.split('/narrations/')[1])
        .filter((p): p is string => !!p)
    )

    // 2) Lista todas as "pastas" (cada pasta = event_id) do bucket
    const { data: rootFolders, error: rootErr } = await supabase.storage
      .from('narrations')
      .list('', { limit: 1000, offset: 0 })
    if (rootErr) throw new Error('Erro ao listar bucket: ' + rootErr.message)

    const cutoff = Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000
    const toDelete: string[] = []
    let scanned = 0

    // 3) Pra cada pasta-evento, lista arquivos e marca órfãos antigos pra deletar
    for (const folder of rootFolders ?? []) {
      if (!folder.name || folder.id) continue // folder = entry sem id; arquivo direto = ignora
      const { data: files } = await supabase.storage
        .from('narrations')
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
        .from('narrations')
        .remove(toDelete)
      if (rmErr) console.error('[cleanup-orphan-narrations] erro ao deletar:', rmErr)
      deleted = removed?.length ?? toDelete.length
    }

    console.log(`[cleanup-orphan-narrations] scanned=${scanned} orphaned=${toDelete.length} deleted=${deleted}`)

    return new Response(
      JSON.stringify({ success: true, scanned, deleted, in_use: inUse.size }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[cleanup-orphan-narrations] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
