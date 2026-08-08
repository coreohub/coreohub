// Cria UMA cobrança Asaas agregando N registrations PENDENTES do mesmo inscrito
// no mesmo evento. Padrão B (festivais BR): inscrito acumula coreografias em
// fiado e paga 1 PIX no final → economiza R$ 1,99 × (N-1) em taxas Asaas.
//
// Co-existe com create-payment-asaas (fluxo legacy 1-registration → 1-cobrança).
// Webhook detecta este fluxo via externalReference prefix "AGG:".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, resolveOrigin } from '../_shared/cors.ts'
import { ensureNotificationDisabled } from '../_shared/asaas-customer.ts'

type RegistrationRow = {
  id:                    string
  user_id:               string
  bailarinos_detalhes?:  any[] | null
  event_id:              string
  nome_coreografia:      string | null
  status_pagamento:      string
  payment_group_id:      string | null
  mod_fee:               number | null
  // Schema atual usa formato_participacao / tipo_apresentacao. Colunas
  // antigas (formacao/modalidade) sumiram em renames — não selecionamos
  // mais (select com coluna inexistente quebra a query inteira).
  formato_participacao:  string | null
  tipo_apresentacao:     string | null
}

function pickFormacao(r: RegistrationRow): string {
  return (r.formato_participacao ?? r.tipo_apresentacao ?? '')
}

function pickActiveLote(formacao: any): { preco: number; data_virada: string | null } | null {
  // Espelha a lógica de create-payment-asaas — primeiro lote cuja data_virada
  // ainda não passou (ou sem data, considerado ativo). Se TODOS expiraram,
  // retorna null (caller decide se trava ou usa baseFee config).
  const lotes: Array<{ preco: number; data_virada: string | null }> = formacao?.lotes ?? []
  if (lotes.length === 0) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (const lot of lotes) {
    if (!lot.data_virada) return lot
    const d = new Date(lot.data_virada + 'T23:59:59')
    if (d.getTime() >= today.getTime()) return lot
  }
  return null  // todos expiraram
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  const ALLOWED_ORIGIN = resolveOrigin(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { registration_ids, event_id, coupon_code } = await req.json() as {
      registration_ids?: string[]
      event_id?: string
      coupon_code?: string
    }

    if (!event_id) throw new Error('event_id é obrigatório.')
    if (!Array.isArray(registration_ids) || registration_ids.length === 0) {
      throw new Error('registration_ids deve conter pelo menos 1 inscrição.')
    }

    // A3 (audit): em PROD jamais fazer fallback pra sandbox — secret faltando
    // significa erro de deploy, não modo degradado. Sem fallback silencioso em
    // código que toca dinheiro.
    const ASAAS_API_KEY  = Deno.env.get('ASAAS_API_KEY')  ?? ''
    const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') ?? ''
    if (!ASAAS_API_KEY || !ASAAS_BASE_URL) {
      throw new Error('Configuração inválida: ASAAS_API_KEY/ASAAS_BASE_URL não setados.')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // ── 1. Auth + ownership do caller ──────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) throw new Error('Não autorizado.')

    // ── 2. Carregar registrations + validar ────────────────────────────────
    const { data: regsRaw, error: regsErr } = await supabase
      .from('registrations')
      .select(`
        id, user_id, event_id,
        nome_coreografia, formato_participacao, tipo_apresentacao,
        mod_fee, status_pagamento, payment_group_id,
        bailarinos_detalhes
      `)
      .in('id', registration_ids)

    if (regsErr) throw new Error(`Erro ao carregar inscrições: ${regsErr.message}`)
    const regs = (regsRaw ?? []) as RegistrationRow[]

    if (regs.length !== registration_ids.length) {
      throw new Error('Uma ou mais inscrições não foram encontradas.')
    }
    // Coleta payment_group_ids potencialmente "fantasmas" pra batch-check
    // antes do loop de validação. Cenário: user clicou PAGAR TUDO → cancelou
    // (UI ou direto via webhook) → clicou PAGAR SÓ ESTA → registration ainda
    // carrega payment_group_id antigo apontando pra payment já CANCELADO.
    // Antes: erro "já está em fatura agregada" travava o user.
    // Agora: detectamos payment morto + zeramos o ponteiro + seguimos.
    const ghostGroupIds = [...new Set(regs.map(r => r.payment_group_id).filter(Boolean))] as string[]
    const ghostMap: Record<string, string> = {}
    if (ghostGroupIds.length > 0) {
      const { data: paymentsStatus } = await supabase
        .from('payments')
        .select('id, status')
        .in('id', ghostGroupIds)
      for (const p of (paymentsStatus ?? [])) ghostMap[p.id] = p.status
    }

    const ghostsToClear: string[] = []
    for (const r of regs) {
      if (r.user_id !== user.id) {
        throw new Error('Sem permissão: inscrição não pertence ao usuário autenticado.')
      }
      if (r.event_id !== event_id) {
        throw new Error('Todas as inscrições devem ser do mesmo evento.')
      }
      if (r.status_pagamento !== 'PENDENTE') {
        throw new Error(`Inscrição "${r.nome_coreografia ?? r.id}" já está em status ${r.status_pagamento}.`)
      }
      if (r.payment_group_id) {
        const status = ghostMap[r.payment_group_id]
        // Payment ATIVO (PENDENTE/APROVADO) — não deixa criar nova fatura.
        if (status === 'PENDENTE' || status === 'APROVADO') {
          throw new Error(
            `Inscrição "${r.nome_coreografia ?? r.id}" já está em uma fatura agregada ativa. ` +
            'Cancele ou pague a fatura existente antes de gerar uma nova.'
          )
        }
        // Payment morto (CANCELADO/VENCIDO/ESTORNADO/EXPIRADO) OU ponteiro
        // órfão (payment foi deletado). Marca pra zerar o ponteiro abaixo.
        ghostsToClear.push(r.id)
      }
    }

    // Zera ponteiros fantasmas antes de prosseguir. Service_role bypassa
    // trigger protect_registrations_status_columns.
    if (ghostsToClear.length > 0) {
      const { error: ghostErr } = await supabase
        .from('registrations')
        .update({
          payment_group_id:      null,
          payment_url:           null,
          payment_preference_id: null,
          charged_amount:        null,
          coupon_id:             null,
        })
        .in('id', ghostsToClear)
        .select('id')
      if (ghostErr) {
        console.warn(`[create-aggregate-payment-asaas] erro limpar ghosts:`, ghostErr.message)
      } else {
        console.log(`[create-aggregate-payment-asaas] limpou ${ghostsToClear.length} ponteiro(s) fantasma(s)`)
      }
    }

    // ── 3. Perfil do inscrito + evento + configurações ─────────────────────
    const [{ data: inscritoProfile }, { data: event }, { data: config }] = await Promise.all([
      supabase.from('profiles').select('full_name, email, cpf_cnpj').eq('id', user.id).single(),
      supabase.from('events')
        .select('id, name, created_by, commission_percent, commission_type, formacoes_config, fee_mode, event_type')
        .eq('id', event_id).single(),
      supabase.from('configuracoes')
        .select('event_id, formatos_precos, prazo_inscricao')
        .eq('event_id', event_id).maybeSingle(),
    ])

    if (!event) throw new Error('Evento não encontrado.')
    if (event.event_type === 'government') {
      throw new Error('Eventos governamentais não usam pagamento.')
    }

    // A4 (audit): fail-fast em CPF/CNPJ ausente. Asaas rejeita criação de
    // payment sem cpfCnpj no customer e a UX fica péssima (espera 5s + erro
    // após payment row + linking criados). Validamos antes de qualquer write.
    const cpfRaw = inscritoProfile?.cpf_cnpj?.replace(/\D/g, '') ?? ''
    if (!cpfRaw) {
      return respond(422, {
        error:           'CPF/CNPJ obrigatório pra gerar pagamento.',
        error_code:      'CPF_REQUIRED',
        action_required: 'complete_profile',
        redirect_to:     '/meu-perfil',
      })
    }

    // A2 (audit): se o deadline do festival já passou ou está a menos de 1
    // dia, não dá pra gerar fatura — risco de race entre cron de expiração e
    // confirmação Asaas.
    let expiresAt: string | null = null
    if (config?.prazo_inscricao) {
      const d = new Date(config.prazo_inscricao + 'T23:59:59')
      if (!isNaN(d.getTime())) {
        if (d.getTime() < Date.now()) {
          throw new Error('Inscrições encerradas: prazo do festival já passou.')
        }
        expiresAt = d.toISOString()
      }
    }

    // ── 4. Wallet do produtor ──────────────────────────────────────────────
    const { data: producer } = await supabase
      .from('profiles')
      .select('asaas_wallet_id, full_name')
      .eq('id', event.created_by)
      .single()
    if (!producer?.asaas_wallet_id) {
      throw new Error(
        'O produtor ainda não conectou sua conta Asaas. Não é possível gerar pagamento.'
      )
    }

    // ── 5. Calcular preço por registration (espelha create-payment-asaas) ──
    const formatosCfg: any[]    = config?.formatos_precos ?? []
    const eventFormacoes: any[] = (event as any).formacoes_config ?? []
    const commissionPercent     = Number(event.commission_percent ?? 10)
    const feeMode               = (event as any).fee_mode ?? 'repassar'

    type Priced = {
      reg:        RegistrationRow
      baseFee:    number      // preço base (modalidade/lote/mod_fee)
      charged:    number      // o que o inscrito paga
      producer:   number      // valor pro produtor (split fixedValue)
      commission: number      // comissão CoreoHub
      formacao:   string
    }
    const priced: Priced[] = []

    for (const r of regs) {
      const formacaoNome = pickFormacao(r)
      const formatoConfig = formacaoNome
        ? formatosCfg.find((f: any) => f.nome?.toLowerCase() === formacaoNome.toLowerCase())
        : undefined
      const formatoEvento = formacaoNome
        ? eventFormacoes.find((m: any) => m.name?.toLowerCase() === formacaoNome.toLowerCase())
        : undefined
      const primeiraFormacao = eventFormacoes.find((m: any) => m.is_active !== false)

      let baseFee: number =
        (r.mod_fee && r.mod_fee > 0)
          ? Number(r.mod_fee)
          : formatoConfig?.preco
          ?? formatoEvento?.fee
          ?? formatoEvento?.base_fee
          ?? primeiraFormacao?.fee
          ?? primeiraFormacao?.base_fee
          ?? 0

      // Lote ativo da formação (preço pode ter mudado entre criação da inscrição
      // e geração da fatura — usamos o lote ATIVO HOJE, mesma regra do fluxo
      // single-registration. Se a inscrição tinha mod_fee fixado, ele vence.
      const formacaoEscolhida: any = formatoEvento ?? primeiraFormacao
      if (!(r.mod_fee && r.mod_fee > 0)) {
        const lot = pickActiveLote(formacaoEscolhida)
        if (lot && lot.preco > 0) baseFee = lot.preco
        else if ((formacaoEscolhida?.lotes?.length ?? 0) > 0 && !lot) {
          throw new Error(
            `Inscrições encerradas: todos os lotes da formação "${formacaoNome}" venceram.`
          )
        }
      }

      // pricing_type PER_MEMBER → fee × bailarinos. Default FIXED preserva legado.
      const pricingType: 'FIXED' | 'PER_MEMBER' = formacaoEscolhida?.pricing_type ?? 'FIXED'
      const bailarinosCount = Array.isArray((r as any).bailarinos_detalhes)
        ? (r as any).bailarinos_detalhes.length
        : 1
      const feeUnit = baseFee
      if (pricingType === 'PER_MEMBER' && bailarinosCount > 1) {
        baseFee = parseFloat((baseFee * bailarinosCount).toFixed(2))
      }

      // baseFee=0 é válido quando a formação foi explicitamente configurada
      // como gratuita (fee/base_fee/lote a 0) — só é erro de configuração
      // quando NÃO existe formação nenhuma resolvida pro cálculo (evento sem
      // formacoes_config, ou nome de formação que não bate com nada ativo).
      if (!formacaoEscolhida) {
        throw new Error(
          `Formação "${formacaoNome || 'padrão'}" não está configurada para este evento ` +
          `(inscrição ${r.nome_coreografia ?? r.id}).`
        )
      }

      const commissionAmount = parseFloat((baseFee * (commissionPercent / 100)).toFixed(2))
      const chargedAmount = feeMode === 'repassar'
        ? parseFloat((baseFee + commissionAmount).toFixed(2))
        : baseFee
      const producerAmount = feeMode === 'repassar'
        ? baseFee
        : parseFloat((baseFee - commissionAmount).toFixed(2))

      priced.push({
        reg: r,
        baseFee,
        charged:    chargedAmount,
        producer:   producerAmount,
        commission: commissionAmount,
        formacao:   formacaoNome || 'padrão',
      })
    }

    // ── 5b. Aplicar cupom (se informado) ───────────────────────────────────
    // Cupom reduz baseFee de cada registration linearmente (proporcional ao
    // baseFee individual). Replica o comportamento do create-payment-asaas
    // legacy: produtor absorve o desconto (ganha menos) e comissão também
    // cai proporcionalmente. Inscrito paga menos.
    //
    // Filtro multi-scope (migration 20260615): cupom aceito se 'inscription'
    // está no array scopes OU se scope legacy ainda aponta pra
    // inscription/both/all. Período de transição pós-migration scopes TEXT[].
    let validatedCoupon: any = null
    let discountTotal = 0
    if (coupon_code && String(coupon_code).trim()) {
      const normalizedCode = String(coupon_code).trim().toUpperCase()
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('event_id', event_id)
        .ilike('code', normalizedCode)
        .eq('is_active', true)
        .or('scopes.cs.{inscription},scope.in.(inscription,both,all)')
        .maybeSingle()
      if (!coupon) throw new Error('Cupom inválido ou inativo.')
      if (coupon.expires_at && new Date(coupon.expires_at + 'T23:59:59').getTime() < Date.now()) {
        throw new Error('Cupom expirado.')
      }
      if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
        throw new Error('Cupom esgotado.')
      }
      // Limite por inscrito (20260605). Conta payments do mesmo user+coupon
      // ainda ativos (PENDENTE) ou já pagos (APROVADO). Bloqueia re-uso.
      if (coupon.max_uses_per_user != null) {
        const { count } = await supabase
          .from('payments')
          .select('id', { count: 'exact', head: true })
          .eq('coupon_id', coupon.id)
          .eq('user_id', user.id)
          .in('status', ['APROVADO', 'PENDENTE'])
        if ((count ?? 0) >= coupon.max_uses_per_user) {
          throw new Error(`Você já usou este cupom o limite permitido (${coupon.max_uses_per_user}x).`)
        }
      }
      validatedCoupon = coupon

      // Soma baseFee de todas as registrations pra distribuir desconto
      // proporcional. Em cupom 'fixed', limite no baseFee total pra não
      // ficar negativo. Em 'percent', aplica o % igual em cada baseFee.
      const baseFeeSum = priced.reduce((s, p) => s + p.baseFee, 0)
      const totalDiscount = coupon.discount_type === 'percent'
        ? parseFloat((baseFeeSum * (Number(coupon.discount_value) / 100)).toFixed(2))
        : Math.min(Number(coupon.discount_value), baseFeeSum)

      // Distribui linearmente. Última registration absorve o rounding diff.
      let allocated = 0
      for (let i = 0; i < priced.length; i++) {
        const p = priced[i]
        const isLast = i === priced.length - 1
        const share = isLast
          ? parseFloat((totalDiscount - allocated).toFixed(2))
          : parseFloat((totalDiscount * (p.baseFee / baseFeeSum)).toFixed(2))
        allocated = parseFloat((allocated + share).toFixed(2))

        const newBase = parseFloat(Math.max(0, p.baseFee - share).toFixed(2))
        const newCommission = parseFloat((newBase * (commissionPercent / 100)).toFixed(2))
        const newCharged = feeMode === 'repassar'
          ? parseFloat((newBase + newCommission).toFixed(2))
          : newBase
        const newProducer = feeMode === 'repassar'
          ? newBase
          : parseFloat((newBase - newCommission).toFixed(2))

        priced[i] = {
          ...p,
          baseFee:    newBase,
          charged:    newCharged,
          producer:   newProducer,
          commission: newCommission,
        }
      }
      discountTotal = totalDiscount
    }

    const valueTotal      = parseFloat(priced.reduce((s, p) => s + p.charged,    0).toFixed(2))
    const producerTotal   = parseFloat(priced.reduce((s, p) => s + p.producer,   0).toFixed(2))
    const commissionTotal = parseFloat(priced.reduce((s, p) => s + p.commission, 0).toFixed(2))

    console.log(
      `[create-aggregate-payment-asaas] user=${user.id} event=${event_id} N=${priced.length}` +
      ` valueTotal=${valueTotal} producerTotal=${producerTotal} commissionTotal=${commissionTotal} mode=${feeMode}` +
      (validatedCoupon ? ` coupon=${validatedCoupon.code} discount=${discountTotal}` : '')
    )

    // ── 5c. Carrinho gratuito (valueTotal === 0) — aprova direto, sem Asaas ──
    // Evento com todas as formações a R$0 (contrato fechado com a CoreoHub,
    // "governo", grandfathered, etc — o MOTIVO não importa aqui) OU cupom
    // 100% zerando o total. Asaas não aceita cobrança de R$0, e não faz
    // sentido gerar fatura pra valor nulo. Espelha o atalho que já existia
    // no Checkout.tsx legacy (handleConfirmFree) pro fluxo single, agora
    // pro carrinho agregado — sem isso a inscrição fica PENDENTE pra sempre.
    if (valueTotal === 0) {
      const nowIso = new Date().toISOString()
      // Mesmo valor pra toda registration do grupo (todas ficam a R$0 e
      // compartilham o mesmo cupom, se houver) — 1 UPDATE só via .in(), não
      // um loop de N updates.
      const { error: freeErr } = await supabase
        .from('registrations')
        .update({
          status_pagamento:   'APROVADO',
          valor_pago:         0,
          charged_amount:     0,
          coupon_id:          validatedCoupon?.id ?? null,
          coupon_redeemed_at: validatedCoupon ? nowIso : null,
        })
        .in('id', priced.map(p => p.reg.id))
      if (freeErr) {
        throw new Error(`Erro ao confirmar inscrição gratuita: ${freeErr.message}`)
      }
      // Incremento único do cupom (não por registration — mesmo padrão
      // idempotente do webhook, só que aqui não existe webhook pra disparar).
      if (validatedCoupon) {
        const { data: couponRow } = await supabase
          .from('coupons')
          .select('used_count')
          .eq('id', validatedCoupon.id)
          .single()
        await supabase
          .from('coupons')
          .update({ used_count: Number(couponRow?.used_count ?? 0) + 1 })
          .eq('id', validatedCoupon.id)
      }
      return respond(200, {
        free:             true,
        registration_ids: priced.map(p => p.reg.id),
      })
    }

    // ── 6. Criar payment row PRIMEIRO (pra ter o UUID pro externalReference) ──
    // expiresAt já calculado no bloco de validação acima (A2).

    const { data: paymentRow, error: payInsErr } = await supabase
      .from('payments')
      .insert({
        user_id:           user.id,
        event_id:          event_id,
        value_total:       valueTotal,
        commission_total:  commissionTotal,
        producer_total:    producerTotal,
        discount_total:    discountTotal,
        coupon_id:         validatedCoupon?.id ?? null,
        status:            'PENDENTE',
        expires_at:        expiresAt,
      })
      .select('id')
      .single()

    if (payInsErr || !paymentRow) {
      throw new Error(`Erro ao criar payment: ${payInsErr?.message ?? 'unknown'}`)
    }
    const paymentId = paymentRow.id as string

    // ── 7. Linkar registrations atomicamente ao payment_group_id ──────────
    // A1 (audit): race condition — UPDATE com filtro payment_group_id IS NULL.
    // Se outra request linkou as mesmas registrations no meio do caminho, o
    // count retornado vai divergir e fazemos rollback.
    // A6 (audit): também grava charged_amount por inscrição — snapshot pro
    // webhook distribuir comissão proporcional (quando preços diferem).
    const linkErrors: string[] = []
    for (const p of priced) {
      const { data: row, error } = await supabase
        .from('registrations')
        .update({
          payment_group_id: paymentId,
          charged_amount:   p.charged,
          // Snapshot do cupom + desconto distribuído proporcionalmente. Webhook
          // usa esses valores pra commission_amount per registration sem
          // precisar recalcular cupom (idempotente).
          coupon_id:        validatedCoupon?.id ?? null,
        })
        .eq('id', p.reg.id)
        .is('payment_group_id', null)
        .select('id')
        .maybeSingle()
      if (error || !row) linkErrors.push(p.reg.id)
    }

    if (linkErrors.length > 0) {
      // Race detectada ou erro de update. Rollback completo.
      await supabase
        .from('registrations')
        .update({ payment_group_id: null, charged_amount: null })
        .eq('payment_group_id', paymentId)
      await supabase.from('payments').delete().eq('id', paymentId)
      throw new Error(
        `Não foi possível agrupar ${linkErrors.length} inscrição(ões). ` +
        'Provavelmente foram agrupadas em outra fatura no meio do caminho. Tente novamente.'
      )
    }

    // ── 8. Criar/reutilizar customer Asaas ──────────────────────────────────
    // Helper: parseia JSON com fallback ao texto bruto (Asaas pode devolver
    // HTML em 404/maintenance, e .json() direto explodiria com "Unexpected token <").
    const safeJson = async (res: Response): Promise<{ ok: boolean; data: any; raw?: string }> => {
      const text = await res.text()
      try {
        return { ok: res.ok, data: text ? JSON.parse(text) : {} }
      } catch {
        return { ok: false, data: {}, raw: text.slice(0, 300) }
      }
    }

    const asaasHeaders = {
      'access_token':  ASAAS_API_KEY,
      'Content-Type':  'application/json',
    }
    // cpfLimpo veio do bloco A4 acima (já garantido não-vazio).
    let customerId: string | undefined
    const cpfLimpo = cpfRaw
    if (cpfLimpo) {
      const searchRes  = await fetch(`${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfLimpo}&limit=1`, { headers: asaasHeaders })
      const parsed = await safeJson(searchRes)
      if (!parsed.ok && parsed.raw) {
        console.error(`[create-aggregate-payment-asaas] search customer não-JSON status=${searchRes.status} raw=${parsed.raw}`)
      }
      const found = parsed.data?.data?.[0]
      customerId = found?.id
      await ensureNotificationDisabled(ASAAS_BASE_URL, asaasHeaders, found)
    }
    if (!customerId) {
      const custRes = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify({
          name:                 inscritoProfile?.full_name ?? 'Inscrito',
          email:                inscritoProfile?.email ?? '',
          ...(cpfLimpo ? { cpfCnpj: cpfLimpo } : {}),
          notificationDisabled: true,
        }),
      })
      const parsed = await safeJson(custRes)
      if (!parsed.ok) {
        console.error(
          `[create-aggregate-payment-asaas] create customer falhou status=${custRes.status}` +
          ` body=${parsed.raw ?? JSON.stringify(parsed.data).slice(0, 300)}`
        )
        await rollback(supabase, paymentId, registration_ids)
        throw new Error(parsed.data?.errors?.[0]?.description ?? `Erro Asaas customer (HTTP ${custRes.status})`)
      }
      customerId = parsed.data.id
    }

    // ── 9. Criar cobrança Asaas com split ──────────────────────────────────
    // A2 (audit): dueDate = min(+3 dias, expires_at). Pra não criar fatura
    // cuja data de vencimento ultrapasse o deadline do festival.
    const defaultDueDate = new Date()
    defaultDueDate.setDate(defaultDueDate.getDate() + 3)
    const expiresAtDate = expiresAt ? new Date(expiresAt) : null
    const dueDate = (expiresAtDate && expiresAtDate.getTime() < defaultDueDate.getTime())
      ? expiresAtDate
      : defaultDueDate
    const dueDateStr = dueDate.toISOString().split('T')[0]

    const descricaoCoreos = priced
      .slice(0, 3)
      .map(p => p.reg.nome_coreografia ?? 'Coreografia')
      .join(', ')
    const description = priced.length <= 3
      ? `${priced.length} coreografia(s): ${descricaoCoreos} | ${event.name}`
      : `${priced.length} coreografias: ${descricaoCoreos}... | ${event.name}`

    const basePayload = {
      customer:          customerId,
      billingType:       'UNDEFINED',
      value:             valueTotal,
      dueDate:           dueDateStr,
      description,
      externalReference: `AGG:${paymentId}`,
      split: [
        { walletId: producer.asaas_wallet_id, fixedValue: producerTotal },
      ],
    }
    const callbackPayload = {
      successUrl:   `${ALLOWED_ORIGIN}/pagamento-sucesso?ref=${encodeURIComponent(paymentId)}`,
      autoRedirect: true,
    }
    // A8 (audit): NÃO logar payload bruto (contém customer CPF/email + walletId
    // do produtor). Log resumido — info suficiente pra debug sem secrets.
    console.log(
      `[create-aggregate-payment-asaas] POST /payments value=${valueTotal} dueDate=${dueDateStr}` +
      ` externalRef=AGG:${paymentId} split=${producerTotal}`
    )

    let payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders,
      body: JSON.stringify({ ...basePayload, callback: callbackPayload }),
    })
    let payParsed = await safeJson(payRes)

    // Fallback: subconta sem domínio nas Informações Comerciais → retry sem callback.
    if (!payParsed.ok && isDomainCallbackError(payParsed.data)) {
      console.warn('[create-aggregate-payment-asaas] subconta sem dominio cadastrado, retry sem callback')
      payRes = await fetch(`${ASAAS_BASE_URL}/payments`, {
        method: 'POST',
        headers: asaasHeaders,
        body: JSON.stringify(basePayload),
      })
      payParsed = await safeJson(payRes)
    }

    if (!payParsed.ok) {
      console.error(
        `[create-aggregate-payment-asaas] create payment falhou status=${payRes.status}` +
        ` body=${payParsed.raw ?? JSON.stringify(payParsed.data).slice(0, 500)}`
      )
      await rollback(supabase, paymentId, registration_ids)
      throw new Error(payParsed.data?.errors?.[0]?.description ?? `Erro Asaas payment (HTTP ${payRes.status})`)
    }
    const payData = payParsed.data

    // ── 10. Persistir asaas_payment_id + url no payment row ────────────────
    const { error: updPayErr } = await supabase
      .from('payments')
      .update({
        asaas_payment_id: payData.id,
        payment_url:      payData.invoiceUrl,
      })
      .eq('id', paymentId)
    if (updPayErr) {
      console.warn('[create-aggregate-payment-asaas] update payment parcial:', updPayErr.message)
    }

    // Também espelha a url/preference no registrations (UI existente lê dali pra
    // mostrar "Pagar" — mantemos compat até a UI nova de /minhas-coreografias
    // entrar em produção). status_pagamento fica PENDENTE até webhook chegar.
    await supabase
      .from('registrations')
      .update({
        payment_preference_id: payData.id,
        payment_url:           payData.invoiceUrl,
      })
      .in('id', registration_ids)

    // Refator (b) 2026-06-01: incremento de `used_count` movido pro webhook
    // PAYMENT_RECEIVED (branch AGG em asaas-webhook). Antes incrementava aqui
    // na CRIAÇÃO — cupom contava como usado mesmo se inscrito cancelasse OU
    // se a fatura Asaas falhasse depois. Idempotência via
    // payments.coupon_redeemed_at (marker setado no webhook).

    // A10 (audit): email de confirmação da criação da fatura. Best-effort —
    // falha não bloqueia o fluxo principal (UI já tem a invoice_url no response).
    try {
      const { data: produtorProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', event.created_by)
        .maybeSingle()

      // A11 auditoria Sessão 3: forçar timeZone pra evitar off-by-one em UTC.
      const expiresAtFmt = expiresAt
        ? new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit', month: 'long', year: 'numeric',
            timeZone: 'America/Sao_Paulo',
          }).format(new Date(expiresAt))
        : undefined

      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
      if (supabaseUrl && serviceKey && inscritoProfile?.email) {
        fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'aggregate_invoice_created',
            payload: {
              inscritoNome:  inscritoProfile.full_name,
              inscritoEmail: inscritoProfile.email,
              produtorEmail: produtorProfile?.email,
              eventoNome:    event.name,
              invoiceUrl:    payData.invoiceUrl,
              valorTotal:    valueTotal,
              expiresAt:     expiresAtFmt,
              coreografias:  priced.map(p => ({
                nome:     p.reg.nome_coreografia ?? 'Coreografia',
                formacao: p.formacao,
                charged:  p.charged,
              })),
              appUrl:        Deno.env.get('FRONTEND_URL') ?? 'https://app.coreohub.com',
            },
          }),
        }).catch(err => console.warn('[create-aggregate-payment-asaas] email criação falhou:', err?.message ?? err))
      }
    } catch (emailErr) {
      console.warn('[create-aggregate-payment-asaas] bloco email falhou:', (emailErr as Error).message)
    }

    return new Response(
      JSON.stringify({
        payment_id:        paymentId,
        asaas_payment_id:  payData.id,
        invoice_url:       payData.invoiceUrl,
        value_total:       valueTotal,
        producer_total:    producerTotal,
        commission_total:  commissionTotal,
        discount_total:    discountTotal,
        coupon_code:       validatedCoupon?.code ?? null,
        registration_count: priced.length,
        fee_mode:          feeMode,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[create-aggregate-payment-asaas] erro:', error.message)
    return respond(400, { error: error.message })
  }
})

// Best-effort rollback quando a cobrança Asaas falha depois do payment row
// já ter sido criado. Desfaz o link nas registrations e deleta o payment.
// FK ON DELETE SET NULL faz o registrations.payment_group_id virar NULL,
// mas pra ficar explícito (e funcionar se a FK mudar) fazemos UPDATE primeiro.
async function rollback(supabase: any, paymentId: string, registrationIds: string[]) {
  try {
    await supabase
      .from('registrations')
      .update({ payment_group_id: null })
      .in('id', registrationIds)
    await supabase.from('payments').delete().eq('id', paymentId)
  } catch (e) {
    console.error('[create-aggregate-payment-asaas] rollback falhou:', (e as Error).message)
  }
}

// Detecta a recusa específica do Asaas quando subconta não tem domínio
// cadastrado em Informações Comerciais.
function isDomainCallbackError(payData: any): boolean {
  if (!payData?.errors || !Array.isArray(payData.errors)) return false
  return payData.errors.some((e: any) => {
    const desc = String(e?.description ?? '').toLowerCase()
    return desc.includes('domínio') || desc.includes('dominio') || desc.includes('cadastre um site')
  })
}
