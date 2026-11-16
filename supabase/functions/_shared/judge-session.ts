// Sessão assinada do jurado (auditoria 2026-11-16, Lote 2, B#3).
// O `validate` confere o PIN e devolve um session_token HMAC-SHA256 amarrado a
// judge_id + event_id + producer_id + validade. As demais ações do judge-login passam a exigi-lo,
// porque o token do produtor (link/QR) e o judge_id (devolvido por `list`) não provam que houve PIN.
//
// JUDGE_SESSION_SECRET  segredo de assinatura. Ausente = o recurso fica desligado (nada é assinado nem exigido).
// JUDGE_SESSION_MODE    'off' | 'observe' | 'enforce'. Ausente = 'observe' (só loga; não bloqueia ninguém).

export type JudgeSessionMode = 'off' | 'observe' | 'enforce'

export function judgeSessionMode(raw: string | null | undefined, secret: string | null | undefined): JudgeSessionMode {
  if (!secret) return 'off'
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'off' || v === 'enforce' ? v : 'observe'
}

// 36h: mais que os 24h da sessão local do terminal, para a fila offline ainda esvaziar na virada.
export const JUDGE_SESSION_TTL_MS = 36 * 60 * 60 * 1000

export interface JudgeSessionClaims { judge_id: string; event_id: string; producer_id: string; exp: number }

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signJudgeSession(secret: string, c: Omit<JudgeSessionClaims, 'exp'>, now = Date.now()): Promise<string> {
  const claims: JudgeSessionClaims = { ...c, exp: now + JUDGE_SESSION_TTL_MS }
  const body = b64url(enc.encode(JSON.stringify(claims)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

export type JudgeSessionCheck = { ok: true; claims: JudgeSessionClaims } | { ok: false; reason: string }

/** Confere assinatura, validade e (se informados) judge_id, producer_id e event_id. Nunca lança. */
export async function verifyJudgeSession(
  secret: string,
  token: unknown,
  expect: { judge_id?: string | null; producer_id: string; event_id?: string | null },
  now = Date.now(),
): Promise<JudgeSessionCheck> {
  try {
    if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'missing' }
    const [body, sig] = token.split('.')
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body))
    if (!valid) return { ok: false, reason: 'bad_signature' }
    const claims = JSON.parse(new TextDecoder().decode(unb64url(body))) as JudgeSessionClaims
    if (!(claims.exp > now)) return { ok: false, reason: 'expired' }
    if (claims.producer_id !== expect.producer_id) return { ok: false, reason: 'producer_mismatch' }
    if (expect.judge_id && claims.judge_id !== expect.judge_id) return { ok: false, reason: 'judge_mismatch' }
    if (expect.event_id && claims.event_id !== expect.event_id) return { ok: false, reason: 'event_mismatch' }
    return { ok: true, claims }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}
