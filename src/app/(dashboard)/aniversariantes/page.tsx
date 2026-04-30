import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listBirthdayCustomers, getBirthdayConfig } from '@/actions/birthdays'
import { AniversariantesClient } from './aniversariantes-client'

export const metadata = { title: 'Aniversariantes — Phone Smart' }

export default async function AniversariantesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  try { await requireAuth() } catch { redirect('/login') }

  const params = await searchParams
  const filter = (['today', 'week', 'month'].includes(params.filter ?? '') ? params.filter : 'month') as 'today' | 'week' | 'month'

  const [customers, todayList, weekList, config] = await Promise.all([
    listBirthdayCustomers(filter),
    listBirthdayCustomers('today'),
    listBirthdayCustomers('week'),
    getBirthdayConfig(),
  ])

  return (
    <AniversariantesClient
      initialCustomers={customers}
      initialFilter={filter}
      todayCount={todayList.length}
      weekCount={weekList.length}
      monthCount={filter === 'month' ? customers.length : (await listBirthdayCustomers('month')).length}
      discountPercent={config.discountPercent}
    />
  )
}
