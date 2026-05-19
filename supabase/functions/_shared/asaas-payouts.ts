// Helpers de auto-saque Asaas — usado pelo asaas-webhook após confirmar
// pagamento APROVADO pra varrer o saldo da subconta do produtor direto
// pro PIX cadastrado dele. Resolve o gap do split BaaS, onde a grana
// fica parada na subconta Asaas até alguém sacar.
//
// Sessão 3 do carrinho (2026-05-20). Backlog: backlog-auto-saque-subconta.

export interface PixDescriptor {
  pixAddressKey:     string
  pixAddressKeyType: 'EMAIL' | 'CPF' | 'CNPJ' | 'PHONE' | 'EVP'
}

/** Detecta o tipo de chave PIX baseado no formato.
 *  Heurística:
 *   - email: contém '@'
 *   - CNPJ: 14 dígitos
 *   - CPF: 11 dígitos (não distinguível de celular sem DDD; assumimos CPF
 *     quando explicitamente passar como `treat11AsCpf`)
 *   - celular: 11 dígitos com DDD ou 13 começando com 55
 *   - EVP: fallback (UUID, chave aleatória, hex)
 */
export function detectPixType(key: string, opts?: { treat11AsCpf?: boolean }): PixDescriptor {
  const k = String(key ?? '').trim()
  if (!k) throw new Error('Chave PIX vazia')

  if (k.includes('@')) {
    return { pixAddressKeyType: 'EMAIL', pixAddressKey: k }
  }

  const digits = k.replace(/\D/g, '')

  if (digits.length === 14) {
    return { pixAddressKeyType: 'CNPJ', pixAddressKey: digits }
  }

  if (digits.length === 11) {
    if (opts?.treat11AsCpf) {
      return { pixAddressKeyType: 'CPF', pixAddressKey: digits }
    }
    // Celular brasileiro sem DDI — Asaas espera +55 prefix
    return { pixAddressKeyType: 'PHONE', pixAddressKey: `+55${digits}` }
  }

  if (digits.length === 13 && digits.startsWith('55')) {
    return { pixAddressKeyType: 'PHONE', pixAddressKey: `+${digits}` }
  }

  // EVP (chave aleatória — UUID 32 hex chars com ou sem hífen)
  return { pixAddressKeyType: 'EVP', pixAddressKey: k }
}

export interface SweepResult {
  swept:        boolean       // true se transferência foi disparada
  value:        number        // valor transferido (0 se skipped)
  transferId?:  string        // id da transferência Asaas (se DONE/PENDING)
  reason?:      string        // motivo do skip (no_balance, no_pix, kyc_pending, etc)
  error?:       string        // mensagem se falhou
}

/** Varre o saldo atual da subconta do produtor e dispara 1 transferência
 *  PIX pra chave cadastrada em profiles.pix_key.
 *
 *  Best-effort total — qualquer falha retorna { swept: false, ... } sem
 *  throw, pra não bloquear o webhook caller. Não é fatal se o saldo ficar
 *  parado na subconta (próximo ciclo de cobrança vai disparar de novo).
 */
export async function sweepProducerBalance(opts: {
  producerApiKey: string  // asaas_api_key da subconta
  producerPixKey: string  // pix_key do profile do produtor
  asaasBaseUrl:   string
  description?:   string
}): Promise<SweepResult> {
  const { producerApiKey, producerPixKey, asaasBaseUrl } = opts
  if (!producerApiKey)   return { swept: false, value: 0, reason: 'no_api_key' }
  if (!producerPixKey)   return { swept: false, value: 0, reason: 'no_pix_key' }
  if (!asaasBaseUrl)     return { swept: false, value: 0, reason: 'no_base_url' }

  const headers = {
    'access_token': producerApiKey,
    'Content-Type': 'application/json',
  }

  try {
    // 1) Saldo atual da subconta
    const balRes = await fetch(`${asaasBaseUrl}/finance/balance`, { headers })
    if (!balRes.ok) {
      const body = await balRes.text().catch(() => '')
      return { swept: false, value: 0, reason: 'balance_fetch_failed', error: `${balRes.status}: ${body.slice(0, 200)}` }
    }
    const balJson = await balRes.json().catch(() => null) as any
    const balance = Number(balJson?.balance ?? 0)
    if (balance <= 0) return { swept: false, value: 0, reason: 'no_balance' }

    // 2) Monta payload do PIX
    let pix: PixDescriptor
    try {
      pix = detectPixType(producerPixKey)
    } catch (e) {
      return { swept: false, value: 0, reason: 'pix_invalid', error: (e as Error).message }
    }

    // 3) Dispara transferência
    const transferRes = await fetch(`${asaasBaseUrl}/transfers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        value:           balance,
        operationType:   'PIX',
        pixAddressKey:   pix.pixAddressKey,
        pixAddressKeyType: pix.pixAddressKeyType,
        description:     opts.description ?? 'Repasse automático CoreoHub',
      }),
    })

    if (!transferRes.ok) {
      const body = await transferRes.text().catch(() => '')
      // Erros comuns: KYC outbound pendente (400 com mensagem específica)
      const isKycPending = body.includes('aprovada para utilizar o Pix') || body.includes('not approved')
      return {
        swept: false,
        value: 0,
        reason: isKycPending ? 'kyc_pending' : 'transfer_failed',
        error: `${transferRes.status}: ${body.slice(0, 300)}`,
      }
    }

    const transferData = await transferRes.json().catch(() => null) as any
    return {
      swept:      true,
      value:      balance,
      transferId: transferData?.id,
    }
  } catch (e) {
    return { swept: false, value: 0, reason: 'exception', error: (e as Error).message }
  }
}
