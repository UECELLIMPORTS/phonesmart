'use server'

/**
 * Sprint 11 — KPIs específicos pra loja de celular.
 *
 * Agrega métricas em uma única chamada. Período em dias (7, 30, 90).
 */

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

export type CelularKpis = {
  period:   '7d' | '30d' | '90d'
  // Lucro
  imeisSoldCount:    number
  grossRevenueCents: number
  totalCostCents:    number
  totalProfitCents:  number
  averageProfitCents: number
  averageMarginPct:  number
  // Ticket
  totalSalesCount:   number
  averageTicketCents: number
  // Aging — IMEIs disponíveis há quanto tempo
  aging: {
    bucket0_30:   { count: number; valueCents: number }
    bucket31_60:  { count: number; valueCents: number }
    bucket61_90:  { count: number; valueCents: number }
    bucket90Plus: { count: number; valueCents: number }
  }
  // Devoluções
  cancelledCount:    number
  cancellationRate:  number  // 0-100
  // Operacional
  serviceOrdersOpen: number
  installmentsLate:   { count: number; totalCents: number }
  installmentsPending: { count: number; totalCents: number }
  // Compras vs vendas do período
  acquisitionsCount: number
  acquisitionsTotalCents: number
  // Top
  topSuppliers: Array<{ name: string; count: number; totalCents: number }>
  topModels:    Array<{ name: string; count: number; profitCents: number }>
}

function periodToDays(p: '7d' | '30d' | '90d'): number {
  return p === '7d' ? 7 : p === '90d' ? 90 : 30
}

export async function getCelularKpis(period: '7d' | '30d' | '90d' = '30d'): Promise<CelularKpis> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const days = periodToDays(period)

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceIso = since.toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // ── Lucro por IMEI vendido (sale_items com product_serial_id no período) ──
  const { data: imeiSales } = await sb
    .from('sale_items')
    .select(`
      unit_price_cents, cost_snapshot_cents,
      sales!inner(id, created_at, status, total_cents),
      product_serials:product_serial_id (id, products(name))
    `)
    .eq('tenant_id', tenantId)
    .not('product_serial_id', 'is', null)
    .gte('sales.created_at', sinceIso)

  type ImeiSale = {
    unit_price_cents: number
    cost_snapshot_cents: number | null
    sales: { id: string; created_at: string; status: string; total_cents: number }
    product_serials: { id: string; products: { name: string } | null } | null
  }
  const imeiSalesList = ((imeiSales ?? []) as ImeiSale[])
    .filter(i => i.sales?.status !== 'cancelled')

  const imeisSoldCount    = imeiSalesList.length
  const grossRevenueCents = imeiSalesList.reduce((s, i) => s + i.unit_price_cents, 0)
  const totalCostCents    = imeiSalesList.reduce((s, i) => s + (i.cost_snapshot_cents ?? 0), 0)
  const totalProfitCents  = grossRevenueCents - totalCostCents
  const averageProfitCents = imeisSoldCount > 0 ? Math.round(totalProfitCents / imeisSoldCount) : 0
  const averageMarginPct   = grossRevenueCents > 0 ? (totalProfitCents / grossRevenueCents) * 100 : 0

  // ── Ticket médio (todas as sales no período, não só IMEI) ──
  const { data: sales } = await sb
    .from('sales')
    .select('id, total_cents, status, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', sinceIso)

  type Sale = { id: string; total_cents: number; status: string; created_at: string }
  const salesList = (sales ?? []) as Sale[]
  const completedSales = salesList.filter(s => s.status !== 'cancelled')
  const totalSalesCount = completedSales.length
  const totalRevenue = completedSales.reduce((s, x) => s + x.total_cents, 0)
  const averageTicketCents = totalSalesCount > 0 ? Math.round(totalRevenue / totalSalesCount) : 0

  // ── Devoluções ──
  const cancelledCount = salesList.filter(s => s.status === 'cancelled').length
  const cancellationRate = salesList.length > 0
    ? (cancelledCount / salesList.length) * 100
    : 0

  // ── Aging de estoque (IMEIs available, agrupados por dias parados) ──
  const { data: availableSerials } = await sb
    .from('product_serials')
    .select('id, cost_cents, acquired_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'available')
    .limit(2000)

  type AvailSerial = { id: string; cost_cents: number | null; acquired_at: string | null; created_at: string }
  const aging = {
    bucket0_30:   { count: 0, valueCents: 0 },
    bucket31_60:  { count: 0, valueCents: 0 },
    bucket61_90:  { count: 0, valueCents: 0 },
    bucket90Plus: { count: 0, valueCents: 0 },
  }
  const now = Date.now()
  for (const s of (availableSerials ?? []) as AvailSerial[]) {
    const ref = s.acquired_at || s.created_at
    const daysOld = Math.floor((now - new Date(ref).getTime()) / 86400000)
    const cost = s.cost_cents ?? 0
    const bucket =
      daysOld <= 30 ? aging.bucket0_30
    : daysOld <= 60 ? aging.bucket31_60
    : daysOld <= 90 ? aging.bucket61_90
    :                 aging.bucket90Plus
    bucket.count += 1
    bucket.valueCents += cost
  }

  // ── OS abertas (open + in_progress + ready) ──
  const { count: serviceOrdersOpen } = await sb
    .from('service_orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('status', ['open', 'in_progress', 'ready'])

  // ── Parcelas atrasadas / pendentes ──
  const today = new Date().toISOString().slice(0, 10)
  const { data: installments } = await sb
    .from('installments')
    .select('amount_cents, status, due_date')
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'late'])
    .limit(2000)

  type Inst = { amount_cents: number; status: string; due_date: string }
  let lateCount = 0, lateTotal = 0, pendingCount = 0, pendingTotal = 0
  for (const i of (installments ?? []) as Inst[]) {
    const isLate = i.status === 'late' || i.due_date < today
    if (isLate) { lateCount++; lateTotal += i.amount_cents }
    else        { pendingCount++; pendingTotal += i.amount_cents }
  }

  // ── Compras (aquisições) no período ──
  const { data: acquisitions } = await sb
    .from('product_serials')
    .select('cost_cents, acquired_at, supplier_id, suppliers:supplier_id(name)')
    .eq('tenant_id', tenantId)
    .gte('acquired_at', sinceIso)
    .not('acquired_at', 'is', null)
    .limit(2000)

  type Acq = { cost_cents: number | null; acquired_at: string; supplier_id: string | null; suppliers: { name: string } | null }
  const acqList = (acquisitions ?? []) as Acq[]
  const acquisitionsCount = acqList.length
  const acquisitionsTotalCents = acqList.reduce((s, a) => s + (a.cost_cents ?? 0), 0)

  // ── Top fornecedores ──
  const supplierMap = new Map<string, { name: string; count: number; totalCents: number }>()
  for (const a of acqList) {
    if (!a.supplier_id || !a.suppliers) continue
    const cur = supplierMap.get(a.supplier_id) ?? { name: a.suppliers.name, count: 0, totalCents: 0 }
    cur.count += 1
    cur.totalCents += a.cost_cents ?? 0
    supplierMap.set(a.supplier_id, cur)
  }
  const topSuppliers = Array.from(supplierMap.values())
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 5)

  // ── Top modelos vendidos (com lucro) ──
  const modelMap = new Map<string, { name: string; count: number; profitCents: number }>()
  for (const i of imeiSalesList) {
    const name = i.product_serials?.products?.name
    if (!name) continue
    const cur = modelMap.get(name) ?? { name, count: 0, profitCents: 0 }
    cur.count += 1
    cur.profitCents += i.unit_price_cents - (i.cost_snapshot_cents ?? 0)
    modelMap.set(name, cur)
  }
  const topModels = Array.from(modelMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    period,
    imeisSoldCount,
    grossRevenueCents,
    totalCostCents,
    totalProfitCents,
    averageProfitCents,
    averageMarginPct,
    totalSalesCount,
    averageTicketCents,
    aging,
    cancelledCount,
    cancellationRate,
    serviceOrdersOpen: serviceOrdersOpen ?? 0,
    installmentsLate:   { count: lateCount, totalCents: lateTotal },
    installmentsPending: { count: pendingCount, totalCents: pendingTotal },
    acquisitionsCount,
    acquisitionsTotalCents,
    topSuppliers,
    topModels,
  }
}
