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
 *   { "type": "payment_confirmed_registrant",       "payload": { ... } }
 *   { "type": "payment_confirmed_producer",         "payload": { ... } }
 *   { "type": "audience_ticket_confirmed",          "payload": { ... } }
 *   { "type": "audience_ticket_producer",           "payload": { ... } }
 *   { "type": "workshop_registration_confirmed",    "payload": { ... } }
 *   { "type": "workshop_registration_producer",     "payload": { ... } }
 *   { "type": "event_created_producer",             "payload": { ... } }
 *   { "type": "producer_welcome",                   "payload": { ... } }
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
          <td style="padding:20px 32px 8px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;">
              ${footerNote ?? 'Este é um email automático. Em caso de dúvidas, responda esta mensagem.'}<br />
              © ${new Date().getFullYear()} CoreoHub. Todos os direitos reservados.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 28px;text-align:center;">
            <!-- Selo Asaas — exigência regulatória do BaaS (Resolução Conjunta nº 16/2025 BCB).
                 Obrigatório em e-mails conforme Playbook Asaas.
                 ID oficial: d58edae9-a53c-4ab3-9e71-a4e04d8a8b15 -->
            <a href="https://asaas.com" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;">
              <img
                src="https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Positivo.svg?id=d58edae9-a53c-4ab3-9e71-a4e04d8a8b15"
                alt="Selo Serviços Financeiros Asaas"
                width="160"
                height="48"
                style="display:inline-block;border:0;outline:none;text-decoration:none;"
              />
            </a>
            <p style="margin:8px 0 0;font-size:10px;line-height:1.5;color:#94a3b8;">
              Pagamentos processados pelo ASAAS GESTÃO FINANCEIRA S.A.,<br />
              instituição de pagamento autorizada pelo Banco Central do Brasil.
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
  /** Email do produtor — vira reply-to do email transacional */
  produtorEmail?: string
  /** ID da registration (UUID). Usado pra montar link da credencial digital. */
  registrationId?: string
  /** Q2.5 — quando true, inclui bloco no email pedindo confirmação de e-mail
   *  pra desbloquear download de certificado. Aproveita momento de open-rate alto
   *  pós-pagamento. Padrão Stripe/Sympla — verificação lazy. */
  emailUnverified?: boolean
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

  // Credencial digital (Backlog QR Etapa 3): bloco destacado com link pra
  // /credencial/<id> + codigo manual de fallback (ultimos 6 chars do UUID).
  // Sem QR inline no email — clientes de email frequentemente bloqueiam imagens
  // por padrao, e gerar QR no backend Deno requer dep extra. Link funciona em
  // todos clientes; usuario abre no navegador e ve o QR completo.
  let credencialBlock = ''
  if (p.registrationId) {
    const credencialUrl = `${p.appUrl ?? 'https://coreohub.com'}/credencial/${p.registrationId}`
    const fallbackCode = p.registrationId.replace(/-/g, '').slice(-6).toUpperCase()
    credencialBlock = `
      <div style="margin-top:24px;padding:20px;border:2px solid #ff0068;border-radius:16px;background:#fff5f8;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#ff0068;">Sua credencial digital</p>
        <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#475569;">
          Apresente o QR no credenciamento do evento. Acesse pelo celular pra exibir a tela com o código.
        </p>
        <a href="${credencialUrl}" style="display:inline-block;padding:12px 24px;background:#ff0068;color:#fff;text-decoration:none;border-radius:12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">
          Acessar credencial →
        </a>
        <p style="margin:16px 0 0;font-size:11px;color:#64748b;">
          Código manual (caso o QR não funcione):
          <br>
          <span style="display:inline-block;margin-top:6px;padding:6px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:6px;color:#0f172a;">${fallbackCode}</span>
        </p>
      </div>`
  }

  // Q2.5 — bloco de verificação de e-mail (aparece só se emailUnverified=true).
  // Padrão Stripe/Sympla: aproveita momento alto de open-rate pós-pagamento
  // pra capturar a verificação que destrava certificado depois.
  let verifyBlock = ''
  if (p.emailUnverified) {
    const dashboardUrl = `${p.appUrl ?? 'https://coreohub.com'}/meus-certificados`
    verifyBlock = `
      <div style="margin-top:16px;padding:16px;border:1px solid #fde68a;border-radius:12px;background:#fffbeb;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#b45309;">
          ⚠ Confirme seu e-mail
        </p>
        <p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#78350f;">
          Pra baixar seu certificado depois do festival, confirme seu e-mail. Já enviamos um link separado —
          procure por "Confirme sua conta CoreoHub" na sua caixa de entrada.
        </p>
        <a href="${dashboardUrl}" style="display:inline-block;padding:8px 16px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">
          Acessar meus certificados
        </a>
      </div>`
  }

  const contentHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${linhas}</table>
    ${credencialBlock}
    ${verifyBlock}
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      Guarde este email como comprovante. Informações sobre horários, ordem de apresentação
      e orientações finais serão enviadas pelo produtor do evento à medida que a programação for definida.
    </p>`

  // Subject com nome do festival como prefixo, quando disponível, pra contexto
  const subjectPrefix = p.eventoNome ? `[${p.eventoNome}] ` : ''
  return {
    subject: `${subjectPrefix}Inscrição confirmada${p.coreoNome ? ` — ${p.coreoNome}` : ''}`,
    html: baseLayout({
      preheader: `Seu pagamento foi aprovado. Inscrição garantida em ${p.eventoNome ?? 'CoreoHub'}.`,
      title: 'Inscrição confirmada!',
      intro: `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, recebemos seu pagamento e sua inscrição foi <strong>aprovada</strong>. Bora dançar!`,
      contentHtml,
      ctaLabel: p.registrationId ? 'Ver minhas inscrições' : 'Ver minhas inscrições',
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
  /** Nome do festival — se passado, From vira "{festivalName} via CoreoHub <email-original>" */
  festivalName?: string
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    throw new Error('RESEND_API_KEY não configurado')
  }

  const baseFrom = Deno.env.get('EMAIL_FROM') ?? 'CoreoHub <onboarding@resend.dev>'

  // Constrói From dinâmico: "Festival X via CoreoHub <email>" quando há nome do festival
  let from = baseFrom
  if (params.festivalName) {
    // Extrai email do baseFrom (formato "Nome <email>")
    const match = baseFrom.match(/<(.+)>/)
    const email = match ? match[1] : baseFrom
    const cleanName = params.festivalName.replace(/[<>"]/g, '').trim()
    from = `${cleanName} via CoreoHub <${email}>`
  }

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

// ─── Template: admin_new_producer ──────────────────────────────────────────
// Notifica contato@coreohub.com toda vez que um novo produtor cria conta.
// Disparado em paralelo com producer_welcome (cópia interna pro admin).

function buildAdminNewProducer(p: { produtorNome?: string; produtorEmail: string }) {
  const contentHtml = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#334155;">
      Acabou de chegar mais um produtor na plataforma:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-top:8px;">
      <tr><td style="padding:6px 0;">
        <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Nome</p>
        <p style="margin:2px 0 0;font-size:14px;color:#0b0b0f;font-weight:700;">${escape(p.produtorNome ?? '—')}</p>
      </td></tr>
      <tr><td style="padding:6px 0;">
        <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">E-mail</p>
        <p style="margin:2px 0 0;font-size:14px;color:#0b0b0f;font-weight:700;">${escape(p.produtorEmail)}</p>
      </td></tr>
      <tr><td style="padding:6px 0;">
        <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Criado em</p>
        <p style="margin:2px 0 0;font-size:14px;color:#0b0b0f;font-weight:700;">${escape(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</p>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:12px;color:#64748b;">
      Considere mandar uma mensagem pessoal de boas-vindas pelo WhatsApp.
    </p>`

  return {
    subject: `🎉 Novo produtor: ${p.produtorNome ?? p.produtorEmail}`,
    html: baseLayout({
      preheader: `Novo cadastro de produtor: ${p.produtorEmail}`,
      title: 'Novo produtor cadastrado',
      intro: 'Notificação interna — alguém acabou de criar conta de produtor no CoreoHub.',
      contentHtml,
    }),
  }
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

    <!-- Aviso da taxa bancária do Asaas (cláusula 5 do Termo). Pattern de
         mercado: lembrete formal pós-aceite pra eliminar surpresa na 1ª venda. -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
      <tr><td style="padding:16px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;">
          Lembrete: Taxa de criação de conta bancária
        </p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#78350f;">
          Conforme cláusula 5 do Termo de Adesão aceito, a instituição financeira
          <strong>Asaas</strong> (parceiro financeiro da CoreoHub) aplica uma taxa única de
          <strong>R$ 12,90</strong> pela criação da sua conta digital. Este valor será
          descontado automaticamente da sua primeira venda aprovada.
        </p>
        <p style="margin:0;font-size:12px;line-height:1.5;color:#92400e;">
          Trata-se de cobrança da instituição financeira, <strong>não da CoreoHub</strong>.
          Da segunda venda em diante, você receberá o valor cheio da sua comissão.
        </p>
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

// ─── Template: audience_ticket_confirmed (Tier 1 paid tickets) ──────────────

interface AudienceTicketPayload {
  buyerName?: string
  buyerEmail: string
  /** Email do produtor — vira reply-to do email transacional (comprador responde, produtor recebe) */
  produtorEmail?: string
  eventoNome?: string
  eventoData?: string
  eventoLocal?: string
  valorPago?: number
  tickets?: Array<{ tipo: string; url: string }>
  appUrl?: string
}

function buildAudienceTicketConfirmation(p: AudienceTicketPayload) {
  const tickets = Array.isArray(p.tickets) ? p.tickets : []
  const isMulti = tickets.length > 1

  const eventInfo = [
    p.eventoNome  ? infoRow('Evento', escape(p.eventoNome)) : '',
    p.eventoData  ? infoRow('Data',   escape(p.eventoData)) : '',
    p.eventoLocal ? infoRow('Local',  escape(p.eventoLocal)) : '',
    typeof p.valorPago === 'number' ? infoRow('Valor pago', escape(money(p.valorPago))) : '',
  ].filter(Boolean).join('')

  const ticketBlocks = tickets.map((t, i) => {
    const label = isMulti ? `Ingresso ${i + 1} de ${tickets.length} — ${t.tipo}` : t.tipo
    return `
      <div style="margin-top:${i === 0 ? 24 : 12}px;padding:18px;border:2px solid ${BRAND_COLOR};border-radius:14px;background:#fff5f8;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${BRAND_COLOR};">${escape(label)}</p>
        <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#475569;">
          Apresente o QR na entrada. Acesse pelo celular pra exibir a tela com o código.
        </p>
        <a href="${escape(t.url)}" style="display:inline-block;padding:11px 22px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">
          Acessar ingresso →
        </a>
      </div>`
  }).join('')

  const contentHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${eventInfo}</table>
    ${ticketBlocks}
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      Guarde este email — o link de cada ingresso é seu comprovante. Se você comprou ${isMulti ? 'mais de um' : 'mais de um ingresso'}, cada pessoa precisa do seu próprio QR.
    </p>`

  return {
    subject: `${p.eventoNome ? `[${p.eventoNome}] ` : ''}Ingresso${isMulti ? 's' : ''} confirmado${isMulti ? 's' : ''}`,
    html: baseLayout({
      preheader: `Pagamento aprovado. ${tickets.length} ingresso${isMulti ? 's' : ''} liberado${isMulti ? 's' : ''} pra ${p.eventoNome ?? 'o evento'}.`,
      title: isMulti ? `${tickets.length} ingressos confirmados!` : 'Ingresso confirmado!',
      intro: `Olá ${escape(p.buyerName ?? 'comprador(a)')}, recebemos seu pagamento e ${isMulti ? `seus ${tickets.length} ingressos foram liberados` : 'seu ingresso foi liberado'}. Bom evento!`,
      contentHtml,
      footerNote: 'Apresente o QR na entrada. Em caso de dúvidas, responda este email.',
    }),
  }
}

interface AudienceProducerPayload {
  produtorNome?: string
  produtorEmail: string
  eventoNome?: string
  buyerName?: string
  buyerEmail?: string
  quantidade?: number
  valorBruto?: number
  comissao?: number
  valorLiquido?: number
  appUrl?: string
}

function buildAudienceProducerNotification(p: AudienceProducerPayload) {
  const linhas = [
    p.eventoNome ? infoRow('Evento', escape(p.eventoNome)) : '',
    typeof p.quantidade === 'number' ? infoRow('Quantidade', String(p.quantidade)) : '',
    p.buyerName ? infoRow('Comprador', escape(p.buyerName)) : '',
    p.buyerEmail ? infoRow('Email', escape(p.buyerEmail)) : '',
    typeof p.valorBruto === 'number' ? infoRow('Valor bruto', escape(money(p.valorBruto))) : '',
    typeof p.comissao === 'number' ? infoRow('Comissão plataforma', escape(money(p.comissao))) : '',
    typeof p.valorLiquido === 'number' ? infoRow('Valor líquido (você recebe)', `<span style="color:#16a34a;">${escape(money(p.valorLiquido))}</span>`) : '',
  ].filter(Boolean).join('')

  return {
    subject: `Nova venda de ingresso — ${p.eventoNome ?? 'CoreoHub'}`,
    html: baseLayout({
      preheader: `Nova venda de ingresso de plateia em ${p.eventoNome ?? 'seu evento'}.`,
      title: 'Nova venda de ingresso',
      intro: `Olá ${escape(p.produtorNome ?? 'produtor(a)')}, ${p.quantidade && p.quantidade > 1 ? `${p.quantidade} ingressos foram comprados` : 'um ingresso foi comprado'} para o seu evento.`,
      contentHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${linhas}</table>`,
      ctaLabel: 'Ver vendas',
      ctaUrl: `${p.appUrl ?? 'https://app.coreohub.com'}/vendas-ingressos`,
      footerNote: 'Você está recebendo este email por ser o produtor responsável pelo evento.',
    }),
  }
}

// ─── Templates: workshop_registration_confirmed + workshop_registration_producer
// Backlog item: faltava implementação. Webhook já disparava, edge function só
// logava warning. Workshops ja existem como entidade desde Etapa 1 (2026-05-04).

interface WorkshopConfirmedPayload {
  buyerName?: string
  buyerEmail: string
  /** Email do produtor — vira reply-to */
  produtorEmail?: string
  workshopNome?: string
  professorNome?: string
  modalidade?: string
  dataInicio?: string  // já formatada em PT-BR pelo caller
  local?: string
  valorPago?: number
  /** URL pública do voucher (/meu-workshop/<token>) — onde o aluno acessa QR */
  voucherUrl?: string
  /** Workshop comprado em combo com inscrição da mostra (gratuito ou desconto). */
  isCombo?: boolean
  appUrl?: string
}

function buildWorkshopRegistrationConfirmation(p: WorkshopConfirmedPayload) {
  const linhas = [
    p.workshopNome  ? infoRow('Workshop',  escape(p.workshopNome))  : '',
    p.professorNome ? infoRow('Professor(a)', escape(p.professorNome)) : '',
    p.modalidade    ? infoRow('Modalidade', escape(p.modalidade))    : '',
    p.dataInicio    ? infoRow('Data',       escape(p.dataInicio))    : '',
    p.local         ? infoRow('Local',      escape(p.local))         : '',
    typeof p.valorPago === 'number' && p.valorPago > 0
      ? infoRow('Valor pago', escape(money(p.valorPago)))
      : (p.isCombo ? infoRow('Valor', '<span style="color:#16a34a;font-weight:700;">Combo grátis (já incluso na inscrição)</span>') : ''),
  ].filter(Boolean).join('')

  // Bloco do voucher destacado (igual à credencial digital — link com QR).
  let voucherBlock = ''
  if (p.voucherUrl) {
    voucherBlock = `
      <div style="margin-top:24px;padding:20px;border:2px solid ${BRAND_COLOR};border-radius:16px;background:#fff5f8;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${BRAND_COLOR};">Seu voucher do workshop</p>
        <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#475569;">
          Apresente o QR no credenciamento da aula. Acesse pelo celular pra exibir a tela com o código.
        </p>
        <a href="${escape(p.voucherUrl)}" style="display:inline-block;padding:12px 24px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">
          Acessar voucher →
        </a>
      </div>`
  }

  const contentHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${linhas}</table>
    ${voucherBlock}
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      Guarde este email como comprovante. Em caso de dúvidas sobre horário ou material da aula, responda este email pra falar diretamente com a produção.
    </p>`

  const subjectPrefix = p.workshopNome ? `[${p.workshopNome}] ` : ''
  return {
    subject: `${subjectPrefix}Inscrição confirmada${p.isCombo ? ' (combo)' : ''}`,
    html: baseLayout({
      preheader: `Sua vaga no workshop ${p.workshopNome ?? ''} está garantida.`,
      title: p.isCombo ? 'Workshop liberado!' : 'Inscrição confirmada!',
      intro: `Olá ${escape(p.buyerName ?? 'aluno(a)')}, ${p.isCombo
        ? `seu acesso ao workshop foi liberado como combo da sua inscrição na mostra.`
        : `recebemos seu pagamento e sua vaga no workshop está garantida.`} Bora dançar!`,
      contentHtml,
      ctaLabel: 'Acessar meu workshop',
      ctaUrl: p.voucherUrl ?? `${p.appUrl ?? 'https://coreohub.com'}/meus-workshops`,
    }),
  }
}

interface WorkshopProducerPayload {
  produtorNome?: string
  produtorEmail: string
  workshopNome?: string
  buyerName?: string
  buyerEmail?: string
  valorBruto?: number
  comissao?: number
  valorLiquido?: number
  isCombo?: boolean
  appUrl?: string
}

function buildWorkshopProducerNotification(p: WorkshopProducerPayload) {
  const linhas = [
    p.workshopNome ? infoRow('Workshop', escape(p.workshopNome)) : '',
    p.buyerName    ? infoRow('Aluno(a)', escape(p.buyerName))    : '',
    p.buyerEmail   ? infoRow('Email',    escape(p.buyerEmail))   : '',
    p.isCombo
      ? infoRow('Modalidade', '<span style="color:#7c3aed;font-weight:700;">Combo grátis (vinculado à inscrição da mostra)</span>')
      : (typeof p.valorBruto === 'number' ? infoRow('Valor bruto', escape(money(p.valorBruto))) : ''),
    !p.isCombo && typeof p.comissao === 'number'     ? infoRow('Comissão plataforma', escape(money(p.comissao)))                                                                       : '',
    !p.isCombo && typeof p.valorLiquido === 'number' ? infoRow('Valor líquido (você recebe)', `<span style="color:#16a34a;">${escape(money(p.valorLiquido))}</span>`)                  : '',
  ].filter(Boolean).join('')

  return {
    subject: `Nova inscrição em workshop — ${p.workshopNome ?? 'CoreoHub'}`,
    html: baseLayout({
      preheader: `Nova inscrição de aluno em ${p.workshopNome ?? 'seu workshop'}.`,
      title: 'Nova inscrição em workshop',
      intro: `Olá ${escape(p.produtorNome ?? 'produtor(a)')}, ${p.isCombo
        ? `um aluno foi liberado como combo grátis no seu workshop (vinculado à inscrição na mostra).`
        : `um aluno comprou vaga no seu workshop.`}`,
      contentHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${linhas}</table>`,
      ctaLabel: 'Ver inscrições',
      ctaUrl: `${p.appUrl ?? 'https://app.coreohub.com'}/workshops-do-evento`,
      footerNote: 'Você está recebendo este email por ser o produtor responsável pelo workshop.',
    }),
  }
}

// ─── Templates: fatura agregada (carrinho — Sessão 2) ──────────────────────
// 4 templates novos: criação da fatura, confirmação consolidada, lembrete
// X dias antes do deadline, último aviso 24h antes.

interface AggregateInvoicePayload {
  inscritoNome?:  string
  inscritoEmail:  string
  produtorEmail?: string
  eventoNome?:    string
  eventoData?:    string
  invoiceUrl:     string
  valorTotal:     number
  expiresAt?:     string  // string ISO ou já formatado em PT-BR
  coreografias?:  Array<{ nome: string; formacao?: string; charged?: number }>
  appUrl?:        string
}

function fmtListaCoreografias(coreos: Array<{ nome: string; formacao?: string; charged?: number }>): string {
  return coreos.map(c => `
    <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
      <p style="margin:0;font-size:13px;color:#0b0b0f;font-weight:600;">
        ${escape(c.nome)}${c.formacao ? ` <span style="color:#94a3b8;font-weight:400;">· ${escape(c.formacao)}</span>` : ''}
      </p>
      ${typeof c.charged === 'number' ? `<p style="margin:2px 0 0;font-size:12px;color:#64748b;">${escape(money(c.charged))}</p>` : ''}
    </td></tr>`).join('')
}

function buildAggregateInvoiceCreated(p: AggregateInvoicePayload) {
  const coreos = Array.isArray(p.coreografias) ? p.coreografias : []
  const n = coreos.length
  const listaHtml = coreos.length > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${fmtListaCoreografias(coreos)}</table>`
    : ''

  const expiraLine = p.expiresAt
    ? `<p style="margin:12px 0 0;font-size:12px;color:#b45309;font-weight:600;">⏰ Pague até ${escape(p.expiresAt)}.</p>`
    : ''

  const contentHtml = `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#334155;">
      Suas <strong>${n} coreografia${n !== 1 ? 's' : ''}</strong>${p.eventoNome ? ` no <strong>${escape(p.eventoNome)}</strong>` : ''}
      estão prontas pra pagamento em <strong>uma fatura única</strong> de <strong>${escape(money(p.valorTotal))}</strong>.
    </p>
    ${listaHtml}
    <div style="margin-top:20px;padding:16px;border-radius:12px;background:#f1f5f9;">
      <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#64748b;font-weight:700;">Valor total</p>
      <p style="margin:4px 0 0;font-size:22px;color:#0b0b0f;font-weight:900;">${escape(money(p.valorTotal))}</p>
      ${expiraLine}
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">
      Se a inscrição for cancelada antes do pagamento, a fatura é descartada automaticamente.
    </p>`

  return {
    subject: `${p.eventoNome ? `[${p.eventoNome}] ` : ''}Sua fatura — ${n} coreografia${n !== 1 ? 's' : ''}`,
    html: baseLayout({
      preheader: `Pague suas ${n} coreografias em um PIX único de ${money(p.valorTotal)}.`,
      title: `${n} coreografia${n !== 1 ? 's' : ''} prontas pra pagar`,
      intro: `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, geramos uma fatura única com todas as suas coreografias pendentes.`,
      contentHtml,
      ctaLabel: 'Pagar agora',
      ctaUrl: p.invoiceUrl,
    }),
  }
}

interface AggregateConfirmedPayload {
  inscritoNome?:  string
  inscritoEmail:  string
  produtorEmail?: string
  eventoNome?:    string
  eventoData?:    string
  eventoLocal?:   string
  valorTotal:     number
  coreografias:   Array<{ nome: string; formacao?: string; charged?: number; registrationId?: string }>
  appUrl?:        string
}

function buildAggregateConfirmed(p: AggregateConfirmedPayload) {
  const n = p.coreografias.length
  const linhasInfo = [
    p.eventoNome  ? infoRow('Evento', escape(p.eventoNome)) : '',
    p.eventoData  ? infoRow('Data',   escape(p.eventoData)) : '',
    p.eventoLocal ? infoRow('Local',  escape(p.eventoLocal)) : '',
    infoRow('Coreografias', String(n)),
    infoRow('Valor pago total', escape(money(p.valorTotal))),
  ].filter(Boolean).join('')

  const listaHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${fmtListaCoreografias(p.coreografias)}</table>`

  const appUrl = p.appUrl ?? 'https://coreohub.com'
  const contentHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${linhasInfo}</table>
    <p style="margin:24px 0 8px;font-size:13px;font-weight:700;color:#0b0b0f;">
      Coreografias confirmadas:
    </p>
    ${listaHtml}
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      Cada coreografia tem sua própria credencial digital — acesse em
      <a href="${appUrl}/minhas-coreografias" style="color:${BRAND_COLOR};font-weight:700;">Minhas Coreografias</a>
      pra ver os QRs.
    </p>`

  return {
    subject: `${p.eventoNome ? `[${p.eventoNome}] ` : ''}${n} inscrições confirmadas`,
    html: baseLayout({
      preheader: `Pagamento aprovado. ${n} coreografias garantidas em ${p.eventoNome ?? 'CoreoHub'}.`,
      title: `${n} inscrições confirmadas!`,
      intro: `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, recebemos seu pagamento e suas ${n} coreografias foram <strong>aprovadas</strong>. Bora dançar!`,
      contentHtml,
      ctaLabel: 'Ver minhas coreografias',
      ctaUrl: `${appUrl}/minhas-coreografias`,
    }),
  }
}

interface AggregateReminderPayload {
  inscritoNome?:  string
  inscritoEmail:  string
  produtorEmail?: string
  eventoNome?:    string
  invoiceUrl:     string
  valorTotal:     number
  qtdCoreografias: number
  expiresAt:      string  // formatado em PT-BR
  diasRestantes:  number  // pra ajustar tom do email
  appUrl?:        string
}

function buildAggregateReminder(p: AggregateReminderPayload) {
  const isLastChance = p.diasRestantes <= 1
  const urgencyColor = isLastChance ? '#dc2626' : '#f59e0b'
  const urgencyBg    = isLastChance ? '#fef2f2' : '#fffbeb'
  const urgencyBd    = isLastChance ? '#fecaca' : '#fde68a'

  const titulo = isLastChance ? 'Última chance — suas inscrições vencem amanhã' : `Faltam ${p.diasRestantes} dia${p.diasRestantes !== 1 ? 's' : ''} pra pagar`
  const intro  = isLastChance
    ? `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, suas <strong>${p.qtdCoreografias} coreografias</strong> pendentes vencem em menos de 24h. Se não pagar até ${escape(p.expiresAt)}, elas serão canceladas.`
    : `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, você tem <strong>${p.qtdCoreografias} coreografias</strong> pendentes${p.eventoNome ? ` no <strong>${escape(p.eventoNome)}</strong>` : ''}. Pague até <strong>${escape(p.expiresAt)}</strong> pra garantir sua participação.`

  const contentHtml = `
    <div style="margin-top:4px;padding:18px;border:2px solid ${urgencyBd};border-radius:14px;background:${urgencyBg};">
      <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${urgencyColor};">
        ${isLastChance ? '⚠ Última chance' : `⏰ Faltam ${p.diasRestantes} dia${p.diasRestantes !== 1 ? 's' : ''}`}
      </p>
      <p style="margin:8px 0 0;font-size:24px;font-weight:900;color:#0b0b0f;">${escape(money(p.valorTotal))}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#64748b;font-weight:600;">
        ${p.qtdCoreografias} coreografia${p.qtdCoreografias !== 1 ? 's' : ''} pendente${p.qtdCoreografias !== 1 ? 's' : ''}${p.eventoNome ? ` · ${escape(p.eventoNome)}` : ''}
      </p>
    </div>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      ${isLastChance
        ? 'Depois desse prazo as inscrições viram inválidas e o produtor pode não conseguir te encaixar mais.'
        : 'O produtor encerrou as inscrições e os pagamentos vão até a data limite. Não deixa pra última hora.'}
    </p>`

  return {
    subject: `${p.eventoNome ? `[${p.eventoNome}] ` : ''}${isLastChance ? '⚠ Última chance — paga até amanhã' : `Faltam ${p.diasRestantes} dias`}`,
    html: baseLayout({
      preheader: `${p.qtdCoreografias} coreografias pendentes — ${money(p.valorTotal)} até ${p.expiresAt}.`,
      title: titulo,
      intro,
      contentHtml,
      ctaLabel: 'Pagar agora',
      ctaUrl: p.invoiceUrl,
    }),
  }
}

// ─── Seletiva por vídeo (Modelo 3 — Sessão seletiva 2026-05-19) ────────────

interface VideoFeePaidUploadReadyPayload {
  inscritoNome?:  string
  inscritoEmail:  string
  eventoNome?:    string
  coreografia?:   string
  ctaUrl:         string  // link pra /seletiva onde envia o vídeo
}

function buildVideoFeePaidUploadReady(p: VideoFeePaidUploadReadyPayload) {
  // Joinville-style: vídeo já foi enviado no wizard. Este email confirma
  // pagamento da taxa A e avisa que a comissão vai analisar — sem CTA de ação.
  const titulo = 'Taxa de seletiva paga — vídeo em análise'
  const intro  = `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, recebemos o pagamento da taxa de seletiva da coreografia <strong>${escape(p.coreografia ?? '')}</strong>${p.eventoNome ? ` no <strong>${escape(p.eventoNome)}</strong>` : ''}. O vídeo enviado na inscrição já está na fila da comissão pra análise.`

  const contentHtml = `
    <div style="margin-top:4px;padding:18px;border:2px solid #34d399;border-radius:14px;background:#ecfdf5;">
      <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#059669;">✓ Pagamento confirmado · Vídeo em análise</p>
      <p style="margin:8px 0 0;font-size:14px;color:#0b0b0f;font-weight:600;">${escape(p.coreografia ?? 'Coreografia')}</p>
    </div>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      Sem ação necessária agora. A comissão vai avaliar o vídeo e você recebe outro email com o resultado. Se for aprovada, libera o pagamento da taxa de inscrição (cheia). Pode acompanhar o status na sua área de seletiva.
    </p>`

  return {
    subject: `${p.eventoNome ? `[${p.eventoNome}] ` : ''}Vídeo em análise pela comissão`,
    html: baseLayout({
      preheader: 'Taxa de seletiva paga. Vídeo já está na fila — aguarde o resultado.',
      title: titulo,
      intro,
      contentHtml,
      ctaLabel: 'Acompanhar status',
      ctaUrl: p.ctaUrl,
    }),
  }
}

interface VideoApprovedInscriptionReadyPayload {
  inscritoNome?:  string
  inscritoEmail:  string
  eventoNome?:    string
  coreografia?:   string
  ctaUrl:         string  // link pra /seletiva onde paga a inscrição cheia
}

function buildVideoApprovedInscriptionReady(p: VideoApprovedInscriptionReadyPayload) {
  const titulo = 'Aprovado na seletiva! 🎉'
  const intro  = `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, parabéns — a coreografia <strong>${escape(p.coreografia ?? '')}</strong>${p.eventoNome ? ` no <strong>${escape(p.eventoNome)}</strong>` : ''} foi aprovada pela comissão de seletiva. Agora você pode concluir a inscrição pagando a taxa do festival.`

  const contentHtml = `
    <div style="margin-top:4px;padding:18px;border:2px solid #34d399;border-radius:14px;background:#ecfdf5;">
      <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#059669;">✓ Vídeo aprovado</p>
      <p style="margin:8px 0 0;font-size:14px;color:#0b0b0f;font-weight:600;">${escape(p.coreografia ?? 'Coreografia')}</p>
    </div>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      Acesse a página da seletiva pra gerar a cobrança da taxa de inscrição. Depois do pagamento, sua inscrição é confirmada e você entra no cronograma do evento.
    </p>`

  return {
    subject: `${p.eventoNome ? `[${p.eventoNome}] ` : ''}Aprovado na seletiva — conclua sua inscrição`,
    html: baseLayout({
      preheader: 'Sua coreografia passou na seletiva. Pague a inscrição pra confirmar.',
      title: titulo,
      intro,
      contentHtml,
      ctaLabel: 'Pagar inscrição',
      ctaUrl: p.ctaUrl,
    }),
  }
}

interface VideoRejectedPayload {
  inscritoNome?:  string
  inscritoEmail:  string
  eventoNome?:    string
  coreografia?:   string
  feedback?:      string
  refundAmount?:  number   // R$ a estornar (0 se policy=no_refund)
  refundPolicy?:  'no_refund' | 'partial_refund' | 'full_refund'
}

function buildVideoRejected(p: VideoRejectedPayload) {
  const titulo = 'Resultado da seletiva'
  const intro  = `Olá ${escape(p.inscritoNome ?? 'bailarino(a)')}, agradecemos sua inscrição da coreografia <strong>${escape(p.coreografia ?? '')}</strong>${p.eventoNome ? ` no <strong>${escape(p.eventoNome)}</strong>` : ''}. A comissão analisou o vídeo e infelizmente não pôde classificá-la pra esta edição.`

  const refundLabel = p.refundPolicy === 'full_refund'    ? 'Estorno integral da taxa de seletiva'
                    : p.refundPolicy === 'partial_refund' ? 'Estorno parcial da taxa de seletiva'
                    : 'Sem estorno (taxa de seletiva = serviço de análise prestado)'
  const refundColor = p.refundPolicy === 'no_refund' ? '#64748b' : '#059669'
  const refundBg    = p.refundPolicy === 'no_refund' ? '#f1f5f9' : '#ecfdf5'
  const refundBd    = p.refundPolicy === 'no_refund' ? '#e2e8f0' : '#34d399'

  const feedbackBlock = p.feedback
    ? `<div style="margin-top:14px;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;">
         <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#64748b;">Feedback da comissão</p>
         <p style="margin:8px 0 0;font-size:13px;color:#0b0b0f;line-height:1.5;">${escape(p.feedback)}</p>
       </div>`
    : ''

  const contentHtml = `
    <div style="margin-top:4px;padding:18px;border:2px solid ${refundBd};border-radius:14px;background:${refundBg};">
      <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${refundColor};">${refundLabel}</p>
      ${p.refundAmount && p.refundAmount > 0
        ? `<p style="margin:8px 0 0;font-size:20px;font-weight:900;color:#0b0b0f;">${escape(money(p.refundAmount))}</p>
           <p style="margin:4px 0 0;font-size:12px;color:#64748b;">O estorno entra na conta original em até 5 dias úteis.</p>`
        : `<p style="margin:8px 0 0;font-size:12px;color:#64748b;">A taxa de seletiva remunera a análise técnica do vídeo pela comissão, conforme regulamento do evento.</p>`}
    </div>
    ${feedbackBlock}
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#475569;">
      Obrigado por participar. Continuem dançando — esperamos vocês na próxima!
    </p>`

  return {
    subject: `${p.eventoNome ? `[${p.eventoNome}] ` : ''}Resultado da seletiva`,
    html: baseLayout({
      preheader: 'Resultado da análise da comissão de seletiva.',
      title: titulo,
      intro,
      contentHtml,
    }),
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

interface SendEmailRequest {
  type:
    | 'payment_confirmed_registrant'
    | 'payment_confirmed_producer'
    | 'event_created_producer'
    | 'producer_welcome'
    | 'audience_ticket_confirmed'
    | 'audience_ticket_producer'
    | 'workshop_registration_confirmed'
    | 'workshop_registration_producer'
    | 'aggregate_invoice_created'
    | 'aggregate_payment_confirmed'
    | 'aggregate_reminder'
    | 'video_fee_paid_upload_ready'
    | 'video_approved_inscription_ready'
    | 'video_rejected'
  payload: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Auth: chamadas internas (service_role_key) → liberadas para qualquer tipo.
  // Chamadas com user JWT → liberadas apenas para 'producer_welcome' e somente
  // se o email do payload bater com o email do JWT (evita phishing).
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
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
    let festivalName: string | undefined
    let replyTo: string | undefined

    switch (type) {
      case 'payment_confirmed_registrant': {
        const p = payload as unknown as RegistrantPayload
        if (!p.inscritoEmail) throw new Error('inscritoEmail é obrigatório')
        const tpl = buildRegistrantConfirmation(p)
        to = p.inscritoEmail
        subject = tpl.subject
        html = tpl.html
        // From name combinado: "{festival} via CoreoHub"
        festivalName = p.eventoNome
        // Reply-to do produtor: bailarino que responde, fala com o produtor
        replyTo = p.produtorEmail
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

        // Em paralelo, dispara notificação interna pro admin do CoreoHub
        // (best-effort — falha não bloqueia o producer_welcome).
        const adminEmail = Deno.env.get('ADMIN_NOTIFY_EMAIL') ?? 'contato@coreohub.com'
        try {
          const adminTpl = buildAdminNewProducer({
            produtorNome: p.produtorNome,
            produtorEmail: p.produtorEmail,
          })
          // fire-and-forget — não await pra não atrasar a resposta
          sendViaResend({
            to: adminEmail,
            subject: adminTpl.subject,
            html: adminTpl.html,
          }).catch(err => console.warn('[send-email] admin notify falhou:', err?.message ?? err))
        } catch (err: any) {
          console.warn('[send-email] admin notify skip:', err?.message ?? err)
        }
        break
      }
      case 'audience_ticket_confirmed': {
        const p = payload as unknown as AudienceTicketPayload
        if (!p.buyerEmail) throw new Error('buyerEmail é obrigatório')
        const tpl = buildAudienceTicketConfirmation(p)
        to = p.buyerEmail
        subject = tpl.subject
        html = tpl.html
        festivalName = p.eventoNome
        replyTo = p.produtorEmail   // comprador responde → produtor recebe
        break
      }
      case 'audience_ticket_producer': {
        const p = payload as unknown as AudienceProducerPayload
        if (!p.produtorEmail) throw new Error('produtorEmail é obrigatório')
        const tpl = buildAudienceProducerNotification(p)
        to = p.produtorEmail
        subject = tpl.subject
        html = tpl.html
        break
      }
      case 'workshop_registration_confirmed': {
        const p = payload as unknown as WorkshopConfirmedPayload
        if (!p.buyerEmail) throw new Error('buyerEmail é obrigatório')
        const tpl = buildWorkshopRegistrationConfirmation(p)
        to = p.buyerEmail
        subject = tpl.subject
        html = tpl.html
        festivalName = p.workshopNome
        replyTo = p.produtorEmail   // aluno responde → produtor recebe
        break
      }
      case 'workshop_registration_producer': {
        const p = payload as unknown as WorkshopProducerPayload
        if (!p.produtorEmail) throw new Error('produtorEmail é obrigatório')
        const tpl = buildWorkshopProducerNotification(p)
        to = p.produtorEmail
        subject = tpl.subject
        html = tpl.html
        break
      }
      case 'aggregate_invoice_created': {
        const p = payload as unknown as AggregateInvoicePayload
        if (!p.inscritoEmail) throw new Error('inscritoEmail é obrigatório')
        if (!p.invoiceUrl)    throw new Error('invoiceUrl é obrigatório')
        const tpl = buildAggregateInvoiceCreated(p)
        to = p.inscritoEmail
        subject = tpl.subject
        html = tpl.html
        festivalName = p.eventoNome
        replyTo = p.produtorEmail
        break
      }
      case 'aggregate_payment_confirmed': {
        const p = payload as unknown as AggregateConfirmedPayload
        if (!p.inscritoEmail) throw new Error('inscritoEmail é obrigatório')
        const tpl = buildAggregateConfirmed(p)
        to = p.inscritoEmail
        subject = tpl.subject
        html = tpl.html
        festivalName = p.eventoNome
        replyTo = p.produtorEmail
        break
      }
      case 'aggregate_reminder': {
        const p = payload as unknown as AggregateReminderPayload
        if (!p.inscritoEmail) throw new Error('inscritoEmail é obrigatório')
        if (!p.invoiceUrl)    throw new Error('invoiceUrl é obrigatório')
        const tpl = buildAggregateReminder(p)
        to = p.inscritoEmail
        subject = tpl.subject
        html = tpl.html
        festivalName = p.eventoNome
        replyTo = p.produtorEmail
        break
      }
      case 'video_fee_paid_upload_ready': {
        const p = payload as unknown as VideoFeePaidUploadReadyPayload
        if (!p.inscritoEmail) throw new Error('inscritoEmail é obrigatório')
        if (!p.ctaUrl)        throw new Error('ctaUrl é obrigatório')
        const tpl = buildVideoFeePaidUploadReady(p)
        to = p.inscritoEmail
        subject = tpl.subject
        html = tpl.html
        festivalName = p.eventoNome
        break
      }
      case 'video_approved_inscription_ready': {
        const p = payload as unknown as VideoApprovedInscriptionReadyPayload
        if (!p.inscritoEmail) throw new Error('inscritoEmail é obrigatório')
        if (!p.ctaUrl)        throw new Error('ctaUrl é obrigatório')
        const tpl = buildVideoApprovedInscriptionReady(p)
        to = p.inscritoEmail
        subject = tpl.subject
        html = tpl.html
        festivalName = p.eventoNome
        break
      }
      case 'video_rejected': {
        const p = payload as unknown as VideoRejectedPayload
        if (!p.inscritoEmail) throw new Error('inscritoEmail é obrigatório')
        const tpl = buildVideoRejected(p)
        to = p.inscritoEmail
        subject = tpl.subject
        html = tpl.html
        festivalName = p.eventoNome
        break
      }
      default:
        throw new Error(`type desconhecido: ${type}`)
    }

    const { id } = await sendViaResend({ to, subject, html, festivalName, replyTo })

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
