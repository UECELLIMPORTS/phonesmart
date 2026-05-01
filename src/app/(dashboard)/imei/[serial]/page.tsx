import { requireAuth } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { getDeviceHistory } from '@/actions/product-serials'
import { ImeiHistoryView } from './history-view'

export const metadata = { title: 'Histórico do IMEI — Phone Smart' }

export default async function ImeiHistoryPage({
  params,
}: {
  params: Promise<{ serial: string }>
}) {
  try { await requireAuth() } catch { redirect('/login') }

  const { serial } = await params
  const history = await getDeviceHistory(decodeURIComponent(serial)).catch(() => null)
  if (!history) notFound()

  return <ImeiHistoryView history={history} />
}
