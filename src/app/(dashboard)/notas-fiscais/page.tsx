import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/supabase/server'
import { listEmissions } from '@/actions/fiscal-emit'
import { getFiscalConfig } from '@/actions/fiscal'
import { NotasFiscaisClient } from './notas-fiscais-client'

export const metadata = { title: 'Notas Fiscais — Phone Smart' }

export default async function NotasFiscaisPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const [emissions, config] = await Promise.all([
    listEmissions(),
    getFiscalConfig(),
  ])

  return <NotasFiscaisClient initial={emissions} configEnabled={!!config?.enabled} />
}
