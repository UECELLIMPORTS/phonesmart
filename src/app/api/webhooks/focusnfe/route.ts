/**
 * Webhook Focus NFe — recebe notificações de mudança de status das emissões.
 *
 * Quando uma NFC-e/NF-e/NFS-e muda de status (autorizada, cancelada, rejeitada),
 * a Focus envia POST pra esse endpoint com o payload completo.
 *
 * Configuração no painel da Focus NFe:
 *   URL: https://phonesmart.vercel.app/api/webhooks/focusnfe?secret=XXX
 *   Eventos: TODOS (NFe, NFC-e, NFS-e — autorização, cancelamento, etc)
 *
 * Auth: query param `secret` deve bater com env FOCUS_WEBHOOK_SECRET.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyFocusStatusUpdate } from '@/lib/fiscal-emit-core'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')

  if (!process.env.FOCUS_WEBHOOK_SECRET) {
    console.error('[focusnfe-webhook] FOCUS_WEBHOOK_SECRET não configurado')
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 500 })
  }
  if (secret !== process.env.FOCUS_WEBHOOK_SECRET) {
    console.warn('[focusnfe-webhook] Secret inválido')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try { payload = await request.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // Doc Focus: payload tem `ref` (nosso ID) + `status` + outros campos
  const data = payload as { ref?: string; status?: string }
  if (!data.ref) {
    return NextResponse.json({ error: 'missing ref' }, { status: 400 })
  }

  // Nosso ref tem padrão `nfce-{emissionId}`, `nfe-{emissionId}`, `nfse-{emissionId}`
  const match = data.ref.match(/^(nfce|nfe|nfse)-(.+)$/)
  if (!match) {
    return NextResponse.json({ error: 'invalid ref format' }, { status: 400 })
  }
  const emissionId = match[2]

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data: emission } = await sb
    .from('fiscal_emissions')
    .select('id, tenant_id')
    .eq('id', emissionId)
    .maybeSingle()

  if (!emission) {
    console.warn(`[focusnfe-webhook] emissão ${emissionId} não encontrada`)
    return NextResponse.json({ error: 'emission not found' }, { status: 404 })
  }

  try {
    await applyFocusStatusUpdate(emissionId, payload)
    console.log(`[focusnfe-webhook] emissão ${emissionId} atualizada pra ${data.status}`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[focusnfe-webhook] erro ao aplicar update:', e)
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }
}
