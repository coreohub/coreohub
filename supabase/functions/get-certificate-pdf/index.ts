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
import fontkit from '@pdf-lib/fontkit'
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
  // usado pelo preset 'ouro'. 'script' usa a fonte cursiva embutida em
  // runtime (moderno/prestigio, só no NOME_PARTICIPANTE) — cai pra
  // Times-BoldItalic se o fetch da fonte falhar. Ausente/'helvetica'
  // preserva o comportamento legado (italic sempre vira Times-Italic,
  // nunca bold+italic junto).
  fontFamily?: 'helvetica' | 'times' | 'script'
  // Ativa quebra de linha (word-wrap) pra tags de corpo longo alinhadas à
  // esquerda (ex: 'prestigio', que não centraliza e por isso tem menos
  // largura livre até a borda). Ausente preserva o comportamento legado
  // (1 linha só, sem quebra — como classico/ouro/moderno já usam).
  max_width_pct?: number
}

/** Normaliza preset_template salvo no banco pro discriminador visual usado
 * aqui. Mantém os valores legados (ver migration 20260520) caindo em
 * 'classico'/'workshop' — 'ouro' segue rendendo pra quem já tinha salvo
 * (aposentado do seletor em 2026-07-09, mas o código não foi removido).
 * 'moderno'/'prestigio' são os presets ativos desde então. */
function normalizeVisualPreset(p?: string | null): 'classico' | 'workshop' | 'ouro' | 'moderno' | 'prestigio' | 'custom' | 'oficial-dourado' {
  if (p === 'ouro') return 'ouro'
  if (p === 'moderno') return 'moderno'
  if (p === 'prestigio') return 'prestigio'
  if (p === 'custom') return 'custom'
  if (p === 'oficial-dourado') return 'oficial-dourado'
  if (p === 'workshop-minimalista' || p === 'workshop') return 'workshop'
  return 'classico'
}

// Preset 'oficial-dourado' — moldura pronta fornecida pelo CoreoHub (não é
// código desenhando forma nenhuma, é uma imagem full-bleed). v2 (2026-07-18,
// substitui a v1 de 2026-07-17): moldura dourada concentrada nas bordas e
// cantos (florão ornamental em cada canto) em vez de blocos grandes, faixa
// navy só na base ocupando ~12% da altura (a v1 tinha ~25-30%, espremendo
// o texto lá em cima — pedido explícito do produtor foi mais respiro no
// centro). Selo dourado liso, sem texto/símbolo dentro de propósito — IA de
// imagem não renderiza texto legível, então o conteúdo real (se algum dia
// fizer sentido, ex: posição/medalha) é estampado por código, não pela
// arte. Produtor não escolhe cor — paleta fixa. Coordenadas medidas direto
// no arquivo (crop + inspeção visual): selo começa em ~74% da altura,
// faixa em ~88%. O QR de validação NÃO depende de a arte reservar espaço —
// o próprio código desenha um cartão branco atrás dele (ver bloco do QR
// mais abaixo), então funciona em qualquer imagem nova, mesmo sem caixa
// reservada.
const OFICIAL_DOURADO_BG_URL = 'https://app.coreohub.com/certificate-frames/oficial-dourado.jpg'
const OFICIAL_INK = '#241c10'
const OFICIAL_MUTED = '#6b5d45'
const OFICIAL_ACCENT = '#a97e2e'
const DEFAULT_LAYOUT_OFICIAL_MOSTRA: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 50, y_pct: 14, font_size: 34, align: 'center', weight: 'bold', color: OFICIAL_INK, fontFamily: 'times' },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 21, font_size: 12, align: 'center', color: OFICIAL_ACCENT, fontFamily: 'times' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 29, font_size: 15, align: 'center', italic: true, color: OFICIAL_MUTED, fontFamily: 'times' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 38, font_size: 34, align: 'center', weight: 'bold', italic: true, color: OFICIAL_INK, fontFamily: 'times' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 46, font_size: 12.5, align: 'center', color: OFICIAL_MUTED, fontFamily: 'times' },
  { tag: 'EVENTO',          x_pct: 50, y_pct: 53, font_size: 18, align: 'center', weight: 'bold', color: OFICIAL_ACCENT, fontFamily: 'times' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 59, font_size: 11, align: 'center', color: OFICIAL_MUTED, fontFamily: 'times' },
]
const DEFAULT_LAYOUT_OFICIAL_WORKSHOP: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 50, y_pct: 14, font_size: 34, align: 'center', weight: 'bold', color: OFICIAL_INK, fontFamily: 'times' },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 21, font_size: 12, align: 'center', color: OFICIAL_ACCENT, fontFamily: 'times' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 29, font_size: 15, align: 'center', italic: true, color: OFICIAL_MUTED, fontFamily: 'times' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 38, font_size: 34, align: 'center', weight: 'bold', italic: true, color: OFICIAL_INK, fontFamily: 'times' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 46, font_size: 12.5, align: 'center', color: OFICIAL_MUTED, fontFamily: 'times' },
  { tag: 'WORKSHOP_NOME',   x_pct: 50, y_pct: 53, font_size: 18, align: 'center', weight: 'bold', color: OFICIAL_ACCENT, fontFamily: 'times' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 59, font_size: 11, align: 'center', color: OFICIAL_MUTED, fontFamily: 'times' },
]

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

// Preset 'moderno' — diagonal azul-marinho + dourado, "prêmio corporativo".
// accent_color = navy (destaque/EVENTO/subtítulo), primary_color = tinta
// escura (título/nome). Dourado é fixo do preset (MODERNO_GOLD), como o
// burgundy do 'ouro' — não configurável na v1.
const MODERNO_GOLD = '#eaa93a'
const MODERNO_MUTED = '#6b7280'
const MODERNO_DEFAULT_ACCENT = '#1c4f72'
const MODERNO_DEFAULT_PRIMARY = '#1f2937'
const DEFAULT_LAYOUT_MODERNO_MOSTRA: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 48, y_pct: 18, font_size: 34, align: 'center', weight: 'bold', color: MODERNO_DEFAULT_PRIMARY, fontFamily: 'times' },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 26, font_size: 12, align: 'center', color: MODERNO_DEFAULT_ACCENT, fontFamily: 'times' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 35, font_size: 15, align: 'center', italic: true, color: MODERNO_MUTED, fontFamily: 'times' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 45, font_size: 34, align: 'center', color: MODERNO_DEFAULT_PRIMARY, fontFamily: 'script' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 53, font_size: 12.5, align: 'center', color: MODERNO_MUTED, fontFamily: 'times' },
  { tag: 'EVENTO',          x_pct: 50, y_pct: 60, font_size: 18, align: 'center', weight: 'bold', color: MODERNO_DEFAULT_ACCENT, fontFamily: 'times' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 66, font_size: 11, align: 'center', color: MODERNO_MUTED, fontFamily: 'times' },
]
const DEFAULT_LAYOUT_MODERNO_WORKSHOP: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 48, y_pct: 18, font_size: 34, align: 'center', weight: 'bold', color: MODERNO_DEFAULT_PRIMARY, fontFamily: 'times' },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 26, font_size: 12, align: 'center', color: MODERNO_DEFAULT_ACCENT, fontFamily: 'times' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 35, font_size: 15, align: 'center', italic: true, color: MODERNO_MUTED, fontFamily: 'times' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 45, font_size: 34, align: 'center', color: MODERNO_DEFAULT_PRIMARY, fontFamily: 'script' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 53, font_size: 12.5, align: 'center', color: MODERNO_MUTED, fontFamily: 'times' },
  { tag: 'WORKSHOP_NOME',   x_pct: 50, y_pct: 60, font_size: 18, align: 'center', weight: 'bold', color: MODERNO_DEFAULT_ACCENT, fontFamily: 'times' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 66, font_size: 11, align: 'center', color: MODERNO_MUTED, fontFamily: 'times' },
]

// Preset 'prestigio' — preto + dourado, layout CENTRALIZADO com moldura
// dupla dourada envolvendo a página inteira e faixa decorativa só no
// rodapé (revisado 2026-07-17 — a v1 tinha cabeçalho left-aligned + cunha
// diagonal só no canto esquerdo, fora do padrão de mercado de certificado/
// diploma; referência de mercado pediu simetria). accent_color = dourado
// (destaque/EVENTO/eyebrow), primary_color = tinta (nome/subtítulo).
// TITULO/SUBTITULO trocam de papel visual em relação aos outros presets:
// TITULO ("CERTIFICADO") vira o eyebrow pequeno, SUBTITULO ("DE
// PARTICIPAÇÃO") vira o título grande — evita tocar em resolveTag().
const PRESTIGIO_MUTED = '#8a7f68'
const PRESTIGIO_DEFAULT_ACCENT = '#caa23a'
const PRESTIGIO_DEFAULT_PRIMARY = '#171310'
const DEFAULT_LAYOUT_PRESTIGIO_MOSTRA: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 50, y_pct: 16, font_size: 9,  align: 'center', weight: 'bold', color: PRESTIGIO_DEFAULT_ACCENT },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 24, font_size: 30, align: 'center', weight: 'bold', color: PRESTIGIO_DEFAULT_PRIMARY, fontFamily: 'times' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 34, font_size: 11, align: 'center', italic: true, color: PRESTIGIO_MUTED, fontFamily: 'times' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 44, font_size: 36, align: 'center', color: PRESTIGIO_DEFAULT_PRIMARY, fontFamily: 'script' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 53, font_size: 12, align: 'center', color: PRESTIGIO_MUTED },
  { tag: 'EVENTO',          x_pct: 50, y_pct: 60, font_size: 18, align: 'center', weight: 'bold', color: PRESTIGIO_DEFAULT_ACCENT, fontFamily: 'times' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 66, font_size: 11, align: 'center', color: PRESTIGIO_MUTED },
]
const DEFAULT_LAYOUT_PRESTIGIO_WORKSHOP: LayoutTag[] = [
  { tag: 'TITULO',          x_pct: 50, y_pct: 16, font_size: 9,  align: 'center', weight: 'bold', color: PRESTIGIO_DEFAULT_ACCENT },
  { tag: 'SUBTITULO',       x_pct: 50, y_pct: 24, font_size: 30, align: 'center', weight: 'bold', color: PRESTIGIO_DEFAULT_PRIMARY, fontFamily: 'times' },
  { tag: 'INTRO',           x_pct: 50, y_pct: 34, font_size: 11, align: 'center', italic: true, color: PRESTIGIO_MUTED, fontFamily: 'times' },
  { tag: 'NOME_PARTICIPANTE', x_pct: 50, y_pct: 44, font_size: 36, align: 'center', color: PRESTIGIO_DEFAULT_PRIMARY, fontFamily: 'script' },
  { tag: 'CORPO',           x_pct: 50, y_pct: 53, font_size: 12, align: 'center', color: PRESTIGIO_MUTED },
  { tag: 'WORKSHOP_NOME',   x_pct: 50, y_pct: 60, font_size: 18, align: 'center', weight: 'bold', color: PRESTIGIO_DEFAULT_ACCENT, fontFamily: 'times' },
  { tag: 'DATA_LOCAL',      x_pct: 50, y_pct: 66, font_size: 11, align: 'center', color: PRESTIGIO_MUTED },
]

/** Quebra de linha greedy simples pra tags com max_width_pct (só usado por
 * 'prestigio' hoje — corpo alinhado à esquerda tem menos largura livre até
 * a borda que os presets centralizados, então precisa de wrap de verdade
 * pra frases longas não vazarem da página). */
function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

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

/** Busca uma URL de imagem (background_url OU logo_url) e embute no PDF.
 * Retorna null (silencioso) se a URL falhar ou o formato não for png/jpg —
 * o chamador cai pro fundo sólido do preset (ou simplesmente omite o logo)
 * nesse caso. */
async function embedImageFromUrl(pdfDoc: PDFDocument, url: string) {
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
    console.warn('[get-certificate-pdf] falha ao embutir imagem:', e instanceof Error ? e.message : String(e))
    return null
  }
}

/** Bytes da fonte cursiva cacheados a nível de módulo — sobrevivem entre
 * invocações que reaproveitam a mesma instância "quente" do Deno, evitando
 * refazer o fetch do GitHub a cada certificado gerado (o arquivo nunca
 * muda). `undefined` = ainda não tentou; `null` = tentou e falhou (não
 * refaz o fetch pro resto da vida da instância — mesmo comportamento de
 * fallback silencioso, só que decidido 1x). */
let cachedScriptFontBytes: Uint8Array | null | undefined

/** Busca a fonte cursiva (Dancing Script, OFL) direto do repo google/fonts
 * — URL binária estável, sem depender de UA-sniffing do CSS do Google Fonts
 * (que serve woff2/woff conforme o User-Agent, e fontkit não decodifica
 * woff2). Só chamada pros presets moderno/prestigio. Retorna null
 * (silencioso) se o fetch falhar — o chamador cai pro Times-BoldItalic. */
async function embedScriptFont(pdfDoc: PDFDocument) {
  if (cachedScriptFontBytes === undefined) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/dancingscript/DancingScript%5Bwght%5D.ttf')
      cachedScriptFontBytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    } catch (e) {
      console.warn('[get-certificate-pdf] falha ao embutir fonte script:', e instanceof Error ? e.message : String(e))
      cachedScriptFontBytes = null
    }
  }
  if (!cachedScriptFontBytes) return null
  return await pdfDoc.embedFont(cachedScriptFontBytes)
}

/** Converte um quadrilátero/polígono definido em % do cartão (estilo
 * clip-path CSS, relativo à própria bounding box do bloco) numa string de
 * path SVG em coordenadas LOCAIS top-down (drawSvgPath já inverte o eixo Y
 * sozinho — ver nota em drawPolygonPct). */
function polygonPctToSvgPath(
  shape: { topPct: number; leftPct: number; wPct: number; hPct: number },
  points: Array<[number, number]>,
  W: number, H: number,
): string {
  const abs = points.map(([px, py]) => {
    const xPct = shape.leftPct + (px / 100) * shape.wPct
    const yPct = shape.topPct + (py / 100) * shape.hPct
    return { x: (xPct / 100) * W, y: (yPct / 100) * H }
  })
  return `M ${abs[0].x} ${abs[0].y} ` + abs.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z'
}

/** Desenha o polígono. IMPORTANTE: page.drawSvgPath faz translate(x,y) e
 * DEPOIS scale(1,-1) — ou seja, o path deve ser autorado em coordenadas
 * LOCAIS top-down (y cresce pra baixo, como CSS) e (x:0, y:H) ancora a
 * origem local no topo-esquerda da página. Verificado com teste isolado
 * (Playwright + PDF renderizado) antes de usar aqui — sem essa âncora o
 * polígono cai fora da página e não aparece. */
function drawPolygonPct(
  page: any, W: number, H: number,
  shape: { topPct: number; leftPct: number; wPct: number; hPct: number },
  points: Array<[number, number]>,
  color: any,
) {
  const d = polygonPctToSvgPath(shape, points, W, H)
  page.drawSvgPath(d, { x: 0, y: H, color })
}

async function generatePdf(ctx: {
  template_type: 'mostra' | 'workshop'
  template: any
  recipient_name: string
  data: any
  hash: string
  validation_url: string
  is_preview?: boolean
}): Promise<Uint8Array> {
  const preset = normalizeVisualPreset(ctx.template?.preset_template)
  const isOuro = preset === 'ouro'
  const isModerno = preset === 'moderno'
  const isPrestigio = preset === 'prestigio'
  const isCustom = preset === 'custom'
  const isOficial = preset === 'oficial-dourado'
  const isWorkshop = ctx.template_type === 'workshop'

  const layout: LayoutTag[] = (ctx.template?.layout_json && Array.isArray(ctx.template.layout_json) && ctx.template.layout_json.length > 0)
    ? ctx.template.layout_json
    : isOficial
      ? (isWorkshop ? DEFAULT_LAYOUT_OFICIAL_WORKSHOP : DEFAULT_LAYOUT_OFICIAL_MOSTRA)
      : isOuro
        ? (isWorkshop ? DEFAULT_LAYOUT_OURO_WORKSHOP : DEFAULT_LAYOUT_OURO_MOSTRA)
        : isModerno
          ? (isWorkshop ? DEFAULT_LAYOUT_MODERNO_WORKSHOP : DEFAULT_LAYOUT_MODERNO_MOSTRA)
          : isPrestigio
            ? (isWorkshop ? DEFAULT_LAYOUT_PRESTIGIO_WORKSHOP : DEFAULT_LAYOUT_PRESTIGIO_MOSTRA)
            : (isWorkshop ? DEFAULT_LAYOUT_WORKSHOP : DEFAULT_LAYOUT_MOSTRA)

  // 'oficial-dourado' força a própria paleta (ignora accent_color salvo) —
  // é moldura pronta, cor customizada quebraria a harmonia com a imagem.
  const accent = isOficial ? OFICIAL_ACCENT : ctx.template?.accent_color ?? (
    isOuro ? '#a97e2e' : isModerno ? MODERNO_DEFAULT_ACCENT : isPrestigio ? PRESTIGIO_DEFAULT_ACCENT : '#ff0068'
  )

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

  pdfDoc.registerFontkit(fontkit)

  const helvetica       = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const timesItalic     = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic)
  const timesRoman      = await pdfDoc.embedFont(StandardFonts.TimesRoman)
  const timesBold       = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
  const timesBoldItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic)
  // Fonte cursiva só é buscada pros 2 presets que a usam (nome do premiado).
  // Cai pra Times-BoldItalic (mesmo efeito visual do 'ouro') se o fetch falhar.
  const scriptFont = (isModerno || isPrestigio) ? await embedScriptFont(pdfDoc) : null

  /** Escolhe a fonte pro tag: fontFamily:'times' ativa a família serifada
   * inteira (com bold+italic combinados); 'script' usa a cursiva embutida
   * (fallback Times-BoldItalic); ausente preserva o comportamento legado
   * (italic sempre vira Times-Italic, nunca bold+italic junto). */
  function pickFont(t: LayoutTag) {
    if (t.fontFamily === 'script') return scriptFont ?? timesBoldItalic
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
  const MODERNO_GOLD_RGB = rgb(...hexToRgb(MODERNO_GOLD))
  const PRESTIGIO_INK_RGB = rgb(...hexToRgb(PRESTIGIO_DEFAULT_PRIMARY))

  // Fundo: imagem custom do produtor, OU a moldura oficial do CoreoHub
  // (fixa, hospedada como asset estático — 'oficial-dourado' ignora
  // qualquer background_url salvo, a arte é sempre a mesma pra todo mundo),
  // OU cor sólida do preset. Preset 'custom' com imagem enviada = "moldura
  // pronta" (designer entregou a peça inteira, texto vai só por cima) —
  // NUNCA aplica o overlay claro nem desenha moldura própria
  // (hasBakedInFrame abaixo cobre os dois casos, custom e oficial-dourado).
  // Qualquer outro preset com background_url é tratado como imagem "solta"
  // (foto/estampa do produtor) e continua recebendo o overlay de proteção,
  // igual sempre foi.
  const bgUrl = isOficial ? OFICIAL_DOURADO_BG_URL : ctx.template?.background_url
  const bgImage = bgUrl ? await embedImageFromUrl(pdfDoc, bgUrl) : null
  const hasBakedInFrame = (isCustom || isOficial) && !!bgImage
  if (bgImage) {
    page.drawImage(bgImage, { x: 0, y: 0, width: W, height: H })
    if (!hasBakedInFrame) {
      // Overlay claro por cima — mantém o texto legível independente do que
      // o produtor tenha subido (foto escura, estampa carregada, etc).
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1), opacity: 0.55 })
    }
  } else {
    // Fallback de segurança: se 'oficial-dourado' não conseguiu buscar a
    // imagem (asset ainda não publicado, rede fora), nunca renderiza
    // certificado vazio — cai pro visual classico (frame + fundo sólido).
    const bg = isOuro || isPrestigio ? rgb(0.984, 0.965, 0.925) : rgb(0.99, 0.985, 0.97)
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: bg })
  }

  // Moldura: dupla simples (classico/workshop) ou dupla + cantos ornamentados (ouro).
  // 'custom'/'oficial-dourado' com moldura pronta pulam essa etapa inteira —
  // a imagem já É a moldura.
  if (hasBakedInFrame) {
    // nada a desenhar — a imagem de fundo já traz a moldura completa.
  } else if (isOuro) {
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
  } else if (isModerno) {
    // Blocos diagonais azul-marinho (ACCENT) + dourado (fixo) nos cantos
    // superior-direito e inferior-esquerdo — geometria replicada do mockup
    // aprovado (top/left/right/bottom/width/height % → shape bbox).
    drawPolygonPct(page, W, H, { topPct: -6, leftPct: 58, wPct: 46, hPct: 36 }, [[30, 0], [100, 0], [100, 70], [0, 100]], ACCENT)
    drawPolygonPct(page, W, H, { topPct: 2,  leftPct: 78, wPct: 16, hPct: 25 }, [[40, 0], [100, 0], [60, 100], [0, 100]], MODERNO_GOLD_RGB)
    drawPolygonPct(page, W, H, { topPct: 70, leftPct: -6, wPct: 22, hPct: 38 }, [[0, 0], [100, 30], [40, 100], [0, 100]], ACCENT)
    drawPolygonPct(page, W, H, { topPct: 78, leftPct: 2,  wPct: 8,  hPct: 24 }, [[0, 0], [100, 0], [60, 100], [0, 100]], MODERNO_GOLD_RGB)
    // Moldura fina cinza (neutra — não compete com os blocos coloridos)
    const grayBorder = rgb(0.847, 0.855, 0.871) // #d8dade
    const outerX = 0.034 * W, outerY = 0.034 * H
    const innerX = 0.044 * W, innerY = 0.044 * H
    page.drawRectangle({ x: outerX, y: outerY, width: W - 2 * outerX, height: H - 2 * outerY, borderColor: grayBorder, borderWidth: 1.6, color: undefined })
    page.drawRectangle({ x: innerX, y: innerY, width: W - 2 * innerX, height: H - 2 * innerY, borderColor: grayBorder, borderWidth: 0.6, color: undefined })
    // 3 losangos como divisor entre subtítulo e "Certificamos que"
    const diaY = H - 0.295 * H
    for (const dx of [-14, 0, 14]) {
      page.drawRectangle({ x: W / 2 + dx - 3, y: diaY - 3, width: 6, height: 6, rotate: degrees(45), color: MODERNO_GOLD_RGB })
    }
  } else if (isPrestigio) {
    // Moldura dupla dourada envolvendo a página inteira (padrão diploma
    // clássico), substitui a cunha diagonal assimétrica do canto esquerdo
    // da v1. A faixa decorativa no rodapé (chevron+fita) planejada pra essa
    // revisão foi removida por ora: a geometria calculada à mão via
    // drawPolygonPct colidia com o próprio selo/assinatura/QR e a fita
    // dourada acabava encobrindo o chevron preto por baixo (achado real de
    // /code-review em 2026-07-17, nunca visível sem gerar o PDF de fato).
    // Fica só a moldura — segura e já valida o pedido central (layout
    // centralizado). Decoração de rodapé volta como pauta separada, dessa
    // vez traduzindo caminho SVG já validado num mockup visual em vez de
    // coordenadas de polígono calculadas às cegas.
    page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: ACCENT, borderWidth: 2.2, color: undefined })
    page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: ACCENT, borderWidth: 0.6, color: undefined })
  } else {
    page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: ACCENT, borderWidth: 2, color: undefined })
    page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: ACCENT, borderWidth: 0.5, color: undefined })
  }

  // Logo do evento (opcional) — só desenha se o produtor configurou logo_url.
  // Moderno e Prestígio (ambos centralizados) usam a mesma caixa no topo.
  if ((isModerno || isPrestigio) && ctx.template?.logo_url) {
    const logoImage = await embedImageFromUrl(pdfDoc, ctx.template.logo_url)
    if (logoImage) {
      const boxSize = (6 / 100) * W
      const boxCenterX = W / 2
      const boxTopY = H - (9.5 / 100) * H
      const iw = logoImage.width, ih = logoImage.height
      const scale = Math.min(boxSize / iw, boxSize / ih)
      const drawW = iw * scale, drawH = ih * scale
      page.drawImage(logoImage, {
        x: boxCenterX - drawW / 2,
        y: boxTopY - boxSize + (boxSize - drawH) / 2,
        width: drawW, height: drawH,
      })
    }
  }

  // 'oficial-dourado' propositalmente NÃO tem slot de logo — testado em
  // 2026-07-18 e quebrava a simetria dos 4 cantos ornamentados (só 1 canto
  // com sticker, os outros 3 vazios) + produtor não costuma ter logo
  // quadrado formatado pra combinar com a paleta dourado/navy. Decisão:
  // "moldura pronta" fica 100% sem configuração nenhuma (nem cor, nem
  // logo) — só o Customizado (upload próprio) suporta logo, porque ali é
  // o designer do produtor quem já pensa no espaço certo.

  // Renderiza tags do layout
  for (const t of layout) {
    const text = resolveTag(t.tag, ctx)
    if (!text) continue
    const font = pickFont(t)
    const size = t.font_size
    const [cR, cG, cB] = hexToRgb(t.color ?? '#0b0b0f')
    const color = rgb(cR, cG, cB)

    // Coordenadas: pdf-lib y é bottom-up. y_pct medido do topo.
    const xCenter = (t.x_pct / 100) * W
    const yTop = H - (t.y_pct / 100) * H - size / 2

    const lines = t.max_width_pct
      ? wrapText(text, font, size, (t.max_width_pct / 100) * W)
      : [text]
    const lineHeight = size * 1.35
    lines.forEach((line, i) => {
      const w = font.widthOfTextAtSize(line, size)
      let x: number
      if (t.align === 'right') x = xCenter - w
      else if (t.align === 'left') x = xCenter
      else x = xCenter - w / 2  // center default
      page.drawText(line, { x, y: yTop - i * lineHeight, size, font, color })
    })
  }

  // Selo ornamentado + fita — ouro (triângulo+diamante+fita bordô) e
  // moderno (círculo navy+dourado+2 fitas pequenas) usam a mesma faixa
  // vertical livre entre DATA_LOCAL e a linha de assinatura, pra nunca
  // colidir com o bloco de assinaturas (até 3 colunas de largura variável)
  // nem com o QR (canto inferior direito).
  if (isOuro) {
    const sealCx = W / 2, sealCy = 155, sealR = 18
    page.drawEllipse({ x: sealCx, y: sealCy, xScale: sealR, yScale: sealR, borderColor: ACCENT, borderWidth: 1.6, color: undefined })
    page.drawRectangle({ x: sealCx - 4, y: sealCy - 4, width: 8, height: 8, rotate: degrees(45), color: ACCENT })
    const ribbonW = 7, ribbonH = 24, ribbonTopY = sealCy - sealR + 2
    page.drawRectangle({ x: sealCx - 9, y: ribbonTopY - ribbonH, width: ribbonW, height: ribbonH, color: BURGUNDY, rotate: degrees(-14) })
    page.drawRectangle({ x: sealCx + 2, y: ribbonTopY - ribbonH, width: ribbonW, height: ribbonH, color: BURGUNDY, rotate: degrees(14) })
  } else if (isModerno) {
    const sealCx = W / 2, sealCy = 155, sealR = 20
    page.drawEllipse({ x: sealCx, y: sealCy, xScale: sealR, yScale: sealR, borderColor: MODERNO_GOLD_RGB, borderWidth: 2.4, color: ACCENT })
    page.drawText('*', { x: sealCx - 4, y: sealCy - 7, size: 16, font: helveticaBold, color: MODERNO_GOLD_RGB })
    const ribbonW = 6, ribbonH = 16, ribbonTopY = sealCy - sealR + 2
    page.drawRectangle({ x: sealCx - 8, y: ribbonTopY - ribbonH, width: ribbonW, height: ribbonH, color: MODERNO_GOLD_RGB, rotate: degrees(-12) })
    page.drawRectangle({ x: sealCx + 2, y: ribbonTopY - ribbonH, width: ribbonW, height: ribbonH, color: MODERNO_GOLD_RGB, rotate: degrees(12) })
  } else if (isPrestigio) {
    // Selo centralizado acima da assinatura — mesmo padrão de Ouro/Moderno
    // (círculo + fitas), substitui o badge "TOP FESTIVAL" solto no canto.
    const sealCx = W / 2, sealCy = 155, sealR = 18
    page.drawEllipse({ x: sealCx, y: sealCy, xScale: sealR, yScale: sealR, borderColor: ACCENT, borderWidth: 1.6, color: PRESTIGIO_INK_RGB })
    page.drawRectangle({ x: sealCx - 4, y: sealCy - 4, width: 8, height: 8, rotate: degrees(45), color: ACCENT })
    const ribbonW = 7, ribbonH = 24, ribbonTopY = sealCy - sealR + 2
    page.drawRectangle({ x: sealCx - 9, y: ribbonTopY - ribbonH, width: ribbonW, height: ribbonH, color: PRESTIGIO_INK_RGB, rotate: degrees(-14) })
    page.drawRectangle({ x: sealCx + 2, y: ribbonTopY - ribbonH, width: ribbonW, height: ribbonH, color: PRESTIGIO_INK_RGB, rotate: degrees(14) })
  }

  // QR + texto de validação. 'oficial-dourado' NÃO depende da arte reservar
  // espaço nenhum — o código desenha o próprio cartão branco atrás do QR
  // (funciona em qualquer imagem nova, mesmo sem caixa desenhada por quem
  // fez a arte). Card no canto inferior direito, o mais próximo possível do
  // canto sem invadir nem a faixa navy (medida real: começa a ~88% da
  // altura, ~71px de baixo pra cima) nem o florão ornamental do canto
  // (~90-97% da largura) — fica na faixa livre entre os dois.
  const qrImage = await pdfDoc.embedPng(qrBytes)
  const qrSize = isOficial ? 68 : 80
  const qrX = isOficial ? 655 : W - qrSize - 60
  const qrY = isOficial ? 100 : 60
  const bodyFont = isOuro || isPrestigio || isOficial ? timesRoman : helvetica
  const boldFont = isOuro || isPrestigio || isOficial ? timesBold : helveticaBold
  const mutedColor = isOuro ? rgb(...hexToRgb(OURO_MUTED)) : isModerno ? rgb(...hexToRgb(MODERNO_MUTED)) : isPrestigio ? rgb(...hexToRgb(PRESTIGIO_MUTED)) : isOficial ? rgb(...hexToRgb(OFICIAL_MUTED)) : rgb(0.4, 0.4, 0.45)
  const inkColor = isOuro ? rgb(...hexToRgb(OURO_INK)) : isModerno ? rgb(...hexToRgb(MODERNO_DEFAULT_PRIMARY)) : isPrestigio ? PRESTIGIO_INK_RGB : isOficial ? rgb(...hexToRgb(OFICIAL_INK)) : rgb(0.04, 0.04, 0.06)
  if (isOficial) {
    const cardPad = 12
    page.drawRectangle({
      x: qrX - cardPad, y: qrY - 26, width: qrSize + cardPad * 2, height: qrSize + cardPad + 26,
      color: rgb(0.996, 0.992, 0.984), borderColor: rgb(...hexToRgb(OFICIAL_ACCENT)), borderWidth: 1.2,
    })
  }
  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize })
  const qrCaptionSize = isOficial ? 6 : 7
  const verifyLabel = 'Verifique a autenticidade:'
  const codeLabel = `Código: ${ctx.hash.slice(0, 8).toUpperCase()}`
  const verifyW = bodyFont.widthOfTextAtSize(verifyLabel, qrCaptionSize)
  const codeW = boldFont.widthOfTextAtSize(codeLabel, qrCaptionSize)
  const captionCenterX = qrX + verifyW / 2
  page.drawText(verifyLabel, { x: qrX, y: qrY - 12, size: qrCaptionSize, font: bodyFont, color: mutedColor })
  page.drawText(codeLabel, { x: captionCenterX - codeW / 2, y: qrY - 22, size: qrCaptionSize, font: boldFont, color: inkColor })

  // Assinaturas: linha + nome em negro + função/cargo em itálico colorido
  // (nova estrutura pareada signature_names + signature_titles, 2026-05-07).
  // 'oficial-dourado' sobe a linha — o selo dessa arte começa a ~74% da
  // altura (medido direto no arquivo, crop + inspeção visual).
  const sigNames: string[]  = Array.isArray(ctx.template?.signature_names)  ? ctx.template.signature_names  : []
  const sigTitles: string[] = Array.isArray(ctx.template?.signature_titles) ? ctx.template.signature_titles : []
  const sigCount = Math.min(sigNames.length, 3)
  if (sigCount > 0) {
    const sigGap = 220
    const startX = (W - sigGap * sigCount) / 2 + sigGap / 2 - 100
    const sigLineY = isOficial ? 215 : 110
    for (let i = 0; i < sigCount; i++) {
      const cx = startX + i * sigGap
      page.drawLine({ start: { x: cx, y: sigLineY }, end: { x: cx + 200, y: sigLineY }, thickness: 0.8, color: inkColor })
      const name  = sigNames[i] ?? ''
      const title = sigTitles[i] ?? ''
      const nameW = boldFont.widthOfTextAtSize(name, 10)
      page.drawText(name, { x: cx + (200 - nameW) / 2, y: sigLineY - 15, size: 10, font: boldFont, color: inkColor })
      if (title) {
        const titleFont = (isOuro || isOficial) ? timesItalic : helvetica
        const titleW = titleFont.widthOfTextAtSize(title, 8)
        page.drawText(title, { x: cx + (200 - titleW) / 2, y: sigLineY - 28, size: 8, font: titleFont, color: mutedColor })
      }
    }
  }

  // Footer. 'oficial-dourado' sobe bastante — a faixa navy cobre a base
  // inteira da página (y=50 caía dentro dela, texto escuro em cima de fundo
  // navy ficava ilegível); aqui fica no vão entre o topo do selo (~156px) e
  // a linha de assinatura (sigLineY), único trecho de papel livre por perto.
  const footer = 'Emitido por CoreoHub — Gestão Inteligente para Festivais de Dança'
  const footerSize = isOficial ? 7 : 8
  const footerY = isOficial ? 163 : 50
  const fW = bodyFont.widthOfTextAtSize(footer, footerSize)
  page.drawText(footer, { x: (W - fW) / 2, y: footerY, size: footerSize, font: bodyFont, color: mutedColor })

  // Marca d'água diagonal só no preview — o QR desse PDF aponta pra um hash
  // fictício que nunca é gravado em certificates_issued, então escaneá-lo
  // sempre dá "não encontrado". Sem isso, quem testa o QR de um preview
  // acha que é bug/certificado falso em vez de amostra.
  if (ctx.is_preview) {
    const wmText = 'AMOSTRA — NÃO É UM CERTIFICADO OFICIAL'
    const wmSize = 26
    const wmW = helveticaBold.widthOfTextAtSize(wmText, wmSize)
    page.drawText(wmText, {
      x: W / 2 - wmW / 2, y: H / 2 - wmSize / 2, size: wmSize, font: helveticaBold,
      color: rgb(0.85, 0.1, 0.35), opacity: 0.28, rotate: degrees(28),
    })
  }

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
        is_preview: true,
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
