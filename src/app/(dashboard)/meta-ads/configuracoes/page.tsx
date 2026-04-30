import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getMetaAdsCredentials, listAdAccounts } from '@/actions/meta-ads'
import { ConfiguracoesClient } from './configuracoes-client'

export const metadata = { title: 'Configurações — Meta Ads' }

export default async function MetaAdsConfiguracoesPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const [current, accounts] = await Promise.all([
    getMetaAdsCredentials(),
    listAdAccounts().catch(() => []),
  ])

  return <ConfiguracoesClient current={current} accounts={accounts} />
}
