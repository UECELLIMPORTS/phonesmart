/**
 * Cron — Dispatch da fila de mensagens WhatsApp + email opcional.
 *
 * Roda a cada 15 minutos. Pega scheduled_whatsapp_messages com
 * status='pending' e scheduled_for <= now(), envia via Evolution API.
 * Se o template tiver send_email=true e o customer tiver email, também
 * envia via Resend (independente do WhatsApp ter sucesso).
 *
 * Anti-flood: limita 50 envios por execução.
 * Retry: até 3 tentativas; depois marca como 'failed' (só pra WhatsApp).
 * Email é one-shot — falhou, registra e segue.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage, isEvolutionConfigured } from '@/lib/evolution'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_PER_RUN = 50
const MAX_ATTEMPTS = 3

function bodyToHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const withBold = escaped.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
  return withBold.replace(/\n/g, '<br>')
}

function emailHtml(body: string, subject: string): string {
  return `
    <div style="font-family:-apple-system,Helvetica Neue,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937">
      <h2 style="color:#1e3a8a;margin:0 0 16px">${subject}</h2>
      <div style="line-height:1.6;color:#1f2937">${bodyToHtml(body)}</div>
    </div>
  `
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 })
  }
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const nowIso = new Date().toISOString()
  const { data: queue, error: queueErr } = await sb
    .from('scheduled_whatsapp_messages')
    .select(`
      id, tenant_id, type, recipient_phone, body, attempt_count, customer_id,
      email_sent_at,
      tenants!inner(name, whatsapp_instance_name, whatsapp_status)
    `)
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(MAX_PER_RUN)

  if (queueErr) {
    return NextResponse.json({ ok: false, error: queueErr.message }, { status: 500 })
  }

  type Item = {
    id: string; tenant_id: string; type: string; recipient_phone: string
    body: string; attempt_count: number; customer_id: string | null
    email_sent_at: string | null
    tenants: { name: string; whatsapp_instance_name: string | null; whatsapp_status: string | null }
  }
  const items = (queue ?? []) as Item[]

  // Cache de templates por (tenant_id + type) e customers por id
  const templateCache = new Map<string, { send_email: boolean; email_subject: string | null }>()
  const customerCache = new Map<string, { full_name: string; email: string | null }>()

  async function getTemplate(tenantId: string, type: string) {
    const key = `${tenantId}|${type}`
    if (templateCache.has(key)) return templateCache.get(key)!
    const { data } = await sb
      .from('whatsapp_templates')
      .select('send_email, email_subject')
      .eq('tenant_id', tenantId)
      .eq('type', type)
      .maybeSingle()
    const tpl = data ?? { send_email: false, email_subject: null }
    templateCache.set(key, tpl)
    return tpl
  }

  async function getCustomer(customerId: string) {
    if (customerCache.has(customerId)) return customerCache.get(customerId)!
    const { data } = await sb
      .from('customers')
      .select('full_name, email')
      .eq('id', customerId)
      .maybeSingle()
    const cust = data ?? { full_name: '', email: null }
    customerCache.set(customerId, cust)
    return cust
  }

  let waSent = 0, waFailed = 0, waSkipped = 0
  let emailSent = 0, emailFailed = 0, emailSkipped = 0

  for (const item of items) {
    const instance = item.tenants?.whatsapp_instance_name
    const status   = item.tenants?.whatsapp_status

    // ── 1) Tenta enviar email se aplicável (independente do WhatsApp) ─────
    let emailDone = !!item.email_sent_at  // já enviado em tentativa anterior
    if (!emailDone && item.customer_id) {
      const tpl = await getTemplate(item.tenant_id, item.type)
      if (tpl.send_email) {
        const cust = await getCustomer(item.customer_id)
        if (cust.email) {
          const subject = tpl.email_subject ?? `[${item.tenants.name}] Notificação`
          const r = await sendEmail({
            to:      cust.email,
            subject: `[${item.tenants.name}] ${subject}`,
            html:    emailHtml(item.body, subject),
          })
          if (r.ok) {
            await sb
              .from('scheduled_whatsapp_messages')
              .update({ email_sent_at: new Date().toISOString(), email_error: null })
              .eq('id', item.id)
            emailSent++
            emailDone = true
          } else {
            await sb
              .from('scheduled_whatsapp_messages')
              .update({ email_error: r.error })
              .eq('id', item.id)
            emailFailed++
          }
        } else {
          emailSkipped++
        }
      } else {
        emailSkipped++
      }
    }

    // ── 2) Tenta WhatsApp se configurado ─────────────────────────────────
    if (!isEvolutionConfigured()) {
      // Sem Evolution, mas pode ter mandado email — marca conforme
      if (emailDone) {
        await sb
          .from('scheduled_whatsapp_messages')
          .update({
            status:        'sent',
            sent_at:       new Date().toISOString(),
            attempt_count: item.attempt_count + 1,
            last_error:    'WhatsApp não configurado — só email enviado',
          })
          .eq('id', item.id)
        waSent++
      } else {
        waSkipped++
      }
      continue
    }

    if (!instance || status !== 'connected') {
      await sb
        .from('scheduled_whatsapp_messages')
        .update({
          status:     emailDone ? 'sent' : 'cancelled',
          sent_at:    emailDone ? new Date().toISOString() : null,
          last_error: status === 'disconnected'
            ? 'WhatsApp do tenant não está conectado'
            : `tenant status: ${status ?? 'sem instância'}`,
        })
        .eq('id', item.id)
      if (emailDone) waSent++
      else           waSkipped++
      continue
    }

    const res = await sendTextMessage({
      instanceName: instance,
      phone:        item.recipient_phone,
      text:         item.body,
    })

    if (res.ok) {
      await sb
        .from('scheduled_whatsapp_messages')
        .update({
          status:               'sent',
          sent_at:              new Date().toISOString(),
          attempt_count:        item.attempt_count + 1,
          last_error:           null,
          evolution_message_id: res.data?.messageId ?? null,
        })
        .eq('id', item.id)
      waSent++
    } else {
      const newAttempt = item.attempt_count + 1
      const finalStatus = newAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending'
      await sb
        .from('scheduled_whatsapp_messages')
        .update({
          status:        finalStatus,
          attempt_count: newAttempt,
          last_error:    res.error,
        })
        .eq('id', item.id)
      waFailed++
    }
  }

  return NextResponse.json({
    ok: true,
    processed: items.length,
    whatsapp: { sent: waSent, failed: waFailed, skipped: waSkipped },
    email:    { sent: emailSent, failed: emailFailed, skipped: emailSkipped },
  })
}
