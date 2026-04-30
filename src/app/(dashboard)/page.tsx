import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { redirect } from 'next/navigation'
import {
  DollarSign, ShoppingCart, Users, Receipt,
  TrendingUp, Wrench, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { DashboardFilters } from './dashboard-filters'
import { OriginDonut } from './origin-donut'
import { ChannelDonut } from './channel-donut'
import { OnboardingWizard } from '@/components/onboarding-wizard'
import { getUserFeatures, getDefaultRoute } from '@/lib/permissions'

// ── Types ──────────────────────────────────────────────────────────────────

type Period = 'today' | '7d' | '30d' | 'custom'
type Origin = 'all' | 'erp' | 'checksmart'

type KPICardProps = {
  title:    string
  value:    string
  subtitle: string
  icon:     React.ElementType
  color:    string
  trend?:   { value: string; positive: boolean }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

function todayBRL(): string {
  return new Date().toLocaleDateString('fr-CA', { timeZone: 'America/Sao_Paulo' })
}

function getPeriodRange(period: Period, from?: string, to?: string): { start: Date; end: Date } {
  const today = todayBRL()
  const end = new Date(`${today}T23:59:59-03:00`)

  if (period === 'custom' && from && to) {
    return { start: new Date(`${from}T00:00:00-03:00`), end: new Date(`${to}T23:59:59-03:00`) }
  }
  if (period === '30d') {
    const d = new Date(`${today}T00:00:00-03:00`)
    d.setDate(d.getDate() - 29)
    return { start: d, end }
  }
  if (period === '7d') {
    const d = new Date(`${today}T00:00:00-03:00`)
    d.setDate(d.getDate() - 6)
    return { start: d, end }
  }
  // today
  return { start: new Date(`${today}T00:00:00-03:00`), end }
}

function getMonthRange(): { start: Date; end: Date } {
  const today = todayBRL()
  const [y, m] = today.split('-')
  const start = new Date(`${y}-${m}-01T00:00:00-03:00`)
  const end = new Date(`${today}T23:59:59-03:00`)
  return { start, end }
}

function periodLabel(period: Period, from?: string, to?: string): string {
  if (period === 'today') return 'hoje'
  if (period === '7d') return 'últimos 7 dias'
  if (period === '30d') return 'últimos 30 dias'
  if (from && to) return `${from} – ${to}`
  return 'período selecionado'
}

// ── KPI Card ───────────────────────────────────────────────────────────────

function KPICard({ title, value, subtitle, icon: Icon, color, trend }: KPICardProps) {
  return (
    <div
      className="rounded-xl p-5 transition-all relative overflow-hidden"
      style={{
        background: '#FFFFFF',
        boxShadow: '0 4px 12px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.08)',
        borderTop: `3px solid ${color}`,
      }}
    >
      {/* Tint colorido sutil no canto */}
      <div className="pointer-events-none absolute top-0 right-0 h-24 w-24 rounded-bl-full opacity-[0.10]"
        style={{ background: color }} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>
            {title}
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight" style={{ color: '#0B1220' }}>{value}</p>
          <p className="mt-1 text-xs" style={{ color: '#64748B' }}>{subtitle}</p>
        </div>
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl shrink-0"
          style={{ background: `${color}18`, border: `1px solid ${color}40` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
      {trend && (
        <div className="relative mt-3 flex items-center gap-1 text-xs font-medium">
          {trend.positive
            ? <ArrowUpRight className="h-3.5 w-3.5" style={{ color: '#10B981' }} />
            : <ArrowDownRight className="h-3.5 w-3.5" style={{ color: '#EF4444' }} />
          }
          <span style={{ color: trend.positive ? '#10B981' : '#EF4444' }}>{trend.value}</span>
          <span style={{ color: '#64748B' }}>vs. período anterior</span>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

type OsStatus = 'delivered' | 'pending' | 'all'
type SearchParams = { period?: string; origin?: string; from?: string; to?: string; os_status?: string }

export default async function DashboardPage(props: { searchParams: Promise<SearchParams> }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { supabase, user } = auth
  const tenantId = getTenantId(user)

  // Gate: se user não tem acesso ao Dashboard, manda pra primeira rota acessível
  const features = await getUserFeatures(user)
  if (!features.has('dashboard')) {
    const fallback = await getDefaultRoute(user)
    redirect(fallback)
  }
  const showKpis    = features.has('dashboard:kpis')
  const showCharts  = features.has('dashboard:charts')
  const showReports = features.has('dashboard:reports')
  const showFiltros = features.has('dashboard:filtros')

  const sp = await props.searchParams
  const period = (sp.period ?? 'today') as Period
  const origin = (sp.origin ?? 'all') as Origin
  const fromDate = sp.from
  const toDate   = sp.to
  // Default 'delivered' — só conta OSs entregues como faturamento. Pendentes
  // não contam (ainda não viraram receita) e canceladas nunca contam.
  const osStatus = (['delivered', 'pending', 'all'].includes(sp.os_status ?? '')
    ? sp.os_status
    : 'delivered') as OsStatus

  /** Aplica filtro de status às queries de service_orders. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyOsFilter = (q: any) => {
    if (osStatus === 'delivered') return q.in('status', ['delivered', 'Entregue'])
    if (osStatus === 'pending')   return q.not('status', 'in', '("delivered","Entregue","cancelled")')
    return q.neq('status', 'cancelled')   // 'all' = tudo menos canceladas
  }

  const { start, end }       = getPeriodRange(period, fromDate, toDate)
  const { start: mStart, end: mEnd } = getMonthRange()

  const showERP = origin !== 'checksmart'
  const showCS  = origin !== 'erp'

  const EMPTY = Promise.resolve({ data: [] as never[], error: null, count: 0 })

  // ── Parallel queries ─────────────────────────────────────────────────────

  const [
    salesPeriodRes,
    ordersPeriodRes,
    salesMonthRes,
    ordersMonthRes,
    recentSalesRes,
    recentOrdersRes,
    osAbertasRes,
    clientesRes,
    salesOriginRes,
    osOriginRes,
  ] = await Promise.all([
    // 1. Sales no período (ERP) — exclui canceladas
    showERP
      ? supabase
          .from('sales')
          .select('total_cents', { count: 'exact' })
          .eq('tenant_id', tenantId)
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString())
          .neq('status', 'cancelled')
      : EMPTY,

    // 2. Service orders no período (CheckSmart) — filtra por osStatus
    showCS
      ? applyOsFilter(supabase
          .from('service_orders')
          .select('total_price_cents', { count: 'exact' })
          .eq('tenant_id', tenantId)
          .gte('received_at', start.toISOString())
          .lte('received_at', end.toISOString()))
      : EMPTY,

    // 3. Sales no mês (ERP) — exclui canceladas
    showERP
      ? supabase
          .from('sales')
          .select('total_cents')
          .eq('tenant_id', tenantId)
          .gte('created_at', mStart.toISOString())
          .lte('created_at', mEnd.toISOString())
          .neq('status', 'cancelled')
      : EMPTY,

    // 4. Service orders no mês (CheckSmart) — filtra por osStatus
    showCS
      ? applyOsFilter(supabase
          .from('service_orders')
          .select('total_price_cents')
          .eq('tenant_id', tenantId)
          .gte('received_at', mStart.toISOString())
          .lte('received_at', mEnd.toISOString()))
      : EMPTY,

    // 5. Últimas sales (atividade) — exclui canceladas
    showERP
      ? supabase
          .from('sales')
          .select('id, total_cents, payment_method, created_at, customers ( full_name )')
          .eq('tenant_id', tenantId)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(10)
      : EMPTY,

    // 6. Últimas service_orders (atividade) — filtra por osStatus
    showCS
      ? applyOsFilter(supabase
          .from('service_orders')
          .select('id, total_price_cents, status, received_at, customers ( full_name )')
          .eq('tenant_id', tenantId))
          .order('received_at', { ascending: false })
          .limit(10)
      : EMPTY,

    // 7. OS abertas
    showCS
      ? supabase
          .from('service_orders')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .not('status', 'in', '("delivered","cancelled")')
      : EMPTY,

    // 8. Clientes ativos (últimos 90 dias)
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('updated_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()),

    // 9. Sales do período com origem do cliente + canal (pra gráficos de rosca)
    showERP
      ? supabase
          .from('sales')
          .select('customer_id, total_cents, sale_channel, customers(origin)')
          .eq('tenant_id', tenantId)
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString())
          .neq('status', 'cancelled')
          .limit(2000)
      : EMPTY,

    // 10. OS entregues do período com origem do cliente + canal
    showCS
      ? supabase
          .from('service_orders')
          .select('customer_id, total_price_cents, service_price_cents, parts_sale_cents, discount_cents, sale_channel, customers(origin)')
          .eq('tenant_id', tenantId)
          .gte('received_at', start.toISOString())
          .lte('received_at', end.toISOString())
          .in('status', ['delivered', 'Entregue'])
          .limit(2000)
      : EMPTY,
  ])

  // ── KPI calculations ──────────────────────────────────────────────────────

  const salesPeriod  = (salesPeriodRes.data  ?? []) as { total_cents: number }[]
  const ordersPeriod = (ordersPeriodRes.data ?? []) as { total_price_cents: number }[]
  const salesMonth   = (salesMonthRes.data   ?? []) as { total_cents: number }[]
  const ordersMonth  = (ordersMonthRes.data  ?? []) as { total_price_cents: number }[]

  const fatPeriod = salesPeriod.reduce((s, r) => s + r.total_cents, 0)
               + ordersPeriod.reduce((s, r) => s + (r.total_price_cents ?? 0), 0)

  const fatMonth = salesMonth.reduce((s, r) => s + r.total_cents, 0)
               + ordersMonth.reduce((s, r) => s + (r.total_price_cents ?? 0), 0)

  const salesCount  = salesPeriod.length
  const ordersCount = ordersPeriod.length
  const txCount     = salesCount + ordersCount
  const ticketMedio = txCount > 0 ? Math.round(fatPeriod / txCount) : 0

  const osAbertas      = osAbertasRes.count ?? 0
  const clientesAtivos = clientesRes.count  ?? 0

  // ── Onboarding wizard: detecta tenant vazio (recém-cadastrado) ──────────
  // Faz 3 counts leves pra saber se é tenant novo. Se completou os 3 passos,
  // o wizard não aparece.
  const [productCountRes, customerCountRes, channelsRes] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('customers').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('full_name', 'Consumidor Final'),
    supabase.from('sale_channels').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ])
  const productCount  = productCountRes.count  ?? 0
  const customerCount = customerCountRes.count ?? 0
  const hasChannels   = (channelsRes.count ?? 0) > 0

  // ── Breakdown por origem do cliente (pra gráfico de rosca) ────────────────
  type OriginTx = { customer_id: string | null; total: number; origin: string | null }
  const originTxs: OriginTx[] = [
    ...((salesOriginRes.data ?? []) as unknown as {
      customer_id: string | null; total_cents: number; customers: { origin: string | null } | null
    }[]).map(s => ({
      customer_id: s.customer_id,
      total: s.total_cents ?? 0,
      origin: s.customers?.origin ?? null,
    })),
    ...((osOriginRes.data ?? []) as unknown as {
      customer_id: string | null
      total_price_cents: number | null; service_price_cents: number | null
      parts_sale_cents: number | null; discount_cents: number | null
      customers: { origin: string | null } | null
    }[]).map(o => {
      const total = o.total_price_cents
        ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
      return {
        customer_id: o.customer_id,
        total,
        origin: o.customers?.origin ?? null,
      }
    }),
  ]
  const originMap = new Map<string, { total: number; tx: number; customers: Set<string> }>()
  const NO_ORIG = '__no__'
  for (const t of originTxs) {
    const key = t.origin ?? NO_ORIG
    const ex = originMap.get(key)
    if (ex) {
      ex.total += t.total
      ex.tx++
      if (t.customer_id) ex.customers.add(t.customer_id)
    } else {
      originMap.set(key, { total: t.total, tx: 1, customers: t.customer_id ? new Set([t.customer_id]) : new Set() })
    }
  }
  const originTotal = [...originMap.values()].reduce((s, v) => s + v.total, 0)
  const originBreakdown = [...originMap.entries()]
    .map(([key, v]) => ({
      value: key === NO_ORIG ? null : key,
      totalCents: v.total,
      transactions: v.tx,
      uniqueCustomers: v.customers.size,
      sharePercent: originTotal > 0 ? Math.round((v.total / originTotal) * 100) : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)

  // ── Breakdown por canal de venda (pra gráfico de rosca) ──────────────────
  type ChannelTx = { total: number; channel: string | null }
  const channelTxs: ChannelTx[] = [
    ...((salesOriginRes.data ?? []) as unknown as {
      total_cents: number; sale_channel: string | null
    }[]).map(s => ({
      total:   s.total_cents ?? 0,
      channel: s.sale_channel ?? null,
    })),
    ...((osOriginRes.data ?? []) as unknown as {
      total_price_cents: number | null; service_price_cents: number | null
      parts_sale_cents: number | null; discount_cents: number | null
      sale_channel: string | null
    }[]).map(o => {
      const total = o.total_price_cents
        ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
      return { total, channel: o.sale_channel ?? null }
    }),
  ]
  const channelMap = new Map<string, { total: number; tx: number }>()
  const NO_CH = '__no__'
  for (const t of channelTxs) {
    const key = t.channel ?? NO_CH
    const ex = channelMap.get(key)
    if (ex) { ex.total += t.total; ex.tx++ }
    else    { channelMap.set(key, { total: t.total, tx: 1 }) }
  }
  const channelTotal = [...channelMap.values()].reduce((s, v) => s + v.total, 0)
  const channelBreakdown = [...channelMap.entries()]
    .map(([key, v]) => ({
      value:        key === NO_CH ? null : key,
      totalCents:   v.total,
      transactions: v.tx,
      sharePercent: channelTotal > 0 ? Math.round((v.total / channelTotal) * 100) : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)

  // ── Activity merge ────────────────────────────────────────────────────────

  type ActivityItem = {
    id: string
    desc: string
    value: string
    time: string
    color: string
    source: 'ERP' | 'CheckSmart'
    date: Date
  }

  const recentSales  = (recentSalesRes.data  ?? []) as unknown as {
    id: string; total_cents: number; payment_method: string; created_at: string
    customers: { full_name: string } | null
  }[]

  const recentOrders = (recentOrdersRes.data ?? []) as unknown as {
    id: string; total_price_cents: number; status: string; received_at: string
    customers: { full_name: string } | null
  }[]

  const activityItems: ActivityItem[] = [
    ...recentSales.map(s => ({
      id:     `sale-${s.id}`,
      desc:   `Venda — ${s.customers?.full_name ?? 'Sem cliente'}`,
      value:  BRL(s.total_cents),
      time:   new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      color:  '#10B981',
      source: 'ERP' as const,
      date:   new Date(s.created_at),
    })),
    ...recentOrders.map(o => ({
      id:     `os-${o.id}`,
      desc:   `OS — ${o.customers?.full_name ?? 'Sem cliente'}`,
      value:  BRL(o.total_price_cents ?? 0),
      time:   new Date(o.received_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      color:  '#22C55E',
      source: 'CheckSmart' as const,
      date:   new Date(o.received_at),
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 10)

  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  })

  return (
    <div className="space-y-6">

      {/* Onboarding wizard pra tenants vazios — desaparece quando completa */}
      <OnboardingWizard
        productCount={productCount}
        customerCount={customerCount}
        hasChannels={hasChannels}
      />

      {/* Header + Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Dashboard</h1>
          <p className="mt-1 text-sm capitalize" style={{ color: '#94A3B8' }}>{today}</p>
        </div>
        {showFiltros && <DashboardFilters />}
      </div>

      {/* KPIs */}
      {showKpis && (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KPICard
          title={`Faturamento — ${periodLabel(period, fromDate, toDate)}`}
          value={BRL(fatPeriod)}
          subtitle={`${txCount} transaç${txCount === 1 ? 'ão' : 'ões'} realizadas`}
          icon={DollarSign}
          color="#10B981"
        />
        <KPICard
          title="Faturamento do Mês"
          value={BRL(fatMonth)}
          subtitle={new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })}
          icon={TrendingUp}
          color="#22C55E"
        />
        <KPICard
          title="Vendas (ERP)"
          value={String(salesCount)}
          subtitle={periodLabel(period, fromDate, toDate)}
          icon={ShoppingCart}
          color="#F59E0B"
        />
        <KPICard
          title="Ticket Médio"
          value={BRL(ticketMedio)}
          subtitle={periodLabel(period, fromDate, toDate)}
          icon={Receipt}
          color="#22C55E"
        />
        <KPICard
          title="Clientes Ativos"
          value={String(clientesAtivos)}
          subtitle="Últimos 90 dias"
          icon={Users}
          color="#10B981"
        />
        <KPICard
          title="OS Abertas"
          value={String(osAbertas)}
          subtitle="CheckSmart"
          icon={Wrench}
          color="#EF4444"
        />
      </div>
      )}

      {/* Origem dos Clientes + Canais (gráficos) */}
      {showCharts && <OriginDonut breakdown={originBreakdown} />}
      {showCharts && <ChannelDonut breakdown={channelBreakdown} />}

      {/* Atividade recente */}
      {showReports && (
      <div className="rounded-xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: '#2A3650' }}>
          <h2 className="text-sm font-semibold text-text">Atividade Recente</h2>
          <span className="text-xs" style={{ color: '#94A3B8' }}>{activityItems.length} registros</span>
        </div>

        {activityItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16">
            <Receipt className="h-8 w-8" style={{ color: '#64748B' }} />
            <p className="text-sm" style={{ color: '#94A3B8' }}>Nenhuma atividade no período selecionado</p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: '#2A3650' }}>
            {activityItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                  <div className="min-w-0">
                    <p className="text-sm text-text truncate">{item.desc}</p>
                    <span
                      className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs font-semibold"
                      style={{ background: `${item.color}18`, color: item.color }}
                    >
                      {item.source}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-sm font-semibold" style={{ color: item.color }}>{item.value}</p>
                  <p className="text-xs" style={{ color: '#94A3B8' }}>{item.time}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {/* Mensagem se nenhum bloco está liberado */}
      {!showKpis && !showCharts && !showReports && (
        <div className="rounded-xl border p-12 text-center"
          style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <p className="text-sm" style={{ color: '#CBD5E1' }}>
            Você tem acesso ao Dashboard mas nenhum bloco foi liberado pelo dono.
          </p>
        </div>
      )}

    </div>
  )
}
