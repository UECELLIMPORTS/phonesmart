import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getSettings } from '@/actions/settings'
import { listRecurringExpenses } from '@/actions/recurring-expenses'
import { getBrandingSettings } from '@/actions/comprovante'
import { getBirthdayConfig } from '@/actions/birthdays'
import { ConfiguracoesClient } from './configuracoes-client'

export const metadata = { title: 'Configurações — Phone Smart' }

export default async function ConfiguracoesPage() {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const [settings, expenses, branding, birthdayConfig] = await Promise.all([
    getSettings(),
    listRecurringExpenses(),
    getBrandingSettings(),
    getBirthdayConfig(),
  ])
  const isOwner = auth.user.app_metadata?.tenant_role === 'owner'

  return (
    <ConfiguracoesClient
      initialSettings={settings}
      isOwner={isOwner}
      initialExpenses={expenses}
      initialBranding={branding}
      initialBirthdayConfig={birthdayConfig}
    />
  )
}
