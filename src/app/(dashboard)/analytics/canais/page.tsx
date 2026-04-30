import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  getChannelAnalytics, getOriginAnalytics, getInferredOriginAnalytics,
  getOriginChannelMatrix, getCacByChannel,
  type ChannelAnalyticsPeriod,
} from '@/actions/sales-channels'
import { getMonthlyFixedCostCents } from '@/actions/recurring-expenses'
import { CanaisClient } from './canais-client'
import { getTenantSubscriptions, canAccess } from '@/lib/subscription'
import { UpgradeBlock } from '@/components/upgrade-block'

export const metadata = { title: 'Canais — Phone Smart' }

const VALID_PERIODS: ChannelAnalyticsPeriod[] = ['7d', '30d', '90d', '180d', '365d', 'all']

export default async function CanaisPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  // Gate: Canais é Pro+
  const subs = await getTenantSubscriptions(auth.user)
  if (!canAccess(subs, 'canais')) {
    return <UpgradeBlock feature="canais" pageTitle="Análise de Canais" />
  }

  const { period: rawPeriod = '30d' } = await searchParams
  const period = (VALID_PERIODS as string[]).includes(rawPeriod)
    ? (rawPeriod as ChannelAnalyticsPeriod)
    : '30d'

  const [data, monthlyFixedCostCents, origins, inferredOrigins, originChannelMatrix, cac] = await Promise.all([
    getChannelAnalytics(period),
    getMonthlyFixedCostCents(),  // soma despesas detalhadas (fallback pro campo antigo)
    getOriginAnalytics(period),
    getInferredOriginAnalytics(period),
    getOriginChannelMatrix(period),
    getCacByChannel(period),
  ])

  return (
    <CanaisClient
      data={data}
      origins={origins}
      inferredOrigins={inferredOrigins}
      originChannelMatrix={originChannelMatrix}
      cac={cac}
      fixedCostMonthlyCents={monthlyFixedCostCents > 0 ? monthlyFixedCostCents : null}
    />
  )
}
