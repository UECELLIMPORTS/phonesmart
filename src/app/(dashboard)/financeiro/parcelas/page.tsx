import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listPendingInstallments, getRemindersEnabled } from '@/actions/installments'
import { ParcelasClient } from './parcelas-client'

export const metadata = { title: 'Parcelas — Phone Smart' }

export default async function ParcelasPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const [installments, remindersEnabled] = await Promise.all([
    listPendingInstallments().catch(() => []),
    getRemindersEnabled().catch(() => true),
  ])
  return <ParcelasClient initialInstallments={installments} initialRemindersEnabled={remindersEnabled} />
}
