import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listPendingInstallments } from '@/actions/installments'
import { ParcelasClient } from './parcelas-client'

export const metadata = { title: 'Parcelas — Phone Smart' }

export default async function ParcelasPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const installments = await listPendingInstallments().catch(() => [])
  return <ParcelasClient initialInstallments={installments} />
}
