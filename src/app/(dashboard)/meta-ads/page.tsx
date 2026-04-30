import { requireAuth } from '@/lib/supabase/server'
import { getTenantSubscriptions, canAccess } from '@/lib/subscription'
import { UpgradeBlock } from '@/components/upgrade-block'
import { getTenantId } from '@/lib/tenant'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Settings, TrendingUp } from 'lucide-react'
import {
  getMetaAdsCredentials,
  fetchMetaAdsInsights,
  fetchMetaAdsCampaigns,
  fetchAdAccountHealth,
  listAdAccounts,
  type MetaAdsPeriod,
  type MetaAdsInsights,
  type MetaAdsCampaign,
  type MetaAdsAdAccount,
  type MetaAdsAccountHealth,
} from '@/actions/meta-ads'
import { countUnreadAlerts } from '@/actions/meta-ads-alerts'
import { MetaAdsDashboard } from './meta-ads-dashboard'

export const metadata = { title: 'Meta Ads — Phone Smart' }

export type OriginTotals = {
  igPagoCents:   number
  igOrgCents:    number
  facebookCents: number
  txCount:       number
}

export type CampaignCodeTotal = {
  code:          string
  revenueCents:  number
  customerCount: number
  txCount:       number
}

async function getIgFacebookRevenue(tenantId: string, sinceIso: string): Promise<OriginTotals> {
  const { supabase } = await requireAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('total_cents, customers!inner(origin)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .in('customers.origin', ['instagram_pago', 'instagram_organico', 'facebook'])
      .limit(5000),
    sb.from('service_orders')
      .select('total_price_cents, service_price_cents, parts_sale_cents, discount_cents, customers!inner(origin)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .in('customers.origin', ['instagram_pago', 'instagram_organico', 'facebook'])
      .limit(5000),
  ])

  const totals: OriginTotals = { igPagoCents: 0, igOrgCents: 0, facebookCents: 0, txCount: 0 }
  type SaleRow = { total_cents: number; customers: { origin: string } }
  type OsRow   = { total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; discount_cents: number|null; customers: { origin: string } }

  for (const s of (salesRes.data ?? []) as SaleRow[]) {
    const origin = s.customers?.origin
    const v = s.total_cents ?? 0
    if (origin === 'instagram_pago')     totals.igPagoCents   += v
    if (origin === 'instagram_organico') totals.igOrgCents    += v
    if (origin === 'facebook')           totals.facebookCents += v
    totals.txCount++
  }
  for (const o of (osRes.data ?? []) as OsRow[]) {
    const origin = o.customers?.origin
    const v = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    if (origin === 'instagram_pago')     totals.igPagoCents   += v
    if (origin === 'instagram_organico') totals.igOrgCents    += v
    if (origin === 'facebook')           totals.facebookCents += v
    totals.txCount++
  }
  return totals
}

async function getRevenueByCampaignCode(tenantId: string, sinceIso: string): Promise<CampaignCodeTotal[]> {
  const { supabase } = await requireAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('customer_id, total_cents, customers!inner(campaign_code)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .not('customers.campaign_code', 'is', null)
      .limit(5000),
    sb.from('service_orders')
      .select('customer_id, total_price_cents, service_price_cents, parts_sale_cents, discount_cents, customers!inner(campaign_code)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .not('customers.campaign_code', 'is', null)
      .limit(5000),
  ])

  type SaleRow = { customer_id: string; total_cents: number; customers: { campaign_code: string } }
  type OsRow   = { customer_id: string; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; discount_cents: number|null; customers: { campaign_code: string } }

  const byCode = new Map<string, { revenueCents: number; customerIds: Set<string>; txCount: number }>()
  const bump = (code: string, customerId: string, v: number) => {
    const bucket = byCode.get(code) ?? { revenueCents: 0, customerIds: new Set<string>(), txCount: 0 }
    bucket.revenueCents += v
    bucket.customerIds.add(customerId)
    bucket.txCount++
    byCode.set(code, bucket)
  }

  for (const s of (salesRes.data ?? []) as SaleRow[]) {
    const code = s.customers?.campaign_code
    if (!code) continue
    bump(code, s.customer_id, s.total_cents ?? 0)
  }
  for (const o of (osRes.data ?? []) as OsRow[]) {
    const code = o.customers?.campaign_code
    if (!code) continue
    const v = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    bump(code, o.customer_id, v)
  }

  return Array.from(byCode.entries())
    .map(([code, b]) => ({
      code,
      revenueCents:  b.revenueCents,
      customerCount: b.customerIds.size,
      txCount:       b.txCount,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
}

function periodToIso(period: MetaAdsPeriod): string {
  const now = new Date()
  if (period === 'today') { now.setHours(0, 0, 0, 0); return now.toISOString() }
  if (period === 'yesterday') {
    const d = new Date(now); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }
  const days = period === '7d' ? 6 : period === '30d' ? 29 : 89
  now.setDate(now.getDate() - days); now.setHours(0, 0, 0, 0)
  return now.toISOString()
}

function resolveSelectedAccount(
  accounts: MetaAdsAdAccount[],
  requested: string | undefined,
): MetaAdsAdAccount | null {
  if (accounts.length === 0) return null
  const active = accounts.filter(a => a.isActive)
  if (active.length === 0) return null
  if (requested) {
    const normalized = requested.startsWith('act_') ? requested : `act_${requested}`
    const match = active.find(a => a.adAccountId === normalized)
    if (match) return match
  }
  return active.find(a => a.isPrimary) ?? active[0]
}

export default async function MetaAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; account?: string }>
}) {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { user } = auth

  // Gate: Meta Ads é Premium (ou subscription dedicada de meta_ads)
  const subs = await getTenantSubscriptions(user)
  if (!canAccess(subs, 'meta_ads')) {
    return <UpgradeBlock feature="meta_ads" pageTitle="Meta Ads" />
  }

  const tenantId = getTenantId(user)

  const { period: rawPeriod = '30d', account: rawAccount } = await searchParams
  const period = (['7d', '30d', '90d', 'today', 'yesterday'].includes(rawPeriod)
    ? rawPeriod
    : '30d') as MetaAdsPeriod

  const credentials = await getMetaAdsCredentials()

  if (!credentials) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>Meta Ads</h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            Dashboard de campanhas do Meta (Facebook + Instagram)
          </p>
        </div>

        <div
          className="rounded-2xl border p-10 text-center"
          style={{ background: '#1B2638', borderColor: '#2A3650' }}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #E4405F22, #1877F222)', border: '1px solid #2A3650' }}>
            <TrendingUp className="h-8 w-8" style={{ color: '#E4405F' }} />
          </div>
          <h2 className="text-lg font-bold" style={{ color: '#F8FAFC' }}>Configure o Meta Ads</h2>
          <p className="mt-2 text-sm max-w-md mx-auto" style={{ color: '#CBD5E1' }}>
            Conecte sua conta Meta Business para ver gastos, métricas de campanha e calcular o ROAS real cruzado com as vendas do seu ERP.
          </p>
          <Link
            href="/meta-ads/configuracoes"
            className="mt-6 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)' }}
          >
            <Settings className="h-4 w-4" />
            Configurar credenciais
          </Link>
          <p className="mt-6 text-xs" style={{ color: '#94A3B8' }}>
            Leva ~15 minutos — a gente te guia passo a passo
          </p>
        </div>
      </div>
    )
  }

  const accounts = await listAdAccounts().catch(() => [] as MetaAdsAdAccount[])
  const selectedAccount = resolveSelectedAccount(accounts, rawAccount)

  let insights: MetaAdsInsights | null = null
  let campaigns: MetaAdsCampaign[] = []
  let loadError: string | null = null

  let accountHealth: MetaAdsAccountHealth | null = null

  if (selectedAccount) {
    // Promise.allSettled: se uma falha, não derruba a outra.
    const [insightsRes, campaignsRes, healthRes] = await Promise.allSettled([
      fetchMetaAdsInsights(period, selectedAccount.adAccountId),
      fetchMetaAdsCampaigns(period, selectedAccount.adAccountId),
      fetchAdAccountHealth(selectedAccount.adAccountId),
    ])

    if (insightsRes.status === 'fulfilled') {
      insights = insightsRes.value
    } else {
      loadError = insightsRes.reason instanceof Error ? insightsRes.reason.message : 'Erro ao carregar insights'
    }

    if (campaignsRes.status === 'fulfilled') {
      campaigns = campaignsRes.value
    } else if (!loadError) {
      loadError = campaignsRes.reason instanceof Error ? campaignsRes.reason.message : 'Erro ao carregar campanhas'
    }

    if (healthRes.status === 'fulfilled') {
      accountHealth = healthRes.value
    }
  } else {
    loadError = 'Nenhuma conta de anúncios ativa. Cadastre uma em Configurações.'
  }

  const sinceIso = periodToIso(period)
  const [origins, campaignCodeTotals, unreadAlerts] = await Promise.all([
    getIgFacebookRevenue(tenantId, sinceIso),
    getRevenueByCampaignCode(tenantId, sinceIso),
    countUnreadAlerts().catch(() => 0),
  ])

  return (
    <MetaAdsDashboard
      period={period}
      accounts={accounts}
      selectedAccount={selectedAccount}
      accountHealth={accountHealth}
      insights={insights}
      campaigns={campaigns}
      loadError={loadError}
      originRevenue={origins}
      campaignCodeTotals={campaignCodeTotals}
      unreadAlertsCount={unreadAlerts}
    />
  )
}
