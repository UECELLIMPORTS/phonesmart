/**
 * Helpers de envio de email transacional via Resend.
 *
 * Pra ativar:
 * 1. Crie conta no Resend: https://resend.com (free tier: 100 emails/dia, 3.000/mês)
 * 2. Verifique seu domínio de envio (recomendado: noreply@gestaointeligente.com.br)
 *    — enquanto não verifica, dá pra usar onboarding@resend.dev pra testes
 * 3. Pegue API key em https://resend.com/api-keys
 * 4. Adicione no .env.local (e no Vercel pra produção):
 *    RESEND_API_KEY=re_xxxxxxxxxxxxx
 *    EMAIL_FROM="Phone Smart <noreply@gestaointeligente.com.br>"
 *
 * Sem RESEND_API_KEY, sendEmail() apenas loga no console (modo dev).
 * Isso permite o app funcionar mesmo antes da configuração ficar pronta.
 */

import { Resend } from 'resend'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM     = process.env.EMAIL_FROM ?? 'Phone Smart <onboarding@resend.dev>'

/** Origem do app pros links nos emails (botões CTA). Usa env quando setada;
 *  fallback pro domínio de produção. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL
      || process.env.APP_URL
      || 'https://app.gestaophonesmart.online'
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null

export type EmailParams = {
  to:      string
  subject: string
  html:    string
}

export async function sendEmail({ to, subject, html }: EmailParams): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.log('[email:dev-mode] sem RESEND_API_KEY — email não enviado:')
    console.log('  to:', to)
    console.log('  subject:', subject)
    console.log('  html:', html.slice(0, 200) + (html.length > 200 ? '...' : ''))
    return { ok: true }   // não falha o flow do user só por isso
  }

  try {
    const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, html })
    if (error) {
      console.error('[email] erro Resend:', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    console.error('[email] exceção:', e)
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export type EmailAttachment = {
  filename: string
  content:  Buffer
}

export async function sendEmailWithAttachment(
  params: EmailParams & { attachments: EmailAttachment[] },
): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.log('[email:dev-mode] sem RESEND_API_KEY — email com anexo não enviado:')
    console.log('  to:', params.to)
    console.log('  subject:', params.subject)
    console.log('  attachments:', params.attachments.map(a => `${a.filename} (${a.content.byteLength}b)`).join(', '))
    return { ok: true }
  }

  try {
    const { error } = await resend.emails.send({
      from:    EMAIL_FROM,
      to:      params.to,
      subject: params.subject,
      html:    params.html,
      attachments: params.attachments.map(a => ({
        filename: a.filename,
        content:  a.content,
      })),
    })
    if (error) {
      console.error('[email] erro Resend (attach):', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    console.error('[email] exceção (attach):', e)
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

/** Email de boas-vindas após signup. */
export async function sendWelcomeEmail({
  to, fullName, tenantName,
}: {
  to: string; fullName: string; tenantName: string
}) {
  return sendEmail({
    to,
    subject: 'Bem-vindo à Phone Smart!',
    html: htmlShell({
      title: `Bem-vindo, ${escapeHtml(fullName.split(' ')[0])}!`,
      body: `
        <p>Sua conta da <strong>${escapeHtml(tenantName)}</strong> foi criada com sucesso.</p>
        <p>Você tem <strong>7 dias grátis</strong> com todos os recursos liberados — explore tudo
        sem compromisso.</p>
        <h3 style="margin-top: 32px;">Por onde começar:</h3>
        <ol>
          <li>Cadastre seus primeiros produtos no <strong>Estoque</strong></li>
          <li>Faça uma venda de teste no <strong>Frente de Caixa</strong></li>
          <li>Veja o <strong>Dashboard</strong> em tempo real</li>
        </ol>
      `,
      ctaUrl:   `${appUrl()}/`,
      ctaLabel: 'Acessar o sistema',
    }),
  })
}

/** Aviso de fim de trial próximo (mandado D-3, D-1, D-0). */
export async function sendTrialEndingEmail({
  to, fullName, daysLeft,
}: {
  to: string; fullName: string; daysLeft: number
}) {
  const urgent = daysLeft <= 1
  return sendEmail({
    to,
    subject: urgent
      ? `🚨 ${daysLeft === 0 ? 'Seu trial expira HOJE' : 'Seu trial expira amanhã'}`
      : `Faltam ${daysLeft} dias do seu trial`,
    html: htmlShell({
      title: urgent ? 'Seu trial está acabando' : 'Faltam poucos dias',
      body: `
        <p>Olá ${escapeHtml(fullName.split(' ')[0])},</p>
        <p>${daysLeft === 0
          ? 'Seu período de teste expira hoje.'
          : daysLeft === 1
            ? 'Seu período de teste expira amanhã.'
            : `Faltam <strong>${daysLeft} dias</strong> do seu período de teste.`}</p>
        <p>Pra continuar usando todos os recursos, escolha um plano agora:</p>
      `,
      ctaUrl:   `${appUrl()}/configuracoes/assinatura`,
      ctaLabel: 'Escolher meu plano',
    }),
  })
}

// ── Internals ────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ))
}

/** Wrapper HTML padrão dos emails — header, body, CTA, footer. */
export function htmlShell({
  title, body, ctaUrl, ctaLabel,
}: {
  title: string; body: string; ctaUrl?: string; ctaLabel?: string
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f9;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:linear-gradient(135deg,#00E5FF,#00FF94);padding:32px 32px;text-align:center;">
            <span style="font-size:20px;font-weight:bold;color:#080C14;">Phone Smart</span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 32px 24px;">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#080C14;">${escapeHtml(title)}</h1>
            <div style="font-size:15px;line-height:1.6;color:#3a4a60;">
              ${body}
            </div>
            ${ctaUrl && ctaLabel ? `
              <div style="margin:32px 0 8px;text-align:center;">
                <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#00E5FF,#00FF94);color:#080C14;font-weight:bold;text-decoration:none;border-radius:10px;font-size:14px;">
                  ${escapeHtml(ctaLabel)}
                </a>
              </div>
            ` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;border-top:1px solid #e6eaef;text-align:center;font-size:12px;color:#8AA8C8;">
            <p style="margin:0 0 8px;">Phone Smart · Aracaju, SE</p>
            <p style="margin:0;">
              <a href="https://smartgestao-site.vercel.app" style="color:#00B5CC;text-decoration:none;">Site</a> ·
              <a href="https://smartgestao-site.vercel.app/privacidade" style="color:#00B5CC;text-decoration:none;">Privacidade</a> ·
              <a href="https://wa.me/5579999998876" style="color:#00B5CC;text-decoration:none;">WhatsApp</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
