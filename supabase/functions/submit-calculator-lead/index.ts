// Edge Function: submit-calculator-lead
//
// Recebe o lead da calculadora "Simule seu festival" (LandingPage.tsx,
// coreohub.com — página pública, sem login). Grava em `calculator_leads`
// via service_role (RLS não libera INSERT anônimo direto de propósito —
// evita spam/scraping direto na tabela) e espelha best-effort numa planilha
// Google via webhook do Apps Script (CALCULATOR_LEADS_SHEETS_WEBHOOK_URL),
// se configurado. Supabase é sempre a fonte de verdade — falha no espelho
// nunca derruba o insert real. Ver docs/pricing-model-spec.md, seção
// "Calculadora pública (site CoreoHub)".
//
// Body POST JSON:
// {
//   nome_festival: string,
//   whatsapp: string,               // com ou sem máscara, normalizado aqui
//   numero_coreografias: number,
//   media_bailarinos_coreografia: number,
//   ticket_medio: number,
//   participantes_estimados: number,
//   faturamento_estimado: number,
//   faixa_recomendada: 'comeco' | 'essencial' | 'escala',
//   valor_estimado: number,
//   origem?: string,
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const FAIXAS = ['comeco', 'essencial', 'escala']

function toPositiveNumber(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const nomeFestival = typeof body.nome_festival === 'string' ? body.nome_festival.trim() : ''
  const whatsappDigits = typeof body.whatsapp === 'string' ? body.whatsapp.replace(/\D/g, '') : ''
  const faixaRecomendada = typeof body.faixa_recomendada === 'string' ? body.faixa_recomendada : ''

  const numeroCoreografias = toPositiveNumber(body.numero_coreografias)
  const mediaBailarinos = toPositiveNumber(body.media_bailarinos_coreografia)
  const ticketMedio = toPositiveNumber(body.ticket_medio)
  const participantesEstimados = toPositiveNumber(body.participantes_estimados)
  const faturamentoEstimado = toPositiveNumber(body.faturamento_estimado)
  const valorEstimado = toPositiveNumber(body.valor_estimado)

  if (!nomeFestival || nomeFestival.length > 200) {
    return json({ error: 'nome_festival_invalido' }, 400)
  }
  if (whatsappDigits.length < 10 || whatsappDigits.length > 13) {
    return json({ error: 'whatsapp_invalido' }, 400)
  }
  if (!FAIXAS.includes(faixaRecomendada)) {
    return json({ error: 'faixa_recomendada_invalida' }, 400)
  }
  if (
    numeroCoreografias === null || mediaBailarinos === null || ticketMedio === null ||
    participantesEstimados === null || faturamentoEstimado === null || valorEstimado === null
  ) {
    return json({ error: 'valores_numericos_invalidos' }, 400)
  }

  const origem = typeof body.origem === 'string' ? body.origem.slice(0, 200) : null

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500)

  const supa = createClient(supabaseUrl, serviceKey)

  const { data: inserted, error } = await supa
    .from('calculator_leads')
    .insert({
      nome_festival: nomeFestival,
      whatsapp: whatsappDigits,
      numero_coreografias: Math.round(numeroCoreografias),
      media_bailarinos_coreografia: mediaBailarinos,
      ticket_medio: ticketMedio,
      participantes_estimados: Math.round(participantesEstimados),
      faturamento_estimado: faturamentoEstimado,
      faixa_recomendada: faixaRecomendada,
      valor_estimado: valorEstimado,
      origem,
    })
    .select('id, created_at')
    .single()

  if (error || !inserted) {
    return json({ error: 'db_error', detail: error?.message }, 500)
  }

  // Espelhamento best-effort na planilha Google (Apps Script Web App).
  // Nunca bloqueia nem falha a resposta pro lead — é só um espelho pra
  // acompanhamento manual/comercial, Supabase é a fonte de verdade.
  const sheetsWebhookUrl = Deno.env.get('CALCULATOR_LEADS_SHEETS_WEBHOOK_URL')
  if (sheetsWebhookUrl) {
    try {
      const resp = await fetch(sheetsWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          created_at: inserted.created_at,
          nome_festival: nomeFestival,
          whatsapp: whatsappDigits,
          numero_coreografias: Math.round(numeroCoreografias),
          media_bailarinos_coreografia: mediaBailarinos,
          ticket_medio: ticketMedio,
          participantes_estimados: Math.round(participantesEstimados),
          faturamento_estimado: faturamentoEstimado,
          faixa_recomendada: faixaRecomendada,
          valor_estimado: valorEstimado,
          origem: origem ?? '',
        }),
      })
      if (resp.ok) {
        await supa
          .from('calculator_leads')
          .update({ sheet_synced_at: new Date().toISOString() })
          .eq('id', inserted.id)
      }
    } catch {
      // best-effort — falha no espelho não afeta o lead já salvo
    }
  }

  return json({ ok: true, id: inserted.id })
})
