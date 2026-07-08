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
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import QRCode from 'qrcode'
import { buildCorsHeaders } from '../_shared/cors.ts'

// ── Defaults pros templates pré-prontos ────────────────────────────────────
type LayoutTag = {
  tag: string
  x_pct: number
  y_pct: number
  font_size: number
  align?: 'left' | 'center' | 'right'
  color?: string
  weight?: 'normal' | 'bold'
  italic?: boolean
  // 'times' ativa a família serifada inteira (Roman/Bold/Italic/BoldItalic) —
  // usado pelo preset 'ouro'. Ausente/'helvetica' preserva o comportamento
  // legado (italic sempre vira Times-Italic, nunca bold+italic junto).
  fontFamily?: 'helvetica' | 'times'
}

/** Normaliza preset_template salvo no banco pro discriminador visual usado
 * aqui. Mantém os valores legados (ver migration 20260520) caindo em
 * 'classico'/'workshop' — só 'ouro' é tratado como skin nova. */
function normalizeVisualPreset(p?: string | null): 'classico' | 'workshop' | 'ouro' {
  if (p === 'ouro') return 'ouro'
  if (p === 'workshop-minimalista' || p === 'workshop') return 'workshop'
  return 'classico'
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

// Preset 'ouro' — diploma tradicional premium (Times inteiro, moldura
// dourada desenhada à parte em drawOuroFrame). Cor de destaque (dourado)
// vem de template.accent_color; BURGUNDY é fixo do preset (não configurável
// na v1 — o preset já entrega a paleta pronta, como um "tema" completo).
const OURO_INK = '#241c10'
const OURO_MUTED = '#6b5d45'
const OURO_BURGUNDY = '#7a2b28'
const DEFAULT_LAYOUT_OURO_MOSTRA: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 50, y_pct: 18, font_size: 34, align: 'center', weight: 'bold', color: OURO_INK, fontFamily: 'times' },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 26, font_size: 12, align: 'center', color: '#a97e2e', fontFamily: 'times' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 35, font_size: 15, align: 'center', italic: true, color: OURO_MUTED, fontFamily: 'times' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 45, font_size: 34, align: 'center', weight: 'bold', italic: true, color: OURO_INK, fontFamily: 'times' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 53, font_size: 12.5, align: 'center', color: OURO_MUTED, fontFamily: 'times' },
  { tag: 'EVENTO',          x_pct: 50, y_pct: 60, font_size: 18, align: 'center', weight: 'bold', color: OURO_BURGUNDY, fontFamily: 'times' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 66, font_size: 11, align: 'center', color: OURO_MUTED, fontFamily: 'times' },
]
const DEFAULT_LAYOUT_OURO_WORKSHOP: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 50, y_pct: 18, font_size: 34, align: 'center', weight: 'bold', color: OURO_INK, fontFamily: 'times' },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 26, font_size: 12, align: 'center', color: '#a97e2e', fontFamily: 'times' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 35, font_size: 15, align: 'center', italic: true, color: OURO_MUTED, fontFamily: 'times' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 45, font_size: 34, align: 'center', weight: 'bold', italic: true, color: OURO_INK, fontFamily: 'times' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 53, font_size: 12.5, align: 'center', color: OURO_MUTED, fontFamily: 'times' },
  { tag: 'WORKSHOP_NOME',   x_pct: 50, y_pct: 60, font_size: 18, align: 'center', weight: 'bold', color: OURO_BURGUNDY, fontFamily: 'times' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 66, font_size: 11, align: 'center', color: OURO_MUTED, fontFamily: 'times' },
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

/** Busca background_url e embute como imagem de fundo full-bleed. Retorna
 * null (silencioso) se a URL falhar ou o formato não for png/jpg — o
 * chamador cai pro fundo sólido do preset nesse caso. */
async function embedBackgroundImage(pdfDoc: PDFDocument, url: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    if (contentType.includes('png') || url.toLowerCase().endsWith('.png')) {
      return await pdfDoc.embedPng(bytes)
    }
    return await pdfDoc.embedJpg(bytes)
  } catch (e) {
    console.warn('[get-certificate-pdf] falha ao embutir background_url:', e instanceof Error ? e.message : String(e))
    return null
  }
}

async function generatePdf(ctx: {
  template_type: 'mostra' | 'workshop'
  template: any
  recipient_name: string
  data: any
  hash: string
  validation_url: string
}): Promise<Uint8Array> {
  const preset = normalizeVisualPreset(ctx.template?.preset_template)
  const isOuro = preset === 'ouro'

  const layout: LayoutTag[] = (ctx.template?.layout_json && Array.isArray(ctx.template.layout_json) && ctx.template.layout_json.length > 0)
    ? ctx.template.layout_json
    : isOuro
      ? (ctx.template_type === 'workshop' ? DEFAULT_LAYOUT_OURO_WORKSHOP : DEFAULT_LAYOUT_OURO_MOSTRA)
      : (ctx.template_type === 'workshop' ? DEFAULT_LAYOUT_WORKSHOP : DEFAULT_LAYOUT_MOSTRA)

  const accent = ctx.template?.accent_color ?? (isOuro ? '#a97e2e' : '#ff0068')

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
  const timesRoman      = await pdfDoc.embedFont(StandardFonts.TimesRoman)
  const timesBold       = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
  const timesBoldItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic)

  /** Escolhe a fonte pro tag: fontFamily:'times' ativa a família serifada
   * inteira (com bold+italic combinados); ausente preserva o comportamento
   * legado (italic sempre vira Times-Italic, nunca bold+italic junto). */
  function pickFont(t: LayoutTag) {
    if (t.fontFamily === 'times') {
      if (t.weight === 'bold' && t.italic) return timesBoldItalic
      if (t.weight === 'bold') return timesBold
      if (t.italic) return timesItalic
      return timesRoman
    }
    return t.italic ? timesItalic : (t.weight === 'bold' ? helveticaBold : helvetica)
  }

  const [aR, aG, aB] = hexToRgb(accent)
  const ACCENT = rgb(aR, aG, aB)
  const [brR, brG, brB] = hexToRgb(OURO_BURGUNDY)
  const BURGUNDY = rgb(brR, brG, brB)

  // Fundo: imagem custom do produtor (se configurada) OU cor sólida do preset.
  const bgImage = ctx.template?.background_url
    ? await embedBackgroundImage(pdfDoc, ctx.template.background_url)
    : null
  if (bgImage) {
    page.drawImage(bgImage, { x: 0, y: 0, width: W, height: H })
    // Overlay claro por cima — mantém o texto legível independente do que
    // o produtor tenha subido (foto escura, estampa carregada, etc).
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1), opacity: 0.55 })
  } else {
    const bg = isOuro ? rgb(0.984, 0.965, 0.925) : rgb(0.99, 0.985, 0.97)
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: bg })
  }

  // Moldura: dupla simples (classico/workshop) ou dupla + cantos ornamentados (ouro)
  if (isOuro) {
    page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: ACCENT, borderWidth: 2.2, color: undefined })
    page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: ACCENT, borderWidth: 0.6, color: undefined })
    const cornerLen = 26, inset = 28
    const corners: Array<{ x: number; y: number; dx: 1 | -1; dy: 1 | -1 }> = [
      { x: inset,     y: H - inset, dx: 1,  dy: -1 },
      { x: W - inset, y: H - inset, dx: -1, dy: -1 },
      { x: inset,     y: inset,     dx: 1,  dy: 1 },
      { x: W - inset, y: inset,     dx: -1, dy: 1 },
    ]
    for (const c of corners) {
      page.drawLine({ start: { x: c.x, y: c.y }, end: { x: c.x + cornerLen * c.dx, y: c.y }, thickness: 1.4, color: ACCENT })
      page.drawLine({ start: { x: c.x, y: c.y }, end: { x: c.x, y: c.y + cornerLen * c.dy }, thickness: 1.4, color: ACCENT })
    }
    // Filete + losango entre título e subtítulo
    const ruleY = H - 0.22 * H
    const ruleW = 110
    page.drawLine({ start: { x: W / 2 - ruleW / 2, y: ruleY }, end: { x: W / 2 - 6, y: ruleY }, thickness: 0.8, color: ACCENT })
    page.drawLine({ start: { x: W / 2 + 6, y: ruleY }, end: { x: W / 2 + ruleW / 2, y: ruleY }, thickness: 0.8, color: ACCENT })
    page.drawRectangle({ x: W / 2 - 4, y: ruleY - 4, width: 8, height: 8, rotate: degrees(45), color: ACCENT })
  } else {
    page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: ACCENT, borderWidth: 2, color: undefined })
    page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: ACCENT, borderWidth: 0.5, color: undefined })
  }

  // Renderiza tags do layout
  for (const t of layout) {
    const text = resolveTag(t.tag, ctx)
    if (!text) continue
    const font = pickFont(t)
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

  // Selo ornamentado + fita — só preset ouro. Ancorado centralizado, numa
  // faixa vertical livre entre DATA_LOCAL e a linha de assinatura, pra nunca
  // colidir com o bloco de assinaturas (que pode ter até 3 colunas de
  // largura variável) nem com o QR (canto inferior direito).
  if (isOuro) {
    const sealCx = W / 2, sealCy = 155, sealR = 18
    page.drawEllipse({ x: sealCx, y: sealCy, xScale: sealR, yScale: sealR, borderColor: ACCENT, borderWidth: 1.6, color: undefined })
    page.drawRectangle({ x: sealCx - 4, y: sealCy - 4, width: 8, height: 8, rotate: degrees(45), color: ACCENT })
    const ribbonW = 7, ribbonH = 24, ribbonTopY = sealCy - sealR + 2
    page.drawRectangle({ x: sealCx - 9, y: ribbonTopY - ribbonH, width: ribbonW, height: ribbonH, color: BURGUNDY, rotate: degrees(-14) })
    page.drawRectangle({ x: sealCx + 2, y: ribbonTopY - ribbonH, width: ribbonW, height: ribbonH, color: BURGUNDY, rotate: degrees(14) })
  }

  // QR + texto de validação (canto inferior direito)
  const qrImage = await pdfDoc.embedPng(qrBytes)
  const qrSize = 80
  const bodyFont = isOuro ? timesRoman : helvetica
  const boldFont = isOuro ? timesBold : helveticaBold
  const mutedColor = isOuro ? rgb(...hexToRgb(OURO_MUTED)) : rgb(0.4, 0.4, 0.45)
  const inkColor = isOuro ? rgb(...hexToRgb(OURO_INK)) : rgb(0.04, 0.04, 0.06)
  page.drawImage(qrImage, { x: W - qrSize - 60, y: 60, width: qrSize, height: qrSize })
  page.drawText('Verifique a autenticidade:', { x: W - qrSize - 60, y: 50, size: 7, font: bodyFont, color: mutedColor })
  page.drawText(`Código: ${ctx.hash.slice(0, 8).toUpperCase()}`, { x: W - qrSize - 60, y: 38, size: 7, font: boldFont, color: inkColor })

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
      page.drawLine({ start: { x: cx, y: 110 }, end: { x: cx + 200, y: 110 }, thickness: 0.8, color: inkColor })
      const name  = sigNames[i] ?? ''
      const title = sigTitles[i] ?? ''
      const nameW = boldFont.widthOfTextAtSize(name, 10)
      page.drawText(name, { x: cx + (200 - nameW) / 2, y: 95, size: 10, font: boldFont, color: inkColor })
      if (title) {
        const titleW = (isOuro ? timesItalic : helvetica).widthOfTextAtSize(title, 8)
        page.drawText(title, { x: cx + (200 - titleW) / 2, y: 82, size: 8, font: isOuro ? timesItalic : helvetica, color: mutedColor })
      }
    }
  }

  // Footer
  const footer = 'Emitido por CoreoHub — Gestão Inteligente para Festivais de Dança'
  const fW = bodyFont.widthOfTextAtSize(footer, 8)
  page.drawText(footer, { x: (W - fW) / 2, y: 50, size: 8, font: bodyFont, color: mutedColor })

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

    // ── Modo preview: gera um PDF de exemplo com dados fictícios pro produtor
    // conferir o template ANTES de emitir em lote pros inscritos reais. Não
    // toca certificates_issued nem o bucket — devolve o PDF direto na resposta.
    const { preview, template_id: previewTemplateId } = body as { preview?: boolean; template_id?: string }
    if (preview) {
      if (!user) throw new Error('Não autenticado')
      if (!previewTemplateId) throw new Error('template_id obrigatório pra preview')

      const { data: tpl, error: tplErr } = await supabase
        .from('certificate_templates')
        .select('*')
        .eq('id', previewTemplateId)
        .single()
      if (!tpl || tplErr) throw new Error('Template não encontrado')
      if (tpl.producer_id !== user.id) {
        const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
        if (prof?.role !== 'COREOHUB_ADMIN') throw new Error('Sem permissão pra pré-visualizar este template')
      }

      const isWorkshop = tpl.template_type === 'workshop'
      const previewData = isWorkshop
        ? { workshop_nome: 'Hip-hop Fundamentos', professor_nome: 'Jonathan Lupe', duracao_minutos: 90, evento_nome: 'Festival CoreoHub Demo', evento_data: new Date().toISOString().slice(0, 10), evento_local: 'Votuporanga, SP' }
        : { coreografia: 'Renascer', modalidade: 'Solo · Ballet Clássico · Juvenil', classificacao: 'Medalha de Ouro', tipo_apresentacao: 'competitiva', evento_nome: 'Festival CoreoHub Demo', evento_data: new Date().toISOString().slice(0, 10), evento_local: 'Votuporanga, SP' }

      const previewHash = crypto.randomUUID()
      const frontUrl = Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com'
      const pdfBytes = await generatePdf({
        template_type: tpl.template_type,
        template: tpl,
        recipient_name: 'Maria Silva Oliveira',
        data: previewData,
        hash: previewHash,
        validation_url: `${frontUrl}/validar-certificado/${previewHash}`,
      })

      const previewBuf = new ArrayBuffer(pdfBytes.byteLength)
      new Uint8Array(previewBuf).set(pdfBytes)
      return new Response(previewBuf, { headers: { ...corsHeaders, 'Content-Type': 'application/pdf' } })
    }

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
