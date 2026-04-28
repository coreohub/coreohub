/**
 * Edge Function: send-email
 *
 * Envia emails transacionais via Resend (https://resend.com).
 *
 * Chamado internamente pelo `mp-webhook` quando um pagamento é aprovado.
 * É stateless — não toca no banco; apenas traduz um tipo + payload em um
 * email HTML e dispara pela API do Resend.
 *
 * Secrets necessários (Dashboard Supabase → Edge Functions → Secrets):
 *   - RESEND_API_KEY  (obrigatório, gerado em https://resend.com/api-keys)
 *   - EMAIL_FROM      (opcional, default: "CoreoHub <onboarding@resend.dev>")
 *   - FRONTEND_URL    (opcional, default: "https://coreohub.com")
 *
 * Uso:
 *   POST /functions/v1/send-email
 *   Authorization: Bearer <service_role_key>   (ou anon se chamado do frontend)
 *   Content-Type: application/json
 *
 *   { "type": "payment_confirmed_registrant", "payload": { ...campos do template } }
 *   { "type": "payment_confirmed_producer",   "payload": { ...campos do template } }
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BRAND_COLOR = '#ff0068'
const BRAND_DARK = '#0b0b0f'

// ─── Utils ──────────────────────────────────────────────────────────────────

const money = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0)

const escape = (s: unknown): string => {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Layout base usado por todos os templates.
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
              ${footerNote ?? 'Este é um email automático. Em caso de dúvidas, responda esta mensagem.'}<br />
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

function infoRow(label: string, value: string): string {
  return `
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
      <p style="margin:0;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#94a3b8;font-weight:700;">${escape(label)}</p>
      <p style="margin:4px 0 0;font-size:14px;color:#0b0b0f;font-weight:600;">${value}</p>
    </td>
  </tr>`
}

// ─── Templates ──────────────────────────────────────────────────────────────

interface RegistrantPayload {
  inscritoNome?: string
  inscritoEmail: string
  coreoNome?: string
  modalidade?: string  // kept for backward compat; prefer formacao
  formacao?: string
  eventoNome?: string
  eventoLocal?: string
  eventoData?: string
  valorPago?: number
  appUrl?: string
}

function buildRegistrantConfirmation(p: RegistrantPayload) {
  const linhas = [
    p.coreoNome ? infoRow('Coreografia', escape(p.coreoNome)) : '',
    (p.formacao ?? p.modalidade) ? infoRow('Formação', escape(p.formacao ?? p.modalidade ?? '')) : '',
    p.eventoNome ? infoRow('Evento', escape(p.eventoNome)) : '',
    p.eventoData ? infoRow('Data', escape(p.eventoData)) : '',
    p.eventoLocal ? infoRow('Local', escape(p.eventoLocal)) : '',
    typeof p.valorPago === 'number' ? infoRow('Valor pago', escape(money(p.valorPago))) : '',
  ]
    .filter(Boolean)
    .join('')

  const contentHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${linhas}</table>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      Guarde este email como comprovante. Informações sobre horários, ordem de apresentação
      e orientações finais serão enviadas pelo produtor do evento à medida que a programação for definida.
    </p>`

  return {
    subject: `Inscrição confirmada — ${p.coreoNome ?? 'CoreoHub'}`,
    html: baseLayout({
      preheader: `Seu pagamento foi aprovado. Inscrição garantida em ${p.eventoNome ?? 'CoreoHub'}.`,
      title: 'Inscrição confirmada!',
      intro: `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, recebemos seu pagamento e sua inscrição foi <strong>aprovada</strong>. Bora dançar!`,
      contentHtml,
      ctaLabel: 'Ver minhas inscrições',
      ctaUrl: `${p.appUrl ?? 'https://coreohub.com'}/minhas-coreografias`,
    }),
  }
}

interface ProducerPayload {
  produtorNome?: string
  produtorEmail: string
  coreoNome?: string
  modalidade?: string  // kept for backward compat; prefer formacao
  formacao?: string
  inscritoNome?: string
  inscritoEmail?: string
  eventoNome?: string
  valorBruto?: number
  comissao?: number
  valorLiquido?: number
  appUrl?: string
}

function buildProducerNotification(p: ProducerPayload) {
  const linhas = [
    p.eventoNome ? infoRow('Evento', escape(p.eventoNome)) : '',
    p.coreoNome ? infoRow('Coreografia', escape(p.coreoNome)) : '',
    (p.formacao ?? p.modalidade) ? infoRow('Formação', escape(p.formacao ?? p.modalidade ?? '')) : '',
    p.inscritoNome ? infoRow('Inscrito', escape(p.inscritoNome)) : '',
    p.inscritoEmail ? infoRow('Email do inscrito', escape(p.inscritoEmail)) : '',
    typeof p.valorBruto === 'number' ? infoRow('Valor bruto', escape(money(p.valorBruto))) : '',
    typeof p.comissao === 'number' ? infoRow('Comissão plataforma', escape(money(p.comissao))) : '',
    typeof p.valorLiquido === 'number' ? infoRow('Valor líquido (você recebe)', `<span style="color:#16a34a;">${escape(money(p.valorLiquido))}</span>`) : '',
  ]
    .filter(Boolean)
    .join('')

  const contentHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${linhas}</table>`

  return {
    subject: `Nova inscrição paga — ${p.coreoNome ?? p.eventoNome ?? 'CoreoHub'}`,
    html: baseLayout({
      preheader: `Uma nova inscrição foi paga para ${p.eventoNome ?? 'seu evento'}.`,
      title: 'Nova inscrição paga',
      intro: `Olá ${escape(p.produtorNome ?? 'produtor(a)')}, uma nova inscrição acabou de ser paga e liberada para o seu evento.`,
      contentHtml,
      ctaLabel: 'Abrir painel do produtor',
      ctaUrl: `${p.appUrl ?? 'https://coreohub.com'}/producer-dashboard`,
      footerNote: 'Você está recebendo este email por ser o produtor responsável pelo evento.',
    }),
  }
}

// ─── Resend ─────────────────────────────────────────────────────────────────

async function sendViaResend(params: {
  to: string
  subject: string
  html: string
  replyTo?: string
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    throw new Error('RESEND_API_KEY não configurado')
  }

  const from = Deno.env.get('EMAIL_FROM') ?? 'CoreoHub <onboarding@resend.dev>'

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      reply_to: params.replyTo,
    }),
  })

  const data = await resp.json().catch(() => ({}))

  if (!resp.ok) {
    throw new Error(
      `Resend falhou (${resp.status}): ${data?.message ?? JSON.stringify(data)}`
    )
  }

  return { id: data?.id as string | undefined }
}

// ─── Template: producer_welcome ─────────────────────────────────────────────

interface ProducerWelcomePayload {
  produtorNome?: string
  produtorEmail: string
  appUrl?: string
}

function buildProducerWelcome(p: ProducerWelcomePayload) {
  const contentHtml = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#334155;">
      Sua conta de produtor foi criada com sucesso. Agora você pode:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
        <p style="margin:0;font-size:13px;color:#0b0b0f;font-weight:700;">1. Conectar sua conta Asaas</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Para receber os pagamentos das inscrições com split automático.</p>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
        <p style="margin:0;font-size:13px;color:#0b0b0f;font-weight:700;">2. Configurar seu festival</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Datas, modalidades, categorias, estilos e valores.</p>
      </td></tr>
      <tr><td style="padding:10px 0;">
        <p style="margin:0;font-size:13px;color:#0b0b0f;font-weight:700;">3. Compartilhar o link de inscrições</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Divulgue no Instagram, WhatsApp e redes do festival.</p>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      O guia passo a passo está disponível no painel do produtor para te ajudar em cada etapa.
    </p>`

  return {
    subject: `Bem-vindo(a) à CoreoHub!`,
    html: baseLayout({
      preheader: `Sua conta de produtor está pronta. Veja os próximos passos para colocar seu festival no ar.`,
      title: 'Conta de produtor criada!',
      intro: `Olá ${escape(p.produtorNome ?? 'produtor(a)')}, sua conta no CoreoHub foi criada e está pronta para receber inscrições. Aqui vai um guia rápido:`,
      contentHtml,
      ctaLabel: 'Acessar painel do produtor',
      ctaUrl: `${p.appUrl ?? 'https://app.coreohub.com'}/qg-organizador`,
      footerNote: 'Qualquer dúvida, fale com a gente pelo WhatsApp +55 17 99793-6169.',
    }),
  }
}

// ─── Template: event_created_producer ───────────────────────────────────────

interface EventCreatedPayload {
  produtorNome?: string
  produtorEmail: string
  eventoNome?: string
  eventoData?: string
  eventoLocal?: string
  appUrl?: string
}

function buildEventCreatedProducer(p: EventCreatedPayload) {
  const linhas = [
    p.eventoNome  ? infoRow('Nome do evento', escape(p.eventoNome)) : '',
    p.eventoData  ? infoRow('Data',           escape(p.eventoData)) : '',
    p.eventoLocal ? infoRow('Local',          escape(p.eventoLocal)) : '',
  ].filter(Boolean).join('')

  const contentHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${linhas}</table>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      A partir de agora você pode configurar gêneros, categorias, formações, avaliação e muito mais.<br/>
      Quando estiver pronto, publique o link de inscrições e comece a receber coreografias!
    </p>`

  return {
    subject: `Evento criado — ${p.eventoNome ?? 'CoreoHub'}`,
    html: baseLayout({
      preheader: `Seu evento ${p.eventoNome ?? ''} foi configurado com sucesso no CoreoHub.`,
      title: 'Seu evento está no ar!',
      intro: `Olá ${escape(p.produtorNome ?? 'produtor(a)')}, as configurações do seu evento foram salvas. Tudo pronto para começar!`,
      contentHtml,
      ctaLabel: 'Acessar painel do produtor',
      ctaUrl: `${p.appUrl ?? 'https://app.coreohub.com'}`,
      footerNote: 'Você está recebendo este email por ser o produtor responsável pelo evento.',
    }),
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

interface SendEmailRequest {
  type: 'payment_confirmed_registrant' | 'payment_confirmed_producer' | 'event_created_producer' | 'producer_welcome'
  payload: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Auth: chamadas internas (service_role_key) → liberadas para qualquer tipo.
  // Chamadas com user JWT → liberadas apenas para 'producer_welcome' e somente
  // se o email do payload bater com o email do JWT (evita phishing).
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const isService = serviceKey && token === serviceKey

  // Lê o body uma vez para a checagem de auth + processamento
  let body: SendEmailRequest
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!isService) {
    // Bloqueia tudo que não seja producer_welcome via JWT de user
    if (body?.type !== 'producer_welcome') {
      console.warn('[send-email] chamada não autorizada bloqueada (sem service_key)')
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Valida JWT e confere se o email do JWT bate com o do payload
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    if (!token || !supabaseUrl || !anonKey) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    const payloadEmail = (body?.payload as any)?.produtorEmail
    if (!user?.email || !payloadEmail || user.email.toLowerCase() !== String(payloadEmail).toLowerCase()) {
      console.warn('[send-email] producer_welcome com email não correspondente bloqueado')
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  try {
    const { type, payload } = body

    if (!type || !payload) {
      throw new Error('type e payload são obrigatórios')
    }

    let to: string
    let subject: string
    let html: string

    switch (type) {
      case 'payment_confirmed_registrant': {
        const p = payload as unknown as RegistrantPayload
        if (!p.inscritoEmail) throw new Error('inscritoEmail é obrigatório')
        const tpl = buildRegistrantConfirmation(p)
        to = p.inscritoEmail
        subject = tpl.subject
        html = tpl.html
        break
      }
      case 'payment_confirmed_producer': {
        const p = payload as unknown as ProducerPayload
        if (!p.produtorEmail) throw new Error('produtorEmail é obrigatório')
        const tpl = buildProducerNotification(p)
        to = p.produtorEmail
        subject = tpl.subject
        html = tpl.html
        break
      }
      case 'event_created_producer': {
        const p = payload as unknown as EventCreatedPayload
        if (!p.produtorEmail) throw new Error('produtorEmail é obrigatório')
        const tpl = buildEventCreatedProducer(p)
        to = p.produtorEmail
        subject = tpl.subject
        html = tpl.html
        break
      }
      case 'producer_welcome': {
        const p = payload as unknown as ProducerWelcomePayload
        if (!p.produtorEmail) throw new Error('produtorEmail é obrigatório')
        const tpl = buildProducerWelcome(p)
        to = p.produtorEmail
        subject = tpl.subject
        html = tpl.html
        break
      }
      default:
        throw new Error(`type desconhecido: ${type}`)
    }

    const { id } = await sendViaResend({ to, subject, html })

    console.log(`[send-email] ok type=${type} to=${to} id=${id}`)

    return new Response(
      JSON.stringify({ status: 'ok', id, to, type }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[send-email] erro:', error?.message ?? error)
    return new Response(
      JSON.stringify({ status: 'error', message: error?.message ?? 'unknown' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
