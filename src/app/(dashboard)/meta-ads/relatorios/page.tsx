import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { redirect } from 'next/navigation'
import {
  listAdAccounts,
  fetchMetaAdsInsights,
  fetchAccountTimeseries,
  type MetaAdsPeriod,
  type MetaAdsAdAccount,
} from '@/actions/meta-ads'
import { RelatoriosClient } from './relatorios-client'

export const metadata = { title: 'Relatórios — Meta Ads' }

// ── Types exportados (usados pelo client) ──────────────────────────────────

export type ReportChannel = 'instagram_pago' | 'instagram_organico' | 'facebook'

export type ChannelMetrics = {
  channel:        ReportChannel
  label:          string
  color:          string
  newCustomers:   number
  txCount:        number     // vendas + OS atribuídas
  revenueCents:   number
  avgTicketCents: number
}

export type DailyCrossPoint = {
  date:         string   // YYYY-MM-DD
  spendCents:   number
  revenueCents: number
}

export type CacByChannel = {
  channel:      ReportChannel
  label:        string
  color:        string
  spendCents:   number     // 0 pra orgânico
  newCustomers: number
  cacCents:     number | null  // null se 0 clientes ou canal orgânico
}

export type FunnelMetrics = {
  impressions:       number
  clicks:            number
  newCustomers:      number   // com origem Meta
  salesCount:        number   // vendas + OS atribuídas
  salesRevenueCents: number
}

export type RelatoriosData = {
  period:              MetaAdsPeriod
  selectedAccount:     MetaAdsAdAccount | null
  accounts:            MetaAdsAdAccount[]
  dailyCross:          DailyCrossPoint[]
  channels:            ChannelMetrics[]
  cac:                 CacByChannel[]
  funnel:              FunnelMetrics
  insightsSpendCents:  number
  loadError:           string | null
}

// ── Helpers internos ───────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<ReportChannel, { label: string; color: string }> = {
  instagram_pago:     { label: 'Instagram Pago',     color: '#E4405F' },
  instagram_organico: { label: 'Instagram Orgânico', color: '#C13584' },
  facebook:           { label: 'Facebook',           color: '#1877F2' },
}

function periodToRange(period: MetaAdsPeriod): { since: Date; until: Date } {
  const until = new Date()
  const since = new Date(until)
  if (period === 'today')     { since.setHours(0, 0, 0, 0); return { since, until } }
  if (period === 'yesterday') { since.setDate(since.getDate() - 1); since.setHours(0, 0, 0, 0); return { since, until } }
  const days = period === '7d' ? 6 : period === '30d' ? 29 : 89
  since.setDate(since.getDate() - days)
  since.setHours(0, 0, 0, 0)
  return { since, until }
}

function resolveSelectedAccount(
  accounts: MetaAdsAdAccount[],
  requested: string | undefined,
): MetaAdsAdAccount | null {
  const active = accounts.filter(a => a.isActive)
  if (active.length === 0) return null
  if (requested) {
    const normalized = requested.startsWith('act_') ? requested : `act_${requested}`
    const match = active.find(a => a.adAccountId === normalized)
    if (match) return match
  }
  return active.find(a => a.isPrimary) ?? active[0]
}

// ── Query: clientes novos por canal + vendas/OS atribuídas por canal ───────

async function getChannelMetrics(tenantId: string, sinceIso: string): Promise<{
  channels: ChannelMetrics[]
  bySales:  Map<string, number>     // customer_id -> revenue
  bySalesCount: Map<string, number>
}> {
  const { supabase } = await requireAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [customersRes, salesRes, osRes] = await Promise.all([
    sb.from('customers')
      .select('id, origin')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .in('origin', ['instagram_pago', 'instagram_organico', 'facebook'])
      .limit(5000),
    sb.from('sales')
      .select('customer_id, total_cents, customers!inner(origin)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .in('customers.origin', ['instagram_pago', 'instagram_organico', 'facebook'])
      .limit(5000),
    sb.from('service_orders')
      .select('customer_id, total_price_cents, service_price_cents, parts_sale_cents, discount_cents, customers!inner(origin)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .in('customers.origin', ['instagram_pago', 'instagram_organico', 'facebook'])
      .limit(5000),
  ])

  type CustomerRow = { id: string; origin: ReportChannel }
  type SaleRow     = { customer_id: string; total_cents: number; customers: { origin: ReportChannel } }
  type OsRow       = { customer_id: string; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; discount_cents: number|null; customers: { origin: ReportChannel } }

  // Novos clientes por canal
  const newByChannel = new Map<ReportChannel, number>()
  for (const c of (customersRes.data ?? []) as CustomerRow[]) {
    newByChannel.set(c.origin, (newByChannel.get(c.origin) ?? 0) + 1)
  }

  // Faturamento + contagem de transações por canal
  const revByChannel = new Map<ReportChannel, { revenue: number; txCount: number }>()
  const bump = (ch: ReportChannel, v: number) => {
    const b = revByChannel.get(ch) ?? { revenue: 0, txCount: 0 }
    b.revenue  += v
    b.txCount  += 1
    revByChannel.set(ch, b)
  }
  const bySales      = new Map<string, number>()
  const bySalesCount = new Map<string, number>()

  for (const s of (salesRes.data ?? []) as SaleRow[]) {
    const ch = s.customers?.origin
    const v  = s.total_cents ?? 0
    if (!ch || v <= 0) continue
    bump(ch, v)
    bySales.set(s.customer_id, (bySales.get(s.customer_id) ?? 0) + v)
    bySalesCount.set(s.customer_id, (bySalesCount.get(s.customer_id) ?? 0) + 1)
  }
  for (const o of (osRes.data ?? []) as OsRow[]) {
    const ch = o.customers?.origin
    const v  = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    if (!ch || v <= 0) continue
    bump(ch, v)
    bySales.set(o.customer_id, (bySales.get(o.customer_id) ?? 0) + v)
    bySalesCount.set(o.customer_id, (bySalesCount.get(o.customer_id) ?? 0) + 1)
  }

  const channels: ChannelMetrics[] = (['instagram_pago', 'instagram_organico', 'facebook'] as ReportChannel[]).map(ch => {
    const cfg = CHANNEL_CONFIG[ch]
    const rev = revByChannel.get(ch) ?? { revenue: 0, txCount: 0 }
    const newC = newByChannel.get(ch) ?? 0
    const avgTicket = rev.txCount > 0 ? Math.round(rev.revenue / rev.txCount) : 0
    return {
      channel:        ch,
      label:          cfg.label,
      color:          cfg.color,
      newCustomers:   newC,
      txCount:        rev.txCount,
      revenueCents:   rev.revenue,
      avgTicketCents: avgTicket,
    }
  })

  return { channels, bySales, bySalesCount }
}

// ── Query: faturamento atribuído por dia (pra linha cruzada com gasto) ─────

async function getDailyRevenueByDay(tenantId: string, sinceIso: string): Promise<Map<string, number>> {
  const { supabase } = await requireAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('created_at, total_cents, customers!inner(origin)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .in('customers.origin', ['instagram_pago', 'facebook'])
      .limit(10000),
    sb.from('service_orders')
      .select('received_at, total_price_cents, service_price_cents, parts_sale_cents, discount_cents, customers!inner(origin)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .in('customers.origin', ['instagram_pago', 'facebook'])
      .limit(10000),
  ])

  type SRow = { created_at: string; total_cents: number }
  type ORow = { received_at: string; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; discount_cents: number|null }

  const byDay = new Map<string, number>()
  const addDay = (date: string, v: number) => byDay.set(date, (byDay.get(date) ?? 0) + v)

  for (const s of (salesRes.data ?? []) as SRow[]) {
    addDay(s.created_at.slice(0, 10), s.total_cents ?? 0)
  }
  for (const o of (osRes.data ?? []) as ORow[]) {
    const v = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    addDay(o.received_at.slice(0, 10), v)
  }

  return byDay
}

// ── Página ─────────────────────────────────────────────────────────────────

export default async function MetaAdsRelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; account?: string }>
}) {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { user } = auth
  const tenantId = getTenantId(user)

  const { period: rawPeriod = '30d', account: rawAccount } = await searchParams
  const period = (['7d', '30d', '90d', 'today', 'yesterday'].includes(rawPeriod)
    ? rawPeriod
    : '30d') as MetaAdsPeriod

  const accounts = await listAdAccounts().catch(() => [] as MetaAdsAdAccount[])
  const selectedAccount = resolveSelectedAccount(accounts, rawAccount)

  const { since } = periodToRange(period)
  const sinceIso = since.toISOString()

  let insightsSpendCents = 0
  let insightsImpressions = 0
  let insightsClicks = 0
  let dailyMetaTs: { date: string; spendCents: number }[] = []
  let loadError: string | null = null

  if (selectedAccount) {
    try {
      const [insights, ts] = await Promise.all([
        fetchMetaAdsInsights(period, selectedAccount.adAccountId),
        fetchAccountTimeseries(period, selectedAccount.adAccountId),
      ])
      if (insights) {
        insightsSpendCents  = insights.spendCents
        insightsImpressions = insights.impressions
        insightsClicks      = insights.clicks
      }
      dailyMetaTs = ts.map(t => ({ date: t.date, spendCents: t.spendCents }))
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Erro ao carregar dados do Meta'
    }
  }

  const [{ channels }, dailyRevenue] = await Promise.all([
    getChannelMetrics(tenantId, sinceIso),
    getDailyRevenueByDay(tenantId, sinceIso),
  ])

  // Merge das duas séries em dailyCross
  const dailySet = new Set<string>([
    ...dailyMetaTs.map(t => t.date),
    ...dailyRevenue.keys(),
  ])
  const dailyCross: DailyCrossPoint[] = [...dailySet].sort().map(date => ({
    date,
    spendCents:   dailyMetaTs.find(t => t.date === date)?.spendCents ?? 0,
    revenueCents: dailyRevenue.get(date) ?? 0,
  }))

  // CAC por canal
  const cac: CacByChannel[] = channels.map(c => {
    const isPaid = c.channel === 'instagram_pago' || c.channel === 'facebook'
    // Divide o gasto total do Meta proporcionalmente entre os canais pagos?
    // Opção mais honesta: atribui o gasto total às duas (ig_pago + facebook) combinadas.
    // Como a API do Meta não separa gasto IG vs FB por canal aqui, usamos o total.
    const totalNewPaid = (channels.find(x => x.channel === 'instagram_pago')?.newCustomers ?? 0)
                       + (channels.find(x => x.channel === 'facebook')?.newCustomers ?? 0)
    const shareSpend   = isPaid && totalNewPaid > 0
      ? Math.round(insightsSpendCents * (c.newCustomers / totalNewPaid))
      : 0
    const cacVal       = isPaid && c.newCustomers > 0
      ? Math.round(shareSpend / c.newCustomers)
      : null
    return {
      channel:      c.channel,
      label:        c.label,
      color:        c.color,
      spendCents:   shareSpend,
      newCustomers: c.newCustomers,
      cacCents:     cacVal,
    }
  })

  const funnel: FunnelMetrics = {
    impressions:       insightsImpressions,
    clicks:            insightsClicks,
    newCustomers:      channels.reduce((s, c) => s + c.newCustomers, 0),
    salesCount:        channels.reduce((s, c) => s + c.txCount, 0),
    salesRevenueCents: channels.reduce((s, c) => s + c.revenueCents, 0),
  }

  const data: RelatoriosData = {
    period,
    selectedAccount,
    accounts,
    dailyCross,
    channels,
    cac,
    funnel,
    insightsSpendCents,
    loadError,
  }

  return <RelatoriosClient data={data} />
}
