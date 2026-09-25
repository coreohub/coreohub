// Comparação de versão do Termo do Produtor ("1.5" < "1.6" < "1.10"), sem
// depender de comparação de string. Módulo puro — testado no Vitest.

/** true se `version` >= `min`. Versão ausente/ilegível => false (nunca presume aceite). */
export function termsVersionAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false
  const parse = (v: string) => v.trim().split('.').map(p => Number.parseInt(p, 10))
  const a = parse(version)
  const b = parse(min)
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}
