import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listAcquisitions } from '@/actions/product-serials'
import { ComprarClient } from './comprar-client'

export const metadata = { title: 'Comprar Aparelho — Phone Smart' }

export default async function ComprarPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const acquisitions = await listAcquisitions(50).catch(() => [])

  return <ComprarClient initialAcquisitions={acquisitions} />
}
