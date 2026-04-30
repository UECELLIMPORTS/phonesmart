import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { redirect } from 'next/navigation'
import { originLabel } from '@/lib/customer-origin'
import { ErpClientesClient } from './erp-clientes-client'
import { getTenantSubscriptions, canAccess } from '@/lib/subscription'
import { UpgradeBlock } from '@/components/upgrade-block'

export const metadata = { title: 'ERP Clientes — Phone Smart' }

type Period = '7d' | '30d' | '90d' | 'custom'

function getPeriodRange(period: Period, from?: string, to?: string): { start: Date; end: Date } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  if (period === 'custom' && from && to) {
    const f = new Date(from + 'T00:00:00')
    const t = new Date(to + 'T23:59:59.999')
    if (!isNaN(f.getTime()) && !isNaN(t.getTime())) return { start: f, end: t }
  }
  if (period === '7d')       start.setDate(start.getDate() - 6)
  else if (period === '30d') start.setDate(start.getDate() - 29)
  else if (period === '90d') start.setDate(start.getDate() - 89)
  else                       start.setDate(start.getDate() - 29) // default 30d
  return { start, end }
}

function classify(customerCreatedAt: string | null | undefined, periodStart: Date): 'novo' | 'recorrente' {
  if (!customerCreatedAt) return 'recorrente'
  return new Date(customerCreatedAt) >= periodStart ? 'novo' : 'recorrente'
}

function osTotal(o: { total_price_cents: number | null; service_price_cents: number | null; parts_sale_cents: number | null; discount_cents: number | null }): number {
  if (o.total_price_cents) return o.total_price_cents
  return Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
}

export type TopClientBreakdown = {
  totalCents:   number
  profitCents:  number
  transactions: number
}

export type TopClient = {
  name: string
  whatsapp: string | null
  phone: string | null
  type: 'novo' | 'recorrente'
  totalCents: number
  profitCents: number
  transactions: number
  ticketMedioCents: number
  lastDate: string
  sources: {
    phonesmart:   TopClientBreakdown
    checksmart: TopClientBreakdown
  }
}

export type MonthPoint = {
  label: string
  recorrentes: number
  novos: number
  recorrentesProfit: number
  novosProfit: number
}

export type ChurnClient = {
  name: string
  whatsapp: string | null
  phone: string | null
  origin: string | null
  daysSince: number
  totalCents: number
  transactions: number
  sources: {
    phonesmart:   { daysSince: number | null; totalCents: number; transactions: number }
    checksmart: { daysSince: number | null; totalCents: number; transactions: number }
  }
}

export type WeekdayMetrics = {
  totalCents:   number
  profitCents:  number
  transactions: number
}

export type WeekdayPoint = {
  label:      string
  total:      WeekdayMetrics
  phonesmart:   WeekdayMetrics
  checksmart: WeekdayMetrics
}

export type OriginMetrics = {
  totalCents:      number
  profitCents:     number
  transactions:    number
  uniqueCustomers: number
}

export type OriginBreakdown = {
  value:           string | null
  label:           string
  total:           OriginMetrics
  phonesmart:        OriginMetrics
  checksmart:      OriginMetrics
  ticketMedioCents: number
  sharePercent:    number
}

export type DashboardData = {
  period: Period
  recorrentes: { totalCents: number; profitCents: number; transactions: number; ticketMedioCents: number; avgProducts: string; sharePercent: number; marginPercent: number }
  novos:       { totalCents: number; profitCents: number; transactions: number; ticketMedioCents: number; avgProducts: string; sharePercent: number; marginPercent: number }
  monthlyData: MonthPoint[]
  topClients:  TopClient[]
  insightText: string
  sources: {
    phonesmart:   { totalCents: number; profitCents: number; transactions: number; uniqueCustomers: number }
    checksmart: { totalCents: number; profitCents: number; transactions: number; uniqueCustomers: number }
    overlap: number
  }
  churnRisk: ChurnClient[]
  rfmSegments: { campeoes: number; emRisco: number; novosPromissores: number; dormentes: number }
  weekdayHeatmap: WeekdayPoint[]
  originBreakdown: OriginBreakdown[]
}

export default async function ErpClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { supabase, user } = auth

  // Gate de feature: ERP Clientes é Pro+
  const subs = await getTenantSubscriptions(user)
  if (!canAccess(subs, 'erp_clientes')) {
    return <UpgradeBlock feature="erp_clientes" pageTitle="ERP Clientes" />
  }

  const tenantId = getTenantId(user)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { period: rawPeriod = '30d', from, to } = await searchParams
  const period = (['7d', '30d', '90d', 'custom'].includes(rawPeriod) ? rawPeriod : '30d') as Period
  const { start, end } = getPeriodRange(period, from, to)

  const sixAgo = new Date()
  sixAgo.setMonth(sixAgo.getMonth() - 5)
  sixAgo.setDate(1)
  sixAgo.setHours(0, 0, 0, 0)

  const [salesPeriodRes, osPeriodRes, salesMonthRes, osMonthRes] = await Promise.all([
    sb.from('sales')
      .select('customer_id, total_cents, created_at, customer_origin, sale_items(quantity, unit_price_cents, product_id, cost_snapshot_cents), customers(full_name, created_at, origin, whatsapp, phone)')
      .eq('tenant_id', tenantId)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .neq('status', 'cancelled')
      .limit(1000),

    // OS: só entra no ERP Clientes quando entregue ao cliente.
    // Usa in() pra cobrir o case EN ('delivered') e caso legado PT ('Entregue').
    sb.from('service_orders')
      .select('customer_id, total_price_cents, service_price_cents, parts_sale_cents, parts_cost_cents, discount_cents, received_at, customers(full_name, created_at, origin, whatsapp, phone)')
      .eq('tenant_id', tenantId)
      .gte('received_at', start.toISOString())
      .lte('received_at', end.toISOString())
      .in('status', ['delivered', 'Entregue'])
      .limit(1000),

    sb.from('sales')
      .select('customer_id, total_cents, created_at, customer_origin, sale_items(quantity, product_id, cost_snapshot_cents), customers(full_name, created_at, origin, whatsapp, phone)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sixAgo.toISOString())
      .neq('status', 'cancelled')
      .limit(2000),

    sb.from('service_orders')
      .select('customer_id, total_price_cents, service_price_cents, parts_sale_cents, parts_cost_cents, discount_cents, received_at, customers(full_name, created_at, origin, whatsapp, phone)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sixAgo.toISOString())
      .in('status', ['delivered', 'Entregue'])
      .limit(2000),
  ])

  // ── Process period data ─────────────────────────────────────────────────
  type SaleItemPeriod = { quantity: number; unit_price_cents: number; product_id: string | null; cost_snapshot_cents: number | null }
  type CustomerJoinPeriod = { full_name: string; created_at: string; origin: string|null; whatsapp: string|null; phone: string|null }
  type SalePeriod = { customer_id: string|null; total_cents: number; created_at: string; customer_origin: string|null; sale_items: SaleItemPeriod[]|null; customers: CustomerJoinPeriod|null }
  type OsPeriod   = { customer_id: string|null; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; parts_cost_cents: number|null; discount_cents: number|null; received_at: string; customers: CustomerJoinPeriod|null }

  const salesPeriodData = (salesPeriodRes.data ?? []) as SalePeriod[]
  const osPeriodData    = (osPeriodRes.data   ?? []) as OsPeriod[]

  // Query separada de custos — sale_items.product_id pode apontar pra
  // products OU parts_catalog, então busco nas duas tabelas em paralelo.
  type MonthSaleItem = { quantity: number; product_id: string | null; cost_snapshot_cents: number | null }
  type CustomerJoin = { full_name: string; created_at: string; origin: string|null; whatsapp: string|null; phone: string|null }
  type MonthSaleRow = { customer_id: string|null; total_cents: number; created_at: string; customer_origin: string|null; sale_items: MonthSaleItem[]|null; customers: CustomerJoin|null }
  type MonthOsRow   = { customer_id: string|null; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; parts_cost_cents: number|null; discount_cents: number|null; received_at: string; customers: CustomerJoin|null }

  const salesMonthData = (salesMonthRes.data ?? []) as MonthSaleRow[]
  const osMonthData    = (osMonthRes.data   ?? []) as MonthOsRow[]

  const productIds = new Set<string>()
  for (const s of salesPeriodData) {
    for (const i of s.sale_items ?? []) {
      if (i.product_id) productIds.add(i.product_id)
    }
  }
  for (const s of salesMonthData) {
    for (const i of s.sale_items ?? []) {
      if (i.product_id) productIds.add(i.product_id)
    }
  }
  const costMap = new Map<string, number>()
  if (productIds.size > 0) {
    const ids = [...productIds]
    const [prodRes, partRes] = await Promise.all([
      sb.from('products').select('id, cost_cents').eq('tenant_id', tenantId).in('id', ids),
      sb.from('parts_catalog').select('id, cost_cents').eq('tenant_id', tenantId).in('id', ids),
    ])
    for (const p of (prodRes.data ?? []) as { id: string; cost_cents: number }[]) {
      costMap.set(p.id, p.cost_cents ?? 0)
    }
    for (const p of (partRes.data ?? []) as { id: string; cost_cents: number }[]) {
      costMap.set(p.id, p.cost_cents ?? 0)
    }
  }

  type Tx = {
    customerId: string | null; name: string; createdAt: string | null; origin: string | null
    whatsapp: string | null; phone: string | null
    totalCents: number; profitCents: number
    products: number; date: Date
    source: 'erp' | 'checksmart'
  }

  const periodTxs: Tx[] = [
    ...salesPeriodData.map(s => {
      const items = s.sale_items ?? []
      const totalCents = s.total_cents ?? 0
      const costCents = items.reduce((sum, i) => {
        // Prioriza snapshot (custo no momento da venda); fallback pro atual
        const cost = i.cost_snapshot_cents ?? (i.product_id ? (costMap.get(i.product_id) ?? 0) : 0)
        return sum + (i.quantity ?? 0) * cost
      }, 0)
      return {
        customerId: s.customer_id,
        name: s.customers?.full_name ?? 'Sem cliente',
        createdAt: s.customers?.created_at ?? null,
        origin: s.customer_origin ?? s.customers?.origin ?? null,
        whatsapp: s.customers?.whatsapp ?? null,
        phone: s.customers?.phone ?? null,
        totalCents,
        profitCents: totalCents - costCents,
        products: items.reduce((sum, i) => sum + (i.quantity ?? 1), 0) || 1,
        date: new Date(s.created_at),
        source: 'erp' as const,
      }
    }),
    ...osPeriodData.map(o => {
      const total = osTotal(o)
      const partsCost = o.parts_cost_cents ?? 0
      return {
        customerId: o.customer_id,
        name: o.customers?.full_name ?? 'Sem cliente',
        createdAt: o.customers?.created_at ?? null,
        origin: o.customers?.origin ?? null,
        whatsapp: o.customers?.whatsapp ?? null,
        phone: o.customers?.phone ?? null,
        totalCents: total,
        profitCents: total - partsCost,
        products: 1,
        date: new Date(o.received_at),
        source: 'checksmart' as const,
      }
    }),
  ]

  let recTot = 0, recProf = 0, recTx = 0, recProd = 0
  let novTot = 0, novProf = 0, novTx = 0, novProd = 0

  type CustomerAgg = {
    name: string; whatsapp: string | null; phone: string | null; type: 'novo'|'recorrente'
    totalCents: number; profitCents: number; tx: number; lastDate: Date
    phonesmart:   { totalCents: number; profitCents: number; tx: number }
    checksmart: { totalCents: number; profitCents: number; tx: number }
  }
  const customerMap = new Map<string, CustomerAgg>()

  for (const t of periodTxs) {
    const type = classify(t.createdAt, start)
    if (type === 'recorrente') { recTot += t.totalCents; recProf += t.profitCents; recTx++; recProd += t.products }
    else                       { novTot += t.totalCents; novProf += t.profitCents; novTx++; novProd += t.products }

    if (t.customerId) {
      const ex = customerMap.get(t.customerId)
      if (ex) {
        ex.totalCents  += t.totalCents
        ex.profitCents += t.profitCents
        ex.tx++
        if (t.date > ex.lastDate) ex.lastDate = t.date
        if (!ex.whatsapp && t.whatsapp) ex.whatsapp = t.whatsapp
        if (!ex.phone    && t.phone)    ex.phone    = t.phone
        const b = t.source === 'erp' ? ex.phonesmart : ex.checksmart
        b.totalCents  += t.totalCents
        b.profitCents += t.profitCents
        b.tx++
      } else {
        const emptyB = { totalCents: 0, profitCents: 0, tx: 0 }
        const agg: CustomerAgg = {
          name: t.name, whatsapp: t.whatsapp, phone: t.phone, type,
          totalCents: t.totalCents, profitCents: t.profitCents, tx: 1, lastDate: t.date,
          phonesmart:   { ...emptyB },
          checksmart: { ...emptyB },
        }
        const b = t.source === 'erp' ? agg.phonesmart : agg.checksmart
        b.totalCents  = t.totalCents
        b.profitCents = t.profitCents
        b.tx          = 1
        customerMap.set(t.customerId, agg)
      }
    }
  }

  const totalCents = recTot + novTot
  const recShare = totalCents > 0 ? Math.round(recTot / totalCents * 100) : 0

  const fmtLastDate = (d: Date) => {
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'Hoje'
    if (diffDays === 1) return 'Ontem'
    return `${diffDays} dias`
  }

  const topClients: TopClient[] = [...customerMap.values()]
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 30)
    .map(c => ({
      name: c.name,
      whatsapp: c.whatsapp,
      phone: c.phone,
      type: c.type,
      totalCents: c.totalCents,
      profitCents: c.profitCents,
      transactions: c.tx,
      ticketMedioCents: Math.round(c.totalCents / c.tx),
      lastDate: fmtLastDate(c.lastDate),
      sources: {
        phonesmart:   { totalCents: c.phonesmart.totalCents,   profitCents: c.phonesmart.profitCents,   transactions: c.phonesmart.tx },
        checksmart: { totalCents: c.checksmart.totalCents, profitCents: c.checksmart.profitCents, transactions: c.checksmart.tx },
      },
    }))

  // ── Sources: PhoneSmart vs CheckSmart ─────────────────────────────────────
  const saleCustomerIds = new Set(salesPeriodData.filter(s => s.customer_id).map(s => s.customer_id as string))
  const osCustomerIds   = new Set(osPeriodData.filter(o => o.customer_id).map(o => o.customer_id as string))
  const overlap = [...saleCustomerIds].filter(id => osCustomerIds.has(id)).length

  const salesProfit = periodTxs
    .filter(t => t.source === 'erp')
    .reduce((sum, t) => sum + t.profitCents, 0)
  const osProfit = periodTxs
    .filter(t => t.source === 'checksmart')
    .reduce((sum, t) => sum + t.profitCents, 0)

  const sources = {
    phonesmart: {
      totalCents: salesPeriodData.reduce((sum, s) => sum + (s.total_cents ?? 0), 0),
      profitCents: salesProfit,
      transactions: salesPeriodData.length,
      uniqueCustomers: saleCustomerIds.size,
    },
    checksmart: {
      totalCents: osPeriodData.reduce((sum, o) => sum + osTotal(o), 0),
      profitCents: osProfit,
      transactions: osPeriodData.length,
      uniqueCustomers: osCustomerIds.size,
    },
    overlap,
  }

  // ── Weekday heatmap ──────────────────────────────────────────────────────
  const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const emptyMetrics = (): WeekdayMetrics => ({ totalCents: 0, profitCents: 0, transactions: 0 })
  const weekdayHeatmap: WeekdayPoint[] = DAYS.map(label => ({
    label,
    total:      emptyMetrics(),
    phonesmart:   emptyMetrics(),
    checksmart: emptyMetrics(),
  }))

  for (const t of periodTxs) {
    const day = weekdayHeatmap[t.date.getDay()]
    day.total.totalCents    += t.totalCents
    day.total.profitCents   += t.profitCents
    day.total.transactions  += 1

    const bucket = t.source === 'erp' ? day.phonesmart : day.checksmart
    bucket.totalCents    += t.totalCents
    bucket.profitCents   += t.profitCents
    bucket.transactions  += 1
  }

  // ── Origem dos clientes (período selecionado) ────────────────────────────
  type OriginAgg = {
    total:      { totalCents: number; profitCents: number; transactions: number; customerIds: Set<string> }
    phonesmart:   { totalCents: number; profitCents: number; transactions: number; customerIds: Set<string> }
    checksmart: { totalCents: number; profitCents: number; transactions: number; customerIds: Set<string> }
  }
  const emptyOriginBucket = () => ({ totalCents: 0, profitCents: 0, transactions: 0, customerIds: new Set<string>() })
  const originMap = new Map<string, OriginAgg>()
  const NO_ORIGIN = '__sem_origem__'

  for (const t of periodTxs) {
    const key = t.origin ?? NO_ORIGIN
    let agg = originMap.get(key)
    if (!agg) {
      agg = { total: emptyOriginBucket(), phonesmart: emptyOriginBucket(), checksmart: emptyOriginBucket() }
      originMap.set(key, agg)
    }
    agg.total.totalCents    += t.totalCents
    agg.total.profitCents   += t.profitCents
    agg.total.transactions  += 1
    if (t.customerId) agg.total.customerIds.add(t.customerId)

    const bucket = t.source === 'erp' ? agg.phonesmart : agg.checksmart
    bucket.totalCents    += t.totalCents
    bucket.profitCents   += t.profitCents
    bucket.transactions  += 1
    if (t.customerId) bucket.customerIds.add(t.customerId)
  }

  const periodTotalCents = [...originMap.values()].reduce((sum, o) => sum + o.total.totalCents, 0)

  const toMetrics = (b: OriginAgg['total']): OriginMetrics => ({
    totalCents:      b.totalCents,
    profitCents:     b.profitCents,
    transactions:    b.transactions,
    uniqueCustomers: b.customerIds.size,
  })

  const originBreakdown: OriginBreakdown[] = [...originMap.entries()]
    .map(([key, v]) => ({
      value:       key === NO_ORIGIN ? null : key,
      label:       key === NO_ORIGIN ? 'Não informado' : originLabel(key),
      total:       toMetrics(v.total),
      phonesmart:    toMetrics(v.phonesmart),
      checksmart:  toMetrics(v.checksmart),
      ticketMedioCents: v.total.transactions > 0 ? Math.round(v.total.totalCents / v.total.transactions) : 0,
      sharePercent: periodTotalCents > 0 ? Math.round((v.total.totalCents / periodTotalCents) * 100) : 0,
    }))
    .sort((a, b) => b.total.totalCents - a.total.totalCents)

  // ── Monthly evolution ────────────────────────────────────────────────────
  const months: { label: string; start: Date; end: Date }[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - (5 - i))
    const y = d.getFullYear(), m = d.getMonth()
    return {
      label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
      start: new Date(y, m, 1),
      end:   new Date(y, m + 1, 0, 23, 59, 59),
    }
  })

  type MonthTx = {
    customerId: string|null; name: string; createdAt: string|null
    whatsapp: string|null; phone: string|null; origin: string|null
    totalCents: number; profitCents: number; date: Date
    source: 'erp' | 'checksmart'
  }
  const monthTxs: MonthTx[] = [
    ...salesMonthData.map(s => {
      const items = s.sale_items ?? []
      const total = s.total_cents ?? 0
      const cost = items.reduce((sum, i) => {
        // Prioriza snapshot (custo no momento da venda); fallback pro atual
        const c = i.cost_snapshot_cents ?? (i.product_id ? (costMap.get(i.product_id) ?? 0) : 0)
        return sum + (i.quantity ?? 0) * c
      }, 0)
      return {
        customerId: s.customer_id,
        name: s.customers?.full_name ?? 'Sem cliente',
        createdAt: s.customers?.created_at ?? null,
        whatsapp: s.customers?.whatsapp ?? null,
        phone: s.customers?.phone ?? null,
        origin: s.customer_origin ?? s.customers?.origin ?? null,
        totalCents: total,
        profitCents: total - cost,
        date: new Date(s.created_at),
        source: 'erp' as const,
      }
    }),
    ...osMonthData.map(o => {
      const total = osTotal(o)
      const partsCost = o.parts_cost_cents ?? 0
      return {
        customerId: o.customer_id,
        name: o.customers?.full_name ?? 'Sem cliente',
        createdAt: o.customers?.created_at ?? null,
        whatsapp: o.customers?.whatsapp ?? null,
        phone: o.customers?.phone ?? null,
        origin: o.customers?.origin ?? null,
        totalCents: total,
        profitCents: total - partsCost,
        date: new Date(o.received_at),
        source: 'checksmart' as const,
      }
    }),
  ]

  const monthlyData: MonthPoint[] = months.map(m => {
    let rec = 0, nov = 0, recP = 0, novP = 0
    for (const t of monthTxs) {
      if (t.date < m.start || t.date > m.end) continue
      if (classify(t.createdAt, m.start) === 'recorrente') {
        rec  += t.totalCents
        recP += t.profitCents
      } else {
        nov  += t.totalCents
        novP += t.profitCents
      }
    }
    return { label: m.label, recorrentes: rec, novos: nov, recorrentesProfit: recP, novosProfit: novP }
  })

  // ── Activity map (6 months) → Churn + RFM ───────────────────────────────
  type ActivityEntry = {
    name: string
    whatsapp: string | null
    phone: string | null
    origin: string | null
    lastDate: Date
    totalCents: number; tx: number
    phonesmart:   { lastDate: Date | null; totalCents: number; tx: number }
    checksmart: { lastDate: Date | null; totalCents: number; tx: number }
  }
  const activityMap = new Map<string, ActivityEntry>()
  for (const t of monthTxs) {
    if (!t.customerId) continue
    const ex = activityMap.get(t.customerId)
    if (ex) {
      ex.totalCents += t.totalCents
      ex.tx++
      if (t.date > ex.lastDate) ex.lastDate = t.date
      // Preserva whatsapp/phone/origin quando o primeiro registro não tinha
      if (!ex.whatsapp && t.whatsapp) ex.whatsapp = t.whatsapp
      if (!ex.phone    && t.phone)    ex.phone    = t.phone
      if (!ex.origin   && t.origin)   ex.origin   = t.origin
      const b = t.source === 'erp' ? ex.phonesmart : ex.checksmart
      b.totalCents += t.totalCents
      b.tx++
      if (!b.lastDate || t.date > b.lastDate) b.lastDate = t.date
    } else {
      const agg: ActivityEntry = {
        name: t.name,
        whatsapp: t.whatsapp, phone: t.phone, origin: t.origin,
        lastDate: t.date,
        totalCents: t.totalCents, tx: 1,
        phonesmart:   { lastDate: null, totalCents: 0, tx: 0 },
        checksmart: { lastDate: null, totalCents: 0, tx: 0 },
      }
      const b = t.source === 'erp' ? agg.phonesmart : agg.checksmart
      b.lastDate   = t.date
      b.totalCents = t.totalCents
      b.tx         = 1
      activityMap.set(t.customerId, agg)
    }
  }

  const now = Date.now()
  const MS_DAY = 86400000
  const daysSinceFn = (d: Date | null) => d ? Math.floor((now - d.getTime()) / MS_DAY) : null

  // Passa todos os clientes com atividade dos últimos 6 meses (sem filtro de
  // threshold — o client decide via slider). Limita a 100 pra não explodir
  // o payload quando a base é muito grande.
  const churnRisk: ChurnClient[] = [...activityMap.values()]
    .map(c => ({
      c,
      totalDays: Math.floor((now - c.lastDate.getTime()) / MS_DAY),
    }))
    .sort((a, b) => b.c.totalCents - a.c.totalCents)
    .slice(0, 100)
    .map(({ c, totalDays }) => ({
      name: c.name,
      whatsapp: c.whatsapp,
      phone: c.phone,
      origin: c.origin,
      daysSince: totalDays,
      totalCents: c.totalCents,
      transactions: c.tx,
      sources: {
        phonesmart: {
          daysSince: daysSinceFn(c.phonesmart.lastDate),
          totalCents: c.phonesmart.totalCents,
          transactions: c.phonesmart.tx,
        },
        checksmart: {
          daysSince: daysSinceFn(c.checksmart.lastDate),
          totalCents: c.checksmart.totalCents,
          transactions: c.checksmart.tx,
        },
      },
    }))

  let campeoes = 0, emRisco = 0, novosPromissores = 0, dormentes = 0
  for (const [, c] of activityMap) {
    const days = Math.floor((now - c.lastDate.getTime()) / MS_DAY)
    const isRecent    = days <= 30
    const isFrequent  = c.tx >= 3
    const isHighValue = c.totalCents >= 50000

    if (isRecent && isFrequent && isHighValue)          campeoes++
    else if (!isRecent && (isFrequent || isHighValue))  emRisco++
    else if (isRecent && !isFrequent)                   novosPromissores++
    else                                                dormentes++
  }
  const rfmSegments = { campeoes, emRisco, novosPromissores, dormentes }

  // ── Insight text ─────────────────────────────────────────────────────────
  const recTicket  = recTx > 0 ? recTot / recTx : 0
  const novTicket  = novTx > 0 ? novTot / novTx : 0
  const ticketRatio = novTicket > 0 ? (recTicket / novTicket).toFixed(1) : null
  const insightText = ticketRatio && parseFloat(ticketRatio) > 1
    ? `Clientes recorrentes gastam em média ${ticketRatio}× mais por pedido do que clientes novos. Invista em fidelização.`
    : recTx === 0 && novTx === 0
    ? 'Nenhuma venda encontrada no período selecionado.'
    : `${recShare}% do faturamento vem de clientes recorrentes. Mantenha o atendimento de qualidade para retê-los.`

  const data: DashboardData = {
    period,
    recorrentes: {
      totalCents:       recTot,
      profitCents:      recProf,
      transactions:     recTx,
      ticketMedioCents: recTx > 0 ? Math.round(recTot / recTx) : 0,
      avgProducts:      recTx > 0 ? (recProd / recTx).toFixed(1) : '0.0',
      sharePercent:     recShare,
      marginPercent:    recTot > 0 ? Math.round((recProf / recTot) * 100) : 0,
    },
    novos: {
      totalCents:       novTot,
      profitCents:      novProf,
      transactions:     novTx,
      ticketMedioCents: novTx > 0 ? Math.round(novTot / novTx) : 0,
      avgProducts:      novTx > 0 ? (novProd / novTx).toFixed(1) : '0.0',
      sharePercent:     100 - recShare,
      marginPercent:    novTot > 0 ? Math.round((novProf / novTot) * 100) : 0,
    },
    monthlyData,
    topClients,
    insightText,
    sources,
    churnRisk,
    rfmSegments,
    weekdayHeatmap,
    originBreakdown,
  }

  return <ErpClientesClient data={data} />
}
