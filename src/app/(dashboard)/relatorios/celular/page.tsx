import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCelularKpis } from '@/actions/dashboard-celular'
import { CelularDashboardClient } from './celular-dashboard-client'

export const metadata = { title: 'Painel da Loja — Phone Smart' }

export default async function CelularDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  try { await requireAuth() } catch { redirect('/login') }

  const { period: periodStr } = await searchParams
  const period = (periodStr === '7d' || periodStr === '90d') ? periodStr : '30d'

  const kpis = await getCelularKpis(period as '7d' | '30d' | '90d').catch(() => null)

  return <CelularDashboardClient initialKpis={kpis} initialPeriod={period as '7d' | '30d' | '90d'} />
}
