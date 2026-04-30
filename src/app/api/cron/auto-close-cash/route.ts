/**
 * Cron — Auto-fecha caixas que ficaram abertos depois das 23:59.
 *
 * Configurado em vercel.json pra rodar 02:59 UTC todo dia (= 23:59 BRT).
 *
 * Vercel Cron autentica automaticamente requests vindas do scheduler via
 * header `Authorization: Bearer ${CRON_SECRET}` (env var). Em dev, pode ser
 * disparado manualmente via curl com o mesmo header.
 *
 * Lógica: pra cada cash_session com status='open', marca como 'auto_closed'
 * com closed_at=now e closing_counted_cents=NULL (não foi contado fisicamente).
 * Operador vê na próxima abertura que fechou auto.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Auth: Vercel Cron manda Bearer token automaticamente
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 })
  }
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: openSessions, error: fetchErr } = await sb
    .from('cash_sessions')
    .select('id, tenant_id, opened_at')
    .eq('status', 'open')

  if (fetchErr) {
    console.error('[auto-close-cash] erro ao buscar sessões:', fetchErr.message)
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  type Row = { id: string; tenant_id: string; opened_at: string }
  const rows = (openSessions ?? []) as Row[]

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, autoClosed: 0, message: 'Nenhum caixa aberto pra fechar.' })
  }

  const closedAt = new Date().toISOString()
  const ids = rows.map(r => r.id)

  const { error: updateErr } = await sb
    .from('cash_sessions')
    .update({
      status:    'auto_closed',
      closed_at: closedAt,
      // closing_counted_cents fica NULL — não houve contagem física
    })
    .in('id', ids)

  if (updateErr) {
    console.error('[auto-close-cash] erro ao auto-fechar:', updateErr.message)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  console.log(`[auto-close-cash] ${rows.length} sessão(ões) auto-fechada(s) em ${closedAt}`)

  return NextResponse.json({
    ok:         true,
    autoClosed: rows.length,
    closedAt,
    sessions:   rows.map(r => ({ id: r.id, tenantId: r.tenant_id, openedAt: r.opened_at })),
  })
}
