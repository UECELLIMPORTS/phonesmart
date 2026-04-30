import { requireAuth } from '@/lib/supabase/server'
import { getTenantSubscriptions, canAccess } from '@/lib/subscription'
import { UpgradeBlock } from '@/components/upgrade-block'
import { getTenantId } from '@/lib/tenant'
import { redirect }    from 'next/navigation'
import { originLabel } from '@/lib/customer-origin'
import { RelatoriosClient } from './relatorios-client'
import { getDetailedSalesReport, getProductsReport } from '@/actions/relatorios'
import type { SalesReportData, ProductReportRow } from '@/actions/relatorios'
import { getMonthlyFixedCostCents } from '@/actions/recurring-expenses'
import { getVariableExpensesTotalCents } from '@/actions/variable-expenses'

export type Tab = 'geral' | 'vendas' | 'produtos'

export const metadata = { title: 'Relatórios — Phone Smart' }

type Period = '7d' | '30d' | '90d' | '6m' | 'custom'

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
  if (period === '7d')        start.setDate(start.getDate() - 6)
  else if (period === '30d')  start.setDate(start.getDate() - 29)
  else if (period === '90d')  start.setDate(start.getDate() - 89)
  else if (period === '6m') { start.setMonth(start.getMonth() - 6) }
  else                        start.setDate(start.getDate() - 29)
  return { start, end }
}

function osTotal(o: { total_price_cents: number | null; service_price_cents: number | null; parts_sale_cents: number | null; discount_cents: number | null }): number {
  if (o.total_price_cents) return o.total_price_cents
  return Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
}

export type OriginReportRow = {
  value: string | null
  label: string
  uniqueCustomers: number
  transactions:    number
  totalCents:      number
  profitCents:     number
  ticketMedioCents: number
  marginPercent:   number
}

export type TopClientRow = {
  id: string
  name: string
  origin: string | null
  whatsapp: string | null
  phone: string | null
  totalCents: number
  profitCents: number
  transactions: number
}

export type RelatoriosData = {
  tab:    Tab
  period: Period
  from: string | null
  to:   string | null
  source: 'total' | 'phonesmart' | 'checksmart'
  origin: string
  channel: string
  paymentMethod: string
  status: 'all' | 'completed' | 'cancelled'
  category: string
  resumo: {
    totalCents:      number
    profitCents:     number
    marginPercent:   number
    transactions:    number
    uniqueCustomers: number
    // Custos do período (estimados — fixos pro-rata + variáveis reais)
    fixedCostCents:    number   // proporcional ao período (custo mensal fixo / 30 × dias)
    variableCostCents: number   // soma dos gastos variáveis no período
    netProfitCents:    number   // profit - fixedCost - variableCost
    netMarginPercent:  number
  }
  origins:    OriginReportRow[]
  topClients: TopClientRow[]
  salesReport:    SalesReportData | null
  productsReport: ProductReportRow[] | null
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string; period?: string; from?: string; to?: string;
    source?: string; origin?: string; channel?: string;
    payment?: string; status?: string; category?: string;
  }>
}) {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { supabase, user } = auth

  // Gate: Relatórios é Pro+
  const subs = await getTenantSubscriptions(user)
  if (!canAccess(subs, 'reports')) {
    return <UpgradeBlock feature="reports" pageTitle="Relatórios" />
  }

  const tenantId = getTenantId(user)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const params = await searchParams
  const tab = (['geral', 'vendas', 'produtos'].includes(params.tab ?? '') ? params.tab : 'geral') as Tab
  const period = (['7d', '30d', '90d', '6m', 'custom'].includes(params.period ?? '')
    ? params.period
    : '30d') as Period
  const source = (['total', 'phonesmart', 'checksmart'].includes(params.source ?? '')
    ? params.source
    : 'total') as 'total' | 'phonesmart' | 'checksmart'
  const origin        = params.origin   ?? 'all'
  const channel       = params.channel  ?? 'all'
  const paymentMethod = params.payment  ?? 'all'
  const status        = (['all', 'completed', 'cancelled'].includes(params.status ?? '') ? params.status : 'completed') as 'all' | 'completed' | 'cancelled'
  const category      = params.category ?? 'all'
  const { start, end } = getPeriodRange(period, params.from, params.to)

  const cols = 'customer_id, total_cents, sale_channel, customer_origin, created_at, sale_items(quantity, unit_price_cents, product_id, cost_snapshot_cents), customers(id, full_name, origin, whatsapp, phone)'
  const osCols = 'customer_id, total_price_cents, service_price_cents, parts_sale_cents, parts_cost_cents, discount_cents, sale_channel, received_at, customers(id, full_name, origin, whatsapp, phone)'

  const [salesRes, osRes] = await Promise.all([
    source === 'checksmart'
      ? Promise.resolve({ data: [] as unknown[] })
      : sb.from('sales')
          .select(cols)
          .eq('tenant_id', tenantId)
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString())
          .neq('status', 'cancelled')
          .limit(2000),
    source === 'phonesmart'
      ? Promise.resolve({ data: [] as unknown[] })
      : sb.from('service_orders')
          .select(osCols)
          .eq('tenant_id', tenantId)
          .gte('received_at', start.toISOString())
          .lte('received_at', end.toISOString())
          .in('status', ['delivered', 'Entregue'])
          .limit(2000),
  ])

  type SalesRow = {
    customer_id: string | null
    total_cents: number
    sale_channel: string | null
    customer_origin: string | null
    sale_items: { quantity: number; unit_price_cents: number; product_id: string | null; cost_snapshot_cents: number | null }[] | null
    customers: { id: string; full_name: string; origin: string | null; whatsapp: string | null; phone: string | null } | null
  }
  type OsRow = {
    customer_id: string | null
    total_price_cents: number | null
    service_price_cents: number | null
    parts_sale_cents: number | null
    parts_cost_cents: number | null
    discount_cents: number | null
    sale_channel: string | null
    customers: { id: string; full_name: string; origin: string | null; whatsapp: string | null; phone: string | null } | null
  }
  const salesData = (salesRes.data ?? []) as SalesRow[]
  const osData    = (osRes.data   ?? []) as OsRow[]

  // Custos em paralelo
  const productIds = new Set<string>()
  for (const s of salesData) for (const i of s.sale_items ?? []) if (i.product_id) productIds.add(i.product_id)
  const costMap = new Map<string, number>()
  if (productIds.size > 0) {
    const ids = [...productIds]
    const [prodRes, partRes] = await Promise.all([
      sb.from('products').select('id, cost_cents').eq('tenant_id', tenantId).in('id', ids),
      sb.from('parts_catalog').select('id, cost_cents').eq('tenant_id', tenantId).in('id', ids),
    ])
    for (const p of (prodRes.data ?? []) as { id: string; cost_cents: number }[]) costMap.set(p.id, p.cost_cents ?? 0)
    for (const p of (partRes.data ?? []) as { id: string; cost_cents: number }[]) costMap.set(p.id, p.cost_cents ?? 0)
  }

  // Unifica transações
  type Tx = {
    customerId: string | null
    name: string
    origin: string | null
    channel: string | null
    whatsapp: string | null
    phone: string | null
    totalCents: number
    profitCents: number
  }
  const txs: Tx[] = [
    ...salesData.map(s => {
      const items = s.sale_items ?? []
      const total = s.total_cents ?? 0
      const cost = items.reduce((sum, i) => {
        // Prioriza snapshot (custo no momento da venda); fallback pro atual
        const c = i.cost_snapshot_cents ?? (i.product_id ? (costMap.get(i.product_id) ?? 0) : 0)
        return sum + (i.quantity ?? 0) * c
      }, 0)
      return {
        customerId: s.customer_id,
        name:      s.customers?.full_name ?? 'Sem cliente',
        // COALESCE: origem da venda > origem do cliente (Consumidor Final usa
        // sale.customer_origin pra não compartilhar entre vendas)
        origin:    s.customer_origin ?? s.customers?.origin ?? null,
        channel:   s.sale_channel ?? null,
        whatsapp:  s.customers?.whatsapp ?? null,
        phone:     s.customers?.phone ?? null,
        totalCents: total,
        profitCents: total - cost,
      }
    }),
    ...osData.map(o => {
      const total = osTotal(o)
      const partsCost = o.parts_cost_cents ?? 0
      return {
        customerId: o.customer_id,
        name:      o.customers?.full_name ?? 'Sem cliente',
        origin:    o.customers?.origin ?? null,
        channel:   o.sale_channel ?? null,
        whatsapp:  o.customers?.whatsapp ?? null,
        phone:     o.customers?.phone ?? null,
        totalCents: total,
        profitCents: total - partsCost,
      }
    }),
  ]

  // Aplica filtros de origem + canal
  const filtered = txs.filter(t => {
    // Origem
    if (origin === '__no_origin__' && t.origin) return false
    if (origin !== 'all' && origin !== '__no_origin__' && t.origin !== origin) return false
    // Canal
    if (channel === '__no_channel__' && t.channel) return false
    if (channel !== 'all' && channel !== '__no_channel__' && t.channel !== channel) return false
    return true
  })

  // Resumo
  const resumoTotalCents  = filtered.reduce((s, t) => s + t.totalCents, 0)
  const resumoProfitCents = filtered.reduce((s, t) => s + t.profitCents, 0)
  const resumoCustomers   = new Set(filtered.filter(t => t.customerId).map(t => t.customerId as string))

  // Custos do período pra calcular Lucro Líquido real:
  //   - Fixed (recurring): custo mensal × (dias do período / 30)
  //   - Variable: soma dos gastos variáveis no período
  const periodDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  const [monthlyFixedCents, variableCostCents] = await Promise.all([
    getMonthlyFixedCostCents(),
    getVariableExpensesTotalCents(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)),
  ])
  const fixedCostCents  = Math.round((monthlyFixedCents * periodDays) / 30)
  const netProfitCents  = resumoProfitCents - fixedCostCents - variableCostCents
  const netMarginPercent = resumoTotalCents > 0
    ? Math.round((netProfitCents / resumoTotalCents) * 100)
    : 0

  // Relatório por origem (sempre mostra todas, ignorando filtro de origem)
  const originMap = new Map<string, { totalCents: number; profitCents: number; tx: number; customers: Set<string> }>()
  const NO_ORIGIN = '__no_origin__'
  for (const t of txs) {
    const key = t.origin ?? NO_ORIGIN
    const ex = originMap.get(key)
    if (ex) {
      ex.totalCents  += t.totalCents
      ex.profitCents += t.profitCents
      ex.tx++
      if (t.customerId) ex.customers.add(t.customerId)
    } else {
      originMap.set(key, {
        totalCents: t.totalCents,
        profitCents: t.profitCents,
        tx: 1,
        customers: t.customerId ? new Set([t.customerId]) : new Set(),
      })
    }
  }
  const origins: OriginReportRow[] = [...originMap.entries()]
    .map(([key, v]) => ({
      value: key === NO_ORIGIN ? null : key,
      label: key === NO_ORIGIN ? 'Não informado' : originLabel(key),
      uniqueCustomers: v.customers.size,
      transactions:    v.tx,
      totalCents:      v.totalCents,
      profitCents:     v.profitCents,
      ticketMedioCents: v.tx > 0 ? Math.round(v.totalCents / v.tx) : 0,
      marginPercent:   v.totalCents > 0 ? Math.round((v.profitCents / v.totalCents) * 100) : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)

  // Top 10 clientes (aplica filtro de origem)
  const custMap = new Map<string, { name: string; origin: string | null; whatsapp: string | null; phone: string | null; total: number; profit: number; tx: number }>()
  for (const t of filtered) {
    if (!t.customerId) continue
    const ex = custMap.get(t.customerId)
    if (ex) {
      ex.total  += t.totalCents
      ex.profit += t.profitCents
      ex.tx++
    } else {
      custMap.set(t.customerId, {
        name: t.name, origin: t.origin, whatsapp: t.whatsapp, phone: t.phone,
        total: t.totalCents, profit: t.profitCents, tx: 1,
      })
    }
  }
  const topClients: TopClientRow[] = [...custMap.entries()]
    .map(([id, c]) => ({
      id,
      name: c.name,
      origin: c.origin,
      whatsapp: c.whatsapp,
      phone: c.phone,
      totalCents: c.total,
      profitCents: c.profit,
      transactions: c.tx,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 10)

  // Carrega dados das abas Vendas/Produtos sob demanda (evita query pesada
  // se o user só está olhando a Visão Geral)
  let salesReport: SalesReportData | null = null
  let productsReport: ProductReportRow[] | null = null

  if (tab === 'vendas') {
    salesReport = await getDetailedSalesReport({
      start:          start.toISOString(),
      end:            end.toISOString(),
      paymentMethods: paymentMethod !== 'all' ? [paymentMethod] : undefined,
      saleChannels:   channel !== 'all' ? [channel] : undefined,
      status,
    })
  } else if (tab === 'produtos') {
    productsReport = await getProductsReport({
      start:    start.toISOString(),
      end:      end.toISOString(),
      category: category !== 'all' ? category : undefined,
    })
  }

  const data: RelatoriosData = {
    tab,
    period,
    from:   params.from ?? null,
    to:     params.to   ?? null,
    source,
    origin,
    channel,
    paymentMethod,
    status,
    category,
    resumo: {
      totalCents:      resumoTotalCents,
      profitCents:     resumoProfitCents,
      marginPercent:   resumoTotalCents > 0 ? Math.round((resumoProfitCents / resumoTotalCents) * 100) : 0,
      transactions:    filtered.length,
      uniqueCustomers: resumoCustomers.size,
      fixedCostCents,
      variableCostCents,
      netProfitCents,
      netMarginPercent,
    },
    origins,
    topClients,
    salesReport,
    productsReport,
  }

  return <RelatoriosClient data={data} />
}
