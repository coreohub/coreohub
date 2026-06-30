/**
 * Edge Function: get-certificate-pdf
 *
 * Etapa 2 — Modelo lazy-cache.
 *
 * Recebe certificate_id. Verifica permissão (producer dono OU inscrito vinculado).
 * Se já tem pdf_url cacheado → retorna signed URL imediato.
 * Se não → gera o PDF agora (pdf-lib + qrcode), faz upload pro bucket privado,
 * atualiza row, retorna signed URL.
 *
 * verify_jwt=true: precisa user logado pra autorizar acesso.
 *
 * Body POST JSON: { certificate_id: UUID }
 *
 * Resposta 200: { signed_url, expires_at, was_cached }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import { buildCorsHeaders } from '../_shared/cors.ts'

// ── Defaults pros 3 templates pré-prontos ──────────────────────────────────
type LayoutTag = {
  tag: string
  x_pct: number
  y_pct: number
  font_size: number
  align?: 'left' | 'center' | 'right'
  color?: string
  weight?: 'normal' | 'bold'
  italic?: boolean
}

// Layout default usado quando produtor não customizou (template_layout vazio)
const DEFAULT_LAYOUT_MOSTRA: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 50, y_pct: 80, font_size: 38, align: 'center', weight: 'bold', color: '#0b0b0f' },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 75, font_size: 14, align: 'center', color: '#ff0068' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 65, font_size: 16, align: 'center', italic: true, color: '#666' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 58, font_size: 32, align: 'center', weight: 'bold', color: '#0b0b0f' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 50, font_size: 13, align: 'center', color: '#666' },
  { tag: 'EVENTO',          x_pct: 50, y_pct: 42, font_size: 20, align: 'center', weight: 'bold', color: '#ff0068' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 37, font_size: 12, align: 'center', color: '#666' },
]
const DEFAULT_LAYOUT_WORKSHOP: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 50, y_pct: 80, font_size: 38, align: 'center', weight: 'bold', color: '#0b0b0f' },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 75, font_size: 14, align: 'center', color: '#ff0068' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 65, font_size: 16, align: 'center', italic: true, color: '#666' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 58, font_size: 32, align: 'center', weight: 'bold', color: '#0b0b0f' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 50, font_size: 13, align: 'center', color: '#666' },
  { tag: 'WORKSHOP_NOME',   x_pct: 50, y_pct: 42, font_size: 20, align: 'center', weight: 'bold', color: '#ff0068' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 37, font_size: 12, align: 'center', color: '#666' },
]

// Hex → rgb
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  if (h.length !== 6) return [0.04, 0.04, 0.06]
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

// Resolve valor de tag a partir de certificate_data + recipient_name + classificação
function resolveTag(tag: string, ctx: any): string {
  const data = ctx.data ?? {}
  const tags: Record<string, string | undefined> = {
    TITULO: ctx.template_type === 'workshop' ? 'CERTIFICADO' : 'CERTIFICADO',
    SUBTITULO: ctx.template_type === 'workshop' ? 'DE PARTICIPAÇÃO EM WORKSHOP' : 'DE PARTICIPAÇÃO',
    INTRO: 'Certificamos que',
    NOME_PARTICIPANTE: ctx.recipient_name,
    CORPO: ctx.template_type === 'workshop'
      ? `participou do workshop ministrado por ${data.professor_nome ?? '—'}, com duração de ${data.duracao_minutos ?? '—'} minutos, durante o evento`
      : (() => {
          // Avaliada não tem classificação/prêmio — texto adaptado.
          const isAvaliada = String(data.tipo_apresentacao ?? '').toLowerCase() === 'avaliada';
          if (isAvaliada) {
            return `participou com a apresentação "${data.coreografia ?? '—'}" na modalidade ${data.modalidade ?? '—'}, na Mostra Avaliada do evento`;
          }
          return `participou da apresentação "${data.coreografia ?? '—'}" na modalidade ${data.modalidade ?? '—'}${data.classificacao ? `, obtendo ${data.classificacao}` : ''}, durante o evento`;
        })(),
    EVENTO: data.evento_nome ?? '',
    WORKSHOP_NOME: data.workshop_nome ?? '',
    DATA_LOCAL: [
      data.evento_data ? new Date(String(data.evento_data) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : null,
      data.evento_local,
    ].filter(Boolean).join(' — '),
    NOME_GRUPO: ctx.recipient_name,
    COREOGRAFIA: data.coreografia ?? '',
    ESTUDIO: data.estudio ?? '',
    MODALIDADE: data.modalidade ?? '',
    CATEGORIA: data.categoria ?? '',
    FORMATO: data.formato ?? '',
    CLASSIFICACAO: data.classificacao ?? '',
    PROFESSOR: data.professor_nome ?? '',
    DURACAO: data.duracao_minutos ? `${data.duracao_minutos} min` : '',
    DATA_EVENTO: data.evento_data ? new Date(String(data.evento_data) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '',
    LOCAL_EVENTO: data.evento_local ?? '',
    HASH_VALIDACAO: ctx.hash?.slice(0, 8).toUpperCase() ?? '',
    // Pra templates customizados que querem mencionar explicitamente.
    // Mostra Competitiva, Mostra Avaliada, etc. (capitaliza primeira letra).
    TIPO_APRESENTACAO: (() => {
      const t = data.tipo_apresentacao;
      if (!t) return '';
      return `Mostra ${String(t).charAt(0).toUpperCase()}${String(t).slice(1).toLowerCase()}`;
    })(),
  }
  return tags[tag] ?? ''
}

async function generatePdf(ctx: {
  template_type: 'mostra' | 'workshop'
  template: any
  recipient_name: string
  data: any
  hash: string
  validation_url: string
}): Promise<Uint8Array> {
  const layout: LayoutTag[] = (ctx.template?.layout_json && Array.isArray(ctx.template.layout_json) && ctx.template.layout_json.length > 0)
    ? ctx.template.layout_json
    : (ctx.template_type === 'workshop' ? DEFAULT_LAYOUT_WORKSHOP : DEFAULT_LAYOUT_MOSTRA)

  const accent = ctx.template?.accent_color ?? '#ff0068'

  // QR code
  const qrDataUrl = await QRCode.toDataURL(ctx.validation_url, {
    errorCorrectionLevel: 'M', width: 256, margin: 1,
    color: { dark: '#0b0b0f', light: '#ffffff' },
  })
  const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), c => c.charCodeAt(0))

  // PDF A4 landscape
  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle(`Certificado — ${ctx.recipient_name}`)
  pdfDoc.setAuthor('CoreoHub')
  pdfDoc.setProducer('CoreoHub Platform')

  const page = pdfDoc.addPage([842, 595])
  const W = 842, H = 595

  const helvetica       = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const timesItalic     = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic)

  const [aR, aG, aB] = hexToRgb(accent)
  const ROSE = rgb(aR, aG, aB)

  // Fundo creme
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.99, 0.985, 0.97) })

  // Borda dupla
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: ROSE, borderWidth: 2, color: undefined })
  page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: ROSE, borderWidth: 0.5, color: undefined })

  // Renderiza tags do layout
  for (const t of layout) {
    const text = resolveTag(t.tag, ctx)
    if (!text) continue
    const font = t.italic ? timesItalic : (t.weight === 'bold' ? helveticaBold : helvetica)
    const size = t.font_size
    const [cR, cG, cB] = hexToRgb(t.color ?? '#0b0b0f')
    const w = font.widthOfTextAtSize(text, size)

    // Coordenadas: pdf-lib y é bottom-up. y_pct medido do topo.
    const xCenter = (t.x_pct / 100) * W
    const y = H - (t.y_pct / 100) * H - size / 2
    let x: number
    if (t.align === 'right') x = xCenter - w
    else if (t.align === 'left') x = xCenter
    else x = xCenter - w / 2  // center default

    page.drawText(text, { x, y, size, font, color: rgb(cR, cG, cB) })
  }

  // QR + texto de validação (canto inferior direito)
  const qrImage = await pdfDoc.embedPng(qrBytes)
  const qrSize = 80
  page.drawImage(qrImage, { x: W - qrSize - 60, y: 60, width: qrSize, height: qrSize })
  page.drawText('Verifique a autenticidade:', { x: W - qrSize - 60, y: 50, size: 7, font: helvetica, color: rgb(0.4, 0.4, 0.45) })
  page.drawText(`Código: ${ctx.hash.slice(0, 8).toUpperCase()}`, { x: W - qrSize - 60, y: 38, size: 7, font: helveticaBold, color: rgb(0.04, 0.04, 0.06) })

  // Assinaturas: linha + nome em negro + função/cargo em itálico colorido
  // (nova estrutura pareada signature_names + signature_titles, 2026-05-07).
  const sigNames: string[]  = Array.isArray(ctx.template?.signature_names)  ? ctx.template.signature_names  : []
  const sigTitles: string[] = Array.isArray(ctx.template?.signature_titles) ? ctx.template.signature_titles : []
  const sigCount = Math.min(sigNames.length, 3)
  if (sigCount > 0) {
    const sigGap = 220
    const startX = (W - sigGap * sigCount) / 2 + sigGap / 2 - 100
    for (let i = 0; i < sigCount; i++) {
      const cx = startX + i * sigGap
      page.drawLine({ start: { x: cx, y: 110 }, end: { x: cx + 200, y: 110 }, thickness: 0.8, color: rgb(0.04, 0.04, 0.06) })
      const name  = sigNames[i] ?? ''
      const title = sigTitles[i] ?? ''
      const nameW = helveticaBold.widthOfTextAtSize(name, 10)
      page.drawText(name, { x: cx + (200 - nameW) / 2, y: 95, size: 10, font: helveticaBold, color: rgb(0.04, 0.04, 0.06) })
      if (title) {
        const titleW = helvetica.widthOfTextAtSize(title, 8)
        page.drawText(title, { x: cx + (200 - titleW) / 2, y: 82, size: 8, font: helvetica, color: rgb(0.6, 0.6, 0.65) })
      }
    }
  }

  // Footer
  const footer = 'Emitido por CoreoHub — Gestão Inteligente para Festivais de Dança'
  const fW = helvetica.widthOfTextAtSize(footer, 8)
  page.drawText(footer, { x: (W - fW) / 2, y: 50, size: 8, font: helvetica, color: rgb(0.4, 0.4, 0.45) })

  return pdfDoc.save()
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Não autenticado')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    // Pode ser null se vier só com anon key (guest checkout — audit T2.3).
    const { data: { user } } = await userClient.auth.getUser()

    const body = await req.json().catch(() => ({}))
    const { certificate_id, access_token } = body as { certificate_id?: string; access_token?: string }
    if (!certificate_id) throw new Error('certificate_id obrigatório')

    // Carrega cert + template + verifica permissão (producer OU inscrito vinculado)
    const { data: cert, error: certErr } = await supabase
      .from('certificates_issued')
      .select(`
        id, template_id, template_type, registration_id, workshop_registration_id,
        recipient_name, certificate_data, producer_id, validation_hash,
        pdf_url, pdf_storage_path, pdf_generated_at
      `)
      .eq('id', certificate_id)
      .single()
    if (!cert || certErr) throw new Error('Certificado não encontrado')

    // ── Verifica permissão (3 caminhos de auth) ───────────────────────────
    let authorized = false

    // 1. User logado producer dono do certificado
    if (user && cert.producer_id === user.id) {
      authorized = true
    }

    // 2. User logado inscrito vinculado (registration.user_id ou workshop_reg.user_id)
    if (!authorized && user) {
      if (cert.registration_id) {
        const { data: r } = await supabase.from('registrations').select('user_id').eq('id', cert.registration_id).single()
        if (r?.user_id === user.id) authorized = true
      } else if (cert.workshop_registration_id) {
        const { data: wr } = await supabase.from('workshop_registrations').select('user_id').eq('id', cert.workshop_registration_id).single()
        if (wr?.user_id === user.id) authorized = true
      }
    }

    // 3. Guest com access_token válido (audit T2.3): inscrito sem login
    //    acessa próprio cert via token enviado por email. Token fica no banco
    //    em workshop_registrations.access_token. registrations não tem access_token
    //    público — só workshop tem essa estrutura.
    if (!authorized && access_token) {
      if (cert.workshop_registration_id) {
        const { data: wr } = await supabase
          .from('workshop_registrations')
          .select('access_token')
          .eq('id', cert.workshop_registration_id)
          .single()
        if (wr?.access_token === access_token) authorized = true
      }
    }

    // 4. COREOHUB_ADMIN
    if (!authorized && user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (prof?.role === 'COREOHUB_ADMIN') authorized = true
    }

    if (!authorized) throw new Error('Sem permissão pra acessar este certificado')

    // ── CACHE HIT: já tem pdf_url ────────────────────────────────────────────
    if (cert.pdf_url && cert.pdf_storage_path) {
      const { data: signed, error: sErr } = await supabase.storage
        .from('certificates')
        .createSignedUrl(cert.pdf_storage_path, 3600)
      if (signed?.signedUrl) {
        return json({
          signed_url: signed.signedUrl,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          was_cached: true,
        })
      }
      // Fallback: se signed URL falhou (ex: arquivo apagado), regenera
      console.warn('[get-certificate-pdf] cache miss em storage, regenerando:', sErr?.message)
    }

    // ── CACHE MISS: gera o PDF agora ─────────────────────────────────────────
    const { data: tpl } = await supabase
      .from('certificate_templates')
      .select('*')
      .eq('id', cert.template_id)
      .maybeSingle()

    const frontUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
    const validationUrl = `${frontUrl}/validar-certificado/${cert.validation_hash}`

    const pdfBytes = await generatePdf({
      template_type: cert.template_type as 'mostra' | 'workshop',
      template: tpl,
      recipient_name: cert.recipient_name,
      data: cert.certificate_data ?? {},
      hash: cert.validation_hash,
      validation_url: validationUrl,
    })

    // Upload pro bucket privado (path: certificates/{producer_id}/{cert_id}.pdf)
    const storagePath = `${cert.producer_id}/${cert.id}.pdf`
    const buf = new ArrayBuffer(pdfBytes.byteLength)
    new Uint8Array(buf).set(pdfBytes)

    const { error: upErr } = await supabase.storage
      .from('certificates')
      .upload(storagePath, buf, { contentType: 'application/pdf', upsert: true })
    if (upErr) throw new Error(`Erro upload: ${upErr.message}`)

    // Atualiza row com pdf_url + path
    await supabase
      .from('certificates_issued')
      .update({
        pdf_url: storagePath,
        pdf_storage_path: storagePath,
        pdf_generated_at: new Date().toISOString(),
      })
      .eq('id', cert.id)

    // Signed URL (TTL 1h)
    const { data: signed, error: sErr } = await supabase.storage
      .from('certificates')
      .createSignedUrl(storagePath, 3600)
    if (sErr || !signed?.signedUrl) throw new Error(`Erro gerar URL: ${sErr?.message}`)

    console.log(`[get-certificate-pdf] gerou ${cert.id} type=${cert.template_type} ${pdfBytes.byteLength}B`)

    return json({
      signed_url: signed.signedUrl,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      was_cached: false,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[get-certificate-pdf] erro:', message)
    return json({ error: message }, 400)
  }
})
