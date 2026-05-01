/**
 * Cron — Lembrete de aniversário (WhatsApp + Email opcional).
 *
 * Roda 1x/dia às 12:00 UTC (= 09:00 BRT). Pra cada tenant ativo:
 *   1. birthday_month — entre dia 1-5 do mês, pra todos que fazem aniv no mês
 *   2. birthday_day — pra quem faz aniv HOJE
 *
 * Cada template tem flags `enabled` (mestre on/off) e `send_email` (canal
 * email adicional). Se enabled=true:
 *   - Tem whatsapp + tenant conectado → agenda WhatsApp
 *   - Tem email + send_email=true → envia email direto via Resend
 *
 * Anti-duplicate por ano via scheduled_whatsapp_messages (mesmo p/ email,
 * pra simplificar — registramos um row "phantom" com phone='email:' caso
 * só tenha email).
 *
 * Edge case: aniv dia 1-3 — pula birthday_month (já recebeu birthday_day hoje).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleWhatsAppMessage } from '@/lib/whatsapp-scheduler'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type TplCfg = { enabled: boolean; body: string; send_email: boolean; email_subject: string | null }

function renderBody(body: string, vars: Record<string, string>): string {
  let out = body
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v)
  return out
}

function bodyToHtml(body: string): string {
  // Escape HTML básico + converte newlines em <br>, *negrito* em <strong>
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

  // Fuso BR no calendário
  const now = new Date()
  const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const todayMonth = brt.getMonth() + 1
  const todayDay   = brt.getDate()
  const year       = brt.getFullYear()
  const lastDayOfMonth = new Date(brt.getFullYear(), brt.getMonth() + 1, 0).getDate()

  // Tenants com qualquer template de aniversário ativo (não filtra por whatsapp_status
  // porque pode ter só email, sem WhatsApp conectado)
  const { data: tenants } = await sb
    .from('tenants')
    .select('id, name, whatsapp_status')

  type Tenant = { id: string; name: string; whatsapp_status: string | null }
  const tenantList = (tenants ?? []) as Tenant[]

  const result = {
    tenants:        0,
    whatsappSent:   0,
    emailSent:      0,
    skipped:        0,
    errors:         0,
  }

  for (const t of tenantList) {
    result.tenants++

    try {
      // Templates de aniversário
      const { data: tpls } = await sb
        .from('whatsapp_templates')
        .select('type, enabled, body, send_email, email_subject')
        .eq('tenant_id', t.id)
        .in('type', ['birthday_month', 'birthday_day'])

      type Tpl = { type: string; enabled: boolean; body: string; send_email: boolean; email_subject: string | null }
      const tplMap = new Map<string, TplCfg>()
      for (const tpl of (tpls ?? []) as Tpl[]) {
        tplMap.set(tpl.type, {
          enabled:       tpl.enabled,
          body:          tpl.body,
          send_email:    tpl.send_email,
          email_subject: tpl.email_subject,
        })
      }

      const monthTpl = tplMap.get('birthday_month')
      const dayTpl   = tplMap.get('birthday_day')

      const monthActive = monthTpl?.enabled ?? false
      const dayActive   = dayTpl?.enabled ?? false
      if (!monthActive && !dayActive) { result.skipped++; continue }

      const inMonthWindow = todayDay >= 1 && todayDay <= 5

      // Aniversariantes do MÊS — pega quem tem whatsapp OU email
      const { data: birthdayCustomers } = await sb
        .from('customers')
        .select('id, full_name, whatsapp, email, birth_date')
        .eq('tenant_id', t.id)
        .not('birth_date', 'is', null)
        .or('whatsapp.not.is.null,email.not.is.null')
        .limit(2000)

      type Customer = { id: string; full_name: string; whatsapp: string | null; email: string | null; birth_date: string }
      const allCustomers = (birthdayCustomers ?? []) as Customer[]

      const monthCustomers: Customer[] = []
      const dayCustomers: Customer[]   = []
      for (const c of allCustomers) {
        const [, mStr, dStr] = c.birth_date.split('-')
        if (parseInt(mStr, 10) === todayMonth) {
          monthCustomers.push(c)
          if (parseInt(dStr, 10) === todayDay) dayCustomers.push(c)
        }
      }

      // Helper: dispatch (WhatsApp + Email) com anti-duplicate por (type, customer, ano)
      const dispatch = async (
        c: Customer,
        type: 'birthday_month' | 'birthday_day',
        cfg: TplCfg,
      ) => {
        const yearStart = `${year}-01-01T00:00:00Z`
        const { data: prev } = await sb
          .from('scheduled_whatsapp_messages')
          .select('id')
          .eq('tenant_id', t.id)
          .eq('customer_id', c.id)
          .eq('type', type)
          .gte('created_at', yearStart)
          .limit(1)
          .maybeSingle()
        if (prev) { result.skipped++; return }

        const vars = {
          nome:            c.full_name.split(' ')[0],
          loja:            t.name,
          ano:             String(year),
          ultimo_dia_mes:  String(lastDayOfMonth),
        }
        const renderedBody = renderBody(cfg.body, vars)

        // WhatsApp
        let whatsappOk = false
        if (c.whatsapp && t.whatsapp_status === 'connected') {
          const r = await scheduleWhatsAppMessage({
            tenantId:     t.id,
            type,
            customerId:   c.id,
            referenceId:  c.id,
            scheduledFor: new Date().toISOString(),
          })
          if (r.ok && !r.skipped) {
            result.whatsappSent++
            whatsappOk = true
          }
        }

        // Email (independente do WhatsApp)
        if (cfg.send_email && c.email) {
          const subject = cfg.email_subject ?? (type === 'birthday_day' ? '🎂 Parabéns!' : '🎁 Mês de aniversário')
          const r = await sendEmail({
            to:      c.email,
            subject: `[${t.name}] ${subject}`,
            html:    emailHtml(renderedBody, subject),
          })
          if (r.ok) result.emailSent++
        }

        // Se não enviou nem WhatsApp nem foi pra email, conta skipped
        if (!whatsappOk && !(cfg.send_email && c.email)) result.skipped++

        // Registra no scheduled_whatsapp_messages como histórico (pra anti-duplicate ano que vem)
        // — só se NÃO foi agendado pelo scheduler (que já registra)
        if (!whatsappOk) {
          await sb.from('scheduled_whatsapp_messages').insert({
            tenant_id:       t.id,
            type,
            reference_id:    c.id,
            customer_id:     c.id,
            recipient_phone: c.email ? `email:${c.email}` : 'no-channel',
            body:            renderedBody,
            scheduled_for:   new Date().toISOString(),
            status:          'sent',
            sent_at:         new Date().toISOString(),
          })
        }
      }

      // Birthday DAY (prioridade)
      if (dayActive && dayTpl) {
        for (const c of dayCustomers) await dispatch(c, 'birthday_day', dayTpl)
      }

      // Birthday MONTH (1-5 do mês, pula aniversariantes do dia 1-3 que já receberam day)
      if (monthActive && monthTpl && inMonthWindow) {
        const dayCustomerIds = new Set(dayCustomers.map(c => c.id))
        for (const c of monthCustomers) {
          const [, , dStr] = c.birth_date.split('-')
          const birthDay = parseInt(dStr, 10)
          if (birthDay >= 1 && birthDay <= 3 && dayCustomerIds.has(c.id)) {
            result.skipped++
            continue
          }
          await dispatch(c, 'birthday_month', monthTpl)
        }
      }
    } catch (err) {
      console.error(`[whatsapp-birthdays] tenant ${t.id}:`, err)
      result.errors++
    }
  }

  return NextResponse.json({ ok: true, ...result })
}
