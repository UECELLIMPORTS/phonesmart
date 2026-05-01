import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listServiceOrders } from '@/actions/service-orders'
import { AssistenciaClient } from './assistencia-client'

export const metadata = { title: 'Assistência Técnica — Phone Smart' }

export default async function AssistenciaPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const orders = await listServiceOrders('all').catch(() => [])
  return <AssistenciaClient initialOrders={orders} />
}
