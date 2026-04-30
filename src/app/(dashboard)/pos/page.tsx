import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getOrCreateConsumidorFinal } from '@/actions/pos'
import { getSettings } from '@/actions/settings'
import { getActiveCashSession, getLastClosedSession } from '@/actions/cash'
import { PosClient } from './pos-client'
import { CaixaFechado } from './caixa-fechado'
import { CaixaAbertoHeader } from './caixa-aberto-header'

export const metadata = { title: 'Frente de Caixa — Phone Smart' }

export default async function PosPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const session = await getActiveCashSession()

  // Caixa fechado → mostra tela de abrir caixa + resumo da última sessão
  if (!session) {
    const lastSummary = await getLastClosedSession()
    return <CaixaFechado lastSummary={lastSummary} />
  }

  // Caixa aberto → header com botão fechar + POS normal
  const [consumidorFinal, settings] = await Promise.all([
    getOrCreateConsumidorFinal(),
    getSettings(),
  ])

  return (
    <>
      <CaixaAbertoHeader session={session} />
      <PosClient
        consumidorFinal={consumidorFinal}
        stockControlMode={settings.stock_control_mode}
      />
    </>
  )
}
