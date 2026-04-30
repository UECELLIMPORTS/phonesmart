import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listAdAccounts } from '@/actions/meta-ads'
import { listAlertRules, listAlertEvents } from '@/actions/meta-ads-alerts'
import { AlertasClient } from './alertas-client'

export const metadata = { title: 'Alertas — Meta Ads' }

export default async function MetaAdsAlertasPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const [accounts, rules, events] = await Promise.all([
    listAdAccounts().catch(() => []),
    listAlertRules().catch(() => []),
    listAlertEvents({ limit: 100 }).catch(() => []),
  ])

  return <AlertasClient accounts={accounts} rules={rules} events={events} />
}
