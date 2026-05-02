/**
 * Cron — Win-back de clientes inativos.
 *
 * Roda 1x/dia 9h BRT. Pra cada tenant com template inactive_customer ativo:
 *   1. Busca clientes cuja última venda foi há >= inactivity_days dias
 *      (ou nunca compraram mas existem há >= inactivity_days dias)
 *   2. Filtra os que não receberam reativação nos últimos 90 dias (anti-spam)
 *   3. Cria customer_coupons e agenda mensagem na fila
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleWhatsAppMessage } from '@/lib/whatsapp-scheduler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ANTISPAM_DAYS = 90
const MAX_PER_RUN_PER_TENANT = 30   // limite anti-burst (Resend free = 100/dia)

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

  const { data: tenants } = await sb
    .from('tenants')
    .select('id, name')
  type Tenant = { id: string; name: string }
  const tenantList = (tenants ?? []) as Tenant[]

  let totalScheduled = 0, totalSkipped = 0, totalErrors = 0

  for (const t of tenantList) {
    try {
      // Template inactive_customer
      const { data: tpl } = await sb
        .from('whatsapp_templates')
        .select('enabled, inactivity_days, coupon_code, coupon_discount_pct, coupon_valid_days')
        .eq('tenant_id', t.id)
        .eq('type', 'inactive_customer')
        .maybeSingle()

      if (!tpl || !tpl.enabled) { totalSkipped++; continue }

      const inactivityDays = (tpl.inactivity_days as number) ?? 90
      const couponCode     = (tpl.coupon_code as string) ?? 'VOLTA15'
      const discountPct    = (tpl.coupon_discount_pct as number) ?? 15
      const validDays      = (tpl.coupon_valid_days as number) ?? 15

      // Cutoff: clientes cuja última venda foi antes desta data são inativos
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - inactivityDays)
      const cutoffIso = cutoffDate.toISOString()

      // Anti-spam: cutoff de mensagens de reativação anteriores
      const antispamDate = new Date()
      antispamDate.setDate(antispamDate.getDate() - ANTISPAM_DAYS)
      const antispamIso = antispamDate.toISOString()

      // Pega TODOS os clientes do tenant com email/whatsapp
      const { data: customers } = await sb
        .from('customers')
        .select('id, full_name, email, whatsapp, created_at')
        .eq('tenant_id', t.id)
        .or('email.not.is.null,whatsapp.not.is.null')
        .limit(5000)

      type Customer = { id: string; full_name: string; email: string | null; whatsapp: string | null; created_at: string }
      const allCustomers = (customers ?? []) as Customer[]

      if (allCustomers.length === 0) { totalSkipped++; continue }

      // Pra cada customer, descobre última venda e última msg de reativação
      const customerIds = allCustomers.map(c => c.id)

      // Última venda por customer
      const { data: lastSales } = await sb
        .from('sales')
        .select('customer_id, created_at')
        .eq('tenant_id', t.id)
        .neq('status', 'cancelled')
        .in('customer_id', customerIds)
        .order('created_at', { ascending: false })
      const lastSaleMap = new Map<string, string>()
      type SaleRow = { customer_id: string; created_at: string }
      for (const s of (lastSales ?? []) as SaleRow[]) {
        if (!lastSaleMap.has(s.customer_id)) lastSaleMap.set(s.customer_id, s.created_at)
      }

      // Mensagens de reativação enviadas recentemente (anti-spam)
      const { data: recentMsgs } = await sb
        .from('scheduled_whatsapp_messages')
        .select('customer_id')
        .eq('tenant_id', t.id)
        .eq('type', 'inactive_customer')
        .in('customer_id', customerIds)
        .gte('created_at', antispamIso)
      const recentlyContacted = new Set(((recentMsgs ?? []) as { customer_id: string }[]).map(r => r.customer_id))

      // Filtra inativos: SOMENTE clientes que JÁ compraram pelo menos 1x e
      // pararam. Cliente sem venda registrada (importação, lead, cadastro de
      // teste) NÃO entra — caso contrário a primeira execução do cron dispara
      // win-back pra base inteira importada de outro sistema.
      const inactiveCustomers = allCustomers
        .filter(c => {
          if (recentlyContacted.has(c.id)) return false
          const lastSaleDate = lastSaleMap.get(c.id)
          if (!lastSaleDate) return false
          return lastSaleDate < cutoffIso
        })
        .slice(0, MAX_PER_RUN_PER_TENANT)   // anti-burst

      if (inactiveCustomers.length === 0) { totalSkipped++; continue }

      // Pra cada inativo: cria cupom + agenda msg
      const validUntil = new Date()
      validUntil.setDate(validUntil.getDate() + validDays)
      const validUntilStr = validUntil.toISOString().slice(0, 10)
      const validUntilFmt = validUntil.toLocaleDateString('pt-BR')

      for (const c of inactiveCustomers) {
        const lastSaleDate = lastSaleMap.get(c.id)!   // garantido pelo filter
        const daysSince = Math.floor((Date.now() - new Date(lastSaleDate).getTime()) / 86400000)

        // Cria cupom (idempotente — UNIQUE INDEX evita duplicar)
        const { error: couponErr } = await sb
          .from('customer_coupons')
          .insert({
            tenant_id:    t.id,
            customer_id:  c.id,
            code:         couponCode.toUpperCase(),
            type:         'reactivation',
            discount_pct: discountPct,
            valid_until:  validUntilStr,
            notes:        `Cron win-back ${new Date().toISOString().slice(0, 10)} — ${daysSince}d sem comprar`,
          })

        // Se já tinha cupom ativo (constraint), não bloqueia o agendamento — só pula
        if (couponErr && couponErr.code !== '23505') {
          totalErrors++
          continue
        }

        const r = await scheduleWhatsAppMessage({
          tenantId:    t.id,
          type:        'inactive_customer',
          customerId:  c.id,
          referenceId: c.id,
          vars: {
            cupom:              couponCode.toUpperCase(),
            desconto:           String(discountPct),
            valido_ate:         validUntilFmt,
            dias_sem_comprar:   String(daysSince),
            beneficio:          `${discountPct}% de desconto em qualquer item`,
          },
        })

        if (r.ok && !r.skipped) totalScheduled++
        else totalSkipped++
      }
    } catch (err) {
      console.error(`[whatsapp-inactive] tenant ${t.id}:`, err)
      totalErrors++
    }
  }

  return NextResponse.json({
    ok: true,
    tenants:   tenantList.length,
    scheduled: totalScheduled,
    skipped:   totalSkipped,
    errors:    totalErrors,
  })
}
