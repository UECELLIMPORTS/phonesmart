/**
 * Cron — Lembrete automático de parcelas a vencer/atrasadas.
 *
 * Configurado em vercel.json pra rodar 12:00 UTC todo dia (= 09:00 BRT).
 * Envia email pra clientes com parcelas em D-7, D-3, D-1, D, D+1, D+3 do
 * vencimento. Não envia 2x na mesma janela de 20h (notification_log).
 *
 * Sem RESEND_API_KEY o helper sendEmail() loga e retorna ok — não falha o cron.
 * Lojistas continuam podendo cobrar manualmente via /financeiro/parcelas.
 */

import { NextResponse } from 'next/server'
import { runDailyInstallmentReminders } from '@/actions/installment-reminders'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 })
  }
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  try {
    const result = await runDailyInstallmentReminders()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron:installment-reminders] erro:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
