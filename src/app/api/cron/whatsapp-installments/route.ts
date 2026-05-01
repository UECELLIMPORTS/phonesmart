/**
 * Cron — Lembrete WhatsApp de parcela vencendo (1 dia antes).
 *
 * Roda 1x/dia 12h UTC (= 09h BRT). Pra cada parcela com due_date=amanhã
 * e status pending/late, agenda mensagem 'installment_due'.
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

  // Amanhã em BRT
  const brt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  brt.setDate(brt.getDate() + 1)
  const tomorrowIso = brt.toISOString().slice(0, 10)

  const { data: installments } = await sb
    .from('installments')
    .select(`
      id, tenant_id, installment_number, amount_cents, due_date,
      installment_plans!inner(
        installments_count, customer_id,
        sales(id)
      )
    `)
    .in('status', ['pending', 'late'])
    .eq('due_date', tomorrowIso)
    .limit(500)

  type Inst = {
    id: string; tenant_id: string; installment_number: number; amount_cents: number; due_date: string
    installment_plans: {
      installments_count: number
      customer_id: string
      sales: { id: string } | null
    }
  }
  const list = (installments ?? []) as Inst[]

  let scheduled = 0, skipped = 0

  for (const i of list) {
    const valorBRL = (i.amount_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    const [y, m, d] = i.due_date.split('-')
    const dataFmt = `${d}/${m}/${y}`

    const res = await scheduleWhatsAppMessage({
      tenantId:    i.tenant_id,
      type:        'installment_due',
      customerId:  i.installment_plans.customer_id,
      referenceId: i.id,
      vars: {
        parcela_n:        i.installment_number,
        parcela_total:    i.installment_plans.installments_count,
        valor:            `R$ ${valorBRL}`,
        data_vencimento:  dataFmt,
      },
    })

    if (res.ok && !res.skipped) scheduled++
    else skipped++
  }

  return NextResponse.json({ ok: true, processed: list.length, scheduled, skipped })
}
