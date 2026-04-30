import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/supabase/server'
import { getFiscalConfig } from '@/actions/fiscal'
import { FiscalClient } from './fiscal-client'

export const metadata = { title: 'Configuração Fiscal — Phone Smart' }

export default async function FiscalConfigPage() {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  // Apenas owner acessa configuração fiscal (mexe em valor sensível)
  const isOwner = auth.user.app_metadata?.tenant_role === 'owner'
  if (!isOwner) redirect('/configuracoes')

  const config = await getFiscalConfig()

  return <FiscalClient initial={config} />
}
