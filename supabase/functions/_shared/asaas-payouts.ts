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

/** Valida CPF via dígito verificador (algoritmo padrão da Receita Federal).
 *  Retorna true se os 11 dígitos compõem CPF válido.
 *  Bloqueia CPFs com todos dígitos iguais (000... 111... etc).
 */
function isValidCpf(digits: string): boolean {
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false

  const calc = (slice: number): number => {
    let sum = 0
    for (let i = 0; i < slice; i++) sum += Number(digits[i]) * (slice + 1 - i)
    const mod = (sum * 10) % 11
    return mod === 10 ? 0 : mod
  }
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10])
}

/** Detecta o tipo de chave PIX baseado no formato.
 *  Heurística:
 *   - email: contém '@'
 *   - CNPJ: 14 dígitos
 *   - CPF: 11 dígitos COM checksum válido (A2 auditoria Sessão 3)
 *   - celular: 11 dígitos sem checksum válido (presumido DDD + 9 dígitos), ou 13 com 55
 *   - EVP: fallback (UUID, chave aleatória, hex)
 */
export function detectPixType(key: string): PixDescriptor {
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
    // A2 auditoria Sessão 3: ambiguidade CPF vs celular. CPF tem checksum
    // determinístico — se passar, é CPF. Senão presumido celular (DDD+9 dígitos).
    if (isValidCpf(digits)) {
      return { pixAddressKeyType: 'CPF', pixAddressKey: digits }
    }
    return { pixAddressKeyType: 'PHONE', pixAddressKey: `+55${digits}` }
  }

  if (digits.length === 13 && digits.startsWith('55')) {
    return { pixAddressKeyType: 'PHONE', pixAddressKey: `+${digits}` }
  }

  // EVP (chave aleatória — UUID 32 hex chars com ou sem hífen)
  return { pixAddressKeyType: 'EVP', pixAddressKey: k }
}

/** A3 auditoria Sessão 3: detecção robusta de erro KYC pendente.
 *  Asaas retorna `{ errors: [{ code, description }] }`. Parseamos JSON e
 *  checamos múltiplos padrões em description (case-insensitive). Fallback
 *  pra match textual cru se o body não for JSON válido.
 */
export function isKycPendingError(body: string): boolean {
  const KYC_PATTERNS = [
    'aprovada para utilizar o pix',
    'conta ainda não está aprovada',
    'not approved',
    'verificação de identidade',
    'documentos pendentes',
  ]
  const matchAny = (text: string) => {
    const lower = text.toLowerCase()
    return KYC_PATTERNS.some((p) => lower.includes(p))
  }
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ description?: string }> }
    const errors = parsed?.errors ?? []
    for (const err of errors) {
      if (err?.description && matchAny(err.description)) return true
    }
    return false
  } catch {
    return matchAny(body)
  }
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
 *
 *  IMPORTANTE (A1 auditoria Sessão 3):
 *  Se `amount` for passado, saca apenas esse valor específico (clampado
 *  ao saldo disponível). Sem `amount`, saca o saldo inteiro — modo legado
 *  que arrasta toda grana da subconta, incluindo possíveis recebimentos
 *  de fora do CoreoHub. Webhook agora sempre passa o producer_amount
 *  conhecido do split pra evitar surpresa.
 */
export async function sweepProducerBalance(opts: {
  producerApiKey: string  // asaas_api_key da subconta
  producerPixKey: string  // pix_key do profile do produtor
  asaasBaseUrl:   string
  description?:   string
  /** Valor exato a sacar (clamped ao saldo). Sem isso, varre saldo inteiro. */
  amount?:        number
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
    // 1) Saldo atual da subconta — também usado como clamp do amount
    const balRes = await fetch(`${asaasBaseUrl}/finance/balance`, { headers })
    if (!balRes.ok) {
      const body = await balRes.text().catch(() => '')
      return { swept: false, value: 0, reason: 'balance_fetch_failed', error: `${balRes.status}: ${body.slice(0, 200)}` }
    }
    const balJson = await balRes.json().catch(() => null) as any
    const balance = Number(balJson?.balance ?? 0)
    if (balance <= 0) return { swept: false, value: 0, reason: 'no_balance' }

    // A1: valor a sacar = min(amount conhecido, balance). Se amount ausente,
    // saca saldo inteiro (compat com modo legado / scripts admin).
    const desired = opts.amount != null && opts.amount > 0
      ? Math.min(Number(opts.amount), balance)
      : balance
    if (desired <= 0) return { swept: false, value: 0, reason: 'no_amount' }

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
        value:           desired,
        operationType:   'PIX',
        pixAddressKey:   pix.pixAddressKey,
        pixAddressKeyType: pix.pixAddressKeyType,
        description:     opts.description ?? 'Repasse automático CoreoHub',
      }),
    })

    if (!transferRes.ok) {
      const body = await transferRes.text().catch(() => '')
      return {
        swept: false,
        value: 0,
        reason: isKycPendingError(body) ? 'kyc_pending' : 'transfer_failed',
        error: `${transferRes.status}: ${body.slice(0, 300)}`,
      }
    }

    const transferData = await transferRes.json().catch(() => null) as any
    return {
      swept:      true,
      value:      desired,
      transferId: transferData?.id,
    }
  } catch (e) {
    return { swept: false, value: 0, reason: 'exception', error: (e as Error).message }
  }
}

export interface InternalTransferResult {
  ok:           boolean
  status?:      string    // status Asaas retornado ('PENDING' até aprovação manual, 'DONE' quando confirmado)
  transferId?:  string
  authorized?:  boolean   // Asaas exige aprovação manual (código/app) pra transferência interna via API — confirmado 2026-09-16
  error?:       string
}

/** Transferência interna Asaas-a-Asaas (master → carteira de outra conta
 *  Asaas), via /transfers com `walletId` (mesmo campo usado no split).
 *  Gratuita (`transferFee: 0`, confirmado em teste real 2026-09-16) — bem
 *  diferente de PIX/TED externo, que tem custo.
 *
 *  IMPORTANTE: exige uma API key com permissão de saque habilitada
 *  (`ASAAS_TRANSFER_API_KEY`, chave dedicada e separada de `ASAAS_API_KEY`
 *  — nunca reusar a chave de criação de cobrança aqui, pra não ampliar o
 *  raio de dano se uma delas vazar). Toda transferência sai como PENDING/
 *  authorized:false até alguém aprovar manualmente no app da Asaas (código
 *  de autorização) — não existe hoje um jeito de pular essa aprovação sem
 *  configurar "Validação de saque via Webhook" (decisão de produto
 *  2026-09-16: não implementado por ora — volume baixo não justifica o
 *  endpoint novo que autoriza saque sozinho).
 */
export async function transferToWallet(opts: {
  transferApiKey: string   // ASAAS_TRANSFER_API_KEY — nunca ASAAS_API_KEY
  asaasBaseUrl:   string
  walletId:       string
  value:          number
  description?:   string
}): Promise<InternalTransferResult> {
  const { transferApiKey, asaasBaseUrl, walletId, value } = opts
  if (!transferApiKey) return { ok: false, error: 'no_transfer_api_key' }
  if (!walletId)       return { ok: false, error: 'no_wallet_id' }
  if (!(value > 0))    return { ok: false, error: 'invalid_value' }

  try {
    const res = await fetch(`${asaasBaseUrl}/transfers`, {
      method: 'POST',
      headers: { 'access_token': transferApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value,
        walletId,
        description: opts.description ?? 'CoreoHub — repasse integral (evento com absorção de taxa)',
      }),
    })
    const data = await res.json().catch(() => null) as any
    if (!res.ok) {
      return { ok: false, error: data?.errors?.[0]?.description ?? `${res.status}` }
    }
    return { ok: true, status: data?.status, transferId: data?.id, authorized: Boolean(data?.authorized) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Consulta o status atual de uma transferência (pra reconciliar depois que
 *  alguém aprova manualmente no app — PENDING vira DONE). */
export async function getTransferStatus(opts: {
  transferApiKey: string
  asaasBaseUrl:   string
  transferId:     string
}): Promise<{ ok: boolean; status?: string; authorized?: boolean; error?: string }> {
  const { transferApiKey, asaasBaseUrl, transferId } = opts
  try {
    const res = await fetch(`${asaasBaseUrl}/transfers/${transferId}`, {
      headers: { 'access_token': transferApiKey, 'Content-Type': 'application/json' },
    })
    const data = await res.json().catch(() => null) as any
    if (!res.ok) return { ok: false, error: data?.errors?.[0]?.description ?? `${res.status}` }
    return { ok: true, status: data?.status, authorized: Boolean(data?.authorized) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
