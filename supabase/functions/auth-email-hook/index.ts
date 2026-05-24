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

// Usa a lib `standardwebhooks` recomendada pelas próprias docs do Supabase
// pra evitar bugs sutis de parsing/encoding na verificação HMAC. Spec:
// https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

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

// ─── HMAC verification (lib standardwebhooks) ────────────────────────────────
// A lib aceita o secret como vier (com ou sem `whsec_` ou `v1,whsec_`) e faz
// todo o parsing/encoding/timing-safe-compare por dentro. Recomendada pelas
// docs oficiais do Supabase.
function verifyHookSignature(
  rawBody: string,
  headers: Record<string, string>,
  rawSecret: string,
): { ok: true; payload: HookPayload } | { ok: false; error: string } {
  // standardwebhooks aceita só a parte após `v1,` — strip prefixo se vier completo
  const secret = rawSecret.startsWith('v1,') ? rawSecret.slice(3) : rawSecret
  try {
    const wh = new Webhook(secret)
    const verified = wh.verify(rawBody, headers) as HookPayload
    return { ok: true, payload: verified }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
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
  // Top-level try: garante que qualquer crash retorna 500 com causa legível
  // em vez de o runtime devolver "Unexpected status code returned from hook: 500"
  // sem nada nos logs.
  try {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const rawBody = await req.text()

  // 1. Verifica HMAC do webhook (Standard Webhooks) via lib oficial.
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? ''
  if (!secret) {
    console.error('[auth-email-hook] SEND_EMAIL_HOOK_SECRET não configurada')
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // standardwebhooks lib quer um objeto com headers em lower-case keys
  const headers: Record<string, string> = {
    'webhook-id':        req.headers.get('webhook-id')        ?? '',
    'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
    'webhook-signature': req.headers.get('webhook-signature') ?? '',
  }

  const verifyResult = verifyHookSignature(rawBody, headers, secret)
  if (!verifyResult.ok) {
    console.error(`[auth-email-hook] HMAC verify falhou: ${verifyResult.error}`)
    return new Response(JSON.stringify({ error: `Invalid signature: ${verifyResult.error}` }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payload = verifyResult.payload
  if (!payload?.user?.email || !payload?.email_data?.email_action_type) {
    console.error('[auth-email-hook] payload incompleto:', JSON.stringify(payload).slice(0, 200))
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 2. Render + envia
  try {
    console.log(`[auth-email-hook] rendering type=${payload.email_data.email_action_type} to=${payload.user.email}`)
    const { subject, html } = renderEmail(payload)
    console.log(`[auth-email-hook] sending via Resend, subject="${subject}", html length=${html.length}`)
    await sendViaResend(payload.user.email, subject, html)
    console.log(`[auth-email-hook] ok type=${payload.email_data.email_action_type} user=${payload.user.id}`)
    return new Response(JSON.stringify({}), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = (e as Error).message
    console.error('[auth-email-hook] falha no envio Resend:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  } catch (e) {
    const msg = (e as Error).message
    const stack = (e as Error).stack ?? ''
    console.error('[auth-email-hook] crash top-level:', msg, '\n', stack)
    return new Response(JSON.stringify({ error: `crash: ${msg}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
