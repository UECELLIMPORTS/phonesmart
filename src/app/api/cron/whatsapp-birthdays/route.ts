/**
 * Cron — Lembrete de aniversário no WhatsApp.
 *
 * Roda 1x/dia às 12:00 UTC (= 09:00 BRT). Pra cada tenant com WhatsApp
 * conectado:
 *   1. birthday_month — entre dia 1-5 do mês, manda pra todos que fazem
 *      aniv no mês corrente (1x por ano por cliente)
 *   2. birthday_day — pra quem faz aniv HOJE (1x por ano por cliente)
 *
 * Edge case: aniversariante dia 1-3 — envia só birthday_day (que já cita
 * o cupom do mês). Evita o cliente receber 2 msgs no mesmo dia.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleWhatsAppMessage } from '@/lib/whatsapp-scheduler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

  // Pra usar fuso BR no calendário (não UTC do servidor)
  const now = new Date()
  const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const todayMonth = brt.getMonth() + 1   // 1-12
  const todayDay   = brt.getDate()
  const year       = brt.getFullYear()

  // Tenants com WhatsApp conectado
  const { data: tenants } = await sb
    .from('tenants')
    .select('id, name')
    .eq('whatsapp_status', 'connected')

  type Tenant = { id: string; name: string }
  const tenantList = (tenants ?? []) as Tenant[]

  const result = {
    tenants: 0,
    monthScheduled: 0,
    dayScheduled:   0,
    skipped:        0,
    errors:         0,
  }

  for (const t of tenantList) {
    result.tenants++

    try {
      // Templates
      const { data: tpls } = await sb
        .from('whatsapp_templates')
        .select('type, enabled')
        .eq('tenant_id', t.id)
        .in('type', ['birthday_month', 'birthday_day'])
      type Tpl = { type: string; enabled: boolean }
      const tplMap = new Map<string, boolean>()
      for (const tpl of (tpls ?? []) as Tpl[]) tplMap.set(tpl.type, tpl.enabled)

      const monthEnabled = tplMap.get('birthday_month') ?? false
      const dayEnabled   = tplMap.get('birthday_day') ?? false
      if (!monthEnabled && !dayEnabled) { result.skipped++; continue }

      // Janela do birthday_month: dia 1-5 do mês
      const inMonthWindow = todayDay >= 1 && todayDay <= 5

      // Pega aniversariantes do MÊS (com birth_date setado e whatsapp)
      const { data: birthdayCustomers } = await sb
        .from('customers')
        .select('id, full_name, whatsapp, birth_date')
        .eq('tenant_id', t.id)
        .not('birth_date', 'is', null)
        .not('whatsapp', 'is', null)
        .limit(2000)

      type Customer = { id: string; full_name: string; whatsapp: string | null; birth_date: string }
      const allCustomers = (birthdayCustomers ?? []) as Customer[]

      const monthCustomers: Customer[] = []
      const dayCustomers: Customer[]   = []

      for (const c of allCustomers) {
        // birth_date vem como YYYY-MM-DD
        const [, mStr, dStr] = c.birth_date.split('-')
        const m = parseInt(mStr, 10)
        const d = parseInt(dStr, 10)
        if (m === todayMonth) {
          monthCustomers.push(c)
          if (d === todayDay) dayCustomers.push(c)
        }
      }

      // ── Birthday DAY (prioridade — quem faz hoje) ─────────────────────
      if (dayEnabled) {
        for (const c of dayCustomers) {
          // Já enviou esse ano?
          const yearStart = `${year}-01-01T00:00:00Z`
          const { data: prev } = await sb
            .from('scheduled_whatsapp_messages')
            .select('id')
            .eq('tenant_id', t.id)
            .eq('customer_id', c.id)
            .eq('type', 'birthday_day')
            .gte('created_at', yearStart)
            .limit(1)
            .maybeSingle()

          if (prev) { result.skipped++; continue }

          const res = await scheduleWhatsAppMessage({
            tenantId:    t.id,
            type:        'birthday_day',
            customerId:  c.id,
            referenceId: c.id,
            scheduledFor: new Date().toISOString(),
          })
          if (res.ok && !res.skipped) result.dayScheduled++
          else result.skipped++
        }
      }

      // ── Birthday MONTH (1-5 do mês, pula aniversariantes do dia se já enviou day) ──
      if (monthEnabled && inMonthWindow) {
        const dayCustomerIds = new Set(dayCustomers.map(c => c.id))

        for (const c of monthCustomers) {
          // Edge case: aniv dia 1-3 — pula birthday_month, evita receber 2 msgs hoje
          const [, , dStr] = c.birth_date.split('-')
          const birthDay = parseInt(dStr, 10)
          if (birthDay >= 1 && birthDay <= 3 && dayCustomerIds.has(c.id)) {
            result.skipped++
            continue
          }

          // Já enviou birthday_month esse ano?
          const yearStart = `${year}-01-01T00:00:00Z`
          const { data: prev } = await sb
            .from('scheduled_whatsapp_messages')
            .select('id')
            .eq('tenant_id', t.id)
            .eq('customer_id', c.id)
            .eq('type', 'birthday_month')
            .gte('created_at', yearStart)
            .limit(1)
            .maybeSingle()

          if (prev) { result.skipped++; continue }

          const res = await scheduleWhatsAppMessage({
            tenantId:    t.id,
            type:        'birthday_month',
            customerId:  c.id,
            referenceId: c.id,
            scheduledFor: new Date().toISOString(),
          })
          if (res.ok && !res.skipped) result.monthScheduled++
          else result.skipped++
        }
      }
    } catch (err) {
      console.error(`[whatsapp-birthdays] tenant ${t.id}:`, err)
      result.errors++
    }
  }

  return NextResponse.json({ ok: true, ...result })
}
