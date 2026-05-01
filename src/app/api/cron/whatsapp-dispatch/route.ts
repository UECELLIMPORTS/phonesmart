/**
 * Cron — Dispatch da fila de mensagens WhatsApp.
 *
 * Roda a cada 15 minutos. Pega scheduled_whatsapp_messages com
 * status='pending' e scheduled_for <= now(), envia via Evolution API.
 *
 * Anti-flood: limita 50 envios por execução (≈200/h por tenant).
 * Retry: até 3 tentativas; depois marca como 'failed'.
 *
 * Sem EVOLUTION_API_URL/KEY → todas as msgs falham com erro claro mas
 * não fica em loop infinito (max 3 attempts).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage, isEvolutionConfigured } from '@/lib/evolution'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_PER_RUN = 50
const MAX_ATTEMPTS = 3

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 })
  }
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  if (!isEvolutionConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY não configuradas',
      sent: 0, failed: 0,
    })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Pega mensagens prontas pra envio
  const nowIso = new Date().toISOString()
  const { data: queue, error: queueErr } = await sb
    .from('scheduled_whatsapp_messages')
    .select(`
      id, tenant_id, recipient_phone, body, attempt_count,
      tenants!inner(whatsapp_instance_name, whatsapp_status)
    `)
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(MAX_PER_RUN)

  if (queueErr) {
    return NextResponse.json({ ok: false, error: queueErr.message }, { status: 500 })
  }

  type Item = {
    id: string; tenant_id: string; recipient_phone: string; body: string
    attempt_count: number
    tenants: { whatsapp_instance_name: string | null; whatsapp_status: string | null }
  }
  const items = (queue ?? []) as Item[]

  let sent = 0, failed = 0, skipped = 0

  for (const item of items) {
    const instance = item.tenants?.whatsapp_instance_name
    const status   = item.tenants?.whatsapp_status

    // Tenant desconectou — cancela todas as msgs pendentes dele
    if (!instance || status !== 'connected') {
      await sb
        .from('scheduled_whatsapp_messages')
        .update({
          status:     'cancelled',
          last_error: status === 'disconnected'
            ? 'WhatsApp do tenant não está conectado'
            : `tenant status: ${status ?? 'sem instância'}`,
        })
        .eq('id', item.id)
      skipped++
      continue
    }

    const res = await sendTextMessage({
      instanceName: instance,
      phone:        item.recipient_phone,
      text:         item.body,
    })

    if (res.ok) {
      await sb
        .from('scheduled_whatsapp_messages')
        .update({
          status:               'sent',
          sent_at:              new Date().toISOString(),
          attempt_count:        item.attempt_count + 1,
          last_error:           null,
          evolution_message_id: res.data?.messageId ?? null,
        })
        .eq('id', item.id)
      sent++
    } else {
      const newAttempt = item.attempt_count + 1
      const finalStatus = newAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending'
      await sb
        .from('scheduled_whatsapp_messages')
        .update({
          status:        finalStatus,
          attempt_count: newAttempt,
          last_error:    res.error,
        })
        .eq('id', item.id)
      failed++
    }
  }

  return NextResponse.json({ ok: true, processed: items.length, sent, failed, skipped })
}
