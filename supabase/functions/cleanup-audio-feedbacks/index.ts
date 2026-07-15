/**
 * Cleanup de áudio de feedback do jurado — retenção de 12 meses.
 *
 * A migration 20260501_audio_retention_cleanup.sql já cria a RPC
 * `cleanup_old_audio_feedbacks()`: ela zera `evaluations.audio_url` pra
 * evaluations de eventos com +12 meses e devolve os paths que ficaram órfãos
 * (`freed_paths`) — mas nunca apagava o arquivo físico do bucket
 * 'audio-feedbacks' (a função SQL não tem permissão de Storage). Essa edge
 * function fecha esse ciclo: chama a RPC e apaga de fato os arquivos.
 *
 * Agendamento recomendado: pg_cron semanal, domingo às 03:00 BRT (06:00 UTC).
 *   SELECT cron.schedule('cleanup-audio-feedbacks-weekly', '0 6 * * 0',
 *     $$ SELECT net.http_post(
 *       url := 'https://ghpltzzijlvykiytwslu.supabase.co/functions/v1/cleanup-audio-feedbacks',
 *       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
 *     ); $$);
 *
 * OU executar manualmente via cURL pra testar:
 *   curl -X POST https://...supabase.co/functions/v1/cleanup-audio-feedbacks \
 *     -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'server_misconfigured' }), { status: 500 })
    }

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

    const supabase = createClient(supabaseUrl, serviceKey)

    // 1) RPC já existente: zera audio_url no banco pra evaluations de eventos
    //    com +12 meses, devolve os paths que ficaram órfãos.
    const { data, error: rpcErr } = await supabase.rpc('cleanup_old_audio_feedbacks')
    if (rpcErr) throw new Error('Erro na RPC cleanup_old_audio_feedbacks: ' + rpcErr.message)

    const row = Array.isArray(data) ? data[0] : data
    const freedPaths: string[] = Array.isArray(row?.freed_paths) ? row.freed_paths : []

    if (freedPaths.length === 0) {
      return new Response(
        JSON.stringify({ success: true, deleted_count: 0, storage_deleted: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 2) audio_url salvo é a URL pública completa — extrai só o path pra
    //    passar em storage.remove() (mesmo padrão do fix em generate-narration).
    const paths = freedPaths
      .map(url => url.split('/audio-feedbacks/')[1])
      .filter((p): p is string => !!p)

    let storageDeleted = 0
    if (paths.length > 0) {
      const { data: removed, error: rmErr } = await supabase.storage
        .from('audio-feedbacks')
        .remove(paths)
      if (rmErr) console.error('[cleanup-audio-feedbacks] erro ao deletar do storage:', rmErr)
      storageDeleted = removed?.length ?? paths.length
    }

    console.log(`[cleanup-audio-feedbacks] db_cleared=${row?.deleted_count ?? 0} storage_deleted=${storageDeleted}`)

    return new Response(
      JSON.stringify({
        success: true,
        deleted_count: row?.deleted_count ?? 0,
        storage_deleted: storageDeleted,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[cleanup-audio-feedbacks] erro:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
