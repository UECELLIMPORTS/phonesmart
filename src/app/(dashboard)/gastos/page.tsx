import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listVariableExpenses, getVariableExpensesAnalytics } from '@/actions/variable-expenses'
import { GastosClient } from './gastos-client'

export const metadata = { title: 'Gastos — Phone Smart' }

type Period = '7d' | '30d' | '90d' | 'all'

function getRange(period: Period): { startISO?: string; endISO?: string } {
  if (period === 'all') return {}
  const days = period === '7d' ? 6 : period === '30d' ? 29 : 89
  const end   = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  return { startISO: start.toISOString().slice(0, 10), endISO: end.toISOString().slice(0, 10) }
}

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; category?: string; search?: string }>
}) {
  try { await requireAuth() } catch { redirect('/login') }

  const params = await searchParams
  const period = (['7d', '30d', '90d', 'all'].includes(params.period ?? '') ? params.period : '30d') as Period
  const category = params.category && params.category !== 'all' ? params.category : undefined
  const search   = params.search?.trim() || undefined

  const range = getRange(period)
  const filters = { ...range, category, search }

  const [expenses, analytics] = await Promise.all([
    listVariableExpenses(filters),
    getVariableExpensesAnalytics(filters),
  ])

  return (
    <GastosClient
      initialExpenses={expenses}
      initialAnalytics={analytics}
      initialPeriod={period}
      initialCategory={category ?? 'all'}
      initialSearch={search ?? ''}
    />
  )
}
