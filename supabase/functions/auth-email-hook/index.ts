// Edge Function: auth-email-hook
//
// Send Email Hook do Supabase Auth — substitui o SMTP nativo (que falhava com
// "Error sending confirmation email" 500 desde o lançamento) pelo nosso
// pipeline Resend já testado em send-email.
//
// Quando configurado em Dashboard → Authentication → Hooks → "Send Email Hook",
// o Supabase passa a chamar esta função POST a cada email transacional (signup,
// recovery, magiclink, email_change, etc.) em vez de tentar SMTP próprio.
//
// Spec: https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
// Webhook signature: Standard Webhooks (https://github.com/standard-webhooks/standard-webhooks)
//
// Secrets necessários (Supabase → Edge Functions → Secrets):
//   - SEND_EMAIL_HOOK_SECRET  (gerado em Dashboard → Auth → Hooks)
//   - RESEND_API_KEY          (já configurado, reusa do send-email)
//   - EMAIL_FROM              (já configurado, default contato@coreohub.com)
//
// Importante: esta função DEVE rodar com `verify_jwt = false` no config —
// Supabase Auth chama sem JWT (assina via HMAC no header webhook-signature).

// Usa Web Crypto (crypto.subtle) em vez de node:crypto pra portabilidade no
// runtime do Supabase Edge (Deno). Padrão recomendado pela própria Supabase
// nas docs de Send Email Hook.

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
}

const BRAND_COLOR = '#ff0068'
const BRAND_DARK  = '#0b0b0f'

const escape = (s: unknown): string => {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ─── Payload types ────────────────────────────────────────────────────────────
// https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook#payload
type EmailActionType =
  | 'signup'
  | 'recovery'
  | 'magiclink'
  | 'invite'
  | 'email_change'
  | 'email_change_current'
  | 'email_change_new'
  | 'reauthentication'

interface HookPayload {
  user: {
    id: string
    email: string
    user_metadata?: Record<string, unknown>
    app_metadata?: Record<string, unknown>
  }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: EmailActionType
    site_url: string
    token_new?: string
    token_hash_new?: string
  }
}

// ─── HMAC verification (Standard Webhooks spec) ──────────────────────────────
// O secret no Supabase tem prefixo `v1,whsec_` — a parte após `whsec_` é base64
// do segredo bruto. Assinamos `${id}.${timestamp}.${body}` com HMAC-SHA256.
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function verifyHookSignature(
  rawBody: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string,
  rawSecret: string,
): Promise<boolean> {
  if (!webhookId || !webhookTimestamp || !webhookSignature || !rawSecret) return false

  // Reject timestamps mais de 5min fora do clock (replay defense)
  const ts = Number(webhookTimestamp)
  if (!Number.isFinite(ts)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 300) return false

  // Strip prefixo `v1,whsec_` se vier inteiro do Dashboard
  const secretBase64 = rawSecret.startsWith('v1,whsec_')
    ? rawSecret.slice('v1,whsec_'.length)
    : rawSecret.startsWith('whsec_')
      ? rawSecret.slice('whsec_'.length)
      : rawSecret

  let secretBytes: Uint8Array
  try {
    secretBytes = base64ToBytes(secretBase64)
  } catch {
    return false
  }

  const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
  const expected = new Uint8Array(sigBuf)

  // Header pode trazer múltiplas assinaturas separadas por espaço:
  //   "v1,base64sig1 v1,base64sig2"
  for (const part of webhookSignature.split(' ')) {
    const b64 = part.split(',')[1]
    if (!b64) continue
    let candidate: Uint8Array
    try { candidate = base64ToBytes(b64) } catch { continue }
    if (timingSafeEqual(candidate, expected)) return true
  }
  return false
}

// ─── Template render ──────────────────────────────────────────────────────────
function baseLayout(opts: {
  preheader: string
  title: string
  intro: string
  contentHtml: string
  ctaLabel?: string
  ctaUrl?: string
  footerNote?: string
}): string {
  const { preheader, title, intro, contentHtml, ctaLabel, ctaUrl, footerNote } = opts
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0b0f;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
        <tr>
          <td style="background:${BRAND_DARK};padding:28px 32px;">
            <p style="margin:0;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${BRAND_COLOR};font-weight:900;">CoreoHub</p>
            <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;color:#ffffff;font-weight:900;letter-spacing:-.01em;">${escape(title)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#334155;">${intro}</p>
            ${contentHtml}
            ${
              ctaLabel && ctaUrl
                ? `<div style="margin-top:28px;text-align:center;">
                     <a href="${escape(ctaUrl)}" style="display:inline-block;padding:14px 28px;background:${BRAND_COLOR};color:#ffffff;font-weight:900;font-size:13px;letter-spacing:.15em;text-transform:uppercase;text-decoration:none;border-radius:14px;">${escape(ctaLabel)}</a>
                   </div>`
                : ''
            }
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;">
              ${footerNote ?? 'Se você não solicitou este e-mail, pode ignorar com segurança.'}<br />
              © ${new Date().getFullYear()} CoreoHub. Todos os direitos reservados.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

function buildOtpFallback(token: string): string {
  // Bloco com código numérico de 6 dígitos. Usado quando cliente não consegue
  // abrir o link (filtro corporativo, copy/paste em outro device, etc).
  return `
    <div style="margin-top:18px;padding:14px;border:1px dashed #e2e8f0;border-radius:12px;background:#f8fafc;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#64748b;">Ou use o código</p>
      <p style="margin:0;font-family:'SFMono-Regular',Menlo,monospace;font-size:22px;font-weight:900;letter-spacing:.4em;color:#0b0b0f;">${escape(token)}</p>
    </div>`
}

// Constrói a URL canônica do verify endpoint do Supabase. Pattern oficial:
//   ${SUPABASE_URL}/auth/v1/verify?token=${token_hash}&type=${type}&redirect_to=${redirect_to}
function buildVerifyUrl(p: HookPayload['email_data']): string {
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const params = new URLSearchParams({
    token:       p.token_hash,
    type:        p.email_action_type,
    redirect_to: p.redirect_to,
  })
  return `${base}/auth/v1/verify?${params.toString()}`
}

interface RenderedEmail {
  subject: string
  html: string
}

function renderEmail(payload: HookPayload): RenderedEmail {
  const { user, email_data: ed } = payload
  const verifyUrl = buildVerifyUrl(ed)
  const otpFallback = ed.token ? buildOtpFallback(ed.token) : ''

  switch (ed.email_action_type) {
    case 'signup': {
      return {
        subject: 'Confirme seu e-mail no CoreoHub',
        html: baseLayout({
          preheader: 'Falta só um clique pra ativar sua conta CoreoHub.',
          title: 'Confirme seu e-mail',
          intro: `Olá! Recebemos seu cadastro no CoreoHub com o e-mail <strong>${escape(user.email)}</strong>. Pra ativar a conta, clique no botão abaixo.`,
          contentHtml: `
            <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">
              O link expira em 1 hora. Se o botão não funcionar, copie e cole o endereço completo no navegador.
            </p>
            ${otpFallback}`,
          ctaLabel: 'Ativar minha conta',
          ctaUrl:   verifyUrl,
          footerNote: 'Se você não criou esta conta, pode ignorar este e-mail.',
        }),
      }
    }
    case 'recovery': {
      return {
        subject: 'Redefina sua senha CoreoHub',
        html: baseLayout({
          preheader: 'Use o link abaixo pra escolher uma nova senha.',
          title: 'Redefinir senha',
          intro: `Recebemos um pedido pra redefinir a senha da conta <strong>${escape(user.email)}</strong>. Use o botão abaixo pra continuar.`,
          contentHtml: `
            <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">
              O link expira em 1 hora. Se você não pediu esta redefinição, ignore — sua senha continua a mesma.
            </p>
            ${otpFallback}`,
          ctaLabel: 'Redefinir senha',
          ctaUrl:   verifyUrl,
        }),
      }
    }
    case 'magiclink': {
      return {
        subject: 'Seu link de acesso CoreoHub',
        html: baseLayout({
          preheader: 'Login direto sem digitar senha.',
          title: 'Entrar no CoreoHub',
          intro: `Use o botão abaixo pra entrar com o e-mail <strong>${escape(user.email)}</strong>. Sem senha — direto na conta.`,
          contentHtml: `
            <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">
              O link expira em 1 hora e funciona uma única vez.
            </p>
            ${otpFallback}`,
          ctaLabel: 'Entrar agora',
          ctaUrl:   verifyUrl,
        }),
      }
    }
    case 'invite': {
      return {
        subject: 'Você foi convidado pro CoreoHub',
        html: baseLayout({
          preheader: 'Confirme o convite pra acessar.',
          title: 'Convite CoreoHub',
          intro: `Você recebeu um convite pra acessar o CoreoHub com o e-mail <strong>${escape(user.email)}</strong>. Aceite pra continuar.`,
          contentHtml: `
            <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">
              Ao aceitar o convite, você criará sua senha de acesso.
            </p>
            ${otpFallback}`,
          ctaLabel: 'Aceitar convite',
          ctaUrl:   verifyUrl,
        }),
      }
    }
    case 'email_change':
    case 'email_change_current':
    case 'email_change_new': {
      return {
        subject: 'Confirme a alteração de e-mail',
        html: baseLayout({
          preheader: 'Confirme pra finalizar a troca de e-mail.',
          title: 'Confirmar novo e-mail',
          intro: `Recebemos um pedido pra atualizar o e-mail da sua conta CoreoHub. Confirme pra concluir.`,
          contentHtml: `
            <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">
              O link expira em 1 hora. Se você não solicitou esta alteração, ignore — nada será trocado.
            </p>
            ${otpFallback}`,
          ctaLabel: 'Confirmar alteração',
          ctaUrl:   verifyUrl,
        }),
      }
    }
    case 'reauthentication': {
      return {
        subject: 'Confirme que é você no CoreoHub',
        html: baseLayout({
          preheader: 'Use o código abaixo pra confirmar a operação.',
          title: 'Reautenticação necessária',
          intro: `Pra concluir a operação na sua conta CoreoHub, use o código abaixo.`,
          contentHtml: `
            <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">
              Volte ao navegador e digite o código. Ele expira em 5 minutos.
            </p>
            ${otpFallback}`,
        }),
      }
    }
    default: {
      // Fallback genérico — não deveria cair aqui, mas se vier um tipo novo
      // do Supabase, evita 500 e ainda manda algo útil ao user.
      return {
        subject: 'Notificação do CoreoHub',
        html: baseLayout({
          preheader: 'Atualização da sua conta.',
          title: 'Notificação',
          intro: 'Recebemos uma atualização pra sua conta CoreoHub.',
          contentHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">Acesse sua conta em <a href="https://app.coreohub.com" style="color:${BRAND_COLOR};">app.coreohub.com</a> pra mais detalhes.</p>${otpFallback}`,
        }),
      }
    }
  }
}

// ─── Resend send ─────────────────────────────────────────────────────────────
async function sendViaResend(to: string, subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const from   = Deno.env.get('EMAIL_FROM') ?? 'CoreoHub <contato@coreohub.com>'
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada')

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`Resend ${resp.status}: ${body.slice(0, 300)}`)
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const rawBody = await req.text()

  // 1. Verifica HMAC do webhook (Standard Webhooks). Sem isso, qualquer um na
  //    internet pode triggar email via essa URL — risco de spam + abuso da quota.
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? ''
  if (!secret) {
    console.error('[auth-email-hook] SEND_EMAIL_HOOK_SECRET não configurada')
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const webhookId        = req.headers.get('webhook-id')        ?? ''
  const webhookTimestamp = req.headers.get('webhook-timestamp') ?? ''
  const webhookSignature = req.headers.get('webhook-signature') ?? ''

  if (!(await verifyHookSignature(rawBody, webhookId, webhookTimestamp, webhookSignature, secret))) {
    console.warn('[auth-email-hook] HMAC inválido, rejeitando')
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 2. Parse payload
  let payload: HookPayload
  try {
    payload = JSON.parse(rawBody) as HookPayload
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!payload?.user?.email || !payload?.email_data?.email_action_type) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 3. Render + envia
  try {
    const { subject, html } = renderEmail(payload)
    await sendViaResend(payload.user.email, subject, html)
    console.log(`[auth-email-hook] ok type=${payload.email_data.email_action_type} user=${payload.user.id}`)
    return new Response(JSON.stringify({}), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = (e as Error).message
    console.error('[auth-email-hook] falha no envio:', msg)
    // Retorna 500 pra Supabase mostrar erro genérico ao user. O log fica no
    // dashboard de edge functions pra investigação.
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
