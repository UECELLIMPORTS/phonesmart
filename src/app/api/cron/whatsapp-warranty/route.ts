/**
 * Cron — Lembrete WhatsApp de garantia expirando (7 dias antes).
 *
 * Roda 1x/dia 12h UTC. Pra cada IMEI vendido cuja garantia vence em 7 dias,
 * agenda mensagem 'warranty_expiring'.
 *
 * Garantia = sale.created_at + (product.warranty_days OR tenant.warranty_days).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleWhatsAppMessage } from '@/lib/whatsapp-scheduler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REMINDER_DAYS = 7

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

  // Tenants conectados (pra otimizar — só puxa serials de quem tem WhatsApp)
  const { data: tenants } = await sb
    .from('tenants')
    .select('id, warranty_days')
    .eq('whatsapp_status', 'connected')
  type TenantRow = { id: string; warranty_days: number | null }
  const tenantList = (tenants ?? []) as TenantRow[]

  let scheduled = 0, skipped = 0

  for (const t of tenantList) {
    const tenantWarranty = t.warranty_days ?? 90

    // Pega IMEIs vendidos com cliente (sale_item_id setado)
    const { data: serials } = await sb
      .from('product_serials')
      .select(`
        id, serial, sold_at,
        sale_item_id,
        products!inner(name, warranty_days),
        sale_items:sale_item_id (
          sale_id,
          sales(customer_id, created_at)
        )
      `)
      .eq('tenant_id', t.id)
      .eq('status', 'sold')
      .not('sold_at', 'is', null)
      .limit(2000)

    type SerialRow = {
      id: string; serial: string; sold_at: string | null
      sale_item_id: string | null
      products: { name: string; warranty_days: number | null } | null
      sale_items: { sale_id: string; sales: { customer_id: string | null; created_at: string } | null } | null
    }
    const list = (serials ?? []) as SerialRow[]
    const today = Date.now()

    for (const s of list) {
      const sale = s.sale_items?.sales
      if (!sale?.customer_id) { skipped++; continue }

      const warrantyDays = s.products?.warranty_days ?? tenantWarranty
      const saleDate = new Date(sale.created_at).getTime()
      const expiresAt = saleDate + warrantyDays * 86400000
      const daysLeft = Math.floor((expiresAt - today) / 86400000)

      // Janela: hoje a garantia vence em REMINDER_DAYS dias
      if (daysLeft !== REMINDER_DAYS) { skipped++; continue }

      const res = await scheduleWhatsAppMessage({
        tenantId:    t.id,
        type:        'warranty_expiring',
        customerId:  sale.customer_id,
        referenceId: s.id,
        vars: {
          aparelho: s.products?.name ?? 'aparelho',
          imei:     s.serial,
        },
      })
      if (res.ok && !res.skipped) scheduled++
      else skipped++
    }
  }

  return NextResponse.json({ ok: true, scheduled, skipped })
}
