// Le o claim `role` do payload de um JWT. SO usar atras de `verify_jwt = true` (o gateway ja
// verificou a assinatura): aqui nao ha verificacao, so leitura. Substitui a comparacao por
// igualdade com a service key (padrao proibido, auditoria Lote 3, B-N7).
export function jwtRole(token: string | null | undefined): string {
  try {
    const part = String(token ?? '').split('.')[1]
    if (!part) return ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    return String(payload?.role ?? '')
  } catch {
    return ''
  }
}

export const isServiceRoleToken = (token: string | null | undefined): boolean => jwtRole(token) === 'service_role'

// Comparacao em tempo constante (sem curto-circuito no primeiro byte diferente).
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

// Para funcoes com `verify_jwt = false` (ex.: send-email), onde o claim NAO tem assinatura
// verificada: o token so vale como service se for IGUAL (tempo constante) a uma das chaves
// reais configuradas no ambiente. Valor vazio nunca vale. Um JWT forjado com role=service_role nao passa.
export function isServiceKeyMatch(token: string | null | undefined, keys: Array<string | null | undefined>): boolean {
  const t = String(token ?? '')
  if (!t) return false
  let ok = false
  for (const k of keys) {
    const key = String(k ?? '')
    if (key && timingSafeEqual(t, key)) ok = true
  }
  return ok
}
