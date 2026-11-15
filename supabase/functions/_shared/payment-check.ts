// Conferência do pagamento recebido contra o que a edge de cobrança esperava
// (tabela payment_expectations). Auditoria 2026-11-15, Lote 1 (L1-c).
//
// PAYMENT_CHECK_MODE: 'off' | 'observe' | 'enforce'. Qualquer outro valor (ou ausente) = 'off'.
//   off      não faz nada (nem consulta o banco).
//   observe  confere e só LOGA ([ALERT][PAYMENT_MISMATCH]); o fluxo do pagamento segue igual.
//   enforce  idem, e o chamador pode segurar a aprovação (decisão do chamador, não deste módulo).
//
// Regra de ouro: este módulo NUNCA lança. Qualquer falha de leitura vira veredito "ok" com o motivo
// 'check_error', para que um problema aqui jamais bloqueie um pagamento legítimo.

import { countBailarinos } from './payment-expectations.ts'

export type PaymentCheckMode = 'off' | 'observe' | 'enforce'

export function paymentCheckMode(raw: string | null | undefined): PaymentCheckMode {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'observe' || v === 'enforce' ? v : 'off'
}

export interface PaymentCheckVerdict {
  ok: boolean                 // false = divergência que prejudica a plataforma/produtor
  hadExpectation: boolean     // havia linha em payment_expectations?
  reasons: string[]           // códigos curtos (event_mismatch, value_below_expected, roster_grew, ...)
  expectedTotal: number | null
  receivedValue: number | null
}

// deno-lint-ignore no-explicit-any
type Sb = any

/**
 * kind 'REG' | 'VS': registrationIds = [id da inscrição].
 * kind 'AGG': paymentGroupId = uuid de public.payments (payment_group_id das inscrições).
 */
export async function checkPaymentExpectation(supabase: Sb, opts: {
  kind: 'REG' | 'VS' | 'AGG'
  // deno-lint-ignore no-explicit-any
  payment: any
  registrationId?: string | null
  paymentGroupId?: string | null
}): Promise<PaymentCheckVerdict> {
  const empty: PaymentCheckVerdict = { ok: true, hadExpectation: false, reasons: [], expectedTotal: null, receivedValue: null }
  try {
    const asaasId = String(opts.payment?.id ?? '')
    const received = Number(opts.payment?.value)
    if (!asaasId || !Number.isFinite(received)) return { ...empty, reasons: ['check_error:payment_sem_valor'] }

    const { data: exp, error: expErr } = await supabase
      .from('payment_expectations')
      .select('registration_id, kind, event_id, expected_value, installments, bailarinos_count')
      .eq('asaas_payment_id', asaasId)
    if (expErr) return { ...empty, receivedValue: received, reasons: [`check_error:${expErr.code ?? 'read'}`] }

    const rows = (exp ?? []) as Array<{
      registration_id: string | null; kind: string; event_id: string | null
      expected_value: number | string; installments: number | null; bailarinos_count: number | null
    }>
    if (rows.length === 0) {
      // Cobrança criada antes do deploy da gravação (ou gravação falhou): nada a conferir ainda.
      return { ...empty, receivedValue: received, reasons: ['no_expectation'] }
    }

    // Amarra a linha esperada ao que o webhook vai aprovar (revisão Fable, achado 5).
    if (opts.kind !== 'AGG' && !rows.some(r => r.registration_id === (opts.registrationId ?? null))) {
      return { ok: false, hadExpectation: true, reasons: ['registration_mismatch'], expectedTotal: null, receivedValue: received }
    }
    const kindMismatch = rows.some(r => r.kind !== opts.kind)

    // Inscrições atuais (evento e elenco) das linhas esperadas.
    const regIds = rows.map(r => r.registration_id).filter((x): x is string => !!x)
    let regQuery = supabase.from('registrations').select('id, event_id, bailarinos_detalhes')
    regQuery = opts.kind === 'AGG' && opts.paymentGroupId
      ? regQuery.eq('payment_group_id', opts.paymentGroupId)
      : regQuery.in('id', regIds)
    const { data: regs, error: regErr } = await regQuery
    if (regErr) return { ...empty, hadExpectation: true, receivedValue: received, reasons: [`check_error:${regErr.code ?? 'regs'}`] }
    const regById = new Map<string, { event_id: string | null; bailarinos_detalhes: unknown }>()
    for (const r of (regs ?? [])) regById.set(r.id, r)

    const reasons: string[] = []
    let bad = false
    if (kindMismatch) { reasons.push('kind_mismatch'); bad = true }

    // 1. Evento coerente + 3. elenco não cresceu.
    for (const row of rows) {
      const reg = row.registration_id ? regById.get(row.registration_id) : undefined
      if (!reg) { reasons.push('registration_missing'); continue }
      if (row.event_id && reg.event_id !== row.event_id) { reasons.push('event_mismatch'); bad = true }
      if (row.bailarinos_count != null && countBailarinos(reg.bailarinos_detalhes) > row.bailarinos_count) {
        reasons.push('roster_grew'); bad = true
      }
    }
    // Inscrição ligada à cobrança mas sem linha esperada (agregado): fatura mexida depois de criada.
    if (opts.kind === 'AGG') {
      const expected = new Set(regIds)
      for (const id of regById.keys()) if (!expected.has(id)) { reasons.push('registration_not_expected'); bad = true; break }
    }

    // 2. Valor. Parcelado (installments > 1): não compara (como o webhook recebe cada parcela não foi verificado).
    // Em centavos inteiros (evita erro de ponto flutuante na tolerância; revisão Fable, achado 7).
    const cents = (n: number) => Math.round(n * 100)
    const expectedCents = rows.reduce((s, r) => s + cents(Number(r.expected_value)), 0)
    const expectedTotal = expectedCents / 100
    const payInstallments = Math.max(1, Number(opts.payment?.installmentCount ?? 1) || 1)
    const expectsInstallments = rows.some(r => Number(r.installments ?? 1) > 1)
    if (payInstallments > 1) {
      // Pagamento parcelado na Asaas: `value` pode ser a parcela. Compara o total (parcela x N),
      // com 1 centavo de tolerância por parcela (revisão Fable, achado 6).
      if (cents(received) * payInstallments < expectedCents - payInstallments) {
        reasons.push('value_below_expected'); bad = true
      } else {
        reasons.push('value_checked_as_installments')
      }
    } else if (expectsInstallments) {
      reasons.push('value_check_skipped_installments')
    } else if (cents(received) < expectedCents - 1) {
      reasons.push('value_below_expected'); bad = true
    } else if (cents(received) > expectedCents + 1) {
      reasons.push('value_above_expected') // a maior nunca prejudica: só registra
    }

    return { ok: !bad, hadExpectation: true, reasons, expectedTotal, receivedValue: received }
  } catch (e) {
    return { ...empty, reasons: [`check_error:${(e as Error)?.message ?? 'exception'}`] }
  }
}

/** Marca anomalia nas linhas esperadas (para consulta posterior). Best-effort, nunca lança. */
export async function markExpectationAnomaly(supabase: Sb, asaasPaymentId: string, reasons: string[], mode: string): Promise<void> {
  try {
    await supabase
      .from('payment_expectations')
      .update({ anomaly: `${mode}:${reasons.join(',')}`, anomaly_at: new Date().toISOString() })
      .eq('asaas_payment_id', String(asaasPaymentId))
  } catch (e) {
    console.error('[asaas-webhook] falha ao marcar anomalia:', (e as Error)?.message)
  }
}
