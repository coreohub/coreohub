// Auditoria Lote 3, C6 (A5): href vindo de campo digitado por usuario (site, link de video, aviso...)
// nunca pode virar `javascript:`/`data:`. So http(s) passa; "www.x.com" e "x.com/y" ganham https://.
// Devolve undefined quando nao serve: `<a href={undefined}>` fica sem link, sem quebrar a tela.
export function safeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  if (!s || s.length > 2048 || /[\s<>\x22\x27\x60\x5c]/.test(s)) return undefined
  // Tem esquema explicito (algo seguido de ':' antes de qualquer '/', '?' ou '#')? So http/https.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)
  const candidate = scheme ? s : `https://${s.replace(/^\/\//, '')}`
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return undefined
  }
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    if (!u.hostname || !u.hostname.includes('.')) return undefined
    return u.toString()
  } catch {
    return undefined
  }
}
