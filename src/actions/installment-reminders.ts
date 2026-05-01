'use server'

/**
 * Sprint 8 — Lembrete automático de parcelas.
 *
 * Estratégia:
 *   - Cron diário roda runDailyInstallmentReminders() pra todos os tenants
 *   - Pra cada parcela em [hoje-1, hoje+3] (vencendo ou recém-atrasada),
 *     verifica se já notificou nas últimas 20h. Se não, envia.
 *   - Canal email (Resend) + sempre registra um link wa.me que o user pode
 *     clicar manualmente em /financeiro/parcelas. Sem email, ainda funciona.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'

type ReminderResult = {
  scanned:     number
  sent:        number
  skipped:     number
  failed:      number
  byTenant:    Array<{ tenantId: string; sent: number; skipped: number; failed: number }>
}

const TYPE = 'installment_reminder'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(iso + 'T12:00:00'))
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysFromIso(iso: string): number {
  const due = new Date(iso + 'T00:00:00').getTime()
  const today = new Date().setHours(0, 0, 0, 0)
  return Math.floor((due - today) / 86400000)
}

function buildEmailHtml(args: {
  customerName: string
  storeName:    string
  installmentNumber: number
  totalInstallments: number
  amountCents:  number
  dueDate:      string
  days:         number     // negative = atrasado, 0 = hoje, positivo = futuro
}): { subject: string; html: string } {
  const greeting = `Olá, ${args.customerName.split(' ')[0]}!`
  const isLate = args.days < 0
  const dueLabel =
    isLate            ? `<strong style="color:#e11d48">venceu há ${Math.abs(args.days)} dia${Math.abs(args.days) !== 1 ? 's' : ''}</strong>`
  : args.days === 0   ? `<strong style="color:#d97706">vence hoje</strong>`
  : args.days === 1   ? `<strong style="color:#2563eb">vence amanhã</strong>`
  :                     `vence em ${args.days} dias`

  const subject = isLate
    ? `[${args.storeName}] Parcela ${args.installmentNumber}/${args.totalInstallments} em atraso`
    : args.days === 0
      ? `[${args.storeName}] Parcela ${args.installmentNumber}/${args.totalInstallments} vence hoje`
      : `[${args.storeName}] Parcela ${args.installmentNumber}/${args.totalInstallments} se aproxima`

  const html = `
    <div style="font-family:-apple-system,Helvetica Neue,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
      <h2 style="color:#1e3a8a;margin:0 0 12px">${greeting}</h2>
      <p>Estamos passando pra avisar que sua parcela <strong>${args.installmentNumber}/${args.totalInstallments}</strong> de <strong>${BRL(args.amountCents)}</strong> ${dueLabel} (${fmtDate(args.dueDate)}).</p>
      ${isLate
        ? `<p style="background:#fef2f2;border-left:4px solid #e11d48;padding:12px 14px;border-radius:6px">⚠️ Por favor entre em contato pra regularizar.</p>`
        : `<p style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 14px;border-radius:6px">💡 Pode pagar via PIX antecipado se quiser. Resposta com a chave!</p>`}
      <p style="font-size:13px;color:#6b7280;margin-top:24px">— Equipe ${args.storeName}</p>
    </div>
  `
  return { subject, html }
}

// ──────────────────────────────────────────────────────────────────────────
// Run pra um tenant (chamável manualmente também)
// ──────────────────────────────────────────────────────────────────────────

async function runForTenant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  tenantId: string,
  tenantName: string,
): Promise<{ sent: number; skipped: number; failed: number; scanned: number }> {
  let sent = 0, skipped = 0, failed = 0

  const today = todayIso()
  const minDate = new Date(); minDate.setDate(minDate.getDate() - 7)
  const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 3)

  // Parcelas em janela [-7, +3] dias do vencimento, ainda não pagas
  const { data: installments, error } = await sb
    .from('installments')
    .select(`
      id, installment_number, amount_cents, due_date, status,
      installment_plans!inner(
        installments_count,
        customers(id, full_name, whatsapp, email)
      )
    `)
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'late'])
    .gte('due_date', minDate.toISOString().slice(0, 10))
    .lte('due_date', maxDate.toISOString().slice(0, 10))
    .limit(500)

  if (error) throw new Error(error.message)

  type Inst = {
    id: string; installment_number: number; amount_cents: number; due_date: string
    status: string
    installment_plans: {
      installments_count: number
      customers: { id: string; full_name: string; whatsapp: string | null; email: string | null } | null
    }
  }
  const list = (installments ?? []) as Inst[]
  const scanned = list.length

  // Pega notificações já enviadas nas últimas 20h pras parcelas dessa lista
  const ids = list.map(i => i.id)
  const sinceCutoff = new Date(Date.now() - 20 * 3600 * 1000).toISOString()
  let recentlyNotified = new Set<string>()
  if (ids.length > 0) {
    const { data: logs } = await sb
      .from('notification_log')
      .select('reference_id')
      .eq('tenant_id', tenantId)
      .eq('type', TYPE)
      .in('reference_id', ids)
      .gte('sent_at', sinceCutoff)
    type Log = { reference_id: string }
    recentlyNotified = new Set(((logs ?? []) as Log[]).map(l => l.reference_id))
  }

  for (const inst of list) {
    if (recentlyNotified.has(inst.id)) {
      skipped++
      continue
    }
    const cust = inst.installment_plans?.customers
    if (!cust) {
      skipped++
      continue
    }

    const days = daysFromIso(inst.due_date)
    // Só notifica em pontos relevantes: D-3, D-1, D, D+1, D+3, D+7
    const relevantDays = [-7, -3, -1, 0, 1, 3]
    if (!relevantDays.includes(days)) {
      skipped++
      continue
    }

    if (cust.email) {
      const { subject, html } = buildEmailHtml({
        customerName:      cust.full_name,
        storeName:         tenantName,
        installmentNumber: inst.installment_number,
        totalInstallments: inst.installment_plans.installments_count,
        amountCents:       inst.amount_cents,
        dueDate:           inst.due_date,
        days,
      })
      const res = await sendEmail({ to: cust.email, subject, html })
      if (res.ok) {
        sent++
        await sb.from('notification_log').insert({
          tenant_id:    tenantId,
          type:         TYPE,
          reference_id: inst.id,
          channel:      'email',
          customer_id:  cust.id,
          recipient:    cust.email,
          status:       'sent',
          metadata:     { days, amount_cents: inst.amount_cents, due_date: inst.due_date },
        })
      } else {
        failed++
        await sb.from('notification_log').insert({
          tenant_id:    tenantId,
          type:         TYPE,
          reference_id: inst.id,
          channel:      'email',
          customer_id:  cust.id,
          recipient:    cust.email,
          status:       'failed',
          error:        res.error ?? 'unknown',
        })
      }
    } else if (cust.whatsapp) {
      // Sem email — só registra no log (cobrança via WhatsApp é manual no /parcelas)
      await sb.from('notification_log').insert({
        tenant_id:    tenantId,
        type:         TYPE,
        reference_id: inst.id,
        channel:      'whatsapp_link',
        customer_id:  cust.id,
        recipient:    cust.whatsapp,
        status:       'skipped',
        metadata:     { reason: 'no_email_only_whatsapp', days, amount_cents: inst.amount_cents },
      })
      skipped++
    } else {
      skipped++
    }
  }

  // Marca como 'late' parcelas vencidas (status update fora do envio de email)
  await sb
    .from('installments')
    .update({ status: 'late' })
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .lt('due_date', today)

  return { sent, skipped, failed, scanned }
}

// ──────────────────────────────────────────────────────────────────────────
// Public — chamado pelo cron handler
// ──────────────────────────────────────────────────────────────────────────

export async function runDailyInstallmentReminders(): Promise<ReminderResult> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: tenants } = await sb
    .from('tenants')
    .select('id, name, installment_reminders_enabled')
    .eq('installment_reminders_enabled', true)

  type Tenant = { id: string; name: string; installment_reminders_enabled: boolean }
  const list = (tenants ?? []) as Tenant[]

  const result: ReminderResult = {
    scanned: 0, sent: 0, skipped: 0, failed: 0, byTenant: [],
  }

  for (const t of list) {
    try {
      const r = await runForTenant(sb, t.id, t.name)
      result.scanned += r.scanned
      result.sent    += r.sent
      result.skipped += r.skipped
      result.failed  += r.failed
      result.byTenant.push({ tenantId: t.id, sent: r.sent, skipped: r.skipped, failed: r.failed })
    } catch (err) {
      console.error(`[reminders] tenant ${t.id} falhou:`, err)
      result.failed++
    }
  }

  return result
}
