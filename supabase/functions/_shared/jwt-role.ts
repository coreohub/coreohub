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
